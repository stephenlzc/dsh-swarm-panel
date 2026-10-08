/**
 * Checkpoint cadence and cross-process cold resume evidence.
 *
 * The restart tests boot two independent Cordis contexts over one JSONL
 * persistence root: the first plays the live swarm, the second resumes the
 * orchestrator session and must rebuild every swarm runtime from the durable
 * event log. Child sessions are never materialized (startContinuable is
 * mocked), so the respawn-and-replay fallback and the followup cold-resume
 * path are exercised by whether the mocked `followup` accepts the old child id.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime, { SubagentError } from '@deepseek-ai/dsh-subagent'
import { deliverSubagentPrompt, type HostPromptDeliverer } from '@deepseek-ai/dsh-subagent/internal'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import * as agentSwarm from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Boot the full stack over one shared persistence root. The caller owns disposal. */
async function harness(root: string, config?: agentSwarm.Config): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(agentSwarm, config)
  return ctx
}

async function disposeContext(ctx: Context): Promise<void> {
  const index = contexts.indexOf(ctx)
  if (index >= 0) contexts.splice(index, 1)
  await ctx.fiber.dispose()
}

interface FollowupCall {
  readonly childId: string
  readonly text: string
}

/** Record every followup delivery; `accept` decides which child ids receive theirs. */
function mockFollowup(ctx: Context, accept: (childId: string) => boolean): FollowupCall[] {
  const calls: FollowupCall[] = []
  vi.spyOn(ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt).mockImplementation(
    (_parent: Agent, childId: SessionId, content: ContentBlock[], _source: MessageSource, _signal: AbortSignal) => {
      const text = content[0]?.type === 'text' ? content[0].text : ''
      calls.push({ childId, text })
      // Model the host exactly: a durable child that cannot be loaded is
      // rejected with NOT_RESUMABLE — the only failure cold resume treats as
      // proof the child is gone (audit G4-09).
      if (!accept(childId)) {
        return Promise.reject(new SubagentError(`subagent "${childId}" is unavailable`, 'NOT_RESUMABLE'))
      }
      return Promise.resolve(MessageId(`accepted-${calls.length}`))
    },
  )
  return calls
}

/** Queue mocked child ids for startContinuable in spawn order. */
function mockSpawn(ctx: Context, childIds: readonly string[]): void {
  let next = 0
  vi.spyOn(ctx.subagents, 'startContinuable').mockImplementation(() => {
    const childId = childIds[next]
    next += 1
    if (childId === undefined) return Promise.reject(new Error('unexpected extra spawn'))
    return Promise.resolve({ childId: SessionId(childId), messageId: MessageId(`spawn-${childId}`) })
  })
}

function executeTool(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>, callId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(callId),
    name,
    arguments: args,
    agent,
  })
}

/** Emit one running→idle status cycle on the exact agent scope. */
function emitIdle(ctx: Context, agent: Agent): void {
  agentEvents(ctx, agent).emit('agent/status', { status: 'running' })
  agentEvents(ctx, agent).emit('agent/status', { status: 'idle' })
}

function checkpointsOf(events: readonly SessionEvent[]) {
  return events.filter(event => event.type === 'swarm/checkpoint')
}

/** Project swarm events to a deterministic shape for snapshots (instants stripped). */
function projectSwarmEvents(events: readonly SessionEvent[]) {
  return events
    .filter(event => event.type.startsWith('swarm/'))
    .map((event) => {
      const data = Object.fromEntries(
        Object.entries(event.data as Record<string, unknown>)
          .filter(([key]) => !key.endsWith('At') && key !== 'fromCheckpoint'),
      )
      return { type: event.type, data }
    })
}

/** Play one live swarm: two roles, two routed messages, one manual checkpoint. */
async function playLiveSwarm(root: string): Promise<void> {
  const ctx = await harness(root)
  const root_ = await ctx.agents.create({ sessionId: SessionId('swarm-resume-root') })
  mockSpawn(ctx, ['child-alpha', 'child-beta'])
  mockFollowup(ctx, () => true)

  await executeTool(ctx, root_.agent, 'swarm_spawn', {
    swarmId: 'chat', roleName: 'alpha', systemPrompt: 'You are alpha.',
  }, 'spawn-alpha')
  await executeTool(ctx, root_.agent, 'swarm_spawn', {
    swarmId: 'chat', roleName: 'beta',
  }, 'spawn-beta')
  await executeTool(ctx, root_.agent, 'swarm_send_to', {
    swarmId: 'chat', from: 'orchestrator', to: 'alpha', content: 'task one',
  }, 'send-one')
  await executeTool(ctx, root_.agent, 'swarm_send_to', {
    swarmId: 'chat', from: 'alpha', to: 'beta', content: 'handoff',
  }, 'send-two')
  await executeTool(ctx, root_.agent, 'swarm_checkpoint', { swarmId: 'chat' }, 'checkpoint-manual')

  await expect(ctx.sessions.flush(root_.agent.session)).resolves.toBe(true)
  await disposeContext(ctx)
}

/** Resume the orchestrator session in a fresh context and await `swarm/resumed`. */
async function resumeOrchestrator(ctx: Context): Promise<Agent> {
  const sessionId = SessionId('swarm-resume-root')
  const resumed = new Promise<void>((resolve) => {
    const stop = ctx.on('session/event', (session, event) => {
      if (session.id !== sessionId || event.type !== 'swarm/resumed') return
      stop()
      resolve()
    })
  })
  const handle = await ctx.agents.resume({
    resumeSessionId: sessionId,
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  await resumed
  return handle.agent
}

describe('swarm checkpoint cadence', () => {
  it('saves automatic checkpoints at idle for structural changes only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-checkpoint-'))
    roots.push(root)
    const ctx = await harness(root)
    const root_ = await ctx.agents.create({ sessionId: SessionId('swarm-auto-root') })
    mockSpawn(ctx, ['child-1'])
    mockFollowup(ctx, () => true)

    await executeTool(ctx, root_.agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn')
    emitIdle(ctx, root_.agent)
    let checkpoints = checkpointsOf(root_.agent.session.snapshotEvents())
    expect(checkpoints).toHaveLength(1)
    expect((checkpoints[0]!.data as { reason: string }).reason).toBe('auto')

    // No state change: a further idle boundary saves nothing.
    emitIdle(ctx, root_.agent)
    expect(checkpointsOf(root_.agent.session.snapshotEvents())).toHaveLength(1)

    // Manual tool call pins a checkpoint with the folded counts.
    const manual = await executeTool(ctx, root_.agent, 'swarm_checkpoint', { swarmId: 's' }, 'manual')
    expect(manual.isError).toBe(false)
    if (manual.isError) throw new Error('expected swarm_checkpoint value')
    expect(manual.value).toMatchObject({ swarmId: 's', messageCount: 0, roleCount: 1 })
    checkpoints = checkpointsOf(root_.agent.session.snapshotEvents())
    expect(checkpoints).toHaveLength(2)
    expect((checkpoints[1]!.data as { reason: string }).reason).toBe('manual')

    // Message-only progress is not structural: 'auto' stays quiet at idle.
    await executeTool(ctx, root_.agent, 'swarm_send_to', { swarmId: 's', to: 'worker', content: 'hi' }, 'send')
    emitIdle(ctx, root_.agent)
    expect(checkpointsOf(root_.agent.session.snapshotEvents())).toHaveLength(2)

    // A topology change is structural again.
    await executeTool(ctx, root_.agent, 'swarm_set_topology', { swarmId: 's', mode: 'peer' }, 'topo')
    emitIdle(ctx, root_.agent)
    checkpoints = checkpointsOf(root_.agent.session.snapshotEvents())
    expect(checkpoints).toHaveLength(3)
    const snapshot = checkpoints[2]!.data as { reason: string; topologyMode: string; messageCount: number; lastSpeaker: string }
    expect(snapshot).toMatchObject({ reason: 'auto', topologyMode: 'peer', messageCount: 1, lastSpeaker: 'orchestrator' })
  })

  it('checkpoints message-only turns under per_turn and never under manual', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-per-turn-'))
    roots.push(root)
    const ctx = await harness(root, { checkpoint: { frequency: 'per_turn' } })
    const root_ = await ctx.agents.create({ sessionId: SessionId('swarm-per-turn-root') })
    mockSpawn(ctx, ['child-1'])
    mockFollowup(ctx, () => true)

    await executeTool(ctx, root_.agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn')
    emitIdle(ctx, root_.agent)
    await executeTool(ctx, root_.agent, 'swarm_send_to', { swarmId: 's', to: 'worker', content: 'hi' }, 'send')
    emitIdle(ctx, root_.agent)

    const checkpoints = checkpointsOf(root_.agent.session.snapshotEvents())
    expect(checkpoints).toHaveLength(2)
    expect((checkpoints[1]!.data as { reason: string }).reason).toBe('per_turn')

    const manualRoot = mkdtempSync(join(tmpdir(), 'dsh-swarm-manual-'))
    roots.push(manualRoot)
    const manualCtx = await harness(manualRoot, { checkpoint: { frequency: 'manual' } })
    const manualAgent = await manualCtx.agents.create({ sessionId: SessionId('swarm-manual-root') })
    mockSpawn(manualCtx, ['child-1'])
    mockFollowup(manualCtx, () => true)
    await executeTool(manualCtx, manualAgent.agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn')
    emitIdle(manualCtx, manualAgent.agent)
    expect(checkpointsOf(manualAgent.agent.session.snapshotEvents())).toHaveLength(0)
  })

  it('rejects an unknown checkpoint frequency at load', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-bad-config-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    // The declared inject must resolve before apply() runs and can throw.
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(UserQuestionService)
    await expect(
      ctx.plugin(agentSwarm, { checkpoint: { frequency: 'hourly' as 'auto' } }),
    ).rejects.toThrow(/checkpoint\.frequency/)
  })
})

describe('swarm cold resume', () => {
  it('rebuilds runtimes and replays history into re-spawned roles after a host kill', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-restart-'))
    roots.push(root)
    await playLiveSwarm(root)

    // Second boot over the same persistence root. Old child sessions were never
    // materialized, so followup to the old ids fails and every role respawns.
    const ctx = await harness(root)
    mockSpawn(ctx, ['child-alpha-2', 'child-beta-2'])
    const deliveries = mockFollowup(ctx, childId => childId.endsWith('-2'))

    const agent = await resumeOrchestrator(ctx)

    // Both roles were re-spawned and their inbound history replayed in order.
    expect(deliveries.map(call => call.childId)).toEqual([
      'child-alpha',    // resume notice to the lost child: rejected
      'child-alpha-2',  // restore framing
      'child-alpha-2',  // replayed "task one"
      'child-beta',     // resume notice to the lost child: rejected
      'child-beta-2',   // restore framing
      'child-beta-2',   // replayed "handoff"
    ])
    expect(deliveries[0]!.text).toContain('[SWARM RESUMED]')
    expect(deliveries[1]!.text).toContain('[SWARM RESTORED]')
    expect(deliveries[2]!.text).toBe('[restored message from "orchestrator"]\ntask one')
    expect(deliveries[5]!.text).toBe('[restored message from "alpha"]\nhandoff')

    // The resumed fact names the recovery point and every role's outcome.
    const resumedEvents = agent.session.snapshotEvents().filter(event => event.type === 'swarm/resumed')
    expect(resumedEvents).toHaveLength(1)
    const resumedData = resumedEvents[0]!.data as {
      roles: Array<{ roleName: string; childId: string; action: string }>
      fromCheckpoint?: string
    }
    expect(resumedData.roles).toEqual([
      { roleName: 'alpha', childId: 'child-alpha-2', action: 'respawned' },
      { roleName: 'beta', childId: 'child-beta-2', action: 'respawned' },
    ])
    expect(resumedData.fromCheckpoint).toBeDefined()

    // The model sees the rebuilt swarm through the ordinary tools.
    const list = await executeTool(ctx, agent, 'swarm_list_children', { swarmId: 'chat' }, 'list-after-resume')
    expect(list.isError).toBe(false)
    if (list.isError) throw new Error('expected swarm_list_children value')
    expect(list.value).toMatchObject({
      swarmId: 'chat',
      topologyMode: 'parent-child',
      roles: [
        { roleName: 'alpha', childId: 'child-alpha-2', status: 'running' },
        { roleName: 'beta', childId: 'child-beta-2', status: 'running' },
      ],
    })

    // The group chat continues: routing after resume delivers through the new ids.
    const send = await executeTool(ctx, agent, 'swarm_send_to', {
      swarmId: 'chat', from: 'beta', to: 'alpha', content: 'continue',
    }, 'send-after-resume')
    expect(send.isError).toBe(false)
    expect(deliveries.at(-1)).toEqual({ childId: 'child-alpha-2', text: 'continue' })

    // Headless snapshot: the durable swarm trail on the resumed session.
    expect(projectSwarmEvents(agent.session.snapshotEvents())).toMatchSnapshot()
  })

  it('cold-resumes surviving child sessions through followup without re-spawning', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-keep-'))
    roots.push(root)
    await playLiveSwarm(root)

    // Second boot: followup accepts the old child ids, meaning both durable
    // child sessions survived the restart and cold-resume with history intact.
    const ctx = await harness(root)
    const spawned = vi.spyOn(ctx.subagents, 'startContinuable')
    const deliveries = mockFollowup(ctx, () => true)

    const agent = await resumeOrchestrator(ctx)

    expect(spawned).not.toHaveBeenCalled()
    expect(deliveries.map(call => call.childId)).toEqual(['child-alpha', 'child-beta'])
    expect(deliveries.every(call => call.text.includes('[SWARM RESUMED]'))).toBe(true)

    const resumedData = agent.session.snapshotEvents()
      .filter(event => event.type === 'swarm/resumed')
      .map(event => (event.data as { roles: Array<{ roleName: string; childId: string; action: string }> }).roles)
    expect(resumedData).toEqual([[
      { roleName: 'alpha', childId: 'child-alpha', action: 'resumed' },
      { roleName: 'beta', childId: 'child-beta', action: 'resumed' },
    ]])

    // No duplicate spawns or replayed messages entered the durable log.
    const spawnedEvents = agent.session.snapshotEvents().filter(event => event.type === 'swarm/role-spawned')
    expect(spawnedEvents).toHaveLength(2)
    const messages = agent.session.snapshotEvents().filter(event => event.type === 'swarm/role-message')
    expect(messages).toHaveLength(2)

    const list = await executeTool(ctx, agent, 'swarm_list_children', { swarmId: 'chat' }, 'list-kept')
    if (list.isError) throw new Error('expected swarm_list_children value')
    expect(list.value).toMatchObject({
      roles: [
        { roleName: 'alpha', childId: 'child-alpha', status: 'running' },
        { roleName: 'beta', childId: 'child-beta', status: 'running' },
      ],
    })
  })

  it('does not reactivate roles of a terminated swarm', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-terminated-'))
    roots.push(root)

    const ctx = await harness(root)
    const root_ = await ctx.agents.create({ sessionId: SessionId('swarm-resume-root') })
    mockSpawn(ctx, ['child-1'])
    mockFollowup(ctx, () => true)
    await executeTool(ctx, root_.agent, 'swarm_spawn', { swarmId: 'chat', roleName: 'alpha' }, 'spawn')
    await executeTool(ctx, root_.agent, 'swarm_terminate', { swarmId: 'chat' }, 'terminate')
    await expect(ctx.sessions.flush(root_.agent.session)).resolves.toBe(true)
    await disposeContext(ctx)

    const restarted = await harness(root)
    const followups = mockFollowup(restarted, () => true)
    const handle = await restarted.agents.resume({
      resumeSessionId: SessionId('swarm-resume-root'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    // The runtime was hydrated but nothing was reactivated, and the model can
    // still inspect the terminated swarm.
    expect(followups).toHaveLength(0)
    expect(handle.agent.session.snapshotEvents().some(event => event.type === 'swarm/resumed')).toBe(false)
    const list = await executeTool(restarted, handle.agent, 'swarm_list_children', { swarmId: 'chat' }, 'list-terminated')
    if (list.isError) throw new Error('expected swarm_list_children value')
    expect((list.value as { roles: Array<{ status: string }> }).roles)
      .toEqual([{ roleName: 'alpha', childId: 'child-1', status: 'exited' }])
  })
})
