# Changelog

All notable changes to **dsh-swarm-panel** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-10-08

First release of the 1.0 line. This is a **compatibility + robustness** release:
the plugin now runs on the DeepSeek Harness `0.2.0-rc.2` runtime that the current
desktop app ships, and all 16 findings of an adversarial robustness audit are
resolved (or explicitly dispositioned).

### ⚠️ Upgrade notes (read before installing)

- **Harness target moved from `0.1.0-rc.7` to `0.2.0-rc.2`.** Every peer range is
  now `^0.2.0-rc.2`. A build prepared for `0.1.0-rc.7` does **not** load on the
  0.2.0 runtime, and vice versa.
- **Reinstall is required.** `dsh plugin --profile <profile> add file:<checkout>/dsh-swarm-plugin`
  (or re-`add` the published/GitHub package). Updating in place is not enough: the
  old bundle imports packages and APIs that no longer exist.
- **Never install this plugin into the reserved `desktop` profile**
  (`dsh plugin --profile desktop add …`). Installing there leaves a profile-local
  `node_modules/` with duplicate `@deepseek-ai/dsh-tools`/`dsh-brand` copies and a
  `pnpm-lock.yaml`, which changes the app's module resolution and makes **every
  turn fail with `Cannot read properties of undefined (reading 'prepare')`**.
  Restarting the app, opening a new session, or unloading the plugin does not fix
  it — only restoring the profile directory does. Verify plugins in an isolated
  profile instead:
  ```bash
  # The desktop app launcher is not on PATH; adjust the path if needed.
  # Download the asset first: adding a release URL directly fails pnpm's
  # tarball-integrity check (ERR_PNPM_MISSING_TARBALL_INTEGRITY).
  DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
  curl -sSL -o /tmp/dsh-swarm-panel-1.0.1.tgz \
    https://github.com/stephenlzc/dsh-swarm-panel/releases/download/v1.0.1/dsh-swarm-panel-1.0.1.tgz
  "$DSH" plugin --profile dswarm add /tmp/dsh-swarm-panel-1.0.1.tgz
  "$DSH" --profile dswarm --dump-config | grep -A2 swarm
  rm -rf ~/.dsh/profiles/dswarm   # when done
  ```
- Sessions written by this plugin contain `swarm/*` events. They are readable
  **while the plugin is loaded**; the Harness offers no way for an out-of-repo
  plugin to mark its events `ignorable`, so opening such a session without the
  plugin is refused by the persistence layer. If you must temporarily disable the
  plugin, set `keepEventVocabularyWhenDisabled: true` (see Added).

### Added

- `turnTimeoutMs` configuration (default `300000`, i.e. 5 minutes). A group-chat
  turn that gets no reply ends the chat with `turn-timeout` instead of leaving the
  tool call pending forever.
- `keepEventVocabularyWhenDisabled` configuration. With `enabled: false` the plugin
  normally registers nothing; this switch keeps only the durable `swarm/*` event
  vocabulary registered so previously written sessions stay loadable.
- `SwarmRuntime.beginTurn()`/`endTurn()` — an explicit single-turn mutex; a second
  concurrent `swarm_next_turn` on the same swarm returns
  `unavailable: another turn is already in flight`.
- `SwarmRuntime.markChildSettled()` — settles the role owning one child session
  (available to hosts that can report a terminal child end).
- `RoleTurnError` — exposes why a turn stopped (`interrupted` | `timeout`) so the
  engine can end the chat with a real reason.
- `tests/robustness.spec.ts` — 10 regression tests pinning the lifecycle fixes.
- `docs/harness-0.2-compatibility.md` — the full breakage/repair list for the
  0.2.0 upgrade, plus the desktop-profile incident and reinstall guidance.
- `docs/robustness-audit-2026-10-08.md` (+ `…-probes/`) — the adversarial audit:
  16 findings with file:line references, raw reproduction output, minimal fixes,
  and the repair status table.

### Changed — DeepSeek Harness 0.2.0-rc.2 compatibility

| Area | Was (0.1.0-rc.7) | Now (0.2.0-rc.2) |
| --- | --- | --- |
| Peer/dependency ranges | `^0.1.0-rc.7`, `dsh-brand ^0.0.1-rc.1` | `^0.2.0-rc.2` |
| Client context package | `@deepseek-ai/dsh-client-runtime` re-exported `ClientContext` | package removed upstream; `Context` comes from `@deepseek-ai/cordis`, `SessionId` from `@deepseek-ai/dsh-session/types` |
| Session log read | `session.events` property | `session.snapshotEvents()` (the synchronous readers are deprecated upstream) |
| Subagent delivery | `ctx.subagents.followup()` with a custom `senderSessionId` | `queueHostSubagentPrompt()` from `@deepseek-ai/dsh-subagent/internal` (the public `sendMessage()` derives attribution from the live sender and cannot express peer routes) |
| Session projection | `{ schema, view }` | `{ stateSchema, wire: { viewSchema, view } }`, `init(header, inheritedEventCount)` |
| Client navigation | `ctx.sessions.open(id)` | `ctx.uiWorkspace.openSession(id)`; `inject: ['uiWorkspace','slots']` |
| Client slot/types | runtime re-exports | explicit `ui-renderer/client` (`ctx.slots`) and `ui-session/client` (`sessionId`, `useProjection`) merges |
| `dsh.client.inject` | `[dsh-client-runtime, dsh-client-ui-conversation]` | `[dsh-client-ui-conversation, dsh-client-ui-workspace]` |
| Web module table (tsdown) | included removed `dsh-client-web-react`/`dsh-client-schema-form`/`dsh-client-ui-attachment` | the 0.2.0 platform table (react, cordis, client-store, ui-slots, ui-primitives, ui-dockkit) |
| Source workspace | CI linked the plugin into `harness/plugins/` | Harness 0.2.0 dropped both the `plugins/*` glob and `linkWorkspacePackages: true`; CI now restores them (without the latter the plugin resolves duplicate registry copies and branded-symbol identity breaks) |

### Fixed — robustness (adversarial audit G4-01…G4-16)

**High**

- **G4-01** `awaitChildReply` could record the **previous** turn's reply as the
  current one: the inbox accepts a delivery before its `user/message` is appended,
  and a watermark miss fell back to scanning the whole log. A miss is now
  "not ready yet", bounded by `turnTimeoutMs`.
- **G4-02** (mitigated) Corrected the comment that contradicted the Harness design
  and added `keepEventVocabularyWhenDisabled`; the upstream gap (no `ignorable`
  write path for out-of-repo events) remains and is documented.

**Medium**

- **G4-03** `terminate()`/`interrupt()` are exception-safe: a rejected
  `subagents.interrupt` (for example `UNAUTHORIZED`) no longer leaves the swarm
  half-terminated. `swarm/destroyed` is written first, then children are
  interrupted best-effort, and every interrupted role still gets its durable
  `swarm/role-exited`.
- **G4-04** A terminated swarm accepts no new role: `assertActive` plus a
  tool-level `invalid_argument`.
- **G4-05** Re-spawning a named role interrupts the child it replaces instead of
  leaking it.
- **G4-06** A terminated swarm cannot park on HITL; a repeated `swarm_terminate`
  still cancels a late wait.
- **G4-08** A speaker interrupted mid-turn no longer drops the reply silently or
  hangs the tool call: per-role cancellation plus `RoleTurnError` end the chat with
  `role-interrupted`/`turn-timeout`/`swarm-terminated`, and
  `recordGroupMessage` reports a vanished role instead of throwing.
- **G4-09** Cold resume re-spawns a role only when the host reports a genuinely
  missing child (`SubagentError` code `NOT_RESUMABLE`); transient failures keep the
  durable child and log a warning.

**Low / informational**

- **G4-10** The in-process event vocabulary is reference counted, so unloading one
  plugin instance no longer unregisters it for another.
- **G4-11** `state()` is memoized on (log length, topology, memory limit) and the
  `hitl-<n>`/`mem-<n>` counters live in memory (reseeding once on hydrate) instead
  of rescanning the whole session log on every tool call.
- **G4-12** Panel projection: a repeated HITL request id is upserted; `destroyed`
  closes the active chat; the group transcript is windowed like the flow; an
  explicit `peer` attribution only applies in `mixed` topology.
- **G4-13** `chat.startedAt` is optional in the projection schema with an
  `asString` fallback, so a foreign writer cannot make restore fail hard.
- **G4-14** `swarm/resumed` is no longer appended after `swarm/destroyed`.
- **G4-16** Explicit single-turn mutex (see Added).

**Deliberately not wired**

- **G4-07** The audit suggested retiring a role when the host reports
  `subagent-settled`. Measurement showed that notice marks the end of **one
  activation**, not the end of the role — the same durable child can still be woken
  by a followup. Wiring it broke the chat engine outright (7 regressions: the
  speaker roster emptied after the spawn turn), so the plugin does not consume it.
  The reasoning is recorded next to the code and `markChildSettled` stays available.
- **G4-15** (documentation only) The Harness has no human message source, so an
  operator answer is delivered with the orchestrator's `agent-message` attribution;
  the panel's "human" label is nominal.

### Fixed — build, packaging and tests

- `lib/` is rebuilt through the CI path
  (`pnpm --filter dsh-swarm-panel run build`). The previously committed artifacts
  were produced from a temporary manifest whose `workspace:*` devDependencies had
  been rewritten, and no longer matched the CI output
  (`index.js` 88370 → 88389 B, `index.d.ts` 194159 → 194060 B,
  `client.js` 52148 → 52115 B). A byte-identical rebuild is now asserted.
- Host E2E compatibility: the fixture moved to
  `snapshots/web/lifecycle-chrome/session.v4.jsonl`; the scaffold profile installs
  the package (`profile.packages`), otherwise the loader reports
  `dsh-swarm-panel: failed to import`; injected v4 fixture rows carry no
  `seq`/`time` and must be marked `ignorable: true`; the shell is reached through
  `scaffold.authenticatedUrl`.
- The host E2E is now **layout-agnostic** (candidate-path detection plus dynamic
  imports, `DSH_HARNESS_ROOT` override), so it runs both from the plugin checkout
  and from a package mounted at `<harness>/plugins/dsh-swarm-panel` without a
  fixture symlink.
- Test fixtures updated for 0.2.0: `mountAgentLoopTestDependencies` already mounts
  the projection registry; `ctx.agents.create()` needs an explicit
  `parentAgent`; `CallId` → `ToolCallId`; answerers register on the
  `user-questions/request` waterfall; continuable children need
  `@deepseek-ai/dsh-session-query`; delivery spies target `deliverSubagentPrompt`.
- The cold-resume mock now rejects with `SubagentError(NOT_RESUMABLE)`, modelling
  the host so G4-09 is actually exercised; the resume snapshot records the new
  `role-exited` fact from G4-05.

### Known limitations

- Out-of-repo `swarm/*` events cannot be marked `ignorable` (upstream gap, G4-02).
  Loading this plugin is a hard prerequisite for opening its sessions.
- `G4-07` (above) is intentionally not wired.
- Operator answers carry orchestrator attribution (G4-15).
- `tests/cold-resume.e2e.ts` needs `DEEPSEEK_API_KEY` and self-skips without it.
- Export, nested sub-swarms, A2A/ACP bridging and panel localization remain out of
  scope for this release.

### Verification

- `tsc --noEmit` (host) and `tsc --noEmit -p tsconfig.client.json` (client): 0 errors.
- `vitest run`: **93 passed / 2 skipped** (95 total). The skips are the key-gated
  real-API cold-resume and the intentionally deferred G4-07 assertion.
- `tsdown` build through the CI path: byte-identical to the committed `lib/`.
- Host-composed browser E2E in the real web shell (Chromium, no fixture symlink):
  **1 passed**.
- Manual compatibility check: `dsh plugin --profile dswarmverify add` installs the
  package, appends the bundle, and `--dump-config` composes the plugin entry.

[1.0.1]: https://github.com/stephenlzc/dsh-swarm-panel/releases/tag/v1.0.1
