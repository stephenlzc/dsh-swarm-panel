/**
 * Human-in-the-loop: `swarm_ask_user` blocking semantics, humanInputMode
 * gating, interaction with interrupt/terminate, and the pending-HITL fold
 * projection across a cold resume.
 *
 * The operator side is a stub `UserQuestionProvider`; no real UI runs.
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
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import * as agentSwarm from '../src/index.ts'
import { SwarmId } from '../src/index.ts'

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

interface FollowupCall {
  readonly childId: string
  readonly text: string
}

/** Record every followup delivery; all child ids accept. */
function mockFollowup(ctx: Context): FollowupCall[] {
  const calls: FollowupCall[] = []
  vi.spyOn(ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt).mockImplementation(
    (_parent: Agent, childId: SessionId, content: ContentBlock[], _source: MessageSource, _signal: AbortSignal) => {
      const text = content[0]?.type === 'text' ? content[0].text : ''
      calls.push({ childId, text })
      return Promise.resolve(MessageId(`accepted-${calls.length}`))
    },
  )
  return calls
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

/** A manually settled operator answer. */
function deferredAnswer() {
  let resolve!: (answer: AskUserQuestionAnswer) => void
  const promise = new Promise<AskUserQuestionAnswer>((res) => { resolve = res })
  return { promise, resolve }
}

/** Register the stub operator; `ask` produces each request's answer. */
function stubOperator(
  ctx: Context,
  ask: (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(ask)
  // 0.2.0: answerers register on the `user-questions/request` waterfall.
  ctx.on('user-questions/request', request => spy(request))
  return spy
}

/** Answer every question with one custom text. */
function immediateOperator(ctx: Context, text: string): ReturnType<typeof vi.fn> {
  return stubOperator(ctx, request => Promise.resolve({
    answers: request.questions.map(question => ({ id: question.id, selected: [], custom: text })),
  }))
}

describe('swarm_ask_user', () => {
  it('blocks until the operator answers, then returns and routes the answer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-hitl-'))
    roots.push(root)
    const ctx = await harness(root)
    const root_ = await ctx.agents.create({ sessionId: SessionId('swarm-hitl-root') })
    mockSpawn(ctx, ['child-reviewer'])
    const deliveries = mockFollowup(ctx)

    await executeTool(ctx, root_.agent, 'swarm_spawn', { swarmId: 'chat', roleName: 'reviewer' }, 'spawn')

    const operator = deferredAnswer()
    const spy = stubOperator(ctx, () => operator.promise)

    // The tool call stays pending while the operator has not answered.
    const pending = executeTool(ctx, root_.agent, 'swarm_ask_user', {
      swarmId: 'chat', question: 'Ship it?', routeTo: 'reviewer',
    }, 'ask-1')
    await vi.waitFor(() => {
      expect(spy).toHaveBeenCalledOnce()
      expect(root_.agent.session.snapshotEvents().some(event => event.type === 'swarm/hitl-requested')).toBe(true)
    })
    expect(root_.agent.session.snapshotEvents().some(event => event.type === 'swarm/hitl-resolved')).toBe(false)

    operator.resolve({ answers: [{ id: 'hitl-1', selected: [], custom: 'ship it' }] })
    const result = await pending
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected swarm_ask_user value')
    expect(result.value).toEqual({
      swarmId: 'chat', requestId: 'hitl-1', outcome: 'answered', answer: 'ship it', routedTo: 'reviewer',
    })

    // The answer was routed as a message attributed to the human.
    expect(deliveries.at(-1)).toEqual({ childId: 'child-reviewer', text: 'ship it' })
    const routed = root_.agent.session.snapshotEvents()
      .filter(event => event.type === 'swarm/role-message')
      .map(event => event.data as { from: string; to: string; content: string; senderSessionId: string })
    expect(routed).toHaveLength(1)
    expect(routed[0]).toMatchObject({ from: 'human', to: 'reviewer', content: 'ship it', senderSessionId: 'swarm-hitl-root' })

    // The settle was logged.
    const resolved = root_.agent.session.snapshotEvents()
      .filter(event => event.type === 'swarm/hitl-resolved')
      .map(event => event.data as { requestId: string; outcome: string; answer?: string })
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ requestId: 'hitl-1', outcome: 'answered', answer: 'ship it' })
  })

  it('allows asks under humanInputMode ALWAYS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-hitl-always-'))
    roots.push(root)
    const ctx = await harness(root, { humanInputMode: 'ALWAYS' })
    const root_ = await ctx.agents.create({ sessionId: SessionId('swarm-hitl-always-root') })
    mockSpawn(ctx, ['child-1'])
    mockFollowup(ctx)
    immediateOperator(ctx, 'yes')

    await executeTool(ctx, root_.agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn')
    const result = await executeTool(ctx, root_.agent, 'swarm_ask_user', { swarmId: 's', question: 'continue?' }, 'ask')
    if (result.isError) throw new Error('expected swarm_ask_user value')
    expect(result.value).toMatchObject({ outcome: 'answered', answer: 'yes' })
  })

  it('fails with unavailable under humanInputMode NEVER and logs nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-hitl-never-'))
    roots.push(root)
    const ctx = await harness(root, { humanInputMode: 'NEVER' })
    const root_ = await ctx.agents.create({ sessionId: SessionId('swarm-hitl-never-root') })
    mockSpawn(ctx, ['child-1'])
    mockFollowup(ctx)
    const spy = immediateOperator(ctx, 'yes')

    await executeTool(ctx, root_.agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn')
    const result = await executeTool(ctx, root_.agent, 'swarm_ask_user', { swarmId: 's', question: 'continue?' }, 'ask')
    if (result.isError) throw new Error('expected swarm_ask_user error value')
    expect((result.value as { code: string }).code).toBe('unavailable')
    expect(spy).not.toHaveBeenCalled()
    expect(root_.agent.session.snapshotEvents().some(event => event.type.startsWith('swarm/hitl-'))).toBe(false)
  })

  it('rejects an unknown humanInputMode at load', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-bad-hitl-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(UserQuestionService)
    await expect(
      ctx.plugin(agentSwarm, { humanInputMode: 'SOMETIMES' as 'ALWAYS' }),
    ).rejects.toThrow(/humanInputMode/)
  })

  it('interrupting roles does not cancel a pending ask; terminating the swarm does', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-hitl-cancel-'))
    roots.push(root)
    const ctx = await harness(root)
    const root_ = await ctx.agents.create({ sessionId: SessionId('swarm-hitl-cancel-root') })
    mockSpawn(ctx, ['child-1'])
    mockFollowup(ctx)
    // The operator never answers; only cancellation settles the wait.
    stubOperator(ctx, () => new Promise<AskUserQuestionAnswer>(() => {}))

    await executeTool(ctx, root_.agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn')
    const pending = executeTool(ctx, root_.agent, 'swarm_ask_user', { swarmId: 's', question: 'hold on?' }, 'ask')
    await vi.waitFor(() => {
      expect(root_.agent.session.snapshotEvents().some(event => event.type === 'swarm/hitl-requested')).toBe(true)
    })

    // Role interrupts are role-level: the swarm-level ask stays pending.
    await executeTool(ctx, root_.agent, 'swarm_interrupt', { swarmId: 's' }, 'interrupt')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(root_.agent.session.snapshotEvents().some(event => event.type === 'swarm/hitl-resolved')).toBe(false)

    // Termination cancels the wait and the cancellation is logged.
    await executeTool(ctx, root_.agent, 'swarm_terminate', { swarmId: 's' }, 'terminate')
    const result = await pending
    if (result.isError) throw new Error('expected swarm_ask_user value')
    expect(result.value).toMatchObject({ requestId: 'hitl-1', outcome: 'cancelled' })
    expect(result.value).not.toHaveProperty('answer')

    const resolved = root_.agent.session.snapshotEvents()
      .filter(event => event.type === 'swarm/hitl-resolved')
      .map(event => event.data as { requestId: string; outcome: string })
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ requestId: 'hitl-1', outcome: 'cancelled' })
    expect(root_.agent.session.snapshotEvents().some(event => event.type === 'swarm/destroyed')).toBe(true)
  })

  it('rebuilds the pending-HITL projection after a cold resume and re-asks with a fresh id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-hitl-resume-'))
    roots.push(root)

    // First boot: one running role plus one unanswered operator question.
    const first = await harness(root)
    const root_ = await first.agents.create({ sessionId: SessionId('swarm-hitl-root') })
    mockSpawn(first, ['child-alpha'])
    mockFollowup(first)
    await executeTool(first, root_.agent, 'swarm_spawn', { swarmId: 'chat', roleName: 'alpha' }, 'spawn')
    root_.agent.session.append('swarm/hitl-requested', {
      swarmId: SwarmId('chat'),
      requestId: 'hitl-1',
      question: 'Proceed with the rewrite?',
      requestedAt: new Date().toISOString(),
    })
    await expect(first.sessions.flush(root_.agent.session)).resolves.toBe(true)
    await disposeContext(first)

    // Second boot: the swarm resumes; the unanswered question is a projection fact.
    const ctx = await harness(root)
    mockFollowup(ctx)
    immediateOperator(ctx, 'go ahead')
    const sessionId = SessionId('swarm-hitl-root')
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

    const list = await executeTool(ctx, handle.agent, 'swarm_list_children', { swarmId: 'chat' }, 'list')
    if (list.isError) throw new Error('expected swarm_list_children value')
    expect((list.value as { pendingHitl: Array<{ requestId: string; question: string }> }).pendingHitl)
      .toEqual([expect.objectContaining({ requestId: 'hitl-1', question: 'Proceed with the rewrite?' })])

    // Re-asking after the restart never collides with the crashed request id.
    const again = await executeTool(ctx, handle.agent, 'swarm_ask_user', { swarmId: 'chat', question: 'Proceed now?' }, 'ask-again')
    if (again.isError) throw new Error('expected swarm_ask_user value')
    expect(again.value).toMatchObject({ requestId: 'hitl-2', outcome: 'answered', answer: 'go ahead' })
  })
})
