/**
 * G4 adversarial probe 2: real-stack concurrency, terminate/spawn interactions,
 * and post-terminate HITL. Read-only w.r.t. the repo (imports /tmp/tc/plugin/src).
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

function chatAdapter(): MockAdapter {
  const entry = (options: GenerateOptions) => {
    const speaker = /You are "([^"]+)"\. Speak to the group/.exec(requestText(options))?.[1]
    if (speaker === undefined) return textResponse('ok')
    return textResponse(speaker + ' speaks')
  }
  return new MockAdapter(Array.from({ length: 400 }, () => entry))
}

async function chatHarness(root: string, adapter: MockAdapter, config?: agentSwarm.Config): Promise<Context> {
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

async function lightHarness(root: string, config?: agentSwarm.Config): Promise<Context> {
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

function executeTool(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>, callId: string, signal?: AbortSignal) {
  return ctx.tools.execute({ signal: signal ?? new AbortController().signal, callId: ToolCallId(callId), name, arguments: args, agent })
}

function mockSpawn(ctx: Context, childIds: readonly string[]): void {
  let next = 0
  vi.spyOn(ctx.subagents, 'startContinuable').mockImplementation(() => {
    const childId = childIds[next]
    next += 1
    if (childId === undefined) return Promise.reject(new Error('unexpected extra spawn'))
    return Promise.resolve({ childId: SessionId(childId), messageId: MessageId('spawn-' + childId) })
  })
}

function mockFollowup(ctx: Context): Array<{ childId: string; text: string }> {
  const calls: Array<{ childId: string; text: string }> = []
  vi.spyOn(ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt).mockImplementation(
    (_p: Agent, childId: SessionId, content: ContentBlock[], _s: MessageSource, _sig: AbortSignal) => {
      const text = content[0]?.type === 'text' ? content[0].text : ''
      calls.push({ childId, text })
      return Promise.resolve(MessageId('accepted-' + calls.length))
    },
  )
  return calls
}

function stubOperator(ctx: Context, ask: (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>): void {
  ctx.on('user-questions/request', (request: AskUserQuestionRequest) => ask(request))
}

function eventTypes(agent: Agent): string[] {
  return agent.session.snapshotEvents().map(e => e.type)
}

async function settleRoles(ctx: Context, agent: Agent, swarmId: string, callId: string): Promise<void> {
  const list = await executeTool(ctx, agent, 'swarm_list_children', { swarmId }, callId)
  if (list.isError) throw new Error('expected swarm_list_children value')
  const roles = (list.value as { roles: Array<{ childId: string; status: string }> }).roles
  for (const role of roles.filter(r => r.status === 'running')) {
    const child = ctx.agents.get(SessionId(role.childId))
    if (child !== undefined) await child.whenIdle()
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('probe: concurrent swarm_next_turn is not serialized', () => {
  it('two parallel swarm_next_turn calls pick the same speaker from the same fold', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-race-'))
    roots.push(root)
    const ctx = await chatHarness(root, chatAdapter())
    const created = await ctx.agents.create({ sessionId: SessionId('adv-race-root'), agentOptions: { provider: 'mock', model: 'mock' } })
    const agent = created.agent
    for (const roleName of ['alpha', 'beta']) {
      const spawned = await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 'sw', roleName }, 'spawn-' + roleName)
      expect(spawned.isError).toBe(false)
    }
    await settleRoles(ctx, agent, 'sw', 'settle')
    const started = await executeTool(ctx, agent, 'swarm_start_chat', { swarmId: 'sw', topic: 'T', speakerSelection: 'round_robin' }, 'start')
    expect(started.isError).toBe(false)

    // Control: strictly sequential calls alternate speakers.
    const seq1 = await executeTool(ctx, agent, 'swarm_next_turn', { swarmId: 'sw' }, 'seq-1')
    const seq2 = await executeTool(ctx, agent, 'swarm_next_turn', { swarmId: 'sw' }, 'seq-2')
    const sequential = [
      ...(seq1.value as { turns: Array<{ speaker: string }> }).turns.map(t => t.speaker),
      ...(seq2.value as { turns: Array<{ speaker: string }> }).turns.map(t => t.speaker),
    ]

    // Racing: both calls fold the same pre-state before either records a group message.
    const [par1, par2] = await Promise.all([
      executeTool(ctx, agent, 'swarm_next_turn', { swarmId: 'sw' }, 'par-1'),
      executeTool(ctx, agent, 'swarm_next_turn', { swarmId: 'sw' }, 'par-2'),
    ])
    const parallel = [
      ...(par1.value as { turns: Array<{ speaker: string; reply: string }> }).turns.map(t => t.speaker + ':' + t.reply),
      ...(par2.value as { turns: Array<{ speaker: string; reply: string }> }).turns.map(t => t.speaker + ':' + t.reply),
    ]
    console.log('SEQUENTIAL speakers =', JSON.stringify(sequential))
    console.log('PARALLEL  speakers =', JSON.stringify(parallel))
    console.log('group transcript =', JSON.stringify(
      agent.session.snapshotEvents()
        .filter(e => e.type === 'swarm/role-message')
        .map(e => (e.data as { to: string; from: string }).to === 'group' ? (e.data as { from: string }).from : null)
        .filter(Boolean),
    ))
    expect(sequential).toEqual(['alpha', 'beta'])
  })
})

describe('probe: spawn vs terminate lifecycle', () => {
  it('re-spawning a live role never interrupts the replaced child', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-respawn-'))
    roots.push(root)
    const ctx = await lightHarness(root)
    const created = await ctx.agents.create({ sessionId: SessionId('adv-respawn-root') })
    const agent = created.agent
    mockSpawn(ctx, ['c1', 'c2'])
    mockFollowup(ctx)
    const interruptSpy = vi.spyOn(ctx.subagents, 'interrupt')

    await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn-1')
    const second = await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn-2')
    console.log('re-spawn value =', JSON.stringify(second.value))
    console.log('interrupt calls after re-spawn =', JSON.stringify(interruptSpy.mock.calls.map(c => String(c[0]))))
    const terminated = await executeTool(ctx, agent, 'swarm_terminate', { swarmId: 's' }, 'term')
    console.log('terminate value =', JSON.stringify(terminated.value))
    console.log('interrupt calls after terminate =', JSON.stringify(interruptSpy.mock.calls.map(c => String(c[0]))))
  })

  it('spawning into a terminated swarm succeeds and leaves a live child', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-postterm-spawn-'))
    roots.push(root)
    const ctx = await lightHarness(root)
    const created = await ctx.agents.create({ sessionId: SessionId('adv-postterm-root') })
    const agent = created.agent
    mockSpawn(ctx, ['c1', 'c2'])
    mockFollowup(ctx)
    const interruptSpy = vi.spyOn(ctx.subagents, 'interrupt')

    await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn-1')
    await executeTool(ctx, agent, 'swarm_terminate', { swarmId: 's' }, 'term')
    const after = await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'reborn' }, 'spawn-2')
    console.log('spawn-after-terminate isError =', after.isError, 'value =', JSON.stringify(after.value))
    const list = await executeTool(ctx, agent, 'swarm_list_children', { swarmId: 's' }, 'list')
    console.log('list after terminate+spawn =', JSON.stringify(list.value))
    console.log('event tail =', JSON.stringify(eventTypes(agent).slice(-5)))
    console.log('interrupt calls =', JSON.stringify(interruptSpy.mock.calls.map(c => String(c[0]))))

    // Is the orphan reachable afterwards? A chat turn can still drive it.
    const chat = await executeTool(ctx, agent, 'swarm_start_chat', { swarmId: 's', topic: 'T' }, 'start')
    console.log('start_chat after terminate =', JSON.stringify(chat.value))
    const turn = await executeTool(ctx, agent, 'swarm_next_turn', { swarmId: 's' }, 'turn')
    console.log('next_turn after terminate =', JSON.stringify(turn.value))
  })
})

describe('probe: terminate is not exception-safe', () => {
  it('a throwing subagents.interrupt leaves the swarm un-terminated', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-term-throw-'))
    roots.push(root)
    const ctx = await lightHarness(root)
    const created = await ctx.agents.create({ sessionId: SessionId('adv-term-throw-root') })
    const agent = created.agent
    mockSpawn(ctx, ['c1'])
    mockFollowup(ctx)
    await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn')
    vi.spyOn(ctx.subagents, 'interrupt').mockImplementation(() => { throw new Error('UNAUTHORIZED: simulated harness refusal') })

    const terminated = await executeTool(ctx, agent, 'swarm_terminate', { swarmId: 's' }, 'term')
    console.log('terminate result isError =', terminated.isError, 'value =', JSON.stringify(terminated.value))
    const list = await executeTool(ctx, agent, 'swarm_list_children', { swarmId: 's' }, 'list')
    console.log('roles after failed terminate =', JSON.stringify((list.value as { roles: unknown }).roles))
    console.log('swarm/destroyed present =', eventTypes(agent).includes('swarm/destroyed'))
    const chat = await executeTool(ctx, agent, 'swarm_start_chat', { swarmId: 's', topic: 'T' }, 'start')
    console.log('start_chat after failed terminate =', JSON.stringify(chat.value))
  })
})

describe('probe: HITL after termination', () => {
  it('swarm_ask_user after swarm_terminate logs a request that nothing can cancel', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-hitl-postterm-'))
    roots.push(root)
    const ctx = await lightHarness(root)
    const created = await ctx.agents.create({ sessionId: SessionId('adv-hitl-postterm-root') })
    const agent = created.agent
    mockSpawn(ctx, ['c1'])
    mockFollowup(ctx)
    stubOperator(ctx, () => new Promise<AskUserQuestionAnswer>(() => {}))

    await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn')
    const terminated = await executeTool(ctx, agent, 'swarm_terminate', { swarmId: 's' }, 'term')
    console.log('terminate =', JSON.stringify(terminated.value))

    const controller = new AbortController()
    const pending = executeTool(ctx, agent, 'swarm_ask_user', { swarmId: 's', question: 'still there?' }, 'ask', controller.signal)
    const outcome = await Promise.race([
      pending.then(r => 'settled:' + JSON.stringify(r.isError ? r.value : r.value)),
      delay(300).then(() => 'still-pending-after-300ms'),
    ])
    console.log('ask after terminate =', outcome)
    console.log('event types tail =', JSON.stringify(eventTypes(agent).slice(-4)))

    // A second terminate cannot cancel it: terminate() early-returns once terminated.
    const again = await executeTool(ctx, agent, 'swarm_terminate', { swarmId: 's' }, 'term-2')
    console.log('second terminate =', JSON.stringify(again.value))
    const outcome2 = await Promise.race([pending.then(() => 'settled'), delay(200).then(() => 'still-pending-after-2nd-terminate')])
    console.log('after second terminate =', outcome2)

    // Only aborting the owning tool call settles it.
    controller.abort()
    const settled = await pending
    console.log('after tool abort =', JSON.stringify(settled.value))
    console.log('hitl events =', JSON.stringify(eventTypes(agent).filter(t => t.startsWith('swarm/hitl'))))
  })
})
