/**
 * Swarm panel, browser half: the session-header Conversation Flow view over
 * the `swarm` projection. It keeps the host event log authoritative and uses
 * local state only for filters, selection, details, and live-follow behavior.
 *
 * @module dsh-swarm-panel/client
 */

import { createElement as h, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SwarmPanelFlowMessage, SwarmPanelHitl, SwarmPanelModel, SwarmPanelRole, SwarmPanelSwarm } from '../panel-model.ts'

/** Business face the client plugin injects into the panel entry. */
export interface SwarmPanelActions {
  /**
   * Open a swarm member's child session in the UI. Opening a persisted child
   * cold-resumes it host-side, which is how the panel resumes a role.
   * @param childId - the role's durable child session id.
   */
  onOpenSession(childId: string): void
}

/** Full props of the session-header swarm action. */
export type SwarmActionProps = PropsRuntime<'conversation.session.header.actions'> & SwarmPanelActions

/** Presentational props: a pure function of the projection model. */
export interface SwarmPanelViewProps extends SwarmPanelActions {
  /** The session's swarm projection (`null`/`undefined` = no swarm). */
  readonly model: SwarmPanelModel | undefined
}

/** Full props of the Conversation Flow conversation-view tab. */
export type SwarmConversationViewProps = ConvViewProps & SwarmPanelActions

type FlowFilter = 'all' | 'parent' | 'peer' | 'group' | 'human'
type RouteKind = 'parent-child' | 'peer' | 'group'

const styles = {
  root: { position: 'relative', display: 'inline-block' } satisfies CSSProperties,
  trigger: {
    border: '1px solid var(--dsw-alias-border-l2, var(--border, #444))',
    borderRadius: '6px',
    background: 'transparent',
    color: 'inherit',
    padding: '2px 8px',
    fontSize: '12px',
  } satisfies CSSProperties,
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    width: '100%',
    boxSizing: 'border-box',
    padding: '16px',
    gap: '12px',
    overflow: 'hidden',
    background: 'var(--dsw-alias-bg-layer-1, #f7f8f9)',
    color: 'var(--dsw-alias-label-primary, #1a1c1f)',
    fontSize: '12px',
  } satisfies CSSProperties,
  legend: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: '20px',
    flexShrink: 0,
    padding: '10px 12px',
    border: '1px solid var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '10px',
    background: 'var(--dsw-alias-bg-overlay, #fff)',
    minWidth: '300px',
    boxSizing: 'border-box',
  } satisfies CSSProperties,
  overview: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, .72fr)',
    gap: '10px',
    minWidth: 0,
    flexShrink: 0,
  } satisfies CSSProperties,
  topologyCard: {
    minWidth: 0,
    padding: '10px 12px',
    border: '1px solid var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '10px',
    background: 'var(--dsw-alias-bg-overlay, #fff)',
  } satisfies CSSProperties,
  sectionTitle: { fontWeight: 650, marginBottom: '8px' } satisfies CSSProperties,
  legendRow: { display: 'flex', alignItems: 'center', gap: '7px', marginTop: '5px' } satisfies CSSProperties,
  legendMark: { width: '24px', flex: '0 0 24px', textAlign: 'center', fontSize: '14px', lineHeight: 1 } satisfies CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexShrink: 0 } satisfies CSSProperties,
  heading: { fontWeight: 650, fontSize: '14px' } satisfies CSSProperties,
  muted: { color: 'var(--dsw-alias-label-secondary, #61666b)' } satisfies CSSProperties,
  summary: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '10px',
    padding: '8px',
    background: 'var(--dsw-alias-bg-secondary, #f7f8f9)',
    borderRadius: '8px',
    overflowX: 'auto',
    flexShrink: 0,
  } satisfies CSSProperties,
  node: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    whiteSpace: 'nowrap',
    padding: '5px 8px',
    border: '1px solid var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '6px',
    background: '#fff',
  } satisfies CSSProperties,
  nodeButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    whiteSpace: 'nowrap',
    padding: '5px 8px',
    border: '1px solid var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '6px',
    background: '#fff',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '12px',
  } satisfies CSSProperties,
  nodeStatus: { width: '6px', height: '6px', borderRadius: '50%', flex: '0 0 auto' } satisfies CSSProperties,
  arrow: { color: 'var(--dsw-alias-label-secondary, #61666b)', fontSize: '15px' } satisfies CSSProperties,
  toolbar: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', flexWrap: 'wrap', flexShrink: 0 } satisfies CSSProperties,
  filter: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '999px',
    background: '#fff',
    color: 'inherit',
    padding: '5px 9px',
    cursor: 'pointer',
    fontSize: '11px',
  } satisfies CSSProperties,
  filterActive: {
    background: 'var(--dsw-alias-interactive-primary, #e8f0ff)',
    borderColor: 'var(--dsw-alias-interactive-primary, #377dff)',
    color: 'var(--dsw-alias-interactive-primary, #1c5fd4)',
  } satisfies CSSProperties,
  body: { display: 'flex', gap: '10px', marginTop: '10px', minHeight: 0, minWidth: 0, flex: '1 1 auto', overflow: 'hidden' } satisfies CSSProperties,
  flow: {
    flex: '1 1 auto',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '8px',
    overflow: 'hidden',
    background: 'var(--dsw-alias-bg-secondary, #f7f8f9)',
  } satisfies CSSProperties,
  laneHeader: {
    display: 'grid',
    gap: '8px',
    padding: '8px 10px',
    background: '#fff',
    borderBottom: '1px solid var(--dsw-alias-border-l2, #edf0f2)',
  } satisfies CSSProperties,
  lane: {
    minWidth: 0,
    padding: '6px 8px',
    border: '1px solid var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '6px',
    background: '#fff',
    textAlign: 'left',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,
  laneButton: {
    minWidth: 0,
    padding: '6px 8px',
    border: '1px solid var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '6px',
    background: '#fff',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '12px',
    textAlign: 'left',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,
  scroller: { flex: '1 1 auto', overflow: 'auto', minHeight: 0 } satisfies CSSProperties,
  time: { color: 'var(--dsw-alias-label-secondary, #737a81)', fontVariantNumeric: 'tabular-nums', fontSize: '10px' } satisfies CSSProperties,
  row: {
    display: 'grid',
    gap: '8px',
    alignItems: 'center',
    padding: '8px 10px',
    borderBottom: '1px solid var(--dsw-alias-border-l2, #edf0f2)',
    cursor: 'pointer',
    position: 'relative',
    minHeight: '72px',
  } satisfies CSSProperties,
  rowSelected: { background: 'var(--dsw-alias-bg-selected, #eef4ff)', boxShadow: 'inset 3px 0 #377dff' } satisfies CSSProperties,
  card: {
    minWidth: 0,
    zIndex: 1,
    padding: '7px 8px',
    border: '1px solid var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '6px',
    background: '#fff',
  } satisfies CSSProperties,
  cardTitle: { display: 'flex', justifyContent: 'space-between', gap: '6px', fontWeight: 600, minWidth: 0 } satisfies CSSProperties,
  cardHeading: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } satisfies CSSProperties,
  preview: {
    marginTop: '3px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--dsw-alias-label-secondary, #61666b)',
  } satisfies CSSProperties,
  metaRow: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px', alignItems: 'center' } satisfies CSSProperties,
  badge: {
    display: 'inline-block',
    fontSize: '10px',
    borderRadius: '4px',
    padding: '2px 5px',
    background: '#edf4ff',
    color: '#2b6dcc',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,
  peerBadge: { background: '#f4edff', color: '#7546b8' } satisfies CSSProperties,
  groupBadge: { background: '#eef8f1', color: '#2d7b42' } satisfies CSSProperties,
  humanBadge: { background: '#fff4df', color: '#a56b00' } satisfies CSSProperties,
  target: {
    zIndex: 1,
    minWidth: 0,
    padding: '4px 7px',
    border: '1px dashed var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '999px',
    background: '#fff',
    color: 'var(--dsw-alias-label-secondary, #61666b)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    justifySelf: 'center',
  } satisfies CSSProperties,
  groupBanner: {
    gridColumn: '1 / -1',
    padding: '8px 10px',
    border: '1px dashed #9dcea8',
    borderRadius: '6px',
    background: '#f3faf5',
  } satisfies CSSProperties,
  empty: { padding: '42px 16px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary, #61666b)' } satisfies CSSProperties,
  details: {
    flex: '0 0 240px',
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '8px',
    padding: '10px',
    minWidth: 0,
    overflow: 'auto',
    background: '#fff',
  } satisfies CSSProperties,
  detailHeading: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', fontWeight: 650, marginBottom: '10px' } satisfies CSSProperties,
  detailRow: { display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '5px 0', borderBottom: '1px solid #edf0f2' } satisfies CSSProperties,
  detailLabel: { color: 'var(--dsw-alias-label-secondary, #61666b)', flex: '0 0 auto' } satisfies CSSProperties,
  detailValue: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' } satisfies CSSProperties,
  detailContent: {
    marginTop: '10px',
    padding: '8px',
    background: 'var(--dsw-alias-bg-secondary, #f7f8f9)',
    borderRadius: '6px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '180px',
    overflow: 'auto',
  } satisfies CSSProperties,
  smallButton: {
    border: '1px solid var(--dsw-alias-border-l2, #d8dce0)',
    borderRadius: '5px',
    background: '#fff',
    color: 'inherit',
    padding: '4px 7px',
    cursor: 'pointer',
    fontSize: '11px',
  } satisfies CSSProperties,
  smallButtonDisabled: { opacity: 0.55, cursor: 'not-allowed' } satisfies CSSProperties,
  hitl: {
    margin: '8px 10px',
    padding: '8px',
    borderRadius: '6px',
    background: '#fff8e8',
    color: 'var(--dsw-alias-state-warn-primary, #a56b00)',
    border: '1px solid #f1d58e',
  } satisfies CSSProperties,
  liveBanner: {
    margin: '0 0 8px',
    width: '100%',
    border: '1px solid #c5d8f8',
    borderRadius: '6px',
    background: '#eef4ff',
    color: '#1c5fd4',
    padding: '6px 8px',
    cursor: 'pointer',
    fontSize: '11px',
  } satisfies CSSProperties,
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
    marginTop: '8px',
    flexShrink: 0,
  } satisfies CSSProperties,
  footerStats: { display: 'flex', gap: '14px', flexWrap: 'wrap' } satisfies CSSProperties,
} as const

/** Status word suffix for one role row. */
function roleStatus(role: SwarmPanelRole): string {
  return role.status === 'running' ? 'running' : `exited (${role.outcome ?? 'unknown'})`
}

/** Visible participant label; empty names stay inspectable. */
function participantName(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : 'unknown'
}

/** Clock label for a stored timestamp; unparseable values render as written. */
function timeLabel(value: string): string {
  if (value.length === 0) return 'unknown time'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Filter control caption. */
function filterLabel(filter: FlowFilter): string {
  if (filter === 'parent') return 'Parent → Child'
  if (filter === 'peer') return 'Peer ↔ Peer'
  if (filter === 'group') return 'Mixed / System'
  if (filter === 'human') return 'Human input'
  return 'All messages'
}

/** Per-message route used by badges and filters. */
function routeFor(message: SwarmPanelFlowMessage): RouteKind {
  if (message.to === 'group') return 'group'
  return message.attribution === 'peer' ? 'peer' : 'parent-child'
}

/** Visible route badge copy. Color is never the only distinguisher. */
function routeLabel(route: RouteKind): string {
  if (route === 'peer') return 'peer ↔ peer'
  if (route === 'group') return 'group'
  return 'parent → child'
}

/** Kind chip for the message card. */
function messageKind(message: SwarmPanelFlowMessage): 'direct' | 'group' | 'human' {
  if (message.from === 'human' || message.to === 'human') return 'human'
  if (message.to === 'group') return 'group'
  return 'direct'
}

function badgeStyle(route: RouteKind | 'human'): CSSProperties {
  if (route === 'peer') return { ...styles.badge, ...styles.peerBadge }
  if (route === 'group') return { ...styles.badge, ...styles.groupBadge }
  if (route === 'human') return { ...styles.badge, ...styles.humanBadge }
  return styles.badge
}

function countFor(messages: readonly SwarmPanelFlowMessage[], filter: FlowFilter): number {
  return messages.filter(message => filterMatch(message, filter)).length
}

function filterMatch(message: SwarmPanelFlowMessage, filter: FlowFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'parent') return routeFor(message) === 'parent-child'
  if (filter === 'peer') return routeFor(message) === 'peer'
  if (filter === 'group') return routeFor(message) === 'group'
  return message.from === 'human' || message.to === 'human'
}

function matches(
  message: SwarmPanelFlowMessage,
  filter: FlowFilter,
  query: string,
  agent: string,
): boolean {
  if (!filterMatch(message, filter)) return false
  if (agent !== 'all' && participantName(message.from) !== agent && participantName(message.to) !== agent) return false
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return `${message.from} ${message.to} ${message.content}`.toLowerCase().includes(needle)
}

function openableRole(swarm: SwarmPanelSwarm, name: string): SwarmPanelRole | undefined {
  return swarm.roles.find(role => role.roleName === name)
}

function statusDot(status: string): CSSProperties {
  const color = status === 'running'
    ? 'var(--dsw-alias-state-success-primary, #2f9e44)'
    : status === 'waiting'
      ? 'var(--dsw-alias-state-warn-primary, #c48100)'
      : 'var(--dsw-alias-label-secondary, #8a9198)'
  return { ...styles.nodeStatus, background: color }
}

/** How a lane relates to the orchestrator: parent, spawned child, or human operator. */
function relationKind(name: string): 'parent' | 'child' | 'operator' {
  if (name === 'orchestrator') return 'parent'
  if (name === 'human') return 'operator'
  return 'child'
}

/** Stable swimlane order: orchestrator, spawn order, extras, Human last. */
function lanesFor(swarm: SwarmPanelSwarm, messages: readonly SwarmPanelFlowMessage[]): string[] {
  const ordered = ['orchestrator', ...swarm.roles.map(role => role.roleName)]
  const extras = new Set<string>()
  for (const message of messages) {
    const from = participantName(message.from)
    const to = participantName(message.to)
    if (from !== 'group' && from !== 'human' && !ordered.includes(from)) extras.add(from)
    if (to !== 'group' && to !== 'human' && !ordered.includes(to)) extras.add(to)
  }
  const rest = [...extras].sort()
  return [...ordered, ...rest, 'human']
}

/** Canvas grid: a time gutter plus one column per agent path. */
function canvasColumns(laneCount: number): string {
  const minWidth = laneCount > 5 ? 'clamp(96px, 12vw, 140px)' : '140px'
  return `72px repeat(${laneCount}, minmax(${minWidth}, 1fr))`
}

/** First line of a message, used as the card title in the speaker's lane. */
function messageParts(message: SwarmPanelFlowMessage): { title: string; preview: string } {
  const line = message.content.trim().split('\n')[0] ?? ''
  if (line.length === 0) return { title: `${participantName(message.from)} → ${participantName(message.to)}`, preview: '(empty message)' }
  const separator = line.search(/\s+[—–]\s+/)
  if (separator > 0) {
    const title = line.slice(0, separator).trim()
    const preview = line.slice(separator).replace(/^\s+[—–]\s+/, '').trim()
    return { title: title.length > 72 ? `${title.slice(0, 69)}...` : title, preview: preview.length > 0 ? preview : line }
  }
  return { title: `${participantName(message.from)} → ${participantName(message.to)}`, preview: line }
}

function topologyArrow(mode: SwarmPanelSwarm['topologyMode']): string {
  if (mode === 'peer') return '↔'
  if (mode === 'mixed') return '⇢'
  return '→'
}

function routeDistribution(messages: readonly SwarmPanelFlowMessage[]): string {
  const parent = messages.filter(message => routeFor(message) === 'parent-child').length
  const peer = messages.filter(message => routeFor(message) === 'peer').length
  const group = messages.filter(message => routeFor(message) === 'group').length
  return `parent-child ${parent} · peer ${peer} · group ${group}`
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    // Clipboard permission or missing API: copy is best-effort from the panel.
    void error
  }
}

function metadataPayload(message: SwarmPanelFlowMessage): string {
  return JSON.stringify({
    seq: message.seq,
    from: message.from,
    to: message.to,
    senderSessionId: message.senderSessionId,
    sentAt: message.sentAt,
    attribution: message.attribution,
    route: routeFor(message),
  }, null, 2)
}

/** Disabled-session reason retained when a details action cannot navigate. */
function unavailableReason(name: string, role: SwarmPanelRole | undefined): string {
  if (name === 'orchestrator') return 'The orchestrator is the current session.'
  if (name === 'human') return 'Human input has no child session.'
  if (name === 'group') return 'Group messages have no single recipient session.'
  if (role === undefined) return `No child session for ${name}.`
  return ''
}

/** One message detail drawer for the selected flow event. */
function MessageDetails({
  swarm,
  message,
  onOpenSession,
  onClose,
}: {
  swarm: SwarmPanelSwarm
  message: SwarmPanelFlowMessage | undefined
  onOpenSession: (childId: string) => void
  onClose: () => void
}): ReactNode {
  const [copied, setCopied] = useState<'message' | 'metadata' | undefined>()
  useEffect(() => {
    if (copied === undefined) return undefined
    const id = window.setTimeout(() => { setCopied(undefined) }, 1500)
    return () => { window.clearTimeout(id) }
  }, [copied])
  if (message === undefined) {
    return h('aside', { style: styles.details, 'aria-label': 'message details' },
      h('div', { style: styles.detailHeading }, 'Message details'),
      h('p', { style: styles.muted }, 'Select a message to inspect routing, content, and sessions.'))
  }
  const route = routeFor(message)
  const sender = openableRole(swarm, message.from)
  const recipient = openableRole(swarm, message.to)
  const senderReason = unavailableReason(participantName(message.from), sender)
  const recipientReason = unavailableReason(participantName(message.to), recipient)
  const markCopied = (kind: 'message' | 'metadata'): void => { setCopied(kind) }
  return h('aside', { style: styles.details, 'aria-label': 'message details' },
    h('div', { style: styles.detailHeading },
      h('span', {}, 'Message details'),
      h('button', { type: 'button', style: styles.smallButton, 'aria-label': 'Close message details', onClick: onClose }, 'Close')),
    h('div', { style: styles.detailRow }, h('span', { style: styles.detailLabel }, 'Seq'), h('span', { style: styles.detailValue }, `#${message.seq}`)),
    h('div', { style: styles.detailRow }, h('span', { style: styles.detailLabel }, 'Route'), h('span', { style: badgeStyle(route) }, routeLabel(route))),
    h('div', { style: styles.detailRow }, h('span', { style: styles.detailLabel }, 'Attribution'), h('span', { style: styles.detailValue }, message.attribution)),
    h('div', { style: styles.detailRow }, h('span', { style: styles.detailLabel }, 'Type'), h('span', { style: styles.detailValue }, messageKind(message))),
    h('div', { style: styles.detailRow }, h('span', { style: styles.detailLabel }, 'Status'), h('span', { style: styles.detailValue }, 'recorded')),
    h('div', { style: styles.detailRow }, h('span', { style: styles.detailLabel }, 'From'), h('span', { style: styles.detailValue, title: message.from }, `${participantName(message.from)} (${relationKind(participantName(message.from))})`)),
    h('div', { style: styles.detailRow }, h('span', { style: styles.detailLabel }, 'To'), h('span', { style: styles.detailValue, title: message.to }, `${participantName(message.to)} (${relationKind(participantName(message.to))})`)),
    h('div', { style: styles.detailRow }, h('span', { style: styles.detailLabel }, 'Time'), h('span', { style: styles.detailValue, title: message.sentAt }, timeLabel(message.sentAt))),
    h('div', { style: styles.detailRow },
      h('span', { style: styles.detailLabel }, 'Sender session'),
      h('span', { style: styles.detailValue, title: message.senderSessionId }, message.senderSessionId.length > 0 ? message.senderSessionId : 'unavailable')),
    h('div', { style: styles.detailContent, title: message.content }, message.content.length > 0 ? message.content : '(empty message)'),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '8px' } },
      h('button', {
        type: 'button',
        style: styles.smallButton,
        onClick: () => { void copyText(message.content).then(() => { markCopied('message') }) },
      }, copied === 'message' ? 'Copied message' : 'Copy message'),
      h('button', {
        type: 'button',
        style: styles.smallButton,
        onClick: () => { void copyText(metadataPayload(message)).then(() => { markCopied('metadata') }) },
      }, copied === 'metadata' ? 'Copied metadata' : 'Copy event metadata'),
      h('button', {
        type: 'button',
        style: sender === undefined ? { ...styles.smallButton, ...styles.smallButtonDisabled } : styles.smallButton,
        disabled: sender === undefined,
        title: senderReason,
        onClick: () => { if (sender !== undefined) onOpenSession(sender.childId) },
      }, `Open ${participantName(message.from)} session`),
      h('button', {
        type: 'button',
        style: recipient === undefined ? { ...styles.smallButton, ...styles.smallButtonDisabled } : styles.smallButton,
        disabled: recipient === undefined,
        title: recipientReason,
        onClick: () => { if (recipient !== undefined) onOpenSession(recipient.childId) },
      }, `Open ${participantName(message.to)} session`)))
}

function laneStatus(swarm: SwarmPanelSwarm, name: string): string {
  if (name === 'orchestrator') return swarm.terminated ? 'terminated' : 'running'
  if (name === 'human') return swarm.pendingHitl.length > 0 ? 'waiting' : 'idle'
  const role = openableRole(swarm, name)
  return role === undefined ? 'unknown' : roleStatus(role)
}

function connectorStyle(fromIdx: number, toIdx: number, peer: boolean): CSSProperties {
  const start = Math.min(fromIdx, toIdx) + 2
  const end = Math.max(fromIdx, toIdx) + 3
  return {
    gridColumn: `${start} / ${end}`,
    gridRow: 1,
    height: 0,
    borderTop: peer ? '2px dashed #9b7ed9' : '2px solid #7aa2e3',
    alignSelf: 'center',
    margin: '0 12px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  }
}

/** Visible direction marker placed on top of a route connector. */
function connectorLabel(fromIdx: number, toIdx: number, peer: boolean): string {
  if (peer) return '↔'
  return fromIdx < toIdx ? '→' : '←'
}

/** One Conversation Flow row: a group banner or a swimlane-placed card. */
function FlowMessageRow({
  message,
  lanes,
  selected,
  onSelect,
}: {
  message: SwarmPanelFlowMessage
  lanes: readonly string[]
  selected: boolean
  onSelect: (seq: number) => void
}): ReactNode {
  const route = routeFor(message)
  const kind = messageKind(message)
  const columns = canvasColumns(lanes.length)
  const activate = (event: { key?: string; preventDefault?: () => void }): void => {
    if (event.key !== undefined && event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault?.()
    onSelect(message.seq)
  }
  const rowStyle: CSSProperties = {
    ...styles.row,
    gridTemplateColumns: columns,
    ...(selected ? styles.rowSelected : {}),
  }
  const timeCell = h('div', { style: { ...styles.time, gridColumn: 1, gridRow: 1 } }, timeLabel(message.sentAt))
  const parts = messageParts(message)
  if (message.to === 'group') {
    return h('div', {
      key: message.seq,
      style: rowStyle,
      role: 'button',
      tabIndex: 0,
      'aria-selected': selected,
      'aria-expanded': selected,
      'data-flow-seq': message.seq,
      'data-flow-route': route,
      onClick: () => { onSelect(message.seq) },
      onKeyDown: activate,
    },
    timeCell,
    h('div', { style: { ...styles.groupBanner, gridColumn: '2 / -1' } },
      h('div', { style: styles.cardTitle },
        h('span', { style: styles.cardHeading, title: message.from }, `${participantName(message.from)} → group`),
        h('span', { style: styles.muted }, `#${message.seq}`)),
      h('div', { style: styles.preview, title: message.content }, parts.preview),
      h('div', { style: styles.metaRow },
        h('span', { style: badgeStyle(route) }, routeLabel(route)),
        h('span', { style: badgeStyle(kind === 'human' ? 'human' : route) }, kind))))
  }
  const fromIdx = Math.max(0, lanes.indexOf(participantName(message.from)))
  const toIdx = Math.max(0, lanes.indexOf(participantName(message.to)))
  const peer = route === 'peer'
  return h('div', {
    key: message.seq,
    style: rowStyle,
    role: 'button',
    tabIndex: 0,
    'aria-selected': selected,
    'aria-expanded': selected,
    'data-flow-seq': message.seq,
    'data-flow-route': route,
    'data-flow-from': participantName(message.from),
    onClick: () => { onSelect(message.seq) },
    onKeyDown: activate,
  },
  timeCell,
  fromIdx !== toIdx
    ? h('div', { 'aria-hidden': true, style: connectorStyle(fromIdx, toIdx, peer) },
        h('span', { style: { background: '#fff', border: `1px ${peer ? 'dashed' : 'solid'} ${peer ? '#9b7ed9' : '#7aa2e3'}`, borderRadius: '999px', padding: '1px 5px', color: peer ? '#7546b8' : '#2b6dcc', lineHeight: 1 } }, connectorLabel(fromIdx, toIdx, peer)))
    : null,
  h('div', { style: { ...styles.card, gridColumn: fromIdx + 2, gridRow: 1 } },
    h('div', { style: styles.cardTitle },
      h('span', { style: styles.cardHeading, title: message.content }, parts.title),
      h('span', { style: badgeStyle(route) }, routeLabel(route))),
    h('div', { style: styles.preview, title: message.content }, parts.preview),
    h('div', { style: styles.metaRow },
      h('span', { style: styles.muted }, `${participantName(message.from)} (${relationKind(participantName(message.from))})`),
      h('span', { style: styles.muted }, `#${message.seq}`))),
  fromIdx !== toIdx
    ? h('div', { style: { ...styles.target, gridColumn: toIdx + 2, gridRow: 1 }, title: message.to },
        `${peer ? '↔' : fromIdx < toIdx ? '→' : '←'} ${participantName(message.to)}`)
    : null)
}

/** Pending HITL row in the Human lane. */
function HitlRow({ pending, lanes }: { pending: SwarmPanelHitl; lanes: readonly string[] }): ReactNode {
  const humanIdx = Math.max(0, lanes.indexOf('human'))
  return h('div', {
    key: pending.requestId,
    style: { ...styles.row, gridTemplateColumns: canvasColumns(lanes.length), cursor: 'default' },
    'data-flow-hitl': pending.requestId,
  },
  h('div', { style: { ...styles.time, gridColumn: 1 } }, timeLabel(pending.requestedAt)),
    h('div', { style: { ...styles.hitl, gridColumn: humanIdx + 2, margin: 0 } },
    h('div', { style: styles.cardTitle },
      h('span', { title: pending.question }, `Human input pending: ${pending.question}`),
      h('span', { style: badgeStyle('human') }, 'waiting')),
    h('div', { style: { ...styles.preview, color: 'inherit', whiteSpace: 'normal' } }, 'Waiting for an operator response.')))
}

/** Render one Conversation Flow swarm section. */
function SwarmFlowView({ swarm, onOpenSession }: { swarm: SwarmPanelSwarm; onOpenSession: (childId: string) => void }): ReactNode {
  const messages = swarm.flow ?? []
  const [filter, setFilter] = useState<FlowFilter>('all')
  const [query, setQuery] = useState('')
  const [agent, setAgent] = useState('all')
  const [selectedSeq, setSelectedSeq] = useState<number | undefined>()
  const [live, setLive] = useState(true)
  const [pendingNew, setPendingNew] = useState(0)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const knownCountRef = useRef(messages.length)

  useEffect(() => {
    const previous = knownCountRef.current
    const delta = Math.max(0, messages.length - previous)
    knownCountRef.current = messages.length
    if (live) setPendingNew(0)
    else if (delta > 0) setPendingNew(count => count + delta)
  }, [messages.length, live])

  useEffect(() => {
    if (!live) return
    const node = scrollerRef.current
    if (node === null) return
    node.scrollTop = node.scrollHeight
  }, [messages.length, live, filter, query, agent])

  const filtered = messages.filter(message => matches(message, filter, query, agent))
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return
      if (event.key === 'Escape') {
        if (selectedSeq !== undefined) setSelectedSeq(undefined)
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (filtered.length === 0) return
      event.preventDefault()
      const currentIndex = filtered.findIndex(message => message.seq === selectedSeq)
      const nextIndex = currentIndex < 0
        ? event.key === 'ArrowDown' ? 0 : filtered.length - 1
        : Math.max(0, Math.min(filtered.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)))
      setSelectedSeq(filtered[nextIndex]?.seq)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [filtered, selectedSeq])
  const selected = messages.find(message => message.seq === selectedSeq)
  const lanes = lanesFor(swarm, messages)
  const filteredActive = filter !== 'all' || query.trim().length > 0 || agent !== 'all'
  const turns = swarm.transcript.length
  const meta: string[] = [
    swarm.topologyMode,
    swarm.terminated ? `terminated (${swarm.destroyReason ?? 'no reason'})` : 'active',
    `${swarm.messageCount} messages`,
  ]
  if (swarm.lastSpeaker !== undefined) meta.push(`last speaker: ${swarm.lastSpeaker}`)
  if (swarm.chat !== undefined) {
    const limits = swarm.chat.maxTurns !== undefined ? `/${swarm.chat.maxTurns}` : ''
    meta.push(`chat ${swarm.chat.active ? 'running' : `ended (${swarm.chat.endReason ?? 'unknown'})`}, turn ${turns}${limits}`)
  }
  if (swarm.latestCheckpointAt !== undefined) meta.push(`checkpoint ${swarm.latestCheckpointAt}`)

  const agentOptions = ['all', ...lanes]
  const resumeLive = (): void => {
    setLive(true)
    setPendingNew(0)
  }
  const clearFilters = (): void => {
    setFilter('all')
    setQuery('')
    setAgent('all')
  }
  const onScroll = (): void => {
    const node = scrollerRef.current
    if (node === null) return
    const gap = node.scrollHeight - node.scrollTop - node.clientHeight
    if (gap > 32 && live) setLive(false)
  }

  const emptyCopy = filteredActive
    ? 'No matching messages. Clear filters to see the full flow.'
    : swarm.terminated
      ? 'This swarm has terminated and recorded no messages.'
      : 'No messages recorded for this swarm yet.'

  return h('section', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }, 'data-swarm-id': swarm.swarmId },
    h('div', { style: styles.header },
      h('div', {},
        h('div', { style: styles.heading }, `swarm ${swarm.swarmId}`),
        h('div', { style: styles.muted }, meta.join(' · '))),
      h('span', { style: { ...styles.badge, ...(swarm.topologyMode === 'peer' ? styles.peerBadge : swarm.topologyMode === 'mixed' ? styles.humanBadge : {}) } }, swarm.topologyMode)),
    h('div', { style: styles.overview },
    h('div', { style: styles.topologyCard },
    h('div', { style: styles.sectionTitle }, `Swarm topology (${swarm.topologyMode})`),
    h('div', { style: { ...styles.summary, marginTop: 0, border: 0, padding: 0, background: 'transparent' }, 'aria-label': 'swarm topology summary' },
      lanes.filter(name => name !== 'human').map((name, index) => {
        const role = openableRole(swarm, name)
        const status = laneStatus(swarm, name)
        const kind = relationKind(name)
        const label = `${name} — ${status}`
        return h('span', { key: name, style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
          index > 0 ? h('span', { style: styles.arrow, 'aria-hidden': true }, topologyArrow(swarm.topologyMode)) : null,
          role !== undefined
            ? h('button', { type: 'button', style: styles.nodeButton, title: `${kind} · ${role.childId}`, 'aria-label': label, onClick: () => { onOpenSession(role.childId) } },
                h('span', { style: statusDot(role.status), 'aria-hidden': true }),
                h('span', {}, name),
                h('span', { style: styles.muted }, `${kind} · ${status}`))
            : h('span', { style: styles.node, 'aria-label': label },
                h('span', { style: statusDot(status), 'aria-hidden': true }),
                h('span', {}, name),
                h('span', { style: styles.muted }, `${kind} · ${status}`)))
      }),
      swarm.topologyMode === 'mixed'
        ? h('span', { style: { ...styles.muted, marginLeft: '8px', whiteSpace: 'nowrap' } }, routeDistribution(messages))
        : null)),
    h('div', { style: styles.legend, 'aria-label': 'route legend' },
      h('div', {},
        h('div', { style: styles.sectionTitle }, 'Legend'),
        h('div', { style: styles.legendRow }, h('span', { style: styles.legendMark, 'aria-hidden': true }, '→'), h('span', { style: styles.muted }, 'Parent → Child')),
        h('div', { style: styles.legendRow }, h('span', { style: styles.legendMark, 'aria-hidden': true }, '↔'), h('span', { style: styles.muted }, 'Peer ↔ Peer')),
        h('div', { style: styles.legendRow }, h('span', { style: styles.legendMark, 'aria-hidden': true }, '┄'), h('span', { style: styles.muted }, 'System / Mixed'))),
      h('div', {},
        h('div', { style: styles.sectionTitle }, 'Role status'),
        h('div', { style: styles.legendRow }, h('span', { style: { ...styles.legendMark, color: '#2f9e44' }, 'aria-hidden': true }, '●'), h('span', { style: styles.muted }, 'Active')),
        h('div', { style: styles.legendRow }, h('span', { style: { ...styles.legendMark, color: '#c48100' }, 'aria-hidden': true }, '●'), h('span', { style: styles.muted }, 'Idle / waiting')),
        h('div', { style: styles.legendRow }, h('span', { style: { ...styles.legendMark, color: '#8a9198' }, 'aria-hidden': true }, '●'), h('span', { style: styles.muted }, 'Completed / exited'))))),
    h('div', { style: styles.toolbar, 'aria-label': 'conversation filters' },
      (['all', 'parent', 'peer', 'group', 'human'] as const).map(current => h('button', {
        key: current,
        type: 'button',
        style: filter === current ? { ...styles.filter, ...styles.filterActive } : styles.filter,
        'aria-pressed': filter === current,
        onClick: () => { setFilter(current) },
      }, `${filterLabel(current)} (${countFor(messages, current)})`)),
      h('label', { style: { ...styles.muted, display: 'inline-flex', alignItems: 'center', gap: '4px' } },
        'Agent',
        h('select', {
          value: agent,
          'aria-label': 'Filter by agent',
          style: styles.smallButton,
          onChange: (event: { target: { value: string } }) => { setAgent(event.target.value) },
        }, agentOptions.map(option => h('option', { key: option, value: option }, option === 'all' ? 'All agents' : option)))),
      h('input', {
        value: query,
        placeholder: 'Search messages…',
        'aria-label': 'Search messages',
        style: { ...styles.smallButton, marginLeft: 'auto', width: '180px' },
        onChange: (event: { target: { value: string } }) => { setQuery(event.target.value) },
      }),
      filteredActive
        ? h('button', { type: 'button', style: styles.smallButton, onClick: clearFilters }, 'Clear filters')
        : null,
      h('button', {
        type: 'button',
        style: styles.smallButton,
        'aria-pressed': live,
        'aria-label': live ? 'Live follow on' : 'Live follow paused',
        onClick: () => { setLive(current => !current) },
      }, live ? '● Live' : 'Ⅱ Pause live')),
    pendingNew > 0 && !live
      ? h('button', { type: 'button', style: styles.liveBanner, onClick: resumeLive }, `${pendingNew} new message${pendingNew === 1 ? '' : 's'} · resume live`)
      : null,
    h('div', { style: styles.body },
      h('div', { style: styles.flow },
        h('div', {
          style: { ...styles.laneHeader, gridTemplateColumns: canvasColumns(lanes.length) },
          'aria-label': 'agent lanes',
        },
        h('div', { key: 'time', style: { ...styles.lane, fontWeight: 650 } }, 'Time'),
        ...lanes.map((name) => {
          const role = openableRole(swarm, name)
          const status = laneStatus(swarm, name)
          const kind = relationKind(name)
          const label = `${name} — ${status}`
          const body = [h('div', { style: { fontWeight: 650 } }, name), h('div', { style: styles.muted }, `${kind} · ${status}`)]
          return role !== undefined
            ? h('button', { key: name, type: 'button', style: styles.laneButton, title: `${kind} · ${role.childId}`, 'aria-label': label, onClick: () => { onOpenSession(role.childId) } }, ...body)
            : h('div', { key: name, style: styles.lane, title: `${kind} · ${status}`, 'aria-label': label }, ...body)
        })),
        h('div', {
          ref: scrollerRef,
          style: styles.scroller,
          'data-flow-scroller': true,
          'data-live': live ? 'on' : 'paused',
          onScroll,
        },
        filtered.length === 0
          ? h('div', { style: styles.empty },
              emptyCopy,
              filteredActive
                ? h('div', { style: { marginTop: '8px' } },
                    h('button', { type: 'button', style: styles.smallButton, onClick: clearFilters }, 'Clear filters'))
                : null)
          : filtered.map(message => h(FlowMessageRow, {
              key: message.seq,
              message,
              lanes,
              selected: selectedSeq === message.seq,
              onSelect: setSelectedSeq,
            })),
        swarm.pendingHitl.length > 0 && (filter === 'all' || filter === 'human') && (agent === 'all' || agent === 'human')
          ? swarm.pendingHitl.map(pending => h(HitlRow, { key: `lane-${pending.requestId}`, pending, lanes }))
          : null)),
      h(MessageDetails, {
        swarm,
        message: selected,
        onOpenSession,
        onClose: () => { setSelectedSeq(undefined) },
      })),
    h('div', { style: styles.footer },
      h('div', { style: styles.footerStats },
        h('span', {}, `${filtered.length} visible · ${messages.length} total`),
        messages.length > 0 ? h('span', {}, `first ${timeLabel(messages[0]?.sentAt ?? '')}`) : null,
        messages.length > 0 ? h('span', {}, `last ${timeLabel(messages[messages.length - 1]?.sentAt ?? '')}`) : null,
        h('span', {}, swarm.context.phase !== undefined ? `phase: ${swarm.context.phase}` : 'session event log')),
      h('span', {}, `● ${live ? 'Live' : 'Paused'}`)))
}

/** Pure panel body: renders one Conversation Flow section per swarm. */
export function SwarmPanelView({ model, onOpenSession }: SwarmPanelViewProps): ReactNode {
  const swarms = model == null ? [] : Object.values(model)
  if (swarms.length === 0) {
    return h('div', { style: styles.page, 'aria-label': 'Conversation Flow' },
      h('div', { style: styles.empty }, 'No swarm in this session. Ask the Orchestrator to create one and spawn roles.'))
  }
  return h('div', { style: styles.page, 'aria-label': 'Conversation Flow' },
    swarms.map(swarm => h(SwarmFlowView, { key: swarm.swarmId, swarm, onOpenSession })))
}

/**
 * Conversation Flow tab: full-page swimlanes over the `swarm` projection.
 * @param props - conversation-view slot currency plus the injected actions.
 * @returns the Conversation Flow page.
 */
export function SwarmConversationView(props: SwarmConversationViewProps): ReactNode {
  return h(SwarmPanelView, { model: props.useProjection('swarm'), onOpenSession: props.onOpenSession })
}

/**
 * Session-header swarm count. The Conversation Flow canvas lives on the
 * `conversation.view` tab, not in this header badge.
 * @param props - runtime slot currency plus the injected actions.
 * @returns the swarm count, or null when the session has no swarm.
 */
export function SwarmAction(props: SwarmActionProps): ReactNode {
  const model = props.useProjection('swarm')
  const count = model == null ? 0 : Object.keys(model).length
  if (count === 0) return null
  return h('div', { style: styles.root },
    h('span', {
      style: styles.trigger,
      'aria-label': `swarm panel (${count} ${count === 1 ? 'swarm' : 'swarms'})`,
    }, `Swarms: ${count}`))
}
