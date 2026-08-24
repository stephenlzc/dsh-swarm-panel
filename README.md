# dsh-swarm-panel

[English](README.md) · [中文](README.zh-CN.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

[![CI](https://github.com/stephenlzc/dsh-swarm-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/stephenlzc/dsh-swarm-panel/actions/workflows/ci.yml)

Conversation Flow observability for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): watch an Orchestrator coordinate child agents, inspect routed messages, follow topology changes, and open any child session from the web UI.

![Conversation Flow overview](dsh-swarm-plugin/assets/swarm-panel.png)

This repository is the standalone `dsh-swarm-panel` plugin. It is not the same package as the historical `dsh-agent-swarm` plugin that lived inside a Harness checkout.

## What it adds

- A durable swarm runtime with parent-child, peer-to-peer, and mixed routing.
- Checkpoints and cold-resume recovery from the session event log.
- Group chat turns, shared context, lightweight memory, and human-in-the-loop pauses.
- A host-composed Conversation Flow tab with topology, swimlanes, route filters, message inspection, Live follow, and child-session navigation.

## UI gallery

The gallery uses a deterministic populated fixture so the screenshots show every important visual state without exposing a real workspace or API credential.

| Desktop overview | Message inspector |
| --- | --- |
| ![Desktop overview](dsh-swarm-plugin/assets/swarm-panel-host-desktop.png) | ![Message inspector](dsh-swarm-plugin/assets/swarm-panel-host.png) |

| Responsive layout | Topology and Human input |
| --- | --- |
| ![Responsive Conversation Flow](dsh-swarm-plugin/assets/swarm-panel-host-narrow.png) | ![Topology and Human input](dsh-swarm-plugin/assets/swarm-panel.png) |

The screenshots intentionally show a pending Human input card, Error role status, parent-child and peer routes, a selected message, and the host shell around the plugin-owned panel.

### Short tour

![Conversation Flow tour](dsh-swarm-plugin/assets/conversation-flow-tour.gif)

The tour moves through the desktop overview, selected-message inspector, and 390×844 responsive layout. It is assembled from the same deterministic replay fixture used by the keyless UI checks; no model output or credential is embedded.

## Quick start

The plugin runs inside a compatible DeepSeek Harness installation. Install Harness first, then install this package into the `web` profile.

### After npm publication

```bash
dsh plugin --profile web add dsh-swarm-panel
dsh web
```

The GitHub repository is the current distribution source until the npm package is published; use the checkout instructions below today.

Create or open a session, ask the Orchestrator to create a swarm, and open the **Conversation Flow** tab next to Chat and Trajectory.

### Directly from GitHub

The package currently lives in the `dsh-swarm-plugin/` subdirectory of this repository. Install that package directly from GitHub with pnpm's Git subdirectory syntax:

```bash
dsh plugin --profile web add 'github:stephenlzc/dsh-swarm-panel#path:dsh-swarm-plugin'
dsh web
```

For a reproducible install, pin the GitHub reference to a commit:

```bash
dsh plugin --profile web add \
  'github:stephenlzc/dsh-swarm-panel#path:dsh-swarm-plugin&<commit-sha>'
```

GitHub installs use the repository's committed build artifacts and are best suited to development snapshots. For the stable registry release, use the npm command above after publication. Git-hosted dependencies can run install-time code; inspect and trust the source before installing.

### From this checkout

```bash
git clone https://github.com/stephenlzc/dsh-swarm-panel.git
dsh plugin --profile web add file:./dsh-swarm-panel/dsh-swarm-plugin
dsh web
```

The source checkout's typecheck and tests require a matching DeepSeek Harness source checkout because the plugin's development dependencies use the Harness workspace packages.

The package manifest is publishable independently: runtime peers use the public Harness release ranges, while the source workspace keeps `workspace:*` only in development dependencies.

## Runnable code-review example

The repository includes a real Harness overlay at [`dsh-swarm-plugin/examples/coding-squad/cordis.yml`](dsh-swarm-plugin/examples/coding-squad/cordis.yml). From a DeepSeek Harness checkout with this repository available at `../dsh-swarm-panel`:

```bash
export DEEPSEEK_API_KEY=... # keep credentials in the environment or DSH credential store
pnpm dsh --profile headless \
  --patch ../dsh-swarm-panel/dsh-swarm-plugin/examples/coding-squad/cordis.yml \
  "review the pending PR"
```

The example asks one Orchestrator to spawn planner, security, and correctness roles, exchange findings, record a verdict, and checkpoint the swarm. The web profile shows the same durable events in Conversation Flow.

## Supported environment

| Component | Release target |
| --- | --- |
| DeepSeek Harness | `0.1.0-rc.7` workspace API and compatible releases |
| Node.js | `22.19+` or Node `24+` |
| Browser | DeepSeek Harness `web` profile |
| Package | `dsh-swarm-panel@0.1.0` |

The package currently targets the Harness `0.1.x` release line. Keep the plugin and Harness versions aligned when upgrading.

## Verification status

The current release candidate has been checked with:

- 84 keyless plugin tests passed; the key-gated real-API cold-resume test also passed (1 test).
- Host-composed browser E2E passed in the real web shell.
- TypeScript host and client checks passed.
- Manual in-app browser interaction covered details, route and Agent filters, search empty state, Clear filters, Live pause/resume, Human input, child-session navigation, keyboard coexistence, and a 390×844 viewport.
- `npm pack --dry-run` contains the built runtime, declarations, client bundle, patch, README, license, and canonical screenshot.
- The final tarball installed successfully through `dsh plugin add` into temporary compatible `tarball`, `web`, and `headless` profiles; the web profile booted the Harness shell with the package installed.
- The repository includes a redacted, deterministic UI tour GIF and a fresh in-app-browser audit set under `docs/screenshots/`.

The keyless browser fixture proves UI and host composition, while the separate cold-resume run proves the live runtime path. npm publication and a tagged GitHub release are still maintainer actions; the current repository is the download source until those are authorized.

## Scope and known limitations

- Export is not implemented because the current projection has no export data source.
- A2A / ACP external protocol bridging is not included.
- Nested sub-swarms are intentionally not included; the current model has one Orchestrator level.
- Memory is Orchestrator-owned lexical retrieval; it is not automatically injected into every turn prompt and is not shown as a separate panel.
- The panel copy is currently English-only.
- Source-level development still depends on a matching Harness workspace; the published package is the consumer installation path.
- The bundled example makes a real model call; it is intentionally not run by keyless CI.

See the detailed [plugin README](dsh-swarm-plugin/README.md), [Chinese plugin README](dsh-swarm-plugin/README.zh.md), and [release checklist](docs/release-checklist.md) for configuration, tool reference, development commands, and the evidence behind this status.

## Repository layout

```text
dsh-swarm-panel/
├── dsh-swarm-plugin/       # package source, built artifacts, tests, example, and gallery assets
├── docs/                   # release checklist and design/research history
└── .github/workflows/      # package and source verification gates
```

## License

MIT. See [`dsh-swarm-plugin/LICENSE`](dsh-swarm-plugin/LICENSE).

## Call for Issues and Pull Requests

Found a bug, have an idea, or want to improve the plugin? Please open an [issue](https://github.com/stephenlzc/dsh-swarm-panel/issues) or submit a [pull request](https://github.com/stephenlzc/dsh-swarm-panel/pulls).

Forks are welcome. Feel free to build your own extensions, UI improvements, integrations, and workflow experiments on top of `dsh-swarm-panel`.
