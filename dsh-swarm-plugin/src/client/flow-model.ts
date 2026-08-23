/**
 * Pure Conversation Flow helpers: role visual state, route kind, time labels,
 * filter matching, empty-copy selection, and elbow geometry. The React view
 * and its tests both import this module so assertions drive shipped logic.
 *
 * @module dsh-swarm-panel/client
 */

import type { SwarmPanelFlowMessage, SwarmPanelHitl, SwarmPanelRole, SwarmPanelSwarm } from '../panel-model.ts'

export type FlowFilter = 'all' | 'parent' | 'peer' | 'group' | 'human'
export type RouteKind = 'parent-child' | 'peer' | 'group'
export type RoleVisualState = 'active' | 'idle' | 'completed' | 'error'
export type RelationKind = 'parent' | 'child' | 'operator'

/** Four-state role status the topology strip and lane headers render. */
export function roleVisualState(args: {
  readonly name: string
  readonly terminated?: boolean
  readonly pendingHitl?: boolean
  readonly role?: SwarmPanelRole
}): RoleVisualState {
  if (args.name === 'human') return 'idle'
  if (args.name === 'orchestrator') return args.terminated === true ? 'completed' : 'active'
  const role = args.role
  if (role === undefined) return 'idle'
  if (role.status === 'running') return 'active'
  if (role.outcome === 'error') return 'error'
  return 'completed'
}

/** Visible status word. Human pending HITL is Idle · Waiting, not a fifth color. */
export function roleVisualLabel(state: RoleVisualState, waiting = false): string {
  if (state === 'active') return 'Active'
  if (state === 'error') return 'Error'
  if (state === 'completed') return 'Completed'
  return waiting ? 'Idle · Waiting' : 'Idle'
}

/** Host-token color for a visual state. Fallbacks keep AA contrast on the light canvas. */
export function roleStateColor(state: RoleVisualState): string {
  if (state === 'active') return 'var(--dsw-alias-state-success-primary)'
  if (state === 'idle') return 'var(--dsw-alias-state-warn-label)'
  if (state === 'error') return 'var(--dsw-alias-state-error-primary)'
  return 'var(--dsw-alias-label-tertiary)'
}

/** How a lane relates to the orchestrator. */
export function relationKind(name: string): RelationKind {
  if (name === 'orchestrator') return 'parent'
  if (name === 'human') return 'operator'
  return 'child'
}

/** Visible participant label; empty names stay inspectable. */
export function participantName(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : 'unknown'
}

/** Clock time for a stored timestamp; unparseable values render as written. */
export function formatClock(value: string): string {
  if (value.length === 0) return 'unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/**
 * UTC-offset label of the `UTC-7` kind for a timestamp (or the local zone
 * when `value` is empty / unparseable).
 */
export function formatUtcOffset(value?: string): string {
  const date = value !== undefined && value.length > 0 ? new Date(value) : new Date()
  const source = Number.isNaN(date.getTime()) ? new Date() : date
  const minutes = -source.getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  return rest === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(rest).padStart(2, '0')}`
}

/** Footer duration between two RFC 3339 instants (`HH:MM:SS`). */
export function formatDuration(start: string, end: string): string {
  const from = new Date(start).getTime()
  const to = new Date(end).getTime()
  if (Number.isNaN(from) || Number.isNaN(to)) return '—'
  const seconds = Math.max(0, Math.floor((to - from) / 1000))
  const hh = String(Math.floor(seconds / 3600)).padStart(2, '0')
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/** Per-message route used by badges, filters, and connector stroke. */
export function routeFor(message: SwarmPanelFlowMessage): RouteKind {
  if (message.to === 'group') return 'group'
  return message.attribution === 'peer' ? 'peer' : 'parent-child'
}

/** Visible route badge copy. Color is never the only distinguisher. */
export function routeLabel(route: RouteKind): string {
  if (route === 'peer') return 'peer ↔ peer'
  if (route === 'group') return 'group'
  return 'parent → child'
}

/** Kind chip for the message card. */
export function messageKind(message: SwarmPanelFlowMessage): 'direct' | 'group' | 'human' {
  if (message.from === 'human' || message.to === 'human') return 'human'
  if (message.to === 'group') return 'group'
  return 'direct'
}

export function filterLabel(filter: FlowFilter): string {
  if (filter === 'parent') return 'Parent → Child'
  if (filter === 'peer') return 'Peer ↔ Peer'
  if (filter === 'group') return 'Mixed / System'
  if (filter === 'human') return 'Human input'
  return 'All messages'
}

export function filterMatch(message: SwarmPanelFlowMessage, filter: FlowFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'parent') return routeFor(message) === 'parent-child'
  if (filter === 'peer') return routeFor(message) === 'peer'
  if (filter === 'group') return routeFor(message) === 'group'
  return message.from === 'human' || message.to === 'human'
}

export function countFor(messages: readonly SwarmPanelFlowMessage[], filter: FlowFilter): number {
  return messages.filter(message => filterMatch(message, filter)).length
}

export function matches(
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

export function openableRole(swarm: SwarmPanelSwarm, name: string): SwarmPanelRole | undefined {
  return swarm.roles.find(role => role.roleName === name)
}

/** Stable swimlane order: orchestrator, spawn order, extras, Human last. */
export function lanesFor(swarm: SwarmPanelSwarm, messages: readonly SwarmPanelFlowMessage[]): string[] {
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
export function canvasColumns(laneCount: number): string {
  const minWidth = laneCount > 5 ? 'clamp(92px, 11vw, 132px)' : '132px'
  return `76px repeat(${laneCount}, minmax(${minWidth}, 1fr))`
}

export function topologyArrow(mode: SwarmPanelSwarm['topologyMode']): string {
  if (mode === 'peer') return '↔'
  if (mode === 'mixed') return '⇆'
  return '→'
}

export function routeDistribution(messages: readonly SwarmPanelFlowMessage[]): string {
  const parent = messages.filter(message => routeFor(message) === 'parent-child').length
  const peer = messages.filter(message => routeFor(message) === 'peer').length
  const group = messages.filter(message => routeFor(message) === 'group').length
  return `parent-child ${parent} · peer ${peer} · group ${group}`
}

/** First line of a message, used as the card title in the speaker's lane. */
export function messageParts(message: SwarmPanelFlowMessage): { title: string; preview: string } {
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

/**
 * SVG path in a `0 0 laneCount 1` viewBox: sender-column exit, vertical jog,
 * receiver-column entry. Empty when from and to share a lane.
 */
export function elbowPath(fromIdx: number, toIdx: number): string {
  if (fromIdx === toIdx) return ''
  const rightward = fromIdx < toIdx
  const x1 = fromIdx + (rightward ? 0.88 : 0.12)
  const x2 = toIdx + (rightward ? 0.12 : 0.88)
  const y1 = 0.36
  const y2 = 0.64
  const mid = (x1 + x2) / 2
  return `M ${x1.toFixed(3)} ${y1} H ${mid.toFixed(3)} V ${y2} H ${x2.toFixed(3)}`
}

export function connectorDash(route: RouteKind): string | undefined {
  if (route === 'peer') return '5 4'
  if (route === 'group') return '2 3'
  return undefined
}

export function unavailableReason(name: string, role: SwarmPanelRole | undefined): string {
  if (name === 'orchestrator') return 'The orchestrator is the current session.'
  if (name === 'human') return 'Human input has no child session.'
  if (name === 'group') return 'Group messages have no single recipient session.'
  if (role === undefined) return `No child session for ${name}.`
  return ''
}

export function metadataPayload(message: SwarmPanelFlowMessage): string {
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

export const EMPTY_NO_SWARM = 'No swarm in this session. Ask the Orchestrator to create one and spawn roles.'
export const EMPTY_WAITING_PROJECTION = 'Waiting for swarm projection.'
export const EMPTY_PROJECTION_ERROR = 'Swarm projection error.'
export const EMPTY_NO_MESSAGES = 'No messages recorded for this swarm yet.'
export const EMPTY_NO_MATCH = 'No matching messages. Clear filters to see the full flow.'
export const EMPTY_TERMINATED = 'This swarm has terminated and recorded no messages.'
export const EMPTY_PENDING_HITL = 'Waiting for human input. Pending HITL is shown in the Human lane.'

/** Empty-canvas copy. Projection error and waiting outrank swarm emptiness. */
export function emptyStateCopy(args: {
  readonly projectionError?: string
  readonly waiting?: boolean
  readonly hasSwarm: boolean
  readonly terminated: boolean
  readonly filteredActive: boolean
  readonly messageCount: number
  readonly pendingHitl: number
}): string {
  if (args.projectionError !== undefined && args.projectionError.length > 0) {
    return `${EMPTY_PROJECTION_ERROR} ${args.projectionError}`.trim()
  }
  if (args.waiting === true) return EMPTY_WAITING_PROJECTION
  if (!args.hasSwarm) return EMPTY_NO_SWARM
  if (args.filteredActive) return EMPTY_NO_MATCH
  if (args.terminated && args.messageCount === 0) return EMPTY_TERMINATED
  if (args.pendingHitl > 0 && args.messageCount === 0) return EMPTY_PENDING_HITL
  if (args.messageCount === 0) return EMPTY_NO_MESSAGES
  return EMPTY_NO_MATCH
}

export function laneVisual(
  swarm: SwarmPanelSwarm,
  name: string,
): { state: RoleVisualState; label: string; waiting: boolean; role: SwarmPanelRole | undefined } {
  const role = openableRole(swarm, name)
  const waiting = name === 'human' && swarm.pendingHitl.length > 0
  const state = roleVisualState({
    name,
    terminated: swarm.terminated,
    pendingHitl: waiting,
    ...(role !== undefined ? { role } : {}),
  })
  return { state, label: roleVisualLabel(state, waiting), waiting, role }
}

export function visibleHitl(
  pending: readonly SwarmPanelHitl[],
  filter: FlowFilter,
  agent: string,
  query = '',
): readonly SwarmPanelHitl[] {
  if (pending.length === 0) return []
  if (filter !== 'all' && filter !== 'human') return []
  if (agent !== 'all' && agent !== 'human') return []
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return pending
  return pending.filter(item => item.question.toLowerCase().includes(needle))
}
