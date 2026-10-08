/**
 * Per-agent Swarm runtime: manages child agents, topology, and the session event log.
 *
 * Each SwarmRuntime belongs to one orchestrator root Agent. Children are spawned
 * through `ctx.subagents.startContinuable()` (durable continuable children), so the
 * orchestrator is their exact direct parent, so adjacent-Agent delivery authorization holds.
 * Relay attribution through `senderSessionId` enables P2P semantics without new
 * security primitives.
 *
 * @module dsh-swarm-panel
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
// Host-only relay seam: the public `ctx.subagents.sendMessage()` derives sender
// attribution from the exact live sender, which cannot express peer attribution.
// `queueHostSubagentPrompt` accepts the explicit durable source descriptor.
import { queueHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
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
  /** Upper bound for one engine turn's reply wait, in milliseconds. */
  readonly turnTimeoutMs: number
}

/**
 * One engine turn stopped for a reason the engine should treat as a chat stop
 * condition rather than an internal failure: the speaker was interrupted
 * (`interrupted`) or never answered inside the turn timeout (`timeout`).
 */
export class RoleTurnError extends Error {
  constructor(message: string, readonly reason: 'interrupted' | 'timeout') {
    super(message)
    this.name = 'RoleTurnError'
  }
}

/** One process-local, disposable Swarm runtime attached to one orchestrator root agent. */
export class SwarmRuntime {
  /** role name → durable child session id. */
  private readonly children = new Map<string, SessionId>()
  /** Live HITL waits, request id → cancellation. A pending wait is swarm-level: role interrupts do not touch it, terminate/dispose cancel it. */
  private readonly pendingHitl = new Map<string, AbortController>()
  /**
   * Per-role cancellation for the turn currently in flight. `interrupt` and
   * settlement abort it so `swarm_next_turn` never waits forever on a child
   * that will not answer.
   */
  private readonly roleTurns = new Map<string, AbortController>()
  /** True while one `swarm_next_turn` call drives this swarm (explicit serialization). */
  private turnInFlight = false
  /** `hitl-<n>` / `mem-<n>` counters mirrored in memory; `hydrate` reseeds them from the log. */
  private hitlCount = 0
  private memoryCount = 0
  /** Last fold, keyed by log length + topology + memory limit; the log only grows. */
  private foldCache: { length: number; topology: TopologyMode; memoryLimit: number; state: SwarmState } | undefined
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
   * Reject a mutating entry point once the swarm is terminated. Guarantees the
   * durable log never gains a `swarm/*` fact after `swarm/destroyed` (audit
   * G4-04/G4-06): a terminated swarm must not spawn orphans or block on HITL.
   * @param action - human-readable action for the error message.
   */
  private assertActive(action: string): void {
    if (this.terminated) throw new Error(`swarm: cannot ${action}; the swarm is terminated`)
  }

  /**
   * Claim the single in-flight turn slot. The host scheduler already runs these
   * tools exclusively, but the contract is made explicit here so a direct
   * caller (another plugin, PTC nesting, tests) cannot interleave two engines.
   * @returns true when the caller owns the slot until {@link endTurn}.
   */
  beginTurn(): boolean {
    if (this.turnInFlight) return false
    this.turnInFlight = true
    return true
  }

  /** Release the turn slot claimed by {@link beginTurn}. */
  endTurn(): void {
    this.turnInFlight = false
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
    // Reseed the id counters once here instead of rescanning the whole log on
    // every ask/memory write (the log only grows).
    let hitl = 0
    let memory = 0
    for (const event of this.agent.session.snapshotEvents()) {
      if ((event.data as { swarmId?: string }).swarmId !== this.swarmId) continue
      if (event.type === 'swarm/hitl-requested') hitl += 1
      else if (event.type === 'swarm/memory-written') memory += 1
    }
    this.hitlCount = hitl
    this.memoryCount = memory
    this.foldCache = undefined
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
    this.assertActive('spawn a role')
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
    // Re-spawning a named role replaces it: stop the previous child instead of
    // dropping its mapping (audit G4-05 — otherwise it keeps running forever).
    if (this.children.has(roleName)) this.interrupt(roleName)
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
   * host-relay delivery and the logged `swarm/role-message` event, so the durable
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
    this.assertActive('send a message')
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
    await queueHostSubagentPrompt(
      this.ctx.subagents,
      this.agent,
      toChildId,
      message,
      { kind: 'agent-message', form: 'relay', senderSessionId },
      signal,
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
    this.assertActive('deliver a recovery message')
    const toChildId = this.children.get(to)
    if (toChildId === undefined) {
      throw new Error(`swarm: unknown role ${to}`)
    }
    await queueHostSubagentPrompt(
      this.ctx.subagents,
      this.agent,
      toChildId,
      [{ type: 'text', text }],
      { kind: 'agent-message', form: 'relay', senderSessionId: this.agent.session.id },
      signal,
    )
  }

  /**
   * Resolve which session id the recipient perceives as the sender.
   * - explicit `orchestrator`: the orchestrator.
   * - explicit `peer` in `mixed` topology, or `peer` topology: the sending role.
   * - otherwise (`parent-child`): the orchestrator.
   *
   * An explicit `peer` override is ignored outside `mixed` (audit G4-12.5): the
   * tool documents it as meaningful only there, and `parent-child` must stay
   * the safe default.
   */
  private resolveSenderSessionId(
    fromChildId: SessionId,
    attribution: 'orchestrator' | 'peer' | undefined,
  ): SessionId {
    if (attribution === 'orchestrator') return this.agent.session.id
    if (attribution === 'peer' && this.topology === 'mixed') return fromChildId
    if (this.topology === 'peer') return fromChildId
    return this.agent.session.id
  }

  /**
   * Interrupt one or all roles (fire-and-return).
   *
   * Every step is best-effort (audit G4-03): a rejected `subagents.interrupt`
   * (for example `UNAUTHORIZED` after a child was resumed as its own root) must
   * not skip the `swarm/role-exited` fact or leave the role in the active set.
   * An in-flight turn for the role is aborted so the engine cannot wait forever.
   */
  interrupt(roleName: string | undefined): void {
    const targets = roleName === undefined
      ? [...this.children.entries()]
      : this.children.has(roleName)
        ? [[roleName, this.children.get(roleName)!] as const]
        : []

    for (const [name, childId] of targets) {
      this.roleTurns.get(name)?.abort(new Error(`swarm: role ${JSON.stringify(name)} was interrupted`))
      this.roleTurns.delete(name)
      try {
        this.ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: this.agent })
      } catch {
        // Best-effort: an already-gone or unauthorized child is an accepted
        // no-op; the durable exit fact below is what the swarm state needs.
      }
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

  /**
   * Mark a role as settled and drop its live child mapping. The durable
   * `swarm/role-spawned` fact keeps the historical child id; the live map only
   * tracks roles the swarm may still drive or interrupt.
   * @param roleName - the role that ended.
   * @param outcome - how it ended.
   * @returns true when a running role was marked.
   */
  markRoleSettled(roleName: string, outcome: 'settled' | 'error'): boolean {
    const childId = this.children.get(roleName)
    if (childId === undefined) return false
    this.roleTurns.get(roleName)?.abort(new Error(`swarm: role ${JSON.stringify(roleName)} settled`))
    this.roleTurns.delete(roleName)
    this.structuralDirty = true
    this.agent.session.append('swarm/role-exited', {
      swarmId: this.swarmId,
      roleName,
      childId,
      outcome,
      exitedAt: new Date().toISOString(),
    })
    this.children.delete(roleName)
    return true
  }

  /**
   * Settle the role owning one child session after the host reported that the
   * child finished. Without this the fold shows every role as running forever:
   * `no-roles` is unreachable, the panel lies, and a cold resume re-wakes a
   * finished child (audit G4-07).
   * @param childId - the settled child's session id.
   * @param outcome - how it ended.
   * @returns true when a running role owned that child.
   */
  markChildSettled(childId: SessionId, outcome: 'settled' | 'error'): boolean {
    for (const [roleName, mapped] of this.children) {
      if (mapped !== childId) continue
      return this.markRoleSettled(roleName, outcome)
    }
    return false
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
    this.assertActive('ask the operator')
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
    this.hitlCount += 1
    return `hitl-${this.hitlCount}`
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
    this.assertActive('start a chat')
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
    this.assertActive('write context')
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
  recordGroupMessage(speaker: string, content: string): boolean {
    // A role interrupted mid-turn has no live mapping any more; report that
    // instead of throwing so the engine can end the chat cleanly (audit G4-08).
    const childId = this.children.get(speaker)
    if (childId === undefined || this.terminated) return false
    this.messagesDirty = true
    this.agent.session.append('swarm/role-message', {
      swarmId: this.swarmId,
      from: speaker,
      to: 'group',
      senderSessionId: childId,
      content,
      sentAt: new Date().toISOString(),
    })
    return true
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
    this.assertActive('run a turn')
    const childId = this.children.get(roleName)
    if (childId === undefined) throw new Error(`swarm: unknown role ${roleName}`)
    // Delivery and the reply wait share one cancellation: the tool call's
    // signal plus a per-role abort that interrupt/settlement raise, so an
    // interrupted speaker cannot leave the engine pending forever (G4-08).
    const roleController = new AbortController()
    this.roleTurns.get(roleName)?.abort(new Error(`swarm: role ${JSON.stringify(roleName)} started a new turn`))
    this.roleTurns.set(roleName, roleController)
    const onOuterAbort = (): void => { roleController.abort(signal.reason) }
    if (signal.aborted) roleController.abort(signal.reason)
    else signal.addEventListener('abort', onOuterAbort, { once: true })
    const roleSignal = roleController.signal
    try {
      const messageId = await queueHostSubagentPrompt(
        this.ctx.subagents,
        this.agent,
        childId,
        [{ type: 'text', text: prompt }],
        { kind: 'agent-message', form: 'relay', senderSessionId: this.agent.session.id },
        roleSignal,
      )
      const child = this.ctx.agents.get(childId)
      if (child === undefined) return ''
      return await this.awaitChildReply(child, messageId, roleSignal)
    } catch (error) {
      // A per-role abort (interrupt or settlement) is a normal stop condition;
      // an outer tool-call abort keeps propagating unchanged.
      if (roleController.signal.aborted && !signal.aborted) {
        throw new RoleTurnError(error instanceof Error ? error.message : String(error), 'interrupted')
      }
      throw error
    } finally {
      signal.removeEventListener('abort', onOuterAbort)
      if (this.roleTurns.get(roleName) === roleController) this.roleTurns.delete(roleName)
    }
  }

  /**
   * Await the child's settled assistant reply to the user message `messageId`.
   *
   * "Not ready" is expressed as `undefined` and retried on the next event: the
   * inbox accepts the delivery before its `user/message` is appended, so a miss
   * must never fall back to scanning the whole log — doing that reported the
   * PREVIOUS turn's reply as this one (audit G4-01). A timeout bounds the wait
   * so an interrupted child cannot hang `swarm_next_turn` forever (G4-08).
   */
  private awaitChildReply(child: Agent, messageId: MessageId, signal: AbortSignal): Promise<string> {
    const timeoutMs = this.config.turnTimeoutMs
    const evaluate = (): string | undefined => {
      if (child.status !== 'idle') return undefined
      const events = child.session.snapshotEvents()
      // The turn prompt lands in the log at or after this index; until it does,
      // the reply is simply not observable yet.
      let watermark: number | undefined
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index]!
        if (event.type === 'user/message' && (event.data as { id: MessageId }).id === messageId) {
          watermark = index
          break
        }
      }
      if (watermark === undefined) return undefined
      for (let index = events.length - 1; index > watermark; index--) {
        const event = events[index]!
        if (event.type !== 'assistant/message') continue
        const content = (event.data as { message: { content: readonly ContentBlock[] } }).message.content
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
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer)
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
      if (signal.aborted) {
        onAbort()
        return
      }
      timer = setTimeout(() => {
        cleanup()
        reject(new RoleTurnError(`swarm: the role did not reply within ${timeoutMs} ms`, 'timeout'))
      }, timeoutMs)
    })
  }

  /** Cancel every live HITL wait; the awaiting `askUser` calls log the cancellations. */
  private cancelPendingHitl(): void {
    for (const controller of this.pendingHitl.values()) controller.abort()
  }

  /**
   * Terminate the swarm: mark it terminated and append `swarm/destroyed` FIRST,
   * then cancel pending HITL waits and interrupt every child best-effort.
   *
   * The order matters (audit G4-03): a rejected `subagents.interrupt` can no
   * longer leave the swarm un-terminated with live roles. A repeated call still
   * cancels a late wait (audit G4-06).
   * @param reason - why the swarm ended.
   */
  terminate(reason: string): void {
    if (this.terminated) {
      this.cancelPendingHitl()
      return
    }
    this.terminated = true
    this.structuralDirty = true
    this.agent.session.append('swarm/destroyed', {
      swarmId: this.swarmId,
      reason,
      destroyedAt: new Date().toISOString(),
    })
    this.cancelPendingHitl()
    this.interrupt(undefined)
  }

  /**
   * Build the current folded state from the session event log.
   *
   * The fold is memoized on (log length, topology, memory limit): the log only
   * grows, so repeated calls inside one tool invocation reuse the previous fold
   * instead of rescanning every event (audit G4-11).
   * @returns the folded state for this swarm.
   */
  state(): SwarmState {
    const events = this.agent.session.snapshotEvents()
    const memoryLimit = this.config.memory.maxEntries
    const cached = this.foldCache
    if (cached !== undefined
      && cached.length === events.length
      && cached.topology === this.topology
      && cached.memoryLimit === memoryLimit) {
      return cached.state
    }
    const state = foldSwarmEvents(this.swarmId, events, this.topology, memoryLimit)
    this.foldCache = { length: events.length, topology: this.topology, memoryLimit, state }
    return state
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
    this.assertActive('write memory')
    this.memoryCount += 1
    const id = `mem-${this.memoryCount}`
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
    for (const controller of this.roleTurns.values()) controller.abort(new Error('swarm: the swarm was disposed'))
    this.roleTurns.clear()
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
