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

## Key DSH seams used

- `ctx.agents` — to create child agents and identify roots
- `ctx.sessions` — to append swarm event records
- `ctx.tools` — to register Orchestrator tools
- `ctx.subagents.followup()` — for relay routing with `senderSessionId` attribution
- `ctx.effect()` — for lifecycle management

## Module naming

The npm package is `dsh-swarm-panel`. All source files use `@module dsh-swarm-panel` JSDoc tags. No `@deepseek-ai/` scope is used — this is an independent community plugin.
