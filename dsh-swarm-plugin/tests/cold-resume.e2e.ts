/**
 * Real-API cold-resume e2e: real child spawns (DeepSeek), durable JSONL
 * writes, a NEW Context over the same persistence root, and verification that
 * the swarm comes back with its roster, routed messages, and checkpoint
 * markers intact. Key-gated (see vitest.e2e.config.ts); the resident
 * mock-adapter equivalent lives in chat.spec.ts's cold-resume case.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import * as agentSwarm from '../src/index.ts'

const MODEL = { provider: 'deepseek-official', model: 'deepseek-v4-flash' } as const

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Boot the full stack with the real DeepSeek adapter over one persistence root. */
async function harness(root: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(LlmDeepSeek)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(agentSwarm, { defaultModel: MODEL })
  return ctx
}

function executeTool(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>, callId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(callId),
    name,
    arguments: args,
    agent,
  })
}

/** Await every running role's live child reaching quiescence. */
async function settleRoles(ctx: Context, agent: Agent, swarmId: string, callId: string): Promise<void> {
  const list = await executeTool(ctx, agent, 'swarm_list_children', { swarmId }, callId)
  if (list.isError) throw new Error('expected swarm_list_children value')
  const roles = (list.value as { roles: Array<{ childId: string; status: string }> }).roles
  for (const role of roles.filter(entry => entry.status === 'running')) {
    const child = ctx.agents.get(SessionId(role.childId))
    if (child !== undefined) await child.whenIdle()
  }
}

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('swarm cold resume (real API)', () => {
  it('real spawn → disk → new Context resume keeps roster, messages, and checkpoint', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-e2e-resume-'))
    roots.push(root)

    // First boot: spawn two real roles, route one real message, checkpoint.
    const first = await harness(root)
    const created = await first.agents.create({
      sessionId: SessionId('swarm-e2e-root'),
      agentOptions: { ...MODEL },
    })
    const agent = created.agent
    for (const roleName of ['alpha', 'beta']) {
      const spawned = await executeTool(first, agent, 'swarm_spawn', {
        swarmId: 's', roleName, systemPrompt: `You are ${roleName}. Reply with one short word.`,
      }, `spawn-${roleName}`)
      expect(spawned.isError).toBe(false)
    }
    await settleRoles(first, agent, 's', 'settle-spawn')
    const sent = await executeTool(first, agent, 'swarm_send_to', { swarmId: 's', to: 'alpha', content: 'ping' }, 'send')
    expect(sent.isError).toBe(false)
    await settleRoles(first, agent, 's', 'settle-send')
    const checkpoint = await executeTool(first, agent, 'swarm_checkpoint', { swarmId: 's' }, 'checkpoint')
    expect(checkpoint.isError).toBe(false)

    const before = first.sessionProjections.snapshot(agent.session).values.swarm
    const childIds = before?.s?.roles.map(role => [role.roleName, role.childId] as const)
    expect(childIds).toHaveLength(2)
    expect(before?.s?.messageCount).toBe(1)

    await expect(first.sessions.flush(agent.session)).resolves.toBe(true)
    const index = contexts.indexOf(first)
    if (index >= 0) contexts.splice(index, 1)
    await first.fiber.dispose()

    // Second boot over the same root: a fresh Context resumes the orchestrator.
    const second = await harness(root)
    const sessionId = SessionId('swarm-e2e-root')
    const resumed = new Promise<void>((resolve) => {
      const stop = second.on('session/event', (session, event) => {
        if (session.id !== sessionId || event.type !== 'swarm/resumed') return
        stop()
        resolve()
      })
    })
    const handle = await second.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { ...MODEL },
    })
    await resumed
    await settleRoles(second, handle.agent, 's', 'settle-after-resume')

    // Both child sessions survived on disk: each role comes back as `resumed`
    // (history intact) under its ORIGINAL child session id — none respawned.
    const resumedEvent = handle.agent.session.events.find(event => event.type === 'swarm/resumed')
    expect(resumedEvent).toBeDefined()
    if (resumedEvent?.type !== 'swarm/resumed') throw new Error('missing swarm/resumed')
    expect(resumedEvent.data.roles.map(role => [role.roleName, role.action])).toEqual([
      ['alpha', 'resumed'],
      ['beta', 'resumed'],
    ])

    // The folded panel model matches the pre-shutdown state exactly.
    const after = second.sessionProjections.snapshot(handle.agent.session).values.swarm
    expect(after?.s?.roles.map(role => [role.roleName, role.childId, role.status])).toEqual(
      childIds?.map(([roleName, childId]) => [roleName, childId, 'running']),
    )
    expect(after?.s?.messageCount).toBe(1)
    expect(after?.s?.latestCheckpointAt).toBe(before?.s?.latestCheckpointAt)
    expect(after?.s?.terminated).toBe(false)

    // The swarm is genuinely live again: routing another message works.
    const reply = await executeTool(second, handle.agent, 'swarm_send_to', { swarmId: 's', to: 'beta', content: 'pong' }, 'send-2')
    expect(reply.isError).toBe(false)
    await settleRoles(second, handle.agent, 's', 'settle-send-2')
    expect(second.sessionProjections.snapshot(handle.agent.session).values.swarm?.s?.messageCount).toBe(2)
  }, 120_000)
})
