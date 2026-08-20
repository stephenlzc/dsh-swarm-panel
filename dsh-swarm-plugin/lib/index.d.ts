import { AgentCancelCause, Session, SessionEvent, SessionId, SessionId as SessionId$2, UserMessage } from "@deepseek-ai/dsh-session";
import { Context, Service } from "@deepseek-ai/cordis";
import { Branded } from "@deepseek-ai/dsh-brand";
import { SessionEvent as SessionEvent$1, SessionId as SessionId$1 } from "@deepseek-ai/dsh-session/types";

//#region src/types.d.ts
/** Stable swarm identity, unique within one orchestrator session. */
type SwarmId = Branded<'SwarmId'>;
/**
 * Brand a string as a {@link SwarmId}.
 * @param id - the raw swarm id supplied by the model or config.
 * @returns the same string, branded.
 */
declare function SwarmId(id: string): SwarmId;
/**
 * How a message is attributed when routed between roles.
 * - `parent-child`: the orchestrator is the perceived sender (default, safest).
 * - `peer`: the specified sending role is the perceived sender (P2P semantics).
 * - `mixed`: attribution is chosen per-message by the orchestrator.
 */
type TopologyMode = 'parent-child' | 'peer' | 'mixed';
/** A swarm was created by the orchestrator. */
interface SwarmCreatedData {
  /** Identity of the swarm this event belongs to. */
  readonly swarmId: SwarmId;
  /** RFC 3339 UTC instant the swarm was created. */
  readonly createdAt: string;
}
/** A child agent role was spawned. */
interface RoleSpawnedData {
  readonly swarmId: SwarmId;
  /** Stable role name within the swarm. */
  readonly roleName: string;
  /** Durable child session id the role maps to. */
  readonly childId: SessionId$1;
  /** Model override applied at spawn, if any. */
  readonly model?: {
    readonly provider: string;
    readonly model: string;
  };
  /**
   * Role definition delivered as the child's initial prompt, retained so a
   * cold resume can re-spawn a lost child with its original definition.
   */
  readonly systemPrompt?: string;
}
/** A message was routed between roles. */
interface RoleMessageData {
  readonly swarmId: SwarmId;
  /** Perceived sender: a role name, or `orchestrator`. */
  readonly from: string;
  /** Perceived recipient role name. */
  readonly to: string;
  /** Session id the recipient attributes the message to. */
  readonly senderSessionId: SessionId$1;
  /** The routed message text. */
  readonly content: string;
  /** RFC 3339 UTC instant the message was routed. */
  readonly sentAt: string;
}
/** A role settled, was interrupted, or errored. */
interface RoleExitedData {
  readonly swarmId: SwarmId;
  readonly roleName: string;
  readonly childId: SessionId$1;
  readonly outcome: 'settled' | 'interrupted' | 'error';
  readonly exitedAt: string;
}
/** The topology mode for a swarm changed. */
interface TopologyChangedData {
  readonly swarmId: SwarmId;
  readonly mode: TopologyMode;
  readonly changedAt: string;
}
/** A swarm was terminated. */
interface SwarmDestroyedData {
  readonly swarmId: SwarmId;
  /** Why the swarm ended. */
  readonly reason: string;
  readonly destroyedAt: string;
}
/**
 * How often `swarm/checkpoint` snapshots are written.
 * - `auto`: after a structural change (spawn, exit, topology, terminate), at the next idle boundary.
 * - `manual`: only when the orchestrator calls the `swarm_checkpoint` tool.
 * - `per_turn`: after every turn that changed any swarm state, messages included.
 */
type CheckpointFrequency = 'auto' | 'manual' | 'per_turn';
/** Why one checkpoint was saved. */
type CheckpointReason = 'manual' | 'auto' | 'per_turn';
/** One role entry inside a checkpoint snapshot. */
interface CheckpointRoleSnapshot {
  readonly roleName: string;
  readonly childId: SessionId$1;
  readonly status: 'running' | 'exited';
  readonly model?: {
    readonly provider: string;
    readonly model: string;
  };
}
/**
 * A point-in-time snapshot of one swarm's folded state. Checkpoints are
 * markers over the event log: resume always re-folds the complete log, and the
 * latest checkpoint names the recovery point the resume started from.
 */
interface SwarmCheckpointData {
  readonly swarmId: SwarmId;
  /** Checkpoint payload format version. */
  readonly version: 1;
  readonly reason: CheckpointReason;
  readonly topologyMode: TopologyMode;
  readonly roles: readonly CheckpointRoleSnapshot[];
  /** Number of `swarm/role-message` events routed so far. */
  readonly messageCount: number;
  /** Context variables at save time, when any were set. */
  readonly context?: Readonly<Record<string, string>>;
  /** Sender of the most recent routed message, when any. */
  readonly lastSpeaker?: string;
  readonly savedAt: string;
}
/** How one role was brought back during a cold resume. */
interface RoleResumeRecord {
  readonly roleName: string;
  /** The role's live child session id after resume (new when `respawned`). */
  readonly childId: SessionId$1;
  /**
   * `resumed`: the durable child session was cold-resumed with its history
   * intact. `respawned`: the child session was lost, so the role was re-spawned
   * and its inbound messages replayed.
   */
  readonly action: 'resumed' | 'respawned';
}
/** A swarm's in-memory state was rebuilt from the durable log after a restart. */
interface SwarmResumedData {
  readonly swarmId: SwarmId;
  readonly roles: readonly RoleResumeRecord[];
  /** `savedAt` of the latest checkpoint the resume started from, when any. */
  readonly fromCheckpoint?: string;
  readonly resumedAt: string;
}
/**
 * When the swarm may pause for operator input (AG2-style human input mode).
 * - `ALWAYS`: the `swarm_ask_user` tool is enabled; the turn engine also asks the operator after every round.
 * - `TERMINATE` (default): the tool is enabled; the engine asks only before automatic termination.
 * - `NEVER`: human input is disabled; `swarm_ask_user` fails with `unavailable`.
 */
type HumanInputMode = 'ALWAYS' | 'TERMINATE' | 'NEVER';
/** The orchestrator asked the operator a question and is waiting for the answer. */
interface HitlRequestedData {
  readonly swarmId: SwarmId;
  /** Stable request id, unique within the swarm (`hitl-<n>`, n counts prior requests). */
  readonly requestId: string;
  /** The question presented to the operator. */
  readonly question: string;
  /** Short label for the question UI, when supplied. */
  readonly header?: string;
  /** Selectable option labels, when the question is multiple-choice. */
  readonly options?: readonly string[];
  readonly requestedAt: string;
}
/** A pending HITL request settled. */
interface HitlResolvedData {
  readonly swarmId: SwarmId;
  readonly requestId: string;
  /**
   * `answered`: the operator replied. `cancelled`: the wait ended without an
   * answer — the swarm was terminated, the owning tool call was aborted, or
   * the ask provider failed.
   */
  readonly outcome: 'answered' | 'cancelled';
  /** The operator's answer text, when `answered`. */
  readonly answer?: string;
  readonly resolvedAt: string;
}
/**
 * How the turn engine picks the next speaker.
 * - `round_robin`: fixed spawn order, wrapping; continues from the last speaker after a resume.
 * - `random`: uniform pick excluding the previous speaker.
 * - `auto`: the orchestrator model decides and passes `speaker` to `swarm_next_turn`.
 * - `manual`: the engine asks the operator (via HITL) who speaks next.
 */
type SpeakerSelection = 'round_robin' | 'random' | 'auto' | 'manual';
/** A group chat was configured and its engine started. */
interface ChatStartedData {
  readonly swarmId: SwarmId;
  /** The topic the roles converse about; anchors every turn prompt. */
  readonly topic: string;
  readonly speakerSelection: SpeakerSelection;
  /** Stop after this many engine turns. */
  readonly maxTurns?: number;
  /** Stop after this many rounds (a round = every active role spoke once). */
  readonly maxRounds?: number;
  /** Stop when a reply contains this substring. */
  readonly terminationMessage?: string;
  readonly startedAt: string;
}
/** The group chat engine stopped. */
interface ChatEndedData {
  readonly swarmId: SwarmId;
  /** Why the engine stopped, e.g. `max-turns`, `max-round`, `termination-message`, `operator-stopped`, `no-roles`. */
  readonly reason: string;
  readonly endedAt: string;
}
/** A swarm-level context variable was written. */
interface ContextUpdatedData {
  readonly swarmId: SwarmId;
  readonly key: string;
  readonly value: string;
  /** Who wrote it: `orchestrator`, `human`, or a role name. */
  readonly by: string;
  readonly updatedAt: string;
}
/** One swarm-level memory entry (the fold projection of `swarm/memory-written`). */
interface SwarmMemoryEntry {
  /** Stable entry id, unique within the swarm (`mem-<n>`, n counts prior writes). */
  readonly id: string;
  /** The remembered fact. */
  readonly text: string;
  /** Retrieval tags, when supplied. */
  readonly tags?: readonly string[];
  /** Who wrote it: `orchestrator`, `human`, or a role name. */
  readonly by: string;
  readonly writtenAt: string;
}
/** A swarm-level memory entry was written. */
interface MemoryWrittenData extends SwarmMemoryEntry {
  readonly swarmId: SwarmId;
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'swarm/created': SwarmCreatedData;
    'swarm/role-spawned': RoleSpawnedData;
    'swarm/role-message': RoleMessageData;
    'swarm/role-exited': RoleExitedData;
    'swarm/topology-changed': TopologyChangedData;
    'swarm/destroyed': SwarmDestroyedData;
    'swarm/checkpoint': SwarmCheckpointData;
    'swarm/resumed': SwarmResumedData;
    'swarm/hitl-requested': HitlRequestedData;
    'swarm/hitl-resolved': HitlResolvedData;
    'swarm/chat-started': ChatStartedData;
    'swarm/chat-ended': ChatEndedData;
    'swarm/context-updated': ContextUpdatedData;
    'swarm/memory-written': MemoryWrittenData;
  }
}
/** The live state of one role within a swarm. */
interface RoleState {
  readonly roleName: string;
  readonly childId: SessionId$1;
  readonly model?: {
    readonly provider: string;
    readonly model: string;
  };
  /** Role definition recorded at spawn, used to re-spawn a lost child. */
  readonly systemPrompt?: string;
  readonly status: 'running' | 'exited';
  readonly outcome?: 'settled' | 'interrupted' | 'error';
}
/** An unanswered HITL request in the fold projection. */
interface PendingHitl {
  readonly requestId: string;
  readonly question: string;
  readonly requestedAt: string;
}
/** Engine state of one swarm's group chat, reconstructed from the fold. */
interface ChatState {
  readonly topic: string;
  readonly speakerSelection: SpeakerSelection;
  readonly maxTurns?: number;
  readonly maxRounds?: number;
  readonly terminationMessage?: string;
  /** Engine turns taken so far (routed messages addressed to `group`). */
  readonly turnCount: number;
  /** Group transcript in log order: `{ from, content }` per engine turn. */
  readonly transcript: ReadonlyArray<{
    readonly from: string;
    readonly content: string;
  }>;
  /** False after `swarm/chat-ended`. */
  readonly active: boolean;
}
/** The live state of one swarm, reconstructed from the session event fold. */
interface SwarmState {
  readonly swarmId: SwarmId;
  readonly roles: ReadonlyMap<string, RoleState>;
  readonly topologyMode: TopologyMode;
  readonly terminated: boolean;
  /** Number of `swarm/role-message` events routed so far. */
  readonly messageCount: number;
  /** Perceived sender of the most recent routed message, when any. */
  readonly lastSpeaker?: string;
  /**
   * HITL requests with no matching `swarm/hitl-resolved`. A pending entry after
   * a cold resume means the operator never answered before the restart; no live
   * waiter survives, so the orchestrator should re-ask.
   */
  readonly pendingHitl: readonly PendingHitl[];
  /** Swarm-level context variables (last write wins per key). */
  readonly context: ReadonlyMap<string, string>;
  /** Memory entries in write order (capped to the configured view window when set). */
  readonly memories: readonly SwarmMemoryEntry[];
  /** Group chat engine state, present once `swarm/chat-started` was logged. */
  readonly chat?: ChatState;
}
/** Successful `swarm_spawn` value. */
interface SwarmSpawnValue {
  readonly swarmId: string;
  readonly roleName: string;
  readonly childId: string;
}
/** Successful `swarm_send_to` value. */
interface SwarmSendValue {
  readonly swarmId: string;
  readonly from: string;
  readonly to: string;
  readonly delivered: true;
}
/** Successful `swarm_list_children` value. */
interface SwarmListValue {
  readonly swarmId: string;
  readonly roles: ReadonlyArray<{
    readonly roleName: string;
    readonly childId: string;
    readonly status: string;
    readonly model?: {
      readonly provider: string;
      readonly model: string;
    };
  }>;
  readonly topologyMode: TopologyMode;
}
/** Successful boolean acknowledgement for topology/interrupt/terminate. */
interface SwarmOkValue {
  readonly ok: true;
}
/** Successful `swarm_checkpoint` value. */
interface SwarmCheckpointValue {
  readonly swarmId: string;
  readonly savedAt: string;
  readonly messageCount: number;
  readonly roleCount: number;
}
/** Successful `swarm_ask_user` value. */
interface SwarmAskUserValue {
  readonly swarmId: string;
  readonly requestId: string;
  readonly outcome: 'answered' | 'cancelled';
  /** The operator's answer text, when `answered`. */
  readonly answer?: string;
  /** Role the answer was routed to, when requested. */
  readonly routedTo?: string;
}
/** Successful `swarm_start_chat` value: the effective chat configuration. */
interface SwarmStartChatValue {
  readonly swarmId: string;
  readonly topic: string;
  readonly speakerSelection: SpeakerSelection;
  readonly maxTurns?: number;
  readonly maxRounds?: number;
  readonly terminationMessage?: string;
}
/** One engine turn taken by `swarm_next_turn`. */
interface SwarmTurnRecord {
  readonly speaker: string;
  readonly reply: string;
}
/** Successful `swarm_next_turn` value. */
interface SwarmNextTurnValue {
  readonly swarmId: string;
  readonly turns: readonly SwarmTurnRecord[];
  /** True when the engine hit a termination condition during this call. */
  readonly ended: boolean;
  readonly endReason?: string;
}
/** Successful `swarm_set_context` value. */
interface SwarmSetContextValue {
  readonly swarmId: string;
  readonly key: string;
  readonly value: string;
}
/** Successful `swarm_get_context` value. */
interface SwarmGetContextValue {
  readonly swarmId: string;
  readonly entries: ReadonlyArray<{
    readonly key: string;
    readonly value: string;
  }>;
}
/** Successful `swarm_memory_write` value. */
interface SwarmMemoryWriteValue {
  readonly swarmId: string;
  /** The written entry's stable id (`mem-<n>`). */
  readonly id: string;
}
/** One scored memory hit in a `swarm_memory_query` value. */
interface SwarmMemoryHit extends SwarmMemoryEntry {
  /** Lexical relevance score (text token overlap + tag weight; see memory.ts). */
  readonly score: number;
}
/** Successful `swarm_memory_query` value. */
interface SwarmMemoryQueryValue {
  readonly swarmId: string;
  /** Query echoed back for tool-result readability. */
  readonly query: string;
  /** Highest-scoring entries first, at most the effective limit. */
  readonly entries: readonly SwarmMemoryHit[];
}
//#endregion
//#region ../../packages/typert/protocol/lib/types/types.d.ts
declare const LOOKUP_HOST: unique symbol;
declare const LOOKUP_WIRE: unique symbol;
declare const CONTEXT_WIRE: unique symbol;
/** Type-level association between a Host object and its wire identity. */
interface TypertLookup<Host, Wire> {
  readonly [LOOKUP_HOST]: Host;
  readonly [LOOKUP_WIRE]: Wire;
}
/** Extract the Host object associated with one lookup declaration. */
type TypertLookupHost<Lookup> = Lookup extends TypertLookup<infer Host, infer _Wire> ? Host : never;
/** Extract the wire identity associated with one lookup declaration. */
type TypertLookupWire<Lookup> = Lookup extends TypertLookup<infer _Host, infer Wire> ? Wire : never;
/** Type-level association between a scoped Context kind and its wire identity. */
interface TypertContext<Wire> {
  readonly [CONTEXT_WIRE]: Wire;
}
/** Extract the wire identity associated with one scoped Context declaration. */
type TypertContextWire<ContextType> = ContextType extends TypertContext<infer Wire> ? Wire : never;
/** Merge-extensible Host object lookup declarations. */
interface TypertLookupMap {}
/** Merge-extensible scoped Context declarations. */
interface TypertContextMap {}
/** Awaitable disposer returned by Cordis-owned Typert registrations. */
type TypertDisposer = () => Promise<void>;
type StringKeyOf<Value> = Extract<keyof Value, string>;
/** Minimal runtime-schema capability carried by strict generated codecs. */
interface TypertSchema<Output = unknown> {
  /**
   * Parse and validate one boundary value.
   * @param value - untrusted boundary value.
   * @returns the validated value.
   */
  parse(value: unknown): Output;
}
/** Codec attached to one invocation parameter or result. */
type TypertCodec = {
  readonly mode: 'strict';
  readonly typeSymbol: string;
  readonly schema: TypertSchema;
} | {
  readonly mode: 'src-json';
};
/** One ordered business parameter in a Remote invocation. */
interface InvocationParameterDescriptor {
  /** Source-level parameter name. */
  readonly name: string;
  /** Required key in the wire `args` object. */
  readonly wire: string;
  /** Whether the value is JSON or requires a registered Host lookup. */
  readonly source: 'json' | 'lookup';
  /** Lookup key when `source` is `lookup`. */
  readonly lookup?: string;
  /** Boundary codec for the wire representation. */
  readonly codec: TypertCodec;
  /** Missing wire fields decode to `undefined` only for an explicitly declared `T | undefined`. */
  readonly acceptsUndefined?: true;
}
/** Source position retained for diagnostics from generated definitions. */
interface InvocationSourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
/** Carrier-independent description of one exported method invocation. */
interface InvocationDescriptor {
  /** Globally stable generated identity. */
  readonly id: string;
  /** Cordis service key owning the method. */
  readonly service: string;
  /** Wire namespace, defaulting to the service key. */
  readonly namespace: string;
  /** Public instance method name. */
  readonly method: string;
  /** Service member invoked when the exported method name is an alias. */
  readonly implementation?: string;
  /** Receiver selection mode. */
  readonly invocation: {
    readonly kind: 'direct';
  } | {
    readonly kind: 'context';
    readonly context: string;
    readonly wire: string;
    readonly codec: TypertCodec;
  };
  /** Optional consuming-Context projection for one direct lookup parameter. */
  readonly scope?: {
    /** Context kind whose Client binder supplies the identity. */readonly context: string; /** Lookup parameter wire field replaced by the Context identity. */
    readonly wire: string;
  };
  /** Ordered business parameters. */
  readonly parameters: readonly InvocationParameterDescriptor[];
  /** Transport cancellation injected after business parameters instead of entering wire args. */
  readonly cancellation?: {
    /** Reserved final Host method parameter. */readonly parameter: 'signal';
  };
  /** Codec for the resolved method result. */
  readonly result: TypertCodec;
  /** Source declaration used only for diagnostics. */
  readonly sourceLocation?: InvocationSourceLocation;
}
/** Generated Host contract selected explicitly by a Client assembly. */
interface TypertRemoteContribution {
  /** npm package that owns the Remote methods. */
  readonly package: string;
  /** Consumer-side invocation descriptors generated from that package. */
  readonly descriptors: readonly InvocationDescriptor[];
}
/**
 * Resolve one validated wire identity, synchronously or asynchronously.
 * @param id - validated wire identity.
 * @returns the Host object, or `undefined` when unavailable.
 */
type TypertLookupResolver<Host = unknown, Wire = unknown> = (id: Wire) => Host | undefined | Promise<Host | undefined>;
/** Runtime provider for one declared Host object lookup. */
interface TypertLookupProvider<Host = unknown, Wire = unknown> {
  /** Source parameter name recognized by the SRC weak parser. */
  readonly parameter: string;
  /** Wire field replacing the Host object parameter. */
  readonly wire: string;
  /** Canonical Host type symbol used by strict generation. */
  readonly hostTypeSymbol: string;
  /** Canonical wire type symbol used by strict generation. */
  readonly wireTypeSymbol: string;
  /**
   * Resolve a wire identity through the provider's default policy.
   * @param id - validated wire identity.
   * @returns the object, `undefined` when unavailable, or either asynchronously.
   */
  resolve(id: Wire): Host | undefined | Promise<Host | undefined>;
}
/** Stable wire declaration retained after a lookup provider unloads. */
interface TypertLookupDefinition {
  /** Merge-declared lookup key. */
  readonly key: string;
  /** Source parameter name recognized by the SRC weak parser. */
  readonly parameter: string;
  /** Wire field replacing the Host object parameter. */
  readonly wire: string;
  /** Canonical Host type symbol used by strict generation. */
  readonly hostTypeSymbol: string;
  /** Canonical wire type symbol used by strict generation. */
  readonly wireTypeSymbol: string;
}
/** Host resolver for one scoped Remote kind. */
interface TypertHostContextProvider<Wire = unknown> {
  /** Wire field carrying the Context identity. */
  readonly wire: string;
  /** Canonical wire type symbol used by strict generation. */
  readonly wireTypeSymbol: string;
  /**
   * Resolve a wire identity to its live scoped Context.
   * @param id - validated wire identity.
   * @returns the scoped Context, or `undefined` when unavailable.
   */
  resolve(id: Wire): Context | undefined | Promise<Context | undefined>;
}
/** Composition-owned resolver replacing one Host Context provider's default lookup policy. */
type TypertHostContextResolver<Wire = unknown> = (id: Wire) => Context | undefined | Promise<Context | undefined>;
/** Client resolver for the identity carried by the calling scoped Context. */
interface TypertClientContextBinder<Wire = unknown> {
  /**
   * Read the Remote identity represented by a calling Context.
   * @param ctx - Context rebound by the Cordis service tracker.
   * @returns the wire identity, or `undefined` when the Context has the wrong scope.
   */
  identity(ctx: Context): Wire | undefined;
}
/** Notification emitted after a Typert runtime registry changes. */
interface TypertRegistryChange {
  readonly kind: 'local' | 'remote' | 'lookup' | 'host-context' | 'client-context';
  readonly key: string;
}
/** Listener for one Typert runtime registry. */
type TypertRegistryListener = (change: TypertRegistryChange) => void;
/** Current-environment invocation definitions. */
interface TypertLocalRegistry {
  /**
   * Look up one invocation by `<namespace>/<method>`.
   * @param endpoint - canonical endpoint.
   * @returns the live descriptor, or `undefined` when absent.
   */
  get(endpoint: string): InvocationDescriptor | undefined;
  /**
   * Report whether a strict definition has existed during this Typert Service lifetime.
   * @param endpoint - canonical endpoint.
   * @returns `true` after the endpoint has been registered at least once, even if withdrawn.
   */
  hasSeen(endpoint: string): boolean;
  /** @returns a registration-order snapshot of local descriptors. */
  list(): readonly InvocationDescriptor[];
  /**
   * Observe later local-definition changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  subscribe(listener: TypertRegistryListener): TypertDisposer;
}
/** Consumer-selected Remote contribution registry. */
interface TypertRemoteRegistry {
  /**
   * Register one generated contribution for the calling Cordis fiber.
   * @param contribution - generated Remote descriptors.
   * @returns disposer withdrawing the exact contribution.
   */
  register(contribution: TypertRemoteContribution): TypertDisposer;
  /**
   * Look up one Remote descriptor by endpoint.
   * @param endpoint - canonical endpoint.
   * @returns the descriptor, or `undefined` when unmounted.
   */
  get(endpoint: string): InvocationDescriptor | undefined;
  /** @returns a registration-order snapshot of Remote descriptors. */
  list(): readonly InvocationDescriptor[];
  /**
   * Observe later Remote contribution changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  subscribe(listener: TypertRegistryListener): TypertDisposer;
}
/** Runtime registry for Host object lookup providers. */
interface TypertLookupRegistry {
  /**
   * Register one provider under its merge-declared key.
   * @param key - lookup key.
   * @param provider - owning package's live resolver.
   * @returns disposer withdrawing the exact provider.
   */
  register<K extends StringKeyOf<TypertLookupMap>>(key: K, provider: TypertLookupProvider<TypertLookupHost<TypertLookupMap[K]>, TypertLookupWire<TypertLookupMap[K]>>): TypertDisposer;
  /**
   * Replace one provider's default resolution policy while this contribution is active.
   * Configuration may precede provider registration; without a live provider, `get()` remains unavailable.
   * @param key - lookup key whose wire declaration remains provider-owned.
   * @param resolver - composition-owned resolver used by every lookup of this key.
   * @returns disposer restoring the provider's default resolver.
   */
  configure<K extends StringKeyOf<TypertLookupMap>>(key: K, resolver: TypertLookupResolver<TypertLookupHost<TypertLookupMap[K]>, TypertLookupWire<TypertLookupMap[K]>>): TypertDisposer;
  /**
   * Look up one provider by runtime key.
   * @param key - descriptor lookup key.
   * @returns the live provider, or `undefined` when absent.
   */
  get(key: string): TypertLookupProvider | undefined;
  /** @returns lookup declarations observed during this Typert Service lifetime. */
  definitions(): readonly TypertLookupDefinition[];
  /** @returns a snapshot of registered provider keys. */
  keys(): readonly string[];
  /**
   * Observe later lookup changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  subscribe(listener: TypertRegistryListener): TypertDisposer;
}
/** Runtime registry for Host Context resolvers and Client Context binders. */
interface TypertContextRegistry {
  /**
   * Register a Host Context resolver.
   * @param key - merge-declared Context key.
   * @param provider - owning package's Host resolver.
   * @returns disposer withdrawing the exact provider.
   */
  registerHost<K extends StringKeyOf<TypertContextMap>>(key: K, provider: TypertHostContextProvider<TypertContextWire<TypertContextMap[K]>>): TypertDisposer;
  /**
   * Override one Host Context key's identity policy for the calling fiber.
   * Configuration may precede provider registration and restores the provider's default resolver on disposal.
   * @param key - merge-declared Context key.
   * @param resolver - composition-owned resolver used by every Host Context lookup of this key.
   * @returns disposer restoring the provider's default resolver.
   */
  configureHost<K extends StringKeyOf<TypertContextMap>>(key: K, resolver: TypertHostContextResolver<TypertContextWire<TypertContextMap[K]>>): TypertDisposer;
  /**
   * Register a Client Context identity binder.
   * @param key - merge-declared Context key.
   * @param binder - Client scope identity resolver.
   * @returns disposer withdrawing the exact binder.
   */
  registerClient<K extends StringKeyOf<TypertContextMap>>(key: K, binder: TypertClientContextBinder<TypertContextWire<TypertContextMap[K]>>): TypertDisposer;
  /**
   * Look up a Host Context resolver.
   * @param key - descriptor Context key.
   * @returns the provider, or `undefined` when absent.
   */
  getHost(key: string): TypertHostContextProvider | undefined;
  /**
   * Look up a Client Context binder.
   * @param key - descriptor Context key.
   * @returns the binder, or `undefined` when absent.
   */
  getClient(key: string): TypertClientContextBinder | undefined;
  /**
   * Observe later Context provider changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  subscribe(listener: TypertRegistryListener): TypertDisposer;
}
/** Minimal Typert runtime consumed through dependency inversion. */
interface TypertRegistryContract {
  readonly local: TypertLocalRegistry;
  readonly remotes: TypertRemoteRegistry;
  readonly lookups: TypertLookupRegistry;
  readonly contexts: TypertContextRegistry;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    typert: TypertRegistryContract;
  }
}
//#endregion
//#region ../../packages/core/scope/lib/types/index.d.ts
/** An opaque, identity-compared scope key. */
type ScopeKey = object;
declare const ScopedBrand: unique symbol;
/**
 * A routing-only event receiver built by {@link scopeTarget}. The type
 * parameter records the subject type for dispatch checking; the carrier does
 * not expose the subject's properties. Event payloads carry the real subject.
 */
type Scoped<T extends object> = object & {
  readonly [ScopedBrand]: T;
};
//#endregion
//#region ../../packages/attachment/attachment/lib/types/brand.d.ts
/** Opaque content-addressed identifier for one immutable attachment object. */
type AttachmentId = Branded<'AttachmentId'>;
/**
 * Brand a validated storage identifier.
 * @param value - backend-produced opaque identifier.
 * @returns the branded identifier.
 */
declare function AttachmentId(value: string): AttachmentId;
//#endregion
//#region ../../packages/attachment/attachment/lib/types/types.d.ts
/** Raster image formats accepted by the version-one attachment path. */
type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
/** Durable, serializable metadata for one immutable image object. */
interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId;
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType;
  /** Exact encoded byte length. */
  bytes: number;
  /** Intrinsic encoded width in pixels. */
  width: number;
  /** Intrinsic encoded height in pixels. */
  height: number;
  /** Optional display name stripped of local path information. */
  name?: string;
}
/** Deployment-resolved limits used by upload admission and request buffering. */
interface ImageAttachmentLimits {
  maxImageBytes: number;
  maxImagesPerMessage: number;
  maxMessageImageBytes: number;
  maxImagePixels: number;
  mediaTypes: readonly ImageMediaType[];
}
/** Request to validate and durably commit one image. */
interface SaveImageAttachment {
  data: Uint8Array;
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType;
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string;
}
/** Stored image bytes returned after reference and digest verification. */
interface StoredImageAttachment {
  ref: ImageAttachmentRef;
  data: Uint8Array;
}
//#endregion
//#region ../../packages/attachment/attachment/lib/types/index.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    attachments: AttachmentStore;
  }
}
/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
declare abstract class AttachmentStore extends Service {
  constructor(ctx: Context);
  /** Deployment-resolved image policy used by authoritative and fast-path validation. */
  abstract readonly imageLimits: ImageAttachmentLimits;
  /**
   * Validate one image without persisting it.
   * Batch callers validate every member before saving any member.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns completion after the encoded raster has been fully decoded.
   */
  abstract validateImage(input: SaveImageAttachment): Promise<void>;
  /**
   * Validate one ordered image batch before committing any member.
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may stay
   * unreachable until a future retention policy collects them.
   * @param inputs - encoded images in their owning message order.
   * @returns durable references in the exact input order.
   */
  saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>;
  /**
   * Validate and durably commit one image before its owning session event is appended.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns a durable content-addressed reference.
   */
  abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>;
  /**
   * Read one image and verify that bytes still match the recorded reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns the verified bytes and canonical reference.
   * @throws the signal reason when aborted, or a storage error when verification fails.
   */
  abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>;
}
//#endregion
//#region ../../packages/llm/llm/lib/types/brand.d.ts
/** Stable identity carried by one message across inbox, log, and model-request boundaries. */
type MessageId = Branded<'MessageId'>;
/**
 * Brand a message identifier.
 * @param id - the opaque message identifier.
 * @returns the same string, branded; no validation is performed.
 */
declare function MessageId(id: string): MessageId;
/**
 * Correlates a model-issued tool call with its result. Provider-issued for
 * real adapters; synthesized by mocks/assembler fallbacks.
 */
type CallId = Branded<'CallId'>;
/**
 * Brand a string as a {@link CallId}.
 * @param id - the provider-issued (or synthesized) call id.
 * @returns the same string, branded; no validation is performed.
 */
declare function CallId(id: string): CallId;
/** Provider-issued request identifier retained for diagnostics across package boundaries. */
type ProviderRequestId = Branded<'ProviderRequestId'>;
/**
 * Brand a provider-issued request identifier.
 * @param id - the opaque provider-issued string.
 * @returns the same string, branded; no validation is performed.
 */
declare function ProviderRequestId(id: string): ProviderRequestId;
/** Adapter-owned identifier for one model's selectable reasoning effort. */
type ReasoningEffortId = Branded<'ReasoningEffortId'>;
/**
 * Brand an adapter-owned reasoning-effort identifier.
 * @param id - the opaque identifier exposed by one model capability.
 * @returns the same string, branded; no validation is performed.
 */
declare function ReasoningEffortId(id: string): ReasoningEffortId;
//#endregion
//#region ../../packages/llm/llm/lib/types/message.d.ts
/** Provider/model identity and adapter-private replay data for an assistant message. */
interface AssistantProvenance {
  /** Provider route that produced the message. */
  provider: string;
  /** Provider model id that produced the message. */
  model: string;
  /**
   * Lossless-JSON adapter state needed to replay the provider response.
   * `LlmRuntime` exposes it to a target adapter only when that adapter instance
   * currently owns both this historical provider and the target provider.
   */
  replayState?: unknown;
}
/** Required source of an assistant message produced by a routed model. */
interface ModelMessageSource extends AssistantProvenance {
  kind: 'model';
}
/** Required source of a user-role message carrying one tool result. */
interface ToolMessageSource {
  kind: 'tool';
  callId: CallId;
}
/** One named contribution to a `snapshot`-form context, in assembly order. */
interface ContextSnapshotSection {
  /** The contributing subsystem's name. */
  readonly name: string;
  /** That contribution's model-facing text, exactly as assembled. */
  readonly text: string;
}
/**
 * Producer-declared {@link ContextForm} and the fields that form requires,
 * mixed into the source types that carry one.
 *
 * Discriminated by `form` so a producer cannot select a form without the
 * fields needed to present it: a `notice` must record its one-line
 * account, a `snapshot` its sections. Omitting `form` stays valid — an
 * undeclared context is the documented default.
 */
type ContextFormed = {
  readonly form?: never;
} | {
  readonly form: 'instructions';
} | {
  readonly form: 'catalog';
} | {
  readonly form: 'snapshot'; /** The named contributions this snapshot assembled, in order. */
  readonly sections: readonly ContextSnapshotSection[];
} | {
  readonly form: 'notice'; /** One-line account of what happened, shown without expanding the row. */
  readonly summary: string;
} | {
  readonly form: 'relay';
} | {
  readonly form: 'recall';
};
/**
 * Where a message (or injected content) came from.
 * Merge-extensible sum type — plugins add their own `kind`s.
 */
interface MessageSourceMap {
  user: {
    kind: 'user';
  };
  plugin: {
    kind: 'plugin';
    plugin: string;
  } & ContextFormed;
  model: ModelMessageSource;
  tool: ToolMessageSource;
}
/** Any known message source, derived from {@link MessageSourceMap}; switch on `kind` and fall through unknowns (merge-extensible). */
type MessageSource = MessageSourceMap[keyof MessageSourceMap];
/** One immutable message representation shared by delivery, durable history, and model requests. */
interface Message {
  /** Stable identity preserved across every representation boundary. */
  readonly id: MessageId;
  /** Provider-neutral conversation role. */
  readonly role: 'system' | 'user' | 'assistant';
  /** Exact model-facing blocks. */
  readonly content: ContentBlock[];
  /** Required source fields supplied by the producer. */
  readonly source: MessageSource;
}
/** A user-role specialization of the one shared message representation. */
interface UserMessage$1 extends Message {
  readonly role: 'user';
}
//#endregion
//#region ../../packages/llm/llm/lib/types/types.d.ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The provider topology changed: an adapter registered or unregistered
     * routes, or the configurable-provider directory gained or lost entries.
     * This payload-free registry notification fires at each commit point
     * (including registration disposal); consumers re-read `listProviders()`,
     * `listModels()`, or `listConfigurableProviders()` for the new state.
     * Observer failures are contained and cannot veto the registry mutation.
     * @mode emit
     */
    'llm/adapters-updated'(): void;
  }
}
/** Serializable provider or transport failure facts; policy decides whether they are retryable. */
interface LlmFailure {
  /** Human-readable provider or transport failure. */
  readonly message: string;
  /** Stable provider-neutral machine-routing code. */
  readonly code: string;
  /** HTTP status returned by the provider, when available. */
  readonly status?: number;
  /** Provider-requested delay in milliseconds, when valid and available. */
  readonly providerRetryAfterMs?: number;
  /** Opaque provider-issued request identifier for diagnostics. */
  readonly requestId?: ProviderRequestId;
}
/** Plain text visible to the end user. */
interface TextBlock {
  type: 'text';
  text: string;
}
/** Reasoning / thinking content, distinct from visible text. */
interface ReasoningBlock {
  type: 'reasoning';
  text: string;
}
/**
 * A durable raster image reference, valid in user or assistant content. The
 * block is deliberately role-neutral; assistant-side rendering is forward
 * compatibility — the current production adapters declare text-only output,
 * so only user content carries images today.
 */
interface ImageBlock {
  type: 'image';
  /** Immutable bytes and intrinsic display metadata owned by the attachment service. */
  attachment: ImageAttachmentRef;
}
/** A tool invocation requested by the model. */
interface ToolCallBlock {
  type: 'tool-call';
  /** Provider-issued call id; correlates with the matching tool result. */
  id: CallId;
  name: string;
  /** Raw JSON string as produced by the model. */
  arguments: string;
}
/** The result of a tool invocation, sent back to the model. */
interface ToolResultBlock {
  type: 'tool-result';
  toolCallId: CallId;
  content: ContentBlock[];
  isError?: boolean;
}
/**
 * Merge-extensible content blocks keyed by `type`. New core blocks must land
 * with adapter, UI, and compaction support.
 */
interface ContentBlockMap {
  'text': TextBlock;
  'reasoning': ReasoningBlock;
  'image': ImageBlock;
  'tool-call': ToolCallBlock;
  'tool-result': ToolResultBlock;
}
/** The block `type` tag vocabulary; widens as plugins add entries to {@link ContentBlockMap}. */
type ContentBlockType = keyof ContentBlockMap;
/** Any known content block, derived from {@link ContentBlockMap}; switch on `type` and fall through unknowns (merge-extensible). */
type ContentBlock = ContentBlockMap[ContentBlockType];
/**
 * Why a model response stopped.
 * Merge-extensible so adapters can surface provider-specific reasons.
 */
interface FinishReasonMap {
  'stop': {
    kind: 'stop';
  };
  'tool-calls': {
    kind: 'tool-calls';
  };
  'max-tokens': {
    kind: 'max-tokens';
  };
  'aborted': {
    kind: 'aborted';
    failure: LlmFailure;
  };
  'error': {
    kind: 'error';
    failure: LlmFailure;
  };
}
/** Any known finish reason, derived from {@link FinishReasonMap}; switch on `kind` and fall through unknowns (merge-extensible). */
type FinishReason = FinishReasonMap[keyof FinishReasonMap];
/**
 * Token accounting for one model call (cache fields are optional).
 *
 * Counts are DISJOINT: `inputTokens` is uncached input only; cached input is
 * reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input =
 * sum of the three). Adapters whose providers fold cache hits into a total
 * prompt count (DeepSeek's `prompt_tokens`) subtract them out.
 */
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}
/** Display metadata for one registered provider route. */
interface LlmProviderInfo {
  /** Provider route key used by {@link GenerateOptions.provider}. */
  id: string;
  /** Human-readable provider name for selectors and diagnostics. */
  name: string;
}
/** Merge-extensible provider model modality vocabulary. */
interface ModelModalityMap {
  text: 'text';
  image: 'image';
}
/** Any declared provider model modality. */
type ModelModality = ModelModalityMap[keyof ModelModalityMap];
/**
 * One provider route an adapter plugin can activate through configuration,
 * whether or not the route is currently registered. Configuration surfaces
 * merge this directory with `listProviders()` to offer every configurable
 * provider alongside its live/dormant state.
 */
interface LlmConfigurableProvider {
  /** Provider route key this entry activates when configured. */
  provider: string;
  /** Human-readable provider name for configuration surfaces. */
  displayName: string;
  /** User-settings namespace whose section configures this provider. */
  settingsNs: string;
  /**
   * Path from that namespace's section root to this provider's profile
   * object; empty when the whole section is the profile.
   */
  settingsPath: readonly string[];
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it — a gateway or self-hosted server it ships nothing about.
   * Absent means the adapter draws no such distinction; false means it does
   * and this route is one of its own. Only the adapter can answer: a stored
   * profile is how a user-added route AND a corrected shipped one both look
   * from outside.
   */
  declared?: boolean;
}
/**
 * One interrogation of a provider endpoint that configuration has not stored
 * yet. Configuration surfaces send the draft a user is still editing, so the
 * request carries the endpoint and credential directly instead of naming a
 * route: a provider being added has no route to name.
 */
interface LlmModelDiscoveryRequest {
  /**
   * Route the draft is editing, when it edits an existing one. A route whose
   * adapter already knows its models answers from that knowledge instead of
   * asking the endpoint — the adapter's own registry is the better answer, and
   * it costs no network call.
   */
  provider?: string;
  /**
   * Endpoint to interrogate. Optional because a route the adapter already
   * describes needs none; a route it does not must supply one.
   */
  baseURL?: string;
  /** Wire protocol the endpoint speaks, when the draft names one. */
  api?: string;
  /** Credential for this interrogation alone; the harness never stores it. */
  apiKey?: string;
  /** Caller cancellation; implementations must settle promptly after it aborts. */
  signal?: AbortSignal;
}
/**
 * One model an endpoint reports about itself. Every field but the id is
 * optional because most provider listings disclose an id and nothing else;
 * a surface adopting one of these still owes the capacities its adapter needs.
 */
interface LlmDiscoveredModel {
  /** Model id the endpoint accepts. */
  id: string;
  /** Human-readable name when the endpoint supplies one. */
  name?: string;
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number;
  /** Maximum output tokens, when disclosed. */
  maxTokens?: number;
}
/** One adapter-discovered model; catalog membership is advisory, not request validation. */
interface LlmModelInfo {
  /** Provider route that owns this model entry. */
  provider: string;
  /** Model id passed to {@link GenerateOptions.model}. */
  id: string;
  /** Human-readable model name for selectors. */
  name: string;
  /** Optional user-facing distinction from otherwise similar models. */
  description?: string;
  /** Accepted request modalities; absent means unknown, while an explicit omission is negative capability. */
  inputModalities?: readonly ModelModality[];
}
/** Provider-owned context capacity for one exact provider/model route. */
interface LlmModelContext {
  /** Maximum combined request and response context in tokens. */
  contextWindow: number;
}
/** Display metadata for one adapter-owned reasoning effort. */
interface LlmReasoningEffortInfo {
  /** Opaque stable value accepted by {@link GenerateOptions.reasoningEffort}. */
  id: ReasoningEffortId;
  /** Human-readable effort name for selectors and diagnostics. */
  name: string;
  /** Optional user-facing distinction from otherwise similar efforts. */
  description?: string;
}
/** Selectable reasoning efforts for one exact provider/model route. */
interface LlmModelReasoningInfo {
  /** Supported efforts in adapter-preferred display order. */
  efforts: readonly LlmReasoningEffortInfo[];
  /**
   * Adapter-configured default materialized into requests when callers omit
   * an effort. Absence preserves the provider's own default.
   */
  defaultEffort?: ReasoningEffortId;
}
/** Exact-route model metadata resolved by its owning adapter. */
interface LlmResolvedModelInfo extends LlmModelInfo {
  /** Provider-owned context capacity when known. */
  context?: LlmModelContext;
  /** Adapter-configured per-request output cap materialized when callers omit one. */
  defaultMaxTokens?: number;
  /** Adapter-owned selectable reasoning levels when exposed. */
  reasoning?: LlmModelReasoningInfo;
}
/**
 * Adapter-private lossless-JSON state for replaying a successful response,
 * carried by a terminal `finish` chunk and stored on the assembled assistant
 * message's model source. Both halves stay opaque to the harness; only the
 * split is shared vocabulary, so assembly can keep stored metadata aligned
 * with stored content without reading either half.
 */
interface ReplayEnvelope {
  /** Response-level adapter-private metadata (ids, native stop reason). */
  response: unknown;
  /**
   * Per-block adapter-private metadata, one entry per emitted block in
   * first-seen stream order. When assembly drops a block it drops the entry at
   * the same position; entries whose length does not match the emitted block
   * count discard the whole envelope. An adapter whose metadata is independent
   * of block structure omits this field and the envelope passes through
   * assembly unchanged.
   */
  blocks?: readonly unknown[];
}
/**
 * Raw streaming protocol emitted by adapters.
 * Block indexes correlate interleaved deltas, and `block-end` carries the
 * assembled block. Adapters emit usage before the terminal finish and nothing
 * afterward; tool arguments remain raw JSON strings. An adapter implementation
 * may throw, but `LlmRuntime.stream()` normalizes that failure to a terminal
 * `error` or `aborted` finish before exposing it to consumers.
 */
type StreamChunk = {
  type: 'block-start';
  index: number;
  blockType: ContentBlockType;
} | {
  type: 'text-delta';
  index: number;
  text: string;
} | {
  type: 'reasoning-delta';
  index: number;
  text: string;
} | {
  type: 'tool-call-delta';
  index: number;
  id: CallId;
  name?: string;
  argumentsDelta: string;
} | {
  type: 'block-end';
  index: number;
  block: ContentBlock;
} | {
  type: 'usage';
  usage: TokenUsage;
} | {
  type: 'finish';
  reason: FinishReason; /** Replay metadata for a successful response; see {@link ReplayEnvelope}. */
  replayState?: ReplayEnvelope;
};
/**
 * JSON-schema description of a tool, as sent to the model.
 *
 * Declared here (not in dsh-tools) because it is part of {@link GenerateOptions};
 * dsh-tools' ToolDefinition and dsh-system-prompt's PromptAssembly both import
 * it from this package.
 */
interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema object for the arguments. */
  parameters: Record<string, unknown>;
}
/** A single model request, fully assembled. */
interface GenerateOptions {
  /** Registered provider route selecting the adapter instance. */
  provider: string;
  model: string;
  /** Adapter-owned reasoning effort selected for this exact model. */
  reasoningEffort?: ReasoningEffortId;
  /**
   * Ordered conversation messages, exactly as the provider sees them (after
   * the `system` slot). A loop-built request assembles them as
   * the derived history (dsh-agent-loop); a hand-built one-shot passes any list.
   */
  messages: Message[];
  /** System prompt text (adapters map to the provider's system slot). */
  system?: string;
  /** Tool schemas (adapters map to the provider's `tools` field). */
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /**
   * Stop sequences: generation halts as soon as the model produces any one of
   * these strings (adapters map to the provider's stop field, e.g. OpenAI
   * `stop`). The stop string itself is not included in the output.
   */
  stop?: string[];
  signal?: AbortSignal;
  /**
   * Session identity stamped by the loop for request routing. Replay uses it
   * to separate cursors; adapters may map it to model-hidden transport metadata.
   */
  sessionId?: Branded<'SessionId'>;
  /**
   * Provider-neutral classification for an auxiliary model call. Adapters may
   * map the purpose to model-hidden transport metadata or purpose-specific
   * generation policy. Ordinary conversation requests leave it unset.
   */
  purpose?: 'compaction' | 'session-title';
}
//#endregion
//#region ../../vendor/cosmokit/lib/types/types.d.ts
declare function isArrayBufferLike(value: any): value is ArrayBufferLike;
declare function isArrayBufferSource(value: any): value is Binary.Source;
/** Binary source detection and base64/hex conversion helpers. */
declare namespace Binary {
  type Source<T extends ArrayBufferLike = ArrayBufferLike> = T | ArrayBufferView<T>;
  const is: typeof isArrayBufferLike;
  const isSource: typeof isArrayBufferSource;
  function fromSource<T extends ArrayBufferLike>(source: Source<T>): T;
  function toBase64(source: Source): string;
  function fromBase64(source: string): ArrayBuffer | Uint8Array<ArrayBuffer>;
  function toHex(source: Source): string;
  function fromHex(source: string): ArrayBuffer;
}
//#endregion
//#region ../../vendor/cosmokit/lib/types/misc.d.ts
/** String/symbol keyed dictionary type. */
type Dict<T = any, K extends string | symbol = string> = { [key in K]: T };
//#endregion
//#region ../../node_modules/.pnpm/@standard-schema+spec@1.1.0/node_modules/@standard-schema/spec/dist/index.d.ts
/** The Standard Typed interface. This is a base type extended by other specs. */
interface StandardTypedV1<Input = unknown, Output = Input> {
  /** The Standard properties. */
  readonly "~standard": StandardTypedV1.Props<Input, Output>;
}
declare namespace StandardTypedV1 {
  /** The Standard Typed properties interface. */
  interface Props<Input = unknown, Output = Input> {
    /** The version number of the standard. */
    readonly version: 1;
    /** The vendor name of the schema library. */
    readonly vendor: string;
    /** Inferred types associated with the schema. */
    readonly types?: Types<Input, Output> | undefined;
  }
  /** The Standard Typed types interface. */
  interface Types<Input = unknown, Output = Input> {
    /** The input type of the schema. */
    readonly input: Input;
    /** The output type of the schema. */
    readonly output: Output;
  }
  /** Infers the input type of a Standard Typed. */
  type InferInput<Schema extends StandardTypedV1> = NonNullable<Schema["~standard"]["types"]>["input"];
  /** Infers the output type of a Standard Typed. */
  type InferOutput<Schema extends StandardTypedV1> = NonNullable<Schema["~standard"]["types"]>["output"];
}
/** The Standard Schema interface. */
interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}
declare namespace StandardSchemaV1 {
  /** The Standard Schema properties interface. */
  interface Props<Input = unknown, Output = Input> extends StandardTypedV1.Props<Input, Output> {
    /** Validates unknown input values. */
    readonly validate: (value: unknown, options?: StandardSchemaV1.Options | undefined) => Result<Output> | Promise<Result<Output>>;
  }
  /** The result interface of the validate function. */
  type Result<Output> = SuccessResult<Output> | FailureResult;
  /** The result interface if validation succeeds. */
  interface SuccessResult<Output> {
    /** The typed output value. */
    readonly value: Output;
    /** A falsy value for `issues` indicates success. */
    readonly issues?: undefined;
  }
  interface Options {
    /** Explicit support for additional vendor-specific parameters, if needed. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }
  /** The result interface if validation fails. */
  interface FailureResult {
    /** The issues of failed validation. */
    readonly issues: ReadonlyArray<Issue>;
  }
  /** The issue interface of the failure output. */
  interface Issue {
    /** The error message of the issue. */
    readonly message: string;
    /** The path of the issue, if any. */
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  /** The path segment interface of the issue. */
  interface PathSegment {
    /** The key representing a path segment. */
    readonly key: PropertyKey;
  }
  /** The Standard types interface. */
  interface Types<Input = unknown, Output = Input> extends StandardTypedV1.Types<Input, Output> {}
  /** Infers the input type of a Standard. */
  type InferInput<Schema extends StandardTypedV1> = StandardTypedV1.InferInput<Schema>;
  /** Infers the output type of a Standard. */
  type InferOutput<Schema extends StandardTypedV1> = StandardTypedV1.InferOutput<Schema>;
}
/** The Standard JSON Schema interface. */
//#endregion
//#region ../../vendor/schemastery/lib/types/index.d.ts
declare const kSchema: unique symbol;
declare global {
  namespace Schemastery {
    /** Convert primitive constructors, constants, and existing schemas into a schema type. */
    type From<X> = X extends string | number | boolean ? Schema<X> : X extends Schema ? X : X extends typeof String ? Schema<string> : X extends typeof Number ? Schema<number> : X extends typeof Boolean ? Schema<boolean> : X extends typeof Function ? Schema<Function, (...args: any[]) => any> : X extends Constructor<infer S> ? Schema<S> : never;
    type TypeS1<X> = X extends Schema<infer S, unknown> ? S : never;
    type Inverse<X> = X extends Schema<any, infer Y> ? (arg: Y) => void : never;
    /** Input type accepted by a schema-like value. */
    type TypeS<X> = TypeS1<From<X>>;
    /** Output type returned by a schema-like value after validation. */
    type TypeT<X> = ReturnType<From<X>>;
    /** Resolver callback used by custom schema types registered with `Schema.extend()`. */
    type Resolve = (data: any, schema: Schema, options: Options, strict?: boolean) => [any, any?];
    /** Input type accepted by one schema in an intersection. */
    type IntersectS<X> = From<X> extends Schema<infer S, unknown> ? S : never;
    /** Output type returned by one schema in an intersection. */
    type IntersectT<X> = Inverse<From<X>> extends ((arg: infer T) => void) ? T : never;
    type TupleS<X extends readonly any[]> = X extends readonly [infer L, ...infer R] ? [TypeS<L>?, ...TupleS<R>] : any[];
    type TupleT<X extends readonly any[]> = X extends readonly [infer L, ...infer R] ? [TypeT<L>?, ...TupleT<R>] : any[];
    type ObjectS<X extends Dict> = { [K in keyof X]?: TypeS<X[K]> | null } & Dict;
    type ObjectT<X extends Dict> = { [K in keyof X]: TypeT<X[K]> } & Dict;
    type Constructor<T = any> = new (...args: any[]) => T;
    /** Static constructor and factory methods exposed by the default `Schema` export. */
    interface Static {
      <T = any>(options: Partial<Schema<T>>): Schema<T>;
      new <T = any>(options: Partial<Schema<T>>): Schema<T>;
      prototype: Schema;
      /** Validate a value against a schema node and return `[output, adaptedInput?]`. */
      resolve: Resolve;
      /** Infer a schema from a primitive value, constructor, or existing schema. */
      from<X = any>(source?: X): From<X>;
      /** Register a resolver for a custom schema `type`. */
      extend(type: string, resolve: Resolve): void;
      /** Accept any value without validation. */
      any<T = any>(): Schema<T>;
      /** Accept only nullable input. */
      never(): Schema<never>;
      /** Accept exactly one constant value. */
      const<const T>(value: T): Schema<T>;
      /** Accept strings, with optional metadata constraints added by instance methods. */
      string(): Schema<string>;
      /** Accept numbers, with optional range and step constraints. */
      number(): Schema<number>;
      /** Accept non-negative integer numbers. */
      natural(): Schema<number>;
      /** Accept a number between 0 and 1 and mark it as a slider. */
      percent(): Schema<number>;
      /** Accept booleans. */
      boolean(): Schema<boolean>;
      /** Accept `Date` instances or parse datetime strings into `Date` objects. */
      date(): Schema<string | Date, Date>;
      /** Accept `RegExp` instances or parse strings into regular expressions. */
      regExp(flag?: string): Schema<string | RegExp, RegExp>;
      /** Accept binary sources and normalize them to `ArrayBufferLike`. */
      arrayBuffer(): Schema<Binary.Source, ArrayBufferLike>;
      arrayBuffer(encoding: 'hex' | 'base64'): Schema<Binary.Source | string, ArrayBufferLike>;
      /** Accept a numeric bitset or string keys and normalize to a number. */
      bitset<K extends string>(bits: Partial<Record<K, number>>): Schema<number | readonly K[], number>;
      /** Accept functions. */
      function(): Schema<Function, (...args: any[]) => any>;
      /** Accept instances of a constructor or objects whose constructor name matches. */
      is(constructor: string): Schema;
      is<T>(constructor: Constructor<T>): Schema<T>;
      /** Accept arrays whose elements match `inner`. */
      array<X>(inner: X): Schema<TypeS<X>[], TypeT<X>[]>;
      /** Accept plain objects with values matching `inner` and optional key schema. */
      dict<X, Y extends Schema<any, string> = Schema<string>>(inner: X, sKey?: Y): Schema<Dict<TypeS<X>, TypeS<Y>>, Dict<TypeT<X>, TypeT<Y>>>;
      /** Accept tuple arrays where each index matches the corresponding schema. */
      tuple<const X extends readonly any[]>(list: X): Schema<TupleS<X>, TupleT<X>>;
      /** Accept plain objects whose declared properties match the schema dictionary. */
      object<X extends Dict>(dict: X): Schema<ObjectS<X>, ObjectT<X>>;
      /** Accept values matching at least one schema in `list`. */
      union<const X>(list: readonly X[]): Schema<TypeS<X>, TypeT<X>>;
      /** Accept values matching every schema in `list`, merging object outputs. */
      intersect<const X>(list: readonly X[]): Schema<IntersectS<X>, IntersectT<X>>;
      /** Validate with `inner`, then convert the result with `callback`. */
      transform<X, T>(inner: X, callback: (value: TypeS<X>, options: Schemastery.Options) => T, preserve?: boolean): Schema<TypeS<X>, T>;
      /** Defer construction of a recursive schema until validation or serialization. */
      lazy<X extends Schema>(callback: () => X): X;
      ValidationError: typeof ValidationError;
    }
    /** Runtime validation options shared by all schema calls. */
    interface Options {
      /** Remove invalid object properties instead of throwing when possible. */
      autofix?: boolean;
      /** Skip validation for selected values and schema nodes. */
      ignore?(data: any, schema: Schema): boolean;
      /** Path used to format nested validation errors. */
      path?: (keyof any)[];
    }
    /** UI and validation metadata attached by schema builder methods. */
    interface Meta<T = any> {
      default?: T extends {} ? Partial<T> : T;
      required?: boolean;
      disabled?: boolean;
      collapse?: boolean;
      badges?: {
        text: string;
        type: string;
      }[];
      hidden?: boolean;
      loose?: boolean;
      role?: string;
      extra?: any;
      link?: string;
      description?: string | Dict<string>;
      comment?: string;
      pattern?: {
        source: string;
        flags?: string;
      };
      max?: number;
      min?: number;
      step?: number;
    }
  }
  /** Callable schema instance that validates input and returns normalized output. */
  interface Schemastery<S = any, T = S> {
    (data?: S | null, options?: Schemastery.Options): T;
    new (data?: S | null, options?: Schemastery.Options): T;
    [kSchema]: true;
    uid: number;
    meta: Schemastery.Meta<T>;
    type: string;
    sKey?: Schema;
    inner?: Schema;
    list?: Schema[];
    dict?: Dict<Schema>;
    bits?: Dict<number>;
    callback?: Function;
    constructor?: string | Function;
    builder?: Function;
    value?: T;
    refs?: Dict<Schema>;
    preserve?: boolean;
    '~standard': StandardSchemaV1.Props;
    /** Format this schema as a compact TypeScript-like type string. */
    toString(inline?: boolean): string;
    /** Serialize this schema, preserving shared and recursive references. */
    toJSON(): Schema<S, T>;
    /** Mark nullable input as invalid unless a default supplies a fallback. */
    required(value?: boolean): Schema<S, T>;
    /** Hide this schema node from UI renderers. */
    hidden(value?: boolean): Schema<S, T>;
    /** Return the default value instead of throwing when validation fails. */
    loose(value?: boolean): Schema<S, T>;
    /** Attach a renderer role and optional role-specific metadata. */
    role(text: string, extra?: any): Schema<S, T>;
    /** Attach an external documentation link. */
    link(link: string): Schema<S, T>;
    /** Set the fallback value used for nullable input. */
    default(value: T): Schema<S, T>;
    /** Attach an auxiliary comment for documentation or form UIs. */
    comment(text: string): Schema<S, T>;
    /** Attach a localized or plain description for documentation or form UIs. */
    description(text: string): Schema<S, T>;
    /** Mark this schema node as disabled for form UIs. */
    disabled(value?: boolean): Schema<S, T>;
    /** Request collapsed rendering for nested form UIs. */
    collapse(value?: boolean): Schema<S, T>;
    /** Add a deprecated badge to this schema node. */
    deprecated(): Schema<S, T>;
    /** Add an experimental badge to this schema node. */
    experimental(): Schema<S, T>;
    /** Require strings to match a regular expression. */
    pattern(regexp: RegExp): Schema<S, T>;
    /** Set an inclusive maximum for numbers or collection lengths. */
    max(value: number): Schema<S, T>;
    /** Set an inclusive minimum for numbers or collection lengths. */
    min(value: number): Schema<S, T>;
    /** Set the numeric increment constraint. */
    step(value: number): Schema<S, T>;
    /** Add or replace an object property schema. */
    set(key: string, value: Schema): Schema<S, T>;
    /** Append a tuple, union, or intersection member schema. */
    push(value: Schema): Schema<S, T>;
    /** Remove values equal to schema defaults from normalized output. */
    simplify(value?: any): any;
    /** Return a schema clone with descriptions merged from locale messages. */
    i18n(messages: Dict): Schema<S, T>;
    /** Attach arbitrary metadata consumed by form renderers and downstream tools. */
    extra<K extends keyof Schemastery.Meta>(key: K, value: Schemastery.Meta[K]): Schema<S, T>;
  }
}
declare class ValidationError extends TypeError {
  options: Schemastery.Options;
  name: string;
  constructor(message: string, options: Schemastery.Options);
  static is(error: any): error is ValidationError;
}
type Schema<S = any, T = S> = Schemastery<S, T>;
declare const Schema: Schemastery.Static;
//#endregion
//#region ../../packages/llm/llm/lib/types/retry-policy.d.ts
/** Fully resolved backoff shared by both retry modes. */
interface ResolvedRetryBackoff {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}
/** Fully resolved bounded transient retry policy. */
interface ResolvedNormalRetryPolicy extends ResolvedRetryBackoff {
  readonly mode: 'normal';
  readonly maxRetries: number;
  readonly retryableCodes: readonly string[];
}
/** Fully resolved unbounded retry policy. */
interface ResolvedAlwaysRetryPolicy extends ResolvedRetryBackoff {
  readonly mode: 'always';
}
/** Immutable provider policy captured when its adapter route is registered. */
type ResolvedRetryPolicy = ResolvedNormalRetryPolicy | ResolvedAlwaysRetryPolicy;
//#endregion
//#region ../../packages/llm/llm/lib/types/call-config.d.ts
/**
 * Provider, model, reasoning effort, and sampling scalars of one conversation's
 * requests. Every field maps 1:1 onto the same-named `GenerateOptions` field;
 * the loop builds requests from the logged header rather than accepting these
 * per call.
 */
interface LlmCallConfig {
  provider: string;
  model: string;
  reasoningEffort?: ReasoningEffortId;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}
/**
 * Effective config fields supplied by exact-model adapter resolution rather
 * than by the caller's request proposal.
 */
interface LlmCallConfigAdapterDefaults {
  reasoningEffort?: true;
  maxTokens?: true;
}
//#endregion
//#region ../../packages/llm/llm/lib/types/index.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    llm: LlmRuntime;
  }
  interface Events {
    /**
     * Waterfall around every streaming model call (retry, replay, routing).
     * Bound to the {@link LlmRuntime}; call `next()` to reach the resolved
     * adapter's stream, or yield your own chunks to short-circuit.
     * @param options - the full request. A LOOP-built request carries the
     *   process-local {@link markAgentLoopRequest} identity and arrives deep-frozen
     *   (mutation throws): its content is a pure function of the session log (the
     *   reconstructability Agent Note), so listeners read it, never rewrite it.
     *   Hand-built calls do not carry that marker; their messages already obey
     *   the immutable creation contract.
     * @mode waterfall
     */
    'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>;
  }
}
/** Structured provider facts and cause accepted by {@link LlmError}. */
/** One model call whose config and adapter registration were resolved together. */
interface PreparedLlmCall {
  /** Detached, deep-frozen config with any adapter-owned default materialized. */
  readonly config: LlmCallConfig;
  /** Immutable retry policy captured with the adapter registration. */
  readonly retryPolicy: ResolvedRetryPolicy;
  /** Detached context metadata resolved with the registration-bound call. */
  readonly context?: LlmModelContext;
  /** Config fields materialized by the captured adapter rather than proposed by the caller. */
  readonly adapterDefaults: LlmCallConfigAdapterDefaults;
  /**
   * Dispatch this call once through the registration captured during
   * preparation. The request's call-config fields must match {@link config};
   * reuse or mismatch fails with `INVALID_PREPARED_CALL`.
   * @param options - fully assembled request carrying the prepared config.
   * @returns the chunk stream, including the `llm/stream` waterfall.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/**
 * Provider-wire adapter for the harness message and stream vocabulary. Register implementations
 * with `ctx.llm.registerAdapter(providers, adapter)`. Every provider HTTP request must include
 * `attributionHeaders()`; prove the headers are added in the wire request or library header hook. The direct-fetch
 * DeepSeek and library-backed pi-ai adapters meet this contract through different internals.
 */
declare abstract class LlmAdapter {
  /**
   * Describe one provider route owned by this adapter.
   * @param provider - a route passed to `registerAdapter()` for this instance.
   * @returns detached display metadata whose id must equal `provider`.
   */
  providerInfo(provider: string): LlmProviderInfo;
  /**
   * Return the provider-owned retry policy captured with this route.
   * @param _provider - a route passed to `registerAdapter()` for this instance.
   * @returns a resolved policy, or `undefined` to use the normal defaults.
   */
  providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined;
  /**
   * List models this adapter can currently advertise for one owned provider.
   * The result is advisory: an adapter may accept unlisted model ids, and
   * consumers must not turn absence into request rejection.
   * @param _provider - one provider route owned by this adapter.
   * @returns discoverable models in adapter-preferred order.
   */
  listModels(_provider: string): Promise<readonly LlmModelInfo[]>;
  /**
   * Resolve all metadata available for one exact model. This query is
   * independent of the advisory catalog and does not validate request routing.
   * @param provider - one provider route owned by this adapter.
   * @param model - exact model id passed to {@link GenerateOptions.model}.
   * @param _signal - cancellation for this exact-model lookup; asynchronous
   *   implementations must settle promptly after it aborts.
   * @returns provider/model identity plus any context, call-default, and reasoning metadata.
   */
  resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
  /**
   * Stream one model call as raw chunks. The only required method.
   * @param options - the fully-assembled request; implementations must honor `options.signal`.
   * @returns the chunk stream, obeying the adapter contract documented on `StreamChunk`.
   */
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/**
 * What {@link LlmRuntime.registerAdapter} returns: the disposer, plus an
 * atomic route replacement for the same adapter instance.
 */
interface AdapterRegistrationHandle {
  /** Release every route this registration currently holds. */
  (): void;
  /**
   * Replace this registration's routes with `providers`, keeping the same
   * adapter instance. The candidate set is validated in full first — a
   * conflict with another adapter, an invalid name, or bad provider metadata
   * throws and leaves the current routes untouched — and the swap itself is
   * one synchronous section, so no request can observe a gap. An empty array
   * is legal here (a settings section that emptied holds zero routes while
   * staying registered), unlike an empty initial registration.
   *
   * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
   * has been released: its routes are gone and its disposer has already run,
   * so anything registered afterwards would have no owner left to release it.
   * @param providers - the complete next route set for this registration.
   */
  replace(providers: string[]): void;
}
/**
 * A live configurable-provider registration, disposable and atomically
 * replaceable — the directory counterpart of {@link AdapterRegistrationHandle}.
 */
interface DirectoryRegistrationHandle {
  /** Withdraw every entry this registration currently holds. */
  (): void;
  /**
   * Replace this registration's entries with `entries`. The candidate set is
   * validated in full first — an entry another registration already declares,
   * a duplicate within the set, or invalid metadata throws and leaves the
   * current entries untouched — and the swap is one synchronous section, so no
   * reader observes a gap. An empty array is legal here, unlike an empty
   * initial registration.
   *
   * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
   * has been disposed.
   */
  replace(entries: readonly LlmConfigurableProvider[]): void;
}
/**
 * The abstract `llm` service: an adapter registry plus a streaming model-call
 * API, interceptable via the `llm/stream` waterfall.
 */
declare class LlmRuntime extends Service {
  private adapters;
  private directory;
  private discoveries;
  constructor(ctx: Context);
  /** Notify topology observers without letting one broken listener veto the commit. */
  private emitAdaptersUpdated;
  /** Contained-listener diagnostic shared by the sync and async failure paths. */
  private warnAdaptersListenerFailure;
  /**
   * Register an adapter for the given provider routes. Throws `LlmError` with code
   * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
   * Disposed with the fiber.
   * @param providers - every provider route this adapter should serve.
   * @param adapter - the adapter that streams calls for those providers.
   * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
   */
  registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle;
  /**
   * Validate one candidate route set for `adapter`, treating routes this
   * registration already holds as available. Nothing is mutated: a rejected
   * candidate leaves the registry exactly as it was.
   */
  private prepareRoutes;
  /**
   * Swap this registration's routes for the prepared ones in one synchronous
   * section, so no observer can see the registry between the release and the
   * re-registration. The route set's one mutation point is also where
   * `llm/adapters-updated` is published, so a `replace` announces itself
   * exactly like a first registration.
   */
  private commitRoutes;
  /**
   * Describe provider routes with a registered adapter.
   * @returns detached provider metadata in registration order.
   */
  listProviders(): LlmProviderInfo[];
  /**
   * Declare provider routes an adapter plugin can activate through
   * configuration. Registration is all-or-nothing: an empty list, invalid
   * entry, or a provider already declared by any registration throws
   * `LlmError` without registering the rest. Disposed with the fiber.
   * @param entries - every configurable provider this plugin owns.
   * @returns a handle that withdraws all of them, and can atomically replace them.
   */
  registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle;
  /**
   * List every declared configurable provider, registered or dormant.
   * @returns detached directory entries in declaration order.
   */
  listConfigurableProviders(): LlmConfigurableProvider[];
  /**
   * Offer to interrogate provider endpoints on behalf of the settings
   * namespace this plugin owns. The namespace is the key because that is what
   * a configuration surface already holds from the configurable-provider
   * directory, and because a provider being *added* has no route to name yet.
   * Disposed with the fiber.
   * @param settingsNs - the namespace whose profiles this discovery serves.
   * @param discover - interrogates one endpoint; must honor `request.signal`.
   * @returns the disposer that withdraws the offer.
   */
  registerModelDiscovery(settingsNs: string, discover: (request: LlmModelDiscoveryRequest) => Promise<readonly LlmDiscoveredModel[]>): () => void;
  /**
   * Interrogate one provider endpoint for the models it advertises. The
   * request describes a draft, not a stored route, so nothing here reads or
   * writes settings or credentials — the caller owns both, and the reply is
   * candidate metadata a surface may offer for adoption.
   * @param settingsNs - namespace whose registered discovery serves this draft.
   * @param request - the endpoint, protocol, and one-shot credential to use.
   * @returns the advertised models, deduplicated in endpoint order.
   */
  discoverModels(settingsNs: string, request: LlmModelDiscoveryRequest): Promise<LlmDiscoveredModel[]>;
  /**
   * Resolve the retry policy captured when one provider route was registered.
   * @param provider - registered provider route to inspect.
   * @returns the provider-owned policy, with normal defaults already resolved.
   */
  providerRetryPolicy(provider: string): ResolvedRetryPolicy;
  /** Detach typed adapter-owned modality metadata. */
  private detachedModalities;
  /**
   * Discover models advertised by one registered provider. Catalog membership
   * is advisory and never changes routing or request validation.
   * @param provider - registered provider route to inspect.
   * @returns detached model metadata in adapter-preferred order.
   */
  listModels(provider: string): Promise<LlmModelInfo[]>;
  /**
   * Resolve and validate all metadata from the adapter that owns one exact
   * route. The result is detached from adapter-owned objects; catalog
   * membership remains advisory and does not control request routing.
   * @param provider - registered provider route to inspect.
   * @param model - exact model id passed to the adapter.
   * @param signal - optional cancellation for adapter-owned asynchronous lookup.
   * @returns exact model identity plus available context and reasoning metadata.
   */
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
  private resolveModelInfoFor;
  /**
   * Validate a conversation call config against its exact model capability and
   * materialize adapter-configured defaults. Unsupported explicit efforts
   * reject before provider I/O; no clamping or aliasing is performed. This
   * standalone query does not bind a later dispatch; use {@link prepareCall}
   * when logging and streaming must share one adapter registration.
   * @param config - provider/model route and optional request controls.
   * @param signal - optional cancellation for adapter-owned capability lookup.
   * @returns a detached config only when a default must be materialized.
   */
  resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>;
  private resolveCallFor;
  /**
   * Resolve one call under its current adapter registration. The returned
   * one-shot handle keeps that registration across header logging and dispatch,
   * so HMR cannot combine one adapter's capability result with another adapter.
   * @param config - provider/model route and optional request controls.
   * @param signal - optional cancellation for adapter-owned capability lookup.
   * @returns a prepared config and its registration-bound stream entry point.
   */
  prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>;
  private registration;
  /** Remove replay state whose historical route is owned by another adapter. */
  private forAdapter;
  /**
   * Final adapter boundary. Adapter selection, dispatch, iterator construction,
   * and iteration failures become one terminal failure chunk. Middleware and
   * downstream consumer failures remain thrown plugin or consumer errors.
   */
  private adapterStream;
  /**
   * Stream one model call as raw chunks (token-level deltas). Replay state is
   * retained only when the same adapter instance owns its historical provider
   * and the target provider. Final adapter selection remains fixed through
   * asynchronous exact-model resolution and dispatch. Adapter selection,
   * dispatch, and iteration failures become terminal `error` or `aborted`
   * finish chunks; middleware, nested-call, cleanup, and consumer failures
   * remain thrown.
   * @param options - the full request; `options.provider` selects the adapter.
   * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
  private streamWithRegistration;
}
//#endregion
//#region ../../packages/core/agent/lib/types/types.d.ts
/** One of the two ordered pending-message lists owned by an agent. */
type InboxTarget = 'next-turn' | 'next-step';
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One normalized mutation of an agent's durable pending-message lists.
     * Live dispatch precedes projection mutation, so synchronous observers may
     * read the pre-splice inbox to recover the removed messages.
     */
    'agent/inbox/spliced': {
      target: InboxTarget;
      start: number;
      removedCount?: number;
      inserted: UserMessage$1[];
      outcome?: 'canceled';
    };
  }
} //# sourceMappingURL=types.d.ts.map
//#endregion
//#region ../../packages/core/agent/lib/types/inbox.d.ts
/** Live notifications committed by inbox mutations. */
interface InboxNotifications {
  /** Publish one inserted message. */
  inserted(message: UserMessage): void;
  /** Publish one discarded message. */
  discarded(message: UserMessage): void;
  /** Publish one claimed message inside its owning turn. */
  claimed(message: UserMessage, turn: number): void;
}
/** A replay-once projection that incrementally consumes later inbox splices. */
declare class Inbox {
  private readonly session;
  private readonly notifications;
  private readonly state;
  constructor(session: Session, notifications: InboxNotifications);
  /** Prompts awaiting individual turns. */
  get nextTurn(): readonly UserMessage[];
  /** Input awaiting the next step boundary. */
  get nextStep(): readonly UserMessage[];
  /** Whether either pending-message list contains work. */
  get hasPending(): boolean;
  /** Durably cancel all pending input, clearing next-step before next-turn. */
  clear(): void;
  /**
   * Remove and return the complete batch proposed for one step, publishing
   * each claimed message. The durable splices are pure deletions.
   * @param target - whether this boundary also consumes one queued turn.
   * @param turn - turn that will own the claimed batch.
   * @returns next-step input followed by the queued turn, when requested.
   * @internal - The agent loop's step-boundary operation, not a plugin extension point.
   */
  claim(target: InboxTarget, turn: number): UserMessage[];
  /**
   * Append one message to a pending list and durably record the insertion.
   * @param target - pending list to extend.
   * @param message - message to append.
   * @throws if the message identity is already pending.
   */
  append(target: InboxTarget, message: UserMessage): void;
  /**
   * Prepend one message to a pending list and durably record the insertion.
   * @param target - pending list to extend.
   * @param message - message to prepend.
   * @throws if the message identity is already pending.
   */
  prepend(target: InboxTarget, message: UserMessage): void;
  /**
   * Replace one pending message in place, possibly changing its identity. A
   * successful replacement publishes the old message as discarded and the new
   * message as inserted.
   * @param messageId - identity of the pending message to replace.
   * @param newMessage - replacement message.
   * @returns whether the message was still pending.
   * @throws if the replacement duplicates another pending message identity.
   */
  replace(messageId: MessageId, newMessage: UserMessage): boolean;
  /**
   * Remove one pending message and durably record its cancellation.
   * @param messageId - identity of the pending message to remove.
   * @returns whether the message was still pending.
   */
  remove(messageId: MessageId): boolean;
  /**
   * Apply standard splice semantics and durably record the normalized result.
   * The durable event commits before the live projection mutates, so synchronous
   * `session/event` observers see the pre-splice lists and can reconstruct the
   * removed messages from the normalized coordinates.
   * @param target - pending list to mutate.
   * @param start - splice position.
   * @param deleteCount - maximum number of messages to remove.
   * @param inserted - messages to insert at the resolved position.
   * @returns messages removed by the splice.
   */
  splice(target: InboxTarget, start: number, deleteCount: number, inserted: UserMessage[]): UserMessage[];
  /** Locate one pending identity across both owned lists. */
  private locate;
  /** Commit one normalized mutation and publish its live notifications. */
  private mutate;
  /** Apply one normalized durable splice to the projection. */
  private apply;
  /** Validate one normalized splice against the current projection. */
  private validate;
}
//#endregion
//#region ../../packages/core/agent/lib/types/runtime-types.d.ts
declare module '@deepseek-ai/dsh-system-prompt' {
  interface AssembleContext {
    /** Agent for this assembly; absent on diagnostics. When present, `scope` must identify the same agent. */
    agent?: Agent;
  }
}
/** Merge-extensible agent creation options. Persona belongs to system-prompt sections. */
interface AgentOptions {
  /** Provider route (must have a registered adapter at call time). */
  provider?: string;
  /** Model id interpreted by the selected provider adapter. */
  model?: string;
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number;
}
/** Options for {@link Agent.cancel}. */
interface CancelOptions {
  /**
   * Preserve queued and steering inbox items instead of discarding them. The
   * active turn is still aborted, but un-started and pending work survives for a
   * later turn and no canceled inbox splice is logged.
   */
  keepInbox?: boolean | undefined;
}
/**
 * An agent's lifecycle state, emitted on every transition as `agent/status`:
 * `idle` means no driver is active; `running` begins when waking input starts
 * cancellable pre-step processing and lasts while the driver drains,
 * closes, or checkpoints turns. Disposal removes the agent from its registry;
 * it is not a third observable status.
 */
type AgentStatus = 'idle' | 'running';
/** Whether and with which messages the loop enters a proposed step. */
type PreStepDecision = {
  kind: 'reject';
} | {
  kind: 'enter';
  messages: UserMessage[];
};
/** Action returned by a listener that owns model-request recovery. */
type RequestErrorAction = {
  kind: 'retry';
} | undefined;
/** Why a session lifecycle began; seeded creates are `startup`, while persisted loads are `resume`. */
type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact';
/** Public live-agent handle. */
interface Agent {
  /** The single identity shared with {@link session}. */
  readonly id: SessionId;
  /** The provider route and model this agent's requests use. */
  readonly options: AgentOptions;
  /** The live session this agent drives; its log is the durable source of truth. */
  readonly session: Session;
  /** The agent-owned projection of durable pending work. */
  readonly inbox: Inbox;
  /** The current lifecycle state, mirrored on every `agent/status` transition. */
  readonly status: AgentStatus;
  /** Agent-scoped context; its contributions are agent-local, unwind on disposal, and reject registration afterward. */
  readonly ctx: Context;
  /**
   * Clear queued and steering work — unless `keepInbox` — and abort the active
   * turn or between-turn task. The first cause wins for that activity. With no
   * active activity, cancellation is a no-op and does not arm later work.
   * @param cause - the stable caller intent carried by the active operation signal.
   * @param options - cancellation options; `keepInbox` preserves pending work.
   */
  cancel(cause: AgentCancelCause, options?: CancelOptions): void;
  /**
   * Resolve after the current whole-agent activity reaches quiescence. This
   * follows replacement work started before the observed driver retires,
   * but does not identify the settlement of any particular message.
   * @returns fulfillment after no active driver or maintenance task remains.
   */
  whenIdle(): Promise<void>;
  /**
   * Run one non-turn maintenance task from the true idle phase. The task starts
   * synchronously after claiming that phase; later waking input remains in the
   * inbox until the task settles, while public status stays `idle`.
   * `whenIdle()` follows both the task and any waking work released behind it.
   * @param task - operation whose fulfillment or rejection is preserved, with a signal aborted by {@link cancel}.
   * @throws synchronously when turn-driving or another maintenance task already owns the agent.
   * @returns the task promise.
   */
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /**
   * Route identified input to an inbox boundary and optionally wake the driver.
   * Waking input submitted after active cancellation is queued for the next
   * turn and runs when the aborted activity converges to idle; a `disposed`
   * cancel leaves it parked. A wake submitted while already idle always opens
   * its turn boundary, even when its message is cleared before the driver
   * claims ([cancel-convergence wake latch](../../../../.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.md)).
   * @param message - identified content and the source that supplied it.
   * @param target - the preferred next-turn or next-step inbox boundary.
   * @param wakeup - whether delivery may wake the driver.
   */
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void;
  /**
   * Queue an ordinary follow-up turn and wake the driver. The item becomes the
   * sole ordinary message of its own turn.
   * @param message - identified prompt content and the source that supplied it.
   */
  followup(message: UserMessage): void;
  /**
   * Submit steering for the nearest step. An idle driver starts a turn;
   * a running driver consumes it at its next step boundary.
   * A rejected step leaves steering parked in the inbox until the next
   * wake; cancellation or disposal may discard pending steering.
   * @param message - identified steering content and the source that supplied it.
   */
  steer(message: UserMessage): void;
  /**
   * Queue model-facing context for the next pre-step without waking the
   * driver. A running driver claims it at the nearest later step boundary;
   * idle drivers leave it pending until follow-up or steering
   * wakes them. It may miss a request whose pre-step already claimed its
   * batch. Cancellation or disposal may discard pending context.
   * @param message - identified injected context and the source that supplied it.
   */
  inject(message: UserMessage): void;
}
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A fully configured agent and live session were published. Setup is
     * composition-only; `agent/session-start` is the first startup-driving extension point.
     * Synchronous listener failure vetoes publication, while returned-promise
     * rejection is reported. Detach requested during dispatch waits until every
     * creation listener has observed the stable entry.
     * @param payload.agent - the newly registered agent with its live session and completed setup.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode emit
     */
    'agent/created'(this: Scoped<Agent>, payload: {
      agent: Agent;
    }): void;
    /**
     * An agent left the registry; AgentLoop emits this after driver quiescence
     * and scoped-registration unwind, but before session detachment. Custom
     * registry users own their driver-ordering contract.
     * @param payload.agent - the exact agent removed from the registry.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode emit
     */
    'agent/disposed'(this: Scoped<Agent>, payload: {
      agent: Agent;
    }): void;
    /**
     * Agent status changed (`idle` ⇄ `running`). A waking delivery enters
     * `running` synchronously after reserving cancellation; `idle` means no
     * driver remains scheduled or active.
     * @param payload.agent - the agent whose status flipped.
     * @param payload.status - the status just entered (the transition's destination).
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode emit
     */
    'agent/status'(this: Scoped<Agent>, payload: {
      agent: Agent;
      status: AgentStatus;
    }): void;
    /**
     * One message entered the live inbox.
     * @param payload.agent - the agent whose inbox changed.
     * @param payload.message - the inserted message.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode emit
     */
    'agent/inbox/inserted'(this: Scoped<Agent>, payload: {
      agent: Agent;
      message: UserMessage;
    }): void;
    /**
     * One message left the inbox inside its open turn. If the proposed step
     * is rejected, the claimed message ends here: it is neither discarded nor
     * re-emitted as a user/message, and the turn closes without a step.
     * @param payload.agent - the agent whose inbox changed.
     * @param payload.message - the claimed message.
     * @param payload.turn - the owning turn.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode emit
     */
    'agent/inbox/claimed'(this: Scoped<Agent>, payload: {
      agent: Agent;
      message: UserMessage;
      turn: number;
    }): void;
    /**
     * One message was discarded from the live inbox.
     * @param payload.agent - the agent whose inbox changed.
     * @param payload.message - the discarded message.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode emit
     */
    'agent/inbox/discarded'(this: Scoped<Agent>, payload: {
      agent: Agent;
      message: UserMessage;
    }): void;
    /**
     * The session lifecycle began, once before the first turn. Use
     * `agent.inject()` to seed model-facing context. This is a notification, not
     * a veto; disposal requested by a lifecycle owner is rechecked before the
     * driver starts.
     * @param payload.agent - the agent whose session lifecycle began.
     * @param payload.source - why the session started (fresh startup, resume, …).
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode emit
     */
    'agent/session-start'(this: Scoped<Agent>, payload: {
      agent: Agent;
      source: SessionStartSource;
    }): void;
    /**
     * Reject a proposed step or replace the messages that enter it. Calling
     * `next()` preserves the current messages.
     * @param payload.agent - the agent proposing the step.
     * @param payload.messages - messages removed from the inbox for this step.
     * @param payload.turn - the turn that will own the step.
     * @param payload.step - the step proposed by the loop.
     * @param payload.signal - the current turn's cancellation signal.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode waterfall
     */
    'agent/pre-step'(this: Scoped<Agent>, payload: {
      agent: Agent;
      messages: UserMessage[];
      turn: number;
      step: number;
      signal: AbortSignal;
    }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>;
    /**
     * Replace the frozen call configuration. `await next()` yields the config
     * the machine would use (agent options on the first request, the logged
     * header afterwards); return a replacement to switch. Model-visible
     * content must use logged channels; this waterfall cannot mutate messages.
     * @param payload.agent - the agent making the model call.
     * @param payload.turn - the open turn number.
     * @param payload.step - the step whose request this is.
     * @param payload.signal - the current turn's explicit abort signal.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode waterfall
    */
    'agent/request'(this: Scoped<Agent>, payload: {
      agent: Agent;
      turn: number;
      step: number;
      signal: AbortSignal;
    }, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>;
    /**
     * Handle one failed model-request attempt before the loop retries or closes
     * its step. A listener returns `{ kind: 'retry' }` without calling `next()`
     * when it owns recovery, or calls `next()` to delegate. The default
     * `undefined` leaves the failure terminal.
     * @param payload.agent - the agent whose request failed.
     * @param payload.turn - the turn containing the failed request.
     * @param payload.step - the step containing the failed request attempt.
     * @param payload.provider - the provider selected for the failed request.
     * @param payload.failure - serializable facts normalized at the final adapter boundary.
     * @param payload.retryPolicy - the policy of the adapter registration that served the failed request.
     * @param payload.signal - the turn abort signal.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode waterfall
     */
    'agent/request-error'(this: Scoped<Agent>, payload: {
      agent: Agent;
      turn: number;
      step: number;
      provider: string;
      failure: LlmFailure;
      retryPolicy: ResolvedRetryPolicy | undefined;
      signal: AbortSignal;
    }, next: () => Promise<RequestErrorAction>): Promise<RequestErrorAction>;
    /**
     * The turn is about to close: the model owes no response (no live tool
     * calls, no fresh steering). Awaited before the boundary commits — a
     * listener that objects steers (`agent.steer(...)`) and the machine
     * re-reads its inbox: fresh steering runs another step, none closes the
     * turn. Data decides, so listener order cannot change the outcome. The
     * inverse control (stop a tool loop early) is data too: a tool result
     * carrying `concludesTurn` ends the turn at its step. The conclusion
     * never short-circuits already-submitted next-step work: same-step
     * `additionalContexts` or racing steering still runs, and the turn
     * closes only when that inbox drains.
     * @param payload.agent - the agent whose turn is at its stop boundary.
     * @param payload.turn - the turn about to close.
     * @param payload.signal - the current turn's explicit abort signal.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode serial
     */
    'agent/turn-stopping'(this: Scoped<Agent>, payload: {
      agent: Agent;
      turn: number;
      signal: AbortSignal;
    }): Promise<void> | void;
    /**
     * A step or turn errored. The machine reports a failure here even when
     * the error has no in-turn position for a durable record.
     * @param payload.agent - the agent whose turn errored.
     * @param payload.turn - the turn in which the failure surfaced.
     * @param payload.step - the step at which the failure surfaced.
     * @param payload.error - the failure, verbatim.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode emit
     */
    'agent/error'(this: Scoped<Agent>, payload: {
      agent: Agent;
      turn: number;
      step: number;
      error: unknown;
    }): void;
  }
} //# sourceMappingURL=runtime-types.d.ts.map
//#endregion
//#region ../../packages/core/system-prompt/lib/types/index.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    systemPrompt: SystemPrompt;
  }
  interface Events {
    /**
     * Expert waterfall over the assembled sections, contexts, tools, and variables.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): scoped listeners
     * receive only that scope's assemblies. The returned value is authoritative.
     * A supplied signal controls only this explicit assembly request and must not
     * be retained to control later turns. A registered complete section is
     * restored after this waterfall, so listeners cannot add to or replace
     * that scope's system prompt.
     * @param assembly - the mutable assembly built from registered providers.
     * @param context - the caller's per-assembly context.
     * @mode waterfall
     */
    'system-prompt/assemble'(this: Scoped<SystemPrompt>, assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>): Promise<PromptAssembly>;
    /**
     * Emitted when any prompt provider changes. This registry notification is
     * unfiltered because a global change affects every scope.
     * @mode emit
     */
    'system-prompt/change'(): void;
  }
}
/** Merge-extensible context for one prompt assembly. */
interface AssembleContext {
  /**
   * Scope whose providers and waterfall listeners participate. When absent,
   * only global providers and subject-less listeners participate.
   */
  scope?: ScopeKey;
  /** Explicit control signal for the turn that requested this assembly, when any. */
  signal?: AbortSignal;
}
/** One contributed section of the system prompt (registry input). */
interface PromptSection {
  /** Unique name — a duplicate registration throws (see {@link SystemPrompt.section}). */
  readonly name: string;
  /**
   * Sections are concatenated in ascending order. Convention: `-100` is the
   * harness identity, `0` the deployment persona, tool guidance uses 100–199;
   * other negative orders also render before the persona.
   */
  readonly order: number;
  /**
   * Static text or a provider evaluated at each assembly with that assembly's
   * {@link AssembleContext}. The text may reference `{{variable}}`s — they are
   * interpolated later, by {@link renderPrompt}.
   */
  readonly text: string | ((context: AssembleContext) => string);
  /**
   * Treat this contribution as the complete system prompt. Assembly still
   * runs the cooperative waterfall so tools, contexts, and variables can be
   * resolved, then restores this exact section as the sole prompt section.
   * More than one effective complete section makes assembly fail.
   */
  readonly complete?: boolean;
}
/** Dynamic model context materialized as a durable user-role snapshot. */
interface PromptContext {
  /** Unique name — a duplicate registration throws (see {@link SystemPrompt.context}). */
  readonly name: string;
  /** Contexts are joined in ascending order. */
  readonly order: number;
  /** Static text or a provider evaluated for each assembly. Empty text contributes nothing. */
  readonly text: string | ((context: AssembleContext) => string);
}
/** One section of an assembly: {@link PromptSection} with its text resolved. */
interface AssembledSection {
  /** The contributing section's unique name. */
  name: string;
  /** The resolved (but not yet interpolated) section text. */
  text: string;
}
/** One resolved dynamic context contribution. */
interface AssembledContext {
  /** The contributing context's unique name. */
  name: string;
  /** The resolved text before variable interpolation. */
  text: string;
}
/** Tool schemas visible in one assembly and their pre-restriction name set. */
interface ToolProviderResult {
  /** The schemas this provider contributes to THIS assembly. */
  readonly schemas: readonly ToolSchema[];
  /** The pre-restriction name universe for config validation (defaults to `schemas`' names). */
  readonly knownNames?: readonly string[];
}
/**
 * Merge-extensible assembled model input. Sections and contexts remain
 * uninterpolated until rendered; tools are already in canonical order.
 */
interface PromptAssembly {
  sections: AssembledSection[];
  contexts: AssembledContext[];
  tools: ToolSchema[];
  variables: Record<string, string | undefined>;
}
/** Plugin config: the deployment-authored fragment of the system prompt (see {@link Config.persona} for its contract). */
interface Config$1 {
  /** Include the fixed DeepSeek Harness identity before the deployment persona (default true). */
  includeHarnessIdentity?: boolean;
  /** Include dynamic runtime-context snapshots in model history (default true). */
  includeRuntimeContext?: boolean;
  /**
   * Deployment-wide order-0 persona template. A scoped section named
   * `deployment:persona` shadows it; `{{variable}}` references are strict.
   */
  persona?: string;
  /**
   * Model-facing tool names in order, with {@link TOOL_ORDER_REST} exactly once.
   * Invalid fields fail at load and unknown names fail at assembly; known names
   * hidden in one scope may be absent there. Omitted means lexicographic order.
   */
  toolOrder?: string[];
}
/** Registry service for the prompt inputs assembled before each model step. */
declare class SystemPrompt extends Service {
  static Config: Schema<Config$1>;
  private readonly layers;
  private readonly toolOrder;
  constructor(ctx: Context, config: Config$1);
  /**
   * Register an ordered prompt section in the calling context's scope. A scoped
   * section shadows a global section with the same name; duplicates within one
   * layer and non-finite orders throw. Registration and disposal emit
   * `system-prompt/change`.
   * @param section - the section to register.
   * @returns the exact Cordis effect disposer.
   */
  section(section: PromptSection): () => void;
  /**
   * Register ordered dynamic context in the calling context's scope. Scoped
   * entries shadow global entries with the same name.
   * @param context - the context contribution to register.
   * @returns the exact Cordis effect disposer.
   */
  context(context: PromptContext): () => void;
  /**
   * Suppress every dynamic runtime-context contribution in the calling
   * context's scope without changing the services that own or enforce those
   * facts. Multiple suppressors remain independently disposable.
   * @returns the exact Cordis effect disposer.
   */
  suppressRuntimeContext(): () => void;
  /**
   * Register a tool-schema provider in the calling context's scope. Global and
   * matching scoped providers both contribute; returning the reserved
   * {@link TOOL_ORDER_REST} name makes assembly fail.
   * @param provider - evaluated for each assembly with its context.
   * @returns the exact Cordis effect disposer.
   */
  tools(provider: (context: AssembleContext) => ToolProviderResult): () => void;
  /**
   * Register a prompt variable in the calling context's scope. Scoped values
   * shadow globals; invalid or duplicate names throw. A provider may return
   * `undefined`, but rendering a section that references that value then fails.
   * @param name - the `[a-z][a-z0-9_]*` reference name.
   * @param provider - evaluated for each assembly.
   * @returns the exact Cordis effect disposer.
   */
  variable(name: string, provider: (context: AssembleContext) => string | undefined): () => void;
  /**
   * Assemble global and scoped providers, detach tool parameters, apply
   * canonical ordering, then run the assembly waterfall. Scoped sections and
   * variables shadow globals. The returned waterfall value is authoritative
   * except that an effective complete section is restored afterwards as the
   * sole prompt section.
   * @param context - the optional scope and plugin-defined assembly fields.
   * @returns the post-waterfall assembly with any complete prompt enforced.
   */
  assemble(context?: AssembleContext): Promise<PromptAssembly>;
}
//#endregion
//#region ../../packages/core/agent/lib/types/index.d.ts
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    agent: TypertLookup<Agent, SessionId>;
  }
  interface TypertContextMap {
    agent: TypertContext<SessionId>;
  }
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    agents: AgentRegistry;
    /**
     * The agent association installed as an own property on `Agent.ctx`, or
     * `undefined` on a plain context. Contexts derived from `Agent.ctx` inherit
     * the association; a deliberately nested scope may carry a nearer
     * `dsh-scope` tag while retaining it, so this field is DX context rather
     * than the scope resolver. {@link AgentRegistry} registers a root accessor
     * defaulting to `undefined`, and core packages below the agent layer use
     * `scopeOf()` for layer selection instead of reading this field.
     */
    agent?: Agent;
  }
}
/**
 * Synchronous finalizer returned by unpublished Agent setup when its
 * contributions need validation at the exact publication commit point.
 */
interface AgentSetupCommit {
  /**
   * Validate and commit the prepared setup immediately before publication.
   * @throws when publication must roll the unpublished Agent back.
   */
  commit(): void;
}
/**
 * Compose an unpublished Agent scope and optionally return its publication commit.
 * @param agentCtx - unpublished Agent scope.
 * @returns an optional synchronous commit invoked after setup awaits settle and immediately before publication.
 */
type AgentSetup = (agentCtx: Context) => AgentSetupCommit | Promise<AgentSetupCommit | void> | void;
/**
 * Options for programmatically creating an agent through the registry factory
 * ({@link AgentRegistry.create}). The caller supplies the single live
 * `sessionId` shared by the agent registry and session log (e.g. an
 * ACP-generated id), plus optional session metadata (the validated `cwd`, fork
 * lineage); the factory creates the session and agent under that identity.
 */
interface CreateAgentOptions {
  /** The live agent/session identity. */
  readonly sessionId: SessionId;
  /**
   * Session creation metadata: validated absolute `cwd`, `parentSession`
   * fork lineage, the `seedLength` seed boundary, the coarse `origin`
   * classification, and the `delegationDepth` recursion budget. Mirrors the
   * `cwd`/`parentSession`/`seedLength`/`origin`/`delegationDepth` fields of
   * {@link CreateSessionOptions.meta} in dsh-session (the internal-only
   * `createdAt`, used when reconstructing a persisted session, is deliberately
   * excluded — a factory caller never sets it). This is durable session data,
   * so the session boundary validates and snapshots it before asynchronous
   * setup begins.
   */
  readonly meta?: {
    readonly cwd?: string;
    readonly parentSession?: SessionId;
    readonly seedLength?: number;
    readonly origin?: 'subagent';
    readonly delegationDepth?: number;
    readonly agentPreset?: string;
  };
  /**
   * Initial replay/fork history. A fork supplies a balanced completed-turn
   * prefix of the parent's log. The complete seed must be contiguous from seq
   * 0, carry only lossless-JSON data, and contain no open turn/step or dangling
   * tool call. The factory passes it to the session's durable
   * validator/snapshot boundary before publication.
   */
  readonly seed?: readonly SessionEvent[];
  /** Per-agent options (model, …). */
  readonly agentOptions?: AgentOptions;
  /** Optional creation-only cancellation signal; detached before the returned handle becomes visible. */
  readonly signal?: AbortSignal;
  /**
   * Creation-time composition of the agent's scoped world. The factory awaits
   * setup after minting `agentCtx` but BEFORE inserting or announcing either
   * the session or agent, so observers can never see a partially configured
   * world. Setup may return an {@link AgentSetupCommit}; the factory invokes its
   * synchronous `commit()` after every setup await settles and immediately
   * before registry publication. This lets mutable provisioning revalidate at
   * the exact publication boundary. Everything registered through `agentCtx`
   * (scoped tools, prompt sections/variables, `restrict()`, listeners, awaited
   * child plugins) exists before `session/created`, `agent/created`,
   * `agent/session-start`, and the first prompt assembly. A setup
   * throw/rejection, commit throw, or owner disposal rolls the scope back
   * without publishing either id.
   *
   * **Setup composes, it never drives**: the callback is trusted same-process
   * code and receives the full scoped context, so this is a contract rather
   * than a runtime restriction. Drive the agent only after creation resolves.
   */
  readonly setup?: AgentSetup;
}
/**
 * Options for resuming an agent on a persisted session
 * ({@link AgentRegistry.resume}).
 */
interface ResumeAgentOptions {
  /** The persisted session id to load and use as the live agent/session identity. */
  readonly resumeSessionId: SessionId;
  /** Per-agent options (model, …). */
  readonly agentOptions?: AgentOptions;
  /** Optional creation-only cancellation signal for persistence load/setup; detached before return. */
  readonly signal?: AbortSignal;
  /**
   * Resume-time composition of the agent's fresh scoped world. Persistence is
   * loaded first; the factory then mints `agentCtx` and awaits setup while the
   * reconstructed session and agent remain unpublished. The callback has the
   * same trusted composition-only contract and optional synchronous
   * publication commit as {@link CreateAgentOptions.setup}: all registrations
   * exist before either creation announcement, and rejection, commit failure,
   * or owner disposal rolls the transaction back without publishing either id.
   */
  readonly setup?: AgentSetup;
}
/**
 * An owned agent plus its disposer, returned by {@link AgentRegistry.create} /
 * {@link AgentRegistry.resume}. The disposer is a CAPABILITY: among consumers,
 * only the holder can tear this agent down. The registered factory provider is
 * also a structural owner because the scoped agent depends on that provider's
 * service API; provider unload stops and drains every live handle it made.
 * `dispose()` stops the loop, awaits its exit, unregisters the agent, removes
 * its session from the store, and finally unwinds its scoped world.
 *
 * `ctx.agents.get(id)` still returns a bare {@link Agent} — the handle is
 * exposed only to the consumer owner that created it; the structural provider
 * reaches the same teardown internally. Config-created agents (the loop's own
 * startup) are owned by the loop fiber and never need a handle.
 */
interface AgentHandle {
  agent: Agent;
  dispose(): Promise<void>;
}
/**
 * The agent-creation factory the loop implementation provides to the registry
 * via {@link AgentRegistry.setFactory}. Kept on the `dsh-agent` interface so
 * consumers (e.g. the ACP bridge) program against `ctx.agents` without
 * depending on the concrete `dsh-agent-loop` package.
 */
interface AgentFactory {
  /**
   * Create a new agent on a caller-supplied session id. Async because creation
   * awaits unpublished setup, invokes its optional synchronous commit, inserts
   * both session and agent, emits their creation notifications in order, emits
   * `agent/session-start`, and only then starts the loop. The sequence is
   * rollback-covered, but notifications delivered before a later listener
   * failure remain observable; every agent or session creation announcement
   * that began is paired by `agent/disposed` or `session/disposed` during
   * rollback. The owner disposes the resolved handle to stop/drain,
   * unregister, remove the session, and unwind the scope.
   * The registry passes a context carrying the `create()` caller's fiber and
   * scope as `ownerCtx`. The implementation attaches the unpublished
   * transaction and resulting lifecycle to that owner; it must not infer
   * ownership from the factory object's registration context.
   * @param ownerCtx - caller-bound context that owns the transaction and live handle.
   * @param options - agent/session identity, configuration, and optional setup.
   * @returns the owned handle after setup, both announcements, and loop start complete.
   */
  createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>;
  /**
   * Prepare a persisted session and resume an agent on it. Async because it awaits
   * both `ctx.sessionPersistence.prepare` and the optional unpublished setup
   * transaction; must be called after that service exists (consumers inject
   * `sessionPersistence`). Publication follows the same setup-commit and
   * ordered boundary as {@link createAgent}.
   * @param ownerCtx - caller-bound context that owns load, setup, and the live handle.
   * @param options - persisted identity, configuration, and optional setup.
   * @returns the owned handle after setup, both announcements, and loop start complete.
   */
  resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>;
}
/**
 * Agent service (`ctx.agents`): tracks live agents and carries the initiating
 * Agent through one process-local asynchronous driver chain. Agent *creation*
 * is provided by whichever plugin implements the {@link AgentFactory}
 * (`@deepseek-ai/dsh-agent-loop`), registered via {@link setFactory}.
 *
 * Initiator methods provide same-process causal attribution only. Ambient
 * presence is neither liveness proof nor authorization; subjects and owners
 * remain explicit, as does identity at worker, process, persistence, and wire
 * boundaries. Returned Promise boundaries drain during teardown, except a
 * nested lineage that starts an owning-fiber unload is excluded from its own drain.
 */
declare class AgentRegistry extends Service {
  private store;
  private factory;
  private readonly initiators;
  private readonly initiatorRuns;
  private initiatorState;
  private activeInitiatorRuns;
  private initiatorDrain;
  private initiatorDisposal;
  constructor(ctx: Context);
  /**
   * Read the Agent that initiated the inherited asynchronous driver chain.
   * Use this optional form for logging, tracing, metrics, or host attribution
   * that also supports agentless calls. When a parent creates a child, setup
   * reports the causal parent while `agentCtx.agent` identifies the child.
   * @returns the inherited Agent, or `undefined` outside an initiator boundary
   *   and inside an explicit clearing boundary.
   * @throws when this service instance has been disposed.
   */
  currentInitiator(): Agent | undefined;
  /**
   * Read the initiating Agent and fail when no initiator boundary is active.
   * Use this for private helpers contractually below a driver, or for a
   * deployment-owned outbound request whose contract forbids agentless calls.
   * Generic or direct-call paths use optional lookup or explicit request fields.
   * @returns the inherited Agent.
   * @throws when no initiator is active or this service instance has been disposed.
   */
  requireInitiator(): Agent;
  /**
   * Run an operation with one exact Agent as its process-local initiator. The
   * exact synchronous value or Promise returned by the operation is preserved.
   * Custom drivers and test harnesses wrap their complete returned foreground
   * lifetime.
   * A queue or wire receiver may establish this boundary only after validating
   * explicit identity and resolving the exact live Agent; this method does neither.
   * Detached work remains owned by the subsystem that starts it.
   * @param agent - initiating Agent to inherit; presence is neither liveness proof nor authorization.
   * @param operation - synchronous or asynchronous operation to invoke.
   * @returns the exact value returned by `operation`.
   * @throws when the initiator scope is closing/disposed, or when `operation` throws.
   */
  withInitiator<T>(agent: Agent, operation: () => T): T;
  /**
   * Run an operation inside a boundary that hides any inherited initiating
   * Agent. The exact synchronous value or Promise is preserved.
   * Use this while creating lazy shared timers, queue pumps, pool maintenance,
   * watchers, or exporters so they do not inherit the first Agent that happens
   * to initialize them. It clears only initiator attribution, not explicit
   * fields, and does not own or drain detached resources.
   * @param operation - synchronous or asynchronous operation to invoke without an initiator.
   * @returns the exact value returned by `operation`.
   * @throws when the initiator scope is closing/disposed, or when `operation` throws.
   */
  withoutInitiator<T>(operation: () => T): T;
  /**
   * Register the agent-creation factory (the loop calls this on construction,
   * effect-scoped). A traced Cordis service is canonicalized to its concrete
   * target; each create/resume call is then traced through that caller's
   * context so ownership follows the caller without stacking proxy layers.
   * Throws if a factory is already registered. Returns the disposer; on
   * dispose the factory slot is cleared.
   * @param factory - the loop-owned factory {@link create}/{@link resume} delegate to.
   * @returns the disposer that clears the factory slot. The exact
   *   Cordis effect disposer (single-shot): composite (generator) effects may
   *   yield it directly — exact identity nests the teardown in order.
   */
  setFactory(factory: AgentFactory): () => void;
  /** Return the active creation factory. */
  private requireFactory;
  /**
   * Create and publish a new agent through the registered factory.
   * Distinct from {@link register} (which records an already-constructed
   * agent): this constructs the agent and its session. Rejects if no factory is
   * registered or creation/setup fails. The resolved {@link AgentHandle} lets
   * the owner tear down exactly this agent.
   * @param options - shared identity, session seed/metadata, and agent options.
   * @returns the handle after setup, rollback-covered publication, and loop start complete.
   */
  create(options: CreateAgentOptions): Promise<AgentHandle>;
  /**
   * Load a persisted session and resume an agent on it through the registered
   * factory. Rejects if no factory is registered; the factory rejects if
   * session persistence is not configured or persistence/setup fails.
   * @param options - persisted identity, configuration, and optional setup.
   * @returns the handle after setup, rollback-covered publication, and loop start complete.
   */
  resume(options: ResumeAgentOptions): Promise<AgentHandle>;
  /**
   * Register a live agent. Throws if an agent with the same id is already
   * registered. Emits `agent/created` on registration and `agent/disposed`
   * when the calling fiber is disposed — both with the agent's scope carrier
   * (`scopeTarget(agent, agent)`): the subject is the agent in hand, so the
   * emits are scope-filtered regardless of which context invoked `register`
   * (calling through `agent.ctx` scopes EFFECTS; dispatch scoping always
   * requires passing the carrier). Returns the disposer.
   * @param agent - the already-constructed agent to record in the store.
   * @returns the EXACT Cordis effect disposer (single-shot; a repeat call
   *   returns undefined without awaiting an in-flight teardown). Exact
   *   identity is load-bearing: a composite (generator) effect that owns a
   *   teardown ORDER — the agent factory's lifecycle chain — must yield THIS
   *   function so Cordis nests the unregistration at that yield position;
   *   yielding a wrapper would leave it disposing as a concurrent sibling on
   *   owner unload, unregistering the agent (and emitting `agent/disposed`)
   *   while its final turn is still draining.
   */
  register(agent: Agent): () => void;
  /**
   * Insert an already-constructed agent without announcing it. This is the
   * advanced ordered-lifecycle primitive used by the async agent factory: it
   * first completes setup while the agent is unpublished, then assigns the
   * returned detach closure into its pre-installed composite teardown before
   * calling {@link announce}. Ordinary callers use {@link register}.
   * @param agent - the prepared, unpublished agent.
   * @param owner - live agent whose scoped context created this agent, or
   *   undefined for a top-level runtime root. This is runtime ownership, not
   *   the resumed session's durable parent lineage.
   * @returns an idempotent closure that removes this exact entry and emits
   *   `agent/disposed` with listener failures contained. When called from a
   *   synchronous `agent/created` listener, removal and disposal wait until
   *   that creation dispatch unwinds.
   */
  enter(agent: Agent, owner: Agent | undefined): () => void;
  /** Remove one exact entered agent and emit its paired disposal when announced. */
  private detachEntered;
  /** Emit the paired disposal edge through the entry's stable carrier. */
  private emitDisposed;
  /**
   * Announce an agent previously inserted with {@link enter}.
   * @param agent - the live inserted agent to announce.
   * @throws if `agent` is not the exact live registry entry for its id, or its
   *   creation announcement already began (including a reentrant call from a
   *   creation listener).
   */
  announce(agent: Agent): void;
  /**
   * Look up a live agent.
   * @param id - the shared agent/session id to look up.
   * @returns the agent, or undefined when no live agent has that id.
   */
  get(id: SessionId): Agent | undefined;
  /**
   * Test whether a live agent was created through one exact parent agent's
   * scoped context. Runtime ownership is independent of durable session
   * lineage and remains unambiguous when unrelated providers reuse an id.
   * @param id - the candidate child agent's shared agent/session id.
   * @param owner - the expected runtime creator agent.
   * @returns true only while the exact child entry is live under that owner.
   */
  isOwnedBy(id: SessionId, owner: Agent): boolean;
  /**
   * All live agents, in registration order.
   * @returns a fresh array; mutating it does not affect the registry.
   */
  list(): Agent[];
  /**
   * All live top-level agents in registration order. A top-level agent was
   * created without an owning agent context; durable session lineage does not
   * affect this runtime relation, so a resumed fork may still be a root.
   * @returns a fresh array; mutating it does not affect the registry.
   */
  roots(): Agent[];
  /** Reject new initiator boundaries while inherited continuations drain. */
  private closeInitiators;
  /** Wait for returned-Promise boundaries, then invalidate retained references. */
  private disposeInitiators;
  /** Establish one tracked initiator or clearing boundary. */
  private runWithInitiator;
  /** Whether one unloading fiber owns this service's lifecycle. */
  private hasLifecycleAncestor;
  private assertInitiatorsReadable;
  /** Exclude the boundary chain that initiated this teardown from its own drain. */
  private releaseReentrantInitiatorRuns;
  private releaseInitiatorRun;
}
//#endregion
//#region src/runtime.d.ts
/** Model selection for one spawned role. */
interface RoleModel {
  readonly provider?: string;
  readonly model?: string;
}
/** Selectable answer option for one HITL question. */
interface HitlOption {
  readonly label: string;
  readonly description?: string;
}
/** How one `swarm_ask_user` wait settled. */
interface HitlAskResult {
  readonly requestId: string;
  readonly outcome: 'answered' | 'cancelled';
  /** The operator's answer text, when `answered`. */
  readonly answer?: string;
}
/** Deployment-wide group chat defaults; `swarm_start_chat` args override per swarm. */
interface ChatDefaults {
  /** Speaker selection strategy. Defaults to `round_robin`. */
  readonly speakerSelection: SpeakerSelection;
  /** How many recent group messages each turn prompt carries. */
  readonly transcriptWindow: number;
  /** Default stop conditions. */
  readonly maxTurns?: number;
  readonly maxRounds?: number;
  readonly terminationMessage?: string;
}
/** Deployment memory view bounds. */
interface MemoryDefaults {
  /** Fold view cap: only the latest N entries are visible to queries (the log itself is never truncated). */
  readonly maxEntries: number;
  /** Default `swarm_memory_query` result limit. */
  readonly queryLimit: number;
}
/** Deployment config that shapes runtime behavior. */
interface SwarmRuntimeConfig {
  /** The `ctx.subagents` provider used to spawn children. */
  readonly provider: string;
  /** Default child model when a role does not specify one. */
  readonly defaultModel?: RoleModel;
  /** When the swarm may pause for operator input. */
  readonly humanInputMode: HumanInputMode;
  /** Group chat engine defaults. */
  readonly chat: ChatDefaults;
  /** Memory view bounds. */
  readonly memory: MemoryDefaults;
}
/** One process-local, disposable Swarm runtime attached to one orchestrator root agent. */
declare class SwarmRuntime {
  private readonly ctx;
  private readonly agent;
  readonly swarmId: SwarmId;
  readonly config: SwarmRuntimeConfig;
  /** role name → durable child session id. */
  private readonly children;
  /** Live HITL waits, request id → cancellation. A pending wait is swarm-level: role interrupts do not touch it, terminate/dispose cancel it. */
  private readonly pendingHitl;
  private topology;
  private terminated;
  /** Structural state (roles, topology, termination) changed since the last checkpoint. */
  private structuralDirty;
  /** Messages were routed since the last checkpoint. */
  private messagesDirty;
  constructor(ctx: Context, agent: Agent, swarmId: SwarmId, config: SwarmRuntimeConfig);
  /** Current topology mode. */
  get currentTopology(): TopologyMode;
  /** Whether this swarm has been terminated. */
  get isTerminated(): boolean;
  /**
   * Restore this runtime's in-memory state from a folded event log. Used only
   * by cold resume, immediately after construction, before any tool runs.
   * @param state - the fold of this swarm's durable events.
   */
  hydrate(state: SwarmState): void;
  /**
   * Whether a checkpoint is due at the next idle boundary under `frequency`.
   * `auto` snapshots structural changes only; `per_turn` also snapshots
   * message-only progress. `manual` never snapshots automatically.
   * @param frequency - the configured checkpoint frequency.
   */
  needsCheckpoint(frequency: CheckpointFrequency): boolean;
  /**
   * Append a `swarm/checkpoint` snapshot of the current folded state and clear
   * the dirty flags. Checkpoints are markers over the log: resume re-folds the
   * complete log and names the latest checkpoint as its recovery point.
   * @param reason - why this checkpoint is saved.
   * @returns the checkpoint's save instant.
   */
  saveCheckpoint(reason: CheckpointReason): string;
  /** Set the topology mode and append a session event. */
  setTopology(mode: TopologyMode): void;
  /**
   * Spawn a durable continuable child agent for the given role.
   * @param roleName - stable role name.
   * @param systemPrompt - optional role definition delivered as the child's initial prompt.
   * @param model - optional provider/model override for this child.
   * @param signal - caller cancellation owning the spawn until inbox acceptance.
   * @returns the durable child session id.
   */
  spawnRole(roleName: string, systemPrompt: string | undefined, model: RoleModel | undefined, signal: AbortSignal): Promise<SessionId$2>;
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
  sendMessage(from: string, to: string, content: string, attribution: 'orchestrator' | 'peer' | undefined, signal: AbortSignal): Promise<void>;
  /**
   * Deliver text to one role WITHOUT appending a `swarm/role-message` event.
   * Cold resume uses this for recovery framing and history replay: both are
   * re-derivable from the durable log, so logging them again would duplicate
   * on every restart. Attribution is always the orchestrator.
   * @param to - target role name.
   * @param text - the recovery framing or replayed message text.
   * @param signal - caller cancellation owning the delivery until inbox acceptance.
   */
  deliverUnlogged(to: string, text: string, signal: AbortSignal): Promise<void>;
  /**
   * Resolve which session id the recipient perceives as the sender.
   * - `peer` attribution (or `peer` topology): the sending role itself.
   * - otherwise (`parent-child` topology, or explicit `orchestrator`): the orchestrator.
   */
  private resolveSenderSessionId;
  /** Interrupt one or all roles (fire-and-return). */
  interrupt(roleName: string | undefined): void;
  /** Mark a role as settled without removing its durable child mapping. */
  markRoleSettled(roleName: string, outcome: 'settled' | 'error'): void;
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
  askUser(question: string, header: string | undefined, options: readonly HitlOption[] | undefined, signal: AbortSignal): Promise<HitlAskResult>;
  /** The next HITL request id: `hitl-<n>` counting this swarm's prior requests, so ids survive cold resume without collision. */
  private nextHitlRequestId;
  /**
   * Start the group chat engine for this swarm. Throws when a chat is already
   * active — end or terminate it first.
   * @param config - the effective chat configuration (tool args over deployment defaults).
   */
  startChat(config: {
    topic: string;
    speakerSelection: SpeakerSelection;
    maxTurns?: number;
    maxRounds?: number;
    terminationMessage?: string;
  }): void;
  /** Stop the group chat engine (idempotent). */
  endChat(reason: string): void;
  /** Write one context variable; `by` attributes the writer (`orchestrator`, `human`, or a role). */
  setContext(key: string, value: string, by: string): void;
  /**
   * Log one engine turn: the speaker's reply addressed to the whole group.
   * Group messages are log facts — every role observes the transcript through
   * the next turn prompt, so no per-role delivery happens here.
   */
  recordGroupMessage(speaker: string, content: string): void;
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
  runTurn(roleName: string, prompt: string, signal: AbortSignal): Promise<string>;
  /** Await the child's settled assistant reply to the user message `messageId`. */
  private awaitChildReply;
  /** Cancel every live HITL wait; the awaiting `askUser` calls log the cancellations. */
  private cancelPendingHitl;
  /** Terminate the swarm: cancel pending HITL waits, interrupt every child, and append `swarm/destroyed`. */
  terminate(reason: string): void;
  /** Build the current folded state from the session event log. */
  state(): SwarmState;
  /**
   * Write one memory entry and append its `swarm/memory-written` event. The id
   * counts this swarm's prior writes in the durable log, so a cold resume
   * never collides with a pre-restart entry.
   * @param text - the fact to remember.
   * @param by - writer attribution (`orchestrator`, `human`, or a role name).
   * @param tags - retrieval tags, when any.
   * @returns the written entry's id (`mem-<n>`).
   */
  writeMemory(text: string, by: string, tags?: readonly string[]): string;
  /**
   * Dispose: cancel pending HITL waits and interrupt all children (idempotent).
   * Writes no new durable events itself; a cancelled `askUser` still logs its
   * own `swarm/hitl-resolved` when the owning session is still writable.
   */
  dispose(): void;
}
//#endregion
//#region src/tools.d.ts
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
declare function registerSwarmTools(rootCtx: Context, toolCtx: Context, agent: Agent, runtimes: Map<string, SwarmRuntime>, config: SwarmRuntimeConfig): () => void;
//#endregion
//#region src/resume.d.ts
/**
 * Synchronously rebuild every swarm runtime recorded in the agent's session
 * log. Runs inside the `agent/created` listener, before any tool can execute.
 * @param rootCtx - global service context owning `ctx.subagents`.
 * @param agent - the exact live orchestrator whose session is folded.
 * @param runtimes - the per-agent swarm registry to populate.
 * @param config - deployment config (provider, default model).
 * @returns ids of non-terminated swarms that still have running roles and
 *   therefore need child re-establishment.
 */
declare function hydrateSwarmRuntimes(rootCtx: Context, agent: Agent, runtimes: Map<string, SwarmRuntime>, config: SwarmRuntimeConfig): SwarmId[];
/**
 * Re-establish every running role of one hydrated swarm and append the
 * `swarm/resumed` fact. A swarm terminated meanwhile is left alone.
 * @param runtime - the hydrated runtime to reactivate.
 * @param agent - the exact live orchestrator.
 * @param signal - cancellation owning the whole reactivation (aborted on disposal).
 */
declare function reactivateSwarmRoles(runtime: SwarmRuntime, agent: Agent, signal: AbortSignal): Promise<void>;
//#endregion
//#region src/engine.d.ts
/** Engine failure with a tool-facing error code. */
declare class EngineError extends Error {
  readonly code: 'invalid_argument' | 'unavailable';
  constructor(message: string, code: 'invalid_argument' | 'unavailable');
}
/** `swarm_next_turn` arguments after tool-schema parsing. */
interface NextTurnOptions {
  /** The orchestrator's speaker decision; required under `auto`. */
  readonly speaker?: string;
  /** How many turns to advance; defaults to 1. */
  readonly turns?: number;
}
/** What one `swarm_next_turn` call did. */
interface ChatRunOutcome {
  readonly turns: readonly SwarmTurnRecord[];
  readonly ended: boolean;
  readonly endReason?: string;
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
declare function runChatTurns(runtime: SwarmRuntime, options: NextTurnOptions, signal: AbortSignal): Promise<ChatRunOutcome>;
//#endregion
//#region src/memory.d.ts
/**
 * Split text into lowercase word terms (Unicode letters/digits).
 * @param text - query or memory text.
 * @returns distinct terms in first-appearance order.
 */
declare function tokenize(text: string): string[];
/**
 * Score one entry against a query: one point per query term present in the
 * entry text, {@link TAG_WEIGHT} points per term exactly matching a tag.
 * @param entry - the memory entry.
 * @param queryTerms - distinct lowercase query terms ({@link tokenize} output).
 * @returns the relevance score; 0 means unrelated.
 */
declare function scoreMemory(entry: SwarmMemoryEntry, queryTerms: readonly string[]): number;
/**
 * Rank entries against a query: positive scores only, highest first; ties
 * resolve to the LATER write (recency wins because the input is in write
 * order and the comparator prefers the bigger index).
 * @param entries - memory entries in write order (the fold view).
 * @param query - free-text query.
 * @param limit - maximum hits (positive integer).
 * @returns scored hits, best first.
 */
declare function queryMemories(entries: readonly SwarmMemoryEntry[], query: string, limit: number): SwarmMemoryHit[];
//#endregion
//#region src/domain.d.ts
/**
 * Fold every `swarm/*` session event into the current {@link SwarmState}.
 *
 * @param swarmId     - identity of the swarm (events for other swarms are ignored).
 * @param events      - the orchestrator session's full event log (`session.events`).
 * @param liveTopology - the runtime's in-memory topology (persisted events take precedence).
 * @param memoryLimit - view cap for `memories` (latest N entries); omitted means unbounded.
 *   A VIEW crop, not log truncation: the log only grows, so the fold stays
 *   deterministic and replayable.
 * @returns the reconstructed swarm state.
 */
declare function foldSwarmEvents(swarmId: SwarmId, events: readonly SessionEvent[], liveTopology: TopologyMode, memoryLimit?: number): SwarmState;
/**
 * Collect every swarm id ever created in one session log, in creation order.
 * @param events - the orchestrator session's full event log (`session.events`).
 * @returns distinct swarm ids from `swarm/created` events.
 */
declare function collectSwarmIds(events: readonly SessionEvent[]): SwarmId[];
/**
 * Find the `savedAt` of the latest checkpoint for one swarm.
 * @param swarmId - identity of the swarm.
 * @param events - the orchestrator session's full event log.
 * @returns the latest checkpoint's save instant, or `undefined` when none exists.
 */
declare function latestCheckpointAt(swarmId: SwarmId, events: readonly SessionEvent[]): string | undefined;
/**
 * List the messages routed TO one role, in log order. Cold resume replays
 * exactly this sequence into a re-spawned child.
 * @param swarmId - identity of the swarm.
 * @param events - the orchestrator session's full event log.
 * @param roleName - the recipient role.
 * @returns inbound routed messages in their original order.
 */
declare function inboundMessages(swarmId: SwarmId, events: readonly SessionEvent[], roleName: string): ReadonlyArray<{
  readonly from: string;
  readonly content: string;
}>;
/** Returns true when a roleName is valid (non-empty, no surrounding whitespace). */
declare function isValidRoleName(roleName: string): boolean;
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
declare function selectNextSpeaker(speakers: readonly string[], lastSpeaker: string | undefined, mode: 'round_robin' | 'random', random?: () => number): string | undefined;
/**
 * Completed rounds: one round is every active role speaking once. Derived as
 * `floor(turnCount / activeRoles)` — exact for `round_robin`, a documented
 * approximation once roles exit mid-chat or selection is non-cyclic.
 * @param turnCount - engine turns taken so far.
 * @param activeRoles - roles currently running.
 * @returns the number of completed rounds.
 */
declare function completedRounds(turnCount: number, activeRoles: number): number;
//#endregion
//#region src/panel-model.d.ts
/** One role row as the panel renders it (unbranded wire form of `RoleState`). */
interface SwarmPanelRole {
  readonly roleName: string;
  /** Durable child session id; changes when a cold resume re-spawns the role. */
  readonly childId: string;
  readonly status: 'running' | 'exited';
  readonly outcome?: 'settled' | 'interrupted' | 'error';
  readonly model?: {
    readonly provider: string;
    readonly model: string;
  };
}
/** One unanswered HITL request as the panel renders it. */
interface SwarmPanelHitl {
  readonly requestId: string;
  readonly question: string;
  readonly requestedAt: string;
}
/** One routed group message in log order (the chat transcript). */
interface SwarmPanelMessage {
  readonly from: string;
  readonly to: string;
  readonly content: string;
  readonly sentAt: string;
}
/** One routed message for the Conversation Flow view. */
interface SwarmPanelFlowMessage {
  /** Session event sequence, used as the stable client key. */
  readonly seq: number;
  /** Perceived sender: a role name, `orchestrator`, or `human`. */
  readonly from: string;
  /** Perceived recipient role name, or `group`. */
  readonly to: string;
  /** Durable session id the recipient attributed the message to. */
  readonly senderSessionId: string;
  readonly content: string;
  /** RFC 3339 UTC instant the message was routed. */
  readonly sentAt: string;
  /**
   * Effective sender attribution for this message: `peer` when
   * `senderSessionId` matches a known role child session, otherwise
   * `orchestrator`. Independent of the swarm's global topology mode.
   */
  readonly attribution: 'orchestrator' | 'peer';
}
/** Group chat engine state as the panel renders it. */
interface SwarmPanelChat {
  readonly topic: string;
  readonly speakerSelection: string;
  readonly maxTurns?: number;
  readonly maxRounds?: number;
  readonly terminationMessage?: string;
  /** False after `swarm/chat-ended`. */
  readonly active: boolean;
  readonly startedAt: string;
  /** `swarm/chat-ended` reason, once the engine stopped. */
  readonly endReason?: string;
}
/** One swarm's full panel state: topology, roster, timeline, HITL, checkpoint. */
interface SwarmPanelSwarm {
  readonly swarmId: string;
  readonly createdAt?: string;
  readonly topologyMode: TopologyMode;
  readonly terminated: boolean;
  /** `swarm/destroyed` reason, once terminated. */
  readonly destroyReason?: string;
  /** Number of `swarm/role-message` events routed so far. */
  readonly messageCount: number;
  /** Perceived sender of the most recent routed message, when any. */
  readonly lastSpeaker?: string;
  /** Roles in spawn order. */
  readonly roles: readonly SwarmPanelRole[];
  /** HITL requests with no matching `swarm/hitl-resolved`. */
  readonly pendingHitl: readonly SwarmPanelHitl[];
  /** Swarm-level context variables (last write wins per key). */
  readonly context: Readonly<Record<string, string>>;
  /** Messages routed to `group`, in log order. */
  readonly transcript: readonly SwarmPanelMessage[];
  /** All routed messages, including role-to-role and group messages. */
  readonly flow: readonly SwarmPanelFlowMessage[];
  /** Engine state, present once `swarm/chat-started` was logged. */
  readonly chat?: SwarmPanelChat;
  /** `savedAt` of the latest `swarm/checkpoint`, when any. */
  readonly latestCheckpointAt?: string;
  /** `resumedAt` of the latest `swarm/resumed`, when any. */
  readonly lastResumedAt?: string;
}
/**
 * The `swarm` projection value: every swarm of one session keyed by swarm id,
 * or `null` before the first `swarm/*` event (capability unused — clients
 * render nothing).
 */
type SwarmPanelModel = Record<string, SwarmPanelSwarm> | null;
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Panel model for every swarm orchestrated in the session: roster,
     * topology, Conversation Flow messages, group timeline, pending HITL, and
     * checkpoint markers, folded incrementally from `swarm/*` events.
     */
    swarm: SwarmPanelModel;
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
declare function applySwarmPanelEvent(state: SwarmPanelModel, event: SessionEvent$1): SwarmPanelModel;
//#endregion
//#region src/index.d.ts
/** Function plugin name. */
declare const name = "dsh-swarm-panel";
/**
 * Required services.
 * - `agents`: to observe `agent/created` and identify root agents.
 * - `tools`: to register Orchestrator tools per-agent.
 * - `subagents`: to spawn continuable children and route messages.
 * - `userQuestions`: to ask the operator from `swarm_ask_user`.
 */
declare const inject: readonly ["agents", "tools", "subagents", "userQuestions"];
/** Checkpoint cadence for one deployment. */
interface CheckpointConfig {
  /**
   * How often `swarm/checkpoint` snapshots are written. `auto` (default)
   * snapshots structural changes at idle boundaries, `per_turn` also snapshots
   * message-only progress after every turn, and `manual` snapshots only when
   * the orchestrator calls `swarm_checkpoint`.
   */
  readonly frequency?: CheckpointFrequency;
}
/** Deployment-wide group chat defaults (cordis.yml `chat:` row). */
interface ChatConfig {
  /** Speaker selection strategy. Defaults to `round_robin`. */
  readonly speakerSelection?: SpeakerSelection;
  /** Stop after this many turns (positive integer). */
  readonly maxTurns?: number;
  /** Stop after this many rounds (positive integer). */
  readonly maxRounds?: number;
  /** Stop when a reply contains this substring. */
  readonly terminationMessage?: string;
  /** Recent group messages carried in each turn prompt (positive integer, default 10). */
  readonly transcriptWindow?: number;
}
/** Deployment-wide memory bounds (cordis.yml `memory:` row). */
interface MemoryConfig {
  /** Fold view cap: only the latest N entries are visible to queries. Defaults to 200. */
  readonly maxEntries?: number;
  /** Default `swarm_memory_query` result limit. Defaults to 5. */
  readonly queryLimit?: number;
}
/**
 * Swarm plugin configuration (deployment choices, changeable from cordis.yml).
 */
interface Config {
  /** The `ctx.subagents` provider used to spawn children. Defaults to `spawn`. */
  provider?: string;
  /** Default child model when a role does not specify one. */
  defaultModel?: {
    readonly provider?: string;
    readonly model?: string;
  };
  /** Checkpoint cadence. Defaults to `{ frequency: 'auto' }`. */
  checkpoint?: CheckpointConfig;
  /** When the swarm may pause for operator input. Defaults to `TERMINATE`. */
  humanInputMode?: HumanInputMode;
  /** Group chat engine defaults; `swarm_start_chat` args override per swarm. */
  chat?: ChatConfig;
  /** Memory view bounds. Defaults to `{ maxEntries: 200, queryLimit: 5 }`. */
  memory?: MemoryConfig;
}
/**
 * Install Swarm only for root agents published after this plugin loads.
 * @param ctx - global service context.
 * @param config - deployment config (provider, default model).
 */
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { ChatConfig, type ChatDefaults, type ChatEndedData, type ChatRunOutcome, type ChatStartedData, type ChatState, CheckpointConfig, type CheckpointFrequency, type CheckpointReason, type CheckpointRoleSnapshot, Config, type ContextUpdatedData, EngineError, type HitlAskResult, type HitlOption, type HitlRequestedData, type HitlResolvedData, type HumanInputMode, MemoryConfig, type MemoryDefaults, type MemoryWrittenData, type NextTurnOptions, type PendingHitl, type RoleExitedData, type RoleMessageData, type RoleModel, type RoleResumeRecord, type RoleSpawnedData, type RoleState, type SpeakerSelection, type SwarmAskUserValue, type SwarmCheckpointData, type SwarmCheckpointValue, type SwarmCreatedData, type SwarmDestroyedData, type SwarmGetContextValue, SwarmId, type SwarmListValue, type SwarmMemoryEntry, type SwarmMemoryHit, type SwarmMemoryQueryValue, type SwarmMemoryWriteValue, type SwarmNextTurnValue, type SwarmOkValue, type SwarmPanelChat, type SwarmPanelFlowMessage, type SwarmPanelHitl, type SwarmPanelMessage, type SwarmPanelModel, type SwarmPanelRole, type SwarmPanelSwarm, type SwarmResumedData, SwarmRuntime, type SwarmRuntimeConfig, type SwarmSendValue, type SwarmSetContextValue, type SwarmSpawnValue, type SwarmStartChatValue, type SwarmState, type SwarmTurnRecord, type TopologyChangedData, type TopologyMode, apply, applySwarmPanelEvent, collectSwarmIds, completedRounds, foldSwarmEvents, hydrateSwarmRuntimes, inboundMessages, inject, isValidRoleName, latestCheckpointAt, name, queryMemories, reactivateSwarmRoles, registerSwarmTools, runChatTurns, scoreMemory, selectNextSpeaker, tokenize };
//# sourceMappingURL=index.d.ts.map