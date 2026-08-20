window.__ModuleLoader__.load({
	id: "dsh-swarm-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/SwarmAction.ts
		/**
		* Swarm panel, browser half: the session-header Conversation Flow view over
		* the `swarm` projection. It keeps the host event log authoritative and uses
		* local state only for filters, selection, details, and live-follow behavior.
		*
		* @module dsh-swarm-panel/client
		*/
		const styles = {
			root: {
				position: "relative",
				display: "inline-block"
			},
			trigger: {
				border: "1px solid var(--dsw-alias-border-l2, var(--border, #444))",
				borderRadius: "6px",
				background: "transparent",
				color: "inherit",
				padding: "2px 8px",
				fontSize: "12px"
			},
			page: {
				display: "flex",
				flexDirection: "column",
				height: "100%",
				minHeight: 0,
				width: "100%",
				boxSizing: "border-box",
				padding: "16px",
				gap: "12px",
				overflow: "hidden",
				background: "var(--dsw-alias-bg-layer-1, #f7f8f9)",
				color: "var(--dsw-alias-label-primary, #1a1c1f)",
				fontSize: "12px"
			},
			legend: {
				display: "grid",
				gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
				gap: "20px",
				flexShrink: 0,
				padding: "10px 12px",
				border: "1px solid var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "10px",
				background: "var(--dsw-alias-bg-overlay, #fff)",
				minWidth: "300px",
				boxSizing: "border-box"
			},
			overview: {
				display: "grid",
				gridTemplateColumns: "minmax(0, 1fr) minmax(300px, .72fr)",
				gap: "10px",
				minWidth: 0,
				flexShrink: 0
			},
			topologyCard: {
				minWidth: 0,
				padding: "10px 12px",
				border: "1px solid var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "10px",
				background: "var(--dsw-alias-bg-overlay, #fff)"
			},
			sectionTitle: {
				fontWeight: 650,
				marginBottom: "8px"
			},
			legendRow: {
				display: "flex",
				alignItems: "center",
				gap: "7px",
				marginTop: "5px"
			},
			legendMark: {
				width: "24px",
				flex: "0 0 24px",
				textAlign: "center",
				fontSize: "14px",
				lineHeight: 1
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
			muted: { color: "var(--dsw-alias-label-secondary, #61666b)" },
			summary: {
				display: "flex",
				alignItems: "center",
				gap: "6px",
				marginTop: "10px",
				padding: "8px",
				background: "var(--dsw-alias-bg-secondary, #f7f8f9)",
				borderRadius: "8px",
				overflowX: "auto",
				flexShrink: 0
			},
			node: {
				display: "inline-flex",
				alignItems: "center",
				gap: "6px",
				whiteSpace: "nowrap",
				padding: "5px 8px",
				border: "1px solid var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "6px",
				background: "#fff"
			},
			nodeButton: {
				display: "inline-flex",
				alignItems: "center",
				gap: "6px",
				whiteSpace: "nowrap",
				padding: "5px 8px",
				border: "1px solid var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "6px",
				background: "#fff",
				color: "inherit",
				cursor: "pointer",
				fontSize: "12px"
			},
			nodeStatus: {
				width: "6px",
				height: "6px",
				borderRadius: "50%",
				flex: "0 0 auto"
			},
			arrow: {
				color: "var(--dsw-alias-label-secondary, #61666b)",
				fontSize: "15px"
			},
			toolbar: {
				display: "flex",
				alignItems: "center",
				gap: "6px",
				marginTop: "10px",
				flexWrap: "wrap",
				flexShrink: 0
			},
			filter: {
				borderWidth: 1,
				borderStyle: "solid",
				borderColor: "var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "999px",
				background: "#fff",
				color: "inherit",
				padding: "5px 9px",
				cursor: "pointer",
				fontSize: "11px"
			},
			filterActive: {
				background: "var(--dsw-alias-interactive-primary, #e8f0ff)",
				borderColor: "var(--dsw-alias-interactive-primary, #377dff)",
				color: "var(--dsw-alias-interactive-primary, #1c5fd4)"
			},
			body: {
				display: "flex",
				gap: "10px",
				marginTop: "10px",
				minHeight: 0,
				minWidth: 0,
				flex: "1 1 auto",
				overflow: "hidden"
			},
			flow: {
				flex: "1 1 auto",
				minWidth: 0,
				display: "flex",
				flexDirection: "column",
				border: "1px solid var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "8px",
				overflow: "hidden",
				background: "var(--dsw-alias-bg-secondary, #f7f8f9)"
			},
			laneHeader: {
				display: "grid",
				gap: "8px",
				padding: "8px 10px",
				background: "#fff",
				borderBottom: "1px solid var(--dsw-alias-border-l2, #edf0f2)"
			},
			lane: {
				minWidth: 0,
				padding: "6px 8px",
				border: "1px solid var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "6px",
				background: "#fff",
				textAlign: "left",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			laneButton: {
				minWidth: 0,
				padding: "6px 8px",
				border: "1px solid var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "6px",
				background: "#fff",
				color: "inherit",
				cursor: "pointer",
				fontSize: "12px",
				textAlign: "left",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			scroller: {
				flex: "1 1 auto",
				overflow: "auto",
				minHeight: 0
			},
			time: {
				color: "var(--dsw-alias-label-secondary, #737a81)",
				fontVariantNumeric: "tabular-nums",
				fontSize: "10px"
			},
			row: {
				display: "grid",
				gap: "8px",
				alignItems: "center",
				padding: "8px 10px",
				borderBottom: "1px solid var(--dsw-alias-border-l2, #edf0f2)",
				cursor: "pointer",
				position: "relative",
				minHeight: "72px"
			},
			rowSelected: {
				background: "var(--dsw-alias-bg-selected, #eef4ff)",
				boxShadow: "inset 3px 0 #377dff"
			},
			card: {
				minWidth: 0,
				zIndex: 1,
				padding: "7px 8px",
				border: "1px solid var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "6px",
				background: "#fff"
			},
			cardTitle: {
				display: "flex",
				justifyContent: "space-between",
				gap: "6px",
				fontWeight: 600,
				minWidth: 0
			},
			cardHeading: {
				minWidth: 0,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			preview: {
				marginTop: "3px",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				color: "var(--dsw-alias-label-secondary, #61666b)"
			},
			metaRow: {
				display: "flex",
				flexWrap: "wrap",
				gap: "4px",
				marginTop: "5px",
				alignItems: "center"
			},
			badge: {
				display: "inline-block",
				fontSize: "10px",
				borderRadius: "4px",
				padding: "2px 5px",
				background: "#edf4ff",
				color: "#2b6dcc",
				whiteSpace: "nowrap"
			},
			peerBadge: {
				background: "#f4edff",
				color: "#7546b8"
			},
			groupBadge: {
				background: "#eef8f1",
				color: "#2d7b42"
			},
			humanBadge: {
				background: "#fff4df",
				color: "#a56b00"
			},
			target: {
				zIndex: 1,
				minWidth: 0,
				padding: "4px 7px",
				border: "1px dashed var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "999px",
				background: "#fff",
				color: "var(--dsw-alias-label-secondary, #61666b)",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				justifySelf: "center"
			},
			groupBanner: {
				gridColumn: "1 / -1",
				padding: "8px 10px",
				border: "1px dashed #9dcea8",
				borderRadius: "6px",
				background: "#f3faf5"
			},
			empty: {
				padding: "42px 16px",
				textAlign: "center",
				color: "var(--dsw-alias-label-secondary, #61666b)"
			},
			details: {
				flex: "0 0 240px",
				display: "flex",
				flexDirection: "column",
				border: "1px solid var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "8px",
				padding: "10px",
				minWidth: 0,
				overflow: "auto",
				background: "#fff"
			},
			detailHeading: {
				display: "flex",
				justifyContent: "space-between",
				gap: "8px",
				alignItems: "center",
				fontWeight: 650,
				marginBottom: "10px"
			},
			detailRow: {
				display: "flex",
				justifyContent: "space-between",
				gap: "8px",
				padding: "5px 0",
				borderBottom: "1px solid #edf0f2"
			},
			detailLabel: {
				color: "var(--dsw-alias-label-secondary, #61666b)",
				flex: "0 0 auto"
			},
			detailValue: {
				minWidth: 0,
				overflow: "hidden",
				textOverflow: "ellipsis",
				textAlign: "right"
			},
			detailContent: {
				marginTop: "10px",
				padding: "8px",
				background: "var(--dsw-alias-bg-secondary, #f7f8f9)",
				borderRadius: "6px",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				maxHeight: "180px",
				overflow: "auto"
			},
			smallButton: {
				border: "1px solid var(--dsw-alias-border-l2, #d8dce0)",
				borderRadius: "5px",
				background: "#fff",
				color: "inherit",
				padding: "4px 7px",
				cursor: "pointer",
				fontSize: "11px"
			},
			smallButtonDisabled: {
				opacity: .55,
				cursor: "not-allowed"
			},
			hitl: {
				margin: "8px 10px",
				padding: "8px",
				borderRadius: "6px",
				background: "#fff8e8",
				color: "var(--dsw-alias-state-warn-primary, #a56b00)",
				border: "1px solid #f1d58e"
			},
			liveBanner: {
				margin: "0 0 8px",
				width: "100%",
				border: "1px solid #c5d8f8",
				borderRadius: "6px",
				background: "#eef4ff",
				color: "#1c5fd4",
				padding: "6px 8px",
				cursor: "pointer",
				fontSize: "11px"
			},
			footer: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "12px",
				flexWrap: "wrap",
				marginTop: "8px",
				flexShrink: 0
			},
			footerStats: {
				display: "flex",
				gap: "14px",
				flexWrap: "wrap"
			}
		};
		/** Status word suffix for one role row. */
		function roleStatus(role) {
			return role.status === "running" ? "running" : `exited (${role.outcome ?? "unknown"})`;
		}
		/** Visible participant label; empty names stay inspectable. */
		function participantName(value) {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : "unknown";
		}
		/** Clock label for a stored timestamp; unparseable values render as written. */
		function timeLabel(value) {
			if (value.length === 0) return "unknown time";
			const date = new Date(value);
			return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit"
			});
		}
		/** Filter control caption. */
		function filterLabel(filter) {
			if (filter === "parent") return "Parent → Child";
			if (filter === "peer") return "Peer ↔ Peer";
			if (filter === "group") return "Mixed / System";
			if (filter === "human") return "Human input";
			return "All messages";
		}
		/** Per-message route used by badges and filters. */
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
		function badgeStyle(route) {
			if (route === "peer") return {
				...styles.badge,
				...styles.peerBadge
			};
			if (route === "group") return {
				...styles.badge,
				...styles.groupBadge
			};
			if (route === "human") return {
				...styles.badge,
				...styles.humanBadge
			};
			return styles.badge;
		}
		function countFor(messages, filter) {
			return messages.filter((message) => filterMatch(message, filter)).length;
		}
		function filterMatch(message, filter) {
			if (filter === "all") return true;
			if (filter === "parent") return routeFor(message) === "parent-child";
			if (filter === "peer") return routeFor(message) === "peer";
			if (filter === "group") return routeFor(message) === "group";
			return message.from === "human" || message.to === "human";
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
		function statusDot(status) {
			const color = status === "running" ? "var(--dsw-alias-state-success-primary, #2f9e44)" : status === "waiting" ? "var(--dsw-alias-state-warn-primary, #c48100)" : "var(--dsw-alias-label-secondary, #8a9198)";
			return {
				...styles.nodeStatus,
				background: color
			};
		}
		/** How a lane relates to the orchestrator: parent, spawned child, or human operator. */
		function relationKind(name) {
			if (name === "orchestrator") return "parent";
			if (name === "human") return "operator";
			return "child";
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
			return `72px repeat(${laneCount}, minmax(${laneCount > 5 ? "clamp(96px, 12vw, 140px)" : "140px"}, 1fr))`;
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
		function topologyArrow(mode) {
			if (mode === "peer") return "↔";
			if (mode === "mixed") return "⇢";
			return "→";
		}
		function routeDistribution(messages) {
			return `parent-child ${messages.filter((message) => routeFor(message) === "parent-child").length} · peer ${messages.filter((message) => routeFor(message) === "peer").length} · group ${messages.filter((message) => routeFor(message) === "group").length}`;
		}
		async function copyText(text) {
			try {
				await navigator.clipboard.writeText(text);
			} catch (error) {}
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
		/** Disabled-session reason retained when a details action cannot navigate. */
		function unavailableReason(name, role) {
			if (name === "orchestrator") return "The orchestrator is the current session.";
			if (name === "human") return "Human input has no child session.";
			if (name === "group") return "Group messages have no single recipient session.";
			if (role === void 0) return `No child session for ${name}.`;
			return "";
		}
		/** One message detail drawer for the selected flow event. */
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
			}, (0, react.createElement)("div", { style: styles.detailHeading }, "Message details"), (0, react.createElement)("p", { style: styles.muted }, "Select a message to inspect routing, content, and sessions."));
			const route = routeFor(message);
			const sender = openableRole(swarm, message.from);
			const recipient = openableRole(swarm, message.to);
			const senderReason = unavailableReason(participantName(message.from), sender);
			const recipientReason = unavailableReason(participantName(message.to), recipient);
			const markCopied = (kind) => {
				setCopied(kind);
			};
			return (0, react.createElement)("aside", {
				style: styles.details,
				"aria-label": "message details"
			}, (0, react.createElement)("div", { style: styles.detailHeading }, (0, react.createElement)("span", {}, "Message details"), (0, react.createElement)("button", {
				type: "button",
				style: styles.smallButton,
				"aria-label": "Close message details",
				onClick: onClose
			}, "Close")), (0, react.createElement)("div", { style: styles.detailRow }, (0, react.createElement)("span", { style: styles.detailLabel }, "Seq"), (0, react.createElement)("span", { style: styles.detailValue }, `#${message.seq}`)), (0, react.createElement)("div", { style: styles.detailRow }, (0, react.createElement)("span", { style: styles.detailLabel }, "Route"), (0, react.createElement)("span", { style: badgeStyle(route) }, routeLabel(route))), (0, react.createElement)("div", { style: styles.detailRow }, (0, react.createElement)("span", { style: styles.detailLabel }, "Attribution"), (0, react.createElement)("span", { style: styles.detailValue }, message.attribution)), (0, react.createElement)("div", { style: styles.detailRow }, (0, react.createElement)("span", { style: styles.detailLabel }, "Type"), (0, react.createElement)("span", { style: styles.detailValue }, messageKind(message))), (0, react.createElement)("div", { style: styles.detailRow }, (0, react.createElement)("span", { style: styles.detailLabel }, "Status"), (0, react.createElement)("span", { style: styles.detailValue }, "recorded")), (0, react.createElement)("div", { style: styles.detailRow }, (0, react.createElement)("span", { style: styles.detailLabel }, "From"), (0, react.createElement)("span", {
				style: styles.detailValue,
				title: message.from
			}, `${participantName(message.from)} (${relationKind(participantName(message.from))})`)), (0, react.createElement)("div", { style: styles.detailRow }, (0, react.createElement)("span", { style: styles.detailLabel }, "To"), (0, react.createElement)("span", {
				style: styles.detailValue,
				title: message.to
			}, `${participantName(message.to)} (${relationKind(participantName(message.to))})`)), (0, react.createElement)("div", { style: styles.detailRow }, (0, react.createElement)("span", { style: styles.detailLabel }, "Time"), (0, react.createElement)("span", {
				style: styles.detailValue,
				title: message.sentAt
			}, timeLabel(message.sentAt))), (0, react.createElement)("div", { style: styles.detailRow }, (0, react.createElement)("span", { style: styles.detailLabel }, "Sender session"), (0, react.createElement)("span", {
				style: styles.detailValue,
				title: message.senderSessionId
			}, message.senderSessionId.length > 0 ? message.senderSessionId : "unavailable")), (0, react.createElement)("div", {
				style: styles.detailContent,
				title: message.content
			}, message.content.length > 0 ? message.content : "(empty message)"), (0, react.createElement)("div", { style: {
				display: "flex",
				flexWrap: "wrap",
				gap: "5px",
				marginTop: "8px"
			} }, (0, react.createElement)("button", {
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
			}, `Open ${participantName(message.from)} session`), (0, react.createElement)("button", {
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
			}, `Open ${participantName(message.to)} session`)));
		}
		function laneStatus(swarm, name) {
			if (name === "orchestrator") return swarm.terminated ? "terminated" : "running";
			if (name === "human") return swarm.pendingHitl.length > 0 ? "waiting" : "idle";
			const role = openableRole(swarm, name);
			return role === void 0 ? "unknown" : roleStatus(role);
		}
		function connectorStyle(fromIdx, toIdx, peer) {
			return {
				gridColumn: `${Math.min(fromIdx, toIdx) + 2} / ${Math.max(fromIdx, toIdx) + 3}`,
				gridRow: 1,
				height: 0,
				borderTop: peer ? "2px dashed #9b7ed9" : "2px solid #7aa2e3",
				alignSelf: "center",
				margin: "0 12px",
				display: "flex",
				justifyContent: "center",
				alignItems: "center"
			};
		}
		/** Visible direction marker placed on top of a route connector. */
		function connectorLabel(fromIdx, toIdx, peer) {
			if (peer) return "↔";
			return fromIdx < toIdx ? "→" : "←";
		}
		/** One Conversation Flow row: a group banner or a swimlane-placed card. */
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
			const timeCell = (0, react.createElement)("div", { style: {
				...styles.time,
				gridColumn: 1,
				gridRow: 1
			} }, timeLabel(message.sentAt));
			const parts = messageParts(message);
			if (message.to === "group") return (0, react.createElement)("div", {
				key: message.seq,
				style: rowStyle,
				role: "button",
				tabIndex: 0,
				"aria-selected": selected,
				"aria-expanded": selected,
				"data-flow-seq": message.seq,
				"data-flow-route": route,
				onClick: () => {
					onSelect(message.seq);
				},
				onKeyDown: activate
			}, timeCell, (0, react.createElement)("div", { style: {
				...styles.groupBanner,
				gridColumn: "2 / -1"
			} }, (0, react.createElement)("div", { style: styles.cardTitle }, (0, react.createElement)("span", {
				style: styles.cardHeading,
				title: message.from
			}, `${participantName(message.from)} → group`), (0, react.createElement)("span", { style: styles.muted }, `#${message.seq}`)), (0, react.createElement)("div", {
				style: styles.preview,
				title: message.content
			}, parts.preview), (0, react.createElement)("div", { style: styles.metaRow }, (0, react.createElement)("span", { style: badgeStyle(route) }, routeLabel(route)), (0, react.createElement)("span", { style: badgeStyle(kind === "human" ? "human" : route) }, kind))));
			const fromIdx = Math.max(0, lanes.indexOf(participantName(message.from)));
			const toIdx = Math.max(0, lanes.indexOf(participantName(message.to)));
			const peer = route === "peer";
			return (0, react.createElement)("div", {
				key: message.seq,
				style: rowStyle,
				role: "button",
				tabIndex: 0,
				"aria-selected": selected,
				"aria-expanded": selected,
				"data-flow-seq": message.seq,
				"data-flow-route": route,
				"data-flow-from": participantName(message.from),
				onClick: () => {
					onSelect(message.seq);
				},
				onKeyDown: activate
			}, timeCell, fromIdx !== toIdx ? (0, react.createElement)("div", {
				"aria-hidden": true,
				style: connectorStyle(fromIdx, toIdx, peer)
			}, (0, react.createElement)("span", { style: {
				background: "#fff",
				border: `1px ${peer ? "dashed" : "solid"} ${peer ? "#9b7ed9" : "#7aa2e3"}`,
				borderRadius: "999px",
				padding: "1px 5px",
				color: peer ? "#7546b8" : "#2b6dcc",
				lineHeight: 1
			} }, connectorLabel(fromIdx, toIdx, peer))) : null, (0, react.createElement)("div", { style: {
				...styles.card,
				gridColumn: fromIdx + 2,
				gridRow: 1
			} }, (0, react.createElement)("div", { style: styles.cardTitle }, (0, react.createElement)("span", {
				style: styles.cardHeading,
				title: message.content
			}, parts.title), (0, react.createElement)("span", { style: badgeStyle(route) }, routeLabel(route))), (0, react.createElement)("div", {
				style: styles.preview,
				title: message.content
			}, parts.preview), (0, react.createElement)("div", { style: styles.metaRow }, (0, react.createElement)("span", { style: styles.muted }, `${participantName(message.from)} (${relationKind(participantName(message.from))})`), (0, react.createElement)("span", { style: styles.muted }, `#${message.seq}`))), fromIdx !== toIdx ? (0, react.createElement)("div", {
				style: {
					...styles.target,
					gridColumn: toIdx + 2,
					gridRow: 1
				},
				title: message.to
			}, `${peer ? "↔" : fromIdx < toIdx ? "→" : "←"} ${participantName(message.to)}`) : null);
		}
		/** Pending HITL row in the Human lane. */
		function HitlRow({ pending, lanes }) {
			const humanIdx = Math.max(0, lanes.indexOf("human"));
			return (0, react.createElement)("div", {
				key: pending.requestId,
				style: {
					...styles.row,
					gridTemplateColumns: canvasColumns(lanes.length),
					cursor: "default"
				},
				"data-flow-hitl": pending.requestId
			}, (0, react.createElement)("div", { style: {
				...styles.time,
				gridColumn: 1
			} }, timeLabel(pending.requestedAt)), (0, react.createElement)("div", { style: {
				...styles.hitl,
				gridColumn: humanIdx + 2,
				margin: 0
			} }, (0, react.createElement)("div", { style: styles.cardTitle }, (0, react.createElement)("span", { title: pending.question }, `Human input pending: ${pending.question}`), (0, react.createElement)("span", { style: badgeStyle("human") }, "waiting")), (0, react.createElement)("div", { style: {
				...styles.preview,
				color: "inherit",
				whiteSpace: "normal"
			} }, "Waiting for an operator response.")));
		}
		/** Render one Conversation Flow swarm section. */
		function SwarmFlowView({ swarm, onOpenSession }) {
			const messages = swarm.flow ?? [];
			const [filter, setFilter] = (0, react.useState)("all");
			const [query, setQuery] = (0, react.useState)("");
			const [agent, setAgent] = (0, react.useState)("all");
			const [selectedSeq, setSelectedSeq] = (0, react.useState)();
			const [live, setLive] = (0, react.useState)(true);
			const [pendingNew, setPendingNew] = (0, react.useState)(0);
			const scrollerRef = (0, react.useRef)(null);
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
			(0, react.useEffect)(() => {
				const onKey = (event) => {
					if (event.target instanceof HTMLElement && [
						"INPUT",
						"SELECT",
						"TEXTAREA"
					].includes(event.target.tagName)) return;
					if (event.key === "Escape") {
						if (selectedSeq !== void 0) setSelectedSeq(void 0);
						return;
					}
					if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
					if (filtered.length === 0) return;
					event.preventDefault();
					const currentIndex = filtered.findIndex((message) => message.seq === selectedSeq);
					setSelectedSeq(filtered[currentIndex < 0 ? event.key === "ArrowDown" ? 0 : filtered.length - 1 : Math.max(0, Math.min(filtered.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)))]?.seq);
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [filtered, selectedSeq]);
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
			const emptyCopy = filteredActive ? "No matching messages. Clear filters to see the full flow." : swarm.terminated ? "This swarm has terminated and recorded no messages." : "No messages recorded for this swarm yet.";
			return (0, react.createElement)("section", {
				style: {
					display: "flex",
					flexDirection: "column",
					minHeight: 0,
					flex: "1 1 auto",
					overflow: "hidden"
				},
				"data-swarm-id": swarm.swarmId
			}, (0, react.createElement)("div", { style: styles.header }, (0, react.createElement)("div", {}, (0, react.createElement)("div", { style: styles.heading }, `swarm ${swarm.swarmId}`), (0, react.createElement)("div", { style: styles.muted }, meta.join(" · "))), (0, react.createElement)("span", { style: {
				...styles.badge,
				...swarm.topologyMode === "peer" ? styles.peerBadge : swarm.topologyMode === "mixed" ? styles.humanBadge : {}
			} }, swarm.topologyMode)), (0, react.createElement)("div", { style: styles.overview }, (0, react.createElement)("div", { style: styles.topologyCard }, (0, react.createElement)("div", { style: styles.sectionTitle }, `Swarm topology (${swarm.topologyMode})`), (0, react.createElement)("div", {
				style: {
					...styles.summary,
					marginTop: 0,
					border: 0,
					padding: 0,
					background: "transparent"
				},
				"aria-label": "swarm topology summary"
			}, lanes.filter((name) => name !== "human").map((name, index) => {
				const role = openableRole(swarm, name);
				const status = laneStatus(swarm, name);
				const kind = relationKind(name);
				const label = `${name} — ${status}`;
				return (0, react.createElement)("span", {
					key: name,
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: "6px"
					}
				}, index > 0 ? (0, react.createElement)("span", {
					style: styles.arrow,
					"aria-hidden": true
				}, topologyArrow(swarm.topologyMode)) : null, role !== void 0 ? (0, react.createElement)("button", {
					type: "button",
					style: styles.nodeButton,
					title: `${kind} · ${role.childId}`,
					"aria-label": label,
					onClick: () => {
						onOpenSession(role.childId);
					}
				}, (0, react.createElement)("span", {
					style: statusDot(role.status),
					"aria-hidden": true
				}), (0, react.createElement)("span", {}, name), (0, react.createElement)("span", { style: styles.muted }, `${kind} · ${status}`)) : (0, react.createElement)("span", {
					style: styles.node,
					"aria-label": label
				}, (0, react.createElement)("span", {
					style: statusDot(status),
					"aria-hidden": true
				}), (0, react.createElement)("span", {}, name), (0, react.createElement)("span", { style: styles.muted }, `${kind} · ${status}`)));
			}), swarm.topologyMode === "mixed" ? (0, react.createElement)("span", { style: {
				...styles.muted,
				marginLeft: "8px",
				whiteSpace: "nowrap"
			} }, routeDistribution(messages)) : null)), (0, react.createElement)("div", {
				style: styles.legend,
				"aria-label": "route legend"
			}, (0, react.createElement)("div", {}, (0, react.createElement)("div", { style: styles.sectionTitle }, "Legend"), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)("span", {
				style: styles.legendMark,
				"aria-hidden": true
			}, "→"), (0, react.createElement)("span", { style: styles.muted }, "Parent → Child")), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)("span", {
				style: styles.legendMark,
				"aria-hidden": true
			}, "↔"), (0, react.createElement)("span", { style: styles.muted }, "Peer ↔ Peer")), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)("span", {
				style: styles.legendMark,
				"aria-hidden": true
			}, "┄"), (0, react.createElement)("span", { style: styles.muted }, "System / Mixed"))), (0, react.createElement)("div", {}, (0, react.createElement)("div", { style: styles.sectionTitle }, "Role status"), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)("span", {
				style: {
					...styles.legendMark,
					color: "#2f9e44"
				},
				"aria-hidden": true
			}, "●"), (0, react.createElement)("span", { style: styles.muted }, "Active")), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)("span", {
				style: {
					...styles.legendMark,
					color: "#c48100"
				},
				"aria-hidden": true
			}, "●"), (0, react.createElement)("span", { style: styles.muted }, "Idle / waiting")), (0, react.createElement)("div", { style: styles.legendRow }, (0, react.createElement)("span", {
				style: {
					...styles.legendMark,
					color: "#8a9198"
				},
				"aria-hidden": true
			}, "●"), (0, react.createElement)("span", { style: styles.muted }, "Completed / exited"))))), (0, react.createElement)("div", {
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
			}, "Clear filters") : null, (0, react.createElement)("button", {
				type: "button",
				style: styles.smallButton,
				"aria-pressed": live,
				"aria-label": live ? "Live follow on" : "Live follow paused",
				onClick: () => {
					setLive((current) => !current);
				}
			}, live ? "● Live" : "Ⅱ Pause live")), pendingNew > 0 && !live ? (0, react.createElement)("button", {
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
					fontWeight: 650
				}
			}, "Time"), ...lanes.map((name) => {
				const role = openableRole(swarm, name);
				const status = laneStatus(swarm, name);
				const kind = relationKind(name);
				const label = `${name} — ${status}`;
				const body = [(0, react.createElement)("div", { style: { fontWeight: 650 } }, name), (0, react.createElement)("div", { style: styles.muted }, `${kind} · ${status}`)];
				return role !== void 0 ? (0, react.createElement)("button", {
					key: name,
					type: "button",
					style: styles.laneButton,
					title: `${kind} · ${role.childId}`,
					"aria-label": label,
					onClick: () => {
						onOpenSession(role.childId);
					}
				}, ...body) : (0, react.createElement)("div", {
					key: name,
					style: styles.lane,
					title: `${kind} · ${status}`,
					"aria-label": label
				}, ...body);
			})), (0, react.createElement)("div", {
				ref: scrollerRef,
				style: styles.scroller,
				"data-flow-scroller": true,
				"data-live": live ? "on" : "paused",
				onScroll
			}, filtered.length === 0 ? (0, react.createElement)("div", { style: styles.empty }, emptyCopy, filteredActive ? (0, react.createElement)("div", { style: { marginTop: "8px" } }, (0, react.createElement)("button", {
				type: "button",
				style: styles.smallButton,
				onClick: clearFilters
			}, "Clear filters")) : null) : filtered.map((message) => (0, react.createElement)(FlowMessageRow, {
				key: message.seq,
				message,
				lanes,
				selected: selectedSeq === message.seq,
				onSelect: setSelectedSeq
			})), swarm.pendingHitl.length > 0 && (filter === "all" || filter === "human") && (agent === "all" || agent === "human") ? swarm.pendingHitl.map((pending) => (0, react.createElement)(HitlRow, {
				key: `lane-${pending.requestId}`,
				pending,
				lanes
			})) : null)), (0, react.createElement)(MessageDetails, {
				swarm,
				message: selected,
				onOpenSession,
				onClose: () => {
					setSelectedSeq(void 0);
				}
			})), (0, react.createElement)("div", { style: styles.footer }, (0, react.createElement)("div", { style: styles.footerStats }, (0, react.createElement)("span", {}, `${filtered.length} visible · ${messages.length} total`), messages.length > 0 ? (0, react.createElement)("span", {}, `first ${timeLabel(messages[0]?.sentAt ?? "")}`) : null, messages.length > 0 ? (0, react.createElement)("span", {}, `last ${timeLabel(messages[messages.length - 1]?.sentAt ?? "")}`) : null, (0, react.createElement)("span", {}, swarm.context.phase !== void 0 ? `phase: ${swarm.context.phase}` : "session event log")), (0, react.createElement)("span", {}, `● ${live ? "Live" : "Paused"}`)));
		}
		/** Pure panel body: renders one Conversation Flow section per swarm. */
		function SwarmPanelView({ model, onOpenSession }) {
			const swarms = model == null ? [] : Object.values(model);
			if (swarms.length === 0) return (0, react.createElement)("div", {
				style: styles.page,
				"aria-label": "Conversation Flow"
			}, (0, react.createElement)("div", { style: styles.empty }, "No swarm in this session. Ask the Orchestrator to create one and spawn roles."));
			return (0, react.createElement)("div", {
				style: styles.page,
				"aria-label": "Conversation Flow"
			}, swarms.map((swarm) => (0, react.createElement)(SwarmFlowView, {
				key: swarm.swarmId,
				swarm,
				onOpenSession
			})));
		}
		/**
		* Conversation Flow tab: full-page swimlanes over the `swarm` projection.
		* @param props - conversation-view slot currency plus the injected actions.
		* @returns the Conversation Flow page.
		*/
		function SwarmConversationView(props) {
			return (0, react.createElement)(SwarmPanelView, {
				model: props.useProjection("swarm"),
				onOpenSession: props.onOpenSession
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
		const inject = ["sessions", "slots"];
		/**
		* Client plugin body: register the header action.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			const sessions = ctx.sessions;
			const actions = () => ({ onOpenSession: (childId) => {
				sessions.open(childId);
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