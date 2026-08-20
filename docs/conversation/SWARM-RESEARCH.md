# Swarm 插件调研笔记（working doc）

> 本文件是「DSH Agent Swarm 插件」立项前的调研工作笔记。
> 目标：对比 community 方案 + 评估 DSH 内部原语能力，产出「要不要做、怎么做」的结论。
> 配套文档：`PRD.md`（插件产品需求）。

## 0. DSH 内部原语能力深挖（本机源码核实，2026-08）

### 0.1 多模型：每个子 Agent 指定 provider/model —— 已确认支持

- 路径 1（配置级）：`packages/subagent/tool-subagent/src/index.ts` 的 `Config.agentOptions` 支持 `{ provider, model, maxTokens }`，对该工具实例启动的每个子 Agent 生效。
- 路径 2（脚本级）：`packages/workflow/tool-workflow` 的 `agent(prompt, opts)` 支持 `opts.provider` / `opts.model` 覆盖（`packages/workflow/workflow-worker-thread/src/runtime.ts` 的 `SUPPORTED_AGENT_OPTIONS = ['label','phase','schema','provider','model']`，测试 `session.spec.ts` 验证了透传）。
- 底层合并逻辑：`packages/subagent/subagent/src/child-agent.ts` 的 `resolveChildAgentOptions(parent, request.agentOptions, depth)` —— 子 Agent 默认继承父的 provider/model，可用 `agentOptions` 覆盖。
- 冷恢复：continuable 子 Agent 的 `agentOptions.provider/model` 被快照进 `subagent/descriptor`，冷恢复时复用（`docs/subsystems/subagent.md` §descriptor）。

### 0.2 Agent 间通信：父子 + relay 归因，无原生 P2P（但可模拟）

- 消息通道只有一条：`SubagentRuntime.followup(parent: Agent, childId, content, options)`（`packages/subagent/subagent/src/continuation.ts:476`），**要求调用方是目标子 Agent 的精确 live 直接父 Agent**（`assertAdmitting(parent)` + `UNAUTHORIZED` 检查）。
- 归因类型（`continuation.ts:57-98`）：
  - `coordinator`（form: `relay`，带 `senderSessionId`）—— 父 Agent 经工具调用给子 Agent 发消息，即现有 `send_message` 工具用的类型（`tool-subagent-control/src/index.ts:71`）。
  - `subagent-report`（relay）—— 子 Agent 主动向父汇报。
  - `subagent-settled`（notice）—— 运行时通知。
- **关键发现：DSH 的 relay 归因可以模拟 P2P 对话**。`send_message` 的 `CoordinatorMessageSource` 里 `senderSessionId` 可以是**任意 SessionId**，不只是 parent 自己的。这意味着：
  - Orchestrator AI 调用 `send_message(childB, content, { source: { kind: 'coordinator', form: 'relay', senderSessionId: childA.id } })` 时，childB 收到的消息归因到 childA，而不是 Orchestrator——这等价于 childA 在直接对 childB 说话。
  - 同理 childA → childC、childB → childA 等任意 Pair 对话都只需 Orchestrator 经一次 `followup` 中转。
  - 这实现了「orchestrator 控制拓扑，但归因到发言者」的语义，不是真正的 P2P（流量仍经过 Orchestrator），但是语义上等效于 P2P 对话。

### 0.2b AI 驱动的动态通信拓扑（新增需求，2026-08-18）

**需求**：Orchestrator AI 自主决定 spawn 子 Agent 的时机/模型，以及对话采用哪种拓扑（父子/兄弟/混合），而不是写死的静态配置。

**DSH 技术可行性分析**：

1. **Orchestrator AI 可以自主 spawn 子 Agent**：
   - Orchestrator Agent 持有 `subagent` 工具（`ctx.tools.get('subagent')`），可以自主决定 spawn 多少个子 Agent、用什么 prompt、覆盖哪些 `agentOptions { provider, model }`。
   - 关键是：Orchestrator 是 `exec.agent`（swarm_dispatch 工具调用的父 Agent），它 spawn 的所有子 Agent 的直接父都是它自己。
   - 每个子 Agent 创建后记录其 `childId`，供后续路由使用。

2. **三种通信拓扑在 DSH relay 模型下的实现**：

   | 拓扑 | 实现方式 | 归因语义 |
   |------|----------|---------|
   | **Parent-Child（父子）** | 所有消息都从 Orchestrator 的 `senderSessionId` 发出：`send_message(childX, content, { source: { kind: 'coordinator', senderSessionId: orchestrator.id } })` | 子 Agent 看到消息来自 Orchestrator |
   | **Peer-to-Peer（兄弟）** | Orchestrator 中转消息，但 `senderSessionId` 指向真正的发言者：`send_message(childB, content, { source: { kind: 'coordinator', senderSessionId: childA.id } })` | childB 看到消息归因到 childA，语义上等价于 childA→childB 直接对话 |
   | **Mixed（混合）** | Orchestrator AI 每次根据上下文决定用哪种归因——必要时走父子，偶尔让子 Agent 之间直接感知对方发言 | Orchestrator 保持控制，但语义灵活 |

3. **Orchestrator AI 的工具体系**：
   - `spawn(description, prompt, provider?, model?)` — 创建新子 Agent
   - `send_to(agentId, content, attribution_mode?)` — 发消息，可选归因模式（orchestrator_as_sender / original_sender）
   - `list_children()` — 列出当前 swarm 成员（复用 `list_agents` 工具）
   - `interrupt(agentId)` — 中断某个子 Agent
   - `set_mode(mode: 'parent-child' | 'p2p' | 'mixed')` — 切换拓扑模式

4. **关键约束**：
   - Orchestrator 必须是所有子 Agent 的直接父（因为 `followup` 要求父授权）。这天然成立——Orchestrator spawn 的子 Agent 父都是 Orchestrator。
   - `send_message` 只能发给 Orchestrator 的直接子 Agent（不能跨层），所以所有路由都在 Orchestrator 控制下。
   - 子 Agent 不能主动给另一个子 Agent 发消息——必须经过 Orchestrator 中转（这既是约束也是安全保证）。

5. **与 Kimi Agent Swarm / AG2 / CrewAI 对比**：
   - Kimi Swarm：Orchestrator 分解任务→派给 Specialists→收集结果→决定下一步。**我们的设计完全对齐**，Orchestrator AI 就是 Kimi 的 Orchestrator。
   - AG2 GroupChat：speaker selection 是框架决定的（`group_chat_manager`）；我们的 Orchestrator AI 自己决定，**更灵活**。
   - CrewAI handoff：Agent 显式声明 `handoff to Agent(role)`；我们的 Orchestrator AI 可以选择走 handoff（p2p 模式）或不走（parent-child 模式），**更通用**。

6. **设计影响（对 PRD 的修改）**：
   - PRD §5 的「Pattern 引擎」从「配置驱动的固定算法」升级为「AI 自主选择的动态路由策略」。
   - `swarm_dispatch` 工具的 schema 需要增加 `orchestrator_model`、`default_topology`、`allow_spawn_dynamic` 等参数，让 Orchestrator AI 知道它的角色定义和约束。
   - Phase 1 的 round-robin / orchestrator-workers 变成 Orchestrator AI 可以调用的「固定策略」，AI 也可以自己发明新策略。

### 0.3 一次性 vs 可继续：两条实现路线

- **可继续（continuable）**：每个 Role 一个持久 Session，SwarmRuntime 经 `startContinuable` 创建、`followup` 驱动。优点：每 Role 历史独立可审计、支持冷恢复、与现有 subagent UI 兼容。缺点：需全程持有 live parent Agent。
- **一次性（one-shot）轮询式**：每轮用 `start()` 起一次性子 Agent，prompt 里带完整会议记录。优点：实现简单、无持续授权依赖。缺点：每轮重复投喂上下文（token 增长）、无持久 Role 会话、可观测性差。
- 结论：Phase 1 推荐 **continuable**（与 PRD 一致），一次性作为降级路径。

### 0.4 其他相关能力

- `workflow` seam：模型写 JS 编排脚本，`parallel()` / `pipeline()` 组合子，worker-thread 执行（`packages/workflow/workflow-worker-thread`）。可作 swarm pattern 的底层执行器，但 swarm 是声明式配置，workflow 是命令式脚本，两者互补。
- `tool-subagent-control`：`send_message` / `interrupt_agent` / `list_agents` 全局工具，swarm 插件可复用其 followup 通道。
- `ctx.jobs`：后台任务注册表（`tool-jobs`），swarm 长任务可注册为 job 供 `job_list`/`job_output` 查看。
- UI 侧：`client-ui-subagent` 已有子 Agent 会话渲染；swarm 运行可先投影为普通 conversation node（text），Phase 2 再做专用 graph。
- 模型提供方：DSH 设置里已有 `moonshotai` / `moonshotai-cn` / `kimi-coding` 提供方选项（`apps/web/tests/snapshots/models-settings`），Kimi 模型可直接作为 Role 的 model 使用。

## 1. community 方案对比

### 1.3 DSH 社区多 Agent 生态全景 —— ✅ 已调研（2026-08-18）

共梳理 22+ 项目，最接近 swarm 的是：

| 项目 | Star | 定位 | 多模型 | Agent 间对话 |
|------|------|------|--------|------------|
| **dsh-agent-teams** | 516★ | Captain + 成员 + 任务 DAG + 直接 mailbox 消息 | ✅ 可选 | ✅ 成员间直接 mailbox |
| **dsh-agent-team-gui** | 40★ | 持久化多模型小队 + Web UI（Teams 设置/Run Center） | ✅ 每成员独立 | ❌ DAG handoff 为主 |
| **dsh-background-agents** | 5★ | 可续聊后台 Agent + Team Rooms（广播/定向消息） | ✅ childProvider/model 可覆盖 | ✅ Team Rooms 消息总线 |
| **dsh-legion** | 2★ | Profile/Team/Strategy 声明式委派 | ✅ Profile 绑定 | ❌ |
| **dsh-shift-router** | 1★ | LLM Judge 分级 + 故障转移 | ✅ tier 可配不同模型 | ❌ |
| **dsh-deep-research** | — | 规划/研究/综合/审查四角色自适应 workflow | ✅ 分角色配置 | ❌ |
| **dsh-subagent-director** | 3★ | 按角色模板委派 + 四级回退链 | ✅ 角色绑模型 | ❌ |

关键结论：
- **dsh-agent-teams**（516★）是目前最接近"Kimi Agent Swarm"理念的插件：Captain 创建成员、自动 DAG 分解、成员间直接 mailbox 消息、成员可配不同 provider/model。✅ 证实需求真实存在且社区已有人在做。
- **dsh-agent-team-gui** 提供了完整的 Web UI 参考（Teams 配置面板 + Run Center + Token 洞察）。
- **dsh-background-agents** 的 Team Rooms 消息总线是 Agent 间自由对话的实现参考。
- **整体生态处于早期**：大部分插件 0~5★，v0.x，API 不稳定，我们的官方插件有时间窗口。
- **差异化空间**：现有插件没有"AI 自主决定通信拓扑（父子/兄弟/混合）"的能力，这是我们的独特定位。

### 1.5 AG2 / CrewAI 能力基线 —— ✅ 已调研（2026-08-18）

| 能力维度 | AG2（原 AutoGen） | CrewAI |
|---------|-------------------|--------|
| 协作核心 | GroupChat + GroupChatManager / handoffs | Task.context 注入 + Process.sequential/hierarchical |
| Agent 间通信 | 共享 messages + speaker selection | Task 输出作为下游 context |
| 终止条件 | max_round / is_termination_msg / TerminateTarget | max_iter / expected_output 校验 |
| 人机协作 | human_input_mode 三档 + AG-UI input_required | Task.human_input 审核点 |
| 记忆 | ContextVariables / GroupChat.messages | 统一 Memory（评分系统）|
| 持久化 | resume(messages) 手动 | CheckpointConfig 自动 + fork |

关键启示：
- **DSH session log = 两者可观测性 + 持久化的统一基础**，无需另建事件总线。
- **Orchestrator AI 自主决定角色/拓扑 = AG2 的 LLM speaker selection 替代方案**，但 DSH 版由工具调用驱动，更可控。
- **subagent 天然隔离 ≠ AG2/CrewAI 同一进程内 agent**，这是 DSH 的结构优势。
- **可舍弃**：AG2 自由群聊、CrewAI AMP 可视化、两者各自 provider 适配层（DSH llm 已屏蔽）。

### 1.4 dsh-crew（ZSeven-W）—— ✅ 已调研（2026-08-18）

**定位**：Claude Code / Codex 当 orchestrator，DSH 当 worker runtime，MCP 协议桥接。让 Claude/Codex 把任务派给真实 DSH agent，宿主 UI 里显示原生子代理进度。

**关键事实**：
- 双形态：DSH bundle（`cordis.patch.yml`，Hub 模式）+ 独立 MCP server（standalone 模式，无 DSH 时跑 `dsh-jsonrpc-agent`）。
- **无 agent 间对话**：纯 orchestrator→worker 父子委派，worker 之间无消息通道、无组内协商。
- **模型选择受限**：仅 `flash`/`pro` 两档，写死 `deepseek-v4-flash`/`deepseek-v4-pro`（provider `deepseek-official`），不可按 worker 任选 provider/model；仅支持按档位挂 DSH preset（工具/persona）。
- 无角色/任务图、无 crew 级记忆、**无审批/人类在环**。
- 强项：原生子代理进度 UI（MCP + 事件驱动 status shard）、Hub/Standalone 自动切换、tier_policy + escalate_on_failure、多模态外借桥、一键安装。
- 元数据：MIT，v0.1.0-rc.1，2026-08-16 创建（一天内 ~14 commits，单作者 Fini），stars 56，无 CI 可见性，生态极早期。

**与我们的关系**：**不撞车，互补**。它是「外部 orchestrator → DSH worker」的外向桥；我们是「DSH 内部声明式多 Agent 协作」（Role 组队 + 对话 + 多模型 + 审批 + 可审计）。可借鉴：bundle+MCP 双形态、worker 作为 DSH 一等公民会话（`ctx.agents.create` + `presets.mount`）、事件驱动进度镜像、预设档位映射思路。我们的差异点（Role 间 relay 对话、开放模型调度、按 Role 审批、持久会话审计）恰是它没有的。

- [ ] DSH 社区生态全景（dsh-task-dag / penguin-harness / claude-anyteam 等）—— subagent b682be1a（仍在跑）
- [x] Kimi Agent Swarm 真身核查 —— subagent 79dd105b ✅
- [ ] AG2 / CrewAI 能力基线 —— subagent bb9d9f88（仍在跑）

### 1.2 Kimi Agent Swarm 真身 —— ✅ 已调研（2026-08-18）

**定位**：Moonshot AI（月之暗面）官方推出的多智能体执行能力，集成在 Kimi Web/Kimi App/Kimi Work 桌面端，基于 Kimi K2.5/K2.6/K3 模型驱动。不是独立 API，更不是开源框架。

**核心事实**：
- 架构：Orchestrator（指挥官）+ Specialists（子代理），最高 **300 个子代理并行**，单任务 **4,000+ 工具调用**，比单 Agent 快 **4.5 倍**。
- PARL（Parallel-Agent Reinforcement Learning）：用强化学习训练子代理并行执行，避免单 Agent 上下文瓶颈。
- 访问入口：https://www.kimi.com/agent-swarm（Web），Kimi App 模型切「K3 Swarm」。
- **平台 API：无专属 Agent Swarm API**。platform.kimi.com 只有标准 Chat Completions + tool_calls，开发者必须自己实现编排层。Kimi K3 是底层模型提供方。
- **GitHub：无官方 swarm 框架仓库**。MoonshotAI GitHub 有 43 个仓库（kimi-code、kimi-cli、kimi-agent-sdk 等），无 `kimi-agent-swarm`。
- **社区同名项目**：约 47 个 GitHub 仓库带 "kimi agent swarm" 标签，多为第三方实现。其中发现 `hongyue0721/dsh-kimicode-swarm`（DSH 的 Kimi Code Swarm 模式插件）——直接竞品，但极早期。

**与我们关系**：
- Kimi Agent Swarm 的「Orchestrator + Specialists」架构 = 我们 SwarmRuntime（协调者）+ Role 子 Agent（专家），PRD §5 方案完全对齐。
- 规模数据（300 agents、4,000+ tool calls）证明「多 Agent 并行」是真实需求，不是 PPT。
- **无官方 API** 意味着「在 DSH 上实现 Kimi Agent Swarm 风格的多 Agent 协作」是真实的市场空白——开发者想用 Kimi 生态做 swarm，没有开源实现，只有消费产品。
- `hongyue0721/dsh-kimicode-swarm` 说明社区已有人在尝试，但很早期（未确认活跃度）。
- **Kimi K3 可作为我们 swarm 的 Role 模型之一**（provider: `kimi`，model: `kimi-k3`），通过 platform.kimi.com 标准 API 接入。

## 2. 结论与立项建议

### 2.1 做还是不做：✅ 做

**理由：**

1. **需求已被验证**：dsh-agent-teams（516★）+ dsh-agent-team-gui + dsh-background-agents 三个插件各自独立地实现了"多 Agent 协作"的核心诉求，说明这不是小众需求。Kimi Agent Swarm（300 agents并行）的规模数据进一步证明这是真实市场。
2. **时间窗口存在**：现有插件全部是 v0.x，API 不稳定，没有一个实现了"AI 驱动的动态拓扑"——这是我们最大的差异化。
3. **DSH 底层原语已完整**：subagent followup + senderSessionId relay 足以实现任意拓扑，无需新安全原语；session event log 天然覆盖可观测性和持久化需求。
4. **不重复造轮子**：dsh-crew 做的是「外部 orchestrator → DSH worker」外向桥，与我们"DSH 内部多 Agent 协作"是正交赛道，不撞车。

### 2.2 怎么做：Phase 1 范围

**Phase 1（MVP，可独立使用）**

| 功能 | 对应工具 | 完成标准 |
|------|---------|---------|
| Orchestrator spawn 子 Agent（可指定 provider/model） | `swarm_spawn` | Agent 创建成功，session event 写入 |
| Orchestrator 向 role 发消息（支持归因控制） | `swarm_send_to` | 消息到达 child，收件人感知正确的 senderSessionId |
| 设置拓扑模式（parent-child / peer / mixed） | `swarm_set_topology` | 拓扑变更写入 event，后续消息使用正确归因 |
| 列出当前活跃 roles | `swarm_list_children` | 返回 runtime 状态 |
| 中断 / 终止 swarm | `swarm_interrupt` / `swarm_terminate` | 子 Agent dispose，event 写入 |
| Session event log 持久化 | `swarm/role-spawned` 等事件 | cold resume 可从 events fold 重建状态 |

**Phase 2（可选，远期）**
- 人机协作 checkpoint（接入 DSH ask_user / interaction approval）
- 共享 memory/context provider
- 嵌套 sub-swarms（depth > 1）

### 2.3 技术决策已确认

| 决策点 | 结论 | 依据 |
|--------|------|------|
| 子 Agent 必须是 Orchestrator 直接子节点 | ✅ 必须 | DSH followup 授权约束 |
| relay 归因可模拟 P2P | ✅ 可行 | senderSessionId 可指向任意 session |
| Session event log = 可观测性 + 持久化 | ✅ 合一 | DSH model-visible ⟺ logged 不变量 |
| Orchestrator AI 自主决定工具调用 | ✅ 核心设计 | 与 AG2 LLM speaker selection 对齐，但更可控 |
| Bundle 安装通过 `dsh.bundle.patch` 声明 | ✅ 是 | profile.ts reconcilePlugins 自动管理 |

### 2.4 待与用户确认的决策点

- [ ] **npm scope**：`@deepseek-ai/dsh-agent-swarm`（官方维护，随 dsh 发版）还是 `@your-npm-scope/dsh-agent-swarm`（独立维护）？
- [ ] **Phase 1 是否包含 `swarm_send_to` 的 relay 归因**：还是先做 parent-child only？
- [ ] **模型默认值**：Orchestrator 默认用什么模型？（Kimi K3？DeepSeek？）
- [ ] **独立 git 仓库**：在 fork（stephenlzc/deepseek-harness）内开发，还是初始化独立仓库（dsh-agent-swarm）单独维护？

### 2.5 已创建的代码资产

```
packages/swarm/
├── AGENTS.md
├── agent-swarm/
│   ├── package.json          ← dsh.bundle.patch 声明
│   ├── cordis.patch.yml     ← bundle 入口
│   ├── tsconfig.json
│   ├── tsdown.config.ts
│   ├── README.md / README.zh.md
│   ├── src/
│   │   ├── index.ts         ← name + inject + apply（function plugin 入口）
│   │   ├── types.ts         ← 全部 session event 类型 + branded IDs
│   │   ├── runtime.ts       ← SwarmRuntime（per-agent lifecycle）
│   │   ├── domain.ts        ← foldSwarmEvents（纯函数，event → state）
│   │   └── tools.ts         ← 6 个 Orchestrator 工具定义
│   └── tests/
│       └── plugin.spec.ts   ← loader smoke + 业务逻辑 integration tests
```

下一步行动（用户确认决策点后）：
1. 把 `packages/swarm/` commit 到 `feat/agent-swarm-plugin` 分支
2. 本地 `pnpm install && pnpm run build` 验证编译
3. 在本地 cordis.yml 里 insert agent-swarm，验证工具注册
4. 运行 `pnpm run test -- packages/swarm/agent-swarm` 验证测试通过
