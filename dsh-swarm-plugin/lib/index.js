import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
import { z } from "zod";
import { SubagentError } from "@deepseek-ai/dsh-subagent";
import { queueHostSubagentPrompt } from "@deepseek-ai/dsh-subagent/internal";
import { defineTool } from "@deepseek-ai/dsh-tools";
/** Topology a swarm shows before its first `swarm/topology-changed` (the type default). */
const DEFAULT_TOPOLOGY = "parent-child";
/** Panel state of a swarm whose structural events have not arrived yet. */
function emptySwarm(swarmId) {
	return {
		swarmId,
		topologyMode: DEFAULT_TOPOLOGY,
		terminated: false,
		messageCount: 0,
		roles: [],
		pendingHitl: [],
		context: {},
		transcript: [],
		flow: []
	};
}
/** Wire-safe string: durable payloads may omit a field the panel still renders. */
function asString(value) {
	return typeof value === "string" ? value : "";
}
/** Resolve the effective sender attribution from the durable session id. */
function messageAttribution(roles, senderSessionId) {
	if (senderSessionId.length === 0) return "orchestrator";
	return roles.some((role) => role.childId === senderSessionId) ? "peer" : "orchestrator";
}
/**
* Upgrade historical orchestrator attributions after a later role spawn, but
* never downgrade a recorded peer message (resume replaces live child ids).
* @param flow - the swarm's current flow messages.
* @param roles - the roster after the structural event.
* @returns the same array reference when no attribution changes.
*/
function recomputeFlowAttribution(flow, roles) {
	let changed = false;
	const next = flow.map((message) => {
		if (message.attribution === "peer") return message;
		const attribution = messageAttribution(roles, message.senderSessionId);
		if (attribution === message.attribution) return message;
		changed = true;
		return {
			...message,
			attribution
		};
	});
	return changed ? next : flow;
}
/** Append one entry to a windowed list, dropping the oldest past the window. */
function appendWindow(entries, entry) {
	const next = [...entries, entry];
	return next.length <= 200 ? next : next.slice(-200);
}
/** Append one flow message, dropping the oldest when the window is full. */
function appendFlow(flow, message) {
	const next = [...flow, message];
	return next.length <= 200 ? next : next.slice(-200);
}
/** Add or replace one role row, preserving spawn order. */
function upsertRole(roles, role) {
	const index = roles.findIndex((existing) => existing.roleName === role.roleName);
	if (index < 0) return [...roles, role];
	const next = [...roles];
	next[index] = role;
	return next;
}
/**
* Reduce one swarm entry over one `swarm/*` event. Returns the same reference
* when the event changes nothing the panel shows.
* @param swarm - the swarm's current panel state.
* @param event - the committed session event (already known to carry this swarm's id).
* @returns the next panel state for the swarm.
*/
function reduceSwarm(swarm, event) {
	switch (event.type) {
		case "swarm/created": {
			const data = event.data;
			return swarm.createdAt === data.createdAt ? swarm : {
				...swarm,
				createdAt: data.createdAt
			};
		}
		case "swarm/topology-changed": {
			const data = event.data;
			return {
				...swarm,
				topologyMode: data.mode
			};
		}
		case "swarm/role-spawned": {
			const data = event.data;
			const roles = upsertRole(swarm.roles, {
				roleName: data.roleName,
				childId: data.childId,
				status: "running",
				...data.model !== void 0 ? { model: data.model } : {}
			});
			return {
				...swarm,
				roles,
				flow: recomputeFlowAttribution(swarm.flow, roles)
			};
		}
		case "swarm/role-message": {
			const data = event.data;
			const from = asString(data.from);
			const to = asString(data.to);
			const senderSessionId = asString(data.senderSessionId);
			const content = asString(data.content);
			const sentAt = asString(data.sentAt);
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
					attribution: messageAttribution(swarm.roles, senderSessionId)
				}),
				transcript: to === "group" ? appendWindow(swarm.transcript, {
					from,
					to,
					content,
					sentAt
				}) : swarm.transcript
			};
		}
		case "swarm/role-exited": {
			const data = event.data;
			const existing = swarm.roles.find((role) => role.roleName === data.roleName);
			if (existing === void 0) return swarm;
			return {
				...swarm,
				roles: upsertRole(swarm.roles, {
					...existing,
					status: "exited",
					outcome: data.outcome
				})
			};
		}
		case "swarm/destroyed": {
			const data = event.data;
			return {
				...swarm,
				terminated: true,
				destroyReason: data.reason,
				...swarm.chat === void 0 ? {} : { chat: {
					...swarm.chat,
					active: false,
					endReason: swarm.chat.endReason ?? "swarm-terminated"
				} }
			};
		}
		case "swarm/checkpoint": {
			const data = event.data;
			return {
				...swarm,
				latestCheckpointAt: data.savedAt
			};
		}
		case "swarm/resumed": {
			const data = event.data;
			let roles = swarm.roles;
			for (const record of data.roles) {
				const existing = roles.find((role) => role.roleName === record.roleName);
				roles = upsertRole(roles, {
					roleName: record.roleName,
					childId: record.childId,
					status: "running",
					...existing?.model !== void 0 ? { model: existing.model } : {}
				});
			}
			return {
				...swarm,
				roles,
				lastResumedAt: data.resumedAt
			};
		}
		case "swarm/hitl-requested": {
			const data = event.data;
			const entry = {
				requestId: data.requestId,
				question: data.question,
				requestedAt: data.requestedAt
			};
			const duplicate = swarm.pendingHitl.findIndex((pending) => pending.requestId === data.requestId);
			if (duplicate < 0) return {
				...swarm,
				pendingHitl: [...swarm.pendingHitl, entry]
			};
			const pendingHitl = [...swarm.pendingHitl];
			pendingHitl[duplicate] = entry;
			return {
				...swarm,
				pendingHitl
			};
		}
		case "swarm/hitl-resolved": {
			const data = event.data;
			if (!swarm.pendingHitl.some((pending) => pending.requestId === data.requestId)) return swarm;
			return {
				...swarm,
				pendingHitl: swarm.pendingHitl.filter((pending) => pending.requestId !== data.requestId)
			};
		}
		case "swarm/chat-started": {
			const data = event.data;
			return {
				...swarm,
				chat: {
					topic: data.topic,
					speakerSelection: data.speakerSelection,
					active: true,
					startedAt: asString(data.startedAt),
					...data.maxTurns !== void 0 ? { maxTurns: data.maxTurns } : {},
					...data.maxRounds !== void 0 ? { maxRounds: data.maxRounds } : {},
					...data.terminationMessage !== void 0 ? { terminationMessage: data.terminationMessage } : {}
				}
			};
		}
		case "swarm/chat-ended": {
			const data = event.data;
			if (swarm.chat === void 0) return swarm;
			return {
				...swarm,
				chat: {
					...swarm.chat,
					active: false,
					endReason: data.reason
				}
			};
		}
		case "swarm/context-updated": {
			const data = event.data;
			return {
				...swarm,
				context: {
					...swarm.context,
					[data.key]: data.value
				}
			};
		}
		default: return swarm;
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
function applySwarmPanelEvent(state, event) {
	if (!event.type.startsWith("swarm/")) return state;
	const swarmId = event.data.swarmId;
	if (typeof swarmId !== "string") return state;
	const current = state?.[swarmId];
	const reduced = reduceSwarm(current ?? emptySwarm(swarmId), event);
	if (current !== void 0 && reduced === current) return state;
	return {
		...state ?? {},
		[swarmId]: reduced
	};
}
//#endregion
//#region src/domain.ts
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
function foldSwarmEvents(swarmId, events, liveTopology, memoryLimit) {
	const roles = /* @__PURE__ */ new Map();
	const pendingHitl = /* @__PURE__ */ new Map();
	const context = /* @__PURE__ */ new Map();
	const memories = [];
	const transcript = [];
	let chatConfig;
	let chatActive = false;
	let topologyMode = liveTopology;
	let terminated = false;
	let messageCount = 0;
	let lastSpeaker;
	for (const event of events) {
		if (!event.type.startsWith("swarm/")) continue;
		if (event.data.swarmId !== swarmId) continue;
		switch (event.type) {
			case "swarm/topology-changed":
				topologyMode = event.data.mode;
				break;
			case "swarm/role-spawned": {
				const spawned = event.data;
				roles.set(spawned.roleName, {
					roleName: spawned.roleName,
					childId: spawned.childId,
					...spawned.model !== void 0 ? { model: spawned.model } : {},
					...spawned.systemPrompt !== void 0 ? { systemPrompt: spawned.systemPrompt } : {},
					status: "running"
				});
				break;
			}
			case "swarm/role-message": {
				messageCount += 1;
				const message = event.data;
				lastSpeaker = message.from;
				if (message.to === "group") transcript.push({
					from: message.from,
					content: message.content
				});
				break;
			}
			case "swarm/role-exited": {
				const exited = event.data;
				const existing = roles.get(exited.roleName);
				if (existing) roles.set(exited.roleName, {
					...existing,
					status: "exited",
					outcome: exited.outcome
				});
				break;
			}
			case "swarm/destroyed":
				terminated = true;
				break;
			case "swarm/hitl-requested": {
				const requested = event.data;
				pendingHitl.set(requested.requestId, {
					requestId: requested.requestId,
					question: requested.question,
					requestedAt: requested.requestedAt
				});
				break;
			}
			case "swarm/hitl-resolved":
				pendingHitl.delete(event.data.requestId);
				break;
			case "swarm/chat-started":
				chatConfig = event.data;
				chatActive = true;
				break;
			case "swarm/chat-ended":
				chatActive = false;
				break;
			case "swarm/context-updated": {
				const updated = event.data;
				context.set(updated.key, updated.value);
				break;
			}
			case "swarm/memory-written": {
				const written = event.data;
				memories.push({
					id: written.id,
					text: written.text,
					...written.tags !== void 0 ? { tags: written.tags } : {},
					by: written.by,
					writtenAt: written.writtenAt
				});
				break;
			}
			default: break;
		}
	}
	const chat = chatConfig === void 0 ? void 0 : {
		topic: chatConfig.topic,
		speakerSelection: chatConfig.speakerSelection,
		...chatConfig.maxTurns !== void 0 ? { maxTurns: chatConfig.maxTurns } : {},
		...chatConfig.maxRounds !== void 0 ? { maxRounds: chatConfig.maxRounds } : {},
		...chatConfig.terminationMessage !== void 0 ? { terminationMessage: chatConfig.terminationMessage } : {},
		turnCount: transcript.length,
		transcript,
		active: chatActive
	};
	return {
		swarmId,
		roles,
		topologyMode,
		terminated,
		messageCount,
		pendingHitl: [...pendingHitl.values()],
		context,
		memories: memoryLimit === void 0 ? memories : memories.slice(-memoryLimit),
		...chat !== void 0 ? { chat } : {},
		...lastSpeaker !== void 0 ? { lastSpeaker } : {}
	};
}
/**
* Collect every swarm id ever created in one session log, in creation order.
* @param events - the orchestrator session's full event log (`session.snapshotEvents()`).
* @returns distinct swarm ids from `swarm/created` events.
*/
function collectSwarmIds(events) {
	const ids = [];
	const seen = /* @__PURE__ */ new Set();
	for (const event of events) {
		if (event.type !== "swarm/created") continue;
		const swarmId = event.data.swarmId;
		if (seen.has(swarmId)) continue;
		seen.add(swarmId);
		ids.push(swarmId);
	}
	return ids;
}
/**
* Find the `savedAt` of the latest checkpoint for one swarm.
* @param swarmId - identity of the swarm.
* @param events - the orchestrator session's full event log.
* @returns the latest checkpoint's save instant, or `undefined` when none exists.
*/
function latestCheckpointAt(swarmId, events) {
	let savedAt;
	for (const event of events) {
		if (event.type !== "swarm/checkpoint") continue;
		const data = event.data;
		if (data.swarmId === swarmId) savedAt = data.savedAt;
	}
	return savedAt;
}
/**
* List the messages routed TO one role, in log order. Cold resume replays
* exactly this sequence into a re-spawned child.
* @param swarmId - identity of the swarm.
* @param events - the orchestrator session's full event log.
* @param roleName - the recipient role.
* @returns inbound routed messages in their original order.
*/
function inboundMessages(swarmId, events, roleName) {
	const inbound = [];
	for (const event of events) {
		if (event.type !== "swarm/role-message") continue;
		const data = event.data;
		if (data.swarmId !== swarmId || data.to !== roleName) continue;
		inbound.push({
			from: data.from,
			content: data.content
		});
	}
	return inbound;
}
/** Returns true when a roleName is valid (non-empty, no surrounding whitespace). */
function isValidRoleName(roleName) {
	return roleName.length > 0 && roleName.length <= 64 && roleName.trim() === roleName;
}
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
function selectNextSpeaker(speakers, lastSpeaker, mode, random = Math.random) {
	if (speakers.length === 0) return void 0;
	if (mode === "round_robin") return speakers[((lastSpeaker === void 0 ? -1 : speakers.indexOf(lastSpeaker)) + 1) % speakers.length];
	const candidates = speakers.length > 1 ? speakers.filter((speaker) => speaker !== lastSpeaker) : [...speakers];
	return candidates[Math.floor(random() * candidates.length)];
}
/**
* Completed rounds: one round is every active role speaking once. Derived as
* `floor(turnCount / activeRoles)` — exact for `round_robin`, a documented
* approximation once roles exit mid-chat or selection is non-cyclic.
* @param turnCount - engine turns taken so far.
* @param activeRoles - roles currently running.
* @returns the number of completed rounds.
*/
function completedRounds(turnCount, activeRoles) {
	if (activeRoles <= 0) return 0;
	return Math.floor(turnCount / activeRoles);
}
//#endregion
//#region src/runtime.ts
/**
* One engine turn stopped for a reason the engine should treat as a chat stop
* condition rather than an internal failure: the speaker was interrupted
* (`interrupted`) or never answered inside the turn timeout (`timeout`).
*/
var RoleTurnError = class extends Error {
	reason;
	constructor(message, reason) {
		super(message);
		this.reason = reason;
		this.name = "RoleTurnError";
	}
};
/** One process-local, disposable Swarm runtime attached to one orchestrator root agent. */
var SwarmRuntime = class {
	ctx;
	agent;
	swarmId;
	config;
	/** role name → durable child session id. */
	children = /* @__PURE__ */ new Map();
	/** Live HITL waits, request id → cancellation. A pending wait is swarm-level: role interrupts do not touch it, terminate/dispose cancel it. */
	pendingHitl = /* @__PURE__ */ new Map();
	/**
	* Per-role cancellation for the turn currently in flight. `interrupt` and
	* settlement abort it so `swarm_next_turn` never waits forever on a child
	* that will not answer.
	*/
	roleTurns = /* @__PURE__ */ new Map();
	/** True while one `swarm_next_turn` call drives this swarm (explicit serialization). */
	turnInFlight = false;
	/** `hitl-<n>` / `mem-<n>` counters mirrored in memory; `hydrate` reseeds them from the log. */
	hitlCount = 0;
	memoryCount = 0;
	/** Last fold, keyed by log length + topology + memory limit; the log only grows. */
	foldCache;
	topology = "parent-child";
	terminated = false;
	/** Structural state (roles, topology, termination) changed since the last checkpoint. */
	structuralDirty = false;
	/** Messages were routed since the last checkpoint. */
	messagesDirty = false;
	constructor(ctx, agent, swarmId, config) {
		this.ctx = ctx;
		this.agent = agent;
		this.swarmId = swarmId;
		this.config = config;
	}
	/** Current topology mode. */
	get currentTopology() {
		return this.topology;
	}
	/** Whether this swarm has been terminated. */
	get isTerminated() {
		return this.terminated;
	}
	/**
	* Reject a mutating entry point once the swarm is terminated. Guarantees the
	* durable log never gains a `swarm/*` fact after `swarm/destroyed` (audit
	* G4-04/G4-06): a terminated swarm must not spawn orphans or block on HITL.
	* @param action - human-readable action for the error message.
	*/
	assertActive(action) {
		if (this.terminated) throw new Error(`swarm: cannot ${action}; the swarm is terminated`);
	}
	/**
	* Claim the single in-flight turn slot. The host scheduler already runs these
	* tools exclusively, but the contract is made explicit here so a direct
	* caller (another plugin, PTC nesting, tests) cannot interleave two engines.
	* @returns true when the caller owns the slot until {@link endTurn}.
	*/
	beginTurn() {
		if (this.turnInFlight) return false;
		this.turnInFlight = true;
		return true;
	}
	/** Release the turn slot claimed by {@link beginTurn}. */
	endTurn() {
		this.turnInFlight = false;
	}
	/**
	* Restore this runtime's in-memory state from a folded event log. Used only
	* by cold resume, immediately after construction, before any tool runs.
	* @param state - the fold of this swarm's durable events.
	*/
	hydrate(state) {
		this.topology = state.topologyMode;
		this.terminated = state.terminated;
		this.children.clear();
		for (const role of state.roles.values()) if (role.status === "running") this.children.set(role.roleName, role.childId);
		let hitl = 0;
		let memory = 0;
		for (const event of this.agent.session.snapshotEvents()) {
			if (event.data.swarmId !== this.swarmId) continue;
			if (event.type === "swarm/hitl-requested") hitl += 1;
			else if (event.type === "swarm/memory-written") memory += 1;
		}
		this.hitlCount = hitl;
		this.memoryCount = memory;
		this.foldCache = void 0;
	}
	/**
	* Whether a checkpoint is due at the next idle boundary under `frequency`.
	* `auto` snapshots structural changes only; `per_turn` also snapshots
	* message-only progress. `manual` never snapshots automatically.
	* @param frequency - the configured checkpoint frequency.
	*/
	needsCheckpoint(frequency) {
		if (frequency === "manual") return false;
		if (frequency === "per_turn") return this.structuralDirty || this.messagesDirty;
		return this.structuralDirty;
	}
	/**
	* Append a `swarm/checkpoint` snapshot of the current folded state and clear
	* the dirty flags. Checkpoints are markers over the log: resume re-folds the
	* complete log and names the latest checkpoint as its recovery point.
	* @param reason - why this checkpoint is saved.
	* @returns the checkpoint's save instant.
	*/
	saveCheckpoint(reason) {
		const state = this.state();
		const savedAt = (/* @__PURE__ */ new Date()).toISOString();
		this.agent.session.append("swarm/checkpoint", {
			swarmId: this.swarmId,
			version: 1,
			reason,
			topologyMode: state.topologyMode,
			roles: [...state.roles.values()].map((role) => ({
				roleName: role.roleName,
				childId: role.childId,
				status: role.status,
				...role.model !== void 0 ? { model: role.model } : {}
			})),
			messageCount: state.messageCount,
			...state.context.size > 0 ? { context: Object.fromEntries(state.context) } : {},
			...state.lastSpeaker !== void 0 ? { lastSpeaker: state.lastSpeaker } : {},
			savedAt
		});
		this.structuralDirty = false;
		this.messagesDirty = false;
		return savedAt;
	}
	/** Set the topology mode and append a session event. */
	setTopology(mode) {
		this.topology = mode;
		this.structuralDirty = true;
		this.agent.session.append("swarm/topology-changed", {
			swarmId: this.swarmId,
			mode,
			changedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
	}
	/**
	* Spawn a durable continuable child agent for the given role.
	* @param roleName - stable role name.
	* @param systemPrompt - optional role definition delivered as the child's initial prompt.
	* @param model - optional provider/model override for this child.
	* @param signal - caller cancellation owning the spawn until inbox acceptance.
	* @returns the durable child session id.
	*/
	async spawnRole(roleName, systemPrompt, model, signal) {
		this.assertActive("spawn a role");
		const provider = this.config.provider;
		const effectiveModel = model ?? this.config.defaultModel;
		const prompt = [{
			type: "text",
			text: systemPrompt ?? `You are the "${roleName}" role in an agent swarm.`
		}];
		const agentOptions = effectiveModel !== void 0 && (effectiveModel.provider !== void 0 || effectiveModel.model !== void 0) ? {
			...effectiveModel.provider !== void 0 ? { provider: effectiveModel.provider } : {},
			...effectiveModel.model !== void 0 ? { model: effectiveModel.model } : {}
		} : void 0;
		const childId = (await this.ctx.subagents.startContinuable({
			provider,
			label: `swarm/${roleName}`,
			request: {
				prompt,
				parent: this.agent,
				...agentOptions !== void 0 ? { agentOptions } : {}
			},
			signal
		})).childId;
		if (this.children.has(roleName)) this.interrupt(roleName);
		this.children.set(roleName, childId);
		this.structuralDirty = true;
		const modelPayload = effectiveModel !== void 0 && (effectiveModel.provider !== void 0 || effectiveModel.model !== void 0) ? {
			provider: effectiveModel.provider ?? "",
			model: effectiveModel.model ?? ""
		} : void 0;
		this.agent.session.append("swarm/role-spawned", {
			swarmId: this.swarmId,
			roleName,
			childId,
			...modelPayload !== void 0 ? { model: modelPayload } : {},
			...systemPrompt !== void 0 ? { systemPrompt } : {}
		});
		return childId;
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
	async sendMessage(from, to, content, attribution, signal) {
		this.assertActive("send a message");
		const toChildId = this.children.get(to);
		if (toChildId === void 0) throw new Error(`swarm: unknown role ${to}`);
		let senderSessionId;
		if (from === "orchestrator" || from === "human") senderSessionId = this.agent.session.id;
		else {
			const fromChildId = this.children.get(from);
			if (fromChildId === void 0) throw new Error(`swarm: unknown role ${from}`);
			senderSessionId = this.resolveSenderSessionId(fromChildId, attribution);
		}
		const message = [{
			type: "text",
			text: content
		}];
		await queueHostSubagentPrompt(this.ctx.subagents, this.agent, toChildId, message, {
			kind: "agent-message",
			form: "relay",
			senderSessionId
		}, signal);
		this.messagesDirty = true;
		this.agent.session.append("swarm/role-message", {
			swarmId: this.swarmId,
			from,
			to,
			senderSessionId,
			content,
			sentAt: (/* @__PURE__ */ new Date()).toISOString()
		});
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
	async deliverUnlogged(to, text, signal) {
		this.assertActive("deliver a recovery message");
		const toChildId = this.children.get(to);
		if (toChildId === void 0) throw new Error(`swarm: unknown role ${to}`);
		await queueHostSubagentPrompt(this.ctx.subagents, this.agent, toChildId, [{
			type: "text",
			text
		}], {
			kind: "agent-message",
			form: "relay",
			senderSessionId: this.agent.session.id
		}, signal);
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
	resolveSenderSessionId(fromChildId, attribution) {
		if (attribution === "orchestrator") return this.agent.session.id;
		if (attribution === "peer" && this.topology === "mixed") return fromChildId;
		if (this.topology === "peer") return fromChildId;
		return this.agent.session.id;
	}
	/**
	* Interrupt one or all roles (fire-and-return).
	*
	* Every step is best-effort (audit G4-03): a rejected `subagents.interrupt`
	* (for example `UNAUTHORIZED` after a child was resumed as its own root) must
	* not skip the `swarm/role-exited` fact or leave the role in the active set.
	* An in-flight turn for the role is aborted so the engine cannot wait forever.
	*/
	interrupt(roleName) {
		const targets = roleName === void 0 ? [...this.children.entries()] : this.children.has(roleName) ? [[roleName, this.children.get(roleName)]] : [];
		for (const [name, childId] of targets) {
			this.roleTurns.get(name)?.abort(/* @__PURE__ */ new Error(`swarm: role ${JSON.stringify(name)} was interrupted`));
			this.roleTurns.delete(name);
			try {
				this.ctx.subagents.interrupt(childId, {
					kind: "ancestor",
					agent: this.agent
				});
			} catch {}
			this.structuralDirty = true;
			this.agent.session.append("swarm/role-exited", {
				swarmId: this.swarmId,
				roleName: name,
				childId,
				outcome: "interrupted",
				exitedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			this.children.delete(name);
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
	markRoleSettled(roleName, outcome) {
		const childId = this.children.get(roleName);
		if (childId === void 0) return false;
		this.roleTurns.get(roleName)?.abort(/* @__PURE__ */ new Error(`swarm: role ${JSON.stringify(roleName)} settled`));
		this.roleTurns.delete(roleName);
		this.structuralDirty = true;
		this.agent.session.append("swarm/role-exited", {
			swarmId: this.swarmId,
			roleName,
			childId,
			outcome,
			exitedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		this.children.delete(roleName);
		return true;
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
	markChildSettled(childId, outcome) {
		for (const [roleName, mapped] of this.children) {
			if (mapped !== childId) continue;
			return this.markRoleSettled(roleName, outcome);
		}
		return false;
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
	async askUser(question, header, options, signal) {
		this.assertActive("ask the operator");
		const requestId = this.nextHitlRequestId();
		this.agent.session.append("swarm/hitl-requested", {
			swarmId: this.swarmId,
			requestId,
			question,
			...header !== void 0 ? { header } : {},
			...options !== void 0 ? { options: options.map((option) => option.label) } : {},
			requestedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		const controller = new AbortController();
		const onExecAbort = () => controller.abort();
		if (signal.aborted) controller.abort();
		else signal.addEventListener("abort", onExecAbort, { once: true });
		this.pendingHitl.set(requestId, controller);
		const cancelled = new Promise((_, reject) => {
			controller.signal.addEventListener("abort", () => reject(/* @__PURE__ */ new Error("swarm: HITL wait cancelled")), { once: true });
		});
		let settled = false;
		const resolve = (outcome, answer) => {
			if (settled) return;
			settled = true;
			this.agent.session.append("swarm/hitl-resolved", {
				swarmId: this.swarmId,
				requestId,
				outcome,
				...answer !== void 0 ? { answer } : {},
				resolvedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
		};
		try {
			const ask = this.ctx.userQuestions.ask({
				questions: [{
					id: requestId,
					question,
					...header !== void 0 ? { header } : {},
					...options !== void 0 ? { options: options.map((option) => ({
						label: option.label,
						...option.description !== void 0 ? { description: option.description } : {}
					})) } : {}
				}],
				agent: this.agent,
				signal: controller.signal
			});
			const result = await Promise.race([ask, cancelled]);
			const item = result.answers.find((answer) => answer.id === requestId) ?? result.answers[0];
			const answer = item?.custom ?? item?.selected.join(", ") ?? "";
			resolve("answered", answer);
			return {
				requestId,
				outcome: "answered",
				answer
			};
		} catch (error) {
			resolve("cancelled");
			if (controller.signal.aborted) return {
				requestId,
				outcome: "cancelled"
			};
			throw error;
		} finally {
			signal.removeEventListener("abort", onExecAbort);
			this.pendingHitl.delete(requestId);
		}
	}
	/** The next HITL request id: `hitl-<n>` counting this swarm's prior requests, so ids survive cold resume without collision. */
	nextHitlRequestId() {
		this.hitlCount += 1;
		return `hitl-${this.hitlCount}`;
	}
	/**
	* Start the group chat engine for this swarm. Throws when a chat is already
	* active — end or terminate it first.
	* @param config - the effective chat configuration (tool args over deployment defaults).
	*/
	startChat(config) {
		this.assertActive("start a chat");
		const existing = this.state().chat;
		if (existing?.active) throw new Error(`swarm: chat already active for topic ${JSON.stringify(existing.topic)}`);
		this.structuralDirty = true;
		this.agent.session.append("swarm/chat-started", {
			swarmId: this.swarmId,
			topic: config.topic,
			speakerSelection: config.speakerSelection,
			...config.maxTurns !== void 0 ? { maxTurns: config.maxTurns } : {},
			...config.maxRounds !== void 0 ? { maxRounds: config.maxRounds } : {},
			...config.terminationMessage !== void 0 ? { terminationMessage: config.terminationMessage } : {},
			startedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
	}
	/** Stop the group chat engine (idempotent). */
	endChat(reason) {
		if (this.state().chat?.active !== true) return;
		this.structuralDirty = true;
		this.agent.session.append("swarm/chat-ended", {
			swarmId: this.swarmId,
			reason,
			endedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
	}
	/** Write one context variable; `by` attributes the writer (`orchestrator`, `human`, or a role). */
	setContext(key, value, by) {
		this.assertActive("write context");
		this.messagesDirty = true;
		this.agent.session.append("swarm/context-updated", {
			swarmId: this.swarmId,
			key,
			value,
			by,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
	}
	/**
	* Log one engine turn: the speaker's reply addressed to the whole group.
	* Group messages are log facts — every role observes the transcript through
	* the next turn prompt, so no per-role delivery happens here.
	*/
	recordGroupMessage(speaker, content) {
		const childId = this.children.get(speaker);
		if (childId === void 0 || this.terminated) return false;
		this.messagesDirty = true;
		this.agent.session.append("swarm/role-message", {
			swarmId: this.swarmId,
			from: speaker,
			to: "group",
			senderSessionId: childId,
			content,
			sentAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		return true;
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
	async runTurn(roleName, prompt, signal) {
		this.assertActive("run a turn");
		const childId = this.children.get(roleName);
		if (childId === void 0) throw new Error(`swarm: unknown role ${roleName}`);
		const roleController = new AbortController();
		this.roleTurns.get(roleName)?.abort(/* @__PURE__ */ new Error(`swarm: role ${JSON.stringify(roleName)} started a new turn`));
		this.roleTurns.set(roleName, roleController);
		const onOuterAbort = () => {
			roleController.abort(signal.reason);
		};
		if (signal.aborted) roleController.abort(signal.reason);
		else signal.addEventListener("abort", onOuterAbort, { once: true });
		const roleSignal = roleController.signal;
		try {
			const messageId = await queueHostSubagentPrompt(this.ctx.subagents, this.agent, childId, [{
				type: "text",
				text: prompt
			}], {
				kind: "agent-message",
				form: "relay",
				senderSessionId: this.agent.session.id
			}, roleSignal);
			const child = this.ctx.agents.get(childId);
			if (child === void 0) return "";
			return await this.awaitChildReply(child, messageId, roleSignal);
		} catch (error) {
			if (roleController.signal.aborted && !signal.aborted) throw new RoleTurnError(error instanceof Error ? error.message : String(error), "interrupted");
			throw error;
		} finally {
			signal.removeEventListener("abort", onOuterAbort);
			if (this.roleTurns.get(roleName) === roleController) this.roleTurns.delete(roleName);
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
	awaitChildReply(child, messageId, signal) {
		const timeoutMs = this.config.turnTimeoutMs;
		const evaluate = () => {
			if (child.status !== "idle") return void 0;
			const events = child.session.snapshotEvents();
			let watermark;
			for (let index = events.length - 1; index >= 0; index--) {
				const event = events[index];
				if (event.type === "user/message" && event.data.id === messageId) {
					watermark = index;
					break;
				}
			}
			if (watermark === void 0) return void 0;
			for (let index = events.length - 1; index > watermark; index--) {
				const event = events[index];
				if (event.type !== "assistant/message") continue;
				return event.data.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
			}
		};
		const immediate = evaluate();
		if (immediate !== void 0) return Promise.resolve(immediate);
		return new Promise((resolve, reject) => {
			const attempt = () => {
				const reply = evaluate();
				if (reply !== void 0) {
					cleanup();
					resolve(reply);
				}
			};
			let timer;
			const cleanup = () => {
				if (timer !== void 0) clearTimeout(timer);
				stopSession();
				stopStatus();
				signal.removeEventListener("abort", onAbort);
			};
			const stopSession = this.ctx.on("session/event", (session) => {
				if (session.id === child.session.id) attempt();
			});
			const stopStatus = child.ctx.on("agent/status", attempt);
			const onAbort = () => {
				cleanup();
				reject(signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("swarm: turn aborted"));
			};
			signal.addEventListener("abort", onAbort, { once: true });
			if (signal.aborted) {
				onAbort();
				return;
			}
			timer = setTimeout(() => {
				cleanup();
				reject(new RoleTurnError(`swarm: the role did not reply within ${timeoutMs} ms`, "timeout"));
			}, timeoutMs);
		});
	}
	/** Cancel every live HITL wait; the awaiting `askUser` calls log the cancellations. */
	cancelPendingHitl() {
		for (const controller of this.pendingHitl.values()) controller.abort();
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
	terminate(reason) {
		if (this.terminated) {
			this.cancelPendingHitl();
			return;
		}
		this.terminated = true;
		this.structuralDirty = true;
		this.agent.session.append("swarm/destroyed", {
			swarmId: this.swarmId,
			reason,
			destroyedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		this.cancelPendingHitl();
		this.interrupt(void 0);
	}
	/**
	* Build the current folded state from the session event log.
	*
	* The fold is memoized on (log length, topology, memory limit): the log only
	* grows, so repeated calls inside one tool invocation reuse the previous fold
	* instead of rescanning every event (audit G4-11).
	* @returns the folded state for this swarm.
	*/
	state() {
		const events = this.agent.session.snapshotEvents();
		const memoryLimit = this.config.memory.maxEntries;
		const cached = this.foldCache;
		if (cached !== void 0 && cached.length === events.length && cached.topology === this.topology && cached.memoryLimit === memoryLimit) return cached.state;
		const state = foldSwarmEvents(this.swarmId, events, this.topology, memoryLimit);
		this.foldCache = {
			length: events.length,
			topology: this.topology,
			memoryLimit,
			state
		};
		return state;
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
	writeMemory(text, by, tags) {
		this.assertActive("write memory");
		this.memoryCount += 1;
		const id = `mem-${this.memoryCount}`;
		this.messagesDirty = true;
		this.agent.session.append("swarm/memory-written", {
			swarmId: this.swarmId,
			id,
			text,
			by,
			...tags !== void 0 ? { tags } : {},
			writtenAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		return id;
	}
	/**
	* Dispose: cancel pending HITL waits and interrupt all children (idempotent).
	* Writes no new durable events itself; a cancelled `askUser` still logs its
	* own `swarm/hitl-resolved` when the owning session is still writable.
	*/
	dispose() {
		for (const controller of this.roleTurns.values()) controller.abort(/* @__PURE__ */ new Error("swarm: the swarm was disposed"));
		this.roleTurns.clear();
		this.cancelPendingHitl();
		if (this.terminated) return;
		for (const [name, childId] of this.children) {
			try {
				this.ctx.subagents.interrupt(childId, {
					kind: "ancestor",
					agent: this.agent
				});
			} catch {}
			this.children.delete(name);
		}
		this.terminated = true;
	}
};
//#endregion
//#region src/resume.ts
/**
* Whether one delivery failure proves the durable child session is gone.
*
* The host raises `NOT_RESUMABLE` ("subagent … is unavailable") when it cannot
* load the persisted child, which is the only condition that justifies
* re-spawning. Anything else — a transient relay/lock failure, a closing
* activation, an authorization rejection — must NOT spawn a duplicate child
* (audit G4-09).
* @param error - the rejected delivery.
* @returns true when the child session no longer exists.
*/
function isChildGoneError(error) {
	return error instanceof SubagentError && error.code === "NOT_RESUMABLE";
}
/** Render the recovery notice delivered to a cold-resumed child. */
function renderResumeNotice(swarmId, roleName, fromCheckpoint) {
	return [
		"[SWARM RESUMED]",
		"The host process restarted. The swarm was restored from its durable session log.",
		`swarm_id_json: ${JSON.stringify(swarmId)}`,
		`restored_from_checkpoint: ${fromCheckpoint ?? "none"}`,
		`role_json: ${JSON.stringify(roleName)}`,
		"Your message history is intact. Continue in your role."
	].join("\n");
}
/** Render the framing that precedes a replayed history in a re-spawned child. */
function renderRestoreFraming(swarmId, roleName) {
	return [
		"[SWARM RESTORED]",
		"The host process restarted and your previous session was lost. You were re-created from the durable orchestrator log.",
		`swarm_id_json: ${JSON.stringify(swarmId)}`,
		`role_json: ${JSON.stringify(roleName)}`,
		"Your restored inbound message history follows in its original order."
	].join("\n");
}
/** Render one replayed inbound message for a re-spawned child. */
function renderReplayedMessage(from, content) {
	return `[restored message from ${JSON.stringify(from)}]\n${content}`;
}
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
function hydrateSwarmRuntimes(rootCtx, agent, runtimes, config) {
	const pending = [];
	for (const swarmId of collectSwarmIds(agent.session.snapshotEvents())) {
		if (runtimes.has(swarmId)) continue;
		const runtime = new SwarmRuntime(rootCtx, agent, swarmId, config);
		const state = foldSwarmEvents(swarmId, agent.session.snapshotEvents(), "parent-child");
		runtime.hydrate(state);
		runtimes.set(swarmId, runtime);
		if (!state.terminated && [...state.roles.values()].some((role) => role.status === "running")) pending.push(swarmId);
	}
	return pending;
}
/**
* Re-establish one running role after a restart. The preferred path delivers
* a resume notice through host relay, which cold-resumes the durable child
* session with its full history. When the child session is gone, the role is
* re-spawned from its recorded definition and its inbound messages replayed.
* @returns the role's resume record with its post-resume child id.
*/
async function reactivateOneRole(runtime, agent, role, fromCheckpoint, signal) {
	try {
		await runtime.deliverUnlogged(role.roleName, renderResumeNotice(runtime.swarmId, role.roleName, fromCheckpoint), signal);
		return {
			roleName: role.roleName,
			childId: role.childId,
			action: "resumed"
		};
	} catch (error) {
		signal.throwIfAborted();
		if (runtime.isTerminated) throw error;
		if (!isChildGoneError(error)) {
			agent.ctx.logger.warn(`dsh-swarm-panel: cold resume could not reach role "${role.roleName}" (${String(error)}); keeping its durable child`);
			return;
		}
	}
	const newChildId = await runtime.spawnRole(role.roleName, role.systemPrompt, role.model, signal);
	await runtime.deliverUnlogged(role.roleName, renderRestoreFraming(runtime.swarmId, role.roleName), signal);
	for (const message of inboundMessages(runtime.swarmId, agent.session.snapshotEvents(), role.roleName)) {
		signal.throwIfAborted();
		await runtime.deliverUnlogged(role.roleName, renderReplayedMessage(message.from, message.content), signal);
	}
	return {
		roleName: role.roleName,
		childId: newChildId,
		action: "respawned"
	};
}
/**
* Re-establish every running role of one hydrated swarm and append the
* `swarm/resumed` fact. A swarm terminated meanwhile is left alone.
* @param runtime - the hydrated runtime to reactivate.
* @param agent - the exact live orchestrator.
* @param signal - cancellation owning the whole reactivation (aborted on disposal).
*/
async function reactivateSwarmRoles(runtime, agent, signal) {
	const swarmId = runtime.swarmId;
	const state = foldSwarmEvents(swarmId, agent.session.snapshotEvents(), runtime.currentTopology);
	if (state.terminated) return;
	const fromCheckpoint = latestCheckpointAt(swarmId, agent.session.snapshotEvents());
	const records = [];
	for (const role of state.roles.values()) {
		if (role.status !== "running" || runtime.isTerminated) continue;
		const record = await reactivateOneRole(runtime, agent, role, fromCheckpoint, signal);
		if (record !== void 0) records.push(record);
	}
	if (records.length === 0) return;
	if (runtime.isTerminated || runtime.state().terminated) return;
	agent.session.append("swarm/resumed", {
		swarmId,
		roles: records,
		...fromCheckpoint !== void 0 ? { fromCheckpoint } : {},
		resumedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
}
//#endregion
//#region src/engine.ts
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
/** Engine failure with a tool-facing error code. */
var EngineError = class extends Error {
	code;
	constructor(message, code) {
		super(message);
		this.code = code;
		this.name = "EngineError";
	}
};
/** Exhaustiveness guard for the closed SpeakerSelection union. */
function assertNever(value) {
	throw new Error(`swarm: unexpected speaker selection ${JSON.stringify(value)}`);
}
/** Names of the roles still running, in spawn order. */
function activeRoles(state) {
	return [...state.roles.values()].filter((role) => role.status === "running").map((role) => role.roleName);
}
/** The termination condition a chat has already met, when any. */
function terminationReason(chat, activeRoleCount) {
	if (activeRoleCount === 0) return "no-roles";
	if (chat.maxTurns !== void 0 && chat.turnCount >= chat.maxTurns) return "max-turns";
	if (chat.maxRounds !== void 0 && completedRounds(chat.turnCount, activeRoleCount) >= chat.maxRounds) return "max-round";
	const lastReply = chat.transcript.at(-1)?.content;
	if (chat.terminationMessage !== void 0 && lastReply !== void 0 && lastReply.includes(chat.terminationMessage)) return "termination-message";
}
/** Render the turn prompt: topic, shared context, and the recent transcript window. */
function buildTurnPrompt(chat, context, speaker, window) {
	const lines = ["[GROUP CHAT TURN]", `Topic: ${chat.topic}`];
	if (context.size > 0) {
		lines.push("", "Shared context variables:");
		for (const [key, value] of context) lines.push(`${key} = ${value}`);
	}
	const recent = chat.transcript.slice(-window);
	if (recent.length > 0) {
		lines.push("", "Recent transcript:");
		for (const message of recent) lines.push(`${message.from}: ${message.content}`);
	}
	lines.push("", `You are "${speaker}". Speak to the group: stay in role and reply concisely.`);
	return lines.join("\n");
}
/**
* Pick the next speaker. `auto` takes the orchestrator's `speaker` decision;
* `manual` asks the operator through HITL; the automatic strategies compute it.
*/
async function pickSpeaker(runtime, state, chat, option, signal) {
	const roles = activeRoles(state);
	const lastGroupSpeaker = chat.transcript.at(-1)?.from;
	switch (chat.speakerSelection) {
		case "round_robin":
		case "random": {
			const speaker = selectNextSpeaker(roles, lastGroupSpeaker, chat.speakerSelection);
			if (speaker === void 0) throw new EngineError("swarm: no active role can speak.", "invalid_argument");
			return speaker;
		}
		case "auto":
			if (option === void 0) throw new EngineError("swarm: speakerSelection \"auto\" requires the orchestrator to pass `speaker` to swarm_next_turn.", "invalid_argument");
			if (!roles.includes(option)) throw new EngineError(`swarm: unknown or exited role ${option}`, "invalid_argument");
			return option;
		case "manual": {
			if (runtime.config.humanInputMode === "NEVER") throw new EngineError("swarm: speakerSelection \"manual\" needs operator input, but humanInputMode is \"NEVER\".", "unavailable");
			const result = await runtime.askUser(`Swarm ${JSON.stringify(runtime.swarmId)}: who speaks next?`, "next speaker", roles.map((role) => ({ label: role })), signal);
			if (result.outcome !== "answered" || result.answer === void 0 || !roles.includes(result.answer)) throw new EngineError(`swarm: operator did not name an active role (got ${JSON.stringify(result.answer ?? "cancelled")}).`, "invalid_argument");
			return result.answer;
		}
		default: return assertNever(chat.speakerSelection);
	}
}
/**
* Ask the operator whether to stop, per humanInputMode.
* @returns true to stop the engine.
*/
async function confirmStop(runtime, question, signal) {
	const result = await runtime.askUser(question, "swarm control", [{
		label: "Stop",
		description: "End the group chat now."
	}, {
		label: "Continue",
		description: "Keep the chat running."
	}], signal);
	return result.outcome !== "answered" || !/continue/i.test(result.answer ?? "");
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
async function runChatTurns(runtime, options, signal) {
	if (!runtime.beginTurn()) throw new EngineError("swarm: another turn is already in flight for this swarm.", "unavailable");
	try {
		return await driveChatTurns(runtime, options, signal);
	} finally {
		runtime.endTurn();
	}
}
/** The turn loop itself; the caller owns the runtime's turn slot. */
async function driveChatTurns(runtime, options, signal) {
	const records = [];
	let ended = false;
	let endReason;
	const turnsWanted = options.turns ?? 1;
	if (!Number.isInteger(turnsWanted) || turnsWanted < 1) throw new EngineError("swarm: turns must be a positive integer.", "invalid_argument");
	for (let index = 0; index < turnsWanted; index++) {
		const state = runtime.state();
		const chat = state.chat;
		if (chat === void 0) throw new EngineError("swarm: no chat started; call swarm_start_chat first.", "invalid_argument");
		if (runtime.isTerminated || state.terminated) {
			ended = true;
			endReason = "swarm-terminated";
			break;
		}
		if (!chat.active) {
			ended = true;
			endReason = "already-ended";
			break;
		}
		const reason = terminationReason(chat, activeRoles(state).length);
		if (reason !== void 0) {
			if (runtime.config.humanInputMode === "TERMINATE" ? await confirmStop(runtime, `The group chat met its stop condition (${reason}). Terminate?`, signal) : true) {
				runtime.endChat(reason);
				ended = true;
				endReason = reason;
				break;
			}
		}
		const roundsBefore = completedRounds(chat.turnCount, activeRoles(state).length);
		const speaker = await pickSpeaker(runtime, state, chat, options.speaker, signal);
		const prompt = buildTurnPrompt(chat, state.context, speaker, runtime.config.chat.transcriptWindow);
		let reply;
		try {
			reply = await runtime.runTurn(speaker, prompt, signal);
		} catch (error) {
			if (runtime.isTerminated) {
				runtime.endChat("swarm-terminated");
				ended = true;
				endReason = "swarm-terminated";
				break;
			}
			if (error instanceof RoleTurnError) {
				const reason = error.reason === "timeout" ? "turn-timeout" : "role-interrupted";
				runtime.endChat(reason);
				ended = true;
				endReason = reason;
				break;
			}
			throw error;
		}
		if (!runtime.recordGroupMessage(speaker, reply)) {
			runtime.endChat("role-interrupted");
			ended = true;
			endReason = "role-interrupted";
			break;
		}
		records.push({
			speaker,
			reply
		});
		const after = runtime.state().chat;
		if (runtime.config.humanInputMode === "ALWAYS" && completedRounds(after.turnCount, activeRoles(state).length) > roundsBefore) {
			if (await confirmStop(runtime, `Round ${completedRounds(after.turnCount, activeRoles(state).length)} completed. Stop the group chat?`, signal)) {
				runtime.endChat("operator-stopped");
				ended = true;
				endReason = "operator-stopped";
				break;
			}
		}
	}
	return {
		turns: records,
		ended,
		...endReason !== void 0 ? { endReason } : {}
	};
}
//#endregion
//#region src/memory.ts
/** A tag exact hit weighs this many text-token hits. */
const TAG_WEIGHT = 2;
/**
* Split text into lowercase word terms (Unicode letters/digits).
* @param text - query or memory text.
* @returns distinct terms in first-appearance order.
*/
function tokenize(text) {
	const terms = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
	return [...new Set(terms)];
}
/**
* Score one entry against a query: one point per query term present in the
* entry text, {@link TAG_WEIGHT} points per term exactly matching a tag.
* @param entry - the memory entry.
* @param queryTerms - distinct lowercase query terms ({@link tokenize} output).
* @returns the relevance score; 0 means unrelated.
*/
function scoreMemory(entry, queryTerms) {
	if (queryTerms.length === 0) return 0;
	const textTerms = new Set(tokenize(entry.text));
	const tags = new Set((entry.tags ?? []).map((tag) => tag.toLowerCase()));
	let score = 0;
	for (const term of queryTerms) {
		if (textTerms.has(term)) score += 1;
		if (tags.has(term)) score += TAG_WEIGHT;
	}
	return score;
}
/**
* Rank entries against a query: positive scores only, highest first; ties
* resolve to the LATER write (recency wins because the input is in write
* order and the comparator prefers the bigger index).
* @param entries - memory entries in write order (the fold view).
* @param query - free-text query.
* @param limit - maximum hits (positive integer).
* @returns scored hits, best first.
*/
function queryMemories(entries, query, limit) {
	const queryTerms = tokenize(query);
	const scored = [];
	for (const [index, entry] of entries.entries()) {
		const score = scoreMemory(entry, queryTerms);
		if (score > 0) scored.push({
			entry,
			index,
			score
		});
	}
	scored.sort((left, right) => right.score - left.score || right.index - left.index);
	return scored.slice(0, limit).map(({ entry, score }) => ({
		...entry,
		score
	}));
}
//#endregion
//#region src/types.ts
/**
* Brand a string as a {@link SwarmId}.
* @param id - the raw swarm id supplied by the model or config.
* @returns the same string, branded.
*/
function SwarmId(id) {
	return id;
}
//#endregion
//#region src/tools.ts
function errorSchema(code) {
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			code: {
				type: "string",
				required: true,
				const: code
			},
			message: {
				type: "string",
				required: true
			}
		}
	};
}
const ERROR_SCHEMAS = [
	errorSchema("invalid_argument"),
	errorSchema("not_found"),
	errorSchema("unavailable"),
	errorSchema("internal_error")
];
const SPAWN_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		swarmId: {
			type: "string",
			required: true
		},
		roleName: {
			type: "string",
			required: true
		},
		childId: {
			type: "string",
			required: true
		}
	}
};
const SEND_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		swarmId: {
			type: "string",
			required: true
		},
		from: {
			type: "string",
			required: true
		},
		to: {
			type: "string",
			required: true
		},
		delivered: {
			type: "boolean",
			required: true,
			const: true
		}
	}
};
const LIST_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		swarmId: {
			type: "string",
			required: true
		},
		roles: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					roleName: {
						type: "string",
						required: true
					},
					childId: {
						type: "string",
						required: true
					},
					status: {
						type: "string",
						required: true
					},
					model: {
						type: "object",
						additionalProperties: false,
						properties: {
							provider: {
								type: "string",
								required: true
							},
							model: {
								type: "string",
								required: true
							}
						}
					}
				}
			}
		},
		topologyMode: {
			type: "string",
			required: true
		},
		pendingHitl: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					requestId: {
						type: "string",
						required: true
					},
					question: {
						type: "string",
						required: true
					},
					requestedAt: {
						type: "string",
						required: true
					}
				}
			}
		}
	}
};
const OK_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: { ok: {
		type: "boolean",
		required: true,
		const: true
	} }
};
const CHECKPOINT_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		swarmId: {
			type: "string",
			required: true
		},
		savedAt: {
			type: "string",
			required: true
		},
		messageCount: {
			type: "number",
			required: true
		},
		roleCount: {
			type: "number",
			required: true
		}
	}
};
const ASK_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		swarmId: {
			type: "string",
			required: true
		},
		requestId: {
			type: "string",
			required: true
		},
		outcome: {
			type: "string",
			required: true,
			enum: ["answered", "cancelled"]
		},
		answer: { type: "string" },
		routedTo: { type: "string" }
	}
};
const START_CHAT_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		swarmId: {
			type: "string",
			required: true
		},
		topic: {
			type: "string",
			required: true
		},
		speakerSelection: {
			type: "string",
			required: true
		},
		maxTurns: { type: "number" },
		maxRounds: { type: "number" },
		terminationMessage: { type: "string" }
	}
};
const NEXT_TURN_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		swarmId: {
			type: "string",
			required: true
		},
		turns: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					speaker: {
						type: "string",
						required: true
					},
					reply: {
						type: "string",
						required: true
					}
				}
			}
		},
		ended: {
			type: "boolean",
			required: true
		},
		endReason: { type: "string" }
	}
};
const SET_CONTEXT_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		swarmId: {
			type: "string",
			required: true
		},
		key: {
			type: "string",
			required: true
		},
		value: {
			type: "string",
			required: true
		}
	}
};
const GET_CONTEXT_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		swarmId: {
			type: "string",
			required: true
		},
		entries: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					key: {
						type: "string",
						required: true
					},
					value: {
						type: "string",
						required: true
					}
				}
			}
		}
	}
};
const MEMORY_WRITE_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		swarmId: {
			type: "string",
			required: true
		},
		id: {
			type: "string",
			required: true
		}
	}
};
const MEMORY_QUERY_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		swarmId: {
			type: "string",
			required: true
		},
		query: {
			type: "string",
			required: true
		},
		entries: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						required: true
					},
					text: {
						type: "string",
						required: true
					},
					tags: {
						type: "array",
						items: { type: "string" }
					},
					by: {
						type: "string",
						required: true
					},
					writtenAt: {
						type: "string",
						required: true
					},
					score: {
						type: "number",
						required: true
					}
				}
			}
		}
	}
};
function renderValue(_args, value) {
	return [{
		type: "text",
		text: JSON.stringify(value)
	}];
}
/** Stable error for an unexpected failure. */
function internalError(message) {
	return {
		code: "internal_error",
		message
	};
}
/** Stable error for an unknown swarm. */
function notFound(swarmId) {
	return {
		code: "not_found",
		message: `swarm ${swarmId} not found.`
	};
}
/**
* Reject a mutating call on a terminated swarm with a tool-level code instead
* of the runtime's internal error (audit G4-04/G4-06): after `swarm_terminate`
* no tool may add roles, route messages, block on HITL, or write state.
* @param runtime - the swarm the call targets.
* @returns the error value, or undefined when the swarm still accepts changes.
*/
function terminatedError(runtime) {
	return runtime.isTerminated ? {
		code: "invalid_argument",
		message: "The swarm is terminated; no further changes are accepted."
	} : void 0;
}
const SPEAKER_SELECTIONS$1 = [
	"round_robin",
	"random",
	"auto",
	"manual"
];
/**
* Merge `swarm_start_chat` args over the deployment chat defaults, validating
* every override. Misconfigured tool args fail as `invalid_argument`.
*/
function resolveChatConfig(defaults, args) {
	const speakerSelection = args.speakerSelection ?? defaults.speakerSelection;
	if (!SPEAKER_SELECTIONS$1.includes(speakerSelection)) return {
		code: "invalid_argument",
		message: `speakerSelection must be one of ${SPEAKER_SELECTIONS$1.join(", ")}; got ${JSON.stringify(speakerSelection)}.`
	};
	const maxTurns = args.maxTurns ?? defaults.maxTurns;
	const maxRounds = args.maxRounds ?? defaults.maxRounds;
	if (maxTurns !== void 0 && (!Number.isInteger(maxTurns) || maxTurns < 1)) return {
		code: "invalid_argument",
		message: "maxTurns must be a positive integer."
	};
	if (maxRounds !== void 0 && (!Number.isInteger(maxRounds) || maxRounds < 1)) return {
		code: "invalid_argument",
		message: "maxRounds must be a positive integer."
	};
	const terminationMessage = args.terminationMessage ?? defaults.terminationMessage;
	return {
		topic: args.topic,
		speakerSelection,
		...maxTurns !== void 0 ? { maxTurns } : {},
		...maxRounds !== void 0 ? { maxRounds } : {},
		...terminationMessage !== void 0 ? { terminationMessage } : {}
	};
}
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
function registerSwarmTools(rootCtx, toolCtx, agent, runtimes, config) {
	const disposers = [];
	const runtimeFor = (swarmIdStr) => {
		let runtime = runtimes.get(swarmIdStr);
		if (runtime) return runtime;
		const swarmId = SwarmId(swarmIdStr);
		runtime = new SwarmRuntime(rootCtx, agent, swarmId, config);
		runtimes.set(swarmIdStr, runtime);
		agent.session.append("swarm/created", {
			swarmId,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		return runtime;
	};
	const isOrchestrator = (execAgent) => execAgent === agent;
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_spawn",
		description: "Spawn a named child agent role within the swarm. The child becomes a durable continuable sub-agent of the orchestrator. Each role has a unique name; re-spawning a named role replaces it. Optionally give the role a distinct model (provider + model id).",
		parameters: {
			swarmId: {
				type: "string",
				description: "The swarm to add the role to. Defaults to \"default\"."
			},
			roleName: {
				type: "string",
				required: true,
				description: "Stable role name (1-64 chars, no surrounding whitespace)."
			},
			systemPrompt: {
				type: "string",
				description: "Role definition delivered as the child's initial prompt."
			},
			model: {
				type: "object",
				additionalProperties: false,
				properties: {
					provider: {
						type: "string",
						description: "Provider route for this role."
					},
					model: {
						type: "string",
						description: "Model id for this role."
					}
				},
				description: "Optional provider/model override for this role."
			}
		},
		output: {
			schema: { oneOf: [SPAWN_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_spawn requires the live orchestrator agent.");
			const swarmIdStr = args.swarmId ?? "default";
			if (!isValidRoleName(args.roleName)) return {
				code: "invalid_argument",
				message: "roleName must be 1-64 chars without surrounding whitespace."
			};
			const runtime = runtimeFor(swarmIdStr);
			const terminated = terminatedError(runtime);
			if (terminated !== void 0) return terminated;
			try {
				const childId = await runtime.spawnRole(args.roleName, args.systemPrompt, args.model, exec.signal);
				return {
					swarmId: swarmIdStr,
					roleName: args.roleName,
					childId
				};
			} catch (error) {
				return internalError(error instanceof Error ? error.message : String(error));
			}
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_send_to",
		description: "Send a message from one swarm role (or the orchestrator) to another role. The orchestrator relays all traffic. Attribution — which session id the recipient perceives as the sender — is decided by the current topology (see swarm_set_topology) unless an explicit attribution override is supplied. Use this to coordinate tasks and share context between roles.",
		parameters: {
			swarmId: {
				type: "string",
				required: true,
				description: "The swarm to route within."
			},
			from: {
				type: "string",
				description: "Sender role name, or \"orchestrator\" (default)."
			},
			to: {
				type: "string",
				required: true,
				description: "Recipient role name."
			},
			content: {
				type: "string",
				required: true,
				description: "Message text to deliver."
			},
			attribution: {
				type: "string",
				enum: ["orchestrator", "peer"],
				description: "Explicit sender attribution; only meaningful in \"mixed\" topology."
			}
		},
		output: {
			schema: { oneOf: [SEND_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_send_to requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			const terminated = terminatedError(runtime);
			if (terminated !== void 0) return terminated;
			try {
				await runtime.sendMessage(args.from ?? "orchestrator", args.to, args.content, args.attribution, exec.signal);
				return {
					swarmId: args.swarmId,
					from: args.from ?? "orchestrator",
					to: args.to,
					delivered: true
				};
			} catch (error) {
				return internalError(error instanceof Error ? error.message : String(error));
			}
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_set_topology",
		description: "Set the communication topology mode for the swarm. \"parent-child\" attributes every message to the orchestrator (default, safest). \"peer\" lets child roles perceive messages as coming directly from sibling roles (P2P semantics). \"mixed\" lets the orchestrator choose attribution per message via swarm_send_to. The change takes effect on the next message.",
		parameters: {
			swarmId: {
				type: "string",
				required: true,
				description: "The swarm to reconfigure."
			},
			mode: {
				type: "string",
				required: true,
				enum: [
					"parent-child",
					"peer",
					"mixed"
				]
			}
		},
		output: {
			schema: { oneOf: [OK_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_set_topology requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			const terminated = terminatedError(runtime);
			if (terminated !== void 0) return terminated;
			runtime.setTopology(args.mode);
			return { ok: true };
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_list_children",
		description: "List every active role in a swarm with its durable child id, status, and model. Use this to know which roles are running and their identities before routing messages.",
		parameters: { swarmId: {
			type: "string",
			required: true,
			description: "The swarm to list."
		} },
		output: {
			schema: { oneOf: [LIST_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_list_children requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			const state = runtime.state();
			return {
				swarmId: args.swarmId,
				roles: [...state.roles.values()].map((role) => ({
					roleName: role.roleName,
					childId: role.childId,
					status: role.status,
					...role.model !== void 0 ? { model: role.model } : {}
				})),
				topologyMode: state.topologyMode,
				pendingHitl: state.pendingHitl.map((pending) => ({
					requestId: pending.requestId,
					question: pending.question,
					requestedAt: pending.requestedAt
				}))
			};
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_interrupt",
		description: "Interrupt one or all child roles in the swarm. Interruption signals the agent to stop; it does not guarantee immediate termination. The role is removed from the active set with outcome \"interrupted\". Omit roleName to interrupt every role.",
		parameters: {
			swarmId: {
				type: "string",
				required: true,
				description: "The swarm to interrupt within."
			},
			roleName: {
				type: "string",
				description: "Specific role to interrupt; omit for all."
			}
		},
		output: {
			schema: { oneOf: [OK_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_interrupt requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			try {
				runtime.interrupt(args.roleName);
				return { ok: true };
			} catch (error) {
				return internalError(error instanceof Error ? error.message : String(error));
			}
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_terminate",
		description: "Terminate the entire swarm: interrupt every child role and mark the swarm destroyed. Use this when the swarm task is complete or must be abandoned.",
		parameters: { swarmId: {
			type: "string",
			required: true,
			description: "The swarm to terminate."
		} },
		output: {
			schema: { oneOf: [OK_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_terminate requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			try {
				runtime.terminate("orchestrator-terminated");
				return { ok: true };
			} catch (error) {
				return internalError(error instanceof Error ? error.message : String(error));
			}
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_checkpoint",
		description: "Save a checkpoint snapshot of the swarm's current state — roles with their child ids, topology, message count, and last speaker — to the durable session log. After a host restart the swarm cold-resumes from the latest checkpoint. Depending on plugin configuration, checkpoints may also be saved automatically; call this to pin a recovery point explicitly, for example before a risky redirection.",
		parameters: { swarmId: {
			type: "string",
			required: true,
			description: "The swarm to checkpoint."
		} },
		output: {
			schema: { oneOf: [CHECKPOINT_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_checkpoint requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			const state = runtime.state();
			const savedAt = runtime.saveCheckpoint("manual");
			return {
				swarmId: args.swarmId,
				savedAt,
				messageCount: state.messageCount,
				roleCount: state.roles.size
			};
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_ask_user",
		description: "Ask the human operator a question and wait for the answer. Use this to escalate a decision, request missing information, or confirm a risky redirection. The question and its outcome are recorded in the durable session log. Optionally route the answer to a role as a message attributed to \"human\". Terminating the swarm cancels a pending ask. Disabled when the plugin is configured with humanInputMode \"NEVER\".",
		parameters: {
			swarmId: {
				type: "string",
				required: true,
				description: "The swarm the question belongs to."
			},
			question: {
				type: "string",
				required: true,
				description: "The question presented to the operator."
			},
			header: {
				type: "string",
				description: "Short label for the question UI."
			},
			options: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						label: {
							type: "string",
							required: true,
							description: "Selectable answer label."
						},
						description: {
							type: "string",
							description: "What choosing this answer means."
						}
					}
				},
				description: "Selectable answers; the operator may also enter a custom answer."
			},
			routeTo: {
				type: "string",
				description: "Role to deliver the answer to as a message from \"human\"."
			}
		},
		output: {
			schema: { oneOf: [ASK_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_ask_user requires the live orchestrator agent.");
			if (config.humanInputMode === "NEVER") return {
				code: "unavailable",
				message: "Human input is disabled (humanInputMode: NEVER)."
			};
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			const terminated = terminatedError(runtime);
			if (terminated !== void 0) return terminated;
			try {
				const result = await runtime.askUser(args.question, args.header, args.options, exec.signal);
				let routedTo;
				if (result.outcome === "answered" && result.answer !== void 0 && args.routeTo !== void 0) {
					await runtime.sendMessage("human", args.routeTo, result.answer, void 0, exec.signal);
					routedTo = args.routeTo;
				}
				return {
					swarmId: args.swarmId,
					requestId: result.requestId,
					outcome: result.outcome,
					...result.answer !== void 0 ? { answer: result.answer } : {},
					...routedTo !== void 0 ? { routedTo } : {}
				};
			} catch (error) {
				return internalError(error instanceof Error ? error.message : String(error));
			}
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_start_chat",
		description: "Start an open group chat engine for the swarm: roles take turns speaking about a topic. Speaker selection: \"round_robin\" cycles in spawn order, \"random\" picks anyone but the previous speaker, \"auto\" means you decide each turn (pass `speaker` to swarm_next_turn), \"manual\" asks the human operator. Stop conditions: maxTurns / maxRounds, a termination substring in a reply, or swarm_terminate. Omitted options fall back to the plugin configuration. Advance the chat with swarm_next_turn.",
		parameters: {
			swarmId: {
				type: "string",
				required: true,
				description: "The swarm to start chatting in."
			},
			topic: {
				type: "string",
				required: true,
				description: "The topic roles converse about; anchors every turn prompt."
			},
			speakerSelection: {
				type: "string",
				enum: [
					"round_robin",
					"random",
					"auto",
					"manual"
				],
				description: "How the next speaker is picked. Default from plugin config (\"round_robin\" unless configured)."
			},
			maxTurns: {
				type: "number",
				description: "Stop after this many turns (positive integer)."
			},
			maxRounds: {
				type: "number",
				description: "Stop after this many rounds; a round is every active role speaking once."
			},
			terminationMessage: {
				type: "string",
				description: "Stop when a reply contains this substring."
			}
		},
		output: {
			schema: { oneOf: [START_CHAT_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_start_chat requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			const terminated = terminatedError(runtime);
			if (terminated !== void 0) return terminated;
			const effective = resolveChatConfig(runtime.config.chat, args);
			if ("code" in effective) return effective;
			try {
				runtime.startChat(effective);
				return {
					swarmId: args.swarmId,
					topic: effective.topic,
					speakerSelection: effective.speakerSelection,
					...effective.maxTurns !== void 0 ? { maxTurns: effective.maxTurns } : {},
					...effective.maxRounds !== void 0 ? { maxRounds: effective.maxRounds } : {},
					...effective.terminationMessage !== void 0 ? { terminationMessage: effective.terminationMessage } : {}
				};
			} catch (error) {
				return {
					code: "invalid_argument",
					message: error instanceof Error ? error.message : String(error)
				};
			}
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_next_turn",
		description: "Advance the group chat by one or more turns: the engine picks the next speaker per the chat's speaker selection, delivers a turn prompt (topic + shared context + recent transcript), awaits the reply, and logs it to the group. Under speaker selection \"auto\" you must pass `speaker` — that is how you steer the conversation. Returns the turns taken and whether a stop condition ended the chat.",
		parameters: {
			swarmId: {
				type: "string",
				required: true,
				description: "The swarm whose chat to advance."
			},
			speaker: {
				type: "string",
				description: "Your speaker decision; required under speaker selection \"auto\"."
			},
			turns: {
				type: "number",
				description: "How many turns to advance (positive integer, default 1)."
			}
		},
		output: {
			schema: { oneOf: [NEXT_TURN_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_next_turn requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			try {
				const outcome = await runChatTurns(runtime, {
					...args.speaker !== void 0 ? { speaker: args.speaker } : {},
					...args.turns !== void 0 ? { turns: args.turns } : {}
				}, exec.signal);
				return {
					swarmId: args.swarmId,
					turns: outcome.turns.map((turn) => ({
						speaker: turn.speaker,
						reply: turn.reply
					})),
					ended: outcome.ended,
					...outcome.endReason !== void 0 ? { endReason: outcome.endReason } : {}
				};
			} catch (error) {
				if (error instanceof EngineError) return {
					code: error.code,
					message: error.message
				};
				return internalError(error instanceof Error ? error.message : String(error));
			}
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_set_context",
		description: "Write a swarm-level context variable (key-value shared state). Every role sees the current context in its next group-chat turn prompt, and the values are checkpointed with the swarm. Use this for shared facts, decisions, and intermediate results roles must agree on.",
		parameters: {
			swarmId: {
				type: "string",
				required: true,
				description: "The swarm to write context in."
			},
			key: {
				type: "string",
				required: true,
				description: "Context variable name."
			},
			value: {
				type: "string",
				required: true,
				description: "Context variable value."
			},
			by: {
				type: "string",
				description: "Attribute the write to a role name; defaults to \"orchestrator\"."
			}
		},
		output: {
			schema: { oneOf: [SET_CONTEXT_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_set_context requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			const terminated = terminatedError(runtime);
			if (terminated !== void 0) return terminated;
			if (args.key.trim() !== args.key || args.key.length === 0) return {
				code: "invalid_argument",
				message: "key must be non-empty without surrounding whitespace."
			};
			runtime.setContext(args.key, args.value, args.by ?? "orchestrator");
			return {
				swarmId: args.swarmId,
				key: args.key,
				value: args.value
			};
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_get_context",
		description: "Read swarm-level context variables: one entry when `key` is given, otherwise all entries. Roles receive the same values in their group-chat turn prompts.",
		parameters: {
			swarmId: {
				type: "string",
				required: true,
				description: "The swarm to read context from."
			},
			key: {
				type: "string",
				description: "Read only this variable; omit for all."
			}
		},
		output: {
			schema: { oneOf: [GET_CONTEXT_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_get_context requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			const context = runtime.state().context;
			const entries = args.key !== void 0 ? context.has(args.key) ? [{
				key: args.key,
				value: context.get(args.key)
			}] : [] : [...context.entries()].map(([key, value]) => ({
				key,
				value
			}));
			return {
				swarmId: args.swarmId,
				entries
			};
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_memory_write",
		description: "Remember a swarm-level fact (a decision, finding, or constraint) for later retrieval. Memories live in the durable session log and survive a cold resume; retrieve them with swarm_memory_query (lexical scoring, tag hits weigh double).",
		parameters: {
			swarmId: {
				type: "string",
				required: true,
				description: "The swarm to remember in."
			},
			text: {
				type: "string",
				required: true,
				description: "The fact to remember."
			},
			tags: {
				type: "array",
				items: { type: "string" },
				description: "Retrieval tags (exact hits weigh double)."
			},
			by: {
				type: "string",
				description: "Attribute the write to a role name; defaults to \"orchestrator\"."
			}
		},
		output: {
			schema: { oneOf: [MEMORY_WRITE_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_memory_write requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			const terminated = terminatedError(runtime);
			if (terminated !== void 0) return terminated;
			if (args.text.trim().length === 0) return {
				code: "invalid_argument",
				message: "text must be non-empty."
			};
			const id = runtime.writeMemory(args.text, args.by ?? "orchestrator", args.tags);
			return {
				swarmId: args.swarmId,
				id
			};
		}
	})));
	disposers.push(toolCtx.tools.register(defineTool({
		name: "swarm_memory_query",
		description: "Query swarm-level memories by free text: lexical token overlap with tag hits weighted double, best first, ties favor the later write. Returns at most `limit` entries (deployment default when omitted).",
		parameters: {
			swarmId: {
				type: "string",
				required: true,
				description: "The swarm to query."
			},
			query: {
				type: "string",
				required: true,
				description: "Free-text query."
			},
			limit: {
				type: "number",
				description: "Maximum hits (positive integer); defaults to the deployment queryLimit."
			}
		},
		output: {
			schema: { oneOf: [MEMORY_QUERY_VALUE_SCHEMA, ...ERROR_SCHEMAS] },
			render: renderValue
		},
		async execute(args, exec) {
			if (!isOrchestrator(exec.agent)) return internalError("swarm_memory_query requires the live orchestrator agent.");
			const runtime = runtimes.get(args.swarmId);
			if (!runtime) return notFound(args.swarmId);
			if (args.query.trim().length === 0) return {
				code: "invalid_argument",
				message: "query must be non-empty."
			};
			const limit = args.limit ?? runtime.config.memory.queryLimit;
			if (!Number.isInteger(limit) || limit < 1) return {
				code: "invalid_argument",
				message: `limit must be a positive integer; got ${JSON.stringify(args.limit)}`
			};
			const entries = queryMemories(runtime.state().memories, args.query, limit).map((hit) => ({
				id: hit.id,
				text: hit.text,
				...hit.tags !== void 0 ? { tags: [...hit.tags] } : {},
				by: hit.by,
				writtenAt: hit.writtenAt,
				score: hit.score
			}));
			return {
				swarmId: args.swarmId,
				query: args.query,
				entries
			};
		}
	})));
	let active = true;
	return () => {
		if (!active) return;
		active = false;
		for (const dispose of disposers.reverse()) dispose();
	};
}
//#endregion
//#region src/index.ts
/** Function plugin name. */
const name = "dsh-swarm-panel";
/**
* Required services.
* - `agents`: to observe `agent/created` and identify root agents.
* - `tools`: to register Orchestrator tools per-agent.
* - `subagents`: to spawn continuable children and route messages.
* - `userQuestions`: to ask the operator from `swarm_ask_user`.
*/
const inject = [
	"agents",
	"tools",
	"subagents",
	"userQuestions"
];
const CHECKPOINT_FREQUENCIES = [
	"auto",
	"manual",
	"per_turn"
];
/** Validate the configured checkpoint frequency at load, failing loud on misconfiguration. */
function resolveCheckpointFrequency(config) {
	const frequency = config.checkpoint?.frequency ?? "auto";
	if (!CHECKPOINT_FREQUENCIES.includes(frequency)) throw new Error(`dsh-swarm-panel: checkpoint.frequency must be one of ${CHECKPOINT_FREQUENCIES.join(", ")}; got ${JSON.stringify(frequency)}`);
	return frequency;
}
const HUMAN_INPUT_MODES = [
	"ALWAYS",
	"TERMINATE",
	"NEVER"
];
/** Validate the configured human input mode at load, failing loud on misconfiguration. */
function resolveHumanInputMode(config) {
	const mode = config.humanInputMode ?? "TERMINATE";
	if (!HUMAN_INPUT_MODES.includes(mode)) throw new Error(`dsh-swarm-panel: humanInputMode must be one of ${HUMAN_INPUT_MODES.join(", ")}; got ${JSON.stringify(mode)}`);
	return mode;
}
const SPEAKER_SELECTIONS = [
	"round_robin",
	"random",
	"auto",
	"manual"
];
/** Validate the chat defaults at load, failing loud on misconfiguration. */
function resolveChatDefaults(config) {
	const chat = config.chat ?? {};
	const speakerSelection = chat.speakerSelection ?? "round_robin";
	if (!SPEAKER_SELECTIONS.includes(speakerSelection)) throw new Error(`dsh-swarm-panel: chat.speakerSelection must be one of ${SPEAKER_SELECTIONS.join(", ")}; got ${JSON.stringify(speakerSelection)}`);
	for (const [field, value] of [
		["chat.maxTurns", chat.maxTurns],
		["chat.maxRounds", chat.maxRounds],
		["chat.transcriptWindow", chat.transcriptWindow]
	]) if (value !== void 0 && (!Number.isInteger(value) || value < 1)) throw new Error(`dsh-swarm-panel: ${field} must be a positive integer; got ${JSON.stringify(value)}`);
	return {
		speakerSelection,
		transcriptWindow: chat.transcriptWindow ?? 10,
		...chat.maxTurns !== void 0 ? { maxTurns: chat.maxTurns } : {},
		...chat.maxRounds !== void 0 ? { maxRounds: chat.maxRounds } : {},
		...chat.terminationMessage !== void 0 ? { terminationMessage: chat.terminationMessage } : {}
	};
}
/** Validate the memory bounds at load, failing loud on misconfiguration. */
function resolveMemoryDefaults(config) {
	const memory = config.memory ?? {};
	for (const [field, value] of [["memory.maxEntries", memory.maxEntries], ["memory.queryLimit", memory.queryLimit]]) if (value !== void 0 && (!Number.isInteger(value) || value < 1)) throw new Error(`dsh-swarm-panel: ${field} must be a positive integer; got ${JSON.stringify(value)}`);
	return {
		maxEntries: memory.maxEntries ?? 200,
		queryLimit: memory.queryLimit ?? 5
	};
}
/** Validate the configured turn timeout at load, failing loud on misconfiguration. */
function resolveTurnTimeout(config) {
	const value = config.turnTimeoutMs ?? 3e5;
	if (!Number.isInteger(value) || value < 1) throw new Error(`dsh-swarm-panel: turnTimeoutMs must be a positive integer; got ${JSON.stringify(config.turnTimeoutMs)}`);
	return value;
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
const SWARM_EVENT_TYPES = [
	"swarm/created",
	"swarm/role-spawned",
	"swarm/role-message",
	"swarm/role-exited",
	"swarm/topology-changed",
	"swarm/destroyed",
	"swarm/checkpoint",
	"swarm/resumed",
	"swarm/hitl-requested",
	"swarm/hitl-resolved",
	"swarm/chat-started",
	"swarm/chat-ended",
	"swarm/context-updated",
	"swarm/memory-written"
];
/**
* Live registrations of {@link registerSwarmEventTypes}. The vocabulary is a
* process-global set, so the last disposer removes it (audit G4-10).
*/
let eventVocabularyRefs = 0;
/**
* Register this plugin's event vocabulary with the session persistence read
* path until the returned disposer runs. `KNOWN_SESSION_EVENT_TYPES` is typed
* `ReadonlySet` because first-party packages never mutate it; the cast is the
* deferred out-of-repo registration surface named in the catalog's header.
*/
function registerSwarmEventTypes() {
	const known = KNOWN_SESSION_EVENT_TYPES;
	if (eventVocabularyRefs === 0) for (const type of SWARM_EVENT_TYPES) known.add(type);
	eventVocabularyRefs += 1;
	return () => {
		eventVocabularyRefs -= 1;
		if (eventVocabularyRefs > 0) return;
		eventVocabularyRefs = 0;
		for (const type of SWARM_EVENT_TYPES) known.delete(type);
	};
}
/** Wire payload schema of the `swarm` projection (every swarm of the session, or pre-first-event null). */
const swarmPanelModelSchema = z.union([z.record(z.string(), z.object({
	swarmId: z.string(),
	createdAt: z.string().optional(),
	topologyMode: z.union([
		z.literal("parent-child"),
		z.literal("peer"),
		z.literal("mixed")
	]),
	terminated: z.boolean(),
	destroyReason: z.string().optional(),
	messageCount: z.number().int().nonnegative(),
	lastSpeaker: z.string().optional(),
	roles: z.array(z.object({
		roleName: z.string(),
		childId: z.string(),
		status: z.union([z.literal("running"), z.literal("exited")]),
		outcome: z.union([
			z.literal("settled"),
			z.literal("interrupted"),
			z.literal("error")
		]).optional(),
		model: z.object({
			provider: z.string(),
			model: z.string()
		}).optional()
	})),
	pendingHitl: z.array(z.object({
		requestId: z.string(),
		question: z.string(),
		requestedAt: z.string()
	})),
	context: z.record(z.string(), z.string()),
	transcript: z.array(z.object({
		from: z.string(),
		to: z.string(),
		content: z.string(),
		sentAt: z.string()
	})),
	flow: z.array(z.object({
		seq: z.number().int(),
		from: z.string(),
		to: z.string(),
		senderSessionId: z.string(),
		content: z.string(),
		sentAt: z.string(),
		attribution: z.union([z.literal("orchestrator"), z.literal("peer")])
	})),
	chat: z.object({
		topic: z.string(),
		speakerSelection: z.string(),
		maxTurns: z.number().int().positive().optional(),
		maxRounds: z.number().int().positive().optional(),
		terminationMessage: z.string().optional(),
		active: z.boolean(),
		startedAt: z.string().optional(),
		endReason: z.string().optional()
	}).optional(),
	latestCheckpointAt: z.string().optional(),
	lastResumedAt: z.string().optional()
})), z.null()]);
/**
* Install Swarm only for root agents published after this plugin loads.
* @param ctx - global service context.
* @param config - deployment config (provider, default model).
*/
function apply(ctx, config = {}) {
	if (config.enabled === false) {
		if (config.keepEventVocabularyWhenDisabled === true) ctx.effect(() => registerSwarmEventTypes(), "dsh-swarm-panel.event-vocabulary()");
		return;
	}
	const provider = config.provider ?? "spawn";
	const turnTimeoutMs = resolveTurnTimeout(config);
	const checkpointFrequency = resolveCheckpointFrequency(config);
	const humanInputMode = resolveHumanInputMode(config);
	const chatDefaults = resolveChatDefaults(config);
	const memoryDefaults = resolveMemoryDefaults(config);
	const owners = /* @__PURE__ */ new Map();
	let stopping = false;
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		projectionCtx.sessionProjections.register({
			key: "swarm",
			stateSchema: swarmPanelModelSchema,
			init: () => null,
			apply: applySwarmPanelEvent,
			wire: {
				viewSchema: swarmPanelModelSchema,
				view: (state) => state
			},
			stateVersion: 2
		});
	});
	ctx.effect(() => {
		const unregisterEventTypes = registerSwarmEventTypes();
		const stopCreated = ctx.on("agent/created", ({ agent }) => {
			if (stopping || owners.has(agent) || !ctx.agents.roots().includes(agent)) return;
			const runtimes = /* @__PURE__ */ new Map();
			const defaultModel = config.defaultModel;
			const runtimeConfig = {
				provider,
				humanInputMode,
				chat: chatDefaults,
				memory: memoryDefaults,
				turnTimeoutMs,
				...defaultModel !== void 0 && (defaultModel.provider !== void 0 || defaultModel.model !== void 0) ? { defaultModel: {
					...defaultModel.provider !== void 0 ? { provider: defaultModel.provider } : {},
					...defaultModel.model !== void 0 ? { model: defaultModel.model } : {}
				} } : {}
			};
			const cleanup = agent.ctx.effect(() => {
				const disposeTools = registerSwarmTools(ctx, agent.ctx, agent, runtimes, runtimeConfig);
				const pendingResume = hydrateSwarmRuntimes(ctx, agent, runtimes, runtimeConfig);
				const resumeController = pendingResume.length > 0 ? new AbortController() : void 0;
				if (resumeController !== void 0) {
					const signal = resumeController.signal;
					(async () => {
						for (const swarmId of pendingResume) {
							const runtime = runtimes.get(swarmId);
							if (runtime === void 0) continue;
							await reactivateSwarmRoles(runtime, agent, signal);
						}
					})().catch((error) => {
						if (!signal.aborted && !stopping) ctx.logger.warn(`dsh-swarm-panel: cold resume failed for agent "${agent.id}": ` + (error instanceof Error ? error.message : String(error)));
					});
				}
				const stopStatus = agent.ctx.on("agent/status", ({ status }) => {
					if (status !== "idle") return;
					for (const runtime of runtimes.values()) if (runtime.needsCheckpoint(checkpointFrequency)) runtime.saveCheckpoint(checkpointFrequency === "per_turn" ? "per_turn" : "auto");
				});
				return async () => {
					stopStatus();
					resumeController?.abort();
					disposeTools();
					for (const runtime of runtimes.values()) runtime.dispose();
					runtimes.clear();
				};
			}, "dsh-swarm-panel.runtime()");
			owners.set(agent, cleanup);
		});
		return async () => {
			stopping = true;
			stopCreated();
			const cleanups = [...owners.values()];
			owners.clear();
			await Promise.allSettled(cleanups.map((cleanup) => Promise.resolve(cleanup())));
			unregisterEventTypes();
		};
	}, "dsh-swarm-panel.lifecycle()");
}
//#endregion
export { EngineError, RoleTurnError, SwarmId, SwarmRuntime, apply, applySwarmPanelEvent, collectSwarmIds, completedRounds, foldSwarmEvents, hydrateSwarmRuntimes, inboundMessages, inject, isValidRoleName, latestCheckpointAt, name, queryMemories, reactivateSwarmRoles, registerSwarmTools, runChatTurns, scoreMemory, selectNextSpeaker, tokenize };

//# sourceMappingURL=index.js.map