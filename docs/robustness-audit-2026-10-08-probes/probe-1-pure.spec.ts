/**
 * G4 adversarial probe 1 (pure): projection state schema acceptance, fold vs
 * panel-model divergence, and full-log fold cost. Read-only w.r.t. the repo.
 */
import { describe, expect, it } from 'vitest'
import { apply } from '/tmp/tc/plugin/src/index.ts'
import { applySwarmPanelEvent, FLOW_WINDOW } from '/tmp/tc/plugin/src/panel-model.ts'
import { foldSwarmEvents } from '/tmp/tc/plugin/src/domain.ts'
import { SwarmId } from '/tmp/tc/plugin/src/types.ts'

let clock = 0
function ev(type: string, data: Record<string, unknown>): any {
  clock += 1
  return { type, seq: clock, time: clock, data: { swarmId: 'sw', ...data } }
}

const SEQ = [
  ev('swarm/created', { createdAt: 't0' }),
  ev('swarm/role-spawned', { roleName: 'a', childId: 'c-a', systemPrompt: 'you are a' }),
  ev('swarm/role-spawned', { roleName: 'b', childId: 'c-b', model: { provider: 'p', model: 'm' } }),
  ev('swarm/topology-changed', { mode: 'mixed', changedAt: 't1' }),
  ev('swarm/role-message', { from: 'orchestrator', to: 'a', senderSessionId: 'root', content: 'go', sentAt: 't2' }),
  ev('swarm/role-message', { from: 'a', to: 'b', senderSessionId: 'c-a', content: 'peer msg', sentAt: 't3' }),
  ev('swarm/hitl-requested', { requestId: 'hitl-1', question: 'q?', requestedAt: 't4' }),
  ev('swarm/chat-started', { topic: 'T', speakerSelection: 'round_robin', maxTurns: 4, startedAt: 't5' }),
  ev('swarm/role-message', { from: 'a', to: 'group', senderSessionId: 'c-a', content: 'a speaks', sentAt: 't6' }),
  ev('swarm/context-updated', { key: 'k', value: 'v', by: 'a', updatedAt: 't7' }),
  ev('swarm/memory-written', { id: 'mem-1', text: 'fact', by: 'a', writtenAt: 't8' }),
  ev('swarm/hitl-resolved', { requestId: 'hitl-1', outcome: 'answered', answer: 'yes', resolvedAt: 't9' }),
  ev('swarm/checkpoint', { version: 1, reason: 'auto', topologyMode: 'mixed', roles: [], messageCount: 3, savedAt: 't10' }),
  ev('swarm/role-exited', { roleName: 'a', childId: 'c-a', outcome: 'interrupted', exitedAt: 't11' }),
  ev('swarm/role-spawned', { roleName: 'a', childId: 'c-a2' }),
  ev('swarm/resumed', { roles: [{ roleName: 'a', childId: 'c-a2', action: 'respawned' }], resumedAt: 't12' }),
  ev('swarm/chat-ended', { reason: 'max-round', endedAt: 't13' }),
  ev('swarm/destroyed', { reason: 'done', destroyedAt: 't14' }),
]

function captureUnit(): any {
  let def: any
  const fakeCtx: any = {
    inject: (_deps: string[], cb: (ctx: any) => void) => {
      cb({ sessionProjections: { register: (d: any) => { def = d; return () => {} } } })
    },
    effect: () => () => {},
    on: () => () => {},
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    agents: { roots: () => [] },
  }
  apply(fakeCtx, {})
  return def
}

describe('probe: projection state schema', () => {
  const unit = captureUnit()

  it('accepts the declared init state (null) and an empty record', () => {
    expect(unit).toBeDefined()
    const init = unit.init({ id: 's' }, 0)
    console.log('init state =', JSON.stringify(init))
    for (const candidate of [null, {}, init]) {
      const parsed = unit.stateSchema.safeParse(candidate)
      console.log('stateSchema', JSON.stringify(candidate), '->', parsed.success, parsed.success ? '' : JSON.stringify(parsed.error?.issues?.slice(0, 3)))
    }
    expect(unit.stateSchema.safeParse(null).success).toBe(true)
    expect(unit.stateSchema.safeParse({}).success).toBe(true)
  })

  it('accepts the model produced by the reducer over the full event battery', () => {
    let model = unit.init({ id: 's' }, 0)
    for (const event of SEQ) model = applySwarmPanelEvent(model, event)
    const keys = Object.keys(model ?? {})
    console.log('swarms =', keys, 'swarm keys =', JSON.stringify(Object.keys(model['sw'])))
    const state = unit.stateSchema.safeParse(model)
    console.log('stateSchema(model).success =', state.success)
    if (!state.success) console.log('issues =', JSON.stringify(state.error.issues, null, 2))
    const view = unit.wire.view(model)
    const wire = unit.wire.viewSchema.safeParse(view)
    console.log('viewSchema(view).success =', wire.success)
    if (!wire.success) console.log('wire issues =', JSON.stringify(wire.error.issues, null, 2))
    expect(state.success).toBe(true)
    expect(wire.success).toBe(true)
  })

  it('accepts a state produced only from a partial/legacy event subset', () => {
    for (const subset of [
      [ev('swarm/created', { createdAt: 't' })],
      [ev('swarm/chat-started', { topic: 'T', speakerSelection: 'auto' })],
      [ev('swarm/chat-ended', { reason: 'x' })],
      [ev('swarm/role-exited', { roleName: 'ghost', childId: 'c', outcome: 'error' })],
      [ev('swarm/hitl-resolved', { requestId: 'hitl-9', outcome: 'cancelled' })],
    ]) {
      let model = unit.init({ id: 's' }, 0)
      for (const event of subset) model = applySwarmPanelEvent(model, event)
      const r = unit.stateSchema.safeParse(model)
      console.log('subset', subset[0].type, '->', r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 4)))
    }
  })
})

describe('probe: fold vs panel-model divergence', () => {
  it('reports semantic differences over the full battery', () => {
    const state = foldSwarmEvents(SwarmId('sw'), SEQ, 'mixed')
    let model = applySwarmPanelEvent(null, SEQ[0]!)
    for (const event of SEQ.slice(1)) model = applySwarmPanelEvent(model, event)
    const panel = model!['sw']
    const report = {
      terminated: [state.terminated, panel.terminated],
      topology: [state.topologyMode, panel.topologyMode],
      messageCount: [state.messageCount, panel.messageCount],
      roles: [
        [...state.roles.values()].map(r => [r.roleName, r.status, r.childId]),
        panel.roles.map(r => [r.roleName, r.status, r.childId]),
      ],
      pendingHitl: [state.pendingHitl.map(h => h.requestId), panel.pendingHitl.map(h => h.requestId)],
      chatActive: [state.chat?.active, panel.chat?.active],
      turnCount: [state.chat?.turnCount, panel.transcript.length],
      lastSpeaker: [state.lastSpeaker, panel.lastSpeaker],
      contextEntries: [[...state.context.entries()], Object.entries(panel.context)],
      memories: [state.memories.length, 'n/a'],
      flowLen: [undefined, panel.flow.length],
      attribution: panel.flow.map(f => [f.from, f.to, f.attribution, f.senderSessionId]),
    }
    console.log(JSON.stringify(report, null, 2))
    expect(state.terminated).toBe(panel.terminated)
  })

  it('probe: destroyed while a chat is still active', () => {
    const events = [
      ev('swarm/created', { createdAt: 't' }),
      ev('swarm/chat-started', { topic: 'T', speakerSelection: 'round_robin', startedAt: 't' }),
      ev('swarm/destroyed', { reason: 'r', destroyedAt: 't' }),
    ]
    const state = foldSwarmEvents(SwarmId('sw'), events, 'parent-child')
    let model = applySwarmPanelEvent(null, events[0]!)
    for (const e of events.slice(1)) model = applySwarmPanelEvent(model, e)
    console.log('domain chat.active =', state.chat?.active, '| panel chat.active =', model!['sw'].chat?.active)
  })

  it('probe: duplicate hitl-requested id', () => {
    const events = [
      ev('swarm/created', { createdAt: 't' }),
      ev('swarm/hitl-requested', { requestId: 'hitl-1', question: 'q1', requestedAt: 't' }),
      ev('swarm/hitl-requested', { requestId: 'hitl-1', question: 'q1-again', requestedAt: 't' }),
    ]
    const state = foldSwarmEvents(SwarmId('sw'), events, 'parent-child')
    let model = applySwarmPanelEvent(null, events[0]!)
    for (const e of events.slice(1)) model = applySwarmPanelEvent(model, e)
    console.log('domain pending =', JSON.stringify(state.pendingHitl), '| panel pending =', JSON.stringify(model!['sw'].pendingHitl))
  })

  it('probe: swarm/resumed names a role the fold considers exited', () => {
    const events = [
      ev('swarm/created', { createdAt: 't' }),
      ev('swarm/role-spawned', { roleName: 'a', childId: 'c1' }),
      ev('swarm/role-exited', { roleName: 'a', childId: 'c1', outcome: 'error', exitedAt: 't' }),
      ev('swarm/resumed', { roles: [{ roleName: 'a', childId: 'c1', action: 'resumed' }], resumedAt: 't' }),
    ]
    const state = foldSwarmEvents(SwarmId('sw'), events, 'parent-child')
    let model = applySwarmPanelEvent(null, events[0]!)
    for (const e of events.slice(1)) model = applySwarmPanelEvent(model, e)
    console.log('domain role a =', JSON.stringify(state.roles.get('a')), '| panel role a =', JSON.stringify(model!['sw'].roles))
  })

  it('probe: FLOW_WINDOW truncation vs unbounded transcript', () => {
    const events = [ev('swarm/created', { createdAt: 't' }), ev('swarm/role-spawned', { roleName: 'a', childId: 'c' })]
    for (let i = 0; i < FLOW_WINDOW + 50; i++) {
      events.push(ev('swarm/role-message', { from: 'a', to: 'group', senderSessionId: 'c', content: 'm' + i, sentAt: 't' }))
    }
    const state = foldSwarmEvents(SwarmId('sw'), events, 'parent-child')
    let model = applySwarmPanelEvent(null, events[0]!)
    for (const e of events.slice(1)) model = applySwarmPanelEvent(model, e)
    const panel = model!['sw']
    console.log('domain chat.turnCount =', state.chat?.turnCount, 'transcript =', state.chat?.transcript.length)
    console.log('panel messageCount =', panel.messageCount, 'transcript =', panel.transcript.length, 'flow =', panel.flow.length, 'FLOW_WINDOW =', FLOW_WINDOW)
  })
})
