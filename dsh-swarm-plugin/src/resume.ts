/**
 * Cold resume: rebuild swarm runtimes from the durable session event log and
 * re-establish their child agents after a host restart.
 *
 * Resume runs in two phases when the plugin attaches to an agent whose session
 * already carries `swarm/*` events. {@link hydrateSwarmRuntimes} synchronously
 * restores each runtime's role map, topology, and termination from the fold, so
 * tools never observe a missing runtime. {@link reactivateSwarmRoles} then
 * re-establishes every running role in the background: a role whose durable
 * child session survives is cold-resumed through `followup()` with its history
 * intact, while a role whose child session was lost is re-spawned from its
 * recorded definition and its inbound `swarm/role-message` history is replayed.
 * Each reactivated swarm appends one `swarm/resumed` fact naming the recovery
 * point and every role's outcome.
 *
 * @module dsh-swarm-panel
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: merges `subagents` onto Context.
import type {} from '@deepseek-ai/dsh-subagent'
import type { RoleResumeRecord, RoleState, SwarmId } from './types.ts'
import {
  collectSwarmIds,
  foldSwarmEvents,
  inboundMessages,
  latestCheckpointAt,
} from './domain.ts'
import { SwarmRuntime, type SwarmRuntimeConfig } from './runtime.ts'

/** Render the recovery notice delivered to a cold-resumed child. */
function renderResumeNotice(swarmId: SwarmId, roleName: string, fromCheckpoint: string | undefined): string {
  return [
    '[SWARM RESUMED]',
    'The host process restarted. The swarm was restored from its durable session log.',
    `swarm_id_json: ${JSON.stringify(swarmId)}`,
    `restored_from_checkpoint: ${fromCheckpoint ?? 'none'}`,
    `role_json: ${JSON.stringify(roleName)}`,
    'Your message history is intact. Continue in your role.',
  ].join('\n')
}

/** Render the framing that precedes a replayed history in a re-spawned child. */
function renderRestoreFraming(swarmId: SwarmId, roleName: string): string {
  return [
    '[SWARM RESTORED]',
    'The host process restarted and your previous session was lost. You were re-created from the durable orchestrator log.',
    `swarm_id_json: ${JSON.stringify(swarmId)}`,
    `role_json: ${JSON.stringify(roleName)}`,
    'Your restored inbound message history follows in its original order.',
  ].join('\n')
}

/** Render one replayed inbound message for a re-spawned child. */
function renderReplayedMessage(from: string, content: string): string {
  return `[restored message from ${JSON.stringify(from)}]\n${content}`
}

/**
 * Synchronously rebuild every swarm runtime recorded in the agent's session
 * log. Runs inside the `agent/created` listener, before any tool can execute.
 * @param rootCtx - global service context owning `ctx.subagents`.
 * @param agent - the exact live orchestrator whose session is folded.
 * @param runtimes - the per-agent swarm registry to populate.
 * @param config - deployment config (provider, default model).
 * @returns ids of non-terminated swarms that still have running roles and
 *   therefore need child re-establishment.
 */
export function hydrateSwarmRuntimes(
  rootCtx: Context,
  agent: Agent,
  runtimes: Map<string, SwarmRuntime>,
  config: SwarmRuntimeConfig,
): SwarmId[] {
  const pending: SwarmId[] = []
  for (const swarmId of collectSwarmIds(agent.session.events)) {
    if (runtimes.has(swarmId as string)) continue
    const runtime = new SwarmRuntime(rootCtx, agent, swarmId, config)
    const state = foldSwarmEvents(swarmId, agent.session.events, 'parent-child')
    runtime.hydrate(state)
    runtimes.set(swarmId as string, runtime)
    if (!state.terminated && [...state.roles.values()].some(role => role.status === 'running')) {
      pending.push(swarmId)
    }
  }
  return pending
}

/**
 * Re-establish one running role after a restart. The preferred path delivers
 * a resume notice through `followup()`, which cold-resumes the durable child
 * session with its full history. When the child session is gone, the role is
 * re-spawned from its recorded definition and its inbound messages replayed.
 * @returns the role's resume record with its post-resume child id.
 */
async function reactivateOneRole(
  runtime: SwarmRuntime,
  agent: Agent,
  role: RoleState,
  fromCheckpoint: string | undefined,
  signal: AbortSignal,
): Promise<RoleResumeRecord> {
  try {
    await runtime.deliverUnlogged(
      role.roleName,
      renderResumeNotice(runtime.swarmId, role.roleName, fromCheckpoint),
      signal,
    )
    return { roleName: role.roleName, childId: role.childId, action: 'resumed' }
  } catch (error: unknown) {
    signal.throwIfAborted()
    if (runtime.isTerminated) throw error
    // The durable child session is unavailable: fall through to re-spawn.
  }

  const newChildId = await runtime.spawnRole(
    role.roleName,
    role.systemPrompt,
    role.model,
    signal,
  )
  await runtime.deliverUnlogged(
    role.roleName,
    renderRestoreFraming(runtime.swarmId, role.roleName),
    signal,
  )
  for (const message of inboundMessages(runtime.swarmId, agent.session.events, role.roleName)) {
    signal.throwIfAborted()
    await runtime.deliverUnlogged(
      role.roleName,
      renderReplayedMessage(message.from, message.content),
      signal,
    )
  }
  return { roleName: role.roleName, childId: newChildId, action: 'respawned' }
}

/**
 * Re-establish every running role of one hydrated swarm and append the
 * `swarm/resumed` fact. A swarm terminated meanwhile is left alone.
 * @param runtime - the hydrated runtime to reactivate.
 * @param agent - the exact live orchestrator.
 * @param signal - cancellation owning the whole reactivation (aborted on disposal).
 */
export async function reactivateSwarmRoles(
  runtime: SwarmRuntime,
  agent: Agent,
  signal: AbortSignal,
): Promise<void> {
  const swarmId = runtime.swarmId
  const state = foldSwarmEvents(swarmId, agent.session.events, runtime.currentTopology)
  if (state.terminated) return
  const fromCheckpoint = latestCheckpointAt(swarmId, agent.session.events)

  const records: RoleResumeRecord[] = []
  for (const role of state.roles.values()) {
    if (role.status !== 'running' || runtime.isTerminated) continue
    records.push(await reactivateOneRole(runtime, agent, role, fromCheckpoint, signal))
  }
  if (records.length === 0) return

  agent.session.append('swarm/resumed', {
    swarmId,
    roles: records,
    ...(fromCheckpoint !== undefined ? { fromCheckpoint } : {}),
    resumedAt: new Date().toISOString(),
  })
}
