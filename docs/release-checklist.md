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
| Keyless CI | `.github/workflows/ci.yml` | Workflow now covers metadata, pack, Harness typecheck, tests, and build; first public Actions run pending |
| Real API smoke | `tests/cold-resume.e2e.ts` with `DEEPSEEK_API_KEY` | Run before a runtime release |
| GitHub repository | public remote and Actions result | Pending repository creation and first green Actions run |
| npm publication | published package install and `dsh plugin add` | Tarball install/import smoke passes locally; npm publication and `dsh plugin add` remain pending |

## Before tagging

1. Confirm the supported DeepSeek Harness version and update the peer ranges in `dsh-swarm-plugin/package.json`.
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
- Before public release, run the real-API cold-resume test with credentials supplied out-of-band and install the final tarball into the matching Harness profile.

## Evidence policy

- `dsh-swarm-plugin/assets/swarm-panel.png` is the canonical package screenshot.
- The `swarm-panel-host-*.png` files are GitHub gallery evidence; they are not runtime dependencies.
- Browser logs are local diagnostics and are ignored by Git.
- Replay fixtures prove host/UI composition, not live model quality.
- A passing typecheck or unit test does not prove pixel fidelity, real API behavior, or successful external installation.

## Deliberately deferred

Export, nested sub-swarms, A2A/ACP bridging, automatic memory injection into turn prompts, and panel localization remain documented product limitations rather than release blockers for the current scope.
