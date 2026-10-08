/**
 * Group chat engine: speaker selection strategies, termination conditions,
 * context variables, and engine continuation across a cold resume.
 *
 * Unlike the tool-level specs, these tests run REAL continuable children on the
 * scripted MockAdapter: spawn, followup, turn execution, settlement, and
 * session persistence all execute; only the LLM is scripted. Child replies are
 * derived from the request text (`<role> speaks`), so assertions stay stable no
 * matter how many orchestrator-side turns interleave.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
// 0.2.0: continuable children require the session query service.
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import { MockAdapter, textResponse } from '../../../deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts'
import * as agentSwarm from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Render every text block of one request for pattern extraction. */
function requestText(options: GenerateOptions): string {
  return options.messages
    .flatMap(message => message.content)
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/**
 * Scripted adapter whose group-chat replies name their speaker. Non-chat calls
 * (spawn prompts, orchestrator settlement turns) answer 'ok'.
 */
function chatAdapter(marker?: string): MockAdapter {
  const entry = (options: GenerateOptions) => {
    const speaker = /You are "([^"]+)"\. Speak to the group/.exec(requestText(options))?.[1]
    if (speaker === undefined) return textResponse('ok')
    return textResponse(marker === undefined ? `${speaker} speaks` : `${speaker} says ${marker}`)
  }
  return new MockAdapter(Array.from({ length: 400 }, () => entry))
}

/** Boot the full stack with the scripted adapter as the `mock` provider. */
async function harness(root: string, adapter: MockAdapter, config?: agentSwarm.Config): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(SessionQueryEngine)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(agentSwarm, { defaultModel: { provider: 'mock', model: 'mock' }, ...config })
  return ctx
}

async function disposeContext(ctx: Context): Promise<void> {
  const index = contexts.indexOf(ctx)
  if (index >= 0) contexts.splice(index, 1)
  await ctx.fiber.dispose()
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

/** Await every running role's live child reaching quiescence (initial prompt turn done). */
async function settleRoles(ctx: Context, agent: Agent, swarmId: string, callId: string): Promise<void> {
  const list = await executeTool(ctx, agent, 'swarm_list_children', { swarmId }, callId)
  if (list.isError) throw new Error('expected swarm_list_children value')
  const roles = (list.value as { roles: Array<{ childId: string; status: string }> }).roles
  for (const role of roles.filter(entry => entry.status === 'running')) {
    const child = ctx.agents.get(SessionId(role.childId))
    if (child !== undefined) await child.whenIdle()
  }
}

/** Create the orchestrator (on the mock provider) and spawn three roles. */
async function spawnTrio(ctx: Context, sessionId: string, swarmId: string): Promise<Agent> {
  const root = await ctx.agents.create({
    sessionId: SessionId(sessionId),
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  for (const roleName of ['alpha', 'beta', 'gamma']) {
    const spawned = await executeTool(ctx, root.agent, 'swarm_spawn', { swarmId, roleName }, `spawn-${roleName}`)
    expect(spawned.isError).toBe(false)
  }
  await settleRoles(ctx, root.agent, swarmId, 'settle-after-spawn')
  return root.agent
}

interface TurnValue {
  readonly turns: Array<{ speaker: string; reply: string }>
  readonly ended: boolean
  readonly endReason?: string
}

async function nextTurns(ctx: Context, agent: Agent, swarmId: string, args: Record<string, unknown>, callId: string): Promise<TurnValue> {
  const result = await executeTool(ctx, agent, 'swarm_next_turn', { swarmId, ...args }, callId)
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected swarm_next_turn value')
  const value = result.value as TurnValue & { code?: string; message?: string }
  expect(value.code, value.message).toBeUndefined()
  return value
}

describe('group chat engine', () => {
  it('drives a 3-role round_robin conversation for 6 turns and logs the transcript', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-chat-rr-'))
    roots.push(root)
    const ctx = await harness(root, chatAdapter())
    const agent = await spawnTrio(ctx, 'swarm-chat-root', 'chat')

    const started = await executeTool(ctx, agent, 'swarm_start_chat', {
      swarmId: 'chat', topic: 'API design', speakerSelection: 'round_robin',
    }, 'start')
    expect(started.isError).toBe(false)

    const outcome = await nextTurns(ctx, agent, 'chat', { turns: 6 }, 'turns-6')
    expect(outcome.turns.map(turn => turn.speaker)).toEqual(['alpha', 'beta', 'gamma', 'alpha', 'beta', 'gamma'])
    expect(outcome.turns.map(turn => turn.reply)).toEqual([
      'alpha speaks', 'beta speaks', 'gamma speaks', 'alpha speaks', 'beta speaks', 'gamma speaks',
    ])
    expect(outcome.ended).toBe(false)

    const groupMessages = agent.session.snapshotEvents()
      .filter(event => event.type === 'swarm/role-message')
      .map(event => event.data as { from: string; to: string; content: string })
      .filter(message => message.to === 'group')
    expect(groupMessages).toHaveLength(6)
    expect(groupMessages.at(-1)).toMatchObject({ from: 'gamma', content: 'gamma speaks' })
  })

  it('random selection never repeats the previous speaker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-chat-random-'))
    roots.push(root)
    const ctx = await harness(root, chatAdapter())
    const agent = await spawnTrio(ctx, 'swarm-chat-root', 'chat')

    await executeTool(ctx, agent, 'swarm_start_chat', {
      swarmId: 'chat', topic: 'release plan', speakerSelection: 'random',
    }, 'start')
    const outcome = await nextTurns(ctx, agent, 'chat', { turns: 6 }, 'turns')
    const speakers = outcome.turns.map(turn => turn.speaker)
    for (const [index, speaker] of speakers.entries()) {
      expect(['alpha', 'beta', 'gamma']).toContain(speaker)
      if (index > 0) expect(speaker).not.toBe(speakers[index - 1])
    }
  })

  it('auto selection requires and honors the orchestrator speaker decision', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-chat-auto-'))
    roots.push(root)
    const ctx = await harness(root, chatAdapter())
    const agent = await spawnTrio(ctx, 'swarm-chat-root', 'chat')

    await executeTool(ctx, agent, 'swarm_start_chat', {
      swarmId: 'chat', topic: 'triage', speakerSelection: 'auto',
    }, 'start')

    const undecided = await executeTool(ctx, agent, 'swarm_next_turn', { swarmId: 'chat' }, 'no-speaker')
    if (undecided.isError) throw new Error('expected swarm_next_turn error value')
    expect((undecided.value as { code: string }).code).toBe('invalid_argument')

    const decided = await nextTurns(ctx, agent, 'chat', { speaker: 'beta' }, 'decided')
    expect(decided.turns).toEqual([{ speaker: 'beta', reply: 'beta speaks' }])
  })

  it('manual selection asks the operator for the next speaker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-chat-manual-'))
    roots.push(root)
    const ctx = await harness(root, chatAdapter())
    ctx.on('user-questions/request', request => Promise.resolve({
      answers: request.questions.map(question => ({ id: question.id, selected: ['gamma'] })),
    } satisfies AskUserQuestionAnswer))
    const agent = await spawnTrio(ctx, 'swarm-chat-root', 'chat')

    await executeTool(ctx, agent, 'swarm_start_chat', {
      swarmId: 'chat', topic: 'postmortem', speakerSelection: 'manual',
    }, 'start')
    const outcome = await nextTurns(ctx, agent, 'chat', {}, 'manual-turn')
    expect(outcome.turns).toEqual([{ speaker: 'gamma', reply: 'gamma speaks' }])

    // The operator question and its answer are durable facts.
    const hitl = agent.session.snapshotEvents().filter(event => event.type.startsWith('swarm/hitl-'))
    expect(hitl.map(event => event.type)).toEqual(['swarm/hitl-requested', 'swarm/hitl-resolved'])
  })

  it('maxRounds ends the chat after every active role spoke once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-chat-rounds-'))
    roots.push(root)
    const ctx = await harness(root, chatAdapter(), { humanInputMode: 'NEVER' })
    const agent = await spawnTrio(ctx, 'swarm-chat-root', 'chat')

    await executeTool(ctx, agent, 'swarm_start_chat', {
      swarmId: 'chat', topic: 'standup', maxRounds: 2,
    }, 'start')
    const outcome = await nextTurns(ctx, agent, 'chat', { turns: 10 }, 'many-turns')
    expect(outcome.turns).toHaveLength(6)
    expect(outcome.ended).toBe(true)
    expect(outcome.endReason).toBe('max-round')

    const ended = agent.session.snapshotEvents()
      .filter(event => event.type === 'swarm/chat-ended')
      .map(event => event.data as { reason: string })
    expect(ended).toHaveLength(1)
    expect(ended[0]).toMatchObject({ reason: 'max-round' })
  })

  it('a termination substring in a reply ends the chat', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-chat-done-'))
    roots.push(root)
    const ctx = await harness(root, chatAdapter('DONE'), { humanInputMode: 'NEVER' })
    const agent = await spawnTrio(ctx, 'swarm-chat-root', 'chat')

    await executeTool(ctx, agent, 'swarm_start_chat', {
      swarmId: 'chat', topic: 'vote', terminationMessage: 'DONE',
    }, 'start')
    const outcome = await nextTurns(ctx, agent, 'chat', { turns: 5 }, 'turns')
    expect(outcome.turns).toEqual([{ speaker: 'alpha', reply: 'alpha says DONE' }])
    expect(outcome.endReason).toBe('termination-message')
  })

  it('TERMINATE mode asks the operator before ending on a stop condition', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-chat-confirm-'))
    roots.push(root)
    const ctx = await harness(root, chatAdapter())
    // The provider is single-shot; a mutable answer lets the operator change its mind.
    let operatorAnswer = 'Continue'
    const operator = vi.fn((request: { questions: Array<{ id: string }> }) => Promise.resolve<AskUserQuestionAnswer>({
      answers: request.questions.map(question => ({ id: question.id, selected: [operatorAnswer] })),
    }))
    ctx.on('user-questions/request', request => operator(request))
    const agent = await spawnTrio(ctx, 'swarm-chat-root', 'chat')

    await executeTool(ctx, agent, 'swarm_start_chat', {
      swarmId: 'chat', topic: 'sprint', maxTurns: 2,
    }, 'start')
    // maxTurns hit on the third iteration; the operator says Continue, so the
    // engine takes the turn anyway and this call completes its 3 turns.
    const outcome = await nextTurns(ctx, agent, 'chat', { turns: 3 }, 'turns')
    expect(outcome.turns).toHaveLength(3)
    expect(outcome.ended).toBe(false)
    expect(operator).toHaveBeenCalledOnce()
    expect(agent.session.snapshotEvents().some(event => event.type === 'swarm/chat-ended')).toBe(false)

    // The condition is re-evaluated on the next call; now the operator stops the chat.
    operatorAnswer = 'Terminate'
    const stop = await nextTurns(ctx, agent, 'chat', {}, 'stop-call')
    expect(stop.turns).toHaveLength(0)
    expect(stop.ended).toBe(true)
    expect(stop.endReason).toBe('max-turns')
    expect(operator).toHaveBeenCalledTimes(2)
    expect(agent.session.snapshotEvents().some(event => event.type === 'swarm/chat-ended')).toBe(true)
  })

  it('context variables: written by one role, read by another through the turn prompt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-chat-ctx-'))
    roots.push(root)
    const adapter = chatAdapter()
    const ctx = await harness(root, adapter)
    const agent = await spawnTrio(ctx, 'swarm-chat-root', 'chat')

    await executeTool(ctx, agent, 'swarm_start_chat', { swarmId: 'chat', topic: 'API design' }, 'start')
    await nextTurns(ctx, agent, 'chat', {}, 'turn-1') // alpha speaks

    // alpha's write lands in the log and is readable through the tool.
    const set = await executeTool(ctx, agent, 'swarm_set_context', {
      swarmId: 'chat', key: 'decision', value: 'use REST', by: 'alpha',
    }, 'set-ctx')
    expect(set.isError).toBe(false)
    const get = await executeTool(ctx, agent, 'swarm_get_context', { swarmId: 'chat', key: 'decision' }, 'get-ctx')
    if (get.isError) throw new Error('expected swarm_get_context value')
    expect(get.value).toEqual({ swarmId: 'chat', entries: [{ key: 'decision', value: 'use REST' }] })
    expect(agent.session.snapshotEvents().some(event => event.type === 'swarm/context-updated')).toBe(true)

    // beta's next turn prompt carries alpha's write.
    await nextTurns(ctx, agent, 'chat', {}, 'turn-2')
    const chatRequests = adapter.requests.filter(options => requestText(options).includes('[GROUP CHAT TURN]'))
    const betaPrompt = requestText(chatRequests.at(-1)!)
    expect(betaPrompt).toContain('You are "beta". Speak to the group')
    expect(betaPrompt).toContain('decision = use REST')
    expect(betaPrompt).toContain('alpha: alpha speaks')
  })

  it('continues the engine from lastSpeaker after a cold resume', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-chat-resume-'))
    roots.push(root)

    const first = await harness(root, chatAdapter())
    const agent = await spawnTrio(first, 'swarm-chat-root', 'chat')
    await executeTool(first, agent, 'swarm_start_chat', { swarmId: 'chat', topic: 'migration' }, 'start')
    const before = await nextTurns(first, agent, 'chat', { turns: 2 }, 'turns-before')
    expect(before.turns.map(turn => turn.speaker)).toEqual(['alpha', 'beta'])
    await expect(first.sessions.flush(agent.session)).resolves.toBe(true)
    await disposeContext(first)

    // Second boot over the same persistence root; the children's durable
    // sessions survived, so reactivation cold-resumes them through followup.
    const ctx = await harness(root, chatAdapter())
    const sessionId = SessionId('swarm-chat-root')
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
    // Let the resume-notice turns settle before driving the engine again.
    await settleRoles(ctx, handle.agent, 'chat', 'settle-after-resume')

    // Round-robin continues exactly where the fold left off: beta spoke last.
    const after = await nextTurns(ctx, handle.agent, 'chat', {}, 'turn-after')
    expect(after.turns).toEqual([{ speaker: 'gamma', reply: 'gamma speaks' }])

    const transcript = handle.agent.session.snapshotEvents()
      .filter(event => event.type === 'swarm/role-message')
      .map(event => event.data as { from: string; to: string })
      .filter(message => message.to === 'group')
      .map(message => message.from)
    expect(transcript).toEqual(['alpha', 'beta', 'gamma'])
  }, 20000)
})
