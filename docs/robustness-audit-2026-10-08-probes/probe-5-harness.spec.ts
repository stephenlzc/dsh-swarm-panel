/**
 * G4 adversarial probe 5: interrupt during an in-flight turn, and parallel HITL ids.
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
import type { ContentBlock, GenerateOptions, MessageSource, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { deliverSubagentPrompt, type HostPromptDeliverer } from '@deepseek-ai/dsh-subagent/internal'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { MockAdapter, textResponse } from './mock-adapter.ts'
import * as agentSwarm from '/tmp/tc/plugin/src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function requestText(options: GenerateOptions): string {
  return options.messages.flatMap(m => m.content).filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n')
}

function scriptedAdapter(script: Array<'hang' | 'ok' | ((o: GenerateOptions) => StreamChunk[])>): MockAdapter {
  return new MockAdapter(Array.from({ length: 200 }, (_v, index) => {
    const entry = script[index]
    if (entry === 'hang') return 'hang'
    if (entry === 'ok' || entry === undefined) return textResponse('ok')
    return entry
  }))
}

async function chatHarness(root: string, adapter: MockAdapter): Promise<Context> {
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

function executeTool(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>, callId: string, signal?: AbortSignal) {
  return ctx.tools.execute({ signal: signal ?? new AbortController().signal, callId: ToolCallId(callId), name, arguments: args, agent })
}

function mockSpawn(ctx: Context, childIds: readonly string[]): void {
  let next = 0
  vi.spyOn(ctx.subagents, 'startContinuable').mockImplementation(() => {
    const childId = childIds[next]
    next += 1
    return Promise.resolve({ childId: SessionId(childId!), messageId: MessageId('spawn-' + childId) })
  })
}

function mockFollowup(ctx: Context): void {
  vi.spyOn(ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt)
    .mockResolvedValue(MessageId('accepted'))
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('probe: interrupt during an in-flight turn', () => {
  it('leaves swarm_next_turn pending after the role is interrupted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-int-turn-'))
    roots.push(root)
    // Entry 1 answers the spawn prompt; entry 2 hangs the first group-chat turn.
    const adapter = scriptedAdapter(['ok', 'hang'])
    const ctx = await chatHarness(root, adapter)
    const created = await ctx.agents.create({ sessionId: SessionId('adv-int-turn-root'), agentOptions: { provider: 'mock', model: 'mock' } })
    const agent = created.agent
    const spawned = await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 'sw', roleName: 'alpha' }, 'spawn')
    const childId = (spawned.value as { childId: string }).childId
    const child = ctx.agents.get(SessionId(childId))!
    await child.whenIdle()
    await executeTool(ctx, agent, 'swarm_start_chat', { swarmId: 'sw', topic: 'T', speakerSelection: 'round_robin' }, 'start')

    const controller = new AbortController()
    const pending = executeTool(ctx, agent, 'swarm_next_turn', { swarmId: 'sw' }, 'turn', controller.signal)
    await vi.waitFor(() => { expect(child.status).toBe('running') }, { timeout: 2000 })
    console.log('child status while the turn is in flight =', child.status)

    const interrupted = await executeTool(ctx, agent, 'swarm_interrupt', { swarmId: 'sw', roleName: 'alpha' }, 'interrupt')
    console.log('interrupt =', JSON.stringify(interrupted.value))
    const outcome = await Promise.race([
      pending.then(r => 'settled:' + JSON.stringify(r.isError ? r.value : r.value)),
      delay(600).then(() => 'still-pending-600ms-after-interrupt'),
    ])
    console.log('next_turn after interrupt =', outcome)

    controller.abort()
    const settled = await pending.then(r => 'settled:' + JSON.stringify(r), () => 'rejected').catch(() => 'rejected')
    console.log('after aborting the tool call =', settled)
  }, 30_000)
})

describe('probe: parallel HITL request ids', () => {
  it('two concurrent swarm_ask_user calls get distinct ids', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-hitl-par-'))
    roots.push(root)
    const ctx = await lightHarness(root)
    const created = await ctx.agents.create({ sessionId: SessionId('adv-hitl-par-root') })
    const agent = created.agent
    mockSpawn(ctx, ['c1'])
    mockFollowup(ctx)
    await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'w' }, 'spawn')

    const requests: AskUserQuestionRequest[] = []
    const resolvers: Array<(a: AskUserQuestionAnswer) => void> = []
    ctx.on('user-questions/request', (request: AskUserQuestionRequest) => {
      requests.push(request)
      return new Promise<AskUserQuestionAnswer>(resolve => { resolvers.push(resolve) })
    })

    const first = executeTool(ctx, agent, 'swarm_ask_user', { swarmId: 's', question: 'q1' }, 'ask-1')
    const second = executeTool(ctx, agent, 'swarm_ask_user', { swarmId: 's', question: 'q2' }, 'ask-2')
    await vi.waitFor(() => { expect(requests.length).toBe(2) }, { timeout: 2000 })
    const ids = agent.session.snapshotEvents().filter(e => e.type === 'swarm/hitl-requested')
      .map(e => (e.data as { requestId: string }).requestId)
    console.log('concurrent request ids =', JSON.stringify(ids))
    for (const [index, resolve] of resolvers.entries()) {
      resolve({ answers: [{ id: requests[index]!.questions[0]!.id, selected: [], custom: 'a' + index }] })
    }
    const [r1, r2] = await Promise.all([first, second])
    console.log('answers =', JSON.stringify([r1.value, r2.value]))
  })
})
