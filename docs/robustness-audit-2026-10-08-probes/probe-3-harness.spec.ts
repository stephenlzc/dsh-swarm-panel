/**
 * G4 adversarial probe 3: stale turn reply during child maintenance, session
 * readability without the plugin (ignorable/known-set contract), the global
 * event-vocabulary mutation, and full-log fold cost.
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
import { SessionId, KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import { MockAdapter, textResponse } from './mock-adapter.ts'
import * as agentSwarm from '/tmp/tc/plugin/src/index.ts'
import { SwarmRuntime } from '/tmp/tc/plugin/src/runtime.ts'
import { SwarmId } from '/tmp/tc/plugin/src/types.ts'

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

async function chatHarness(root: string, config?: agentSwarm.Config): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['mock'], chatAdapter())
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(SessionQueryEngine)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(agentSwarm, { defaultModel: { provider: 'mock', model: 'mock' }, ...config })
  return ctx
}

function executeTool(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>, callId: string) {
  return ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId(callId), name, arguments: args, agent })
}

async function settleRoles(ctx: Context, agent: Agent, swarmId: string, callId: string): Promise<void> {
  const list = await executeTool(ctx, agent, 'swarm_list_children', { swarmId }, callId)
  const roles = (list.value as { roles: Array<{ childId: string; status: string }> }).roles
  for (const role of roles.filter(r => r.status === 'running')) {
    const child = ctx.agents.get(SessionId(role.childId))
    if (child !== undefined) await child.whenIdle()
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('probe: runTurn while the child is in maintenance', () => {
  it('records the PREVIOUS assistant reply as this turn reply', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-maint-'))
    roots.push(root)
    const ctx = await chatHarness(root)
    const created = await ctx.agents.create({ sessionId: SessionId('adv-maint-root'), agentOptions: { provider: 'mock', model: 'mock' } })
    const agent = created.agent
    const spawned = await executeTool(ctx, agent, 'swarm_spawn', { swarmId: 'sw', roleName: 'alpha' }, 'spawn')
    const childId = (spawned.value as { childId: string }).childId
    await settleRoles(ctx, agent, 'sw', 'settle')
    await executeTool(ctx, agent, 'swarm_start_chat', { swarmId: 'sw', topic: 'T', speakerSelection: 'round_robin' }, 'start')

    const child = ctx.agents.get(SessionId(childId))!
    const assistants = (): string[] => child.session.snapshotEvents()
      .filter(e => e.type === 'assistant/message')
      .map(e => (e.data as { message: { content: Array<{ type: string; text?: string }> } }).message.content.filter(b => b.type === 'text').map(b => b.text ?? '').join(''))
    console.log('assistant messages before the turn =', JSON.stringify(assistants()))
    console.log('child.status (idle-able) =', child.status)

    // Enter the maintenance phase (what auto-compaction does) and hold it open.
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const maintenance = child.runMaintenance(async () => { await gate })
    await delay(50)
    console.log('child.status during maintenance =', child.status)

    const turn = await executeTool(ctx, agent, 'swarm_next_turn', { swarmId: 'sw' }, 'turn')
    console.log('recorded turn =', JSON.stringify(turn.value))
    console.log('group transcript =', JSON.stringify(agent.session.snapshotEvents()
      .filter(e => e.type === 'swarm/role-message' && (e.data as { to: string }).to === 'group')
      .map(e => ({ from: (e.data as { from: string }).from, content: (e.data as { content: string }).content }))))

    release()
    await maintenance
    await child.whenIdle()
    console.log('assistant messages after the real reply =', JSON.stringify(assistants()))
    console.log('recorded turn stays =', JSON.stringify((turn.value as { turns: Array<{ reply: string }> }).turns))
    expect(child.status).toBe('idle')
  })
})

describe('probe: session readability without the plugin', () => {
  it('resuming a session that carries swarm events fails when the plugin is disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-ignorable-'))
    roots.push(root)
    const first = await chatHarness(root)
    const created = await first.agents.create({ sessionId: SessionId('adv-ignorable-root'), agentOptions: { provider: 'mock', model: 'mock' } })
    const spawned = await executeTool(first, created.agent, 'swarm_spawn', { swarmId: 'sw', roleName: 'alpha' }, 'spawn')
    console.log('spawn ok =', spawned.isError === false)
    const raw = created.agent.session.snapshotEvents().find(e => e.type === 'swarm/role-spawned')!
    console.log('raw swarm event envelope =', JSON.stringify(raw))
    console.log('has ignorable field =', Object.hasOwn(raw, 'ignorable'))
    await first.sessions.flush(created.agent.session)
    const index = contexts.indexOf(first)
    if (index >= 0) contexts.splice(index, 1)
    await first.fiber.dispose()

    // Control: WITH the plugin loaded the same session resumes.
    const withPlugin = await chatHarness(root)
    try {
      const resumed = await withPlugin.agents.resume({ resumeSessionId: SessionId('adv-ignorable-root'), agentOptions: { provider: 'mock', model: 'mock' } })
      console.log('resume WITH plugin: ok, events =', resumed.agent.session.snapshotEvents().length)
    } catch (error) {
      console.log('resume WITH plugin FAILED =', String(error))
    }
    const idx2 = contexts.indexOf(withPlugin)
    if (idx2 >= 0) contexts.splice(idx2, 1)
    await withPlugin.fiber.dispose()

    // The failure case: the plugin is present but explicitly disabled.
    const disabled = await chatHarness(root, { enabled: false })
    try {
      const resumed = await disabled.agents.resume({ resumeSessionId: SessionId('adv-ignorable-root'), agentOptions: { provider: 'mock', model: 'mock' } })
      console.log('resume WITH plugin disabled: ok, events =', resumed.agent.session.snapshotEvents().length)
    } catch (error) {
      console.log('resume WITH plugin disabled FAILED =', error instanceof Error ? error.name + ': ' + error.message.slice(0, 300) : String(error))
    }
  }, 60_000)

  it('the plugin mutates the process-global known-event-type set and deletes on unload', () => {
    console.log('before apply: contains swarm/created =', KNOWN_SESSION_EVENT_TYPES.has('swarm/created'))
    let cleanup: any
    const fakeCtx: any = {
      inject: () => {},
      effect: (fn: () => any) => { cleanup = fn(); return () => {} },
      on: () => () => {},
      logger: { warn: () => {}, info: () => {}, error: () => {} },
      agents: { roots: () => [] },
    }
    agentSwarm.apply(fakeCtx, {})
    console.log('after apply: contains swarm/created =', KNOWN_SESSION_EVENT_TYPES.has('swarm/created'), 'size =', KNOWN_SESSION_EVENT_TYPES.size)
    void cleanup()
    console.log('after cleanup: contains swarm/created =', KNOWN_SESSION_EVENT_TYPES.has('swarm/created'))
  })
})

describe('probe: full-log fold cost', () => {
  it('measures state() cost against a long session log', () => {
    const events: any[] = []
    for (let i = 0; i < 200_000; i++) {
      events.push(i % 4 === 0
        ? { type: 'swarm/role-message', seq: i, time: i, data: { swarmId: 's', from: 'a', to: 'b', senderSessionId: 'c', content: 'x', sentAt: 't' } }
        : { type: 'tool/result', seq: i, time: i, data: { callId: 'c' + i } })
    }
    const fakeSession: any = {
      id: 'root',
      append: (type: string, data: unknown) => { events.push({ type, seq: events.length, time: events.length, data }); return events.at(-1) },
      snapshotEvents: () => events,
    }
    const fakeAgent: any = { id: 'root', session: fakeSession }
    const fakeCtx: any = { on: () => () => {}, logger: { warn: () => {} }, subagents: {} }
    const runtime = new SwarmRuntime(fakeCtx, fakeAgent, SwarmId('s'), {
      provider: 'spawn',
      humanInputMode: 'TERMINATE',
      chat: { speakerSelection: 'round_robin', transcriptWindow: 10 },
      memory: { maxEntries: 200, queryLimit: 5 },
    })
    runtime.state()
    const started = performance.now()
    for (let i = 0; i < 20; i++) runtime.state()
    const perCall = (performance.now() - started) / 20
    console.log('log size =', events.length, 'events; state() avg ms =', perCall.toFixed(2))
    const started2 = performance.now()
    for (let i = 0; i < 20; i++) runtime.writeMemory('fact ' + i, 'orchestrator')
    console.log('writeMemory avg ms =', ((performance.now() - started2) / 20).toFixed(2))
    expect(perCall).toBeGreaterThan(0)
  }, 60_000)
})
