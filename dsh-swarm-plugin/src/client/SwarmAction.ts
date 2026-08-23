/**
 * Swarm panel, browser half: the session-header Conversation Flow view over
 * the `swarm` projection. It keeps the host event log authoritative and uses
 * local state only for filters, selection, details, and live-follow behavior.
 *
 * @module dsh-swarm-panel/client
 */

import { createElement as h, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SwarmPanelFlowMessage, SwarmPanelHitl, SwarmPanelModel, SwarmPanelSwarm } from '../panel-model.ts'
import {
  EMPTY_NO_SWARM,
  canvasColumns,
  connectorDash,
  countFor,
  elbowPath,
  emptyStateCopy,
  filterLabel,
  formatClock,
  formatDuration,
  formatUtcOffset,
  laneVisual,
  lanesFor,
  matches,
  messageKind,
  messageParts,
  metadataPayload,
  openableRole,
  participantName,
  relationKind,
  roleStateColor,
  roleVisualLabel,
  routeDistribution,
  routeFor,
  routeLabel,
  topologyArrow,
  unavailableReason,
  visibleHitl,
  type FlowFilter,
  type RelationKind,
  type RoleVisualState,
  type RouteKind,
} from './flow-model.ts'

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
  /** The session's swarm projection (`undefined` = not yet pushed). */
  readonly model: SwarmPanelModel | undefined
  /** Host session id of this swarm (HITL opens the original swarm session). */
  readonly sessionId?: string
  /** Client-visible projection failure; omitted when the host has no error channel. */
  readonly projectionError?: string
}

/** Full props of the Conversation Flow conversation-view tab. */
export type SwarmConversationViewProps = ConvViewProps & SwarmPanelActions

const T = {
  bg: 'var(--dsw-alias-bg-layer-1)',
  overlay: 'var(--dsw-alias-bg-overlay)',
  secondary: 'var(--dsw-alias-bg-secondary, var(--dsw-alias-bg-layer-1))',
  selected: 'var(--dsw-alias-bg-selected, var(--dsw-alias-interactive-bg-active))',
  border: 'var(--dsw-alias-border-l2)',
  borderSoft: 'var(--dsw-alias-border-l1)',
  text: 'var(--dsw-alias-label-primary)',
  muted: 'var(--dsw-alias-label-secondary)',
  tertiary: 'var(--dsw-alias-label-tertiary)',
  interactive: 'var(--dsw-alias-interactive-bg-active)',
  hover: 'var(--dsw-alias-interactive-bg-hover)',
  success: 'var(--dsw-alias-state-success-primary)',
  warn: 'var(--dsw-alias-state-warn-label)',
  warnBg: 'var(--dsw-alias-state-warn-tertiary)',
  error: 'var(--dsw-alias-state-error-primary)',
  business: 'var(--dsw-alias-state-business-primary)',
  businessBg: 'var(--dsw-alias-state-business-tertiary)',
} as const

const styles = {
  root: { position: 'relative', display: 'inline-block' } satisfies CSSProperties,
  trigger: {
    border: `1px solid ${T.border}`,
    borderRadius: '6px',
    background: 'transparent',
    color: 'inherit',
    padding: '2px 8px',
    fontSize: '12px',
    lineHeight: 1.4,
  } satisfies CSSProperties,
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 16px',
    gap: '10px',
    overflow: 'hidden',
    background: T.bg,
    color: T.text,
    fontSize: '12px',
    lineHeight: 1.45,
  } satisfies CSSProperties,
  legend: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: '16px',
    flexShrink: 0,
    padding: '10px 12px',
    border: `1px solid ${T.border}`,
    borderRadius: '10px',
    background: T.overlay,
    minWidth: '260px',
    boxSizing: 'border-box',
  } satisfies CSSProperties,
  overview: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '10px',
    minWidth: 0,
    flexShrink: 0,
  } satisfies CSSProperties,
  topologyCard: {
    minWidth: 0,
    padding: '10px 12px',
    border: `1px solid ${T.border}`,
    borderRadius: '10px',
    background: T.overlay,
  } satisfies CSSProperties,
  sectionTitle: { fontWeight: 650, marginBottom: '8px', fontSize: '12px' } satisfies CSSProperties,
  legendRow: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '5px' } satisfies CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexShrink: 0 } satisfies CSSProperties,
  heading: { fontWeight: 650, fontSize: '14px' } satisfies CSSProperties,
  muted: { color: T.muted } satisfies CSSProperties,
  topologyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    overflowX: 'auto',
    flexWrap: 'wrap',
  } satisfies CSSProperties,
  roleCard: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    border: `1px solid ${T.border}`,
    borderRadius: '10px',
    background: T.overlay,
    color: 'inherit',
    minWidth: '132px',
    textAlign: 'left',
  } satisfies CSSProperties,
  roleCardButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    border: `1px solid ${T.border}`,
    borderRadius: '10px',
    background: T.overlay,
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '12px',
    minWidth: '132px',
    textAlign: 'left' as const,
  } satisfies CSSProperties,
  toolbar: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', flexShrink: 0 } satisfies CSSProperties,
  filter: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: T.border,
    borderRadius: '999px',
    background: T.overlay,
    color: 'inherit',
    padding: '5px 10px',
    cursor: 'pointer',
    fontSize: '12px',
    lineHeight: 1.4,
  } satisfies CSSProperties,
  filterActive: {
    background: T.interactive,
    borderColor: T.business,
    color: T.text,
  } satisfies CSSProperties,
  body: { display: 'flex', gap: '10px', minHeight: 0, minWidth: 0, flex: '1 1 auto', overflow: 'hidden', flexWrap: 'wrap' } satisfies CSSProperties,
  flow: {
    flex: '1 1 420px',
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid ${T.border}`,
    borderRadius: '8px',
    overflow: 'hidden',
    background: T.overlay,
  } satisfies CSSProperties,
  laneHeader: {
    display: 'grid',
    gap: 0,
    background: T.overlay,
    borderBottom: `1px solid ${T.border}`,
    flexShrink: 0,
  } satisfies CSSProperties,
  lane: {
    minWidth: 0,
    padding: '8px 8px 6px',
    borderLeft: `1px solid ${T.borderSoft}`,
    background: T.overlay,
    textAlign: 'left' as const,
    overflow: 'hidden',
  } satisfies CSSProperties,
  laneButton: {
    minWidth: 0,
    padding: '8px 8px 6px',
    border: 0,
    borderLeft: `1px solid ${T.borderSoft}`,
    background: T.overlay,
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '12px',
    textAlign: 'left' as const,
    overflow: 'hidden',
  } satisfies CSSProperties,
  scroller: { flex: '1 1 auto', overflow: 'auto', minHeight: 0, position: 'relative' as const } satisfies CSSProperties,
  time: {
    color: T.muted,
    fontVariantNumeric: 'tabular-nums',
    fontSize: '12px',
    lineHeight: 1.35,
    padding: '8px 6px',
  } satisfies CSSProperties,
  row: {
    display: 'grid',
    gap: 0,
    alignItems: 'stretch',
    position: 'relative' as const,
    minHeight: '64px',
    borderBottom: `1px solid ${T.borderSoft}`,
  } satisfies CSSProperties,
  rowSelected: {
    background: T.selected,
    boxShadow: `inset 3px 0 ${T.business}`,
  } satisfies CSSProperties,
  card: {
    minWidth: 0,
    zIndex: 1,
    margin: '8px 8px 8px 6px',
    padding: '6px 8px',
    border: `1px solid ${T.border}`,
    borderRadius: '8px',
    background: T.overlay,
    boxShadow: '0 1px 0 var(--dsw-alias-border-l1)',
  } satisfies CSSProperties,
  cardTitle: { display: 'flex', justifyContent: 'space-between', gap: '6px', fontWeight: 600, minWidth: 0, alignItems: 'center' } satisfies CSSProperties,
  cardHeading: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } satisfies CSSProperties,
  preview: {
    marginTop: '2px',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    color: T.muted,
    lineHeight: 1.35,
  } satisfies CSSProperties,
  badge: {
    display: 'inline-block',
    fontSize: '11px',
    lineHeight: 1.3,
    borderRadius: '4px',
    padding: '1px 5px',
    background: T.businessBg,
    color: T.business,
    whiteSpace: 'nowrap' as const,
    flex: '0 0 auto',
  } satisfies CSSProperties,
  empty: { padding: '42px 16px', textAlign: 'center' as const, color: T.muted } satisfies CSSProperties,
  details: {
    flex: '1 1 240px',
    maxWidth: '320px',
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid ${T.border}`,
    borderRadius: '8px',
    padding: '12px',
    minWidth: '220px',
    overflow: 'auto',
    background: T.overlay,
    gap: '10px',
  } satisfies CSSProperties,
  detailBlock: { display: 'flex', flexDirection: 'column', gap: '2px' } satisfies CSSProperties,
  detailLabel: { color: T.muted, fontSize: '11px', lineHeight: 1.4 } satisfies CSSProperties,
  detailValue: { minWidth: 0, wordBreak: 'break-word' as const } satisfies CSSProperties,
  detailPreview: {
    padding: '8px',
    background: T.secondary,
    borderRadius: '6px',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: '160px',
    overflow: 'auto',
  } satisfies CSSProperties,
  smallButton: {
    border: `1px solid ${T.border}`,
    borderRadius: '6px',
    background: T.overlay,
    color: 'inherit',
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '12px',
    lineHeight: 1.4,
  } satisfies CSSProperties,
  smallButtonDisabled: { opacity: 0.55, cursor: 'not-allowed' } satisfies CSSProperties,
  hitl: {
    margin: '8px 6px',
    padding: '8px',
    borderRadius: '8px',
    background: T.warnBg,
    color: T.warn,
    border: `1px solid ${T.warn}`,
    cursor: 'pointer',
    textAlign: 'left' as const,
    width: 'calc(100% - 12px)',
    fontSize: '12px',
    lineHeight: 1.4,
  } satisfies CSSProperties,
  liveBanner: {
    margin: '0 0 8px',
    width: '100%',
    border: `1px solid ${T.business}`,
    borderRadius: '6px',
    background: T.businessBg,
    color: T.text,
    padding: '6px 8px',
    cursor: 'pointer',
    fontSize: '12px',
  } satisfies CSSProperties,
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap' as const,
    flexShrink: 0,
    paddingTop: '4px',
  } satisfies CSSProperties,
  footerStats: { display: 'flex', gap: '14px', flexWrap: 'wrap' as const, color: T.muted } satisfies CSSProperties,
} as const

function badgeStyle(route: RouteKind | 'human'): CSSProperties {
  if (route === 'peer') return { ...styles.badge, background: 'var(--dsw-alias-interactive-bg-active)', color: T.text }
  if (route === 'group') return { ...styles.badge, background: 'var(--dsw-alias-state-success-tertiary)', color: T.success }
  if (route === 'human') return { ...styles.badge, background: T.warnBg, color: T.warn }
  return styles.badge
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    void error
  }
}

function StatusDot({ state }: { state: RoleVisualState }): ReactNode {
  return h('span', {
    'aria-hidden': true,
    'data-role-state': state,
    style: {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      flex: '0 0 auto',
      background: roleStateColor(state),
    },
  })
}

function RoleGlyph({ name, state }: { name: string; state: RoleVisualState }): ReactNode {
  const fill = roleStateColor(state === 'completed' ? 'idle' : state === 'error' ? 'error' : 'active')
  const mark = name === 'orchestrator' ? 'M12 7 a3 3 0 1 0 0.01 0 M7 18 c0-3 10-3 10 0'
    : name === 'human' ? 'M12 8 a2.5 2.5 0 1 0 0.01 0 M8 17 c0-2.4 8-2.4 8 0'
      : 'M9 9 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M7 18 c2-3 8-3 10 0'
  return h('svg', {
    width: 28,
    height: 28,
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    style: { flex: '0 0 auto' },
  },
  h('circle', { cx: 12, cy: 12, r: 11, fill: 'var(--dsw-alias-state-business-tertiary)', stroke: fill, strokeWidth: 1.4 }),
  h('path', { d: mark, fill: 'none', stroke: fill, strokeWidth: 1.6, strokeLinecap: 'round' }))
}

function RoleIdentity({ name, kind, state, waiting }: {
  name: string
  kind: RelationKind
  state: RoleVisualState
  waiting: boolean
}): ReactNode {
  return h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
    h('span', { style: { fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name),
    h('span', { style: { ...styles.muted, display: 'inline-flex', alignItems: 'center', gap: '5px' } },
      h(StatusDot, { state }),
      h('span', {}, `${kind} · ${roleVisualLabel(state, waiting)}`)))
}

function ElbowConnector({
  seq,
  fromIdx,
  toIdx,
  route,
  laneCount,
}: {
  seq: number
  fromIdx: number
  toIdx: number
  route: RouteKind
  laneCount: number
}): ReactNode {
  const d = elbowPath(fromIdx, toIdx)
  if (d.length === 0) return null
  const dash = connectorDash(route)
  const markerId = `flow-arrow-${seq}`
  return h('svg', {
    'data-flow-connector': 'elbow',
    'data-flow-route': route,
    viewBox: `0 0 ${laneCount} 1`,
    preserveAspectRatio: 'none',
    'aria-hidden': true,
    style: {
      position: 'absolute',
      left: '76px',
      right: 0,
      top: 0,
      bottom: 0,
      zIndex: 0,
      pointerEvents: 'none',
      color: T.business,
      overflow: 'hidden',
    },
  },
  h('defs', {},
    h('marker', {
      id: markerId,
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: 'auto',
      markerUnits: 'strokeWidth',
    }, h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'currentColor' }))),
  h('path', {
    d,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    vectorEffect: 'non-scaling-stroke',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...(dash !== undefined ? { strokeDasharray: dash } : {}),
    markerEnd: `url(#${markerId})`,
  }))
}

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
  const [copied, setCopied] = useState<'id' | 'message' | 'metadata' | undefined>()
  useEffect(() => {
    if (copied === undefined) return undefined
    const id = window.setTimeout(() => { setCopied(undefined) }, 1500)
    return () => { window.clearTimeout(id) }
  }, [copied])
  if (message === undefined) {
    return h('aside', { style: styles.details, 'aria-label': 'message details' },
      h('div', { style: { fontWeight: 650 } }, 'Message details'),
      h('p', { style: styles.muted }, 'Select a message to inspect routing, content, and sessions.'))
  }
  const route = routeFor(message)
  const sender = openableRole(swarm, message.from)
  const recipient = openableRole(swarm, message.to)
  const senderName = participantName(message.from)
  const recipientName = participantName(message.to)
  const senderReason = unavailableReason(senderName, sender)
  const recipientReason = unavailableReason(recipientName, recipient)
  const markCopied = (kind: 'id' | 'message' | 'metadata'): void => { setCopied(kind) }
  return h('aside', { style: styles.details, 'aria-label': 'message details' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' } },
      h('span', { style: { fontWeight: 650 } }, 'Message details'),
      h('button', { type: 'button', style: styles.smallButton, 'aria-label': 'Close message details', onClick: onClose }, 'Close')),
    h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
      h('span', { style: badgeStyle(route) }, routeLabel(route)),
      h('span', { style: styles.muted }, `#${message.seq}`)),
    h('div', { style: styles.detailBlock },
      h('span', { style: styles.detailLabel }, 'From'),
      h('span', { style: styles.detailValue, title: message.from }, `${senderName} (${relationKind(senderName)})`)),
    h('div', { style: { color: T.muted, paddingLeft: '4px' }, 'aria-hidden': true }, '↓'),
    h('div', { style: styles.detailBlock },
      h('span', { style: styles.detailLabel }, 'To'),
      h('span', { style: styles.detailValue, title: message.to }, `${recipientName} (${relationKind(recipientName)})`)),
    h('div', { style: styles.detailBlock },
      h('span', { style: styles.detailLabel }, 'Route'),
      h('span', { style: styles.detailValue }, routeLabel(route))),
    h('div', { style: styles.detailBlock },
      h('span', { style: styles.detailLabel }, 'Status'),
      h('span', { style: styles.detailValue }, 'Recorded')),
    h('div', { style: styles.detailBlock },
      h('span', { style: styles.detailLabel }, 'Attribution'),
      h('span', { style: styles.detailValue }, message.attribution)),
    h('div', { style: styles.detailBlock },
      h('span', { style: styles.detailLabel }, 'Time'),
      h('span', { style: styles.detailValue, title: message.sentAt }, `${formatClock(message.sentAt)} ${formatUtcOffset(message.sentAt)}`)),
    h('div', { style: styles.detailBlock },
      h('span', { style: styles.detailLabel }, 'Sender session'),
      h('span', { style: styles.detailValue, title: message.senderSessionId }, message.senderSessionId.length > 0 ? message.senderSessionId : 'unavailable')),
    h('div', { style: styles.detailBlock },
      h('span', { style: styles.detailLabel }, 'Content preview'),
      h('div', { style: styles.detailPreview, title: message.content }, message.content.length > 0 ? message.content : '(empty message)')),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px' } },
      h('button', {
        type: 'button',
        style: styles.smallButton,
        onClick: () => { void copyText(String(message.seq)).then(() => { markCopied('id') }) },
      }, copied === 'id' ? 'Copied ID' : 'Copy ID'),
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
      }, `Open ${senderName} session`),
      h('button', {
        type: 'button',
        style: recipient === undefined ? { ...styles.smallButton, ...styles.smallButtonDisabled } : styles.smallButton,
        disabled: recipient === undefined,
        title: recipientReason,
        onClick: () => { if (recipient !== undefined) onOpenSession(recipient.childId) },
      }, `Open ${recipientName} session`)))
}

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
  const timeCell = h('div', {
    style: { ...styles.time, gridColumn: 1, gridRow: 1, zIndex: 1 },
    'data-utc-offset': formatUtcOffset(message.sentAt),
  },
  h('div', {}, formatClock(message.sentAt)),
  h('div', { style: { color: T.tertiary } }, formatUtcOffset(message.sentAt)))
  const parts = messageParts(message)
  const laneCells = lanes.map((name, index) => h('div', {
    key: `grid-${name}`,
    'aria-hidden': true,
    style: {
      gridColumn: index + 2,
      gridRow: 1,
      borderLeft: `1px solid ${T.borderSoft}`,
    },
  }))
  if (message.to === 'group') {
    const fromIdx = Math.max(0, lanes.indexOf(participantName(message.from)))
    return h('div', {
      id: `flow-msg-${message.seq}`,
      style: rowStyle,
      role: 'option',
      tabIndex: selected ? 0 : -1,
      'aria-selected': selected,
      'data-flow-seq': message.seq,
      'data-flow-route': route,
      'data-flow-from': participantName(message.from),
      onClick: () => { onSelect(message.seq) },
      onKeyDown: activate,
    },
    timeCell,
    ...laneCells,
    h(ElbowConnector, { seq: message.seq, fromIdx, toIdx: Math.min(fromIdx + 1, lanes.length - 1), route, laneCount: lanes.length }),
    h('div', { style: { ...styles.card, gridColumn: fromIdx + 2, gridRow: 1, borderStyle: 'dashed' } },
      h('div', { style: styles.cardTitle },
        h('span', { style: styles.cardHeading, title: message.from }, `${participantName(message.from)} → group`),
        h('span', { style: badgeStyle(route) }, routeLabel(route))),
      h('div', { style: styles.preview, title: message.content }, parts.preview),
      h('div', { style: { ...styles.muted, marginTop: '2px' } }, `ID: ${message.seq}`)))
  }
  const fromIdx = Math.max(0, lanes.indexOf(participantName(message.from)))
  const toIdx = Math.max(0, lanes.indexOf(participantName(message.to)))
  return h('div', {
    id: `flow-msg-${message.seq}`,
    style: rowStyle,
    role: 'option',
    tabIndex: selected ? 0 : -1,
    'aria-selected': selected,
    'data-flow-seq': message.seq,
    'data-flow-route': route,
    'data-flow-from': participantName(message.from),
    onClick: () => { onSelect(message.seq) },
    onKeyDown: activate,
  },
  timeCell,
  ...laneCells,
  h(ElbowConnector, { seq: message.seq, fromIdx, toIdx, route, laneCount: lanes.length }),
  h('div', { style: { ...styles.card, gridColumn: fromIdx + 2, gridRow: 1 } },
    h('div', { style: styles.cardTitle },
      h('span', { style: styles.cardHeading, title: message.content }, parts.title),
      h('span', { style: badgeStyle(kind === 'human' ? 'human' : route) }, kind === 'human' ? 'human' : routeLabel(route))),
    h('div', { style: styles.preview, title: message.content }, parts.preview),
    h('div', { style: { ...styles.muted, marginTop: '2px' } }, `ID: ${message.seq}`)))
}

function HitlRow({
  pending,
  lanes,
  sessionId,
  onOpenSession,
}: {
  pending: SwarmPanelHitl
  lanes: readonly string[]
  sessionId: string | undefined
  onOpenSession: (childId: string) => void
}): ReactNode {
  const humanIdx = Math.max(0, lanes.indexOf('human'))
  const openable = sessionId !== undefined && sessionId.length > 0
  const activate = (): void => {
    if (openable) onOpenSession(sessionId)
  }
  return h('div', {
    style: { ...styles.row, gridTemplateColumns: canvasColumns(lanes.length) },
    'data-flow-hitl': pending.requestId,
  },
  h('div', { style: { ...styles.time, gridColumn: 1 } },
    h('div', {}, formatClock(pending.requestedAt)),
    h('div', { style: { color: T.tertiary } }, formatUtcOffset(pending.requestedAt))),
  ...lanes.map((name, index) => h('div', {
    key: `hitl-grid-${name}`,
    'aria-hidden': true,
    style: { gridColumn: index + 2, gridRow: 1, borderLeft: `1px solid ${T.borderSoft}` },
  })),
  h('button', {
    type: 'button',
    style: { ...styles.hitl, gridColumn: humanIdx + 2, zIndex: 1 },
    title: pending.question,
    'aria-label': `Human input pending: ${pending.question}`,
    disabled: !openable,
    onClick: activate,
  },
  h('div', { style: styles.cardTitle },
    h('span', {}, 'Human input required'),
    h('span', { style: badgeStyle('human') }, 'Pending')),
  h('div', { style: { marginTop: '4px' } }, pending.question)))
}

function SwarmFlowView({
  swarm,
  onOpenSession,
  sessionId,
}: {
  swarm: SwarmPanelSwarm
  onOpenSession: (childId: string) => void
  sessionId: string | undefined
}): ReactNode {
  const messages = swarm.flow ?? []
  const [filter, setFilter] = useState<FlowFilter>('all')
  const [query, setQuery] = useState('')
  const [agent, setAgent] = useState('all')
  const [selectedSeq, setSelectedSeq] = useState<number | undefined>()
  const [live, setLive] = useState(true)
  const [pendingNew, setPendingNew] = useState(0)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const collectionRef = useRef<HTMLDivElement | null>(null)
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
  const hitlRows = visibleHitl(swarm.pendingHitl, filter, agent, query)
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

  const onCollectionKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      if (selectedSeq !== undefined) {
        event.preventDefault()
        setSelectedSeq(undefined)
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (filtered.length === 0) return
    event.preventDefault()
    const currentIndex = filtered.findIndex(message => message.seq === selectedSeq)
    const nextIndex = currentIndex < 0
      ? event.key === 'ArrowDown' ? 0 : filtered.length - 1
      : Math.max(0, Math.min(filtered.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)))
    const next = filtered[nextIndex]?.seq
    setSelectedSeq(next)
    const node = collectionRef.current?.querySelector(`[data-flow-seq="${next}"]`)
    if (node instanceof HTMLElement) node.focus()
  }

  const emptyCopy = emptyStateCopy({
    hasSwarm: true,
    terminated: swarm.terminated,
    filteredActive,
    messageCount: messages.length,
    pendingHitl: swarm.pendingHitl.length,
  })
  const showEmpty = filtered.length === 0 && hitlRows.length === 0
  const first = messages[0]?.sentAt
  const last = messages[messages.length - 1]?.sentAt
  const utcLabel = formatUtcOffset(first ?? last)

  return h('section', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }, 'data-swarm-id': swarm.swarmId },
    h('div', { style: styles.header },
      h('div', {},
        h('div', { style: styles.heading }, `swarm ${swarm.swarmId}`),
        h('div', { style: styles.muted }, meta.join(' · '))),
      h('span', { style: styles.badge }, swarm.topologyMode)),
    h('div', { style: styles.overview },
      h('div', { style: styles.topologyCard },
        h('div', { style: styles.sectionTitle }, `Swarm topology (${swarm.topologyMode})`),
        h('div', { style: styles.topologyRow, 'aria-label': 'swarm topology summary' },
          lanes.filter(name => name !== 'human').map((name, index) => {
            const visual = laneVisual(swarm, name)
            const kind = relationKind(name)
            const label = `${name} — ${visual.label}`
            return h('span', { key: name, style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
              index > 0 ? h('span', { style: { color: T.muted, fontSize: '16px' }, 'aria-hidden': true }, topologyArrow(swarm.topologyMode)) : null,
              visual.role !== undefined
                ? h('button', {
                    type: 'button',
                    style: styles.roleCardButton,
                    title: `${kind} · ${visual.role.childId}`,
                    'aria-label': label,
                    onClick: () => { onOpenSession(visual.role!.childId) },
                  },
                  h(RoleGlyph, { name, state: visual.state }),
                  h(RoleIdentity, { name, kind, state: visual.state, waiting: visual.waiting }))
                : h('span', { style: styles.roleCard, 'aria-label': label },
                    h(RoleGlyph, { name, state: visual.state }),
                    h(RoleIdentity, { name, kind, state: visual.state, waiting: visual.waiting })))
          }),
          swarm.topologyMode === 'mixed'
            ? h('span', { style: { ...styles.muted, whiteSpace: 'nowrap' } }, routeDistribution(messages))
            : null)),
      h('div', { style: styles.legend, 'aria-label': 'route legend' },
        h('div', {},
          h('div', { style: styles.sectionTitle }, 'Legend'),
          h('div', { style: styles.legendRow },
            h('span', { style: { width: 28, borderTop: `2px solid ${T.business}` }, 'aria-hidden': true }),
            h('span', { style: styles.muted }, 'Parent → Child')),
          h('div', { style: styles.legendRow },
            h('span', { style: { width: 28, borderTop: `2px dashed ${T.business}` }, 'aria-hidden': true }),
            h('span', { style: styles.muted }, 'Peer ↔ Peer')),
          h('div', { style: styles.legendRow },
            h('span', { style: { width: 28, borderTop: `2px dotted ${T.muted}` }, 'aria-hidden': true }),
            h('span', { style: styles.muted }, 'System / Mixed'))),
        h('div', {},
          h('div', { style: styles.sectionTitle }, 'Role status'),
          h('div', { style: styles.legendRow }, h(StatusDot, { state: 'active' }), h('span', { style: styles.muted }, 'Active')),
          h('div', { style: styles.legendRow }, h(StatusDot, { state: 'idle' }), h('span', { style: styles.muted }, 'Idle / Waiting')),
          h('div', { style: styles.legendRow }, h(StatusDot, { state: 'completed' }), h('span', { style: styles.muted }, 'Completed')),
          h('div', { style: styles.legendRow }, h(StatusDot, { state: 'error' }), h('span', { style: styles.muted }, 'Error'))))),
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
        : null),
    pendingNew > 0 && !live
      ? h('button', { type: 'button', style: styles.liveBanner, onClick: resumeLive }, `${pendingNew} new message${pendingNew === 1 ? '' : 's'} · resume live`)
      : null,
    h('div', { style: styles.body },
      h('div', { style: styles.flow },
        h('div', {
          style: { ...styles.laneHeader, gridTemplateColumns: canvasColumns(lanes.length) },
          'aria-label': 'agent lanes',
        },
        h('div', { key: 'time', style: { ...styles.lane, borderLeft: 0, fontWeight: 650 } },
          h('div', {}, 'Time'),
          h('div', { style: styles.muted, 'data-time-zone': utcLabel }, utcLabel)),
        ...lanes.map((name) => {
          const visual = laneVisual(swarm, name)
          const kind = relationKind(name)
          const label = `${name} — ${visual.label}`
          const body = [
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 650 } },
              h(RoleGlyph, { name, state: visual.state }),
              h('span', {}, name)),
            h('div', { style: { ...styles.muted, display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' } },
              h(StatusDot, { state: visual.state }),
              h('span', {}, `${kind} · ${visual.label}`)),
          ]
          return visual.role !== undefined
            ? h('button', { key: name, type: 'button', style: styles.laneButton, title: `${kind} · ${visual.role.childId}`, 'aria-label': label, onClick: () => { onOpenSession(visual.role!.childId) } }, ...body)
            : h('div', { key: name, style: styles.lane, title: `${kind} · ${visual.label}`, 'aria-label': label }, ...body)
        })),
        h('div', {
          ref: scrollerRef,
          style: styles.scroller,
          'data-flow-scroller': true,
          'data-live': live ? 'on' : 'paused',
          onScroll,
        },
        showEmpty
          ? h('div', { style: styles.empty },
              emptyCopy,
              filteredActive
                ? h('div', { style: { marginTop: '8px' } },
                    h('button', { type: 'button', style: styles.smallButton, onClick: clearFilters }, 'Clear filters'))
                : null)
          : h('div', {
              ref: collectionRef,
              role: 'listbox',
              tabIndex: 0,
              'aria-label': 'conversation messages',
              'aria-activedescendant': selectedSeq !== undefined ? `flow-msg-${selectedSeq}` : undefined,
              'data-flow-collection': true,
              onKeyDown: onCollectionKeyDown,
            },
            filtered.map(message => h(FlowMessageRow, {
              key: message.seq,
              message,
              lanes,
              selected: selectedSeq === message.seq,
              onSelect: setSelectedSeq,
            })),
            hitlRows.map(pending => h(HitlRow, {
              key: `lane-${pending.requestId}`,
              pending,
              lanes,
              sessionId,
              onOpenSession,
            }))))),
      h(MessageDetails, {
        swarm,
        message: selected,
        onOpenSession,
        onClose: () => { setSelectedSeq(undefined) },
      })),
    h('div', { style: styles.footer },
      h('div', { style: styles.footerStats },
        h('span', {}, `${filtered.length} visible · ${messages.length} total`),
        first !== undefined ? h('span', {}, `First: ${formatClock(first)}`) : null,
        last !== undefined ? h('span', {}, `Last: ${formatClock(last)}`) : null,
        first !== undefined && last !== undefined ? h('span', {}, `Duration: ${formatDuration(first, last)}`) : null,
        h('span', { 'data-live-indicator': live ? 'on' : 'paused', style: { color: live ? T.success : T.muted } }, live ? '● Live' : 'Paused')),
      h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', color: T.muted } },
        'Auto-scroll',
        h('input', {
          type: 'checkbox',
          checked: live,
          'aria-label': live ? 'Live follow on' : 'Live follow paused',
          onChange: () => { setLive(current => !current) },
        }))))
}

function PanelShell({ children }: { children: ReactNode }): ReactNode {
  return h('div', { style: styles.page, 'aria-label': 'Conversation Flow' }, children)
}

/** Pure panel body: renders one Conversation Flow section per swarm. */
export function SwarmPanelView({ model, onOpenSession, sessionId, projectionError }: SwarmPanelViewProps): ReactNode {
  if (projectionError !== undefined && projectionError.length > 0) {
    return h(PanelShell, { children: h('div', { style: styles.empty }, emptyStateCopy({
      projectionError,
      hasSwarm: false,
      terminated: false,
      filteredActive: false,
      messageCount: 0,
      pendingHitl: 0,
    })) })
  }
  if (model === undefined) {
    return h(PanelShell, { children: h('div', { style: styles.empty }, emptyStateCopy({
      waiting: true,
      hasSwarm: false,
      terminated: false,
      filteredActive: false,
      messageCount: 0,
      pendingHitl: 0,
    })) })
  }
  const swarms = model == null ? [] : Object.values(model)
  if (swarms.length === 0) {
    return h(PanelShell, { children: h('div', { style: styles.empty }, EMPTY_NO_SWARM) })
  }
  return h(PanelShell, {
    children: swarms.map(swarm => h(SwarmFlowView, { key: swarm.swarmId, swarm, onOpenSession, sessionId })),
  })
}

/**
 * Conversation Flow tab: full-page swimlanes over the `swarm` projection.
 * @param props - conversation-view slot currency plus the injected actions.
 * @returns the Conversation Flow page.
 */
export function SwarmConversationView(props: SwarmConversationViewProps): ReactNode {
  const sessionId = props.sessionId
  return h(SwarmPanelView, {
    model: props.useProjection('swarm'),
    onOpenSession: props.onOpenSession,
    ...(typeof sessionId === 'string' && sessionId.length > 0 ? { sessionId } : {}),
  })
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
