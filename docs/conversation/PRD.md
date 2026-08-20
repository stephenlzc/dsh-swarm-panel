# PRD：DSH Agent Swarm Plugin

## 1. 背景与动机

DeepSeek Harness（DSH）已经具备强大的单 Agent + subagent 编排能力：

- `subagent` tool：把任务派给子 Agent，支持一次性/可继续、前台/后台。
- `workflow` tool：模型写 JS 脚本，批量/并行启动 subagent，且 `agent()` 支持 `provider`/`model` 覆盖。
- `send_message` / `list_agents` / `interrupt_agent`：控制可继续后台子 Agent。

但这些原语本质上是 **父子树形委派**：父 Agent 驱动子 Agent，子 Agent 之间不直接对话，也不存在“角色（Role）+ 团队（Crew）+ 对话模式（Pattern）”的高级抽象。

AG2（原 AutoGen）、CrewAI、以及 rumored 的“Kimi Agent Swarm”提供的是更高层抽象：

- 多个 Agent 按角色组队；
- 每个 Agent 可绑定不同模型 / provider；
- Agent 之间可以互相发消息、辩论、达成共识；
- 终止条件、路由策略、人类介入点可配置。

本 PRD 提议为 DSH 添加一个可选的 **Agent Swarm Plugin**，在现有 subagent/workflow 原语之上提供这类高级抽象，同时不破坏 DSH“一切皆插件”的架构。

## 2. 目标与非目标

### 2.1 目标

1. 让用户能用 YAML/JSON 定义一个 **Swarm（蜂群/团队）**：包含多个 Role，每个 Role 指定模型、provider、persona、可用工具。
2. 提供一个模型可见的 `swarm_dispatch` 工具，父 Agent 只需给 Swarm 一个任务，Swarm 自动完成多 Agent 协作。
3. 支持常见对话模式：round-robin、orchestrator-workers、debate、consensus。
4. 不同 Role 可指定不同 `provider/model`（复用 DSH 现有 LLM seam）。
5. 支持“人类在关键节点介入”：通过 DSH 现有 `ask_user` / approval 机制。
6. 所有 Swarm 运行记录进入 Session log，可被 UI 展示、回放、审计。

### 2.2 非目标

1. 不替代 `subagent` 和 `workflow` 工具，而是基于它们构建。
2. 不做跨进程分布式 Swarm（Phase 1 限定在单个 DSH host 内）。
3. 不做实时多人协作 UI（先以可观察、可回放的 Chat/Graph 节点为主）。
4. 不内置特定业务 Agent（如“产品经理”“测试工程师”），只提供角色模板机制。

## 3. 用户场景

### 3.1 场景 A：代码评审委员会

用户说：“请让 Swarm 评审这个 PR。”

Swarm 配置：

- `security_reviewer`（DeepSeek-V3 / 安全专家 persona）
- `perf_reviewer`（DeepSeek-V3 / 性能专家 persona）
- `maintainer`（Kimi K3 / 维护者 persona，负责综合意见并给出最终建议）

运行模式：orchestrator-workers → maintainer 汇总并输出结论。

### 3.2 场景 B：多模型辩论

用户说：“帮我从不同角度分析这个架构决策。”

Swarm 配置：

- `optimist`（Claude Opus / 乐观派）
- `pessimist`（DeepSeek-V3 / 风险派）
- `synthesizer`（Kimi K3 / 综合派）

运行模式：debate（n 轮）→ synthesizer 输出结论。

### 3.3 场景 C：研究小组

用户说：“调研 Rust async runtime 生态。”

Swarm 配置：

- `researcher_a`（搜索+网页抓取工具）
- `researcher_b`（搜索+网页抓取工具）
- `writer`（整合报告）

运行模式：并行研究 → writer 汇总。

## 4. 产品设计

### 4.1 核心概念

| 概念 | 说明 |
|------|------|
| **Swarm** | 一组 Role + 一个对话模式 + 终止条件。可持久化配置在 cordis.yml 中。 |
| **Role** | 一个 Agent 角色，包含：name、description、model/provider、persona、allowed_tools、memory_policy。 |
| **Pattern** | Swarm 的协作算法：**AI-driven**（Orchestrator AI 自主决定 spawn 时机/模型和通信拓扑）+ round-robin、orchestrator-workers、debate、consensus、custom。 |
| **Turn** | Swarm 内一次 Agent 发言，对应一个子 Agent 的 turn。 |
| **Message Bus** | Swarm 内 Agent 共享的只读/读写消息视图，替代父子树中的单向汇报。 |
| **Dispatch** | 父 Agent 调用 `swarm_dispatch` 触发一次 Swarm 运行。 |
| **Termination** | 终止条件：最大轮数、达成共识、指定角色说 stop、人工确认。 |

### 4.2 模型可见工具

**核心设计理念**：Orchestrator AI 是一个拥有完整主体性的 Agent——它持有专用工具集，自己决定 spawn 哪些子 Agent、用什么模型、以及采用哪种通信拓扑（父子/兄弟/混合）。配置层只提供 Role 模板和约束，真正的路由决策由 Orchestrator AI 自主做出（类似 Kimi Agent Swarm 的 Orchestrator）。

**`swarm_dispatch`**（启动一个 Orchestrator AI）

```json
{
  "task": "Review the changes in packages/subagent for thread-safety issues.",
  "orchestrator": {
    "model": { "provider": "kimi", "model": "kimi-k3" },
    "persona": "You are a pragmatic orchestrator. Dynamically decompose the task, spawn specialist agents as needed, and route messages using the topology that best fits the current conversation state.",
    "default_topology": "mixed",
    "allow_dynamic_spawn": true,
    "max_children": 5
  },
  "available_roles": [
    {
      "id": "security_reviewer",
      "description": "Senior security engineer",
      "model": { "provider": "deepseek-official", "model": "deepseek-v3" },
      "persona": "You are a senior security engineer...",
      "allowed_tools": ["bash", "fs_read", "web_search"]
    }
  ],
  "context": "# optional workspace context",
  "termination": { "kind": "orchestrator-decides" },
  "return_format": "structured"
}
```

返回：Orchestrator AI 的最终结论 + 每个子 Agent 的关键观点摘要 + 通信拓扑使用记录。

**Orchestrator AI 持有的一组工具（Phase 1）**：

| 工具名 | 作用 | 归因语义 |
|--------|------|---------|
| `swarm_spawn(role_id, prompt)` | 创建指定 Role 的子 Agent | 新子 Agent 父 = Orchestrator |
| `swarm_send_to(target_id, content, attribution?)` | 向指定子 Agent 发消息；`attribution='orchestrator'` 时归因到 Orchestrator（父子模式），`attribution='original'` 时 `senderSessionId` 指向真正发言的子 Agent（兄弟模式） | attribution 参数决定拓扑语义 |
| `swarm_list_children()` | 列出当前所有存活子 Agent | — |
| `swarm_set_topology(mode: 'parent-child' \| 'p2p' \| 'mixed')` | 切换全局拓扑模式，后续 `swarm_send_to` 按新模式归因 | Orchestrator 主动控制通信语义 |
| `swarm_interrupt(target_id)` | 中断某个子 Agent 的当前轮 | — |
| `swarm_terminate(reason?)` | 主动终止 swarm，输出结论 | — |

**`swarm_list`**（可选）

列出当前部署中预定义的 Swarm 定义（Role 模板集合）。

### 4.3 通信拓扑：父子 / 兄弟 / 混合

这是本插件与 AG2/CrewAI/dsh-crew 最重要的差异化设计：**Orchestrator AI 自主决定通信拓扑**，而不是写死在配置里。

| 拓扑模式 | 语义 | 实现（DHS relay 归因） |
|---------|------|----------------------|
| **Parent-Child（父子）** | 所有消息来自 Orchestrator，子 Agent 感知到消息来自 Orchestrator | `send_message(childX, content, { source: { kind: 'coordinator', senderSessionId: **orchestrator.id** } })` |
| **Peer-to-Peer（兄弟）** | 子 Agent 感知到消息来自另一个子 Agent，等价于直接对话 | `send_message(childB, content, { source: { kind: 'coordinator', senderSessionId: **childA.id** } })` |
| **Mixed（混合）** | Orchestrator 每次根据上下文决定归因模式 | `swarm_set_topology()` 切换；`swarm_send_to(attribution='original')` 单次穿透 |

所有拓扑均通过 `followup` + `CoordinatorMessageSource` 实现，**Orchestrator 始终是所有子 Agent 的直接父**（安全约束），流量经过 Orchestrator 但归因可以指向任意发言者。

### 4.4 配置示例

```yaml
# cordis.yml snippet
- plugin: '@deepseek-ai/dsh-agent-swarm'
  config:
    swarms:
      pr-review-committee:
        description: 'A three-role PR review swarm.'
        pattern: orchestrator-workers
        max_rounds: 5
        termination:
          kind: role-says-stop
          role: maintainer
        roles:
          security_reviewer:
            description: 'Focus on security vulnerabilities and unsafe patterns.'
            model:
              provider: deepseek-official
              model: deepseek-v3
            persona: 'You are a senior security engineer...'
            allowed_tools: ['bash', 'fs_read', 'web_search']
            memory: shared  # vs private
          perf_reviewer:
            description: 'Focus on performance, allocation, and concurrency.'
            model:
              provider: deepseek-official
              model: deepseek-v3
            persona: 'You are a performance engineer...'
            allowed_tools: ['bash', 'fs_read']
          maintainer:
            description: 'Synthesize findings and give final recommendation.'
            model:
              provider: moonshotai
              model: kimi-k3
            persona: 'You are a pragmatic maintainer...'
            allowed_tools: []
            can_terminate: true
```

## 5. 技术设计

### 5.1 在 DSH 架构中的位置

这是一个 **Host Plugin**，提供：

- Service：`ctx.swarm`（Swarm 定义仓库 + Orchestrator AI 运行时）。
- Tool Consumer：`dsh-tool-swarm`（`swarm_dispatch` 启动 Orchestrator AI + 其专用工具集 `swarm_spawn`/`swarm_send_to`/`swarm_set_topology` 等）。
- 可选 Client UI：`dsh-client-ui-swarm`（展示 Swarm 运行拓扑图）。

它依赖现有 seam：

- `ctx.subagents`：Orchestrator AI spawn 子 Agent（`ctx.subagents.startContinuable`），通过 `ctx.subagents.followup` 路由消息。
- `ctx.tools`：注册 `swarm_dispatch` + Orchestrator 专用工具集。
- `ctx.systemPrompt`：注入 Orchestrator AI 的角色定义和工具使用说明。
- `ctx.llm` / `ctx.agentDefaultModel`：Orchestrator AI 和各 Role 子 Agent 的模型选择。
- `ctx.jobs`：swarm 长任务注册。

### 5.2 运行生命周期（AI-Driven Orchestration）

```text
Parent Agent（人类用户）
    │
    ▼
swarm_dispatch(tool call)
    │
    ▼
SwarmRuntime.start()
    │
    ├── 解析 available_roles 模板
    ├── 创建 Orchestrator Agent（持有 swarm_spawn / swarm_send_to / swarm_set_topology 等工具）
    ├── Orchestrator Agent 做 LLM 推理，自主决定：
    │     ① spawn 哪些 Role 子 Agent（动态，按需）
    │     ② 每个子 Agent 用什么 provider/model
    │     ③ 当前消息走哪种拓扑（父子 / 兄弟 / 混合）
    │
    ▼
Orchestrator Agent 执行 LLM 推理循环
    │
    ├── swarm_spawn('role_id', prompt) → startContinuable(provider, agentOptions)
    ├── swarm_send_to(target_id, content, attribution?)
    │     └── followup(exec.agent, childId, content, { source: { kind: 'coordinator', senderSessionId: original } })
    ├── swarm_set_topology('p2p' | 'parent-child' | 'mixed')
    ├── swarm_list_children()
    ├── swarm_interrupt(target_id)
    │
    ▼
Orchestrator Agent 调用 swarm_terminate()
    │
    ▼
返回结构化结论给父 Agent
```

**关键**：Orchestrator 是一个真正的 LLM Agent，它的「决策」就是 LLM 推理输出——模型看到工具集后自主决定何时 spawn、发给谁、用什么归因。这与 Kimi Agent Swarm 的 Orchestrator 自组织理念完全对齐。

### 5.2b Orchestrator AI 的 LLM 视角

Orchestrator Agent 看到的工具 schema 包含：

```json
{
  "swarm_spawn": {
    "description": "Spawn a specialist sub-agent with the given role template and task prompt.",
    "params": {
      "role_id": "string (must be from available_roles)",
      "prompt": "string (what this specialist should do)",
      "provider": "string (optional override, default from role template)",
      "model": "string (optional override)"
    }
  },
  "swarm_send_to": {
    "description": "Send a message to a specialist sub-agent. Use 'original' attribution when you want the recipient to know who originally said this (peer-to-peer semantics). Use 'orchestrator' attribution when you are forwarding on behalf of the orchestrator (parent-child semantics).",
    "params": {
      "target_id": "string (child agent id from list_children)",
      "content": "string",
      "attribution": "enum('original', 'orchestrator') — 'original' = peer-to-peer semantics, 'orchestrator' = parent-child semantics"
    }
  },
  "swarm_set_topology": {
    "description": "Switch the default attribution mode for subsequent send_to calls.",
    "params": { "mode": "enum('parent-child', 'p2p', 'mixed')" }
  },
  "swarm_list_children": { "description": "List all active specialist sub-agents." },
  "swarm_interrupt": { "description": "Interrupt a running specialist sub-agent." },
  "swarm_terminate": { "description": "End the swarm and produce the final structured conclusion." }
}
```

### 5.2c Pattern 实现（含 AI-Driven）

| Pattern | 实现 | 说明 |
|---------|------|------|
| `ai-driven`（默认） | Orchestrator Agent 自主决定 spawn + 拓扑 + 时机 | 通用模式，对应 Kimi Agent Swarm 的自组织 |
| `round-robin` | Orchestrator 调用 `swarm_spawn` 起所有 Role，然后按顺序轮询发送 | 固定算法，Orchestrator 只当路由器 |
| `orchestrator-workers` | Orchestrator spawn 所有 Role，分配任务，收集报告 | 固定算法 |
| `debate` | Orchestrator 在两个 Role 之间来回路由（attribution='original'），并综合 | 固定算法变体 |
| `custom` | Orchestrator 自行写 JS driver 通过 `workflow` 执行 | 最灵活，Orchestrator 自己写脚本 |

### 5.3 Agent 间通信：relay 归因实现三种拓扑

DSH 的 `SubagentRuntime.followup` 要求调用者是目标子 Agent 的直接父。swarm 中 Orchestrator 是所有子 Agent 的直接父，消息经其手中转，`senderSessionId` 归因决定拓扑语义：

| 拓扑 | senderSessionId | 子 Agent 感知到的来源 |
|------|---------------|---------------------|
| Parent-Child | `orchestrator.id` | 消息来自 Orchestrator（父子语义） |
| Peer-to-Peer | `sender_role.id`（真正发言的子 Agent） | 消息归因到另一个子 Agent（等价于 P2P 对话） |
| Mixed | 每次 `swarm_send_to` 可单独指定 | Orchestrator 精细控制每条消息的归因 |

所有子 Agent 的直接父 = Orchestrator（安全约束天然满足）；Orchestrator 可随时调用 `swarm_set_topology` 切换默认模式。

### 5.4 Orchestrator AI 的模型选择

Orchestrator AI 和各 Role 子 Agent 均通过 `AgentOptions { provider, model }` 指定模型：

```ts
{
  provider: 'deepseek-official' | 'moonshotai' | 'openai' | ...,
  model: 'deepseek-v3' | 'kimi-k3' | ...,
}

## 6. API 与数据结构

### 6.1 Service 接口（Host）

```ts
interface SwarmRuntime {
  /** Register a swarm definition. Effect-scoped. */
  register(definition: SwarmDefinition): () => void

  /** List registered swarm names. */
  list(): string[]

  /** Start one dispatch and return a handle. */
  dispatch(request: SwarmDispatchRequest): SwarmRun
}

interface SwarmDispatchRequest {
  swarm: string
  task: string
  context?: string
  maxRounds?: number
  termination?: TerminationCondition
  returnFormat?: 'text' | 'structured'
}

interface SwarmRun {
  readonly id: string
  readonly result: Promise<SwarmResult>
  cancel(): void
  dispose(): Promise<void>
}
```

### 6.2 模型可见 Tool Schema

```json
{
  "name": "swarm_dispatch",
  "description": "Delegate a complex task to a predefined multi-agent swarm...",
  "parameters": {
    "type": "object",
    "required": ["swarm", "task"],
    "properties": {
      "swarm": { "type": "string", "description": "Name of a registered swarm" },
      "task": { "type": "string", "description": "The task to assign to the swarm" },
      "context": { "type": "string", "description": "Optional additional context" },
      "max_rounds": { "type": "integer", "description": "Hard cap on swarm rounds" },
      "termination": { "type": "string", "description": "Termination override" },
      "return_format": { "type": "string", "enum": ["text", "structured"] }
    }
  }
}
```

## 7. UI / 可观测性

### 7.1 Session log 事件

定义以下 log-only 事件，进入父 Agent Session：

- `swarm/run-start`
- `swarm/round-start`
- `swarm/agent-speech`
- `swarm/termination`
- `swarm/run-end`

### 7.2 Web UI（可选 Phase 2）

- 新增 `dsh-client-ui-swarm-run` 包。
- 渲染 Swarm 运行图为 conversation node：节点 = Role，边 = 消息流向。
- 点击节点可展开该 Agent 的发言历史。

## 8. 里程碑

### Phase 1：MVP（2–3 周）

- [ ] `dsh-agent-swarm` Host plugin + `ctx.swarm` service。
- [ ] 支持 `round-robin` 和 `orchestrator-workers` 两种 pattern。
- [ ] `swarm_dispatch` tool，返回文本结果。
- [ ] 配置驱动的 Role model/provider 选择。
- [ ] Session log 事件 + 基础 UI 渲染（text node）。

### Phase 2：增强（2–3 周）

- [ ] `debate` 和 `consensus` pattern。
- [ ] `return_format: structured` + 输出 schema。
- [ ] `swarm_list` tool。
- [ ] 人类介入点（关键轮次触发 approval）。

### Phase 3：生态

- [ ] `custom` pattern（用户写 JS driver）。
- [ ] 可视化 Swarm graph UI。
- [ ] 预置模板市场（security review、architecture review、research team）。

## 9. 风险与待决策问题

1. **Token 成本**：多 Agent 多轮对话容易爆 token。需要 max_rounds、max_tokens_per_role、early termination。
2. **终止条件设计**：模型可能一直“再讨论一下”。需要显式终止机制，甚至人类确认。
3. **循环与路由死锁**：需要检测重复发言、无进展、互相踢皮球。
4. **安全模型**：DSH 当前 parent-child 授权很强。SwarmRuntime 作为父代理是合理的，但要避免子 Agent 绕过 SwarmRuntime 直接操作父 Agent 上下文。
5. **冷恢复**：Swarm 运行到一半 DSH 重启怎么办？需要把 Swarm 状态持久化到 Session log，支持 resume。
6. **与现有 workflow 工具的关系**：workflow 是“模型写脚本手动编排”，swarm 是“声明式配置自动编排”。两者互补，不要功能重叠。

## 10. 替代方案

| 方案 | 说明 | 为什么不选 |
|------|------|-----------|
| 只用 workflow 工具 | 模型每次手写 JS 编排 | 成本高、不可复用、不直观 |
| 在 subagent 工具上加 peer 消息 | 修改核心 seam | 破坏现有安全模型，影响面大 |
| 独立进程服务 | Swarm 跑在 DSH 外部 | 失去 DSH 的 session、tool、approval 生态 |
| 复用 community `dsh-crew` | 第三方 CrewAI-like 插件 | 不成熟，且与本 PRD 目标可能不完全一致 |

## 11. 成功标准

1. 用户能用 20 行 YAML 定义一个三角色 Swarm。
2. 用户调用一次 `swarm_dispatch`，即可得到多模型协作结论。
3. Swarm 内不同 Role 确实使用不同 provider/model（可通过 session log 验证）。
4. 不引入新的核心 seam 改动，完全作为可选插件存在。
5. 与现有 subagent/workflow 工具共存，不冲突。

---

*作者：AI Agent（基于 DSH 仓库检索）*  
*状态：PRD / 待评审*  
*最后更新：2026-08-*
