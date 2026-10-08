/**
 * Pure domain logic: session event folding and state reconstruction.
 * All state is derived from the session event log; no side effects.
 *
 * @module dsh-swarm-panel
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {
  SwarmId,
  TopologyMode,
  RoleState,
  SwarmState,
  PendingHitl,
  ChatState,
  ChatStartedData,
  SwarmMemoryEntry,
} from './types.ts'

/**
 * Fold every `swarm/*` session event into the current {@link SwarmState}.
 *
 * @param swarmId     - identity of the swarm (events for other swarms are ignored).
 * @param events      - the orchestrator session's full event log (`session.snapshotEvents()`).
 * @param liveTopology - the runtime's in-memory topology (persisted events take precedence).
 * @param memoryLimit - view cap for `memories` (latest N entries); omitted means unbounded.
 *   A VIEW crop, not log truncation: the log only grows, so the fold stays
 *   deterministic and replayable.
 * @returns the reconstructed swarm state.
 */
export function foldSwarmEvents(
  swarmId: SwarmId,
  events: readonly SessionEvent[],
  liveTopology: TopologyMode,
  memoryLimit?: number,
): SwarmState {
  const roles = new Map<string, RoleState>()
  const pendingHitl = new Map<string, PendingHitl>()
  const context = new Map<string, string>()
  const memories: SwarmMemoryEntry[] = []
  const transcript: Array<{ from: string; content: string }> = []
  let chatConfig: ChatStartedData | undefined
  let chatActive = false
  let topologyMode = liveTopology
  let terminated = false
  let messageCount = 0
  let lastSpeaker: string | undefined

  for (const event of events) {
    if (!event.type.startsWith('swarm/')) continue
    const data = event.data as { swarmId?: string }
    if (data.swarmId !== swarmId) continue

    switch (event.type) {
      case 'swarm/topology-changed':
        topologyMode = (event.data as { mode: TopologyMode }).mode
        break

      case 'swarm/role-spawned': {
        const spawned = event.data as {
          roleName: string
          childId: SessionId
          model?: { provider: string; model: string }
          systemPrompt?: string
        }
        roles.set(spawned.roleName, {
          roleName: spawned.roleName,
          childId: spawned.childId,
          ...(spawned.model !== undefined ? { model: spawned.model } : {}),
          ...(spawned.systemPrompt !== undefined ? { systemPrompt: spawned.systemPrompt } : {}),
          status: 'running',
        })
        break
      }

      case 'swarm/role-message': {
        messageCount += 1
        const message = event.data as { from: string; to: string; content: string }
        lastSpeaker = message.from
        if (message.to === 'group') transcript.push({ from: message.from, content: message.content })
        break
      }

      case 'swarm/role-exited': {
        const exited = event.data as { roleName: string; outcome: 'settled' | 'interrupted' | 'error' }
        const existing = roles.get(exited.roleName)
        if (existing) {
          roles.set(exited.roleName, {
            ...existing,
            status: 'exited',
            outcome: exited.outcome,
          })
        }
        break
      }

      case 'swarm/destroyed':
        terminated = true
        break

      case 'swarm/hitl-requested': {
        const requested = event.data as { requestId: string; question: string; requestedAt: string }
        pendingHitl.set(requested.requestId, {
          requestId: requested.requestId,
          question: requested.question,
          requestedAt: requested.requestedAt,
        })
        break
      }

      case 'swarm/hitl-resolved':
        pendingHitl.delete((event.data as { requestId: string }).requestId)
        break

      case 'swarm/chat-started':
        chatConfig = event.data as ChatStartedData
        chatActive = true
        break

      case 'swarm/chat-ended':
        chatActive = false
        break

      case 'swarm/context-updated': {
        const updated = event.data as { key: string; value: string }
        context.set(updated.key, updated.value)
        break
      }

      case 'swarm/memory-written': {
        const written = event.data as SwarmMemoryEntry
        memories.push({
          id: written.id,
          text: written.text,
          ...(written.tags !== undefined ? { tags: written.tags } : {}),
          by: written.by,
          writtenAt: written.writtenAt,
        })
        break
      }

      default:
        // swarm/created, swarm/checkpoint, and swarm/resumed do not affect folded state.
        break
    }
  }

  const chat: ChatState | undefined = chatConfig === undefined ? undefined : {
    topic: chatConfig.topic,
    speakerSelection: chatConfig.speakerSelection,
    ...(chatConfig.maxTurns !== undefined ? { maxTurns: chatConfig.maxTurns } : {}),
    ...(chatConfig.maxRounds !== undefined ? { maxRounds: chatConfig.maxRounds } : {}),
    ...(chatConfig.terminationMessage !== undefined ? { terminationMessage: chatConfig.terminationMessage } : {}),
    turnCount: transcript.length,
    transcript,
    active: chatActive,
  }

  return {
    swarmId,
    roles,
    topologyMode,
    terminated,
    messageCount,
    pendingHitl: [...pendingHitl.values()],
    context,
    memories: memoryLimit === undefined ? memories : memories.slice(-memoryLimit),
    ...(chat !== undefined ? { chat } : {}),
    ...(lastSpeaker !== undefined ? { lastSpeaker } : {}),
  }
}

/**
 * Collect every swarm id ever created in one session log, in creation order.
 * @param events - the orchestrator session's full event log (`session.snapshotEvents()`).
 * @returns distinct swarm ids from `swarm/created` events.
 */
export function collectSwarmIds(events: readonly SessionEvent[]): SwarmId[] {
  const ids: SwarmId[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (event.type !== 'swarm/created') continue
    const swarmId = (event.data as { swarmId: SwarmId }).swarmId
    if (seen.has(swarmId)) continue
    seen.add(swarmId)
    ids.push(swarmId)
  }
  return ids
}

/**
 * Find the `savedAt` of the latest checkpoint for one swarm.
 * @param swarmId - identity of the swarm.
 * @param events - the orchestrator session's full event log.
 * @returns the latest checkpoint's save instant, or `undefined` when none exists.
 */
export function latestCheckpointAt(
  swarmId: SwarmId,
  events: readonly SessionEvent[],
): string | undefined {
  let savedAt: string | undefined
  for (const event of events) {
    if (event.type !== 'swarm/checkpoint') continue
    const data = event.data as { swarmId?: string; savedAt: string }
    if (data.swarmId === swarmId) savedAt = data.savedAt
  }
  return savedAt
}

/**
 * List the messages routed TO one role, in log order. Cold resume replays
 * exactly this sequence into a re-spawned child.
 * @param swarmId - identity of the swarm.
 * @param events - the orchestrator session's full event log.
 * @param roleName - the recipient role.
 * @returns inbound routed messages in their original order.
 */
export function inboundMessages(
  swarmId: SwarmId,
  events: readonly SessionEvent[],
  roleName: string,
): ReadonlyArray<{ readonly from: string; readonly content: string }> {
  const inbound: Array<{ from: string; content: string }> = []
  for (const event of events) {
    if (event.type !== 'swarm/role-message') continue
    const data = event.data as { swarmId?: string; to: string; from: string; content: string }
    if (data.swarmId !== swarmId || data.to !== roleName) continue
    inbound.push({ from: data.from, content: data.content })
  }
  return inbound
}

// ─── Validation helpers ──────────────────────────────────────────────────────

/** Returns true when a roleName is valid (non-empty, no surrounding whitespace). */
export function isValidRoleName(roleName: string): boolean {
  return roleName.length > 0 && roleName.length <= 64 && roleName.trim() === roleName
}

// ─── Speaker selection ───────────────────────────────────────────────────────

/**
 * Pick the next speaker among the active roles.
 * - `round_robin`: the role after `lastSpeaker` in spawn order, wrapping; the
 *   first role when nothing was said (or the last speaker exited).
 * - `random`: a uniform pick excluding `lastSpeaker` (a lone role repeats).
 * @param speakers - active role names in spawn order.
 * @param lastSpeaker - the previous group speaker, when any.
 * @param mode - the automatic selection strategy.
 * @param random - randomness source, injected for deterministic tests.
 * @returns the next speaker, or `undefined` when no role is active.
 */
export function selectNextSpeaker(
  speakers: readonly string[],
  lastSpeaker: string | undefined,
  mode: 'round_robin' | 'random',
  random: () => number = Math.random,
): string | undefined {
  if (speakers.length === 0) return undefined
  if (mode === 'round_robin') {
    const index = lastSpeaker === undefined ? -1 : speakers.indexOf(lastSpeaker)
    return speakers[(index + 1) % speakers.length]
  }
  const candidates = speakers.length > 1 ? speakers.filter(speaker => speaker !== lastSpeaker) : [...speakers]
  return candidates[Math.floor(random() * candidates.length)]
}

/**
 * Completed rounds: one round is every active role speaking once. Derived as
 * `floor(turnCount / activeRoles)` — exact for `round_robin`, a documented
 * approximation once roles exit mid-chat or selection is non-cyclic.
 * @param turnCount - engine turns taken so far.
 * @param activeRoles - roles currently running.
 * @returns the number of completed rounds.
 */
export function completedRounds(turnCount: number, activeRoles: number): number {
  if (activeRoles <= 0) return 0
  return Math.floor(turnCount / activeRoles)
}
