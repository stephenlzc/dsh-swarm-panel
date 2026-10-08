# AGENTS.md — dsh-swarm-panel

This file supplements the repository-level conventions.

## Project overview

`dsh-swarm-panel` is an independent DSH Cordis plugin (not part of the deepseek-harness monorepo). It can be installed via `dsh plugin --profile <name> add dsh-swarm-panel` once published to npm.

## Package structure

```
src/
  index.ts      — function plugin entry (name + inject + apply)
  types.ts      — session event types + branded IDs
  runtime.ts    — SwarmRuntime per-agent lifecycle
  domain.ts     — pure event-folding logic (foldSwarmEvents)
  tools.ts      — Orchestrator tool definitions
  panel-model.ts — `swarm` projection, including Conversation Flow messages
  client/       — session-header Conversation Flow panel
tests/
  plugin.spec.ts — loader smoke + integration tests
```

## Design principles

- All swarm state is written to the session event log under the `swarm/*` namespace. State is reconstructed through `foldSwarmEvents` — the session log is the single source of truth.
- Child agents must be direct children of the Orchestrator (DSH followup authorization constraint).
- Relay attribution through `senderSessionId` enables P2P semantics without new security primitives.
- Lifecycle managed through `ctx.effect()`; tools registered on the Orchestrator agent's tool scope.
- Checkpoint events (`swarm/checkpoint`) enable cold resume by replaying session events.

## Key DSH seams used (Harness 0.2.0-rc.2)

- `ctx.agents` — to identify roots. `ctx.agents.create()` no longer infers
  ownership from the calling context: pass `parentAgent` to create a child (the
  plugin itself only spawns through `ctx.subagents`, which passes it).
- `ctx.sessions` / `session.append()` — to append swarm event records.
- `session.snapshotEvents()` — to read the log for folds and cold resume. The
  synchronous history readers are deprecated in 0.2.0; new first-party callers
  are expected to use projections instead. This out-of-repo plugin keeps the
  readers because its fold is the projection it cannot rebuild retroactively.
- `ctx.tools` — to register Orchestrator tools.
- `@deepseek-ai/dsh-subagent/internal` `queueHostSubagentPrompt()` — host-only
  relay delivery with an explicit `senderSessionId` attribution. The public
  `ctx.subagents.sendMessage()` replaces the removed `followup()` but derives
  attribution from the exact live sender, which cannot express peer routes.
- `ctx.userQuestions.ask()` — answerers register on the `user-questions/request`
  event; continuable children also require `@deepseek-ai/dsh-session-query` in
  the host composition.
- `ctx.effect()` — for lifecycle management.

## Module naming

The npm package is `dsh-swarm-panel`. All source files use `@module dsh-swarm-panel` JSDoc tags. No `@deepseek-ai/` scope is used — this is an independent community plugin.
