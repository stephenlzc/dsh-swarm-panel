/**
 * Per-agent Swarm runtime: manages child agents, topology, and the session event log.
 *
 * Each SwarmRuntime belongs to one orchestrator root Agent. Children are spawned
 * through `ctx.subagents.startContinuable()` (durable continuable children), so the
 * orchestrator is their exact direct parent and `followup()` authorization holds.
 * Relay attribution through `senderSessionId` enables P2P semantics without new
 * security primitives.
 *
 * @module dsh-swarm-panel
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: merges `subagents` onto Context and `subagent/*` events.
import type {} from '@deepseek-ai/dsh-subagent'
// Type-only: merges `userQuestions` onto Context.
import type {} from '@deepseek-ai/dsh-user-questions'
import type {
  SwarmId,
  TopologyMode,
  SwarmState,
  CheckpointFrequency,
  CheckpointReason,
  HumanInputMode,
  SpeakerSelection,
} from './types.ts'
import { foldSwarmEvents } from './domain.ts'

/** Model selection for one spawned role. */
export interface RoleModel {
  readonly provider?: string
  readonly model?: string
}

/** Selectable answer option for one HITL question. */
export interface HitlOption {
  readonly label: string
  readonly description?: string
}

/** How one `swarm_ask_user` wait settled. */
export interface HitlAskResult {
  readonly requestId: string
  readonly outcome: 'answered' | 'cancelled'
  /** The operator's answer text, when `answered`. */
  readonly answer?: string
}

/** Deployment-wide group chat defaults; `swarm_start_chat` args override per swarm. */
export interface ChatDefaults {
  /** Speaker selection strategy. Defaults to `round_robin`. */
  readonly speakerSelection: SpeakerSelection
  /** How many recent group messages each turn prompt carries. */
  readonly transcriptWindow: number
  /** Default stop conditions. */
  readonly maxTurns?: number
  readonly maxRounds?: number
  readonly terminationMessage?: string
}

/** Deployment memory view bounds. */
export interface MemoryDefaults {
  /** Fold view cap: only the latest N entries are visible to queries (the log itself is never truncated). */
  readonly maxEntries: number
  /** Default `swarm_memory_query` result limit. */
  readonly queryLimit: number
}

/** Deployment config that shapes runtime behavior. */
export interface SwarmRuntimeConfig {
  /** The `ctx.subagents` provider used to spawn children. */
  readonly provider: string
  /** Default child model when a role does not specify one. */
  readonly defaultModel?: RoleModel
  /** When the swarm may pause for operator input. */
  readonly humanInputMode: HumanInputMode
  /** Group chat engine defaults. */
  readonly chat: ChatDefaults
  /** Memory view bounds. */
  readonly memory: MemoryDefaults
}

/** One process-local, disposable Swarm runtime attached to one orchestrator root agent. */
export class SwarmRuntime {
  /** role name → durable child session id. */
  private readonly children = new Map<string, SessionId>()
  /** Live HITL waits, request id → cancellation. A pending wait is swarm-level: role interrupts do not touch it, terminate/dispose cancel it. */
  private readonly pendingHitl = new Map<string, AbortController>()
  private topology: TopologyMode = 'parent-child'
  private terminated = false
  /** Structural state (roles, topology, termination) changed since the last checkpoint. */
  private structuralDirty = false
  /** Messages were routed since the last checkpoint. */
  private messagesDirty = false

  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
    public readonly swarmId: SwarmId,
    public readonly config: SwarmRuntimeConfig,
  ) {}

  /** Current topology mode. */
  get currentTopology(): TopologyMode {
    return this.topology
  }

  /** Whether this swarm has been terminated. */
  get isTerminated(): boolean {
    return this.terminated
  }

  /**
   * Restore this runtime's in-memory state from a folded event log. Used only
   * by cold resume, immediately after construction, before any tool runs.
   * @param state - the fold of this swarm's durable events.
   */
  hydrate(state: SwarmState): void {
    this.topology = state.topologyMode
    this.terminated = state.terminated
    this.children.clear()
    for (const role of state.roles.values()) {
      if (role.status === 'running') this.children.set(role.roleName, role.childId)
    }
  }

  /**
   * Whether a checkpoint is due at the next idle boundary under `frequency`.
   * `auto` snapshots structural changes only; `per_turn` also snapshots
   * message-only progress. `manual` never snapshots automatically.
   * @param frequency - the configured checkpoint frequency.
   */
  needsCheckpoint(frequency: CheckpointFrequency): boolean {
    if (frequency === 'manual') return false
    if (frequency === 'per_turn') return this.structuralDirty || this.messagesDirty
    return this.structuralDirty
  }

  /**
   * Append a `swarm/checkpoint` snapshot of the current folded state and clear
   * the dirty flags. Checkpoints are markers over the log: resume re-folds the
   * complete log and names the latest checkpoint as its recovery point.
   * @param reason - why this checkpoint is saved.
   * @returns the checkpoint's save instant.
   */
  saveCheckpoint(reason: CheckpointReason): string {
    const state = this.state()
    const savedAt = new Date().toISOString()
    this.agent.session.append('swarm/checkpoint', {
      swarmId: this.swarmId,
      version: 1,
      reason,
      topologyMode: state.topologyMode,
      roles: [...state.roles.values()].map(role => ({
        roleName: role.roleName,
        childId: role.childId,
        status: role.status,
        ...(role.model !== undefined ? { model: role.model } : {}),
      })),
      messageCount: state.messageCount,
      ...(state.context.size > 0 ? { context: Object.fromEntries(state.context) } : {}),
      ...(state.lastSpeaker !== undefined ? { lastSpeaker: state.lastSpeaker } : {}),
      savedAt,
    })
    this.structuralDirty = false
    this.messagesDirty = false
    return savedAt
  }

  /** Set the topology mode and append a session event. */
  setTopology(mode: TopologyMode): void {
    this.topology = mode
    this.structuralDirty = true
    this.agent.session.append('swarm/topology-changed', {
      swarmId: this.swarmId,
      mode,
      changedAt: new Date().toISOString(),
    })
  }

  /**
   * Spawn a durable continuable child agent for the given role.
   * @param roleName - stable role name.
   * @param systemPrompt - optional role definition delivered as the child's initial prompt.
   * @param model - optional provider/model override for this child.
   * @param signal - caller cancellation owning the spawn until inbox acceptance.
   * @returns the durable child session id.
   */
  async spawnRole(
    roleName: string,
    systemPrompt: string | undefined,
    model: RoleModel | undefined,
    signal: AbortSignal,
  ): Promise<SessionId> {
    const provider = this.config.provider
    const effectiveModel = model ?? this.config.defaultModel
    const prompt: ContentBlock[] = [{
      type: 'text',
      text: systemPrompt ?? `You are the "${roleName}" role in an agent swarm.`,
    }]

    const agentOptions = effectiveModel !== undefined
      && (effectiveModel.provider !== undefined || effectiveModel.model !== undefined)
      ? {
          ...(effectiveModel.provider !== undefined ? { provider: effectiveModel.provider } : {}),
          ...(effectiveModel.model !== undefined ? { model: effectiveModel.model } : {}),
        }
      : undefined

    const started = await this.ctx.subagents.startContinuable({
      provider,
      label: `swarm/${roleName}`,
      request: {
        prompt,
        parent: this.agent,
        ...(agentOptions !== undefined ? { agentOptions } : {}),
      },
      signal,
    })

    const childId = started.childId
    this.children.set(roleName, childId)
    this.structuralDirty = true
    const modelPayload = effectiveModel !== undefined
      && (effectiveModel.provider !== undefined || effectiveModel.model !== undefined)
      ? {
          provider: effectiveModel.provider ?? '',
          model: effectiveModel.model ?? '',
        }
      : undefined
    this.agent.session.append('swarm/role-spawned', {
      swarmId: this.swarmId,
      roleName,
      childId,
      ...(modelPayload !== undefined ? { model: modelPayload } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    })

    return childId
  }

  /**
   * Route a message from one role (or the orchestrator) to another role.
   *
   * Attribution (`senderSessionId`) is computed exactly once and used for BOTH the
   * `followup()` delivery and the logged `swarm/role-message` event, so the durable
   * log and the perceived sender never diverge.
   *
   * @param from - role name, `orchestrator`, or `human` (operator answer routed by `swarm_ask_user`).
   * @param to - target role name.
   * @param content - message text.
   * @param attribution - explicit attribution override (only meaningful in `mixed` topology).
   * @param signal - caller cancellation owning the delivery until inbox acceptance.
   */
  async sendMessage(
    from: string,
    to: string,
    content: string,
    attribution: 'orchestrator' | 'peer' | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const toChildId = this.children.get(to)
    if (toChildId === undefined) {
      throw new Error(`swarm: unknown role ${to}`)
    }

    // Resolve the perceived sender session id exactly once. The operator's
    // answers (`from: 'human'`) are delivered under the orchestrator's session
    // id — the human speaks through the orchestrator's authority.
    let senderSessionId: SessionId
    if (from === 'orchestrator' || from === 'human') {
      senderSessionId = this.agent.session.id
    } else {
      const fromChildId = this.children.get(from)
      if (fromChildId === undefined) throw new Error(`swarm: unknown role ${from}`)
      senderSessionId = this.resolveSenderSessionId(fromChildId, attribution)
    }

    const message: ContentBlock[] = [{ type: 'text', text: content }]
    await this.ctx.subagents.followup(
      this.agent,
      toChildId,
      message,
      {
        source: { kind: 'coordinator', form: 'relay', senderSessionId },
        signal,
      },
    )

    this.messagesDirty = true
    this.agent.session.append('swarm/role-message', {
      swarmId: this.swarmId,
      from,
      to,
      senderSessionId,
      content,
      sentAt: new Date().toISOString(),
    })
  }

  /**
   * Deliver text to one role WITHOUT appending a `swarm/role-message` event.
   * Cold resume uses this for recovery framing and history replay: both are
   * re-derivable from the durable log, so logging them again would duplicate
   * on every restart. Attribution is always the orchestrator.
   * @param to - target role name.
   * @param text - the recovery framing or replayed message text.
   * @param signal - caller cancellation owning the delivery until inbox acceptance.
   */
  async deliverUnlogged(to: string, text: string, signal: AbortSignal): Promise<void> {
    const toChildId = this.children.get(to)
    if (toChildId === undefined) {
      throw new Error(`swarm: unknown role ${to}`)
    }
    await this.ctx.subagents.followup(
      this.agent,
      toChildId,
      [{ type: 'text', text }],
      {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: this.agent.session.id },
        signal,
      },
    )
  }

  /**
   * Resolve which session id the recipient perceives as the sender.
   * - `peer` attribution (or `peer` topology): the sending role itself.
   * - otherwise (`parent-child` topology, or explicit `orchestrator`): the orchestrator.
   */
  private resolveSenderSessionId(
    fromChildId: SessionId,
    attribution: 'orchestrator' | 'peer' | undefined,
  ): SessionId {
    if (attribution === 'peer') return fromChildId
    if (attribution === 'orchestrator') return this.agent.session.id
    if (this.topology === 'peer') return fromChildId
    return this.agent.session.id
  }

  /** Interrupt one or all roles (fire-and-return). */
  interrupt(roleName: string | undefined): void {
    const targets = roleName === undefined
      ? [...this.children.entries()]
      : this.children.has(roleName)
        ? [[roleName, this.children.get(roleName)!] as const]
        : []

    for (const [name, childId] of targets) {
      this.ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: this.agent })
      this.structuralDirty = true
      this.agent.session.append('swarm/role-exited', {
        swarmId: this.swarmId,
        roleName: name,
        childId,
        outcome: 'interrupted',
        exitedAt: new Date().toISOString(),
      })
      this.children.delete(name)
    }
  }

  /** Mark a role as settled without removing its durable child mapping. */
  markRoleSettled(roleName: string, outcome: 'settled' | 'error'): void {
    const childId = this.children.get(roleName)
    if (childId === undefined) return
    this.structuralDirty = true
    this.agent.session.append('swarm/role-exited', {
      swarmId: this.swarmId,
      roleName,
      childId,
      outcome,
      exitedAt: new Date().toISOString(),
    })
  }

  /**
   * Ask the human operator one question and wait for the answer.
   *
   * The request is logged (`swarm/hitl-requested`) BEFORE the wait starts, and
   * every settle path logs exactly one `swarm/hitl-resolved`. The wait races the
   * provider's answer against a per-request AbortController, so `terminate()` /
   * `dispose()` / an aborted tool call cancel it deterministically even when the
   * provider never observes the signal. Interrupting roles does NOT cancel a
   * pending ask: HITL is swarm-level, not role-level.
   *
   * @param question - the question presented to the operator.
   * @param header - short label for the question UI.
   * @param options - selectable answers; the operator may still enter a custom answer.
   * @param signal - the owning tool call's cancellation.
   * @returns how the wait settled, with the answer text when answered.
   */
  async askUser(
    question: string,
    header: string | undefined,
    options: readonly HitlOption[] | undefined,
    signal: AbortSignal,
  ): Promise<HitlAskResult> {
    const requestId = this.nextHitlRequestId()
    this.agent.session.append('swarm/hitl-requested', {
      swarmId: this.swarmId,
      requestId,
      question,
      ...(header !== undefined ? { header } : {}),
      ...(options !== undefined ? { options: options.map(option => option.label) } : {}),
      requestedAt: new Date().toISOString(),
    })

    const controller = new AbortController()
    const onExecAbort = () => controller.abort()
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onExecAbort, { once: true })
    this.pendingHitl.set(requestId, controller)

    // Loses the race only to a provider answer; rejects as soon as the wait is
    // cancelled from any source.
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('swarm: HITL wait cancelled')), { once: true })
    })

    let settled = false
    const resolve = (outcome: 'answered' | 'cancelled', answer?: string): void => {
      if (settled) return
      settled = true
      this.agent.session.append('swarm/hitl-resolved', {
        swarmId: this.swarmId,
        requestId,
        outcome,
        ...(answer !== undefined ? { answer } : {}),
        resolvedAt: new Date().toISOString(),
      })
    }

    try {
      const ask = this.ctx.userQuestions.ask({
        questions: [{
          id: requestId,
          question,
          ...(header !== undefined ? { header } : {}),
          ...(options !== undefined
            ? { options: options.map(option => ({
                label: option.label,
                ...(option.description !== undefined ? { description: option.description } : {}),
              })) }
            : {}),
        }],
        agent: this.agent,
        signal: controller.signal,
      })
      const result = await Promise.race([ask, cancelled])
      const item = result.answers.find(answer => answer.id === requestId) ?? result.answers[0]
      const answer = item?.custom ?? item?.selected.join(', ') ?? ''
      resolve('answered', answer)
      return { requestId, outcome: 'answered', answer }
    } catch (error) {
      resolve('cancelled')
      if (controller.signal.aborted) return { requestId, outcome: 'cancelled' }
      // A provider failure settles the log as cancelled, then propagates so the
      // tool reports internal_error instead of a fabricated answer.
      throw error
    } finally {
      signal.removeEventListener('abort', onExecAbort)
      this.pendingHitl.delete(requestId)
    }
  }

  /** The next HITL request id: `hitl-<n>` counting this swarm's prior requests, so ids survive cold resume without collision. */
  private nextHitlRequestId(): string {
    let count = 0
    for (const event of this.agent.session.events) {
      if (event.type !== 'swarm/hitl-requested') continue
      if ((event.data as { swarmId?: string }).swarmId === this.swarmId) count += 1
    }
    return `hitl-${count + 1}`
  }

  /**
   * Start the group chat engine for this swarm. Throws when a chat is already
   * active — end or terminate it first.
   * @param config - the effective chat configuration (tool args over deployment defaults).
   */
  startChat(config: {
    topic: string
    speakerSelection: SpeakerSelection
    maxTurns?: number
    maxRounds?: number
    terminationMessage?: string
  }): void {
    const existing = this.state().chat
    if (existing?.active) throw new Error(`swarm: chat already active for topic ${JSON.stringify(existing.topic)}`)
    this.structuralDirty = true
    this.agent.session.append('swarm/chat-started', {
      swarmId: this.swarmId,
      topic: config.topic,
      speakerSelection: config.speakerSelection,
      ...(config.maxTurns !== undefined ? { maxTurns: config.maxTurns } : {}),
      ...(config.maxRounds !== undefined ? { maxRounds: config.maxRounds } : {}),
      ...(config.terminationMessage !== undefined ? { terminationMessage: config.terminationMessage } : {}),
      startedAt: new Date().toISOString(),
    })
  }

  /** Stop the group chat engine (idempotent). */
  endChat(reason: string): void {
    if (this.state().chat?.active !== true) return
    this.structuralDirty = true
    this.agent.session.append('swarm/chat-ended', {
      swarmId: this.swarmId,
      reason,
      endedAt: new Date().toISOString(),
    })
  }

  /** Write one context variable; `by` attributes the writer (`orchestrator`, `human`, or a role). */
  setContext(key: string, value: string, by: string): void {
    this.messagesDirty = true
    this.agent.session.append('swarm/context-updated', {
      swarmId: this.swarmId,
      key,
      value,
      by,
      updatedAt: new Date().toISOString(),
    })
  }

  /**
   * Log one engine turn: the speaker's reply addressed to the whole group.
   * Group messages are log facts — every role observes the transcript through
   * the next turn prompt, so no per-role delivery happens here.
   */
  recordGroupMessage(speaker: string, content: string): void {
    const childId = this.children.get(speaker)
    if (childId === undefined) throw new Error(`swarm: unknown role ${speaker}`)
    this.messagesDirty = true
    this.agent.session.append('swarm/role-message', {
      swarmId: this.swarmId,
      from: speaker,
      to: 'group',
      senderSessionId: childId,
      content,
      sentAt: new Date().toISOString(),
    })
  }

  /**
   * Run one engine turn: deliver the turn prompt to the speaker and await the
   * assistant reply it produces.
   *
   * The reply is read from the child's durable session: the last
   * `assistant/message` after the user message this delivery created (located
   * by its accepted `MessageId`), once the child is idle. When the child is not
   * materialized in this process (a mocked spawn in tests), no reply is
   * observable and the turn records ''.
   *
   * @param roleName - the speaking role.
   * @param prompt - the turn prompt (topic, context, transcript).
   * @param signal - the owning tool call's cancellation.
   * @returns the reply text.
   */
  async runTurn(roleName: string, prompt: string, signal: AbortSignal): Promise<string> {
    const childId = this.children.get(roleName)
    if (childId === undefined) throw new Error(`swarm: unknown role ${roleName}`)
    const messageId = await this.ctx.subagents.followup(
      this.agent,
      childId,
      [{ type: 'text', text: prompt }],
      {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: this.agent.session.id },
        signal,
      },
    )
    const child = this.ctx.agents.get(childId)
    if (child === undefined) return ''
    return this.awaitChildReply(child, messageId, signal)
  }

  /** Await the child's settled assistant reply to the user message `messageId`. */
  private awaitChildReply(child: Agent, messageId: MessageId, signal: AbortSignal): Promise<string> {
    const evaluate = (): string | undefined => {
      if (child.status !== 'idle') return undefined
      const events = child.session.events
      // The turn prompt lands in the log at or after this index.
      let watermark = 0
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index]!
        if (event.type === 'user/message' && (event.data as { id: MessageId }).id === messageId) {
          watermark = index
          break
        }
      }
      for (let index = events.length - 1; index > watermark; index--) {
        const event = events[index]!
        if (event.type !== 'assistant/message') continue
        const content = (event.data as { message: { content: ContentBlock[] } }).message.content
        return content.filter(block => block.type === 'text').map(block => block.text).join('')
      }
      return undefined
    }
    const immediate = evaluate()
    if (immediate !== undefined) return Promise.resolve(immediate)
    return new Promise((resolve, reject) => {
      const attempt = (): void => {
        const reply = evaluate()
        if (reply !== undefined) {
          cleanup()
          resolve(reply)
        }
      }
      const cleanup = (): void => {
        stopSession()
        stopStatus()
        signal.removeEventListener('abort', onAbort)
      }
      // Re-evaluate on every child session append AND every status transition:
      // the final assistant/message can precede the idle flip within one turn.
      const stopSession = this.ctx.on('session/event', (session) => {
        if (session.id === child.session.id) attempt()
      })
      const stopStatus = child.ctx.on('agent/status', attempt)
      const onAbort = (): void => {
        cleanup()
        reject(signal.reason instanceof Error ? signal.reason : new Error('swarm: turn aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Cancel every live HITL wait; the awaiting `askUser` calls log the cancellations. */
  private cancelPendingHitl(): void {
    for (const controller of this.pendingHitl.values()) controller.abort()
  }

  /** Terminate the swarm: cancel pending HITL waits, interrupt every child, and append `swarm/destroyed`. */
  terminate(reason: string): void {
    if (this.terminated) return
    this.cancelPendingHitl()
    this.interrupt(undefined)
    this.structuralDirty = true
    this.agent.session.append('swarm/destroyed', {
      swarmId: this.swarmId,
      reason,
      destroyedAt: new Date().toISOString(),
    })
    this.terminated = true
  }

  /** Build the current folded state from the session event log. */
  state(): SwarmState {
    return foldSwarmEvents(this.swarmId, this.agent.session.events, this.topology, this.config.memory.maxEntries)
  }

  /**
   * Write one memory entry and append its `swarm/memory-written` event. The id
   * counts this swarm's prior writes in the durable log, so a cold resume
   * never collides with a pre-restart entry.
   * @param text - the fact to remember.
   * @param by - writer attribution (`orchestrator`, `human`, or a role name).
   * @param tags - retrieval tags, when any.
   * @returns the written entry's id (`mem-<n>`).
   */
  writeMemory(text: string, by: string, tags?: readonly string[]): string {
    const count = this.agent.session.events.filter(
      event => event.type === 'swarm/memory-written'
        && (event.data as { swarmId?: string }).swarmId === (this.swarmId as string),
    ).length
    const id = `mem-${count + 1}`
    this.messagesDirty = true
    this.agent.session.append('swarm/memory-written', {
      swarmId: this.swarmId,
      id,
      text,
      by,
      ...(tags !== undefined ? { tags } : {}),
      writtenAt: new Date().toISOString(),
    })
    return id
  }

  /**
   * Dispose: cancel pending HITL waits and interrupt all children (idempotent).
   * Writes no new durable events itself; a cancelled `askUser` still logs its
   * own `swarm/hitl-resolved` when the owning session is still writable.
   */
  dispose(): void {
    this.cancelPendingHitl()
    if (this.terminated) return
    for (const [name, childId] of this.children) {
      try {
        this.ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: this.agent })
      } catch {
        // Best-effort: an already-gone child is an accepted no-op.
      }
      this.children.delete(name)
    }
    this.terminated = true
  }
}

/** Re-export for callers that need the branded session id factory. */
export { SessionId }
