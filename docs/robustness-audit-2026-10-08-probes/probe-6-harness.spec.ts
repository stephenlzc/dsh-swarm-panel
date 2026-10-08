/**
 * G4 adversarial probe 6: variants of "role interrupted mid-turn".
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
import type { ContentBlock, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
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

async function harness(root: string, entries: Array<'hang' | 'hangEmpty' | ((o: GenerateOptions) => StreamChunk[])>): Promise<Context> {
  const adapter = new MockAdapter(Array.from({ length: 200 }, (_v, index) => {
    const entry = entries[index]
    if (entry === 'hang') return 'hang'
    if (entry === 'hangEmpty') return { hangAfter: [] }
    return entry === undefined ? textResponse('ok') : entry
  }))
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

function tool(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>, callId: string, signal?: AbortSignal) {
  return ctx.tools.execute({ signal: signal ?? new AbortController().signal, callId: ToolCallId(callId), name, arguments: args, agent })
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function runVariant(name: string, entries: Array<'hang' | 'hangEmpty'>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'adv-int-' + name + '-'))
  roots.push(root)
  const ctx = await harness(root, entries)
  const created = await ctx.agents.create({ sessionId: SessionId('adv-int-' + name), agentOptions: { provider: 'mock', model: 'mock' } })
  const agent = created.agent
  const spawned = await tool(ctx, agent, 'swarm_spawn', { swarmId: 'sw', roleName: 'alpha' }, 'spawn')
  const childId = (spawned.value as { childId: string }).childId
  const child = ctx.agents.get(SessionId(childId))!
  await child.whenIdle()
  await tool(ctx, agent, 'swarm_start_chat', { swarmId: 'sw', topic: 'T', speakerSelection: 'round_robin' }, 'start')

  const controller = new AbortController()
  const pending = tool(ctx, agent, 'swarm_next_turn', { swarmId: 'sw' }, 'turn', controller.signal)
  await vi.waitFor(() => { expect(child.status).toBe('running') }, { timeout: 2000 })
  await tool(ctx, agent, 'swarm_interrupt', { swarmId: 'sw', roleName: 'alpha' }, 'interrupt')
  const outcome = await Promise.race([
    pending.then(r => 'settled:' + JSON.stringify(r.value)),
    delay(700).then(() => 'still-pending-700ms-after-interrupt'),
  ])
  console.log('[' + name + '] next_turn after interrupt =', outcome)
  const assistants = child.session.snapshotEvents().filter(e => e.type === 'assistant/message').length
  const group = agent.session.snapshotEvents().filter(e => e.type === 'swarm/role-message' && (e.data as { to: string }).to === 'group').length
  console.log('[' + name + '] child assistant messages =', assistants, '| logged group messages =', group)
  controller.abort()
  await pending
}

describe('probe: interrupt mid-turn variants', () => {
  it('hang entry that emits a partial block', async () => { await runVariant('partial', ['ok', 'hang']) }, 30_000)
  it('hang entry that emits nothing', async () => { await runVariant('empty', ['ok', 'hangEmpty']) }, 30_000)
})
