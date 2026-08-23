// @vitest-environment jsdom
/**
 * Swarm panel client half: rendering over a stubbed projection feed (the
 * `useProjection('swarm')` seat), Conversation Flow interaction, the
 * open-session verb, and the slot registration the client plugin performs.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement as h } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { SwarmAction, SwarmConversationView, SwarmPanelView, type SwarmActionProps } from '../src/client/SwarmAction.ts'
import * as clientPlugin from '../src/client/index.ts'
import {
  EMPTY_NO_MATCH,
  EMPTY_NO_MESSAGES,
  EMPTY_NO_SWARM,
  EMPTY_PENDING_HITL,
  EMPTY_PROJECTION_ERROR,
  EMPTY_TERMINATED,
  EMPTY_WAITING_PROJECTION,
  elbowPath,
  emptyStateCopy,
  formatUtcOffset,
  roleVisualLabel,
  roleVisualState,
} from '../src/client/flow-model.ts'
import type { SwarmPanelFlowMessage, SwarmPanelModel, SwarmPanelSwarm } from '../src/panel-model.ts'

afterEach(() => { cleanup() })

function flowMessage(overrides: Partial<SwarmPanelFlowMessage> & Pick<SwarmPanelFlowMessage, 'seq' | 'from' | 'to' | 'content'>): SwarmPanelFlowMessage {
  return {
    senderSessionId: '',
    sentAt: '2026-01-01T00:02:00Z',
    attribution: 'orchestrator',
    ...overrides,
  }
}

/** One swarm carrying parent-child, peer, group, human, and HITL rows. */
function fixtureModel(): SwarmPanelModel {
  return {
    s1: {
      swarmId: 's1',
      createdAt: '2026-01-01T00:00:00Z',
      topologyMode: 'mixed',
      terminated: false,
      messageCount: 4,
      lastSpeaker: 'planner',
      roles: [
        { roleName: 'planner', childId: 'child-1', status: 'running', model: { provider: 'mock', model: 'm1' } },
        { roleName: 'coder', childId: 'child-2', status: 'exited', outcome: 'settled' },
        { roleName: 'reviewer', childId: 'child-3', status: 'exited', outcome: 'error' },
      ],
      pendingHitl: [{ requestId: 'hitl-1', question: 'proceed?', requestedAt: '2026-01-01T00:04:00Z' }],
      context: { phase: 'planning' },
      transcript: [
        { from: 'planner', to: 'group', content: 'the plan', sentAt: '2026-01-01T00:03:00Z' },
      ],
      flow: [
        flowMessage({ seq: 10, from: 'orchestrator', to: 'planner', senderSessionId: 'root', content: 'plan this', attribution: 'orchestrator' }),
        flowMessage({ seq: 11, from: 'planner', to: 'coder', senderSessionId: 'child-1', content: 'draft the change', sentAt: '2026-01-01T00:03:00Z', attribution: 'peer' }),
        flowMessage({ seq: 12, from: 'planner', to: 'group', senderSessionId: 'child-1', content: 'the plan', sentAt: '2026-01-01T00:03:30Z', attribution: 'peer' }),
        flowMessage({ seq: 13, from: 'human', to: 'planner', senderSessionId: 'root', content: 'please continue', sentAt: '2026-01-01T00:04:30Z', attribution: 'orchestrator' }),
      ],
      chat: { topic: 'design', speakerSelection: 'round_robin', maxTurns: 4, active: true, startedAt: '2026-01-01T00:06:00Z' },
      latestCheckpointAt: '2026-01-01T00:07:00Z',
    },
  }
}

function swarmOf(model: SwarmPanelModel): SwarmPanelSwarm {
  const swarm = model?.s1
  if (swarm === undefined) throw new Error('fixture missing s1')
  return swarm
}

/** Stub slot-kit props for SwarmAction: the projection feed plus the inject face. */
function propsFor(model: SwarmPanelModel | undefined): { props: SwarmActionProps; onOpenSession: ReturnType<typeof vi.fn> } {
  const onOpenSession = vi.fn()
  const props = {
    sessionId: 's-root',
    useProjection: (key: string) => (key === 'swarm' ? model : undefined),
    onOpenSession,
  } as unknown as SwarmActionProps
  return { props, onOpenSession }
}

describe('SwarmAction', () => {
  it('renders nothing while the session has no swarm', () => {
    for (const model of [undefined, null, {}]) {
      const { props } = propsFor(model)
      const { container, unmount } = render(h(SwarmAction, props))
      expect(container.innerHTML).toBe('')
      unmount()
    }
  })

  it('shows a swarm count without opening a popover', () => {
    const { props } = propsFor(fixtureModel())
    render(h(SwarmAction, props))
    expect(screen.getByLabelText('swarm panel (1 swarm)').textContent).toBe('Swarms: 1')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText('Conversation Flow')).toBeNull()
  })
})

describe('SwarmPanelView', () => {
  it('renders the Conversation Flow page with topology, lanes, routes, HITL, and timeline', () => {
    const onOpenSession = vi.fn()
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession, sessionId: 's-root' }))
    const page = screen.getByLabelText('Conversation Flow')
    expect(page.textContent).toContain('swarm s1')
    expect(page.textContent).toContain('mixed')
    expect(page.textContent).toContain('4 messages')
    expect(page.textContent).toContain('last speaker: planner')
    expect(page.textContent).toContain('chat running, turn 1/4')
    expect(page.textContent).toContain('checkpoint 2026-01-01T00:07:00Z')
    expect(screen.getAllByRole('button', { name: 'planner — Active' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'coder — Completed' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'reviewer — Error' }).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('human — Idle · Waiting')).toBeTruthy()
    expect(page.textContent).toContain('child · Active')
    expect(page.textContent).toContain('parent · Active')
    expect(page.textContent).toContain('Human input required')
    expect(page.textContent).toContain('proceed?')
    expect(page.textContent).toContain('plan this')
    expect(page.textContent).toContain('draft the change')
    expect(page.textContent).toContain('the plan')
    expect(page.textContent).toContain('please continue')
    expect(page.textContent).toContain('parent → child')
    expect(page.textContent).toContain('peer ↔ peer')
    expect(page.textContent).toContain('parent-child 2 · peer 1 · group 1')
    expect(page.textContent).toContain('Legend')
    expect(page.textContent).toContain('Error')
    expect(page.textContent).toContain('Completed')
    expect(page.textContent).toContain('Idle / Waiting')
    expect(onOpenSession).not.toHaveBeenCalled()
    expect(document.querySelector('[data-flow-from="planner"]')).toBeTruthy()
    expect(document.querySelector('[data-flow-from="orchestrator"]')).toBeTruthy()
    expect(document.querySelector('[data-flow-connector="elbow"]')).toBeTruthy()
    expect(document.querySelector('[data-flow-capsule]')).toBeNull()
    expect(document.querySelector('[data-destination-capsule]')).toBeNull()
    const errorDots = [...document.querySelectorAll('[data-role-state="error"]')]
    const completedDots = [...document.querySelectorAll('[data-role-state="completed"]')]
    expect(errorDots.length).toBeGreaterThan(0)
    expect(completedDots.length).toBeGreaterThan(0)
    expect(errorDots[0]?.getAttribute('style')).toContain('--dsw-alias-state-error-primary')
    expect(completedDots[0]?.getAttribute('style')).toContain('--dsw-alias-label-tertiary')
    fireEvent.click(screen.getAllByRole('button', { name: 'planner — Active' })[0]!)
    expect(onOpenSession).toHaveBeenCalledWith('child-1')
  })

  it('marks terminated swarms with their destroy reason', () => {
    const swarm = swarmOf(fixtureModel())
    const terminated: SwarmPanelModel = {
      s1: { ...swarm, terminated: true, destroyReason: 'done', chat: { ...swarm.chat!, active: false, endReason: 'max-turns' } },
    }
    render(h(SwarmPanelView, { model: terminated, onOpenSession: vi.fn() }))
    const page = screen.getByLabelText('Conversation Flow')
    expect(page.textContent).toContain('terminated (done)')
    expect(page.textContent).toContain('chat ended (max-turns), turn 1/4')
  })

  it('renders an empty Conversation Flow page when the session has no swarm', () => {
    render(h(SwarmPanelView, { model: null, onOpenSession: vi.fn() }))
    expect(screen.getByText(EMPTY_NO_SWARM)).toBeTruthy()
  })

  it('renders waiting-projection copy while the host has not pushed a model', () => {
    render(h(SwarmPanelView, { model: undefined, onOpenSession: vi.fn() }))
    expect(screen.getByText(EMPTY_WAITING_PROJECTION)).toBeTruthy()
  })

  it('renders projection-error copy on a client-visible failure', () => {
    render(h(SwarmPanelView, { model: undefined, projectionError: 'schema mismatch', onOpenSession: vi.fn() }))
    expect(screen.getByText(`${EMPTY_PROJECTION_ERROR} schema mismatch`)).toBeTruthy()
  })

  it('renders one section per swarm without the slot kit', () => {
    const model: SwarmPanelModel = {
      ...fixtureModel(),
      s2: {
        swarmId: 's2',
        topologyMode: 'parent-child',
        terminated: false,
        messageCount: 0,
        roles: [],
        pendingHitl: [],
        context: {},
        transcript: [],
        flow: [],
      },
    }
    render(h(SwarmPanelView, { model, onOpenSession: vi.fn() }))
    expect(document.querySelectorAll('[data-swarm-id]').length).toBe(2)
  })

  it('filters by route, agent, and search text, and shows an empty match state', () => {
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession: vi.fn() }))
    fireEvent.click(screen.getByRole('button', { name: 'Parent → Child (2)' }))
    expect(document.querySelectorAll('[data-flow-seq]').length).toBe(2)
    expect(screen.getAllByText('plan this').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Human input (1)' }))
    expect(document.querySelectorAll('[data-flow-seq]').length).toBe(1)
    expect(screen.getAllByText('please continue').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Peer ↔ Peer (1)' }))
    expect(document.querySelectorAll('[data-flow-seq]').length).toBe(1)
    expect(screen.queryAllByText('plan this')).toHaveLength(0)
    expect(screen.getAllByText('draft the change').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    fireEvent.change(screen.getByLabelText('Filter by agent'), { target: { value: 'coder' } })
    expect(document.querySelectorAll('[data-flow-seq]').length).toBe(1)
    expect(screen.getAllByText('draft the change').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Filter by agent'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'please' } })
    expect(document.querySelectorAll('[data-flow-seq]').length).toBe(1)
    expect(screen.getAllByText('please continue').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'no-such-message' } })
    expect(screen.getByText(EMPTY_NO_MATCH)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!)
    expect(document.querySelectorAll('[data-flow-seq]').length).toBe(4)
  })

  it('opens message details with full metadata and session actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const onOpenSession = vi.fn()
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession }))

    fireEvent.click(document.querySelector('[data-flow-seq="11"]')!)
    const details = screen.getByRole('complementary', { name: 'message details' })
    expect(details.textContent).toContain('draft the change')
    expect(details.textContent).toContain('planner (child)')
    expect(details.textContent).toContain('coder (child)')
    expect(details.textContent).toContain('peer ↔ peer')
    expect(details.textContent).toContain('peer')
    expect(details.textContent).toContain('child-1')
    expect(details.textContent).toContain('#11')
    expect(details.textContent).toContain('From')
    expect(details.textContent).toContain('To')
    expect(details.textContent).toContain('Route')
    expect(details.textContent).toContain('Status')
    expect(details.textContent).toContain('Content preview')
    expect(getComputedStyle(details).display).toBe('flex')
    expect(getComputedStyle(details).flexDirection).toBe('column')

    fireEvent.click(screen.getByRole('button', { name: 'Open planner session' }))
    expect(onOpenSession).toHaveBeenCalledWith('child-1')
    fireEvent.click(screen.getByRole('button', { name: 'Open coder session' }))
    expect(onOpenSession).toHaveBeenCalledWith('child-2')

    fireEvent.click(screen.getByRole('button', { name: 'Copy ID' }))
    await act(async () => { await Promise.resolve() })
    expect(writeText).toHaveBeenCalledWith('11')
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    await act(async () => { await Promise.resolve() })
    expect(writeText).toHaveBeenCalledWith('draft the change')
    fireEvent.click(screen.getByRole('button', { name: 'Copy event metadata' }))
    await act(async () => { await Promise.resolve() })
    expect(writeText.mock.calls.at(-1)?.[0]).toContain('"seq": 11')

    fireEvent.click(screen.getByRole('button', { name: 'Close message details' }))
    expect(screen.getByRole('complementary', { name: 'message details' }).textContent)
      .toContain('Select a message to inspect routing, content, and sessions.')
  })

  it('disables session actions for orchestrator, human, group, and unknown agents', () => {
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession: vi.fn() }))
    fireEvent.click(document.querySelector('[data-flow-seq="10"]')!)
    expect((screen.getByRole('button', { name: 'Open orchestrator session' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Open orchestrator session' }).getAttribute('title')).toContain('current session')

    fireEvent.click(document.querySelector('[data-flow-seq="12"]')!)
    expect((screen.getByRole('button', { name: 'Open group session' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(document.querySelector('[data-flow-seq="13"]')!)
    expect((screen.getByRole('button', { name: 'Open human session' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders empty, unknown-agent, and empty-content states without crashing', () => {
    const empty: SwarmPanelModel = {
      s1: {
        swarmId: 's1',
        topologyMode: 'parent-child',
        terminated: false,
        messageCount: 0,
        roles: [],
        pendingHitl: [],
        context: {},
        transcript: [],
        flow: [],
      },
    }
    const { rerender } = render(h(SwarmPanelView, { model: empty, onOpenSession: vi.fn() }))
    expect(screen.getByText(EMPTY_NO_MESSAGES)).toBeTruthy()

    const odd: SwarmPanelModel = {
      s1: {
        ...empty.s1!,
        messageCount: 2,
        flow: [
          flowMessage({ seq: 1, from: '', to: 'ghost', content: '', senderSessionId: '', sentAt: 'not-a-date' }),
          flowMessage({ seq: 2, from: 'ghost', to: 'planner', content: '<>&"\'', senderSessionId: 'missing' }),
        ],
      },
    }
    rerender(h(SwarmPanelView, { model: odd, onOpenSession: vi.fn() }))
    expect(screen.getByText('(empty message)')).toBeTruthy()
    expect(screen.getAllByText('<>&"\'').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('unknown — Idle').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('ghost — Idle').length).toBeGreaterThan(0)
    fireEvent.click(document.querySelector('[data-flow-seq="1"]')!)
    expect(screen.getByRole('complementary', { name: 'message details' }).textContent).toContain('unavailable')
    expect(screen.getByRole('complementary', { name: 'message details' }).textContent).toContain('not-a-date')
  })

  it('pauses live follow on scroll-away and shows a new-message affordance', () => {
    const first = fixtureModel()
    const { rerender } = render(h(SwarmPanelView, { model: first, onOpenSession: vi.fn() }))
    expect(document.querySelector('[data-live="on"]')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Live follow on' }))
    expect(document.querySelector('[data-live="paused"]')).toBeTruthy()

    const grown: SwarmPanelModel = {
      s1: {
        ...swarmOf(first),
        messageCount: 5,
        flow: [
          ...swarmOf(first).flow,
          flowMessage({ seq: 14, from: 'coder', to: 'planner', senderSessionId: 'child-2', content: 'late note', attribution: 'peer' }),
        ],
      },
    }
    rerender(h(SwarmPanelView, { model: grown, onOpenSession: vi.fn() }))
    expect(screen.getByRole('button', { name: '1 new message · resume live' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '1 new message · resume live' }))
    expect(document.querySelector('[data-live="on"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '1 new message · resume live' })).toBeNull()
  })

  it('pauses live follow when the operator scrolls away from the bottom', () => {
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession: vi.fn() }))
    const scroller = document.querySelector('[data-flow-scroller]')
    if (!(scroller instanceof HTMLElement)) throw new Error('missing scroller')
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 800 })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: 0 })
    fireEvent.scroll(scroller)
    expect(document.querySelector('[data-live="paused"]')).toBeTruthy()
  })

  it('navigates filtered messages with arrow keys only while the flow collection is focused', () => {
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession: vi.fn() }))
    const collection = document.querySelector('[data-flow-collection]')
    if (!(collection instanceof HTMLElement)) throw new Error('missing flow collection')
    collection.focus()
    fireEvent.keyDown(collection, { key: 'ArrowDown' })
    expect(document.querySelector('[data-flow-seq="10"]')?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(collection, { key: 'ArrowDown' })
    expect(document.querySelector('[data-flow-seq="11"]')?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(collection, { key: 'ArrowUp' })
    expect(document.querySelector('[data-flow-seq="10"]')?.getAttribute('aria-selected')).toBe('true')
  })

  it('does not steal ArrowUp/Down/Escape from host chrome or window', () => {
    render(h('div', {},
      h('button', { type: 'button', 'aria-label': 'Chat tab' }, 'Chat'),
      h(SwarmPanelView, { model: fixtureModel(), onOpenSession: vi.fn() })))
    const tab = screen.getByRole('button', { name: 'Chat tab' })
    tab.focus()
    const windowEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    const windowSpy = vi.spyOn(windowEvent, 'preventDefault')
    window.dispatchEvent(windowEvent)
    expect(windowSpy).not.toHaveBeenCalled()
    expect(document.querySelector('[data-flow-seq][aria-selected="true"]')).toBeNull()

    const tabEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    const tabSpy = vi.spyOn(tabEvent, 'preventDefault')
    tab.dispatchEvent(tabEvent)
    expect(tabSpy).not.toHaveBeenCalled()
    expect(document.querySelector('[data-flow-seq][aria-selected="true"]')).toBeNull()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Select a message to inspect routing, content, and sessions.')).toBeTruthy()
  })

  it('leaves arrow keys available for text input and exposes full detail content', () => {
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession: vi.fn() }))
    const search = screen.getByLabelText('Search messages')
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.querySelector('[data-flow-seq][aria-selected="true"]')).toBeNull()

    fireEvent.click(document.querySelector('[data-flow-seq="11"]')!)
    const details = screen.getByRole('complementary', { name: 'message details' })
    expect(details.querySelector('[title="draft the change"]')).toBeTruthy()
  })

  it('closes details on Escape from the focused collection and activates a row with keyboard', () => {
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession: vi.fn() }))
    const row = document.querySelector('[data-flow-seq="10"]')
    if (!(row instanceof HTMLElement)) throw new Error('missing row')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByRole('complementary', { name: 'message details' }).textContent).toContain('plan this')
    const collection = document.querySelector('[data-flow-collection]')
    if (!(collection instanceof HTMLElement)) throw new Error('missing flow collection')
    collection.focus()
    fireEvent.keyDown(collection, { key: 'Escape' })
    expect(screen.getByText('Select a message to inspect routing, content, and sessions.')).toBeTruthy()
  })

  it('opens the original swarm session from a pending Human-lane HITL card', () => {
    const onOpenSession = vi.fn()
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession, sessionId: 's-root' }))
    fireEvent.click(screen.getByRole('button', { name: 'Human input pending: proceed?' }))
    expect(onOpenSession).toHaveBeenCalledWith('s-root')
  })

  it('places compact cards in the sender column with solid parent and dashed peer elbows', () => {
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession: vi.fn() }))
    const parent = document.querySelector('[data-flow-seq="10"]')
    const peer = document.querySelector('[data-flow-seq="11"]')
    if (!(parent instanceof HTMLElement) || !(peer instanceof HTMLElement)) throw new Error('missing rows')
    expect(parent.querySelector('[data-flow-connector="elbow"]')).toBeTruthy()
    expect(peer.querySelector('[data-flow-connector="elbow"]')).toBeTruthy()
    const parentPath = parent.querySelector('[data-flow-connector] path:not([d="M 0 0 L 10 5 L 0 10 z"])')
    const peerPath = peer.querySelector('[data-flow-connector] path:not([d="M 0 0 L 10 5 L 0 10 z"])')
    expect(parentPath?.getAttribute('d')).toBe(elbowPath(0, 1))
    expect(parentPath?.getAttribute('stroke-dasharray')).toBeNull()
    expect(peerPath?.getAttribute('stroke-dasharray')).toBe('5 4')
    expect(parent.querySelector('[data-utc-offset]')?.getAttribute('data-utc-offset')).toMatch(/^UTC[+-]\d/)
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull()
    expect(screen.getByText(/visible · .* total/)).toBeTruthy()
    expect(screen.getByText(/First:/)).toBeTruthy()
    expect(screen.getByText(/Last:/)).toBeTruthy()
    expect(screen.getByText(/Duration:/)).toBeTruthy()
    expect(screen.getByText('Auto-scroll')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Live follow on' })).toBeTruthy()
    expect(formatUtcOffset('2026-01-01T00:02:00Z')).toMatch(/^UTC[+-]/)
  })

  it('maps running / waiting / settled / error onto four distinct role labels', () => {
    expect(roleVisualLabel(roleVisualState({ name: 'planner', role: { roleName: 'planner', childId: 'c', status: 'running' } }))).toBe('Active')
    expect(roleVisualLabel(roleVisualState({ name: 'human', pendingHitl: true }), true)).toBe('Idle · Waiting')
    expect(roleVisualLabel(roleVisualState({
      name: 'coder',
      role: { roleName: 'coder', childId: 'c', status: 'exited', outcome: 'settled' },
    }))).toBe('Completed')
    expect(roleVisualLabel(roleVisualState({
      name: 'reviewer',
      role: { roleName: 'reviewer', childId: 'c', status: 'exited', outcome: 'error' },
    }))).toBe('Error')
  })

  it('renders terminated and pending-HITL empty copies', () => {
    const emptyTerminated: SwarmPanelModel = {
      s1: {
        swarmId: 's1',
        topologyMode: 'parent-child',
        terminated: true,
        destroyReason: 'done',
        messageCount: 0,
        roles: [],
        pendingHitl: [],
        context: {},
        transcript: [],
        flow: [],
      },
    }
    const { rerender } = render(h(SwarmPanelView, { model: emptyTerminated, onOpenSession: vi.fn() }))
    expect(screen.getByText(EMPTY_TERMINATED)).toBeTruthy()

    const pendingOnly: SwarmPanelModel = {
      s1: {
        swarmId: 's1',
        topologyMode: 'parent-child',
        terminated: false,
        messageCount: 0,
        roles: [],
        pendingHitl: [{ requestId: 'hitl-2', question: 'approve?', requestedAt: '2026-01-01T00:04:00Z' }],
        context: {},
        transcript: [],
        flow: [],
      },
    }
    rerender(h(SwarmPanelView, { model: pendingOnly, onOpenSession: vi.fn(), sessionId: 's-root' }))
    expect(screen.getByText('Human input required')).toBeTruthy()
    expect(screen.getByText('approve?')).toBeTruthy()
    expect(emptyStateCopy({
      hasSwarm: true,
      terminated: false,
      filteredActive: false,
      messageCount: 0,
      pendingHitl: 1,
    })).toBe(EMPTY_PENDING_HITL)
  })
})

describe('SwarmConversationView', () => {
  it('renders Conversation Flow from the projection kit', () => {
    const onOpenSession = vi.fn()
    const props = {
      sessionId: 's-root',
      useProjection: (key: string) => (key === 'swarm' ? fixtureModel() : undefined),
      onOpenSession,
    } as unknown as Parameters<typeof SwarmConversationView>[0]
    render(h(SwarmConversationView, props))
    expect(screen.getByLabelText('Conversation Flow').textContent).toContain('plan this')
  })
})

describe('client plugin apply', () => {
  it('registers the Conversation Flow tab and the header swarm count', () => {
    const open = vi.fn()
    const injections: string[] = []
    const registrations: { options: Record<string, unknown>; component: unknown }[] = []
    const ctx = {
      sessions: { open },
      slots: {
        inject(name: string, body: () => unknown): void {
          injections.push(name)
          body()
        },
        register(options: Record<string, unknown>, component: unknown): () => void {
          registrations.push({ options, component })
          return () => {}
        },
      },
    } as unknown as ClientContext

    clientPlugin.apply(ctx)

    expect(clientPlugin.inject).toEqual(['sessions', 'slots'])
    expect(injections).toEqual(['conversation.session.header.actions', 'conversation.view'])
    expect(registrations).toHaveLength(2)
    expect(registrations[0]?.options).toMatchObject({
      name: 'conversation.session.header.actions',
      id: 'swarm-panel',
      order: 30,
    })
    expect(registrations[0]?.component).toBe(SwarmAction)
    expect(registrations[1]?.options).toMatchObject({
      name: 'conversation.view',
      id: 'conversation-flow',
      order: 20,
    })
    expect((registrations[1]?.options.label as () => string)()).toBe('Conversation Flow')
    expect(registrations[1]?.component).toBe(SwarmConversationView)

    const injectFactory = registrations[1]?.options.inject as () => { onOpenSession: (childId: string) => void }
    injectFactory().onOpenSession('child-7')
    expect(open).toHaveBeenCalledWith('child-7')
  })

  it('skips every slot registration when client config.enabled === false', () => {
    const open = vi.fn()
    const injections: string[] = []
    const ctx = {
      sessions: { open },
      slots: {
        inject(name: string, body: () => unknown): void {
          injections.push(name)
          body()
        },
        register(): () => void {
          throw new Error('disabled client plugin must not register')
        },
      },
    } as unknown as ClientContext

    clientPlugin.apply(ctx, { enabled: false })

    // Master switch: no slot injection occurs, so the throw-on-register guard
    // is never reached. The header swarm count and Conversation Flow tab both
    // stay absent from the chrome.
    expect(injections).toEqual([])
    expect(clientPlugin.inject).toEqual(['sessions', 'slots'])
  })

  it('defaults to enabled on the client when the config is omitted', () => {
    const injections: string[] = []
    const ctx = {
      sessions: { open: vi.fn() },
      slots: {
        inject(name: string, body: () => unknown): void {
          injections.push(name)
          body()
        },
        register: () => () => {},
      },
    } as unknown as ClientContext

    clientPlugin.apply(ctx)

    expect(injections).toEqual(['conversation.session.header.actions', 'conversation.view'])
  })
})
