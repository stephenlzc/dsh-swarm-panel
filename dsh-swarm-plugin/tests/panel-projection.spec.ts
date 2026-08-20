/**
 * Host-side panel projection: the `swarm` session-projection unit registered
 * by the plugin folds real tool-driven `swarm/*` events, passes schema
 * validation on every read, and notifies the change feed the client consumes.
 *
 * Children are mocked at the `ctx.subagents` seam; no real child agent runs.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, MessageId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import * as agentSwarm from '../src/index.ts'
import type { SwarmPanelModel } from '../src/panel-model.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Boot the full stack (projection registry before the plugin). The caller owns disposal. */
async function harness(root: string, config?: agentSwarm.Config): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(agentSwarm, config)
  return ctx
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

/** All child ids accept routed messages. */
function mockFollowup(ctx: Context): void {
  let count = 0
  vi.spyOn(ctx.subagents, 'followup').mockImplementation(
    (_parent: Agent, _childId: SessionId, _content: ContentBlock[], _options: { source: MessageSource; signal: AbortSignal }) => {
      count += 1
      return Promise.resolve(MessageId(`accepted-${count}`))
    },
  )
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

/** Read the `swarm` projection value of one session. */
function panelOf(ctx: Context, agent: Agent): SwarmPanelModel | undefined {
  return ctx.sessionProjections.snapshot(agent.session).values.swarm
}

describe('swarm panel projection', () => {
  it('is null for a session that never ran a swarm', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-panel-empty-'))
    roots.push(root)
    const ctx = await harness(root)
    const lone = await ctx.agents.create({ sessionId: SessionId('panel-lone') })
    const snapshot = ctx.sessionProjections.snapshot(lone.agent.session)
    expect(snapshot.asOfSeq).toBe(-1)
    // The key is present (capability mounted) with the pre-first-event value.
    expect(snapshot.values.swarm).toBeNull()
  })

  it('folds tool-driven swarm events into the panel model', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-panel-'))
    roots.push(root)
    const ctx = await harness(root)
    mockSpawn(ctx, ['child-1', 'child-2'])
    mockFollowup(ctx)
    ctx.userQuestions.registerProvider({
      ask: request => Promise.resolve({
        answers: request.questions.map(question => ({ id: question.id, selected: [], custom: 'yes' })),
      }),
    })

    // The change feed the web client consumes via session/projection frames.
    const changes: SwarmPanelModel[] = []
    ctx.sessionProjections.onChanged((_session, key, value) => {
      if (key === 'swarm') changes.push(value as SwarmPanelModel)
    })

    const root_ = await ctx.agents.create({ sessionId: SessionId('panel-root') })
    const agent = root_.agent

    await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'planner' }, 'spawn-1')
    await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'coder' }, 'spawn-2')
    await executeTool(ctx, agent, 'swarm_set_topology', { swarmId: 's', mode: 'peer' }, 'topo')
    await executeTool(ctx, agent, 'swarm_send_to', { swarmId: 's', to: 'planner', content: 'plan this' }, 'send')
    await executeTool(ctx, agent, 'swarm_set_context', { swarmId: 's', key: 'phase', value: 'planning' }, 'ctx-set')
    await executeTool(ctx, agent, 'swarm_checkpoint', { swarmId: 's' }, 'checkpoint')
    const asked = await executeTool(ctx, agent, 'swarm_ask_user', { swarmId: 's', question: 'proceed?' }, 'ask')
    if (asked.isError) throw new Error('expected swarm_ask_user value')

    const model = panelOf(ctx, agent)
    expect(model).not.toBeNull()
    const swarm = model?.s
    expect(swarm).toBeDefined()
    expect(swarm?.topologyMode).toBe('peer')
    expect(swarm?.terminated).toBe(false)
    expect(swarm?.messageCount).toBe(1)
    expect(swarm?.lastSpeaker).toBe('orchestrator')
    expect(swarm?.flow).toEqual([
      expect.objectContaining({
        from: 'orchestrator',
        to: 'planner',
        content: 'plan this',
        attribution: 'orchestrator',
      }),
    ])
    expect(swarm?.roles.map(role => [role.roleName, role.childId, role.status])).toEqual([
      ['planner', 'child-1', 'running'],
      ['coder', 'child-2', 'running'],
    ])
    expect(swarm?.context).toEqual({ phase: 'planning' })
    expect(swarm?.latestCheckpointAt).toBeDefined()
    // The answered request settled: nothing pending remains.
    expect(swarm?.pendingHitl).toEqual([])

    // Every emitted change carried the schema-validated whole value (snapshot
    // and feed share the parse path; a malformed unit would have thrown).
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.at(-1)?.s?.messageCount).toBe(1)
  })

  it('shows a pending HITL request while the operator has not answered', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-panel-hitl-'))
    roots.push(root)
    const ctx = await harness(root)
    mockSpawn(ctx, ['child-1'])
    mockFollowup(ctx)
    let resolveAnswer!: () => void
    ctx.userQuestions.registerProvider({
      ask: request => new Promise((resolve) => {
        resolveAnswer = () => {
          resolve({ answers: request.questions.map(question => ({ id: question.id, selected: [], custom: 'go' })) })
        }
      }),
    })

    const root_ = await ctx.agents.create({ sessionId: SessionId('panel-hitl-root') })
    const agent = root_.agent
    await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn')
    const pending = executeTool(ctx, agent, 'swarm_ask_user', { swarmId: 's', question: 'hold on?' }, 'ask')
    await vi.waitFor(() => {
      expect(panelOf(ctx, agent)?.s?.pendingHitl).toEqual([
        expect.objectContaining({ requestId: 'hitl-1', question: 'hold on?' }),
      ])
    })

    resolveAnswer()
    await pending
    await vi.waitFor(() => {
      expect(panelOf(ctx, agent)?.s?.pendingHitl).toEqual([])
    })
  })
})
