/**
 * Lightweight memory: lexical scoring (unit), write/query tools over the
 * event fold, the fold-layer view cap, cold-resume retention, and config
 * validation. Children are mocked at the `ctx.subagents` seam.
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
import * as agentSwarm from '../src/index.ts'
import { queryMemories, scoreMemory, tokenize } from '../src/memory.ts'
import type { SwarmMemoryEntry } from '../src/types.ts'

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

/** All child ids accept followups. */
function mockFollowup(ctx: Context): void {
  let count = 0
  vi.spyOn(ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt).mockImplementation(
    (_parent: Agent, _childId: SessionId, _content: ContentBlock[], _source: MessageSource, _signal: AbortSignal) => {
      count += 1
      return Promise.resolve(MessageId(`accepted-${count}`))
    },
  )
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

interface QueryValue {
  readonly swarmId: string
  readonly query: string
  readonly entries: Array<{ id: string; text: string; score: number; tags?: string[] }>
}

/** Execute swarm_memory_query and unwrap its success value. */
async function query(ctx: Context, agent: Agent, args: Record<string, unknown>, callId: string): Promise<QueryValue> {
  const result = await executeTool(ctx, agent, 'swarm_memory_query', args, callId)
  if (result.isError) throw new Error('expected swarm_memory_query value')
  const value = result.value as QueryValue & { code?: string; message?: string }
  expect(value.code, value.message).toBeUndefined()
  return value
}

/** Boot one swarm with a single mocked role. */
async function bootSwarm(ctx: Context, sessionId: string): Promise<Agent> {
  const root = await ctx.agents.create({ sessionId: SessionId(sessionId) })
  mockSpawn(ctx, ['child-1'])
  mockFollowup(ctx)
  await executeTool(ctx, root.agent, 'swarm_spawn', { swarmId: 's', roleName: 'worker' }, 'spawn')
  return root.agent
}

describe('memory scoring (pure)', () => {
  const entry = (text: string, tags?: string[]): SwarmMemoryEntry => ({
    id: 'mem-1',
    text,
    by: 'orchestrator',
    writtenAt: '2026-01-01T00:00:00Z',
    ...(tags !== undefined ? { tags } : {}),
  })

  it('tokenizes to distinct lowercase word terms', () => {
    expect(tokenize('Use REST, use rest! 使用中文')).toEqual(['use', 'rest', '使用中文'])
  })

  it('scores text overlap and double-weights tag hits', () => {
    expect(scoreMemory(entry('we chose rest over grpc'), tokenize('rest api'))).toBe(1)
    expect(scoreMemory(entry('unrelated note', ['rest']), tokenize('rest'))).toBe(2)
    expect(scoreMemory(entry('rest note', ['rest']), tokenize('rest'))).toBe(3)
    expect(scoreMemory(entry('nothing here'), tokenize('rest'))).toBe(0)
    expect(scoreMemory(entry('rest'), [])).toBe(0)
  })

  it('ranks by score, breaks ties toward the later write, and respects the limit', () => {
    const entries = [
      { ...entry('rest older'), id: 'mem-1' },
      { ...entry('rest newer'), id: 'mem-2' },
      { ...entry('rest with tag', ['api']), id: 'mem-3' },
    ]
    const hits = queryMemories(entries, 'rest api', 5)
    expect(hits.map(hit => hit.id)).toEqual(['mem-3', 'mem-2', 'mem-1'])
    // All three score 1 on 'rest' (mem-3's tag is 'api'); ties favor the later write.
    expect(queryMemories(entries, 'rest', 2).map(hit => hit.id)).toEqual(['mem-3', 'mem-2'])
    expect(queryMemories(entries, 'absent', 5)).toEqual([])
  })
})

describe('memory tools', () => {
  it('writes entries with stable ids and logs every write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-mem-'))
    roots.push(root)
    const ctx = await harness(root)
    const agent = await bootSwarm(ctx, 'swarm-mem-root')

    const first = await executeTool(ctx, agent, 'swarm_memory_write', {
      swarmId: 's', text: 'We chose REST over gRPC for the public API.', tags: ['api', 'decision'],
    }, 'write-1')
    const second = await executeTool(ctx, agent, 'swarm_memory_write', {
      swarmId: 's', text: 'PostgreSQL is the primary store.', by: 'worker',
    }, 'write-2')
    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(first.value).toEqual({ swarmId: 's', id: 'mem-1' })
    expect(second.value).toEqual({ swarmId: 's', id: 'mem-2' })

    const writes = agent.session.snapshotEvents().filter(event => event.type === 'swarm/memory-written')
    expect(writes).toHaveLength(2)
    expect(writes[0]?.data).toMatchObject({ swarmId: 's', id: 'mem-1', by: 'orchestrator', tags: ['api', 'decision'] })
    expect(writes[1]?.data).toMatchObject({ id: 'mem-2', by: 'worker' })
  })

  it('queries the fold with ranking, default limit, and tag boost', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-mem-query-'))
    roots.push(root)
    const ctx = await harness(root, { memory: { queryLimit: 2 } })
    const agent = await bootSwarm(ctx, 'swarm-mem-query-root')

    for (const [index, text] of [
      'REST was chosen for the public API.',
      'gRPC is internal-only.',
      'The API rate limit is 100 rps.',
    ].entries()) {
      await executeTool(ctx, agent, 'swarm_memory_write', { swarmId: 's', text }, `write-${index}`)
    }

    // Deployment default limit (2) applies when `limit` is omitted; the tagged
    // entry would outrank — here pure text overlap: "api" hits entries 1 and 3.
    const api = await query(ctx, agent, { swarmId: 's', query: 'api' }, 'query-api')
    expect(api.entries.map(entry => entry.id)).toEqual(['mem-3', 'mem-1'])
    expect(api.entries[0]?.score).toBe(1)

    const grpc = await query(ctx, agent, { swarmId: 's', query: 'grpc', limit: 1 }, 'query-grpc')
    expect(grpc.entries.map(entry => entry.id)).toEqual(['mem-2'])
  })

  it('rejects invalid arguments and unknown swarms', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-mem-invalid-'))
    roots.push(root)
    const ctx = await harness(root)
    const agent = await bootSwarm(ctx, 'swarm-mem-invalid-root')

    const emptyText = await executeTool(ctx, agent, 'swarm_memory_write', { swarmId: 's', text: '  ' }, 'bad-write')
    expect((emptyText.value as { code: string }).code).toBe('invalid_argument')
    const emptyQuery = await executeTool(ctx, agent, 'swarm_memory_query', { swarmId: 's', query: '' }, 'bad-query')
    expect((emptyQuery.value as { code: string }).code).toBe('invalid_argument')
    const badLimit = await executeTool(ctx, agent, 'swarm_memory_query', { swarmId: 's', query: 'x', limit: 0 }, 'bad-limit')
    expect((badLimit.value as { code: string }).code).toBe('invalid_argument')
    const unknown = await executeTool(ctx, agent, 'swarm_memory_query', { swarmId: 'ghost', query: 'x' }, 'unknown')
    expect((unknown.value as { code: string }).code).toBe('not_found')
  })

  it('caps the query-visible fold view at memory.maxEntries (latest entries win)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-mem-cap-'))
    roots.push(root)
    const ctx = await harness(root, { memory: { maxEntries: 2, queryLimit: 10 } })
    const agent = await bootSwarm(ctx, 'swarm-mem-cap-root')

    for (const [index, text] of ['shared fact one', 'shared fact two', 'shared fact three'].entries()) {
      await executeTool(ctx, agent, 'swarm_memory_write', { swarmId: 's', text }, `write-${index}`)
    }
    const hits = await query(ctx, agent, { swarmId: 's', query: 'shared fact' }, 'query')
    // The oldest entry fell out of the fold view; the log still holds it.
    expect(hits.entries.map(entry => entry.id)).toEqual(['mem-3', 'mem-2'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'swarm/memory-written')).toHaveLength(3)
  })

  it('keeps memories across a cold resume (full-log refold)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-mem-resume-'))
    roots.push(root)

    const first = await harness(root)
    const agent = await bootSwarm(first, 'swarm-mem-resume-root')
    await executeTool(first, agent, 'swarm_memory_write', { swarmId: 's', text: 'durable fact alpha' }, 'write-1')
    await executeTool(first, agent, 'swarm_memory_write', { swarmId: 's', text: 'durable fact beta' }, 'write-2')
    await expect(first.sessions.flush(agent.session)).resolves.toBe(true)
    await disposeContext(first)

    const ctx = await harness(root)
    mockFollowup(ctx)
    const sessionId = SessionId('swarm-mem-resume-root')
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

    const hits = await query(ctx, handle.agent, { swarmId: 's', query: 'durable fact' }, 'query-after-resume')
    expect(hits.entries.map(entry => entry.id)).toEqual(['mem-2', 'mem-1'])

    // Ids continue after the pre-restart writes, never colliding.
    const third = await executeTool(ctx, handle.agent, 'swarm_memory_write', { swarmId: 's', text: 'post-resume fact' }, 'write-3')
    expect(third.value).toEqual({ swarmId: 's', id: 'mem-3' })
  })

  it('fails loud on a non-positive memory config at load', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-mem-config-'))
    roots.push(root)
    await expect(harness(root, { memory: { maxEntries: 0 } })).rejects.toThrow('memory.maxEntries must be a positive integer')
    await expect(harness(root, { memory: { queryLimit: 1.5 } })).rejects.toThrow('memory.queryLimit must be a positive integer')
  })
})
