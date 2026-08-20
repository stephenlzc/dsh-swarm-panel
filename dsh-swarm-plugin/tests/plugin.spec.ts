import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import * as agentSwarm from '../src/index.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Boot the full prerequisite stack: the agent-loop test deps, durable session
 * persistence, the concrete loop, session projections, the subagent service, and
 * its in-process `spawn` provider. The caller owns disposal.
 */
async function harness(): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-panel-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(UserQuestionService)
  return ctx
}

describe('Agent Swarm plugin composition', () => {
  it('has the Loader-safe function-plugin export shape', () => {
    expect('default' in agentSwarm).toBe(false)
    expect(agentSwarm.name).toBe('dsh-swarm-panel')
    expect(agentSwarm.inject).toEqual(['agents', 'tools', 'subagents', 'userQuestions'])
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(agentSwarm)).toBe(agentSwarm)
  })

  it('installs only on future root agents and unwinds on plugin disposal', async () => {
    const ctx = await harness()
    const existing = await ctx.agents.create({ sessionId: SessionId('swarm-existing') })
    const plugin = await ctx.plugin(agentSwarm)
    expect(ctx.tools.get('swarm_spawn', existing.agent)).toBeUndefined()
    expect(ctx.tools.get('swarm_spawn')).toBeUndefined()

    const root = await ctx.agents.create({ sessionId: SessionId('swarm-root') })
    expect(ctx.tools.get('swarm_spawn', root.agent)?.name).toBe('swarm_spawn')
    expect(ctx.tools.get('swarm_send_to', root.agent)?.name).toBe('swarm_send_to')
    expect(ctx.tools.get('swarm_set_topology', root.agent)?.name).toBe('swarm_set_topology')
    expect(ctx.tools.get('swarm_list_children', root.agent)?.name).toBe('swarm_list_children')
    expect(ctx.tools.get('swarm_interrupt', root.agent)?.name).toBe('swarm_interrupt')
    expect(ctx.tools.get('swarm_terminate', root.agent)?.name).toBe('swarm_terminate')
    expect(ctx.tools.get('swarm_spawn')).toBeUndefined()

    const child = await root.agent.ctx.agents.create({ sessionId: SessionId('swarm-child') })
    expect(ctx.agents.roots()).toEqual([existing.agent, root.agent])
    expect(ctx.tools.get('swarm_spawn', child.agent)).toBeUndefined()

    const departing = await ctx.agents.create({ sessionId: SessionId('swarm-departing') })
    expect(ctx.tools.get('swarm_spawn', departing.agent)?.name).toBe('swarm_spawn')
    await departing.dispose()
    expect(ctx.tools.get('swarm_spawn', departing.agent)).toBeUndefined()

    await plugin.dispose()
    expect(ctx.tools.get('swarm_spawn', root.agent)).toBeUndefined()
    expect(ctx.tools.get('swarm_send_to', root.agent)).toBeUndefined()
    expect(ctx.tools.get('swarm_set_topology', root.agent)).toBeUndefined()
    expect(ctx.tools.get('swarm_list_children', root.agent)).toBeUndefined()
    expect(ctx.tools.get('swarm_interrupt', root.agent)).toBeUndefined()
    expect(ctx.tools.get('swarm_terminate', root.agent)).toBeUndefined()

    await child.dispose()
    await root.dispose()
    await existing.dispose()
  })

  it('swarm_spawn creates a child via startContinuable and appends session events', async () => {
    const ctx = await harness()
    const plugin = await ctx.plugin(agentSwarm)
    const root = await ctx.agents.create({ sessionId: SessionId('swarm-spawn-root') })

    // Stub the subagent service so no real child turn runs.
    const started = vi.spyOn(ctx.subagents, 'startContinuable').mockResolvedValue({
      childId: SessionId('child-1'),
      messageId: MessageId('msg-1'),
    })

    const created = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('swarm-spawn-test'),
      name: 'swarm_spawn',
      arguments: { swarmId: 'test-swarm', roleName: 'reviewer', systemPrompt: 'You are a reviewer.' },
      agent: root.agent,
    })
    expect(created.isError).toBe(false)
    if (created.isError) throw new Error('expected swarm_spawn value')
    const value = created.value as { swarmId: string; roleName: string; childId: string }
    expect(value).toEqual({ swarmId: 'test-swarm', roleName: 'reviewer', childId: 'child-1' })
    expect(started).toHaveBeenCalledOnce()

    // Verify session events were appended (swarm/created + swarm/role-spawned).
    const events = root.agent.session.events
    expect(events.some(e => e.type === 'swarm/created')).toBe(true)
    expect(events.some(e => e.type === 'swarm/role-spawned')).toBe(true)

    await plugin.dispose()
    await root.dispose()
  })

  it('swarm_spawn rejects an invalid roleName without spawning', async () => {
    const ctx = await harness()
    const plugin = await ctx.plugin(agentSwarm)
    const root = await ctx.agents.create({ sessionId: SessionId('swarm-invalid-root') })
    const started = vi.spyOn(ctx.subagents, 'startContinuable')

    const created = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('swarm-invalid-role'),
      name: 'swarm_spawn',
      arguments: { swarmId: 'test-swarm', roleName: '  ', systemPrompt: 'x' },
      agent: root.agent,
    })
    expect(created.isError).toBe(false)
    if (created.isError) throw new Error('expected swarm_spawn error result')
    expect((created.value as { code: string }).code).toBe('invalid_argument')
    expect(started).not.toHaveBeenCalled()

    await plugin.dispose()
    await root.dispose()
  })

  it('swarm_list_children reports not_found for an unknown swarm', async () => {
    const ctx = await harness()
    const plugin = await ctx.plugin(agentSwarm)
    const root = await ctx.agents.create({ sessionId: SessionId('swarm-list-root') })

    const listEmpty = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('swarm-list-empty'),
      name: 'swarm_list_children',
      arguments: { swarmId: 'empty-swarm' },
      agent: root.agent,
    })
    expect(listEmpty.isError).toBe(false)
    if (listEmpty.isError) throw new Error('expected swarm_list_children value')
    expect((listEmpty.value as { code: string }).code).toBe('not_found')

    await plugin.dispose()
    await root.dispose()
  })

  it('swarm_set_topology and swarm_terminate write their events', async () => {
    const ctx = await harness()
    const plugin = await ctx.plugin(agentSwarm)
    const root = await ctx.agents.create({ sessionId: SessionId('swarm-term-root') })

    // Create the swarm via swarm_spawn (stubbed), then set topology and terminate.
    vi.spyOn(ctx.subagents, 'startContinuable').mockResolvedValue({
      childId: SessionId('child-1'),
      messageId: MessageId('msg-1'),
    })
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('swarm-spawn'),
      name: 'swarm_spawn',
      arguments: { swarmId: 'term-swarm', roleName: 'worker' },
      agent: root.agent,
    })

    const setTopo = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('swarm-set-topo'),
      name: 'swarm_set_topology',
      arguments: { swarmId: 'term-swarm', mode: 'peer' },
      agent: root.agent,
    })
    expect((setTopo.value as { ok: boolean }).ok).toBe(true)

    const term = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('swarm-term'),
      name: 'swarm_terminate',
      arguments: { swarmId: 'term-swarm' },
      agent: root.agent,
    })
    expect((term.value as { ok: boolean }).ok).toBe(true)

    const events = root.agent.session.events
    expect(events.some(e => e.type === 'swarm/topology-changed')).toBe(true)
    expect(events.some(e => e.type === 'swarm/destroyed')).toBe(true)

    await plugin.dispose()
    await root.dispose()
  })

  it('gives each root agent an isolated swarm namespace', async () => {
    const ctx = await harness()
    const plugin = await ctx.plugin(agentSwarm)
    const root = await ctx.agents.create({ sessionId: SessionId('swarm-auth-root') })
    const otherRoot = await ctx.agents.create({ sessionId: SessionId('swarm-auth-other') })

    const started = vi.spyOn(ctx.subagents, 'startContinuable').mockResolvedValue({
      childId: SessionId('child-1'),
      messageId: MessageId('msg-1'),
    })

    // Spawn in root's namespace — succeeds.
    const spawnOk = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('swarm-auth-ok'),
      name: 'swarm_spawn',
      arguments: { swarmId: 'auth-swarm', roleName: 'role1' },
      agent: root.agent,
    })
    expect((spawnOk.value as { code?: string }).code).toBeUndefined()

    // The same swarm name in another root's namespace is a separate registry, so
    // otherRoot does not see root's roles — its list reports not_found.
    const listOther = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('swarm-auth-other-list'),
      name: 'swarm_list_children',
      arguments: { swarmId: 'auth-swarm' },
      agent: otherRoot.agent,
    })
    expect((listOther.value as { code: string }).code).toBe('not_found')
    expect(started).toHaveBeenCalledOnce()

    await plugin.dispose()
    await root.dispose()
    await otherRoot.dispose()
  })
})
