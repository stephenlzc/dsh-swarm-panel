# Conversation Flow design QA

## Evidence

- Source visual truth: `/var/folders/fy/vl6f7msn3nn8jhk04kj89qn40000gn/T/codex-clipboard-8243a09a-b8e8-4d00-bc8e-d27b1fe4139e.png` (1488 × 1057 px, desktop light theme, populated Conversation Flow state with 24 messages and one selected peer update).
- Implementation capture: `plugins/dsh-swarm-plugin/assets/swarm-panel.png` (1488 × 1057 px, Chromium, CSS viewport 1488 × 1057, device scale factor 1).
- Implementation state: built `dsh-agent-swarm/client` bundle rendered with a 24-message projection fixture containing parent-child, peer, group, and Human/HITL rows; message 17 selected in the details panel.
- The implementation capture contains the plugin-owned Conversation Flow page only. The left workspace sidebar and the Chat/Trajectory tab chrome in the source are host-owned by the Web shell and are excluded from the focused comparison.

## Comparison

The focused panel comparison confirms the same information hierarchy: topology summary and role status at the top, route legend, count-bearing filters, time-ordered swimlanes with directional connectors, a Human waiting state, a selected-message inspector, and a Live follow control. Route semantics are written in badges as well as expressed by solid/dashed connectors, so color is not the only signal.

The implementation uses a compact inline-styled layout rather than the source's icon-heavy visual language. This is an intentional package boundary: the plugin consumes the host UI tokens and slot layout but does not own the Web shell's brand, sidebar, or tab chrome. The remaining differences are P3 polish: iconography, exact typography, and the inspector's compact metadata layout.

## Primary interactions checked

- Clicked a peer message in the rendered bundle and confirmed the selected row and details panel updated.
- Confirmed route, attribution, sender session, recipient session, content, copy actions, and child-session actions rendered for the selected message.
- Toggled Live follow and confirmed the visible state changed without changing projection data.
- Browser console and page-error listeners recorded no messages during the capture.

## Iteration history

- Initial repository asset showed the empty `0 messages` state and could not demonstrate the requested populated flow.
- Re-rendered the built client bundle with the populated projection fixture and replaced the README asset with the selected-message state shown above.

## Findings

- No actionable P0, P1, or P2 visual or interaction issue remains in the plugin-owned panel state.
- P3 follow-up: align the plugin's role icons and inspector disclosure rows with the host shell's icon primitives when the host makes those primitives part of the plugin's declared browser dependency surface.

## Implementation checklist

- [x] Projection preserves routed messages and computes parent/peer attribution.
- [x] The client registers the Conversation Flow tab and header swarm count.
- [x] Topology, route filters, agent/search filters, lanes, connectors, details, HITL, and Live follow render in the populated state.
- [x] Focused Chromium capture is saved in the package asset.
- [x] Browser render completed without console or page errors.

final result: passed
