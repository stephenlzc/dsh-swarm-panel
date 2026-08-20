/**
 * Durable and model-facing Swarm value types.
 *
 * Every `swarm/*` event payload is declared here and merged into
 * {@link SessionEventMap}, so `session.append('swarm/role-spawned', …)` type-checks
 * and the durable log reproduces the exact payload.
 *
 * @module dsh-swarm-panel
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
// The client-safe type-only subpath: importing the dsh-session root would drag
// its host-side `Context.sessions: SessionStore` merge into the client program.
import type { SessionId } from '@deepseek-ai/dsh-session/types'

// ─── Branded IDs ─────────────────────────────────────────────────────────────

/** Stable swarm identity, unique within one orchestrator session. */
export type SwarmId = Branded<'SwarmId'>

/**
 * Brand a string as a {@link SwarmId}.
 * @param id - the raw swarm id supplied by the model or config.
 * @returns the same string, branded.
 */
export function SwarmId(id: string): SwarmId {
  return id as SwarmId
}

// ─── Communication topology ──────────────────────────────────────────────────

/**
 * How a message is attributed when routed between roles.
 * - `parent-child`: the orchestrator is the perceived sender (default, safest).
 * - `peer`: the specified sending role is the perceived sender (P2P semantics).
 * - `mixed`: attribution is chosen per-message by the orchestrator.
 */
export type TopologyMode = 'parent-child' | 'peer' | 'mixed'

// ─── Session event payloads (SessionEventMap members) ────────────────────────

/** A swarm was created by the orchestrator. */
export interface SwarmCreatedData {
  /** Identity of the swarm this event belongs to. */
  readonly swarmId: SwarmId
  /** RFC 3339 UTC instant the swarm was created. */
  readonly createdAt: string
}

/** A child agent role was spawned. */
export interface RoleSpawnedData {
  readonly swarmId: SwarmId
  /** Stable role name within the swarm. */
  readonly roleName: string
  /** Durable child session id the role maps to. */
  readonly childId: SessionId
  /** Model override applied at spawn, if any. */
  readonly model?: { readonly provider: string; readonly model: string }
  /**
   * Role definition delivered as the child's initial prompt, retained so a
   * cold resume can re-spawn a lost child with its original definition.
   */
  readonly systemPrompt?: string
}

/** A message was routed between roles. */
export interface RoleMessageData {
  readonly swarmId: SwarmId
  /** Perceived sender: a role name, or `orchestrator`. */
  readonly from: string
  /** Perceived recipient role name. */
  readonly to: string
  /** Session id the recipient attributes the message to. */
  readonly senderSessionId: SessionId
  /** The routed message text. */
  readonly content: string
  /** RFC 3339 UTC instant the message was routed. */
  readonly sentAt: string
}

/** A role settled, was interrupted, or errored. */
export interface RoleExitedData {
  readonly swarmId: SwarmId
  readonly roleName: string
  readonly childId: SessionId
  readonly outcome: 'settled' | 'interrupted' | 'error'
  readonly exitedAt: string
}

/** The topology mode for a swarm changed. */
export interface TopologyChangedData {
  readonly swarmId: SwarmId
  readonly mode: TopologyMode
  readonly changedAt: string
}

/** A swarm was terminated. */
export interface SwarmDestroyedData {
  readonly swarmId: SwarmId
  /** Why the swarm ended. */
  readonly reason: string
  readonly destroyedAt: string
}

// ─── Checkpoint / resume ─────────────────────────────────────────────────────

/**
 * How often `swarm/checkpoint` snapshots are written.
 * - `auto`: after a structural change (spawn, exit, topology, terminate), at the next idle boundary.
 * - `manual`: only when the orchestrator calls the `swarm_checkpoint` tool.
 * - `per_turn`: after every turn that changed any swarm state, messages included.
 */
export type CheckpointFrequency = 'auto' | 'manual' | 'per_turn'

/** Why one checkpoint was saved. */
export type CheckpointReason = 'manual' | 'auto' | 'per_turn'

/** One role entry inside a checkpoint snapshot. */
export interface CheckpointRoleSnapshot {
  readonly roleName: string
  readonly childId: SessionId
  readonly status: 'running' | 'exited'
  readonly model?: { readonly provider: string; readonly model: string }
}

/**
 * A point-in-time snapshot of one swarm's folded state. Checkpoints are
 * markers over the event log: resume always re-folds the complete log, and the
 * latest checkpoint names the recovery point the resume started from.
 */
export interface SwarmCheckpointData {
  readonly swarmId: SwarmId
  /** Checkpoint payload format version. */
  readonly version: 1
  readonly reason: CheckpointReason
  readonly topologyMode: TopologyMode
  readonly roles: readonly CheckpointRoleSnapshot[]
  /** Number of `swarm/role-message` events routed so far. */
  readonly messageCount: number
  /** Context variables at save time, when any were set. */
  readonly context?: Readonly<Record<string, string>>
  /** Sender of the most recent routed message, when any. */
  readonly lastSpeaker?: string
  readonly savedAt: string
}

/** How one role was brought back during a cold resume. */
export interface RoleResumeRecord {
  readonly roleName: string
  /** The role's live child session id after resume (new when `respawned`). */
  readonly childId: SessionId
  /**
   * `resumed`: the durable child session was cold-resumed with its history
   * intact. `respawned`: the child session was lost, so the role was re-spawned
   * and its inbound messages replayed.
   */
  readonly action: 'resumed' | 'respawned'
}

/** A swarm's in-memory state was rebuilt from the durable log after a restart. */
export interface SwarmResumedData {
  readonly swarmId: SwarmId
  readonly roles: readonly RoleResumeRecord[]
  /** `savedAt` of the latest checkpoint the resume started from, when any. */
  readonly fromCheckpoint?: string
  readonly resumedAt: string
}

// ─── Human-in-the-loop ───────────────────────────────────────────────────────

/**
 * When the swarm may pause for operator input (AG2-style human input mode).
 * - `ALWAYS`: the `swarm_ask_user` tool is enabled; the turn engine also asks the operator after every round.
 * - `TERMINATE` (default): the tool is enabled; the engine asks only before automatic termination.
 * - `NEVER`: human input is disabled; `swarm_ask_user` fails with `unavailable`.
 */
export type HumanInputMode = 'ALWAYS' | 'TERMINATE' | 'NEVER'

/** The orchestrator asked the operator a question and is waiting for the answer. */
export interface HitlRequestedData {
  readonly swarmId: SwarmId
  /** Stable request id, unique within the swarm (`hitl-<n>`, n counts prior requests). */
  readonly requestId: string
  /** The question presented to the operator. */
  readonly question: string
  /** Short label for the question UI, when supplied. */
  readonly header?: string
  /** Selectable option labels, when the question is multiple-choice. */
  readonly options?: readonly string[]
  readonly requestedAt: string
}

/** A pending HITL request settled. */
export interface HitlResolvedData {
  readonly swarmId: SwarmId
  readonly requestId: string
  /**
   * `answered`: the operator replied. `cancelled`: the wait ended without an
   * answer — the swarm was terminated, the owning tool call was aborted, or
   * the ask provider failed.
   */
  readonly outcome: 'answered' | 'cancelled'
  /** The operator's answer text, when `answered`. */
  readonly answer?: string
  readonly resolvedAt: string
}

// ─── Group chat engine ───────────────────────────────────────────────────────

/**
 * How the turn engine picks the next speaker.
 * - `round_robin`: fixed spawn order, wrapping; continues from the last speaker after a resume.
 * - `random`: uniform pick excluding the previous speaker.
 * - `auto`: the orchestrator model decides and passes `speaker` to `swarm_next_turn`.
 * - `manual`: the engine asks the operator (via HITL) who speaks next.
 */
export type SpeakerSelection = 'round_robin' | 'random' | 'auto' | 'manual'

/** A group chat was configured and its engine started. */
export interface ChatStartedData {
  readonly swarmId: SwarmId
  /** The topic the roles converse about; anchors every turn prompt. */
  readonly topic: string
  readonly speakerSelection: SpeakerSelection
  /** Stop after this many engine turns. */
  readonly maxTurns?: number
  /** Stop after this many rounds (a round = every active role spoke once). */
  readonly maxRounds?: number
  /** Stop when a reply contains this substring. */
  readonly terminationMessage?: string
  readonly startedAt: string
}

/** The group chat engine stopped. */
export interface ChatEndedData {
  readonly swarmId: SwarmId
  /** Why the engine stopped, e.g. `max-turns`, `max-round`, `termination-message`, `operator-stopped`, `no-roles`. */
  readonly reason: string
  readonly endedAt: string
}

/** A swarm-level context variable was written. */
export interface ContextUpdatedData {
  readonly swarmId: SwarmId
  readonly key: string
  readonly value: string
  /** Who wrote it: `orchestrator`, `human`, or a role name. */
  readonly by: string
  readonly updatedAt: string
}

// ─── Lightweight memory ──────────────────────────────────────────────────────

/** One swarm-level memory entry (the fold projection of `swarm/memory-written`). */
export interface SwarmMemoryEntry {
  /** Stable entry id, unique within the swarm (`mem-<n>`, n counts prior writes). */
  readonly id: string
  /** The remembered fact. */
  readonly text: string
  /** Retrieval tags, when supplied. */
  readonly tags?: readonly string[]
  /** Who wrote it: `orchestrator`, `human`, or a role name. */
  readonly by: string
  readonly writtenAt: string
}

/** A swarm-level memory entry was written. */
export interface MemoryWrittenData extends SwarmMemoryEntry {
  readonly swarmId: SwarmId
}

// ─── Session event map merge ─────────────────────────────────────────────────

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'swarm/created': SwarmCreatedData
    'swarm/role-spawned': RoleSpawnedData
    'swarm/role-message': RoleMessageData
    'swarm/role-exited': RoleExitedData
    'swarm/topology-changed': TopologyChangedData
    'swarm/destroyed': SwarmDestroyedData
    'swarm/checkpoint': SwarmCheckpointData
    'swarm/resumed': SwarmResumedData
    'swarm/hitl-requested': HitlRequestedData
    'swarm/hitl-resolved': HitlResolvedData
    'swarm/chat-started': ChatStartedData
    'swarm/chat-ended': ChatEndedData
    'swarm/context-updated': ContextUpdatedData
    'swarm/memory-written': MemoryWrittenData
  }
}

// ─── Live state (fold projection) ────────────────────────────────────────────

/** The live state of one role within a swarm. */
export interface RoleState {
  readonly roleName: string
  readonly childId: SessionId
  readonly model?: { readonly provider: string; readonly model: string }
  /** Role definition recorded at spawn, used to re-spawn a lost child. */
  readonly systemPrompt?: string
  readonly status: 'running' | 'exited'
  readonly outcome?: 'settled' | 'interrupted' | 'error'
}

/** An unanswered HITL request in the fold projection. */
export interface PendingHitl {
  readonly requestId: string
  readonly question: string
  readonly requestedAt: string
}

/** Engine state of one swarm's group chat, reconstructed from the fold. */
export interface ChatState {
  readonly topic: string
  readonly speakerSelection: SpeakerSelection
  readonly maxTurns?: number
  readonly maxRounds?: number
  readonly terminationMessage?: string
  /** Engine turns taken so far (routed messages addressed to `group`). */
  readonly turnCount: number
  /** Group transcript in log order: `{ from, content }` per engine turn. */
  readonly transcript: ReadonlyArray<{ readonly from: string; readonly content: string }>
  /** False after `swarm/chat-ended`. */
  readonly active: boolean
}

/** The live state of one swarm, reconstructed from the session event fold. */
export interface SwarmState {
  readonly swarmId: SwarmId
  readonly roles: ReadonlyMap<string, RoleState>
  readonly topologyMode: TopologyMode
  readonly terminated: boolean
  /** Number of `swarm/role-message` events routed so far. */
  readonly messageCount: number
  /** Perceived sender of the most recent routed message, when any. */
  readonly lastSpeaker?: string
  /**
   * HITL requests with no matching `swarm/hitl-resolved`. A pending entry after
   * a cold resume means the operator never answered before the restart; no live
   * waiter survives, so the orchestrator should re-ask.
   */
  readonly pendingHitl: readonly PendingHitl[]
  /** Swarm-level context variables (last write wins per key). */
  readonly context: ReadonlyMap<string, string>
  /** Memory entries in write order (capped to the configured view window when set). */
  readonly memories: readonly SwarmMemoryEntry[]
  /** Group chat engine state, present once `swarm/chat-started` was logged. */
  readonly chat?: ChatState
}

// ─── Tool value types ────────────────────────────────────────────────────────

/** Successful `swarm_spawn` value. */
export interface SwarmSpawnValue {
  readonly swarmId: string
  readonly roleName: string
  readonly childId: string
}

/** Successful `swarm_send_to` value. */
export interface SwarmSendValue {
  readonly swarmId: string
  readonly from: string
  readonly to: string
  readonly delivered: true
}

/** Successful `swarm_list_children` value. */
export interface SwarmListValue {
  readonly swarmId: string
  readonly roles: ReadonlyArray<{
    readonly roleName: string
    readonly childId: string
    readonly status: string
    readonly model?: { readonly provider: string; readonly model: string }
  }>
  readonly topologyMode: TopologyMode
}

/** Successful boolean acknowledgement for topology/interrupt/terminate. */
export interface SwarmOkValue {
  readonly ok: true
}

/** Successful `swarm_checkpoint` value. */
export interface SwarmCheckpointValue {
  readonly swarmId: string
  readonly savedAt: string
  readonly messageCount: number
  readonly roleCount: number
}

/** Successful `swarm_ask_user` value. */
export interface SwarmAskUserValue {
  readonly swarmId: string
  readonly requestId: string
  readonly outcome: 'answered' | 'cancelled'
  /** The operator's answer text, when `answered`. */
  readonly answer?: string
  /** Role the answer was routed to, when requested. */
  readonly routedTo?: string
}

/** Successful `swarm_start_chat` value: the effective chat configuration. */
export interface SwarmStartChatValue {
  readonly swarmId: string
  readonly topic: string
  readonly speakerSelection: SpeakerSelection
  readonly maxTurns?: number
  readonly maxRounds?: number
  readonly terminationMessage?: string
}

/** One engine turn taken by `swarm_next_turn`. */
export interface SwarmTurnRecord {
  readonly speaker: string
  readonly reply: string
}

/** Successful `swarm_next_turn` value. */
export interface SwarmNextTurnValue {
  readonly swarmId: string
  readonly turns: readonly SwarmTurnRecord[]
  /** True when the engine hit a termination condition during this call. */
  readonly ended: boolean
  readonly endReason?: string
}

/** Successful `swarm_set_context` value. */
export interface SwarmSetContextValue {
  readonly swarmId: string
  readonly key: string
  readonly value: string
}

/** Successful `swarm_get_context` value. */
export interface SwarmGetContextValue {
  readonly swarmId: string
  readonly entries: ReadonlyArray<{ readonly key: string; readonly value: string }>
}

/** Successful `swarm_memory_write` value. */
export interface SwarmMemoryWriteValue {
  readonly swarmId: string
  /** The written entry's stable id (`mem-<n>`). */
  readonly id: string
}

/** One scored memory hit in a `swarm_memory_query` value. */
export interface SwarmMemoryHit extends SwarmMemoryEntry {
  /** Lexical relevance score (text token overlap + tag weight; see memory.ts). */
  readonly score: number
}

/** Successful `swarm_memory_query` value. */
export interface SwarmMemoryQueryValue {
  readonly swarmId: string
  /** Query echoed back for tool-result readability. */
  readonly query: string
  /** Highest-scoring entries first, at most the effective limit. */
  readonly entries: readonly SwarmMemoryHit[]
}
