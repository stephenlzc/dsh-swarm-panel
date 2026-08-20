/**
 * Panel projection reducer: event → panel state mapping over synthetic
 * `swarm/*` events, including the same-reference contract for unrelated or
 * no-op events (the registry's change feed fires only on a new reference).
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import { applySwarmPanelEvent, FLOW_WINDOW, type SwarmPanelModel } from '../src/panel-model.ts'
import { SwarmId } from '../src/types.ts'

const SWARM = SwarmId('s1')

/** One full lifecycle log for swarm `s1`, in commit order. */
function lifecycleEvents(): SessionEvent[] {
  return [
    { type: 'swarm/created', seq: 0, time: 1, data: { swarmId: SWARM, createdAt: '2026-01-01T00:00:00Z' } },
    {
      type: 'swarm/role-spawned',
      seq: 1,
      time: 2,
      data: { swarmId: SWARM, roleName: 'planner', childId: SessionId('child-1'), model: { provider: 'mock', model: 'm1' } },
    },
    { type: 'swarm/role-spawned', seq: 2, time: 3, data: { swarmId: SWARM, roleName: 'coder', childId: SessionId('child-2') } },
    { type: 'swarm/topology-changed', seq: 3, time: 4, data: { swarmId: SWARM, mode: 'peer', changedAt: '2026-01-01T00:01:00Z' } },
    {
      type: 'swarm/role-message',
      seq: 4,
      time: 5,
      data: { swarmId: SWARM, from: 'orchestrator', to: 'planner', senderSessionId: SessionId('root'), content: 'plan this', sentAt: '2026-01-01T00:02:00Z' },
    },
    {
      type: 'swarm/role-message',
      seq: 5,
      time: 6,
      data: { swarmId: SWARM, from: 'planner', to: 'group', senderSessionId: SessionId('child-1'), content: 'the plan', sentAt: '2026-01-01T00:03:00Z' },
    },
    {
      type: 'swarm/hitl-requested',
      seq: 6,
      time: 7,
      data: { swarmId: SWARM, requestId: 'hitl-1', question: 'proceed?', requestedAt: '2026-01-01T00:04:00Z' },
    },
    { type: 'swarm/context-updated', seq: 7, time: 8, data: { swarmId: SWARM, key: 'phase', value: 'planning', by: 'orchestrator', updatedAt: '2026-01-01T00:05:00Z' } },
    {
      type: 'swarm/chat-started',
      seq: 8,
      time: 9,
      data: { swarmId: SWARM, topic: 'design', speakerSelection: 'round_robin', maxTurns: 4, startedAt: '2026-01-01T00:06:00Z' },
    },
    {
      type: 'swarm/checkpoint',
      seq: 9,
      time: 10,
      data: {
        swarmId: SWARM,
        version: 1,
        reason: 'auto',
        topologyMode: 'peer',
        roles: [],
        messageCount: 2,
        savedAt: '2026-01-01T00:07:00Z',
      },
    },
    { type: 'swarm/role-exited', seq: 10, time: 11, data: { swarmId: SWARM, roleName: 'coder', childId: SessionId('child-2'), outcome: 'settled', exitedAt: '2026-01-01T00:08:00Z' } },
    { type: 'swarm/chat-ended', seq: 11, time: 12, data: { swarmId: SWARM, reason: 'max-turns', endedAt: '2026-01-01T00:09:00Z' } },
    { type: 'swarm/hitl-resolved', seq: 12, time: 13, data: { swarmId: SWARM, requestId: 'hitl-1', outcome: 'answered', answer: 'yes', resolvedAt: '2026-01-01T00:10:00Z' } },
    { type: 'swarm/destroyed', seq: 13, time: 14, data: { swarmId: SWARM, reason: 'done', destroyedAt: '2026-01-01T00:11:00Z' } },
  ]
}

/** Fold events one by one, returning every intermediate model. */
function foldAll(events: readonly SessionEvent[]): SwarmPanelModel[] {
  const states: SwarmPanelModel[] = []
  let state: SwarmPanelModel = null
  for (const event of events) {
    state = applySwarmPanelEvent(state, event)
    states.push(state)
  }
  return states
}

describe('applySwarmPanelEvent', () => {
  it('returns the same reference for events outside the swarm vocabulary', () => {
    const foreign = { type: 'turn/start', seq: 0, time: 1, data: {} } as unknown as SessionEvent
    expect(applySwarmPanelEvent(null, foreign)).toBeNull()
    const states = foldAll(lifecycleEvents())
    const last = states.at(-1)
    expect(last).not.toBeNull()
    expect(applySwarmPanelEvent(last, foreign)).toBe(last)
  })

  it('folds a full lifecycle into the panel model', () => {
    const model = foldAll(lifecycleEvents()).at(-1)
    expect(model).not.toBeNull()
    const swarm = model?.[SWARM as string]
    expect(swarm).toBeDefined()
    expect(swarm?.createdAt).toBe('2026-01-01T00:00:00Z')
    expect(swarm?.topologyMode).toBe('peer')
    expect(swarm?.messageCount).toBe(2)
    expect(swarm?.lastSpeaker).toBe('planner')
    expect(swarm?.roles).toEqual([
      { roleName: 'planner', childId: 'child-1', status: 'running', model: { provider: 'mock', model: 'm1' } },
      { roleName: 'coder', childId: 'child-2', status: 'exited', outcome: 'settled' },
    ])
    // Only the group message reaches the chat transcript; both messages enter flow.
    expect(swarm?.transcript).toEqual([
      { from: 'planner', to: 'group', content: 'the plan', sentAt: '2026-01-01T00:03:00Z' },
    ])
    expect(swarm?.flow).toEqual([
      {
        seq: 4,
        from: 'orchestrator',
        to: 'planner',
        senderSessionId: 'root',
        content: 'plan this',
        sentAt: '2026-01-01T00:02:00Z',
        attribution: 'orchestrator',
      },
      {
        seq: 5,
        from: 'planner',
        to: 'group',
        senderSessionId: 'child-1',
        content: 'the plan',
        sentAt: '2026-01-01T00:03:00Z',
        attribution: 'peer',
      },
    ])
    expect(swarm?.pendingHitl).toEqual([])
    expect(swarm?.context).toEqual({ phase: 'planning' })
    expect(swarm?.chat).toMatchObject({
      topic: 'design',
      speakerSelection: 'round_robin',
      maxTurns: 4,
      active: false,
      endReason: 'max-turns',
    })
    expect(swarm?.latestCheckpointAt).toBe('2026-01-01T00:07:00Z')
    expect(swarm?.terminated).toBe(true)
    expect(swarm?.destroyReason).toBe('done')
  })

  it('tracks pending HITL between request and resolution', () => {
    const states = foldAll(lifecycleEvents())
    const afterRequest = states[6]?.[SWARM as string]
    expect(afterRequest?.pendingHitl).toEqual([
      { requestId: 'hitl-1', question: 'proceed?', requestedAt: '2026-01-01T00:04:00Z' },
    ])
  })

  it('keeps the same reference when an event changes nothing the panel shows', () => {
    const states = foldAll(lifecycleEvents())
    const last = states.at(-1)
    expect(last).not.toBeNull()
    // hitl-resolved for a request that is not pending.
    const staleResolve: SessionEvent = {
      type: 'swarm/hitl-resolved',
      seq: 14,
      time: 15,
      data: { swarmId: SWARM, requestId: 'hitl-99', outcome: 'cancelled', resolvedAt: '2026-01-01T00:12:00Z' },
    }
    expect(applySwarmPanelEvent(last, staleResolve)).toBe(last)
    // role-exited for a role that was never spawned.
    const lostExit: SessionEvent = {
      type: 'swarm/role-exited',
      seq: 15,
      time: 16,
      data: { swarmId: SWARM, roleName: 'ghost', childId: SessionId('child-9'), outcome: 'error', exitedAt: '2026-01-01T00:13:00Z' },
    }
    expect(applySwarmPanelEvent(last, lostExit)).toBe(last)
    // chat-ended without a chat.
    const created: SessionEvent[] = [{ type: 'swarm/created', seq: 0, time: 1, data: { swarmId: SWARM, createdAt: 't' } }]
    const only = foldAll(created).at(-1)
    const chatEnd: SessionEvent = { type: 'swarm/chat-ended', seq: 1, time: 2, data: { swarmId: SWARM, reason: 'x', endedAt: 't2' } }
    expect(applySwarmPanelEvent(only, chatEnd)).toBe(only)
  })

  it('points resumed roles at their post-resume child sessions', () => {
    const states = foldAll(lifecycleEvents())
    const last = states.at(-1)
    const resumed: SessionEvent = {
      type: 'swarm/resumed',
      seq: 14,
      time: 15,
      data: {
        swarmId: SWARM,
        roles: [
          { roleName: 'planner', childId: SessionId('child-1'), action: 'resumed' },
          { roleName: 'coder', childId: SessionId('child-2b'), action: 'respawned' },
        ],
        fromCheckpoint: '2026-01-01T00:07:00Z',
        resumedAt: '2026-01-01T01:00:00Z',
      },
    }
    const next = applySwarmPanelEvent(last, resumed)
    const swarm = next?.[SWARM as string]
    expect(swarm?.lastResumedAt).toBe('2026-01-01T01:00:00Z')
    expect(swarm?.roles.map(role => [role.roleName, role.childId, role.status])).toEqual([
      ['planner', 'child-1', 'running'],
      ['coder', 'child-2b', 'running'],
    ])
    // The model override survives the identity change.
    expect(swarm?.roles[0]?.model).toEqual({ provider: 'mock', model: 'm1' })
  })

  it('keys independent swarms separately within one session', () => {
    const other = SwarmId('s2')
    let state: SwarmPanelModel = null
    for (const event of lifecycleEvents()) state = applySwarmPanelEvent(state, event)
    const firstEntry = state?.[SWARM as string]
    state = applySwarmPanelEvent(state, {
      type: 'swarm/created',
      seq: 20,
      time: 21,
      data: { swarmId: other, createdAt: '2026-01-02T00:00:00Z' },
    })
    expect(Object.keys(state ?? {})).toEqual([SWARM as string, other as string])
    const second = state?.[other as string]
    expect(second?.terminated).toBe(false)
    expect(second?.roles).toEqual([])
    // The new swarm's arrival leaves the first swarm's entry untouched.
    expect(state?.[SWARM as string]).toBe(firstEntry)
  })
})

function created(): SessionEvent {
  return { type: 'swarm/created', seq: 0, time: 1, data: { swarmId: SWARM, createdAt: 't0' } }
}

function spawned(seq: number, roleName: string, childId: string): SessionEvent {
  return {
    type: 'swarm/role-spawned',
    seq,
    time: seq,
    data: { swarmId: SWARM, roleName, childId: SessionId(childId) },
  }
}

function message(
  seq: number,
  data: { from: string; to: string; senderSessionId?: string; content?: string; sentAt?: string },
): SessionEvent {
  return {
    type: 'swarm/role-message',
    seq,
    time: seq,
    data: { swarmId: SWARM, ...data },
  }
}

describe('Conversation Flow projection', () => {
  it('attributes a parent-child message when the sender session is not a role child', () => {
    const model = foldAll([
      created(),
      spawned(1, 'planner', 'child-1'),
      message(2, { from: 'orchestrator', to: 'planner', senderSessionId: 'root', content: 'plan this', sentAt: 't1' }),
    ]).at(-1)
    expect(model?.[SWARM as string]?.flow).toEqual([
      expect.objectContaining({ seq: 2, from: 'orchestrator', to: 'planner', attribution: 'orchestrator' }),
    ])
  })

  it('attributes a peer message when the sender session is a role child', () => {
    const model = foldAll([
      created(),
      spawned(1, 'planner', 'child-1'),
      spawned(2, 'coder', 'child-2'),
      message(3, { from: 'planner', to: 'coder', senderSessionId: 'child-1', content: 'draft it', sentAt: 't1' }),
    ]).at(-1)
    expect(model?.[SWARM as string]?.flow).toEqual([
      expect.objectContaining({ seq: 3, from: 'planner', to: 'coder', attribution: 'peer' }),
    ])
  })

  it('keeps mixed topology global while tagging each message by actual attribution', () => {
    const model = foldAll([
      created(),
      spawned(1, 'planner', 'child-1'),
      spawned(2, 'reviewer', 'child-2'),
      { type: 'swarm/topology-changed', seq: 3, time: 3, data: { swarmId: SWARM, mode: 'mixed', changedAt: 't' } },
      message(4, { from: 'orchestrator', to: 'planner', senderSessionId: 'root', content: 'parent path', sentAt: 't1' }),
      message(5, { from: 'planner', to: 'reviewer', senderSessionId: 'child-1', content: 'peer path', sentAt: 't2' }),
    ]).at(-1)
    const swarm = model?.[SWARM as string]
    expect(swarm?.topologyMode).toBe('mixed')
    expect(swarm?.flow.map(entry => [entry.content, entry.attribution])).toEqual([
      ['parent path', 'orchestrator'],
      ['peer path', 'peer'],
    ])
  })

  it('records a group message once in flow and once in transcript', () => {
    const model = foldAll([
      created(),
      spawned(1, 'planner', 'child-1'),
      spawned(2, 'coder', 'child-2'),
      message(3, { from: 'planner', to: 'group', senderSessionId: 'child-1', content: 'hello all', sentAt: 't1' }),
    ]).at(-1)
    const swarm = model?.[SWARM as string]
    expect(swarm?.flow).toHaveLength(1)
    expect(swarm?.flow[0]).toMatchObject({ to: 'group', content: 'hello all', attribution: 'peer' })
    expect(swarm?.transcript).toEqual([
      { from: 'planner', to: 'group', content: 'hello all', sentAt: 't1' },
    ])
  })

  it('treats an unknown sender session as orchestrator attribution and keeps the message', () => {
    const model = foldAll([
      created(),
      spawned(1, 'planner', 'child-1'),
      message(2, { from: 'ghost', to: 'planner', senderSessionId: 'missing-session', content: 'stray', sentAt: 't1' }),
    ]).at(-1)
    expect(model?.[SWARM as string]?.flow).toEqual([
      expect.objectContaining({ from: 'ghost', senderSessionId: 'missing-session', attribution: 'orchestrator' }),
    ])
  })

  it('accepts empty content and a missing senderSessionId without dropping the message', () => {
    const model = foldAll([
      created(),
      spawned(1, 'planner', 'child-1'),
      message(2, { from: 'orchestrator', to: 'planner' }),
    ]).at(-1)
    expect(model?.[SWARM as string]?.flow).toEqual([
      {
        seq: 2,
        from: 'orchestrator',
        to: 'planner',
        senderSessionId: '',
        content: '',
        sentAt: '',
        attribution: 'orchestrator',
      },
    ])
  })

  it('upgrades a late-spawned role child to peer without discarding the earlier message', () => {
    const beforeSpawn = foldAll([
      created(),
      message(1, { from: 'planner', to: 'coder', senderSessionId: 'child-1', content: 'early', sentAt: 't1' }),
    ]).at(-1)
    expect(beforeSpawn?.[SWARM as string]?.flow[0]?.attribution).toBe('orchestrator')
    const afterSpawn = applySwarmPanelEvent(beforeSpawn, spawned(2, 'planner', 'child-1'))
    expect(afterSpawn?.[SWARM as string]?.flow).toEqual([
      expect.objectContaining({ seq: 1, content: 'early', attribution: 'peer' }),
    ])
  })

  it('does not downgrade historical peer attribution after a resume replaces child ids', () => {
    const model = foldAll([
      created(),
      spawned(1, 'planner', 'child-1'),
      spawned(2, 'coder', 'child-2'),
      message(3, { from: 'planner', to: 'coder', senderSessionId: 'child-1', content: 'peer note', sentAt: 't1' }),
      {
        type: 'swarm/resumed',
        seq: 4,
        time: 4,
        data: {
          swarmId: SWARM,
          roles: [
            { roleName: 'planner', childId: SessionId('child-1b'), action: 'respawned' },
            { roleName: 'coder', childId: SessionId('child-2b'), action: 'respawned' },
          ],
          fromCheckpoint: 't0',
          resumedAt: 't2',
        },
      },
    ]).at(-1)
    expect(model?.[SWARM as string]?.flow).toEqual([
      expect.objectContaining({ seq: 3, senderSessionId: 'child-1', attribution: 'peer' }),
    ])
  })

  it('keeps message order across later role-exited events', () => {
    const model = foldAll([
      created(),
      spawned(1, 'planner', 'child-1'),
      spawned(2, 'coder', 'child-2'),
      message(3, { from: 'orchestrator', to: 'planner', senderSessionId: 'root', content: 'one', sentAt: 't1' }),
      message(4, { from: 'planner', to: 'coder', senderSessionId: 'child-1', content: 'two', sentAt: 't2' }),
      {
        type: 'swarm/role-exited',
        seq: 5,
        time: 5,
        data: { swarmId: SWARM, roleName: 'coder', childId: SessionId('child-2'), outcome: 'settled', exitedAt: 't3' },
      },
    ]).at(-1)
    expect(model?.[SWARM as string]?.flow.map(entry => entry.content)).toEqual(['one', 'two'])
  })

  it('caps retained flow messages at FLOW_WINDOW without changing seq identity', () => {
    const events: SessionEvent[] = [created(), spawned(1, 'planner', 'child-1')]
    for (let seq = 2; seq < 2 + FLOW_WINDOW + 5; seq += 1) {
      events.push(message(seq, {
        from: 'orchestrator',
        to: 'planner',
        senderSessionId: 'root',
        content: `m${seq}`,
        sentAt: `t${seq}`,
      }))
    }
    const swarm = foldAll(events).at(-1)?.[SWARM as string]
    expect(swarm?.flow).toHaveLength(FLOW_WINDOW)
    expect(swarm?.flow[0]?.seq).toBe(2 + 5)
    expect(swarm?.flow.at(-1)?.seq).toBe(1 + FLOW_WINDOW + 5)
    expect(swarm?.messageCount).toBe(FLOW_WINDOW + 5)
  })
})
