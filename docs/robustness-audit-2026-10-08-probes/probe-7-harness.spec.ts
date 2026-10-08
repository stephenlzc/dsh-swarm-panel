/**
 * G4 adversarial probe 7: terminate during cold resume; hydrate negative cases.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { deliverSubagentPrompt, type HostPromptDeliverer } from '@deepseek-ai/dsh-subagent/internal'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import * as agentSwarm from '/tmp/tc/plugin/src/index.ts'
import { hydrateSwarmRuntimes, reactivateSwarmRoles } from '/tmp/tc/plugin/src/resume.ts'
import { applySwarmPanelEvent } from '/tmp/tc/plugin/src/panel-model.ts'
import type { SwarmRuntime, SwarmRuntimeConfig } from '/tmp/tc/plugin/src/runtime.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function lightHarness(root: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(agentSwarm)
  return ctx
}

function tool(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>, callId: string) {
  return ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId(callId), name, arguments: args, agent })
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const config: SwarmRuntimeConfig = {
  provider: 'spawn',
  humanInputMode: 'TERMINATE',
  chat: { speakerSelection: 'round_robin', transcriptWindow: 10 },
  memory: { maxEntries: 200, queryLimit: 5 },
}

describe('probe: terminate during reactivation', () => {
  it('appends swarm/resumed after swarm/destroyed and resurrects a role in the panel', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-resume-term-'))
    roots.push(root)
    const ctx = await lightHarness(root)
    const created = await ctx.agents.create({ sessionId: SessionId('adv-resume-term-root') })
    const agent = created.agent
    let next = 0
    vi.spyOn(ctx.subagents, 'startContinuable').mockImplementation(() => {
      next += 1
      return Promise.resolve({ childId: SessionId('c' + next), messageId: MessageId('m' + next) })
    })
    await tool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'alpha' }, 'spawn-a')
    await tool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'beta' }, 'spawn-b')

    // Cold resume: hydrate a fresh runtime from the durable log.
    const runtimes = new Map<string, SwarmRuntime>()
    const pending = hydrateSwarmRuntimes(ctx, agent, runtimes, config)
    console.log('pending =', JSON.stringify(pending))
    const runtime = runtimes.get('s')!

    // The first role's notice blocks until we release it.
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    vi.spyOn(ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt).mockImplementation(() => {
      calls += 1
      if (calls === 1) return gate.then(() => MessageId('accepted-1'))
      return Promise.resolve(MessageId('accepted-' + calls))
    })

    const resume = reactivateSwarmRoles(runtime, agent, new AbortController().signal)
    await delay(30)
    console.log('terminating mid-resume; children =', JSON.stringify([...agent.session.snapshotEvents()].length))
    runtime.terminate('terminated-mid-resume')
    release()
    const outcome = await resume.then(() => 'resolved', (error: unknown) => 'rejected: ' + String(error))
    console.log('reactivateSwarmRoles =', outcome)

    const events = agent.session.snapshotEvents().map(e => e.type)
    console.log('event tail =', JSON.stringify(events.slice(-6)))
    const resumedIndex = events.lastIndexOf('swarm/resumed')
    const destroyedIndex = events.lastIndexOf('swarm/destroyed')
    console.log('swarm/resumed index =', resumedIndex, 'swarm/destroyed index =', destroyedIndex, '=> resumed AFTER destroyed =', resumedIndex > destroyedIndex)
    const resumedEvent = agent.session.snapshotEvents().find(e => e.type === 'swarm/resumed')
    console.log('resumed records =', JSON.stringify(resumedEvent?.data))

    let model: any = null
    for (const event of agent.session.snapshotEvents()) model = applySwarmPanelEvent(model, event)
    const panel = model['s']
    console.log('panel terminated =', panel.terminated, '| roles =', JSON.stringify(panel.roles.map((r: any) => [r.roleName, r.status])))

    // Hydrating again after termination must not re-activate anything.
    const runtimes2 = new Map<string, SwarmRuntime>()
    const pending2 = hydrateSwarmRuntimes(ctx, agent, runtimes2, config)
    console.log('pending after termination =', JSON.stringify(pending2))
    const pending3 = hydrateSwarmRuntimes(ctx, agent, runtimes2, config)
    console.log('pending on a duplicate hydrate =', JSON.stringify(pending3))
  }, 30_000)
})
