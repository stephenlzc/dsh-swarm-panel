# dsh-swarm-plugin Conversation Flow — clone-fidelity review

Recommendation: **REQUEST_CHANGES**

Scope: independent, read-only review of the current worktree against the supplied reference image. Product files were not edited. This report is the sole review artifact.

## Evidence inspected

- Reference: `/var/folders/fy/vl6f7msn3nn8jhk04kj89qn40000gn/T/codex-clipboard-8243a09a-b8e8-4d00-bc8e-d27b1fe4139e.png` (1487 × 1058).
- Claimed implementation capture: `plugins/dsh-swarm-plugin/assets/swarm-panel.png` (1488 × 1057).
- Current implementation: `plugins/dsh-swarm-plugin/src/client/SwarmAction.ts`, `plugins/dsh-swarm-plugin/src/client/index.ts`.
- Host composition: `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`.
- Existing implementation claim: `design-qa.md`.
- Client tests: `plugins/dsh-swarm-plugin/tests/swarm-action.client.spec.ts`.

Positive verification: the implementation is live React DOM, not a pasted/raster UI. The renderer uses `createElement` and projection data (`SwarmAction.ts:9-12`, `SwarmAction.ts:576-628`, `SwarmAction.ts:784-952`); a source search found no reference to `swarm-panel.png`, `<img>`, or CSS `background-image` under the plugin source/tests. This does not offset the findings below.

The evidence is not synchronized: at review time `SwarmAction.ts` was modified 431 seconds after `assets/swarm-panel.png` (and 761 seconds after `design-qa.md`). The current source now contains `overview`, `topologyCard`, and changed card sizing that are absent from the supplied implementation capture (`SwarmAction.ts:63-91`, `SwarmAction.ts:784-825`). Therefore the image cannot establish fidelity of the current code.

## Findings

### CRITICAL

None. No screenshot/raster substitution was found.

### HIGH

#### H1 — Current implementation has no valid rendered fidelity evidence

The only implementation image omits the reference's shell and is older than the current renderer. It shows neither the host sidebar/header/tab chrome nor the current source's revised overview layout. `design-qa.md` asserts that this omission is intentional, but that is not a verification of the target image. The host is expected to render the tab chrome (`ConversationSession.tsx:110-124`) and active view (`ConversationSession.tsx:167-171`), while the plugin registers the third tab (`plugins/dsh-swarm-plugin/src/client/index.ts:36-52`); no integrated current capture proves the composition.

Impact: there is no evidence that the current worktree visually matches the supplied 1487 × 1058 reference, so a clone-fidelity approval would be unsupported.

Scope: shared. The missing sidebar/header/tab pixels are **host shell** responsibility; capturing the plugin in that real host path is a **plugin delivery/QA** responsibility.

#### H2 — Styling is not a token-driven, reused design system

`SwarmAction.ts` hand-builds the complete UI with inline `CSSProperties` and native elements. It imports no host visual primitive (`SwarmAction.ts:9-12`) and defines one-off spacing, radii, typography, layout widths, and literal fallbacks throughout (`SwarmAction.ts:39-306`, `SwarmAction.ts:537-547`). Examples include `#fff`, `#edf4ff`, `#9b7ed9`, `#7aa2e3`, `10px`/`11px`/`12px` type, and bespoke 5–16 px spacing. Repository UI modules use the established `--dsw-alias-*` tokens directly, but this renderer falls back to bespoke hex values for most visual decisions.

Impact: it cannot inherit dark theme, density, focus, control, and palette changes consistently, and it visibly diverges from the reference's shared control, icon, and card language. This fails the requested/PRD design-system reuse requirement.

Scope: **plugin** for extracting its styles and consuming an exposed visual surface; **host shell** only if the necessary primitives/tokens are not presently public to external plugins.

#### H3 — Keyboard and ARIA model is not scoped or semantically coherent

Every message row is a focusable `div role="button"` that carries `aria-selected` (`SwarmAction.ts:577-587`, `SwarmAction.ts:602-613`), although selection state needs a listbox/grid/tab-like parent/child model rather than generic buttons. More seriously, each rendered swarm attaches a `window` keydown handler; all Up/Down arrows are prevented unless focus is in INPUT/SELECT/TEXTAREA (`SwarmAction.ts:725-744`). This also intercepts keys while focus is in the host tablist, header controls, links, or another swarm. The test explicitly enshrines the global behavior by dispatching to `window` (`swarm-action.client.spec.ts:309-324`), but does not exercise host coexistence or assistive technology semantics.

Impact: keyboard navigation can regress outside the panel; screen-reader users receive an incoherent selection model and excessive tab stops rather than a navigable message collection.

Scope: **plugin**.

### MEDIUM

#### M1 — The supplied panel capture does not faithfully reproduce the reference canvas language

In the supplied image, topology is text-and-dot nodes, the legend collapses the reference's distinct Active/Idle/Completed/Error states, cards are much taller and use a destination pill, and connectors are flat horizontal rules. The reference uses role icons, compact cards, a time-grid canvas with vertical lane boundaries, and directional elbow connectors. The current renderer still implements connectors as a border line with no arrowhead (`SwarmAction.ts:537-547`) and renders destination as a separate pill (`SwarmAction.ts:616-628`); role state only distinguishes running, waiting, and a generic exited outcome (`SwarmAction.ts:530-534`, `SwarmAction.ts:822-824`).

Impact: route direction and role state scan less like the target, and the visual hierarchy is materially different even before the stale-capture problem.

Scope: **plugin**. Role icon primitives may need a host-provided public dependency, but the information and layout belong to the panel.

#### M2 — Small text/status combinations miss the AA contrast target

The current time label is 10 px (`SwarmAction.ts:191-192`) and uses `#737a81` as its fallback on `#f7f8f9`; its calculated contrast is 4.09:1. The amber warning fallback `#a56b00` on `#fff4df` is likewise 4.09:1 (`SwarmAction.ts:231-233`, `SwarmAction.ts:290-296`). Both are below 4.5:1 for normal text, and their font sizes amplify the usability issue.

Impact: time and warning information may not meet WCAG 2 AA contrast expectations in the fallback/theme-loss path.

Scope: **plugin**.

### LOW

#### L1 — The existing QA conclusion overstates what its artifact proves

`design-qa.md` calls the remaining differences P3 and reports a pass, yet it relies on the stale, plugin-only asset and does not show a current host-composed render or an accessibility audit. Its artifact paths are present, so this is not a missing-evidence-path claim; it is an unsupported success conclusion.

Scope: **plugin QA/documentation**.

## Executable repair order

| Priority | Action | Owner |
| --- | --- | --- |
| P0 | None identified. | — |
| P1 | Replace inline ad-hoc control/card styles with the stable host design-token and component surface; if external plugins lack that surface, define a narrow host-supported injection/export first. Remove raw color/spacing/type fallbacks for normal styling. | Plugin; host only for the missing public surface |
| P1 | Scope keyboard handling to a focused flow collection and implement a single semantic pattern (for example, roving-tabindex grid/listbox with correct row/cell roles). Do not attach generic Up/Down/Escape handlers to `window`; add host-coexistence and screen-reader-oriented tests. | Plugin |
| P1 | Produce a new deterministic, host-composed Chromium capture at the reference viewport from the current commit/worktree, then run an automated accessibility scan plus keyboard walkthrough. Store command/result paths with it. | Plugin QA; host provides the shell |
| P2 | Rebuild the canvas to match the reference's compact card metrics, visible role status taxonomy, lane grid, icon treatment, and arrowed/elbow route paths using live DOM/SVG rather than images. Re-capture and compare after each structural change. | Plugin; host may expose icons |
| P2 | Make the fallback status/type colors and 10–12 px text meet 4.5:1 or use host semantic tokens that already guarantee it. | Plugin |
| P3 | Update `design-qa.md` only after the new evidence exists; distinguish the host-owned chrome from the plugin-owned panel and remove the unsupported pass claim. | Plugin QA |

## Delivery decision

Not sufficient to deliver. The result is live DOM, but HIGH findings remain: no current integrated visual evidence, no token/primitive-driven system, and unsafe/incoherent keyboard semantics. The recommendation is **REQUEST_CHANGES**.
