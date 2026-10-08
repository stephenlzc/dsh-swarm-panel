/**
 * Swarm function plugin — registers Orchestrator AI tools on every future root agent.
 *
 * Lifecycle mirrors `@deepseek-ai/dsh-schedule`: a `Map<Agent, OwnerCleanup>` tracks
 * every installed owner, each registered inside `agent.ctx.effect()` so agent disposal
 * reverses the tools and the runtime together. No module-level registry exists, so a
 * plugin stop or HMR replacement leaves no leaked swarm state.
 *
 * @module dsh-swarm-panel
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
// Type-only: merges `sessionProjections` onto Context so the optional `ctx.inject` resolves the service.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: merges `subagents` onto Context so `inject` resolves the service.
import type {} from '@deepseek-ai/dsh-subagent'
// Type-only: merges `userQuestions` onto Context so `inject` resolves the service.
import type {} from '@deepseek-ai/dsh-user-questions'
import { z as zod, type ZodType } from 'zod'
import { applySwarmPanelEvent, type SwarmPanelModel } from './panel-model.ts'
import { SwarmRuntime, type ChatDefaults, type MemoryDefaults, type SwarmRuntimeConfig } from './runtime.ts'
import { hydrateSwarmRuntimes, reactivateSwarmRoles } from './resume.ts'
import { registerSwarmTools } from './tools.ts'
import type { CheckpointFrequency, HumanInputMode, SpeakerSelection } from './types.ts'

export { SwarmId } from './types.ts'
export { RoleTurnError, SwarmRuntime, type ChatDefaults, type HitlAskResult, type HitlOption, type MemoryDefaults, type RoleModel, type SwarmRuntimeConfig } from './runtime.ts'
export { registerSwarmTools } from './tools.ts'
export { hydrateSwarmRuntimes, reactivateSwarmRoles } from './resume.ts'
export { EngineError, runChatTurns, type ChatRunOutcome, type NextTurnOptions } from './engine.ts'
export { queryMemories, scoreMemory, tokenize } from './memory.ts'
export {
  collectSwarmIds,
  completedRounds,
  foldSwarmEvents,
  inboundMessages,
  isValidRoleName,
  latestCheckpointAt,
  selectNextSpeaker,
} from './domain.ts'
export { applySwarmPanelEvent } from './panel-model.ts'
export type {
  SwarmPanelChat,
  SwarmPanelFlowMessage,
  SwarmPanelHitl,
  SwarmPanelMessage,
  SwarmPanelModel,
  SwarmPanelRole,
  SwarmPanelSwarm,
} from './panel-model.ts'
export type * from './types.ts'

/** Function plugin name. */
export const name = 'dsh-swarm-panel'

/**
 * Required services.
 * - `agents`: to observe `agent/created` and identify root agents.
 * - `tools`: to register Orchestrator tools per-agent.
 * - `subagents`: to spawn continuable children and route messages.
 * - `userQuestions`: to ask the operator from `swarm_ask_user`.
 */
export const inject = ['agents', 'tools', 'subagents', 'userQuestions'] as const

/** Checkpoint cadence for one deployment. */
export interface CheckpointConfig {
  /**
   * How often `swarm/checkpoint` snapshots are written. `auto` (default)
   * snapshots structural changes at idle boundaries, `per_turn` also snapshots
   * message-only progress after every turn, and `manual` snapshots only when
   * the orchestrator calls `swarm_checkpoint`.
   */
  readonly frequency?: CheckpointFrequency
}

/** Deployment-wide group chat defaults (cordis.yml `chat:` row). */
export interface ChatConfig {
  /** Speaker selection strategy. Defaults to `round_robin`. */
  readonly speakerSelection?: SpeakerSelection
  /** Stop after this many turns (positive integer). */
  readonly maxTurns?: number
  /** Stop after this many rounds (positive integer). */
  readonly maxRounds?: number
  /** Stop when a reply contains this substring. */
  readonly terminationMessage?: string
  /** Recent group messages carried in each turn prompt (positive integer, default 10). */
  readonly transcriptWindow?: number
}

/** Deployment-wide memory bounds (cordis.yml `memory:` row). */
export interface MemoryConfig {
  /** Fold view cap: only the latest N entries are visible to queries. Defaults to 200. */
  readonly maxEntries?: number
  /** Default `swarm_memory_query` result limit. Defaults to 5. */
  readonly queryLimit?: number
}

/**
 * Swarm plugin configuration (deployment choices, changeable from cordis.yml).
 */
export interface Config {
  /**
   * Master switch: when `false`, `apply` short-circuits without registering the
   * projection, the event vocabulary, or any per-agent effect. Defaults to
   * `true`. The plugin leaves no detectable footprint when disabled this way
   * (no `swarm/*` event types, no `ctx.sessionProjections.register('swarm', ...)`,
   * no `swarm_*` tools on future root agents).
   */
  enabled?: boolean
  /** The `ctx.subagents` provider used to spawn children. Defaults to `spawn`. */
  provider?: string
  /** Default child model when a role does not specify one. */
  defaultModel?: { readonly provider?: string; readonly model?: string }
  /** Checkpoint cadence. Defaults to `{ frequency: 'auto' }`. */
  checkpoint?: CheckpointConfig
  /** When the swarm may pause for operator input. Defaults to `TERMINATE`. */
  humanInputMode?: HumanInputMode
  /** Group chat engine defaults; `swarm_start_chat` args override per swarm. */
  chat?: ChatConfig
  /** Memory view bounds. Defaults to `{ maxEntries: 200, queryLimit: 5 }`. */
  memory?: MemoryConfig
  /**
   * Upper bound for one group-chat turn's reply wait, in milliseconds.
   * Defaults to 300000 (5 minutes). A turn that exceeds it ends the chat with
   * `turn-timeout` instead of leaving the tool call pending forever.
   */
  turnTimeoutMs?: number
  /**
   * Session-readability rescue switch. `enabled: false` normally removes the
   * event vocabulary too, which makes every previously written `swarm/*`
   * session unreadable (audit G4-02: the platform offers no `ignorable` write
   * path for out-of-repo events). Setting this `true` keeps the vocabulary
   * registered while every other contribution stays disabled.
   */
  keepEventVocabularyWhenDisabled?: boolean
}

const CHECKPOINT_FREQUENCIES: readonly CheckpointFrequency[] = ['auto', 'manual', 'per_turn']

/** Validate the configured checkpoint frequency at load, failing loud on misconfiguration. */
function resolveCheckpointFrequency(config: Config): CheckpointFrequency {
  const frequency = config.checkpoint?.frequency ?? 'auto'
  if (!CHECKPOINT_FREQUENCIES.includes(frequency)) {
    throw new Error(
      `dsh-swarm-panel: checkpoint.frequency must be one of ${CHECKPOINT_FREQUENCIES.join(', ')}; got ${JSON.stringify(frequency)}`,
    )
  }
  return frequency
}

const HUMAN_INPUT_MODES: readonly HumanInputMode[] = ['ALWAYS', 'TERMINATE', 'NEVER']

/** Validate the configured human input mode at load, failing loud on misconfiguration. */
function resolveHumanInputMode(config: Config): HumanInputMode {
  const mode = config.humanInputMode ?? 'TERMINATE'
  if (!HUMAN_INPUT_MODES.includes(mode)) {
    throw new Error(
      `dsh-swarm-panel: humanInputMode must be one of ${HUMAN_INPUT_MODES.join(', ')}; got ${JSON.stringify(mode)}`,
    )
  }
  return mode
}

const SPEAKER_SELECTIONS: readonly SpeakerSelection[] = ['round_robin', 'random', 'auto', 'manual']

/** Validate the chat defaults at load, failing loud on misconfiguration. */
function resolveChatDefaults(config: Config): ChatDefaults {
  const chat = config.chat ?? {}
  const speakerSelection = chat.speakerSelection ?? 'round_robin'
  if (!SPEAKER_SELECTIONS.includes(speakerSelection)) {
    throw new Error(
      `dsh-swarm-panel: chat.speakerSelection must be one of ${SPEAKER_SELECTIONS.join(', ')}; got ${JSON.stringify(speakerSelection)}`,
    )
  }
  for (const [field, value] of [
    ['chat.maxTurns', chat.maxTurns],
    ['chat.maxRounds', chat.maxRounds],
    ['chat.transcriptWindow', chat.transcriptWindow],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new Error(`dsh-swarm-panel: ${field} must be a positive integer; got ${JSON.stringify(value)}`)
    }
  }
  return {
    speakerSelection,
    transcriptWindow: chat.transcriptWindow ?? 10,
    ...(chat.maxTurns !== undefined ? { maxTurns: chat.maxTurns } : {}),
    ...(chat.maxRounds !== undefined ? { maxRounds: chat.maxRounds } : {}),
    ...(chat.terminationMessage !== undefined ? { terminationMessage: chat.terminationMessage } : {}),
  }
}

/** Validate the memory bounds at load, failing loud on misconfiguration. */
function resolveMemoryDefaults(config: Config): MemoryDefaults {
  const memory = config.memory ?? {}
  for (const [field, value] of [
    ['memory.maxEntries', memory.maxEntries],
    ['memory.queryLimit', memory.queryLimit],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new Error(`dsh-swarm-panel: ${field} must be a positive integer; got ${JSON.stringify(value)}`)
    }
  }
  return {
    maxEntries: memory.maxEntries ?? 200,
    queryLimit: memory.queryLimit ?? 5,
  }
}

/** Validate the configured turn timeout at load, failing loud on misconfiguration. */
function resolveTurnTimeout(config: Config): number {
  const value = config.turnTimeoutMs ?? 300000
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`dsh-swarm-panel: turnTimeoutMs must be a positive integer; got ${JSON.stringify(config.turnTimeoutMs)}`)
  }
  return value
}

/**
 * Every `swarm/*` session event type this plugin appends.
 *
 * The persistence read path refuses an unknown event type unless the stored
 * envelope carries `ignorable: true`, and Harness 0.2.0 rejects event-name
 * registration as its compatibility mechanism while `Session.append` exposes
 * no way for an out-of-repo plugin to write that marker (audit G4-02). The set
 * mutation below is therefore a process-local mitigation, not the supported
 * contract: it keeps swarm sessions readable exactly while this plugin is
 * loaded, so loading the plugin is a hard prerequisite for opening them.
 * Registration is an effect and is reference counted (audit G4-10) so two live
 * instances do not clobber each other.
 */
const SWARM_EVENT_TYPES: readonly string[] = [
  'swarm/created',
  'swarm/role-spawned',
  'swarm/role-message',
  'swarm/role-exited',
  'swarm/topology-changed',
  'swarm/destroyed',
  'swarm/checkpoint',
  'swarm/resumed',
  'swarm/hitl-requested',
  'swarm/hitl-resolved',
  'swarm/chat-started',
  'swarm/chat-ended',
  'swarm/context-updated',
  'swarm/memory-written',
]

/**
 * Live registrations of {@link registerSwarmEventTypes}. The vocabulary is a
 * process-global set, so the last disposer removes it (audit G4-10).
 */
let eventVocabularyRefs = 0

/**
 * Register this plugin's event vocabulary with the session persistence read
 * path until the returned disposer runs. `KNOWN_SESSION_EVENT_TYPES` is typed
 * `ReadonlySet` because first-party packages never mutate it; the cast is the
 * deferred out-of-repo registration surface named in the catalog's header.
 */
function registerSwarmEventTypes(): () => void {
  const known = KNOWN_SESSION_EVENT_TYPES as Set<string>
  if (eventVocabularyRefs === 0) {
    for (const type of SWARM_EVENT_TYPES) known.add(type)
  }
  eventVocabularyRefs += 1
  return () => {
    eventVocabularyRefs -= 1
    if (eventVocabularyRefs > 0) return
    eventVocabularyRefs = 0
    for (const type of SWARM_EVENT_TYPES) known.delete(type)
  }
}

type OwnerCleanup = () => void | Promise<void>

/** Wire payload schema of the `swarm` projection (every swarm of the session, or pre-first-event null). */
const swarmPanelModelSchema = zod.union([
  zod.record(zod.string(), zod.object({
    swarmId: zod.string(),
    createdAt: zod.string().optional(),
    topologyMode: zod.union([zod.literal('parent-child'), zod.literal('peer'), zod.literal('mixed')]),
    terminated: zod.boolean(),
    destroyReason: zod.string().optional(),
    messageCount: zod.number().int().nonnegative(),
    lastSpeaker: zod.string().optional(),
    roles: zod.array(zod.object({
      roleName: zod.string(),
      childId: zod.string(),
      status: zod.union([zod.literal('running'), zod.literal('exited')]),
      outcome: zod.union([zod.literal('settled'), zod.literal('interrupted'), zod.literal('error')]).optional(),
      model: zod.object({ provider: zod.string(), model: zod.string() }).optional(),
    })),
    pendingHitl: zod.array(zod.object({
      requestId: zod.string(),
      question: zod.string(),
      requestedAt: zod.string(),
    })),
    context: zod.record(zod.string(), zod.string()),
    transcript: zod.array(zod.object({
      from: zod.string(),
      to: zod.string(),
      content: zod.string(),
      sentAt: zod.string(),
    })),
    flow: zod.array(zod.object({
      seq: zod.number().int(),
      from: zod.string(),
      to: zod.string(),
      senderSessionId: zod.string(),
      content: zod.string(),
      sentAt: zod.string(),
      attribution: zod.union([zod.literal('orchestrator'), zod.literal('peer')]),
    })),
    chat: zod.object({
      topic: zod.string(),
      speakerSelection: zod.string(),
      maxTurns: zod.number().int().positive().optional(),
      maxRounds: zod.number().int().positive().optional(),
      terminationMessage: zod.string().optional(),
      active: zod.boolean(),
      // Optional on purpose (audit G4-13): a historical/foreign writer may omit
      // it, and a hard restore failure is worse than a missing label.
      startedAt: zod.string().optional(),
      endReason: zod.string().optional(),
    }).optional(),
    latestCheckpointAt: zod.string().optional(),
    lastResumedAt: zod.string().optional(),
  })),
  zod.null(),
]) as ZodType<SwarmPanelModel>

/**
 * Install Swarm only for root agents published after this plugin loads.
 * @param ctx - global service context.
 * @param config - deployment config (provider, default model).
 */
export function apply(ctx: Context, config: Config = {}): void {
  // Master switch: when explicitly disabled, leave the runtime untouched — no
  // projection, no event vocabulary, no per-agent effect or tool registration.
  if (config.enabled === false) {
    // Every other contribution stays disabled; the vocabulary alone may stay
    // registered so existing swarm sessions remain loadable (audit G4-02).
    if (config.keepEventVocabularyWhenDisabled === true) {
      ctx.effect(() => registerSwarmEventTypes(), 'dsh-swarm-panel.event-vocabulary()')
    }
    return
  }
  const provider = config.provider ?? 'spawn'
  const turnTimeoutMs = resolveTurnTimeout(config)
  const checkpointFrequency = resolveCheckpointFrequency(config)
  const humanInputMode = resolveHumanInputMode(config)
  const chatDefaults = resolveChatDefaults(config)
  const memoryDefaults = resolveMemoryDefaults(config)
  const owners = new Map<Agent, OwnerCleanup>()
  let stopping = false

  // The panel projection activates only when a session-projection registry is
  // composed (headless assemblies without the seam stay unaffected). One unit
  // serves every session: the registry drives `applySwarmPanelEvent` over each
  // session's committed events and keys the cells per Session.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'swarm', SwarmPanelModel>({
      key: 'swarm',
      // Host fold state schema: validates persisted state before it seeds a fold.
      stateSchema: swarmPanelModelSchema,
      init: () => null,
      apply: applySwarmPanelEvent,
      // Client view: the fold state is already the wire value, so both schemas
      // are the same shape and `view` is the identity.
      wire: { viewSchema: swarmPanelModelSchema, view: state => state },
      stateVersion: 2,
    })
  })

  ctx.effect(() => {
    // Register first, unwind last: the event vocabulary must outlive every
    // runtime that appends or reads swarm events.
    const unregisterEventTypes = registerSwarmEventTypes()
    const stopCreated = ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
      // Only future live root agents receive Swarm; already-published roots,
      // cold sessions, and children are never adopted. A session resumed from
      // persistence announces `agent/created` like a fresh one, so cold resume
      // flows through this same listener.
      if (stopping || owners.has(agent) || !ctx.agents.roots().includes(agent)) return

      // One per-agent swarm registry: swarms this orchestrator drives.
      const runtimes = new Map<string, SwarmRuntime>()
      const defaultModel = config.defaultModel
      const runtimeConfig: SwarmRuntimeConfig = {
        provider,
        humanInputMode,
        chat: chatDefaults,
        memory: memoryDefaults,
        turnTimeoutMs,
        ...(defaultModel !== undefined && (defaultModel.provider !== undefined || defaultModel.model !== undefined)
          ? { defaultModel: {
              ...(defaultModel.provider !== undefined ? { provider: defaultModel.provider } : {}),
              ...(defaultModel.model !== undefined ? { model: defaultModel.model } : {}),
            } }
          : {}),
      }

      const cleanup: OwnerCleanup = agent.ctx.effect(() => {
        const disposeTools = registerSwarmTools(ctx, agent.ctx, agent, runtimes, runtimeConfig)

        // Cold resume, phase one: synchronously rebuild runtimes for every
        // swarm recorded in this session's durable log, before any tool runs.
        const pendingResume = hydrateSwarmRuntimes(ctx, agent, runtimes, runtimeConfig)
        const resumeController = pendingResume.length > 0 ? new AbortController() : undefined
        if (resumeController !== undefined) {
          const signal = resumeController.signal
          // Phase two: re-establish each running role in the background.
          void (async () => {
            for (const swarmId of pendingResume) {
              const runtime = runtimes.get(swarmId as string)
              if (runtime === undefined) continue
              await reactivateSwarmRoles(runtime, agent, signal)
            }
          })().catch((error: unknown) => {
            if (!signal.aborted && !stopping) {
              ctx.logger.warn(
                `dsh-swarm-panel: cold resume failed for agent "${agent.id}": `
                + (error instanceof Error ? error.message : String(error)),
              )
            }
          })
        }

        // Automatic checkpoints at idle boundaries, per the configured cadence.
        const stopStatus = agent.ctx.on('agent/status', ({ status }: { status: string }) => {
          if (status !== 'idle') return
          for (const runtime of runtimes.values()) {
            if (runtime.needsCheckpoint(checkpointFrequency)) {
              runtime.saveCheckpoint(checkpointFrequency === 'per_turn' ? 'per_turn' : 'auto')
            }
          }
        })

        // NOTE (audit G4-07, deliberately not wired): the host's
        // `subagent-settled` notice marks the end of ONE activation, not the end
        // of the role — the same durable child is still addressable and can be
        // woken by a followup. Retiring the role on that notice broke the chat
        // engine outright (the speaker roster emptied after the spawn turn), so
        // the notice is not consumed here. `SwarmRuntime.markChildSettled`
        // remains available for a host that reports a terminal child end.
        return async () => {
          stopStatus()
          resumeController?.abort()
          disposeTools()
          for (const runtime of runtimes.values()) runtime.dispose()
          runtimes.clear()
        }
      }, 'dsh-swarm-panel.runtime()')

      owners.set(agent, cleanup)
    })

    return async () => {
      stopping = true
      stopCreated()
      const cleanups = [...owners.values()]
      owners.clear()
      await Promise.allSettled(cleanups.map(cleanup => Promise.resolve(cleanup())))
      unregisterEventTypes()
    }
  }, 'dsh-swarm-panel.lifecycle()')
}
