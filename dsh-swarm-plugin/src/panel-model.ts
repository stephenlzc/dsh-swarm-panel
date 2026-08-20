/**
 * Swarm panel projection: the pure outlet shared by the host registration and
 * the browser client. Declares the `swarm` {@link SessionProjectionMap} key,
 * the wire-JSON panel model, and the incremental reducer the
 * session-projection registry drives over committed `swarm/*` events.
 *
 * This module is dependency-free (type-only imports only) so the client
 * bundle can consume the types without inlining any host runtime.
 *
 * @module dsh-swarm-panel
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { TopologyMode } from './types.ts'

// ─── Wire model ──────────────────────────────────────────────────────────────

/** One role row as the panel renders it (unbranded wire form of `RoleState`). */
export interface SwarmPanelRole {
  readonly roleName: string
  /** Durable child session id; changes when a cold resume re-spawns the role. */
  readonly childId: string
  readonly status: 'running' | 'exited'
  readonly outcome?: 'settled' | 'interrupted' | 'error'
  readonly model?: { readonly provider: string; readonly model: string }
}

/** One unanswered HITL request as the panel renders it. */
export interface SwarmPanelHitl {
  readonly requestId: string
  readonly question: string
  readonly requestedAt: string
}

/** One routed group message in log order (the chat transcript). */
export interface SwarmPanelMessage {
  readonly from: string
  readonly to: string
  readonly content: string
  readonly sentAt: string
}

/**
 * Maximum Conversation Flow messages retained in the panel projection.
 * Older `swarm/role-message` events remain in the session log.
 */
export const FLOW_WINDOW = 200

/** One routed message for the Conversation Flow view. */
export interface SwarmPanelFlowMessage {
  /** Session event sequence, used as the stable client key. */
  readonly seq: number
  /** Perceived sender: a role name, `orchestrator`, or `human`. */
  readonly from: string
  /** Perceived recipient role name, or `group`. */
  readonly to: string
  /** Durable session id the recipient attributed the message to. */
  readonly senderSessionId: string
  readonly content: string
  /** RFC 3339 UTC instant the message was routed. */
  readonly sentAt: string
  /**
   * Effective sender attribution for this message: `peer` when
   * `senderSessionId` matches a known role child session, otherwise
   * `orchestrator`. Independent of the swarm's global topology mode.
   */
  readonly attribution: 'orchestrator' | 'peer'
}

/** Group chat engine state as the panel renders it. */
export interface SwarmPanelChat {
  readonly topic: string
  readonly speakerSelection: string
  readonly maxTurns?: number
  readonly maxRounds?: number
  readonly terminationMessage?: string
  /** False after `swarm/chat-ended`. */
  readonly active: boolean
  readonly startedAt: string
  /** `swarm/chat-ended` reason, once the engine stopped. */
  readonly endReason?: string
}

/** One swarm's full panel state: topology, roster, timeline, HITL, checkpoint. */
export interface SwarmPanelSwarm {
  readonly swarmId: string
  readonly createdAt?: string
  readonly topologyMode: TopologyMode
  readonly terminated: boolean
  /** `swarm/destroyed` reason, once terminated. */
  readonly destroyReason?: string
  /** Number of `swarm/role-message` events routed so far. */
  readonly messageCount: number
  /** Perceived sender of the most recent routed message, when any. */
  readonly lastSpeaker?: string
  /** Roles in spawn order. */
  readonly roles: readonly SwarmPanelRole[]
  /** HITL requests with no matching `swarm/hitl-resolved`. */
  readonly pendingHitl: readonly SwarmPanelHitl[]
  /** Swarm-level context variables (last write wins per key). */
  readonly context: Readonly<Record<string, string>>
  /** Messages routed to `group`, in log order. */
  readonly transcript: readonly SwarmPanelMessage[]
  /** All routed messages, including role-to-role and group messages. */
  readonly flow: readonly SwarmPanelFlowMessage[]
  /** Engine state, present once `swarm/chat-started` was logged. */
  readonly chat?: SwarmPanelChat
  /** `savedAt` of the latest `swarm/checkpoint`, when any. */
  readonly latestCheckpointAt?: string
  /** `resumedAt` of the latest `swarm/resumed`, when any. */
  readonly lastResumedAt?: string
}

/**
 * The `swarm` projection value: every swarm of one session keyed by swarm id,
 * or `null` before the first `swarm/*` event (capability unused — clients
 * render nothing).
 */
export type SwarmPanelModel = Record<string, SwarmPanelSwarm> | null

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Panel model for every swarm orchestrated in the session: roster,
     * topology, Conversation Flow messages, group timeline, pending HITL, and
     * checkpoint markers, folded incrementally from `swarm/*` events.
     */
    swarm: SwarmPanelModel
  }
}

// ─── Incremental reducer ─────────────────────────────────────────────────────

/** Topology a swarm shows before its first `swarm/topology-changed` (the type default). */
const DEFAULT_TOPOLOGY: TopologyMode = 'parent-child'

/** Panel state of a swarm whose structural events have not arrived yet. */
function emptySwarm(swarmId: string): SwarmPanelSwarm {
  return {
    swarmId,
    topologyMode: DEFAULT_TOPOLOGY,
    terminated: false,
    messageCount: 0,
    roles: [],
    pendingHitl: [],
    context: {},
    transcript: [],
    flow: [],
  }
}

/** Wire-safe string: durable payloads may omit a field the panel still renders. */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Resolve the effective sender attribution from the durable session id. */
function messageAttribution(
  roles: readonly SwarmPanelRole[],
  senderSessionId: string,
): 'orchestrator' | 'peer' {
  if (senderSessionId.length === 0) return 'orchestrator'
  return roles.some(role => role.childId === senderSessionId) ? 'peer' : 'orchestrator'
}

/**
 * Upgrade historical orchestrator attributions after a later role spawn, but
 * never downgrade a recorded peer message (resume replaces live child ids).
 * @param flow - the swarm's current flow messages.
 * @param roles - the roster after the structural event.
 * @returns the same array reference when no attribution changes.
 */
function recomputeFlowAttribution(
  flow: readonly SwarmPanelFlowMessage[],
  roles: readonly SwarmPanelRole[],
): readonly SwarmPanelFlowMessage[] {
  let changed = false
  const next = flow.map((message) => {
    if (message.attribution === 'peer') return message
    const attribution = messageAttribution(roles, message.senderSessionId)
    if (attribution === message.attribution) return message
    changed = true
    return { ...message, attribution }
  })
  return changed ? next : flow
}

/** Append one flow message, dropping the oldest when the window is full. */
function appendFlow(
  flow: readonly SwarmPanelFlowMessage[],
  message: SwarmPanelFlowMessage,
): readonly SwarmPanelFlowMessage[] {
  const next = [...flow, message]
  return next.length <= FLOW_WINDOW ? next : next.slice(-FLOW_WINDOW)
}

/** Add or replace one role row, preserving spawn order. */
function upsertRole(roles: readonly SwarmPanelRole[], role: SwarmPanelRole): readonly SwarmPanelRole[] {
  const index = roles.findIndex(existing => existing.roleName === role.roleName)
  if (index < 0) return [...roles, role]
  const next = [...roles]
  next[index] = role
  return next
}

/**
 * Reduce one swarm entry over one `swarm/*` event. Returns the same reference
 * when the event changes nothing the panel shows.
 * @param swarm - the swarm's current panel state.
 * @param event - the committed session event (already known to carry this swarm's id).
 * @returns the next panel state for the swarm.
 */
function reduceSwarm(swarm: SwarmPanelSwarm, event: SessionEvent): SwarmPanelSwarm {
  switch (event.type) {
    case 'swarm/created': {
      const data = event.data as { createdAt: string }
      return swarm.createdAt === data.createdAt ? swarm : { ...swarm, createdAt: data.createdAt }
    }

    case 'swarm/topology-changed': {
      const data = event.data as { mode: TopologyMode }
      return { ...swarm, topologyMode: data.mode }
    }

    case 'swarm/role-spawned': {
      const data = event.data as {
        roleName: string
        childId: string
        model?: { provider: string; model: string }
      }
      const roles = upsertRole(swarm.roles, {
        roleName: data.roleName,
        childId: data.childId,
        status: 'running',
        ...(data.model !== undefined ? { model: data.model } : {}),
      })
      return {
        ...swarm,
        roles,
        flow: recomputeFlowAttribution(swarm.flow, roles),
      }
    }

    case 'swarm/role-message': {
      const data = event.data as {
        from?: unknown
        to?: unknown
        senderSessionId?: unknown
        content?: unknown
        sentAt?: unknown
      }
      const from = asString(data.from)
      const to = asString(data.to)
      const senderSessionId = asString(data.senderSessionId)
      const content = asString(data.content)
      const sentAt = asString(data.sentAt)
      return {
        ...swarm,
        messageCount: swarm.messageCount + 1,
        lastSpeaker: from,
        flow: appendFlow(swarm.flow, {
          seq: event.seq,
          from,
          to,
          senderSessionId,
          content,
          sentAt,
          attribution: messageAttribution(swarm.roles, senderSessionId),
        }),
        transcript: to === 'group'
          ? [...swarm.transcript, { from, to, content, sentAt }]
          : swarm.transcript,
      }
    }

    case 'swarm/role-exited': {
      const data = event.data as { roleName: string; outcome: 'settled' | 'interrupted' | 'error' }
      const existing = swarm.roles.find(role => role.roleName === data.roleName)
      if (existing === undefined) return swarm
      return {
        ...swarm,
        roles: upsertRole(swarm.roles, { ...existing, status: 'exited', outcome: data.outcome }),
      }
    }

    case 'swarm/destroyed': {
      const data = event.data as { reason: string }
      return { ...swarm, terminated: true, destroyReason: data.reason }
    }

    case 'swarm/checkpoint': {
      const data = event.data as { savedAt: string }
      return { ...swarm, latestCheckpointAt: data.savedAt }
    }

    case 'swarm/resumed': {
      // Live identity changes on resume: a re-spawned role gets a NEW child
      // session id, and every listed role is running again. The orchestrator
      // fold ignores this event (the runtime owns live state); the panel
      // reflects it so the roster never points at dead sessions.
      const data = event.data as { roles: readonly { roleName: string; childId: string }[]; resumedAt: string }
      let roles = swarm.roles
      for (const record of data.roles) {
        const existing = roles.find(role => role.roleName === record.roleName)
        roles = upsertRole(roles, {
          roleName: record.roleName,
          childId: record.childId,
          status: 'running',
          ...(existing?.model !== undefined ? { model: existing.model } : {}),
        })
      }
      return { ...swarm, roles, lastResumedAt: data.resumedAt }
    }

    case 'swarm/hitl-requested': {
      const data = event.data as { requestId: string; question: string; requestedAt: string }
      return {
        ...swarm,
        pendingHitl: [...swarm.pendingHitl, {
          requestId: data.requestId,
          question: data.question,
          requestedAt: data.requestedAt,
        }],
      }
    }

    case 'swarm/hitl-resolved': {
      const data = event.data as { requestId: string }
      if (!swarm.pendingHitl.some(pending => pending.requestId === data.requestId)) return swarm
      return {
        ...swarm,
        pendingHitl: swarm.pendingHitl.filter(pending => pending.requestId !== data.requestId),
      }
    }

    case 'swarm/chat-started': {
      const data = event.data as {
        topic: string
        speakerSelection: string
        maxTurns?: number
        maxRounds?: number
        terminationMessage?: string
        startedAt: string
      }
      return {
        ...swarm,
        chat: {
          topic: data.topic,
          speakerSelection: data.speakerSelection,
          active: true,
          startedAt: data.startedAt,
          ...(data.maxTurns !== undefined ? { maxTurns: data.maxTurns } : {}),
          ...(data.maxRounds !== undefined ? { maxRounds: data.maxRounds } : {}),
          ...(data.terminationMessage !== undefined ? { terminationMessage: data.terminationMessage } : {}),
        },
      }
    }

    case 'swarm/chat-ended': {
      const data = event.data as { reason: string }
      if (swarm.chat === undefined) return swarm
      return { ...swarm, chat: { ...swarm.chat, active: false, endReason: data.reason } }
    }

    case 'swarm/context-updated': {
      const data = event.data as { key: string; value: string }
      return { ...swarm, context: { ...swarm.context, [data.key]: data.value } }
    }

    default:
      // Future swarm/* events the panel does not model yet.
      return swarm
  }
}

/**
 * The projection unit's `apply`: fold one committed event into the panel
 * model. Events that carry no `swarm/*` type (or no swarm id) return the same
 * state reference, so the registry emits zero downstream work for them.
 * @param state - the model covering all prior events (`null` before the first swarm event).
 * @param event - the next committed session event.
 * @returns the next model (same reference when the event is not the unit's).
 */
export function applySwarmPanelEvent(state: SwarmPanelModel, event: SessionEvent): SwarmPanelModel {
  if (!event.type.startsWith('swarm/')) return state
  const swarmId = (event.data as { swarmId?: unknown }).swarmId
  if (typeof swarmId !== 'string') return state
  const current = state?.[swarmId]
  const reduced = reduceSwarm(current ?? emptySwarm(swarmId), event)
  if (current !== undefined && reduced === current) return state
  return { ...(state ?? {}), [swarmId]: reduced }
}
