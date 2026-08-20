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
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession }))
    const page = screen.getByLabelText('Conversation Flow')
    expect(page.textContent).toContain('swarm s1')
    expect(page.textContent).toContain('mixed')
    expect(page.textContent).toContain('4 messages')
    expect(page.textContent).toContain('last speaker: planner')
    expect(page.textContent).toContain('chat running, turn 1/4')
    expect(page.textContent).toContain('checkpoint 2026-01-01T00:07:00Z')
    expect(screen.getAllByRole('button', { name: 'planner — running' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'coder — exited (settled)' }).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('human — waiting')).toBeTruthy()
    expect(page.textContent).toContain('child · running')
    expect(page.textContent).toContain('parent · running')
    expect(page.textContent).toContain('Human input pending: proceed?')
    expect(page.textContent).toContain('phase: planning')
    expect(page.textContent).toContain('plan this')
    expect(page.textContent).toContain('draft the change')
    expect(page.textContent).toContain('the plan')
    expect(page.textContent).toContain('please continue')
    expect(page.textContent).toContain('parent → child')
    expect(page.textContent).toContain('peer ↔ peer')
    expect(page.textContent).toContain('parent-child 2 · peer 1 · group 1')
    expect(page.textContent).toContain('Legend')
    expect(onOpenSession).not.toHaveBeenCalled()
    expect(document.querySelector('[data-flow-from="planner"]')).toBeTruthy()
    expect(document.querySelector('[data-flow-from="orchestrator"]')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'planner — running' })[0]!)
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
    expect(screen.getByText('No swarm in this session. Ask the Orchestrator to create one and spawn roles.')).toBeTruthy()
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
    expect(screen.getByText('No matching messages. Clear filters to see the full flow.')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!)
    expect(document.querySelectorAll('[data-flow-seq]').length).toBe(4)
  })

  it('opens message details with full metadata and session actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const onOpenSession = vi.fn()
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession }))

    fireEvent.click(document.querySelector('[data-flow-seq="11"]')!)
    const details = screen.getByLabelText('message details')
    expect(details.textContent).toContain('draft the change')
    expect(details.textContent).toContain('planner (child)')
    expect(details.textContent).toContain('coder (child)')
    expect(details.textContent).toContain('peer ↔ peer')
    expect(details.textContent).toContain('peer')
    expect(details.textContent).toContain('child-1')
    expect(details.textContent).toContain('#11')

    fireEvent.click(screen.getByRole('button', { name: 'Open planner session' }))
    expect(onOpenSession).toHaveBeenCalledWith('child-1')
    fireEvent.click(screen.getByRole('button', { name: 'Open coder session' }))
    expect(onOpenSession).toHaveBeenCalledWith('child-2')

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    await act(async () => { await Promise.resolve() })
    expect(writeText).toHaveBeenCalledWith('draft the change')
    fireEvent.click(screen.getByRole('button', { name: 'Copy event metadata' }))
    await act(async () => { await Promise.resolve() })
    expect(writeText.mock.calls.at(-1)?.[0]).toContain('"seq": 11')

    fireEvent.click(screen.getByRole('button', { name: 'Close message details' }))
    expect(screen.getByText('Select a message to inspect routing, content, and sessions.')).toBeTruthy()
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
    expect(screen.getByText('No messages recorded for this swarm yet.')).toBeTruthy()

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
    expect(screen.getAllByLabelText('unknown — unknown').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('ghost — unknown').length).toBeGreaterThan(0)
    fireEvent.click(document.querySelector('[data-flow-seq="1"]')!)
    expect(screen.getByLabelText('message details').textContent).toContain('unavailable')
    expect(screen.getByLabelText('message details').textContent).toContain('not-a-date')
  })

  it('pauses live follow on scroll-away and shows a new-message affordance', () => {
    const first = fixtureModel()
    const { rerender } = render(h(SwarmPanelView, { model: first, onOpenSession: vi.fn() }))
    expect(document.querySelector('[data-live="on"]')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Live follow on' }))
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

  it('navigates filtered messages with arrow keys and starts at the relevant edge', () => {
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession: vi.fn() }))
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(document.querySelector('[data-flow-seq="10"]')?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(document.querySelector('[data-flow-seq="11"]')?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(document.querySelector('[data-flow-seq="10"]')?.getAttribute('aria-selected')).toBe('true')
  })

  it('leaves arrow keys available for text input and exposes full detail content', () => {
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession: vi.fn() }))
    const search = screen.getByLabelText('Search messages')
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.querySelector('[data-flow-seq][aria-selected="true"]')).toBeNull()

    fireEvent.click(document.querySelector('[data-flow-seq="11"]')!)
    const details = screen.getByLabelText('message details')
    expect(details.querySelector('[title="draft the change"]')).toBeTruthy()
  })

  it('closes details on Escape and activates a row with keyboard', () => {
    render(h(SwarmPanelView, { model: fixtureModel(), onOpenSession: vi.fn() }))
    const row = document.querySelector('[data-flow-seq="10"]')
    if (!(row instanceof HTMLElement)) throw new Error('missing row')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByLabelText('message details').textContent).toContain('plan this')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Select a message to inspect routing, content, and sessions.')).toBeTruthy()
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
})
