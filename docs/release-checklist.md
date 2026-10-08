# Release checklist

This file is the maintainer checklist for `dsh-swarm-panel`. It separates what is proven by the current repository from what must be repeated for a new release.

## Release gates

| Gate | Evidence | Status |
| --- | --- | --- |
| Package metadata and built entrypoints | `npm pack --dry-run --json` | Passes locally; 14 files, 919 KB tarball |
| Host/client TypeScript | `CI=true tsc --noEmit` and client project check | Passes locally |
| Plugin unit/integration tests | `CI=true vitest run` | Passes locally: 84 passed, 1 skipped |
| Host-composed browser flow | `tests/host/conversation-flow.e2e.ts` | Passes locally |
| Manual browser interaction | In-app browser evidence | Passes for the documented scenarios |
| Responsive layout | 390×844 browser viewport, no horizontal overflow | Passes locally |
| Keyless CI | `.github/workflows/ci.yml` | Passes: public Actions run `32736107342` has all three jobs green |
| Real API smoke | `tests/cold-resume.e2e.ts` with `DEEPSEEK_API_KEY` | Passes: 1 test passed with an out-of-band key; no credential was persisted |
| GitHub repository | public remote and Actions result | Passes: `stephenlzc/dsh-swarm-panel` is public and `main` is green |
| npm publication | published package install and `dsh plugin add` | Tarball install passed in temporary `tarball`, `web`, and `headless` profiles; npm publication remains intentionally pending |

## Harness 0.2.0-rc.2 re-verification (2026-10-08)

- The supported peer/workspace target moved to Harness tag `dsh-v0.2.0-rc.2` (the runtime shipped by the current desktop app). When mounting this checkout into that workspace, add `plugins/*` to its `pnpm-workspace.yaml`; 0.2.0 no longer ships that glob.
- TypeScript host + client checks and the 93 keyless tests pass against published `0.2.0-rc.2` packages.
- `tsdown` builds; the emitted host and client bundles smoke-load against the 0.2.0 runtime (the client bundle routes navigation through `uiWorkspace.openSession`).
- The host-composed browser E2E passed from a `dsh-v0.2.0-rc.2` checkout (real web shell + chromium); the test needed four 0.2.0 fixture/scaffold fixes documented in the compatibility note.
- Still to repeat before a release: the real-API cold-resume test (needs `DEEPSEEK_API_KEY`) and the tarball install into a temporary profile.
- Full breakage/repair list and reinstall guidance: [harness-0.2-compatibility.md](harness-0.2-compatibility.md).

## Before tagging

1. Confirm the supported DeepSeek Harness version and update the peer ranges in `dsh-swarm-plugin/package.json` (current target: the `0.2.x` line, verified at `^0.2.0-rc.2`).
2. Run the keyless gates from a clean checkout.
3. Run the real-API cold-resume test with the key supplied through the environment or DSH credentials. Never commit the key or place it in a screenshot, log, or recording.
4. Run `npm pack --dry-run --json` and inspect the final file list.
5. Install the generated tarball into a compatible Harness profile and open the Conversation Flow tab.
6. Re-record the gallery only from synthetic or redacted data.
7. Create the GitHub release tag only after the public Actions workflow is green.

## Current public-repo handoff

- The root README is the GitHub landing page; the plugin README remains the detailed API and configuration reference.
- `dsh-swarm-plugin/assets/` contains the package screenshot gallery and the short Conversation Flow tour GIF. `docs/screenshots/` contains the fresh in-app-browser audit captures.
- Browser captures prove the current host composition and interaction states: overview, inspector, route filtering, search empty state, Live pause/resume, HITL focus, child-session navigation, and 390×844 layout.
- The child-session navigation check used a keyless fixture without child replay responses, so it correctly exposed the fixture's expected model-call failure after navigation; it is not evidence of a live API failure.
- The current candidate has completed the real-API cold-resume test and final tarball installation in temporary compatible profiles. Repeat both for any later runtime change.

## Evidence policy

- `dsh-swarm-plugin/assets/swarm-panel.png` is the canonical package screenshot.
- The `swarm-panel-host-*.png` files are GitHub gallery evidence; they are not runtime dependencies.
- Browser logs are local diagnostics and are ignored by Git.
- Replay fixtures prove host/UI composition, not live model quality.
- A passing typecheck or unit test does not prove pixel fidelity, real API behavior, or successful external installation.

## Deliberately deferred

Export, nested sub-swarms, A2A/ACP bridging, automatic memory injection into turn prompts, and panel localization remain documented product limitations rather than release blockers for the current scope.
