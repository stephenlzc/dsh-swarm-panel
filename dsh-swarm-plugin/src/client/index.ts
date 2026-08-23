/**
 * Swarm panel plugin, browser half: contributes the Conversation Flow
 * conversation-view tab and a session-header swarm count over the `swarm`
 * projection. The data arrives entirely through `useProjection('swarm')`
 * (host-folded from `swarm/*` session events), so the plugin issues no RPC
 * and holds no swarm store. The inject face carries the one navigation
 * verb: opening a role's child session.
 *
 * @module dsh-swarm-panel/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the header.actions entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the `swarm` SessionProjectionMap key merge (the domain's pure outlet).
import type {} from '../panel-model.ts'
import { SwarmAction, SwarmConversationView, type SwarmPanelActions } from './SwarmAction.ts'

export { SwarmAction, SwarmConversationView, SwarmPanelView } from './SwarmAction.ts'
export type { SwarmActionProps, SwarmConversationViewProps, SwarmPanelActions, SwarmPanelViewProps } from './SwarmAction.ts'

/** Required services: header-slot contribution and child-session navigation. */
export const inject = ['sessions', 'slots'] as const

/**
 * Client-side configuration (deployment choices, changeable from cordis.yml).
 * Mirrors the host plugin's master switch so the header swarm count and the
 * Conversation Flow tab can be turned off without touching the host runtime.
 */
export interface ClientConfig {
  /**
   * Master switch: when `false`, `apply` short-circuits without registering the
   * header action or the Conversation Flow tab. Defaults to `true`.
   */
  enabled?: boolean
}

/**
 * Client plugin body: register the header action.
 * @param ctx - client root context.
 * @param config - optional client config; `enabled: false` disables the panel.
 */
export function apply(ctx: ClientContext, config: ClientConfig = {}): void {
  // Master switch: skip every slot registration when explicitly disabled.
  if (config.enabled === false) return
  const sessions = ctx.sessions
  const actions = (): SwarmPanelActions => ({
    // The brand is compile-time only; the wire id arrives as a string.
    onOpenSession: (childId) => { sessions.open(childId as SessionId) },
  })
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'swarm-panel',
      // After background jobs: orchestration structure reads after process work.
      order: 30,
      inject: actions,
    }, SwarmAction),
  )
  ctx.slots.inject(
    'conversation.view',
    () => ctx.slots.register({
      name: 'conversation.view',
      id: 'conversation-flow',
      // After Chat (0) and Trajectory (10): the swarm canvas is a third view.
      order: 20,
      label: () => 'Conversation Flow',
      inject: actions,
    }, SwarmConversationView),
  )
}
