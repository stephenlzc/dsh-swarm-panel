window.__ModuleLoader__.load({
	id: "dsh-swarm-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/flow-model.ts
		/** Four-state role status the topology strip and lane headers render. */
		function roleVisualState(args) {
			if (args.name === "human") return "idle";
			if (args.name === "orchestrator") return args.terminated === true ? "completed" : "active";
			const role = args.role;
			if (role === void 0) return "idle";
			if (role.status === "running") return "active";
			if (role.outcome === "error") return "error";
			return "completed";
		}
		/** Visible status word. Human pending HITL is Idle · Waiting, not a fifth color. */
		function roleVisualLabel(state, waiting = false) {
			if (state === "active") return "Active";
			if (state === "error") return "Error";
			if (state === "completed") return "Completed";
			return waiting ? "Idle · Waiting" : "Idle";
		}
		/** Host-token color for a visual state. Fallbacks keep AA contrast on the light canvas. */
		function roleStateColor(state) {
			if (state === "active") return "var(--dsw-alias-state-success-primary)";
			if (state === "idle") return "var(--dsw-alias-state-warn-label)";
			if (state === "error") return "var(--dsw-alias-state-error-primary)";
			return "var(--dsw-alias-label-tertiary)";
		}
		/** How a lane relates to the orchestrator. */
		function relationKind(name) {
			if (name === "orchestrator") return "parent";
			if (name === "human") return "operator";
			return "child";
		}
		/** Visible participant label; empty names stay inspectable. */
		function participantName(value) {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : "unknown";
		}
		/** Clock time for a stored timestamp; unparseable values render as written. */
		function formatClock(value) {
			if (value.length === 0) return "unknown time";
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) return value;
			return date.toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				hour12: false
			});
		}
		/**
		* UTC-offset label of the `UTC-7` kind for a timestamp (or the local zone
		* when `value` is empty / unparseable).
		*/
		function formatUtcOffset(value) {
			const date = value !== void 0 && value.length > 0 ? new Date(value) : /* @__PURE__ */ new Date();
			const minutes = -(Number.isNaN(date.getTime()) ? /* @__PURE__ */ new Date() : date).getTimezoneOffset();
			const sign = minutes >= 0 ? "+" : "-";
			const abs = Math.abs(minutes);
			const hours = Math.floor(abs / 60);
			const rest = abs % 60;
			return rest === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(rest).padStart(2, "0")}`;
		}
		/** Footer duration between two RFC 3339 instants (`HH:MM:SS`). */
		function formatDuration(start, end) {
			const from = new Date(start).getTime();
			const to = new Date(end).getTime();
			if (Number.isNaN(from) || Number.isNaN(to)) return "—";
			const seconds = Math.max(0, Math.floor((to - from) / 1e3));
			return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
		}
		/** Per-message route used by badges, filters, and connector stroke. */
		function routeFor(message) {
			if (message.to === "group") return "group";
			return message.attribution === "peer" ? "peer" : "parent-child";
		}
		/** Visible route badge copy. Color is never the only distinguisher. */
		function routeLabel(route) {
			if (route === "peer") return "peer ↔ peer";
			if (route === "group") return "group";
			return "parent → child";
		}
		/** Kind chip for the message card. */
		function messageKind(message) {
			if (message.from === "human" || message.to === "human") return "human";
			if (message.to === "group") return "group";
			return "direct";
		}
		function filterLabel(filter) {
			if (filter === "parent") return "Parent → Child";
			if (filter === "peer") return "Peer ↔ Peer";
			if (filter === "group") return "Mixed / System";
			if (filter === "human") return "Human input";
			return "All messages";
		}
		function filterMatch(message, filter) {
			if (filter === "all") return true;
			if (filter === "parent") return routeFor(message) === "parent-child";
			if (filter === "peer") return routeFor(message) === "peer";
			if (filter === "group") return routeFor(message) === "group";
			return message.from === "human" || message.to === "human";
		}
		function countFor(messages, filter) {
			return messages.filter((message) => filterMatch(message, filter)).length;
		}
		function matches(message, filter, query, agent) {
			if (!filterMatch(message, filter)) return false;
			if (agent !== "all" && participantName(message.from) !== agent && participantName(message.to) !== agent) return false;
			const needle = query.trim().toLowerCase();
			if (needle.length === 0) return true;
			return `${message.from} ${message.to} ${message.content}`.toLowerCase().includes(needle);
		}
		function openableRole(swarm, name) {
			return swarm.roles.find((role) => role.roleName === name);
		}
		/** Stable swimlane order: orchestrator, spawn order, extras, Human last. */
		function lanesFor(swarm, messages) {
			const ordered = ["orchestrator", ...swarm.roles.map((role) => role.roleName)];
			const extras = /* @__PURE__ */ new Set();
			for (const message of messages) {
				const from = participantName(message.from);
				const to = participantName(message.to);
				if (from !== "group" && from !== "human" && !ordered.includes(from)) extras.add(from);
				if (to !== "group" && to !== "human" && !ordered.includes(to)) extras.add(to);
			}
			const rest = [...extras].sort();
			return [
				...ordered,
				...rest,
				"human"
			];
		}
		/** Canvas grid: a time gutter plus one column per agent path. */
		function canvasColumns(laneCount) {
			return `76px repeat(${laneCount}, minmax(${laneCount > 5 ? "clamp(92px, 11vw, 132px)" : "132px"}, 1fr))`;
		}
		function topologyArrow(mode) {
			if (mode === "peer") return "↔";
			if (mode === "mixed") return "⇆";
			return "→";
		}
		function routeDistribution(messages) {
			return `parent-child ${messages.filter((message) => routeFor(message) === "parent-child").length} · peer ${messages.filter((message) => routeFor(message) === "peer").length} · group ${messages.filter((message) => routeFor(message) === "group").length}`;
		}
		/** First line of a message, used as the card title in the speaker's lane. */
		function messageParts(message) {
			const line = message.content.trim().split("\n")[0] ?? "";
			if (line.length === 0) return {
				title: `${participantName(message.from)} → ${participantName(message.to)}`,
				preview: "(empty message)"
			};
			const separator = line.search(/\s+[—–]\s+/);
			if (separator > 0) {
				const title = line.slice(0, separator).trim();
				const preview = line.slice(separator).replace(/^\s+[—–]\s+/, "").trim();
				return {
					title: title.length > 72 ? `${title.slice(0, 69)}...` : title,
					preview: preview.length > 0 ? preview : line
				};
			}
			return {
				title: `${participantName(message.from)} → ${participantName(message.to)}`,
				preview: line
			};
		}
		/**
		* SVG path in a `0 0 laneCount 1` viewBox: sender-column exit, vertical jog,
		* receiver-column entry. Empty when from and to share a lane.
		*/
		function elbowPath(fromIdx, toIdx) {
			if (fromIdx === toIdx) return "";
			const rightward = fromIdx < toIdx;
			const x1 = fromIdx + (rightward ? .88 : .12);
			const x2 = toIdx + (rightward ? .12 : .88);
			const y1 = .36;
			const y2 = .64;
			const mid = (x1 + x2) / 2;
			return `M ${x1.toFixed(3)} ${y1} H ${mid.toFixed(3)} V ${y2} H ${x2.toFixed(3)}`;
		}
		function connectorDash(route) {
			if (route === "peer") return "5 4";
			if (route === "group") return "2 3";
		}
		function unavailableReason(name, role) {
			if (name === "orchestrator") return "The orchestrator is the current session.";
			if (name === "human") return "Human input has no child session.";
			if (name === "group") return "Group messages have no single recipient session.";
			if (role === void 0) return `No child session for ${name}.`;
			return "";
		}
		function metadataPayload(message) {
			return JSON.stringify({
				seq: message.seq,
				from: message.from,
				to: message.to,
				senderSessionId: message.senderSessionId,
				sentAt: message.sentAt,
				attribution: message.attribution,
				route: routeFor(message)
			}, null, 2);
		}
		const EMPTY_NO_SWARM = "No swarm in this session. Ask the Orchestrator to create one and spawn roles.";
		const EMPTY_WAITING_PROJECTION = "Waiting for swarm projection.";
		const EMPTY_PROJECTION_ERROR = "Swarm projection error.";
		const EMPTY_NO_MESSAGES = "No messages recorded for this swarm yet.";
		const EMPTY_NO_MATCH = "No matching messages. Clear filters to see the full flow.";
		const EMPTY_TERMINATED = "This swarm has terminated and recorded no messages.";
		const EMPTY_PENDING_HITL = "Waiting for human input. Pending HITL is shown in the Human lane.";
		/** Empty-canvas copy. Projection error and waiting outrank swarm emptiness. */
		function emptyStateCopy(args) {
			if (args.projectionError !== void 0 && args.projectionError.length > 0) return `${EMPTY_PROJECTION_ERROR} ${args.projectionError}`.trim();
			if (args.waiting === true) return EMPTY_WAITING_PROJECTION;
			if (!args.hasSwarm) return EMPTY_NO_SWARM;
			if (args.filteredActive) return EMPTY_NO_MATCH;
			if (args.terminated && args.messageCount === 0) return EMPTY_TERMINATED;
			if (args.pendingHitl > 0 && args.messageCount === 0) return EMPTY_PENDING_HITL;
			if (args.messageCount === 0) return EMPTY_NO_MESSAGES;
			return EMPTY_NO_MATCH;
		}
		function laneVisual(swarm, name) {
			const role = openableRole(swarm, name);
			const waiting = name === "human" && swarm.pendingHitl.length > 0;
			const state = roleVisualState({
				name,
				terminated: swarm.terminated,
				pendingHitl: waiting,
				...role !== void 0 ? { role } : {}
			});
			return {
				state,
				label: roleVisualLabel(state, waiting),
				waiting,
				role
			};
		}
		function visibleHitl(pending, filter, agent, query = "") {
			if (pending.length === 0) return [];
			if (filter !== "all" && filter !== "human") return [];
			if (agent !== "all" && agent !== "human") return [];
			const needle = query.trim().toLowerCase();
			if (needle.length === 0) return pending;
			return pending.filter((item) => item.question.toLowerCase().includes(needle));
		}
		//#endregion
		//#region src/client/SwarmAction.ts
		/**
		* Swarm panel, browser half: the session-header Conversation Flow view over
		* the `swarm` projection. It keeps the host event log authoritative and uses
		* local state only for filters, selection, details, and live-follow behavior.
		*
		* @module dsh-swarm-panel/client
		*/
		const T = {
			bg: "var(--dsw-alias-bg-layer-1)",
			overlay: "var(--dsw-alias-bg-overlay)",
			secondary: "var(--dsw-alias-bg-secondary, var(--dsw-alias-bg-layer-1))",
			selected: "var(--dsw-alias-bg-selected, var(--dsw-alias-interactive-bg-active))",
			border: "var(--dsw-alias-border-l2)",
			borderSoft: "var(--dsw-alias-border-l1)",
			text: "var(--dsw-alias-label-primary)",
			muted: "var(--dsw-alias-label-secondary)",
			tertiary: "var(--dsw-alias-label-tertiary)",
			interactive: "var(--dsw-alias-interactive-bg-active)",
			hover: "var(--dsw-alias-interactive-bg-hover)",
			success: "var(--dsw-alias-state-success-primary)",
			warn: "var(--dsw-alias-state-warn-label)",
			warnBg: "var(--dsw-alias-state-warn-tertiary)",
			error: "var(--dsw-alias-state-error-primary)",
			business: "var(--dsw-alias-state-business-primary)",
			businessBg: "var(--dsw-alias-state-business-tertiary)"
		};
		const styles = {
			root: {
				position: "relative",
				display: "inline-block"
			},
			trigger: {
				border: `1px solid ${T.border}`,
				borderRadius: "6px",
				background: "transparent",
				color: "inherit",
				padding: "2px 8px",
				fontSize: "12px",
				lineHeight: 1.4
			},
			page: {
				display: "flex",
				flexDirection: "column",
				height: "100%",
				minHeight: 0,
				width: "100%",
				boxSizing: "border-box",
				padding: "12px 16px",
				gap: "10px",
				overflow: "hidden",
				background: T.bg,
				color: T.text,
				fontSize: "12px",
				lineHeight: 1.45
			},
			legend: {
				display: "grid",
				gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
				gap: "16px",
				flexShrink: 0,
				padding: "10px 12px",
				border: `1px solid ${T.border}`,
				borderRadius: "10px",
				background: T.overlay,
				minWidth: "260px",
				boxSizing: "border-box"
			},
			overview: {
				display: "grid",
				gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
				gap: "10px",
				minWidth: 0,
				flexShrink: 0
			},
			topologyCard: {
				minWidth: 0,
				padding: "10px 12px",
				border: `1px solid ${T.border}`,
				borderRadius: "10px",
				background: T.overlay
			},
			sectionTitle: {
				fontWeight: 650,
				marginBottom: "8px",
				fontSize: "12px"
			},
			legendRow: {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				marginTop: "5px"
			},
			header: {
				display: "flex",
				justifyContent: "space-between",
				gap: "12px",
				alignItems: "flex-start",
				flexShrink: 0
			},
			heading: {
				fontWeight: 650,
				fontSize: "14px"
			},
			muted: { color: T.muted },
			topologyRow: {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				overflowX: "auto",
				flexWrap: "wrap"
			},
			roleCard: {
				display: "inline-flex",
				alignItems: "center",
				gap: "8px",
				padding: "8px 10px",
				border: `1px solid ${T.border}`,
				borderRadius: "10px",
				background: T.overlay,
				color: "inherit",
				minWidth: "132px",
				textAlign: "left"
			},
			roleCardButton: {
				display: "inline-flex",
				alignItems: "center",
				gap: "8px",
				padding: "8px 10px",
				border: `1px solid ${T.border}`,
				borderRadius: "10px",
				background: T.overlay,
				color: "inherit",
				cursor: "pointer",
				fontSize: "12px",
				minWidth: "132px",
				textAlign: "left"
			},
			toolbar: {
				display: "flex",
				alignItems: "center",
				gap: "6px",
				flexWrap: "wrap",
				flexShrink: 0
			},
			filter: {
				borderWidth: 1,
				borderStyle: "solid",
				borderColor: T.border,
				borderRadius: "999px",
				background: T.overlay,
				color: "inherit",
				padding: "5px 10px",
				cursor: "pointer",
				fontSize: "12px",
				lineHeight: 1.4
			},
			filterActive: {
				background: T.interactive,
				borderColor: T.business,
				color: T.text
			},
			body: {
				display: "flex",
				gap: "10px",
				minHeight: 0,
				minWidth: 0,
				flex: "1 1 auto",
				overflow: "hidden",
				flexWrap: "wrap"
			},
			flow: {
				flex: "1 1 420px",
				minWidth: 0,
				minHeight: 0,
				display: "flex",
				flexDirection: "column",
				border: `1px solid ${T.border}`,
				borderRadius: "8px",
				overflow: "hidden",
				background: T.overlay
			},
			laneHeader: {
				display: "grid",
				gap: 0,
				background: T.overlay,
				borderBottom: `1px solid ${T.border}`,
				flexShrink: 0
			},
			lane: {
				minWidth: 0,
				padding: "8px 8px 6px",
				borderLeft: `1px solid ${T.borderSoft}`,
				background: T.overlay,
				textAlign: "left",
				overflow: "hidden"
			},
			laneButton: {
				minWidth: 0,
				padding: "8px 8px 6px",
				border: 0,
				borderLeft: `1px solid ${T.borderSoft}`,
				background: T.overlay,
				color: "inherit",
				cursor: "pointer",
				fontSize: "12px",
				textAlign: "left",
				overflow: "hidden"
			},
			scroller: {
				flex: "1 1 auto",
				overflow: "auto",
				minHeight: 0,
				position: "relative"
			},
			time: {
				color: T.muted,
				fontVariantNumeric: "tabular-nums",
				fontSize: "12px",
				lineHeight: 1.35,
				padding: "8px 6px"
			},
			row: {
				display: "grid",
				gap: 0,
				alignItems: "stretch",
				position: "relative",
				minHeight: "64px",
				borderBottom: `1px solid ${T.borderSoft}`
			},
			rowSelected: {
				background: T.selected,
				boxShadow: `inset 3px 0 ${T.business}`
			},
			card: {
				minWidth: 0,
				zIndex: 1,
				margin: "8px 8px 8px 6px",
				padding: "6px 8px",
				border: `1px solid ${T.border}`,
				borderRadius: "8px",
				background: T.overlay,
				boxShadow: "0 1px 0 var(--dsw-alias-border-l1)"
			},
			cardTitle: {
				display: "flex",
				justifyContent: "space-between",
				gap: "6px",
				fontWeight: 600,
				minWidth: 0,
				alignItems: "center"
			},
			cardHeading: {
				minWidth: 0,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			preview: {
				marginTop: "2px",
				overflow: "hidden",
				display: "-webkit-box",
				WebkitLineClamp: 2,
				WebkitBoxOrient: "vertical",
				color: T.muted,
				lineHeight: 1.35
			},
			badge: {
				display: "inline-block",
				fontSize: "11px",
				lineHeight: 1.3,
				borderRadius: "4px",
				padding: "1px 5px",
				background: T.businessBg,
				color: T.business,
				whiteSpace: "nowrap",
				flex: "0 0 auto"
			},
			empty: {
				padding: "42px 16px",
				textAlign: "center",
				color: T.muted
			},
			details: {
				flex: "1 1 240px",
				maxWidth: "320px",
				display: "flex",
				flexDirection: "column",
				border: `1px solid ${T.border}`,
				borderRadius: "8px",
				padding: "12px",
				minWidth: "220px",
				overflow: "auto",
				background: T.overlay,
				gap: "10px"
			},
			detailBlock: {
				display: "flex",
				flexDirection: "column",
				gap: "2px"
			},
			detailLabel: {
				color: T.muted,
				fontSize: "11px",
				lineHeight: 1.4
			},
			detailValue: {
				minWidth: 0,
				wordBreak: "break-word"
			},
			detailPreview: {
				padding: "8px",
				background: T.secondary,
				borderRadius: "6px",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				maxHeight: "160px",
				overflow: "auto"
			},
			smallButton: {
				border: `1px solid ${T.border}`,
				borderRadius: "6px",
				background: T.overlay,
				color: "inherit",
				padding: "4px 8px",
				cursor: "pointer",
				fontSize: "12px",
				lineHeight: 1.4
			},
			smallButtonDisabled: {
				opacity: .55,
				cursor: "not-allowed"
			},
			hitl: {
				margin: "8px 6px",
				padding: "8px",
				borderRadius: "8px",
				background: T.warnBg,
				color: T.warn,
				border: `1px solid ${T.warn}`,
				cursor: "pointer",
				textAlign: "left",
				width: "calc(100% - 12px)",
				fontSize: "12px",
				lineHeight: 1.4
			},
			liveBanner: {
				margin: "0 0 8px",
				width: "100%",
				border: `1px solid ${T.business}`,
				borderRadius: "6px",
				background: T.businessBg,
				color: T.text,
				padding: "6px 8px",
				cursor: "pointer",
				fontSize: "12px"
			},
			footer: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "12px",
				flexWrap: "wrap",
				flexShrink: 0,
				paddingTop: "4px"
			},
			footerStats: {
				display: "flex",
				gap: "14px",
				flexWrap: "wrap",
				color: T.muted
			}
		};
		function badgeStyle(route) {
			if (route === "peer") return {
				...styles.badge,
				background: "var(--dsw-alias-interactive-bg-active)",
				color: T.text
			};
			if (route === "group") return {
				...styles.badge,
				background: "var(--dsw-alias-state-success-tertiary)",
				color: T.success
			};
			if (route === "human") return {
				...styles.badge,
				background: T.warnBg,
				color: T.warn
			};
			return styles.badge;
		}
		async function copyText(text) {
			try {
				await navigator.clipboard.writeText(text);
			} catch (error) {}
		}
		function StatusDot({ state }) {
			return (0, react.createElement)("span", {
				"aria-hidden": true,
				"data-role-state": state,
				style: {
					width: "8px",
					height: "8px",
					borderRadius: "50%",
					flex: "0 0 auto",
					background: roleStateColor(state)
				}
			});
		}
		function RoleGlyph({ name, state }) {
			const fill = roleStateColor(state === "completed" ? "idle" : state === "error" ? "error" : "active");
			const mark = name === "orchestrator" ? "M12 7 a3 3 0 1 0 0.01 0 M7 18 c0-3 10-3 10 0" : name === "human" ? "M12 8 a2.5 2.5 0 1 0 0.01 0 M8 17 c0-2.4 8-2.4 8 0" : "M9 9 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M7 18 c2-3 8-3 10 0";
			return (0, react.createElement)("svg", {
				width: 28,
				height: 28,
				viewBox: "0 0 24 24",
				"aria-hidden": true,
				style: { flex: "0 0 auto" }
			}, (0, react.createElement)("circle", {
				cx: 12,
				cy: 12,
				r: 11,
				fill: "var(--dsw-alias-state-business-tertiary)",
				stroke: fill,
				strokeWidth: 1.4
			}), (0, react.createElement)("path", {
				d: mark,
				fill: "none",
				stroke: fill,
				strokeWidth: 1.6,
				strokeLinecap: "round"
			}));
		}
		function RoleIdentity({ name, kind, state, waiting }) {
			return (0, react.createElement)("span", { style: {
				display: "flex",
				flexDirection: "column",
				minWidth: 0
			} }, (0, react.createElement)("span", { style: {
				fontWeight: 650,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			} }, name), (0, react.createElement)("span", { style: {
				...styles.muted,
				display: "inline-flex",
				alignItems: "center",
				gap: "5px"
			} }, (0, react.createElement)(StatusDot, { state }), (0, react.createElement)("span", {}, `${kind} · ${roleVisualLabel(state, waiting)}`)));
		}
		function ElbowConnector({ seq, fromIdx, toIdx, route, laneCount }) {
			const d = elbowPath(fromIdx, toIdx);
			if (d.length === 0) return null;
			const dash = connectorDash(route);
			const markerId = `flow-arrow-${seq}`;
			return (0, react.createElement)("svg", {
				"data-flow-connector": "elbow",
				"data-flow-route": route,
				viewBox: `0 0 ${laneCount} 1`,
				preserveAspectRatio: "none",
				"aria-hidden": true,
				style: {
					position: "absolute",
					left: "76px",
					right: 0,
					top: 0,
					bottom: 0,
					zIndex: 0,
					pointerEvents: "none",
					color: T.business,
					overflow: "hidden"
				}
			}, (0, react.createElement)("defs", {}, (0, react.createElement)("marker", {
				id: markerId,
				viewBox: "0 0 10 10",
				refX: 9,
				refY: 5,
				markerWidth: 6,
				markerHeight: 6,
				orient: "auto",
				markerUnits: "strokeWidth"
			}, (0, react.createElement)("path", {
				d: "M 0 0 L 10 5 L 0 10 z",
				fill: "currentColor"
			}))), (0, react.createElement)("path", {
				d,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.75,
				vectorEffect: "non-scaling-stroke",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				...dash !== void 0 ? { strokeDasharray: dash } : {},
				markerEnd: `url(#${markerId})`
			}));
		}
		function MessageDetails({ swarm, message, onOpenSession, onClose }) {
			const [copied, setCopied] = (0, react.useState)();
			(0, react.useEffect)(() => {
				if (copied === void 0) return void 0;
				const id = window.setTimeout(() => {
					setCopied(void 0);
				}, 1500);
				return () => {
					window.clearTimeout(id);
				};
			}, [copied]);
			if (message === void 0) return (0, react.createElement)("aside", {
				style: styles.details,
				"aria-label": "message details"
			}, (0, react.createElement)("div", { style: { fontWeight: 650 } }, "Message details"), (0, react.createElement)("p", { style: styles.muted }, "Select a message to inspect routing, content, and sessions."));
			const route = routeFor(message);
			const sender = openableRole(swarm, message.from);
			const recipient = openableRole(swarm, message.to);
			const senderName = participantName(message.from);
			const recipientName = participantName(message.to);
			const senderReason = unavailableReason(senderName, sender);
			const recipientReason = unavailableReason(recipientName, recipient);
			const markCopied = (kind) => {
				setCopied(kind);
			};
			return (0, react.createElement)("aside", {
				style: styles.details,
				"aria-label": "message details"
			}, (0, react.createElement)("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				gap: "8px",
				alignItems: "center"
			} }, (0, react.createElement)("span", { style: { fontWeight: 650 } }, "Message details"), (0, react.createElement)("button", {
				type: "button",
				style: styles.smallButton,
				"aria-label": "Close message details",
				onClick: onClose
			}, "Close")), (0, react.createElement)("div", { style: {
				display: "flex",
				gap: "6px",
				flexWrap: "wrap",
				alignItems: "center"
			} }, (0, react.createElement)("span", { style: badgeStyle(route) }, routeLabel(route)), (0, react.createElement)("span", { style: styles.muted }, `#${message.seq}`)), (0, react.createElement)("div", { style: styles.detailBlock }, (0, react.createElement)("span", { style: styles.detailLabel }, "From"), (0, react.createElement)("span", {
				style: styles.detailValue,
				title: message.from
			}, `${senderName} (${relationKind(senderName)})`)), (0, react.createElement)("div", {
				style: {
					color: T.muted,
					paddingLeft: "4px"
				},
				"aria-hidden": true
			}, "↓"), (0, react.createElement)("div", { style: styles.detailBlock }, (0, react.createElement)("span", { style: styles.detailLabel }, "To"), (0, react.createElement)("span", {
				style: styles.detailValue,
				title: message.to
			}, `${recipientName} (${relationKind(recipientName)})`)), (0, react.createElement)("div", { style: styles.detailBlock }, (0, react.createElement)("span", { style: styles.detailLabel }, "Route"), (0, react.createElement)("span", { style: styles.detailValue }, routeLabel(route))), (0, react.createElement)("div", { style: styles.detailBlock }, (0, react.createElement)("span", { style: styles.detailLabel }, "Status"), (0, react.createElement)("span", { style: styles.detailValue }, "Recorded")), (0, react.createElement)("div", { style: styles.detailBlock }, (0, react.createElement)("span", { style: styles.detailLabel }, "Attribution"), (0, react.createElement)("span", { style: styles.detailValue }, message.attribution)), (0, react.createElement)("div", { style: styles.detailBlock }, (0, react.createElement)("span", { style: styles.detailLabel }, "Time"), (0, react.createElement)("span", {
				style: styles.detailValue,
				title: message.sentAt
			}, `${formatClock(message.sentAt)} ${formatUtcOffset(message.sentAt)}`)), (0, react.createElement)("div", { style: styles.detailBlock }, (0, react.createElement)("span", { style: styles.detailLabel }, "Sender session"), (0, react.createElement)("span", {
				style: styles.detailValue,
				title: message.senderSessionId
			}, message.senderSessionId.length > 0 ? message.senderSessionId : "unavailable")), (0, react.createElement)("div", { style: styles.detailBlock }, (0, react.createElement)("span", { style: styles.detailLabel }, "Content preview"), (0, react.createElement)("div", {
				style: styles.detailPreview,
				title: message.content
			}, message.content.length > 0 ? message.content : "(empty message)")), (0, react.createElement)("div", { style: {
				display: "flex",
				flexWrap: "wrap",
				gap: "5px"
			} }, (0, react.createElement)("button", {
				type: "button",
				style: styles.smallButton,
				onClick: () => {
					copyText(String(message.seq)).then(() => {
						markCopied("id");
					});
				}
			}, copied === "id" ? "Copied ID" : "Copy ID"), (0, react.createElement)("button", {
				type: "button",
				style: styles.smallButton,
				onClick: () => {
					copyText(message.content).then(() => {
						markCopied("message");
					});
				}
			}, copied === "message" ? "Copied message" : "Copy message"), (0, react.createElement)("button", {
				type: "button",
				style: styles.smallButton,
				onClick: () => {
					copyText(metadataPayload(message)).then(() => {
						markCopied("metadata");
					});
				}
			}, copied === "metadata" ? "Copied metadata" : "Copy event metadata"), (0, react.createElement)("button", {
				type: "button",
				style: sender === void 0 ? {
					...styles.smallButton,
					...styles.smallButtonDisabled
				} : styles.smallButton,
				disabled: sender === void 0,
				title: senderReason,
				onClick: () => {
					if (sender !== void 0) onOpenSession(sender.childId);
				}
			}, `Open ${senderName} session`), (0, react.createElement)("button", {
				type: "button",
				style: recipient === void 0 ? {
					...styles.smallButton,
					...styles.smallButtonDisabled
				} : styles.smallButton,
				disabled: recipient === void 0,
				title: recipientReason,
				onClick: () => {
					if (recipient !== void 0) onOpenSession(recipient.childId);
				}
			}, `Open ${recipientName} session`)));
		}
		function FlowMessageRow({ message, lanes, selected, onSelect }) {
			const route = routeFor(message);
			const kind = messageKind(message);
			const columns = canvasColumns(lanes.length);
			const activate = (event) => {
				if (event.key !== void 0 && event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault?.();
				onSelect(message.seq);
			};
			const rowStyle = {
				...styles.row,
				gridTemplateColumns: columns,
				...selected ? styles.rowSelected : {}
			};
			const timeCell = (0, react.createElement)("div", {
				style: {
					...styles.time,
					gridColumn: 1,
					gridRow: 1,
					zIndex: 1
				},
				"data-utc-offset": formatUtcOffset(message.sentAt)
			}, (0, react.createElement)("div", {}, formatClock(message.sentAt)), (0, react.createElement)("div", { style: { color: T.tertiary } }, formatUtcOffset(message.sentAt)));
			const parts = messageParts(message);
			const laneCells = lanes.map((name, index) => (0, react.createElement)("div", {
				key: `grid-${name}`,
				"aria-hidden": true,
				style: {
					gridColumn: index + 2,
					gridRow: 1,
					borderLeft: `1px solid ${T.borderSoft}`
				}
			}));
			if (message.to === "group") {
				const fromIdx = Math.max(0, lanes.indexOf(participantName(message.from)));
				return (0, react.createElement)("div", {
					id: `flow-msg-${message.seq}`,
					style: rowStyle,
					role: "option",
					tabIndex: selected ? 0 : -1,
					"aria-selected": selected,
					"data-flow-seq": message.seq,
					"data-flow-route": route,
					"data-flow-from": participantName(message.from),
					onClick: () => {
						onSelect(message.seq);
					},
					onKeyDown: activate
				}, timeCell, ...laneCells, (0, react.createElement)(ElbowConnector, {
					seq: message.seq,
					fromIdx,
					toIdx: Math.min(fromIdx + 1, lanes.length - 1),
					route,
					laneCount: lanes.length
				}), (0, react.createElement)("div", { style: {
					...styles.card,
					gridColumn: fromIdx + 2,
					gridRow: 1,
					borderStyle: "dashed"
				} }, (0, react.createElement)("div", { style: styles.cardTitle }, (0, react.createElement)("span", {
					style: styles.cardHeading,
					title: message.from
				}, `${participantName(message.from)} → group`), (0, react.createElement)("span", { style: badgeStyle(route) }, routeLabel(route))), (0, react.createElement)("div", {
					style: styles.preview,
					title: message.content
				}, parts.preview), (0, react.createElement)("div", { style: {
					...styles.muted,
					marginTop: "2px"
				} }, `ID: ${message.seq}`)));
			}
			const fromIdx = Math.max(0, lanes.indexOf(participantName(message.from)));
			const toIdx = Math.max(0, lanes.indexOf(participantName(message.to)));
			return (0, react.createElement)("div", {
				id: `flow-msg-${message.seq}`,
				style: rowStyle,
				role: "option",
				tabIndex: selected ? 0 : -1,
				"aria-selected": selected,
				"data-flow-seq": message.seq,
				"data-flow-route": route,
				"data-flow-from": participantName(message.from),
				onClick: () => {
					onSelect(message.seq);
				},
				onKeyDown: activate
			}, timeCell, ...laneCells, (0, react.createElement)(ElbowConnector, {
				seq: message.seq,
				fromIdx,
				toIdx,
				route,
				laneCount: lanes.length
			}), (0, react.createElement)("div", { style: {
				...styles.card,
				gridColumn: fromIdx + 2,
				gridRow: 1
			} }, (0, react.createElement)("div", { style: styles.cardTitle }, (0, react.createElement)("span", {
				style: styles.cardHeading,
				title: message.content
			}, parts.title), (0, react.createElement)("span", { style: badgeStyle(kind === "human" ? "human" : route) }, kind === "human" ? "human" : routeLabel(route))), (0, react.createElement)("div", {
				style: styles.preview,
				title: message.content
			}, parts.preview), (0, react.createElement)("div", { style: {
				...styles.muted,
				marginTop: "2px"
			} }, `ID: ${message.seq}`)));
		}
		function HitlRow({ pending, lanes, sessionId, onOpenSession }) {
			const humanIdx = Math.max(0, lanes.indexOf("human"));
			const openable = sessionId !== void 0 && sessionId.length > 0;
			const activate = () => {
				if (openable) onOpenSession(sessionId);
			};
			return (0, react.createElement)("div", {
				style: {
					...styles.row,
					gridTemplateColumns: canvasColumns(lanes.length)
				},
				"data-flow-hitl": pending.requestId
			}, (0, react.createElement)("div", { style: {
				...styles.time,
				gridColumn: 1
			} }, (0, react.createElement)("div", {}, formatClock(pending.requestedAt)), (0, react.createElement)("div", { style: { color: T.tertiary } }, formatUtcOffset(pending.requestedAt))), ...lanes.map((name, index) => (0, react.createElement)("div", {
				key: `hitl-grid-${name}`,
				"aria-hidden": true,
				style: {
					gridColumn: index + 2,
					gridRow: 1,
					borderLeft: `1px solid ${T.borderSoft}`
				}
			})), (0, react.createElement)("button", {
				type: "button",
				style: {
					...styles.hitl,
					gridColumn: humanIdx + 2,
					zIndex: 1
				},
				title: pending.question,
				"aria-label": `Human input pending: ${pending.question}`,
				disabled: !openable,
				onClick: activate
			}, (0, react.createElement)("div", { style: styles.cardTitle }, (0, react.createElement)("span", {}, "Human input required"), (0, react.createElement)("span", { style: badgeStyle("human") }, "Pending")), (0, react.createElement)("div", { style: { marginTop: "4px" } }, pending.question)));
		}
		function SwarmFlowView({ swarm, onOpenSession, sessionId }) {
			const messages = swarm.flow ?? [];
			const [filter, setFilter] = (0, react.useState)("all");
			const [query, setQuery] = (0, react.useState)("");
			const [agent, setAgent] = (0, react.useState)("all");
			const [selectedSeq, setSelectedSeq] = (0, react.useState)();
			const [live, setLive] = (0, react.useState)(true);
			const [pendingNew, setPendingNew] = (0, react.useState)(0);
			const scrollerRef = (0, react.useRef)(null);
			const collectionRef = (0, react.useRef)(null);
			const knownCountRef = (0, react.useRef)(messages.length);
			(0, react.useEffect)(() => {
				const previous = knownCountRef.current;
				const delta = Math.max(0, messages.length - previous);
				knownCountRef.current = messages.length;
				if (live) setPendingNew(0);
				else if (delta > 0) setPendingNew((count) => count + delta);
			}, [messages.length, live]);
			(0, react.useEffect)(() => {
				if (!live) return;
				const node = scrollerRef.current;
				if (node === null) return;
				node.scrollTop = node.scrollHeight;
			}, [
				messages.length,
				live,
				filter,
				query,
				agent
			]);
			const filtered = messages.filter((message) => matches(message, filter, query, agent));
			const selected = messages.find((message) => message.seq === selectedSeq);
			const lanes = lanesFor(swarm, messages);
			const filteredActive = filter !== "all" || query.trim().length > 0 || agent !== "all";
			const turns = swarm.transcript.length;
			const meta = [
				swarm.topologyMode,
				swarm.terminated ? `terminated (${swarm.destroyReason ?? "no reason"})` : "active",
				`${swarm.messageCount} messages`
			];
			if (swarm.lastSpeaker !== void 0) meta.push(`last speaker: ${swarm.lastSpeaker}`);
			if (swarm.chat !== void 0) {
				const limits = swarm.chat.maxTurns !== void 0 ? `/${swarm.chat.maxTurns}` : "";
				meta.push(`chat ${swarm.chat.active ? "running" : `ended (${swarm.chat.endReason ?? "unknown"})`}, turn ${turns}${limits}`);
			}
			if (swarm.latestCheckpointAt !== void 0) meta.push(`checkpoint ${swarm.latestCheckpointAt}`);
			const agentOptions = ["all", ...lanes];
			const hitlRows = visibleHitl(swarm.pendingHitl, filter, agent, query);
			const resumeLive = () => {
				setLive(true);
				setPendingNew(0);
			};
			const clearFilters = () => {
				setFilter("all");
				setQuery("");
				setAgent("all");
			};
			const onScroll = () => {
				const node = scrollerRef.current;
				if (node === null) return;
				if (node.scrollHeight - node.scrollTop - node.clientHeight > 32 && live) setLive(false);
			};
			const onCollectionKeyDown = (event) => {
				if (event.key === "Escape") {
					if (selectedSeq !== void 0) {
						event.preventDefault();
						setSelectedSeq(void 0);
					}
					return;
				}
				if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
				if (filtered.length === 0) return;
				event.preventDefault();
				const currentIndex = filtered.findIndex((message) => message.seq === selectedSeq);
				const next = filtered[currentIndex < 0 ? event.key === "ArrowDown" ? 0 : filtered.length - 1 : Math.max(0, Math.min(filtered.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)))]?.seq;
				setSelectedSeq(next);
				const node = collectionRef.current?.querySelector(`[data-flow-seq="${next}"]`);
				if (node instanceof HTMLElement) node.focus();
			};
			const emptyCopy = emptyStateCopy({
				hasSwarm: true,
				terminated: swarm.terminated,
				filteredActive,
				messageCount: messages.length,
				pendingHitl: swarm.pendingHitl.length
			});
			const showEmpty = filtered.length === 0 && hitlRows.length === 0;
			const first = messages[0]?.sentAt;
			const last = messages[messages.length - 1]?.sentAt;
			const utcLabel = formatUtcOffset(first ?? last);
			return (0, react.createElement)("section", {
				style: {
					display: "flex",
					flexDirection: "column",
					minHeight: 0,
					flex: "1 1 auto",
					overflow: "hidden"
				},
				"data-swarm-id": swarm.swarmId
			}, (0, react.createElement)("div", { style: styles.header }, (0, react.createElement)("div", {}, (0, react.createElement)("div", { style: styles.heading }, `swarm ${swarm.swarmId}`), (0, react.createElement)("div", { style: styles.muted }, meta.join(" · "))), (0, react.createElement)("span", { style: styles.badge }, swarm.topologyMode)), (0, react.createElement)("div", { style: styles.overview }, (0, react.createElement)("div", { style: styles.topologyCard }, (0, react.createElement)("div", { style: styles.sectionTitle }, `Swarm topology (${swarm.topologyMode})`), (0, react.createElement)("div", {
				style: styles.topologyRow,
				"aria-label": "swarm topology summary"
			}, lanes.filter((name) => name !== "human").map((name, index) => {
				const visual = laneVisual(swarm, name);
				const kind = relationKind(name);
				const label = `${name} — ${visual.label}`;
				return (0, react.createElement)("span", {
					key: name,
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: "8px"
					}
				}, index > 0 ? (0, react.createElement)("span", {
					style: {
						color: T.muted,
						fontSize: "16px"
					},
					"aria-hidden": true
				}, topologyArrow(swarm.topologyMode)) : null, visual.role !== void 0 ? (0, react.createElement)("button", {
					type: "button",
					style: styles.roleCardButton,
					title: `${kind} · ${visual.role.childId}`,
					"aria-label": label,
					onClick: () => {
						onOpenSession(visual.role.childId);
					}
				}, (0, react.createElement)(RoleGlyph, {
					name,
					state: visual.state
				}), (0, react.createElement)(RoleIdentity, {
					name,
					kind,
					state: visual.state,
					waiting: visual.waiting
				})) : (0, react.createElement)("span", {
					style: styles.roleCard,
					"aria-label": label
				}, (0, react.createElement)(RoleGlyph, {
					name,
					state: visual.state
				}), (0, react.createElement)(RoleIdentity, {
					name,
					kind,
					state: visual.state,
					waiting: visual.waiting
				})));
			}), swarm.topologyMode === "mixed" ? (0, react.createElement)("span", { style: {
				...styles.muted,
				whiteSpace: "nowrap"
			} }, routeDistribution(messages)) : null)), (0, react.createElement)("div", {
				style: styles.legend,
				"aria-label": "route legend"
			}, (0, react.createElement)("div", {}, (0, react.createElement)("div", { style: styles.sectionTitle }, "Legend"), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)("span", {
				style: {
					width: 28,
					borderTop: `2px solid ${T.business}`
				},
				"aria-hidden": true
			}), (0, react.createElement)("span", { style: styles.muted }, "Parent → Child")), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)("span", {
				style: {
					width: 28,
					borderTop: `2px dashed ${T.business}`
				},
				"aria-hidden": true
			}), (0, react.createElement)("span", { style: styles.muted }, "Peer ↔ Peer")), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)("span", {
				style: {
					width: 28,
					borderTop: `2px dotted ${T.muted}`
				},
				"aria-hidden": true
			}), (0, react.createElement)("span", { style: styles.muted }, "System / Mixed"))), (0, react.createElement)("div", {}, (0, react.createElement)("div", { style: styles.sectionTitle }, "Role status"), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)(StatusDot, { state: "active" }), (0, react.createElement)("span", { style: styles.muted }, "Active")), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)(StatusDot, { state: "idle" }), (0, react.createElement)("span", { style: styles.muted }, "Idle / Waiting")), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)(StatusDot, { state: "completed" }), (0, react.createElement)("span", { style: styles.muted }, "Completed")), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)(StatusDot, { state: "error" }), (0, react.createElement)("span", { style: styles.muted }, "Error"))))), (0, react.createElement)("div", {
				style: styles.toolbar,
				"aria-label": "conversation filters"
			}, [
				"all",
				"parent",
				"peer",
				"group",
				"human"
			].map((current) => (0, react.createElement)("button", {
				key: current,
				type: "button",
				style: filter === current ? {
					...styles.filter,
					...styles.filterActive
				} : styles.filter,
				"aria-pressed": filter === current,
				onClick: () => {
					setFilter(current);
				}
			}, `${filterLabel(current)} (${countFor(messages, current)})`)), (0, react.createElement)("label", { style: {
				...styles.muted,
				display: "inline-flex",
				alignItems: "center",
				gap: "4px"
			} }, "Agent", (0, react.createElement)("select", {
				value: agent,
				"aria-label": "Filter by agent",
				style: styles.smallButton,
				onChange: (event) => {
					setAgent(event.target.value);
				}
			}, agentOptions.map((option) => (0, react.createElement)("option", {
				key: option,
				value: option
			}, option === "all" ? "All agents" : option)))), (0, react.createElement)("input", {
				value: query,
				placeholder: "Search messages…",
				"aria-label": "Search messages",
				style: {
					...styles.smallButton,
					marginLeft: "auto",
					width: "180px"
				},
				onChange: (event) => {
					setQuery(event.target.value);
				}
			}), filteredActive ? (0, react.createElement)("button", {
				type: "button",
				style: styles.smallButton,
				onClick: clearFilters
			}, "Clear filters") : null), pendingNew > 0 && !live ? (0, react.createElement)("button", {
				type: "button",
				style: styles.liveBanner,
				onClick: resumeLive
			}, `${pendingNew} new message${pendingNew === 1 ? "" : "s"} · resume live`) : null, (0, react.createElement)("div", { style: styles.body }, (0, react.createElement)("div", { style: styles.flow }, (0, react.createElement)("div", {
				style: {
					...styles.laneHeader,
					gridTemplateColumns: canvasColumns(lanes.length)
				},
				"aria-label": "agent lanes"
			}, (0, react.createElement)("div", {
				key: "time",
				style: {
					...styles.lane,
					borderLeft: 0,
					fontWeight: 650
				}
			}, (0, react.createElement)("div", {}, "Time"), (0, react.createElement)("div", {
				style: styles.muted,
				"data-time-zone": utcLabel
			}, utcLabel)), ...lanes.map((name) => {
				const visual = laneVisual(swarm, name);
				const kind = relationKind(name);
				const label = `${name} — ${visual.label}`;
				const body = [(0, react.createElement)("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "6px",
					fontWeight: 650
				} }, (0, react.createElement)(RoleGlyph, {
					name,
					state: visual.state
				}), (0, react.createElement)("span", {}, name)), (0, react.createElement)("div", { style: {
					...styles.muted,
					display: "flex",
					alignItems: "center",
					gap: "5px",
					marginTop: "2px"
				} }, (0, react.createElement)(StatusDot, { state: visual.state }), (0, react.createElement)("span", {}, `${kind} · ${visual.label}`))];
				return visual.role !== void 0 ? (0, react.createElement)("button", {
					key: name,
					type: "button",
					style: styles.laneButton,
					title: `${kind} · ${visual.role.childId}`,
					"aria-label": label,
					onClick: () => {
						onOpenSession(visual.role.childId);
					}
				}, ...body) : (0, react.createElement)("div", {
					key: name,
					style: styles.lane,
					title: `${kind} · ${visual.label}`,
					"aria-label": label
				}, ...body);
			})), (0, react.createElement)("div", {
				ref: scrollerRef,
				style: styles.scroller,
				"data-flow-scroller": true,
				"data-live": live ? "on" : "paused",
				onScroll
			}, showEmpty ? (0, react.createElement)("div", { style: styles.empty }, emptyCopy, filteredActive ? (0, react.createElement)("div", { style: { marginTop: "8px" } }, (0, react.createElement)("button", {
				type: "button",
				style: styles.smallButton,
				onClick: clearFilters
			}, "Clear filters")) : null) : (0, react.createElement)("div", {
				ref: collectionRef,
				role: "listbox",
				tabIndex: 0,
				"aria-label": "conversation messages",
				"aria-activedescendant": selectedSeq !== void 0 ? `flow-msg-${selectedSeq}` : void 0,
				"data-flow-collection": true,
				onKeyDown: onCollectionKeyDown
			}, filtered.map((message) => (0, react.createElement)(FlowMessageRow, {
				key: message.seq,
				message,
				lanes,
				selected: selectedSeq === message.seq,
				onSelect: setSelectedSeq
			})), hitlRows.map((pending) => (0, react.createElement)(HitlRow, {
				key: `lane-${pending.requestId}`,
				pending,
				lanes,
				sessionId,
				onOpenSession
			}))))), (0, react.createElement)(MessageDetails, {
				swarm,
				message: selected,
				onOpenSession,
				onClose: () => {
					setSelectedSeq(void 0);
				}
			})), (0, react.createElement)("div", { style: styles.footer }, (0, react.createElement)("div", { style: styles.footerStats }, (0, react.createElement)("span", {}, `${filtered.length} visible · ${messages.length} total`), first !== void 0 ? (0, react.createElement)("span", {}, `First: ${formatClock(first)}`) : null, last !== void 0 ? (0, react.createElement)("span", {}, `Last: ${formatClock(last)}`) : null, first !== void 0 && last !== void 0 ? (0, react.createElement)("span", {}, `Duration: ${formatDuration(first, last)}`) : null, (0, react.createElement)("span", {
				"data-live-indicator": live ? "on" : "paused",
				style: { color: live ? T.success : T.muted }
			}, live ? "● Live" : "Paused")), (0, react.createElement)("label", { style: {
				display: "inline-flex",
				alignItems: "center",
				gap: "6px",
				color: T.muted
			} }, "Auto-scroll", (0, react.createElement)("input", {
				type: "checkbox",
				checked: live,
				"aria-label": live ? "Live follow on" : "Live follow paused",
				onChange: () => {
					setLive((current) => !current);
				}
			}))));
		}
		function PanelShell({ children }) {
			return (0, react.createElement)("div", {
				style: styles.page,
				"aria-label": "Conversation Flow"
			}, children);
		}
		/** Pure panel body: renders one Conversation Flow section per swarm. */
		function SwarmPanelView({ model, onOpenSession, sessionId, projectionError }) {
			if (projectionError !== void 0 && projectionError.length > 0) return (0, react.createElement)(PanelShell, { children: (0, react.createElement)("div", { style: styles.empty }, emptyStateCopy({
				projectionError,
				hasSwarm: false,
				terminated: false,
				filteredActive: false,
				messageCount: 0,
				pendingHitl: 0
			})) });
			if (model === void 0) return (0, react.createElement)(PanelShell, { children: (0, react.createElement)("div", { style: styles.empty }, emptyStateCopy({
				waiting: true,
				hasSwarm: false,
				terminated: false,
				filteredActive: false,
				messageCount: 0,
				pendingHitl: 0
			})) });
			const swarms = model == null ? [] : Object.values(model);
			if (swarms.length === 0) return (0, react.createElement)(PanelShell, { children: (0, react.createElement)("div", { style: styles.empty }, EMPTY_NO_SWARM) });
			return (0, react.createElement)(PanelShell, { children: swarms.map((swarm) => (0, react.createElement)(SwarmFlowView, {
				key: swarm.swarmId,
				swarm,
				onOpenSession,
				sessionId
			})) });
		}
		/**
		* Conversation Flow tab: full-page swimlanes over the `swarm` projection.
		* @param props - conversation-view slot currency plus the injected actions.
		* @returns the Conversation Flow page.
		*/
		function SwarmConversationView(props) {
			const sessionId = props.sessionId;
			return (0, react.createElement)(SwarmPanelView, {
				model: props.useProjection("swarm"),
				onOpenSession: props.onOpenSession,
				...typeof sessionId === "string" && sessionId.length > 0 ? { sessionId } : {}
			});
		}
		/**
		* Session-header swarm count. The Conversation Flow canvas lives on the
		* `conversation.view` tab, not in this header badge.
		* @param props - runtime slot currency plus the injected actions.
		* @returns the swarm count, or null when the session has no swarm.
		*/
		function SwarmAction(props) {
			const model = props.useProjection("swarm");
			const count = model == null ? 0 : Object.keys(model).length;
			if (count === 0) return null;
			return (0, react.createElement)("div", { style: styles.root }, (0, react.createElement)("span", {
				style: styles.trigger,
				"aria-label": `swarm panel (${count} ${count === 1 ? "swarm" : "swarms"})`
			}, `Swarms: ${count}`));
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services: header-slot contribution and child-session navigation. */
		const inject = ["uiWorkspace", "slots"];
		/**
		* Client plugin body: register the header action.
		* @param ctx - client root context.
		* @param config - optional client config; `enabled: false` disables the panel.
		*/
		function apply(ctx, config = {}) {
			if (config.enabled === false) return;
			const actions = () => ({ onOpenSession: (childId) => {
				ctx.uiWorkspace.openSession(childId);
			} });
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "swarm-panel",
				order: 30,
				inject: actions
			}, SwarmAction));
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "conversation-flow",
				order: 20,
				label: () => "Conversation Flow",
				inject: actions
			}, SwarmConversationView));
		}
		//#endregion
		exports.SwarmAction = SwarmAction;
		exports.SwarmConversationView = SwarmConversationView;
		exports.SwarmPanelView = SwarmPanelView;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map