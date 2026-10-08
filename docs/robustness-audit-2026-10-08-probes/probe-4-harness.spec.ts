/**
 * G4 adversarial probe 4: settled-role blindness, event-vocabulary unload,
 * and the cold-resume catch-all re-spawn.
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
import type { ContentBlock, GenerateOptions, MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionId, KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { deliverSubagentPrompt, type HostPromptDeliverer } from '@deepseek-ai/dsh-subagent/internal'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import { MockAdapter, textResponse } from './mock-adapter.ts'
import * as agentSwarm from '/tmp/tc/plugin/src/index.ts'
import { hydrateSwarmRuntimes, reactivateSwarmRoles } from '/tmp/tc/plugin/src/resume.ts'
import type { SwarmRuntime, SwarmRuntimeConfig } from '/tmp/tc/plugin/src/runtime.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function requestText(options: GenerateOptions): string {
  return options.messages.flatMap(m => m.content).filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n')
}

function okAdapter(): MockAdapter {
  return new MockAdapter(Array.from({ length: 200 }, () => textResponse('ok')))
}

async function chatHarness(root: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['mock'], okAdapter())
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(SessionQueryEngine)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(agentSwarm, { defaultModel: { provider: 'mock', model: 'mock' } })
  return ctx
}

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

function executeTool(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>, callId: string) {
  return ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId(callId), name, arguments: args, agent })
}

describe('probe: a settled child stays "running"', () => {
  it('the harness announces child settlement in the parent session and the plugin ignores it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-settled-'))
    roots.push(root)
    const ctx = await chatHarness(root)
    const created = await ctx.agents.create({ sessionId: SessionId('adv-settled-root'), agentOptions: { provider: 'mock', model: 'mock' } })
    const agent = created.agent
    const spawned = await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'alpha' }, 'spawn')
    const childId = (spawned.value as { childId: string }).childId
    const child = ctx.agents.get(SessionId(childId))!
    await child.whenIdle()
    await new Promise(resolve => setTimeout(resolve, 100))
    const settlements = agent.session.snapshotEvents()
      .filter(e => e.type === 'user/message')
      .map(e => e.data as { source?: { kind?: string; senderSessionId?: string } })
      .filter(d => d.source?.kind === 'subagent-settled')
    console.log('settlement notices seen by the parent =', JSON.stringify(settlements))
    const list = await executeTool(ctx, agent, 'swarm_list_children', { swarmId: 's' }, 'list')
    console.log('role status after the child finished =', JSON.stringify((list.value as { roles: unknown }).roles))
    const folded = agent.session.snapshotEvents().filter(e => e.type === 'swarm/role-exited').length
    console.log('swarm/role-exited events =', folded)
  })
})

describe('probe: cold-resume catch-all re-spawn', () => {
  it('a transient delivery failure produces a duplicate child instead of an error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-resume-catchall-'))
    roots.push(root)
    const ctx = await lightHarness(root)
    const created = await ctx.agents.create({ sessionId: SessionId('adv-resume-root') })
    const agent = created.agent
    const spawnSpy = vi.spyOn(ctx.subagents, 'startContinuable')
      .mockResolvedValue({ childId: SessionId('c1'), messageId: MessageId('m1') })
    const interruptSpy = vi.spyOn(ctx.subagents, 'interrupt')
    await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'alpha' }, 'spawn')

    // The resume notice fails once with a transient error; later deliveries succeed.
    vi.spyOn(ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt)
      .mockRejectedValueOnce(new Error('relay temporarily unavailable'))
      .mockResolvedValue(MessageId('accepted'))

    const config: SwarmRuntimeConfig = {
      provider: 'spawn',
      humanInputMode: 'TERMINATE',
      chat: { speakerSelection: 'round_robin', transcriptWindow: 10 },
      memory: { maxEntries: 200, queryLimit: 5 },
    }
    const runtimes = new Map<string, SwarmRuntime>()
    const pending = hydrateSwarmRuntimes(ctx, agent, runtimes, config)
    console.log('pending resume =', JSON.stringify(pending))
    const runtime = runtimes.get('s')!
    spawnSpy.mockResolvedValue({ childId: SessionId('c2'), messageId: MessageId('m2') })
    await reactivateSwarmRoles(runtime, agent, new AbortController().signal)

    const spawnedEvents = agent.session.snapshotEvents().filter(e => e.type === 'swarm/role-spawned')
      .map(e => e.data as { roleName: string; childId: string })
    const resumed = agent.session.snapshotEvents().filter(e => e.type === 'swarm/resumed')
      .map(e => (e.data as { roles: Array<{ roleName: string; childId: string; action: string }> }).roles)
    console.log('role-spawned events =', JSON.stringify(spawnedEvents))
    console.log('swarm/resumed records =', JSON.stringify(resumed))
    console.log('interrupt calls on the replaced child =', JSON.stringify(interruptSpy.mock.calls.map(c => String(c[0]))))
    expect(spawnedEvents).toHaveLength(2)
  })
})

describe('probe: event vocabulary registration', () => {
  it('mutates the global known set and removes it on unload (microtask ordering)', async () => {
    console.log('before =', KNOWN_SESSION_EVENT_TYPES.has('swarm/created'))
    let cleanup: any
    const fakeCtx: any = {
      inject: () => {},
      effect: (fn: () => any) => { cleanup = fn(); return () => {} },
      on: () => () => {},
      logger: { warn: () => {}, info: () => {}, error: () => {} },
      agents: { roots: () => [] },
    }
    agentSwarm.apply(fakeCtx, {})
    console.log('after apply =', KNOWN_SESSION_EVENT_TYPES.has('swarm/created'))
    await cleanup()
    console.log('after awaited cleanup =', KNOWN_SESSION_EVENT_TYPES.has('swarm/created'))
    // Two instances sharing one global set: unloading either removes the vocabulary.
    const first = (() => { let c: any; const fake: any = { inject: () => {}, effect: (fn: () => any) => { c = fn(); return () => {} }, on: () => () => {}, logger: { warn: () => {} }, agents: { roots: () => [] } }; agentSwarm.apply(fake, {}); return c })()
    let secondCleanup: any
    const fake2: any = { inject: () => {}, effect: (fn: () => any) => { secondCleanup = fn(); return () => {} }, on: () => () => {}, logger: { warn: () => {} }, agents: { roots: () => [] } }
    agentSwarm.apply(fake2, {})
    await first()
    console.log('after unloading ONE of two instances, still known =', KNOWN_SESSION_EVENT_TYPES.has('swarm/created'))
    await secondCleanup()
  })
})
