/**
 * Group chat turn engine: advances a started chat one or more turns per
 * `swarm_next_turn` call.
 *
 * The engine is a pure driver over {@link SwarmRuntime}: every decision it
 * makes is either derived from the fold (speaker order, turn count, transcript)
 * or logged as it happens (group messages, chat-ended, HITL), so a cold resume
 * re-folds the exact continuation point and the next call picks up from
 * `lastSpeaker`.
 *
 * @module dsh-swarm-panel
 */

import { completedRounds, selectNextSpeaker } from './domain.ts'
import { RoleTurnError, type SwarmRuntime } from './runtime.ts'
import type { ChatState, SwarmState, SwarmTurnRecord } from './types.ts'

/** Engine failure with a tool-facing error code. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_argument' | 'unavailable',
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

/** Exhaustiveness guard for the closed SpeakerSelection union. */
function assertNever(value: never): never {
  throw new Error(`swarm: unexpected speaker selection ${JSON.stringify(value)}`)
}

/** `swarm_next_turn` arguments after tool-schema parsing. */
export interface NextTurnOptions {
  /** The orchestrator's speaker decision; required under `auto`. */
  readonly speaker?: string
  /** How many turns to advance; defaults to 1. */
  readonly turns?: number
}

/** What one `swarm_next_turn` call did. */
export interface ChatRunOutcome {
  readonly turns: readonly SwarmTurnRecord[]
  readonly ended: boolean
  readonly endReason?: string
}

/** Names of the roles still running, in spawn order. */
function activeRoles(state: SwarmState): string[] {
  return [...state.roles.values()]
    .filter(role => role.status === 'running')
    .map(role => role.roleName)
}

/** The termination condition a chat has already met, when any. */
function terminationReason(chat: ChatState, activeRoleCount: number): string | undefined {
  if (activeRoleCount === 0) return 'no-roles'
  if (chat.maxTurns !== undefined && chat.turnCount >= chat.maxTurns) return 'max-turns'
  if (chat.maxRounds !== undefined && completedRounds(chat.turnCount, activeRoleCount) >= chat.maxRounds) {
    return 'max-round'
  }
  const lastReply = chat.transcript.at(-1)?.content
  if (chat.terminationMessage !== undefined && lastReply !== undefined && lastReply.includes(chat.terminationMessage)) {
    return 'termination-message'
  }
  return undefined
}

/** Render the turn prompt: topic, shared context, and the recent transcript window. */
function buildTurnPrompt(chat: ChatState, context: ReadonlyMap<string, string>, speaker: string, window: number): string {
  const lines = [
    '[GROUP CHAT TURN]',
    `Topic: ${chat.topic}`,
  ]
  if (context.size > 0) {
    lines.push('', 'Shared context variables:')
    for (const [key, value] of context) lines.push(`${key} = ${value}`)
  }
  const recent = chat.transcript.slice(-window)
  if (recent.length > 0) {
    lines.push('', 'Recent transcript:')
    for (const message of recent) lines.push(`${message.from}: ${message.content}`)
  }
  lines.push('', `You are "${speaker}". Speak to the group: stay in role and reply concisely.`)
  return lines.join('\n')
}

/**
 * Pick the next speaker. `auto` takes the orchestrator's `speaker` decision;
 * `manual` asks the operator through HITL; the automatic strategies compute it.
 */
async function pickSpeaker(
  runtime: SwarmRuntime,
  state: SwarmState,
  chat: ChatState,
  option: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  const roles = activeRoles(state)
  const lastGroupSpeaker = chat.transcript.at(-1)?.from
  switch (chat.speakerSelection) {
    case 'round_robin':
    case 'random': {
      const speaker = selectNextSpeaker(roles, lastGroupSpeaker, chat.speakerSelection)
      if (speaker === undefined) throw new EngineError('swarm: no active role can speak.', 'invalid_argument')
      return speaker
    }
    case 'auto': {
      if (option === undefined) {
        throw new EngineError(
          'swarm: speakerSelection "auto" requires the orchestrator to pass `speaker` to swarm_next_turn.',
          'invalid_argument',
        )
      }
      if (!roles.includes(option)) throw new EngineError(`swarm: unknown or exited role ${option}`, 'invalid_argument')
      return option
    }
    case 'manual': {
      if (runtime.config.humanInputMode === 'NEVER') {
        throw new EngineError(
          'swarm: speakerSelection "manual" needs operator input, but humanInputMode is "NEVER".',
          'unavailable',
        )
      }
      const result = await runtime.askUser(
        `Swarm ${JSON.stringify(runtime.swarmId as string)}: who speaks next?`,
        'next speaker',
        roles.map(role => ({ label: role })),
        signal,
      )
      if (result.outcome !== 'answered' || result.answer === undefined || !roles.includes(result.answer)) {
        throw new EngineError(
          `swarm: operator did not name an active role (got ${JSON.stringify(result.answer ?? 'cancelled')}).`,
          'invalid_argument',
        )
      }
      return result.answer
    }
    default:
      return assertNever(chat.speakerSelection)
  }
}

/**
 * Ask the operator whether to stop, per humanInputMode.
 * @returns true to stop the engine.
 */
async function confirmStop(runtime: SwarmRuntime, question: string, signal: AbortSignal): Promise<boolean> {
  const result = await runtime.askUser(question, 'swarm control', [
    { label: 'Stop', description: 'End the group chat now.' },
    { label: 'Continue', description: 'Keep the chat running.' },
  ], signal)
  return result.outcome !== 'answered' || !/continue/i.test(result.answer ?? '')
}

/**
 * Advance the chat up to `options.turns` turns. Termination conditions are
 * re-checked from the fold before every turn; under humanInputMode `TERMINATE`
 * the operator confirms an automatic stop, and under `ALWAYS` the operator is
 * asked after every completed round whether to continue.
 * @param runtime - the swarm runtime whose chat to advance.
 * @param options - turn count and the orchestrator's speaker decision (`auto`).
 * @param signal - the owning tool call's cancellation.
 * @returns the turns taken and whether the chat ended during this call.
 */
export async function runChatTurns(
  runtime: SwarmRuntime,
  options: NextTurnOptions,
  signal: AbortSignal,
): Promise<ChatRunOutcome> {
  // Explicit serialization (audit G4-16): a second concurrent driver of the
  // same swarm fails loudly instead of interleaving two engines. The host
  // scheduler already runs these tools exclusively; this makes it a contract.
  if (!runtime.beginTurn()) {
    throw new EngineError('swarm: another turn is already in flight for this swarm.', 'unavailable')
  }
  try {
    return await driveChatTurns(runtime, options, signal)
  } finally {
    runtime.endTurn()
  }
}

/** The turn loop itself; the caller owns the runtime's turn slot. */
async function driveChatTurns(
  runtime: SwarmRuntime,
  options: NextTurnOptions,
  signal: AbortSignal,
): Promise<ChatRunOutcome> {
  const records: SwarmTurnRecord[] = []
  let ended = false
  let endReason: string | undefined
  const turnsWanted = options.turns ?? 1
  if (!Number.isInteger(turnsWanted) || turnsWanted < 1) {
    throw new EngineError('swarm: turns must be a positive integer.', 'invalid_argument')
  }

  for (let index = 0; index < turnsWanted; index++) {
    const state = runtime.state()
    const chat = state.chat
    if (chat === undefined) throw new EngineError('swarm: no chat started; call swarm_start_chat first.', 'invalid_argument')
    if (runtime.isTerminated || state.terminated) {
      ended = true
      endReason = 'swarm-terminated'
      break
    }
    if (!chat.active) {
      ended = true
      endReason = 'already-ended'
      break
    }

    const reason = terminationReason(chat, activeRoles(state).length)
    if (reason !== undefined) {
      const stops = runtime.config.humanInputMode === 'TERMINATE'
        ? await confirmStop(runtime, `The group chat met its stop condition (${reason}). Terminate?`, signal)
        : true
      if (stops) {
        runtime.endChat(reason)
        ended = true
        endReason = reason
        break
      }
      // The operator chose to continue: the condition is re-evaluated on the
      // next swarm_next_turn call.
    }

    const roundsBefore = completedRounds(chat.turnCount, activeRoles(state).length)
    const speaker = await pickSpeaker(runtime, state, chat, options.speaker, signal)
    const prompt = buildTurnPrompt(chat, state.context, speaker, runtime.config.chat.transcriptWindow)
    let reply: string
    try {
      reply = await runtime.runTurn(speaker, prompt, signal)
    } catch (error) {
      if (runtime.isTerminated) {
        // Terminated mid-turn: report the stop reason the fold already carries.
        runtime.endChat('swarm-terminated')
        ended = true
        endReason = 'swarm-terminated'
        break
      }
      if (error instanceof RoleTurnError) {
        // The speaker was interrupted, or never answered (audit G4-08): end the
        // chat with a reason instead of a misleading internal_error.
        const reason = error.reason === 'timeout' ? 'turn-timeout' : 'role-interrupted'
        runtime.endChat(reason)
        ended = true
        endReason = reason
        break
      }
      throw error
    }
    if (!runtime.recordGroupMessage(speaker, reply)) {
      // The role exited between the reply and the durable append (audit G4-08).
      runtime.endChat('role-interrupted')
      ended = true
      endReason = 'role-interrupted'
      break
    }
    records.push({ speaker, reply })

    const after = runtime.state().chat!
    if (runtime.config.humanInputMode === 'ALWAYS'
      && completedRounds(after.turnCount, activeRoles(state).length) > roundsBefore) {
      const stops = await confirmStop(
        runtime,
        `Round ${completedRounds(after.turnCount, activeRoles(state).length)} completed. Stop the group chat?`,
        signal,
      )
      if (stops) {
        runtime.endChat('operator-stopped')
        ended = true
        endReason = 'operator-stopped'
        break
      }
    }
  }

  return {
    turns: records,
    ended,
    ...(endReason !== undefined ? { endReason } : {}),
  }
}
