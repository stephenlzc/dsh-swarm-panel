# dsh-swarm-panel

[English] | [中文](README.zh.md)

DSH Agent Swarm: AI-driven multi-agent orchestration with dynamic communication topology, cold resume, and layered human-in-the-loop.

## Overview

`dsh-swarm-panel` enables a single **Orchestrator Agent** to autonomously spawn, coordinate, and communicate with child agents, choosing the communication topology (parent-child or peer-to-peer) on a per-message basis. The Orchestrator is a real LLM Agent — it decides which roles to spawn, which model each role uses, and how roles exchange information.

## Quick Start

Add the plugin to your cordis.yml (the deployment ships the tool surface to every root Orchestrator agent), then point the Orchestrator at the bundled code-review squad example:

```yaml
# cordis.yml (overlay onto your base profile, or copy into $DSH_HOME/profiles/<name>/)
plugins:
  dsh-swarm-panel: workspace:*
```

```bash
# Run the bundled code-review squad (see examples/coding-squad/cordis.yml)
pnpm dsh --profile headless --patch ./examples/coding-squad/cordis.yml \
  "review the pending PR"
```

The 14 tools are auto-installed on root agents only. Children get no swarm surface — the orchestrator drives every cross-role message, checkpoint, and HITL ask. The example requires `DEEPSEEK_API_KEY` via the standard credentials path.

## Installation

```bash
# Install via dsh plugin command
dsh plugin --profile web add dsh-swarm-panel

# Or for local development from this checkout
dsh plugin --profile web add file:./dsh-swarm-plugin
```

## Web UI

With the plugin installed in the `web` profile, ask the Orchestrator to create a swarm and spawn a role, for example: `Create a swarm named default and spawn one planner role.` Open the **Conversation Flow** tab next to Chat and Trajectory. That page is the swarm canvas: Orchestrator, role, and Human swimlanes; parent-child, peer, and group routing; filters, message details, and Live follow. The header `Swarms: N` badge is only a count. Click a role lane to open its child session.

![DeepSeek Harness Agent Swarm panel](assets/swarm-panel.png)

## Tool Reference

| Tool | Description |
|------|-------------|
| `swarm_spawn` | Spawn a named child agent role |
| `swarm_send_to` | Send a message between roles with attribution control |
| `swarm_set_topology` | Set communication topology (parent-child / peer / mixed) |
| `swarm_list_children` | List all active roles |
| `swarm_interrupt` | Interrupt one or all roles |
| `swarm_terminate` | Terminate the entire swarm |
| `swarm_ask_user` | Request human input (HITL) |
| `swarm_start_chat` | Start the group chat engine (topic, speaker selection, stop conditions) |
| `swarm_next_turn` | Advance the chat one or more turns; `speaker` steers under `auto` selection |
| `swarm_set_context` | Write a swarm-level context variable |
| `swarm_get_context` | Read context variables (one key or all) |
| `swarm_checkpoint` | Save a checkpoint for cold resume |
| `swarm_memory_write` | Remember a swarm-level fact (decision, finding, constraint) |
| `swarm_memory_query` | Query memories by free text (lexical scoring, tag-boosted) |

## Group Chat Engine

`swarm_start_chat` starts a host-side turn engine over the swarm's roles; `swarm_next_turn` advances it. Every turn the engine picks a speaker, delivers a prompt carrying the topic, the shared context variables, and the recent transcript, awaits the role's reply from its durable child session, and logs it as a `swarm/role-message` addressed to `group`. All engine state lives in the event log, so a cold resume continues exactly from the last speaker.

Speaker selection (per-swarm via `swarm_start_chat`, default via cordis.yml `chat.speakerSelection`):

- `round_robin` (default): spawn order, wrapping; continues from `lastSpeaker` after a resume.
- `random`: uniform pick excluding the previous speaker.
- `auto`: the Orchestrator decides each turn by passing `speaker` to `swarm_next_turn`.
- `manual`: the engine asks the operator who speaks next (requires human input enabled).

Stop conditions: `maxTurns` / `maxRounds` (a round = every active role speaking once), `terminationMessage` substring in a reply, and `swarm_terminate`. Under `humanInputMode: TERMINATE` the operator confirms an automatic stop; under `ALWAYS` the operator is asked after every completed round.

```yaml
# cordis.yml row config
config:
  chat:
    speakerSelection: round_robin
    maxTurns: 50
    transcriptWindow: 10 # recent group messages per turn prompt
```

Context variables are swarm-level key-value state: written with `swarm_set_context` (attributed via `by`), read with `swarm_get_context`, injected into every turn prompt, included in checkpoints, and rebuilt by the resume fold.

## Lightweight Memory

`swarm_memory_write` records swarm-level facts (decisions, findings, constraints) as `swarm/memory-written` events; `swarm_memory_query` retrieves them by free text. Scoring is lexical — lowercase token overlap, exact tag hits weigh double, ties favor the later write — with no embedding dependency. Memories live only in the durable log: a cold resume re-folds them with no special casing, and write ids (`mem-<n>`) never collide across a restart. The fold view is capped at the latest `memory.maxEntries` entries (the log itself is never truncated).

```yaml
# cordis.yml row config
config:
  memory:
    maxEntries: 200 # fold view cap
    queryLimit: 5   # default swarm_memory_query limit
```

## Architecture

- **`src/runtime.ts`**: `SwarmRuntime` — per-orchestrator lifecycle, child management, relay routing, checkpoint snapshots
- **`src/domain.ts`**: Pure event-folding logic — all state from session events
- **`src/resume.ts`**: Cold resume — fold-based runtime hydration, child re-establishment, history replay
- **`src/tools.ts`**: Orchestrator tool definitions
- **`src/types.ts`**: Session event types (`swarm/role-spawned`, `swarm/role-message`, etc.)
- **`src/panel-model.ts`**: `swarm` projection — panel wire model + incremental reducer
- **`src/memory.ts`**: Lightweight memory retrieval — lexical scoring over folded entries
- **`src/client/`**: Browser half — session-header swarm panel (no JSX, inline styles)
- **`src/index.ts`**: Function plugin entry (`name` + `apply`)

## Session Events

| Event | Purpose |
|-------|---------|
| `swarm/created` | Swarm was created |
| `swarm/role-spawned` | Child agent spawned (records the role's model and system prompt) |
| `swarm/role-message` | Message sent between roles |
| `swarm/role-exited` | Role settled / interrupted / errored |
| `swarm/topology-changed` | Topology mode changed |
| `swarm/destroyed` | Swarm terminated |
| `swarm/checkpoint` | State snapshot saved (roles, topology, message count, last speaker) |
| `swarm/resumed` | Cold resume completed; names the recovery point and each role's outcome |
| `swarm/hitl-requested` | Orchestrator asked the operator a question and is waiting |
| `swarm/hitl-resolved` | A pending question settled (`answered` with the answer text, or `cancelled`) |
| `swarm/chat-started` | Group chat engine started (topic, speaker selection, stop conditions) |
| `swarm/chat-ended` | Engine stopped, with the reason |
| `swarm/context-updated` | A context variable was written |
| `swarm/memory-written` | A memory entry was written (id, text, tags, attribution) |

## Human-in-the-Loop

`swarm_ask_user` pauses the Orchestrator's tool call until the operator answers through the host's user-questions provider (`ctx.userQuestions`; the plugin declares it in `inject`). The question is logged as `swarm/hitl-requested` before the wait starts, and exactly one `swarm/hitl-resolved` records how it settled. With `routeTo`, the answer is also delivered to a role as a message attributed to `human`.

Interaction semantics: interrupting roles never cancels a pending ask (HITL is swarm-level); `swarm_terminate` cancels it with outcome `cancelled`. After a cold resume, an unanswered question reappears in `swarm_list_children`'s `pendingHitl` projection — no live waiter survives a restart, so the Orchestrator should re-ask; request ids (`hitl-<n>`) never collide with the crashed request.

```yaml
# cordis.yml row config
config:
  humanInputMode: TERMINATE # ALWAYS | TERMINATE | NEVER
```

- `ALWAYS` / `TERMINATE`: `swarm_ask_user` is enabled (the M3 turn engine consumes the distinction).
- `NEVER`: `swarm_ask_user` fails with `unavailable` and nothing is logged.

## Checkpoint & Cold Resume

Every swarm fact lives in the orchestrator's durable session log, so a swarm survives a host restart. When a session is resumed (`ctx.agents.resume`), the plugin:

1. Rebuilds each `SwarmRuntime` synchronously from the event fold — role map, topology, termination.
2. Re-establishes every running role in the background: a role whose durable child session survived is cold-resumed through `followup()` with its history intact; a role whose child session was lost is re-spawned from its recorded definition and its inbound `swarm/role-message` history is replayed in order.
3. Appends one `swarm/resumed` fact naming the latest checkpoint and each role's outcome (`resumed` / `respawned`).

Checkpoints are markers over the log — resume always re-folds the complete log. Save them with the `swarm_checkpoint` tool, or automatically per the configured cadence:

```yaml
# cordis.yml row config
config:
  checkpoint:
    frequency: auto # auto | manual | per_turn
```

- `auto` (default): snapshot at the next idle boundary after a structural change (spawn, exit, topology, terminate).
- `per_turn`: also snapshot message-only progress after every turn.
- `manual`: only when the Orchestrator calls `swarm_checkpoint`.

> **Note:** the plugin registers its `swarm/*` event vocabulary with the session persistence read path while loaded. Uninstalling the plugin makes swarm sessions read as written-by-a-newer-harness, which the loader refuses by design.

## Observability & Web Panel

When the host composes the session-projection seam (`ctx.sessionProjections`), the plugin registers a `swarm` projection unit that folds every `swarm/*` event into a per-session panel model (`Record<swarmId, SwarmPanelSwarm> | null`): roster and topology mode, every routed `swarm/role-message` with per-message parent/peer attribution, the group transcript, pending HITL requests, context variables, chat engine state, and the latest checkpoint/resume markers. The fold is incremental — unrelated events return the same state reference, so the change feed fires only when the panel value actually moves.

The browser half ships as `dsh-swarm-panel/client` (discovered through the package.json `dsh.client` declaration): a Conversation Flow `conversation.view` tab plus a header swarm-count badge — no RPC, no client-side store, and no new model request. The tab is always listed next to Chat and Trajectory; the badge stays hidden until the session has at least one swarm. Live/Pause only follows the viewport. Each role lane opens the role's child session (`ctx.sessions.open`); opening a persisted child cold-resumes it host-side, which is how the panel triggers recovery.

## Known Limitations / Roadmap

- **A2A / ACP external protocol bridge**: not delivered (M5 scope control); the event model leaves room for it.
- **Nested sub-swarm**: not delivered — the single-level "root agent is the orchestrator" assumption is deliberate; the trade-off is documented in PLAN.md (M7 design note).
- **Memory consumption**: memories are written/queried by the Orchestrator only; roles do not write directly, and turn prompts do not inject memories yet.
- **Panel copy** is English-only (no locale namespace).
- The real-API cold-resume e2e (`tests/cold-resume.e2e.ts`) runs only when `DEEPSEEK_API_KEY` is set; the resident mock-adapter equivalent lives in `tests/chat.spec.ts`.

## Milestones

- **M0**: Current state audit + data model extension
- **M1**: Cross-session cold resume / checkpoint
- **M2**: Human-in-the-Loop (simple via `ask_user`, complex via GUI panel)
- **M3**: Open group chat (speaker selection, context variables, termination conditions)
- **M4**: Observability + GUI panel (right dock tab)
- **M5**: Advanced (nested swarm, memory, A2A/ACP)

## License

MIT
