# Coding squad example

This overlay mounts `dsh-swarm-panel` on the DeepSeek Harness headless profile and gives one Orchestrator a concrete three-role code-review workflow.

## Run it

From a DeepSeek Harness checkout, after installing this plugin into the profile:

```bash
export DEEPSEEK_API_KEY=... # or configure the DSH credential store
pnpm dsh --profile headless \
  --patch ../dsh-swarm-panel/dsh-swarm-plugin/examples/coding-squad/cordis.yml \
  "review the pending PR"
```

The current working directory is the review workspace. The model should create planner, security, and correctness roles, route findings between them, record a verdict, and save a checkpoint.

## What it demonstrates

- `swarm_spawn` for three reviewer roles.
- `swarm_set_topology` and `swarm_send_to` for directed and peer communication.
- `swarm_start_chat` and `swarm_next_turn` for group discussion.
- `swarm_set_context` for the final verdict.
- `swarm_memory_write` and `swarm_memory_query` for recurring findings.
- `swarm_checkpoint` for durable resume state.

The example makes a real model call and requires a compatible Harness installation plus credentials. It is separate from the keyless replay fixture used by the browser screenshots and CI.
