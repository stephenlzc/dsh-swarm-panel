# dsh-swarm-plugin 实施计划

> 目标：把本目录 (`plugins/dsh-swarm-plugin`) 做成一个**可独立开源**的 DSH Cordis 插件，提供**开放式多 agent 群聊**、**跨会话恢复/checkpoint** 和**分层人机协作**能力。
>
> 确认方式：请在本文末尾的“确认节点”回复，或指出需要调整的里程碑/优先级。

---

## 1. 项目定位

- **类型**：DSH Host + Client Cordis 插件包
- **最终形态**：可发布到 npm / GitHub，用户通过 `cordis.yml` 一行挂载
- **运行时依赖**：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-interaction` 等现有 DSH 能力
- **不依赖**：不侵入 DSH 核心仓库；本目录自成一体，未来可迁移到独立 GitHub 仓库

### 与 DSH 内置 swarm 包的关系

DSH 主仓库已存在 `packages/swarm/agent-swarm` / `packages/swarm/tool-swarm`，它们采用**“Orchestrator AI 持有工具”**模型。本插件选择**更高层的声明式抽象**：

- 用户定义 `Swarm`（群聊）、`Role`（角色）、`SpeakerSelection`（发言策略）、`Termination`（终止条件）。
- 插件内部运行一个 Host 端 swarm engine，自动推进轮次、管理 checkpoint、处理 HITL。
- 模型层仍然通过 DSH agent-loop 调用工具，所有关键操作写入 session log，符合 `model-visible ⟺ logged`。

如果未来 DSH 主仓库的 `agent-swarm` 与本插件接口趋同，再考虑合并；本期以保持本目录独立可开源为原则。

---

## 2. 目标与范围

### 2.1 In-Scope（本期必须交付）

- 开放式群聊：多个 AI 角色围绕一个话题自动轮询/发言，直到满足终止条件。
- 跨会话恢复：进程重启后，能从 session log / checkpoint 重建群聊状态并继续。
- 人机协作：
  - 简单场景复用 DSH 现有 `ask_user` 工具；
  - 复杂场景提供本插件自带的 Web GUI 审批面板（Cordis Client Slot）。
- 可观测性：群聊事件进入 session log，并在 GUI 展示消息时间线与角色拓扑。

### 2.2 Out-of-Scope（可二期）

- 可视化 Agent/Flow Builder（CrewAI AMP 式产品功能）。
- 企业级预置工具市场。
- 复杂统一 Memory 评分系统（本期只提供轻量 `ContextVariables`）。
- 跨 swarm 路由、嵌套 sub-swarm。

---

## 3. 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 架构 | Host engine + model-visible tools + Client Slot | 保留 DSH 插件化、事件源、可审计的设计原则 |
| Agent 模型 | 每个 role 映射为一个 DSH subagent 会话 | 利用 DSH 子会话的隔离、独立模型绑定、独立上下文 |
| Speaker selection | Host engine 实现 `auto` / `round_robin` / `random` / `manual`，`auto` 由 Orchestrator 模型通过工具调用决定 | 与 AG2/CrewAI 的思路一致，且所有决策可记录 |
| 上下文共享 | `ContextVariables` key-value 槽 + session messages | 满足 AG2 式群聊上下文，同时保持简单可 checkpoint |
| Checkpoint | 优先写入 session event log，高频场景可选 SQLite provider | 复用 DSH session 持久化，恢复即事件回放 |
| HITL | 简单 → `ask_user`；复杂 → 本插件 Client Slot | 覆盖大部分场景，不强制引入重型审批系统 |

---

## 4. 目录结构（目标形态）

```
plugins/dsh-swarm-plugin/
├── README.md                  # 面向开源用户的插件说明
├── LICENSE
├── package.json               # npm 包：@your-scope/dsh-swarm-plugin
├── tsconfig.json
├── cordis.yml                 # 插件自描述 / 开发时加载配置
├── src/
│   ├── index.ts               # Cordis plugin apply(ctx)
│   ├── service.ts             # SwarmService 定义与实现
│   ├── runtime.ts             # 群聊轮次引擎、checkpoint、恢复
│   ├── domain.ts              # 纯事件 fold 逻辑
│   ├── types.ts               # Branded IDs、事件 payload、配置类型
│   ├── tools.ts               # 模型可见工具（swarm_ask_user、swarm_next_turn 等）
│   ├── hitl.ts                # ask_user 与审批面板交互
│   ├── client/
│   │   ├── index.ts           # Client plugin 入口
│   │   └── panel.tsx          # Swarm 审批/观测面板（React.createElement）
│   └── config.ts              # 配置校验与默认值
├── tests/
│   ├── domain.spec.ts         # 事件 fold 单元测试
│   ├── runtime.spec.ts        # 群聊轮次测试
│   ├── resume.spec.ts         # checkpoint / 恢复测试
│   └── hitl.spec.ts           # 人机协作测试
└── examples/
    └── coding-squad.yml       # 示例：代码评审 swarm
```

---

## 5. 里程碑

```
M0 项目骨架与能力 seams 设计
M1 多 agent 开放式群聊最小闭环
M2 Context Variables 与工具集成
M3 跨会话 Checkpoint / Resume
M4 Human-in-the-Loop（ask_user + 审批面板）
M5 可观测性与 GUI（Run Card、时间线、拓扑）
M6 开源打磨（README、LICENSE、CI、示例）
M7 高级增强（memory、嵌套 swarm、A2A）— 可选二期
```

### M0：项目骨架与能力 seams 设计

**交付物**

- 创建本目录结构，`package.json`、`tsconfig.json`、`cordis.yml` 可用。
- 定义 `SwarmService` 接口（Service Definition），供其他插件消费。
- 定义 `SwarmConfig`、`RoleConfig`、`SpeakerSelection`、`TerminationCondition` 类型。
- 设计 `swarm/*` 事件命名空间：
  - `swarm/created`
  - `swarm/role-spawned`
  - `swarm/role-message`
  - `swarm/role-exited`
  - `swarm/topology-changed`
  - `swarm/context-updated`
  - `swarm/checkpoint-saved`
  - `swarm/hitl-requested`
  - `swarm/hitl-resolved`
  - `swarm/terminated`

**验收标准**

- `pnpm install && pnpm run build` 通过。
- `typecheck` 无错误。
- 至少一个事件 fold 的单元测试通过。

### M1：多 agent 开放式群聊最小闭环

**交付物**

- `SwarmRuntime`：管理 role → child subagent 的映射、消息广播、轮次推进。
- `SpeakerSelection` 实现：
  - `round_robin`：固定顺序循环；
  - `random`：随机选择（排除当前发言者）；
  - `auto`：Orchestrator 模型通过 `swarm_next_turn` 工具决定；
  - `manual`：等待外部输入决定。
- 终止条件：
  - `max_round` / `max_turns`；
  - `is_termination_msg`（字符串匹配或 lambda）；
  - `swarm_terminate` 工具。
- 模型可见工具：
  - `swarm_spawn_role`
  - `swarm_send_to`
  - `swarm_set_topology`
  - `swarm_next_turn`
  - `swarm_terminate`

**验收标准**

- 3 个以上 role 能围绕一个 topic 自动对话 5 轮以上。
- 每种 speaker selection 策略有独立测试。
- `max_round` 触发后正确终止。

### M2：Context Variables 与工具集成

**交付物**

- `ContextVariables`：群聊级 key-value 共享状态，支持工具读写、模板注入、checkpoint 持久化。
- `swarm_set_context` / `swarm_get_context` 工具。
- 每个 role 可绑定不同工具集；工具返回可触发 handoff。
- 在 role 的 system prompt 中注入 `context` 占位符。

**验收标准**

- 一个 role 写入的 context 可被另一个 role 读取。
- 工具调用事件进入 session log。

### M3：跨会话 Checkpoint / Resume

**交付物**

- `SwarmCheckpoint` 数据结构：包含 messages、context variables、speaker index、role childId map、pending HITL。
- `swarm_save_checkpoint` 工具 + 自动 checkpoint 策略（每轮结束后、每次 HITL 前）。
- `SwarmResumeService`：
  - 从 session events 重建 `SwarmState`；
  - 根据 `swarm/role-spawned` 事件重新创建 child subagents；
  - replay `swarm/role-message` 恢复每个 role 的子会话上下文；
  - 恢复后从下一发言者继续。
- 支持 `from_checkpoint` 参数启动 swarm。

**验收标准**

- 运行中 kill 宿主进程，重启后能从最新 checkpoint 继续群聊。
- 消息历史、context、role childId 映射无丢失。
- 至少一个 headless snapshot 测试覆盖 resume 路径。

### M4：Human-in-the-Loop

#### M4.1 简单 HITL

**交付物**

- `swarm_ask_user` 工具：向操作者提问，答案作为 message 返回。
- 配置 `human_input_mode`：`ALWAYS` / `TERMINATE` / `NEVER`。

**验收标准**

- headless 测试：swarm 暂停等待人类输入，输入后继续下一发言者。

#### M4.2 复杂 HITL 专用审批面板

**交付物**

- Client plugin 注册一个 Cordis Slot：`dsh-swarm-panel`。
- 面板展示：
  - 当前群聊消息流；
  - role 拓扑图；
  - 待审批操作列表（继续、终止、重定向到某 role、编辑 context）。
- Host 端 `SwarmApprovalService`：接收面板动作，写 `swarm/hitl-resolved` 事件。
- 模型侧通过 `swarm_request_approval` 工具触发面板。

**验收标准**

- Web GUI 中能看到 swarm 面板。
- 审批动作正确影响群聊流程并写入 session log。

### M5：可观测性与 GUI

**交付物**

- 所有 swarm 事件进入 `SessionEventMap`，可被外部查询。
- Run card 扩展：显示 swarm 状态、当前 speaker、轮次数、pending HITL、最新 checkpoint。
- Web GUI 时间线与拓扑视图（Client Slot）。

**验收标准**

- 在 GUI 中能看到一次完整群聊的消息流和角色关系。
- checkpoint 可在 GUI 中查看并触发恢复。

### M6：开源打磨

**交付物**

- 中英文 README（含 Model Experience、Known Limitations、Quick Start）。
- LICENSE（建议 MIT 或 Apache-2.0）。
- GitHub Actions CI：lint、typecheck、test、build。
- `examples/` 下的可运行示例。
- `package.json` 正确声明 peer dependencies（`@deepseek-ai/cordis` 等）。

**验收标准**

- 新仓库 `git clone` 后按 README 能跑通示例。
- CI 全部绿灯。

### M7：高级增强（二期，可选）

- 统一 Memory provider 集成（语义检索、重要性/时效评分）。
- 嵌套 sub-swarm。
- A2A / ACP 外部 agent 协议接入。

#### M7 设计：轻量记忆（lexical scoring，本期交付）

**选型**：嵌套 sub-swarm 要求 tools/runtime 全链路放弃"只有 root agent 是 orchestrator"的单层假设（resume、HITL、引擎都要跟随），爆炸半径大；轻量记忆是纯增量——新事件 + 两个工具 + fold 扩展，不触碰任何既有生命周期路径。本期交付轻量记忆，嵌套 sub-swarm 与 A2A/ACP 留作 Roadmap。

**数据模型**：新增事件 `swarm/memory-written`（`{ swarmId, id, text, tags?, by, writtenAt }`），fold 进 `SwarmState.memories`（写入顺序数组）。resume 不做任何特判——完整日志重放天然保留记忆；checkpoint payload 不变（检查点是日志标记，不是状态副本）。

**检索语义**：纯词项评分（无 embedding 依赖，保持零新外部服务）：查询与小写分词后的 text/tags 做词项重叠计数，tag 精确命中加权，同分按写入顺序新近者优先。查询是只读操作，不产生新事件（`tool/call`/`tool/result` 已满足 model-visible ⟺ logged）。

**工具**：`swarm_memory_write { swarmId, text, tags? }`（追加事件并返回条目 id）；`swarm_memory_query { swarmId, query, limit? }`（fold 后评分取 top-N）。错误码沿用既有四码（invalid_argument / not_found / unavailable / internal_error）。

**Config**：`memory: { maxEntries?, queryLimit? }`，加载即校验（正整数）。`maxEntries`（默认 200）是 **fold 层**视图裁剪（保留最新 N 条），不是日志淘汰——日志只增，fold 确定性可重放；`queryLimit`（默认 5）是 `limit` 缺省值。

**明确不做**：角色侧直写（子 agent 不持有 swarm 工具，记忆由 orchestrator 在读取角色回复后写入）；turn prompt 自动注入（消费方式留给后续里程碑）；面板展示（panel-model 不变）。

---

## 6. 依赖关系

```
M0 ──> M1 ──> M2 ──> M5
       │      │
       │      └──> M4
       └──> M3
```

- M3 可与 M2 并行，因为 checkpoint 只需要 M1 的事件稳定。
- M4 面板依赖 M1 的 runtime 与 M2 的 context；简单 HITL 可早于面板完成。
- M6 在所有功能稳定后统一进行。

---

## 7. 技术风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 子会话恢复时 session id 变化导致 attribution 断裂 | P2P 消息来源无法对应 | checkpoint 保存原始 child session id；恢复时尝试复用，否则记录新 id 映射 |
| 高频 checkpoint 导致 session log 膨胀 | 性能、存储 | 默认每轮 checkpoint；高频场景提供 SQLite/压缩 provider |
| HITL 面板与 headless 行为不一致 | 测试覆盖不足 | headless 跑通所有分支；面板通过 mock Client Slot 测试核心逻辑 |
| Orchestrator 工具调用 token 开销大 | 成本、延迟 | 提供 batch 工具，并在 prompt 中限制每轮最大调用次数 |
| 作为独立插件与 DSH 版本演进不同步 | 兼容性问题 | peerDependencies 声明兼容的 DSH 包版本范围；CI 测试多版本 |

---

## 8. 测试策略

| 层级 | 内容 |
|---|---|
| Unit | `domain.ts` 事件 fold；工具参数校验；speaker selection 策略 |
| Snapshot | headless 群聊 transcript：spawn → send → reply → terminate |
| Resume | kill-resume 模式；验证消息历史、context、child 映射 |
| HITL | `ask_user` 路径；面板动作事件路径 |
| Real-API e2e（可选） | 在真实模型上验证 Orchestrator 能正确驱动多轮对话 |

---

## 9. v0.1.0 实际交付回填

`M2-M5.md` 的里程碑（M2 HITL → M6 开源打磨）已在 v0.1.0 全量落地，每条门禁（`tsc host` + `tsc client` + `vitest` + `tsdown`）逐里程碑绿过。任务里程碑与交付位置的对应：

| 任务里程碑 | 交付 | 关键位置 |
|---|---|---|
| M2 人机协作 | `swarm_ask_user` + `Config.humanInputMode`（ALWAYS/TERMINATE/NEVER，加载即校验）+ `swarm/hitl-requested`/`hitl-resolved` 事件 + pending-HITL 跨 resume 保留 | `src/runtime.ts` `askUser/cancelPendingHitl`，`tests/hitl.spec.ts` |
| M3 群聊引擎 | `runChatTurns` + `selectNextSpeaker`/`completedRounds` + `swarm_start_chat`/`swarm_next_turn`/`swarm_set_context`/`swarm_get_context`（共 12 工具），chat 配置 + transcriptWindow 进 Config | `src/engine.ts`、`src/domain.ts`，`tests/chat.spec.ts` |
| M4 可观测性 + GUI 面板 | host 注册 `ctx.sessionProjections` 的 `swarm` 单元（增量 fold + zod schema + change feed）+ 浏览器端 `swarm-panel` slot（React.createElement 手写，无 JSX/CSS modules）+ tsdown client bundle | `src/panel-model.ts`、`src/client/`，`tests/panel-model.spec.ts`、`tests/panel-projection.spec.ts`、`tests/swarm-action.client.spec.ts` |
| M5 高级增强 | ①真实 API cold-resume e2e（`DEEPSEEK_API_KEY` 自跳过；常驻 mock 版即 `chat.spec.ts` 的 cold-resume 用例）②轻量记忆（`PLAN.md` §M7 设计子节先行 + `src/memory.ts` 词项评分 + `swarm_memory_write`/`swarm_memory_query`）③ A2A/ACP 与嵌套 sub-swarm 留 Roadmap | `tests/cold-resume.e2e.ts`、`src/memory.ts`、`tests/memory.spec.ts` |
| M6 开源打磨 | 依赖卫生：`dsh-session`、`dsh-tools` 升 peer（运行时 value-import）；其余维持；`examples/coding-squad.yml` + GitHub Actions CI 见后续提交 |

未交付项按 M5 评估如实标在 README Known Limitations：A2A/ACP、嵌套 sub-swarm、记忆的 turn-prompt 注入、面板文案本地化。

## 10. 确认节点

请确认以下事项后，我将按此计划开始执行：

1. [ ] 目录 `plugins/dsh-swarm-plugin` 的位置和命名是否 OK？
2. [ ] M0-M6 的里程碑范围与优先级是否合理？
3. [ ] 是否立即启动 **M0（项目骨架 + 能力 seams 设计）**？
4. [ ] 审批面板希望放在 **DSH 右侧 dock** 还是 **独立全页面 Slot**？
5. [ ] 开源许可证倾向 **MIT** 还是 **Apache-2.0**？
