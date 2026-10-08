/**
 * Orchestrator AI tools: swarm_spawn, swarm_send_to, swarm_set_topology,
 * swarm_list_children, swarm_interrupt, swarm_terminate, swarm_checkpoint,
 * swarm_ask_user, swarm_start_chat, swarm_next_turn, swarm_set_context,
 * swarm_get_context, swarm_memory_write, swarm_memory_query.
 *
 * Tools are registered on the orchestrator root agent's exact tool scope.
 * Output schemas are `oneOf` discriminated unions (success value + error objects),
 * and every execute returns the canonical value directly or a `{ code, message }`
 * error, matching the exact inferred {@link InferValue} union.
 *
 * @module dsh-swarm-panel
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
// Type-only: merges `subagents` onto Context.
import type {} from '@deepseek-ai/dsh-subagent'
import { SwarmRuntime, type ChatDefaults, type RoleModel, type SwarmRuntimeConfig } from './runtime.ts'
import { isValidRoleName } from './domain.ts'
import { EngineError, runChatTurns } from './engine.ts'
import { queryMemories } from './memory.ts'
import { SwarmId, type SpeakerSelection } from './types.ts'

// ─── Canonical value and error unions ────────────────────────────────────────

/** The closed error union every swarm tool shares. */
type SwarmError =
  | { readonly code: 'invalid_argument'; readonly message: string }
  | { readonly code: 'not_found'; readonly message: string }
  | { readonly code: 'unavailable'; readonly message: string }
  | { readonly code: 'internal_error'; readonly message: string }

/** Successful `swarm_spawn` value. */
interface SpawnValue {
  readonly swarmId: string
  readonly roleName: string
  readonly childId: string
}

/** Successful `swarm_send_to` value. */
interface SendValue {
  readonly swarmId: string
  readonly from: string
  readonly to: string
  readonly delivered: true
}

/** Successful `swarm_list_children` value. */
interface ListValue {
  readonly swarmId: string
  readonly roles: Array<{
    readonly roleName: string
    readonly childId: string
    readonly status: string
    readonly model?: { readonly provider: string; readonly model: string }
  }>
  readonly topologyMode: string
  /** Unanswered HITL requests; a non-empty list after a cold resume means the operator never answered before the restart. */
  readonly pendingHitl: Array<{
    readonly requestId: string
    readonly question: string
    readonly requestedAt: string
  }>
}

/** Successful boolean acknowledgement. */
interface OkValue {
  readonly ok: true
}

/** Successful `swarm_checkpoint` value. */
interface CheckpointValue {
  readonly swarmId: string
  readonly savedAt: string
  readonly messageCount: number
  readonly roleCount: number
}

/** Successful `swarm_ask_user` value. */
interface AskValue {
  readonly swarmId: string
  readonly requestId: string
  readonly outcome: 'answered' | 'cancelled'
  readonly answer?: string
  readonly routedTo?: string
}

/** Successful `swarm_start_chat` value: the effective chat configuration. */
interface StartChatValue {
  readonly swarmId: string
  readonly topic: string
  readonly speakerSelection: string
  readonly maxTurns?: number
  readonly maxRounds?: number
  readonly terminationMessage?: string
}

/** Successful `swarm_next_turn` value. */
interface NextTurnValue {
  readonly swarmId: string
  readonly turns: Array<{ readonly speaker: string; readonly reply: string }>
  readonly ended: boolean
  readonly endReason?: string
}

/** Successful `swarm_set_context` value. */
interface SetContextValue {
  readonly swarmId: string
  readonly key: string
  readonly value: string
}

/** Successful `swarm_get_context` value. */
interface GetContextValue {
  readonly swarmId: string
  readonly entries: Array<{ readonly key: string; readonly value: string }>
}

/** Successful `swarm_memory_write` value. */
interface MemoryWriteValue {
  readonly swarmId: string
  readonly id: string
}

/** Successful `swarm_memory_query` value. */
interface MemoryQueryValue {
  readonly swarmId: string
  readonly query: string
  readonly entries: Array<{
    readonly id: string
    readonly text: string
    readonly tags?: string[]
    readonly by: string
    readonly writtenAt: string
    readonly score: number
  }>
}

// ─── Output schemas ───────────────────────────────────────────────────────────

function errorSchema<const C extends string>(code: C) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', required: true, const: code },
      message: { type: 'string', required: true },
    },
  } as const
}

const ERROR_SCHEMAS = [
  errorSchema('invalid_argument'),
  errorSchema('not_found'),
  errorSchema('unavailable'),
  errorSchema('internal_error'),
] as const

const SPAWN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    swarmId: { type: 'string', required: true },
    roleName: { type: 'string', required: true },
    childId: { type: 'string', required: true },
  },
} as const

const SEND_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    swarmId: { type: 'string', required: true },
    from: { type: 'string', required: true },
    to: { type: 'string', required: true },
    delivered: { type: 'boolean', required: true, const: true },
  },
} as const

const LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    swarmId: { type: 'string', required: true },
    roles: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          roleName: { type: 'string', required: true },
          childId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          model: {
            type: 'object',
            additionalProperties: false,
            properties: {
              provider: { type: 'string', required: true },
              model: { type: 'string', required: true },
            },
          },
        },
      },
    },
    topologyMode: { type: 'string', required: true },
    pendingHitl: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requestId: { type: 'string', required: true },
          question: { type: 'string', required: true },
          requestedAt: { type: 'string', required: true },
        },
      },
    },
  },
} as const

const OK_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true, const: true },
  },
} as const

const CHECKPOINT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    swarmId: { type: 'string', required: true },
    savedAt: { type: 'string', required: true },
    messageCount: { type: 'number', required: true },
    roleCount: { type: 'number', required: true },
  },
} as const

const ASK_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    swarmId: { type: 'string', required: true },
    requestId: { type: 'string', required: true },
    outcome: { type: 'string', required: true, enum: ['answered', 'cancelled'] },
    answer: { type: 'string' },
    routedTo: { type: 'string' },
  },
} as const

const START_CHAT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    swarmId: { type: 'string', required: true },
    topic: { type: 'string', required: true },
    speakerSelection: { type: 'string', required: true },
    maxTurns: { type: 'number' },
    maxRounds: { type: 'number' },
    terminationMessage: { type: 'string' },
  },
} as const

const NEXT_TURN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    swarmId: { type: 'string', required: true },
    turns: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          speaker: { type: 'string', required: true },
          reply: { type: 'string', required: true },
        },
      },
    },
    ended: { type: 'boolean', required: true },
    endReason: { type: 'string' },
  },
} as const

const SET_CONTEXT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    swarmId: { type: 'string', required: true },
    key: { type: 'string', required: true },
    value: { type: 'string', required: true },
  },
} as const

const GET_CONTEXT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    swarmId: { type: 'string', required: true },
    entries: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', required: true },
          value: { type: 'string', required: true },
        },
      },
    },
  },
} as const

const MEMORY_WRITE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    swarmId: { type: 'string', required: true },
    id: { type: 'string', required: true },
  },
} as const

const MEMORY_QUERY_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    swarmId: { type: 'string', required: true },
    query: { type: 'string', required: true },
    entries: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          text: { type: 'string', required: true },
          tags: { type: 'array', items: { type: 'string' } },
          by: { type: 'string', required: true },
          writtenAt: { type: 'string', required: true },
          score: { type: 'number', required: true },
        },
      },
    },
  },
} as const

// ─── Shared helpers ───────────────────────────────────────────────────────────

function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Stable error for an unexpected failure. */
function internalError(message: string): SwarmError {
  return { code: 'internal_error', message }
}

/** Stable error for an unknown swarm. */
function notFound(swarmId: string): SwarmError {
  return { code: 'not_found', message: `swarm ${swarmId} not found.` }
}

/**
 * Reject a mutating call on a terminated swarm with a tool-level code instead
 * of the runtime's internal error (audit G4-04/G4-06): after `swarm_terminate`
 * no tool may add roles, route messages, block on HITL, or write state.
 * @param runtime - the swarm the call targets.
 * @returns the error value, or undefined when the swarm still accepts changes.
 */
function terminatedError(runtime: SwarmRuntime): SwarmError | undefined {
  return runtime.isTerminated
    ? { code: 'invalid_argument', message: 'The swarm is terminated; no further changes are accepted.' }
    : undefined
}

const SPEAKER_SELECTIONS: readonly string[] = ['round_robin', 'random', 'auto', 'manual']

/** The validated effective chat configuration `swarm_start_chat` logs. */
interface EffectiveChatConfig {
  readonly topic: string
  readonly speakerSelection: SpeakerSelection
  readonly maxTurns?: number
  readonly maxRounds?: number
  readonly terminationMessage?: string
}

/**
 * Merge `swarm_start_chat` args over the deployment chat defaults, validating
 * every override. Misconfigured tool args fail as `invalid_argument`.
 */
function resolveChatConfig(
  defaults: ChatDefaults,
  args: {
    topic: string
    speakerSelection?: string
    maxTurns?: number
    maxRounds?: number
    terminationMessage?: string
  },
): EffectiveChatConfig | SwarmError {
  const speakerSelection = args.speakerSelection ?? defaults.speakerSelection
  if (!SPEAKER_SELECTIONS.includes(speakerSelection)) {
    return { code: 'invalid_argument', message: `speakerSelection must be one of ${SPEAKER_SELECTIONS.join(', ')}; got ${JSON.stringify(speakerSelection)}.` }
  }
  const maxTurns = args.maxTurns ?? defaults.maxTurns
  const maxRounds = args.maxRounds ?? defaults.maxRounds
  if (maxTurns !== undefined && (!Number.isInteger(maxTurns) || maxTurns < 1)) {
    return { code: 'invalid_argument', message: 'maxTurns must be a positive integer.' }
  }
  if (maxRounds !== undefined && (!Number.isInteger(maxRounds) || maxRounds < 1)) {
    return { code: 'invalid_argument', message: 'maxRounds must be a positive integer.' }
  }
  const terminationMessage = args.terminationMessage ?? defaults.terminationMessage
  return {
    topic: args.topic,
    speakerSelection: speakerSelection as SpeakerSelection,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(maxRounds !== undefined ? { maxRounds } : {}),
    ...(terminationMessage !== undefined ? { terminationMessage } : {}),
  }
}

// ─── Tool registration ────────────────────────────────────────────────────────

/**
 * Register all Orchestrator AI tools on the given agent's tool scope.
 *
 * The swarm registry is owned by the caller (per-root-agent in `index.ts`), never
 * module-level state, so disposal reverses every registration and leaves no leak.
 *
 * @param rootCtx - global service context owning `ctx.subagents`.
 * @param toolCtx - exact agent-scoped context receiving the definitions.
 * @param agent - exact live orchestrator whose session the tools mutate.
 * @param runtimes - the per-agent swarm registry the tools read and mutate.
 * @param config - deployment config (provider, default model, human input mode, chat defaults).
 * @returns idempotent aggregate disposer for the twelve registrations.
 */
export function registerSwarmTools(
  rootCtx: Context,
  toolCtx: Context,
  agent: Agent,
  runtimes: Map<string, SwarmRuntime>,
  config: SwarmRuntimeConfig,
): () => void {
  const disposers: Array<() => void> = []

  const runtimeFor = (swarmIdStr: string): SwarmRuntime => {
    let runtime = runtimes.get(swarmIdStr)
    if (runtime) return runtime
    const swarmId = SwarmId(swarmIdStr)
    runtime = new SwarmRuntime(rootCtx, agent, swarmId, config)
    runtimes.set(swarmIdStr, runtime)
    agent.session.append('swarm/created', {
      swarmId,
      createdAt: new Date().toISOString(),
    })
    return runtime
  }

  const isOrchestrator = (execAgent: Agent | undefined): boolean => execAgent === agent

  // ── swarm_spawn ──────────────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_spawn',
    description:
      'Spawn a named child agent role within the swarm. The child becomes a durable continuable '
      + 'sub-agent of the orchestrator. Each role has a unique name; re-spawning a named role '
      + 'replaces it. Optionally give the role a distinct model (provider + model id).',
    parameters: {
      swarmId: { type: 'string', description: 'The swarm to add the role to. Defaults to "default".' },
      roleName: {
        type: 'string',
        required: true,
        description: 'Stable role name (1-64 chars, no surrounding whitespace).',
      },
      systemPrompt: { type: 'string', description: 'Role definition delivered as the child\'s initial prompt.' },
      model: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', description: 'Provider route for this role.' },
          model: { type: 'string', description: 'Model id for this role.' },
        },
        description: 'Optional provider/model override for this role.',
      },
    },
    output: { schema: { oneOf: [SPAWN_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<SpawnValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_spawn requires the live orchestrator agent.')
      const swarmIdStr = args.swarmId ?? 'default'
      if (!isValidRoleName(args.roleName)) {
        return { code: 'invalid_argument', message: 'roleName must be 1-64 chars without surrounding whitespace.' }
      }
      const runtime = runtimeFor(swarmIdStr)
      const terminated = terminatedError(runtime)
      if (terminated !== undefined) return terminated
      try {
        const childId = await runtime.spawnRole(
          args.roleName,
          args.systemPrompt,
          args.model as RoleModel | undefined,
          exec.signal,
        )
        return { swarmId: swarmIdStr, roleName: args.roleName, childId }
      } catch (error) {
        return internalError(error instanceof Error ? error.message : String(error))
      }
    },
  })))

  // ── swarm_send_to ────────────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_send_to',
    description:
      'Send a message from one swarm role (or the orchestrator) to another role. The orchestrator '
      + 'relays all traffic. Attribution — which session id the recipient perceives as the sender — '
      + 'is decided by the current topology (see swarm_set_topology) unless an explicit attribution '
      + 'override is supplied. Use this to coordinate tasks and share context between roles.',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm to route within.' },
      from: { type: 'string', description: 'Sender role name, or "orchestrator" (default).' },
      to: { type: 'string', required: true, description: 'Recipient role name.' },
      content: { type: 'string', required: true, description: 'Message text to deliver.' },
      attribution: {
        type: 'string',
        enum: ['orchestrator', 'peer'],
        description: 'Explicit sender attribution; only meaningful in "mixed" topology.',
      },
    },
    output: { schema: { oneOf: [SEND_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<SendValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_send_to requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      const terminated = terminatedError(runtime)
      if (terminated !== undefined) return terminated
      try {
        await runtime.sendMessage(
          args.from ?? 'orchestrator',
          args.to,
          args.content,
          args.attribution,
          exec.signal,
        )
        return { swarmId: args.swarmId, from: args.from ?? 'orchestrator', to: args.to, delivered: true }
      } catch (error) {
        return internalError(error instanceof Error ? error.message : String(error))
      }
    },
  })))

  // ── swarm_set_topology ───────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_set_topology',
    description:
      'Set the communication topology mode for the swarm. "parent-child" attributes every message '
      + 'to the orchestrator (default, safest). "peer" lets child roles perceive messages as coming '
      + 'directly from sibling roles (P2P semantics). "mixed" lets the orchestrator choose attribution '
      + 'per message via swarm_send_to. The change takes effect on the next message.',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm to reconfigure.' },
      mode: { type: 'string', required: true, enum: ['parent-child', 'peer', 'mixed'] },
    },
    output: { schema: { oneOf: [OK_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<OkValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_set_topology requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      const terminated = terminatedError(runtime)
      if (terminated !== undefined) return terminated
      runtime.setTopology(args.mode)
      return { ok: true }
    },
  })))

  // ── swarm_list_children ──────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_list_children',
    description:
      'List every active role in a swarm with its durable child id, status, and model. Use this to '
      + 'know which roles are running and their identities before routing messages.',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm to list.' },
    },
    output: { schema: { oneOf: [LIST_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<ListValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_list_children requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      const state = runtime.state()
      return {
        swarmId: args.swarmId,
        roles: [...state.roles.values()].map(role => ({
          roleName: role.roleName,
          childId: role.childId,
          status: role.status,
          ...role.model !== undefined ? { model: role.model } : {},
        })),
        topologyMode: state.topologyMode,
        pendingHitl: state.pendingHitl.map(pending => ({
          requestId: pending.requestId,
          question: pending.question,
          requestedAt: pending.requestedAt,
        })),
      }
    },
  })))

  // ── swarm_interrupt ───────────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_interrupt',
    description:
      'Interrupt one or all child roles in the swarm. Interruption signals the agent to stop; it does '
      + 'not guarantee immediate termination. The role is removed from the active set with outcome '
      + '"interrupted". Omit roleName to interrupt every role.',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm to interrupt within.' },
      roleName: { type: 'string', description: 'Specific role to interrupt; omit for all.' },
    },
    output: { schema: { oneOf: [OK_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<OkValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_interrupt requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      try {
        // Exception-safe inside the runtime (audit G4-03): a rejected host
        // interrupt still records the durable exit fact.
        runtime.interrupt(args.roleName)
        return { ok: true }
      } catch (error) {
        return internalError(error instanceof Error ? error.message : String(error))
      }
    },
  })))

  // ── swarm_terminate ──────────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_terminate',
    description:
      'Terminate the entire swarm: interrupt every child role and mark the swarm destroyed. Use this '
      + 'when the swarm task is complete or must be abandoned.',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm to terminate.' },
    },
    output: { schema: { oneOf: [OK_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<OkValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_terminate requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      try {
        runtime.terminate('orchestrator-terminated')
        return { ok: true }
      } catch (error) {
        return internalError(error instanceof Error ? error.message : String(error))
      }
    },
  })))

  // ── swarm_checkpoint ───────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_checkpoint',
    description:
      'Save a checkpoint snapshot of the swarm\'s current state — roles with their child ids, '
      + 'topology, message count, and last speaker — to the durable session log. After a host '
      + 'restart the swarm cold-resumes from the latest checkpoint. Depending on plugin '
      + 'configuration, checkpoints may also be saved automatically; call this to pin a '
      + 'recovery point explicitly, for example before a risky redirection.',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm to checkpoint.' },
    },
    output: { schema: { oneOf: [CHECKPOINT_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<CheckpointValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_checkpoint requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      const state = runtime.state()
      const savedAt = runtime.saveCheckpoint('manual')
      return {
        swarmId: args.swarmId,
        savedAt,
        messageCount: state.messageCount,
        roleCount: state.roles.size,
      }
    },
  })))

  // ── swarm_ask_user ─────────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_ask_user',
    description:
      'Ask the human operator a question and wait for the answer. Use this to escalate a decision, '
      + 'request missing information, or confirm a risky redirection. The question and its outcome '
      + 'are recorded in the durable session log. Optionally route the answer to a role as a message '
      + 'attributed to "human". Terminating the swarm cancels a pending ask. Disabled when the plugin '
      + 'is configured with humanInputMode "NEVER".',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm the question belongs to.' },
      question: { type: 'string', required: true, description: 'The question presented to the operator.' },
      header: { type: 'string', description: 'Short label for the question UI.' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string', required: true, description: 'Selectable answer label.' },
            description: { type: 'string', description: 'What choosing this answer means.' },
          },
        },
        description: 'Selectable answers; the operator may also enter a custom answer.',
      },
      routeTo: { type: 'string', description: 'Role to deliver the answer to as a message from "human".' },
    },
    output: { schema: { oneOf: [ASK_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<AskValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_ask_user requires the live orchestrator agent.')
      if (config.humanInputMode === 'NEVER') {
        return { code: 'unavailable', message: 'Human input is disabled (humanInputMode: NEVER).' }
      }
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      const terminated = terminatedError(runtime)
      if (terminated !== undefined) return terminated
      try {
        const result = await runtime.askUser(args.question, args.header, args.options, exec.signal)
        let routedTo: string | undefined
        if (result.outcome === 'answered' && result.answer !== undefined && args.routeTo !== undefined) {
          await runtime.sendMessage('human', args.routeTo, result.answer, undefined, exec.signal)
          routedTo = args.routeTo
        }
        return {
          swarmId: args.swarmId,
          requestId: result.requestId,
          outcome: result.outcome,
          ...(result.answer !== undefined ? { answer: result.answer } : {}),
          ...(routedTo !== undefined ? { routedTo } : {}),
        }
      } catch (error) {
        return internalError(error instanceof Error ? error.message : String(error))
      }
    },
  })))

  // ── swarm_start_chat ───────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_start_chat',
    description:
      'Start an open group chat engine for the swarm: roles take turns speaking about a topic. '
      + 'Speaker selection: "round_robin" cycles in spawn order, "random" picks anyone but the '
      + 'previous speaker, "auto" means you decide each turn (pass `speaker` to swarm_next_turn), '
      + '"manual" asks the human operator. Stop conditions: maxTurns / maxRounds, a termination '
      + 'substring in a reply, or swarm_terminate. Omitted options fall back to the plugin '
      + 'configuration. Advance the chat with swarm_next_turn.',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm to start chatting in.' },
      topic: { type: 'string', required: true, description: 'The topic roles converse about; anchors every turn prompt.' },
      speakerSelection: {
        type: 'string',
        enum: ['round_robin', 'random', 'auto', 'manual'],
        description: 'How the next speaker is picked. Default from plugin config ("round_robin" unless configured).',
      },
      maxTurns: { type: 'number', description: 'Stop after this many turns (positive integer).' },
      maxRounds: { type: 'number', description: 'Stop after this many rounds; a round is every active role speaking once.' },
      terminationMessage: { type: 'string', description: 'Stop when a reply contains this substring.' },
    },
    output: { schema: { oneOf: [START_CHAT_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<StartChatValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_start_chat requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      const terminated = terminatedError(runtime)
      if (terminated !== undefined) return terminated
      const effective = resolveChatConfig(runtime.config.chat, args)
      if ('code' in effective) return effective
      try {
        runtime.startChat(effective)
        return {
          swarmId: args.swarmId,
          topic: effective.topic,
          speakerSelection: effective.speakerSelection,
          ...(effective.maxTurns !== undefined ? { maxTurns: effective.maxTurns } : {}),
          ...(effective.maxRounds !== undefined ? { maxRounds: effective.maxRounds } : {}),
          ...(effective.terminationMessage !== undefined ? { terminationMessage: effective.terminationMessage } : {}),
        }
      } catch (error) {
        return { code: 'invalid_argument', message: error instanceof Error ? error.message : String(error) }
      }
    },
  })))

  // ── swarm_next_turn ────────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_next_turn',
    description:
      'Advance the group chat by one or more turns: the engine picks the next speaker per the '
      + 'chat\'s speaker selection, delivers a turn prompt (topic + shared context + recent '
      + 'transcript), awaits the reply, and logs it to the group. Under speaker selection "auto" '
      + 'you must pass `speaker` — that is how you steer the conversation. Returns the turns taken '
      + 'and whether a stop condition ended the chat.',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm whose chat to advance.' },
      speaker: { type: 'string', description: 'Your speaker decision; required under speaker selection "auto".' },
      turns: { type: 'number', description: 'How many turns to advance (positive integer, default 1).' },
    },
    output: { schema: { oneOf: [NEXT_TURN_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<NextTurnValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_next_turn requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      try {
        const outcome = await runChatTurns(runtime, {
          ...(args.speaker !== undefined ? { speaker: args.speaker } : {}),
          ...(args.turns !== undefined ? { turns: args.turns } : {}),
        }, exec.signal)
        return {
          swarmId: args.swarmId,
          turns: outcome.turns.map(turn => ({ speaker: turn.speaker, reply: turn.reply })),
          ended: outcome.ended,
          ...(outcome.endReason !== undefined ? { endReason: outcome.endReason } : {}),
        }
      } catch (error) {
        if (error instanceof EngineError) return { code: error.code, message: error.message }
        return internalError(error instanceof Error ? error.message : String(error))
      }
    },
  })))

  // ── swarm_set_context ──────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_set_context',
    description:
      'Write a swarm-level context variable (key-value shared state). Every role sees the current '
      + 'context in its next group-chat turn prompt, and the values are checkpointed with the swarm. '
      + 'Use this for shared facts, decisions, and intermediate results roles must agree on.',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm to write context in.' },
      key: { type: 'string', required: true, description: 'Context variable name.' },
      value: { type: 'string', required: true, description: 'Context variable value.' },
      by: { type: 'string', description: 'Attribute the write to a role name; defaults to "orchestrator".' },
    },
    output: { schema: { oneOf: [SET_CONTEXT_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<SetContextValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_set_context requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      const terminated = terminatedError(runtime)
      if (terminated !== undefined) return terminated
      if (args.key.trim() !== args.key || args.key.length === 0) {
        return { code: 'invalid_argument', message: 'key must be non-empty without surrounding whitespace.' }
      }
      runtime.setContext(args.key, args.value, args.by ?? 'orchestrator')
      return { swarmId: args.swarmId, key: args.key, value: args.value }
    },
  })))

  // ── swarm_get_context ──────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_get_context',
    description:
      'Read swarm-level context variables: one entry when `key` is given, otherwise all entries. '
      + 'Roles receive the same values in their group-chat turn prompts.',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm to read context from.' },
      key: { type: 'string', description: 'Read only this variable; omit for all.' },
    },
    output: { schema: { oneOf: [GET_CONTEXT_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<GetContextValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_get_context requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      const context = runtime.state().context
      const entries = args.key !== undefined
        ? context.has(args.key) ? [{ key: args.key, value: context.get(args.key)! }] : []
        : [...context.entries()].map(([key, value]) => ({ key, value }))
      return { swarmId: args.swarmId, entries }
    },
  })))

  // ── swarm_memory_write ────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_memory_write',
    description:
      'Remember a swarm-level fact (a decision, finding, or constraint) for later retrieval. '
      + 'Memories live in the durable session log and survive a cold resume; retrieve them '
      + 'with swarm_memory_query (lexical scoring, tag hits weigh double).',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm to remember in.' },
      text: { type: 'string', required: true, description: 'The fact to remember.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Retrieval tags (exact hits weigh double).' },
      by: { type: 'string', description: 'Attribute the write to a role name; defaults to "orchestrator".' },
    },
    output: { schema: { oneOf: [MEMORY_WRITE_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<MemoryWriteValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_memory_write requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      const terminated = terminatedError(runtime)
      if (terminated !== undefined) return terminated
      if (args.text.trim().length === 0) {
        return { code: 'invalid_argument', message: 'text must be non-empty.' }
      }
      const id = runtime.writeMemory(args.text, args.by ?? 'orchestrator', args.tags)
      return { swarmId: args.swarmId, id }
    },
  })))

  // ── swarm_memory_query ────────────────────────────────────────────────────
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'swarm_memory_query',
    description:
      'Query swarm-level memories by free text: lexical token overlap with tag hits weighted '
      + 'double, best first, ties favor the later write. Returns at most `limit` entries '
      + '(deployment default when omitted).',
    parameters: {
      swarmId: { type: 'string', required: true, description: 'The swarm to query.' },
      query: { type: 'string', required: true, description: 'Free-text query.' },
      limit: { type: 'number', description: 'Maximum hits (positive integer); defaults to the deployment queryLimit.' },
    },
    output: { schema: { oneOf: [MEMORY_QUERY_VALUE_SCHEMA, ...ERROR_SCHEMAS] }, render: renderValue },
    async execute(args, exec): Promise<MemoryQueryValue | SwarmError> {
      if (!isOrchestrator(exec.agent)) return internalError('swarm_memory_query requires the live orchestrator agent.')
      const runtime = runtimes.get(args.swarmId)
      if (!runtime) return notFound(args.swarmId)
      if (args.query.trim().length === 0) {
        return { code: 'invalid_argument', message: 'query must be non-empty.' }
      }
      const limit = args.limit ?? runtime.config.memory.queryLimit
      if (!Number.isInteger(limit) || limit < 1) {
        return { code: 'invalid_argument', message: `limit must be a positive integer; got ${JSON.stringify(args.limit)}` }
      }
      const entries = queryMemories(runtime.state().memories, args.query, limit)
        .map(hit => ({
          id: hit.id,
          text: hit.text,
          ...(hit.tags !== undefined ? { tags: [...hit.tags] } : {}),
          by: hit.by,
          writtenAt: hit.writtenAt,
          score: hit.score,
        }))
      return { swarmId: args.swarmId, query: args.query, entries }
    },
  })))

  let active = true
  return () => {
    if (!active) return
    active = false
    for (const dispose of disposers.reverse()) dispose()
  }
}
