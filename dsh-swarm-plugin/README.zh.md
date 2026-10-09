# dsh-swarm-panel

[English](README.md) | 中文

DSH Agent Swarm：AI 驱动的多 Agent 编排，支持动态通信拓扑、冷启动恢复和分层人机协作。

## 概述

`dsh-swarm-panel` 让单一 **Orchestrator Agent** 自主 spawn、协调并通信子 agents，按消息选择通信拓扑（parent-child 或 peer-to-peer）。Orchestrator 是真实的 LLM Agent——它决定 spawn 哪些角色、各角色使用什么模型、角色之间如何交换信息。

## 快速开始

把插件挂到 cordis.yml（部署侧只为 root Orchestrator 暴露工具面），再叠加内置的代码评审 squad 示例。下面的 `workspace:*` 仅适用于 Harness 源码工作区；普通用户应按“安装”章节通过 `dsh plugin` 安装：

```yaml
# cordis.yml (overlay onto your base profile, or copy into $DSH_HOME/profiles/<name>/)
plugins:
  dsh-swarm-panel: workspace:*
```

```bash
# Run the bundled code-review squad (see examples/coding-squad/cordis.yml)
pnpm dsh --profile headless --patch ./examples/coding-squad/cordis.yml \
  "review the pending PR"
```

全部 14 个工具自动只装在 root agent 上；子 agent 不暴露 swarm 工具面——跨角色消息、checkpoint、HITL 都由 orchestrator 驱动。该示例需要通过标准凭证通道提供 `DEEPSEEK_API_KEY`。

## 安装

```bash
# 从 GitHub Release 安装（当前可用，无需 npm 发布）。
# 先把发布资产下载到本地：直接把 URL 交给 add 会因 pnpm 完整性校验失败
# （ERR_PNPM_MISSING_TARBALL_INTEGRITY）。
curl -sSL -o /tmp/dsh-swarm-panel-1.0.1.tgz \
  https://github.com/stephenlzc/dsh-swarm-panel/releases/download/v1.0.1/dsh-swarm-panel-1.0.1.tgz

# 桌面版的 launcher 不在 PATH 上；路径按需调整，`dswarm` 可换成任意 profile 名，
# 切勿使用 `desktop`。
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$DSH" plugin --profile dswarm add /tmp/dsh-swarm-panel-1.0.1.tgz

# npm 发布后（dsh 在 PATH 上时）
dsh plugin --profile web add dsh-swarm-panel

# 本地开发
dsh plugin --profile web add file:./dsh-swarm-plugin
```

## 配置

所有可选项都写在 `cordis.yml` 插件行的 `config:` 块下，并都有安全的默认值；空 `config: {}` 即按文档默认值启用插件。

```yaml
# cordis.yml row config
plugins:
  dsh-swarm-panel:
    $: workspace:* # 仅限源码工作区开发
    config:
      enabled: true # 总开关：false 则不挂任何投影、工具与 effect
      provider: spawn
      humanInputMode: TERMINATE
      checkpoint: { frequency: auto }
      chat: { speakerSelection: round_robin, transcriptWindow: 10 }
      memory: { maxEntries: 200, queryLimit: 5 }
```

- **`enabled`**（默认 `true`）：设为 `false` 时，`apply` 直接返回，不注册 `swarm` 投影、`swarm/*` 事件词表或任何 per-agent effect。宿主侧不留任何痕迹，客户端侧省略头部 `Swarms: N` 徽标和 Conversation Flow 页签。安装保留但临时关掉面板时使用此项；若想完全跳过插件入口，在 `cordis.yml` 行上加 loader 级的 `disabled: true`。

## Web 界面

插件安装到 `web` profile 后，让 Orchestrator 创建 swarm 并启动一个角色，例如：`Create a swarm named default and spawn one planner role.` 在 Chat 和 Trajectory 旁边打开 **Conversation Flow** 页签。该页是插件负责的 swarm 画布（侧栏 Workspaces、Chat/Trajectory 页签和顶栏 Session log 仍由宿主绘制）：

- 拓扑条是角色图标卡，带 parent/child 以及 Active / Idle·Waiting / Completed / Error（Error 独立成色，不并进 exited 灰点）。
- 泳道时间网格带竖向车道线；紧凑消息卡落在发送者列；路由是折线箭头（实线 `parent → child`，虚线 `peer ↔ peer`），不再用目的地胶囊替代。
- 时间列显示时刻和 `UTC±N` 偏移。
- 详情区是堆叠 inspector（From/To、Route、Status、Content preview、Copy ID、打开 session）。投影里没有 Tags / Token usage / View in Trajectory，因此省略，不伪造。
- 页脚：visible/total、First、Last、Duration、Live、Auto-scroll。Export 没有数据源，明确未做。
- Human lane 的 pending HITL 可点，打开原始 swarm 会话。
- ArrowUp / ArrowDown / Escape 只在 Conversation Flow 集合聚焦时生效。

头部的 `Swarms: N` 只是计数。点击角色卡或泳道可打开对应子会话。

![dsh-swarm-panel Conversation Flow 在 DeepSeek Harness web 壳中的宿主合成图](assets/swarm-panel.png)

### UI 图库

这些截图来自确定性的 replay fixture，不包含真实工作区内容或 API 凭证：

| 桌面总览 | 消息详情 | 窄屏布局 |
| --- | --- | --- |
| ![桌面总览](assets/swarm-panel-host-desktop.png) | ![消息详情](assets/swarm-panel-host.png) | ![390×844 窄屏布局](assets/swarm-panel-host-narrow.png) |

![Conversation Flow 交互导览](assets/conversation-flow-tour.gif)

导览依次展示桌面总览、选中消息详情和 390×844 响应式布局；它是由同一组脱敏截图组成的 GIF，不代表真实模型输出。

## 工具集

| 工具 | 说明 |
|------|------|
| `swarm_spawn` | 启动子 Agent 角色 |
| `swarm_send_to` | 在角色间发送消息，支持归因控制 |
| `swarm_set_topology` | 设置通信拓扑（父子 / P2P / 混合） |
| `swarm_list_children` | 列出所有活跃角色 |
| `swarm_interrupt` | 中断单个或所有角色 |
| `swarm_terminate` | 终止整个 swarm |
| `swarm_ask_user` | 请求人工输入（HITL） |
| `swarm_start_chat` | 启动群聊引擎（话题、发言策略、终止条件） |
| `swarm_next_turn` | 推进一轮或多轮对话；`auto` 策略下用 `speaker` 决策 |
| `swarm_set_context` | 写入 swarm 级上下文变量 |
| `swarm_get_context` | 读取上下文变量（单键或全部） |
| `swarm_checkpoint` | 保存冷启动检查点 |
| `swarm_memory_write` | 记住 swarm 级事实（决策、发现、约束） |
| `swarm_memory_query` | 自由文本检索记忆（词项评分，tag 加权） |

## 群聊引擎

`swarm_start_chat` 在 swarm 的角色之上启动宿主侧轮次引擎，`swarm_next_turn` 推进对话。每一轮引擎选出发言人，投递携带话题、共享上下文变量和近期对话记录的提示词，从该角色的持久子会话等待回复，并将其记为发往 `group` 的 `swarm/role-message`。引擎状态全部落在事件日志中，冷启动恢复后从上次发言人处精确续跑。

发言策略（每个 swarm 由 `swarm_start_chat` 指定，默认值由 cordis.yml 的 `chat.speakerSelection` 配置）：

- `round_robin`（默认）：按 spawn 顺序循环；恢复后从 `lastSpeaker` 续推。
- `random`：随机选择，排除上一位发言人。
- `auto`：Orchestrator 每轮通过 `swarm_next_turn` 的 `speaker` 参数决策。
- `manual`：引擎询问操作者由谁发言（需启用人工输入）。

终止条件：`maxTurns` / `maxRounds`（一轮 = 每个活跃角色发言一次）、回复中包含 `terminationMessage` 子串、`swarm_terminate`。`humanInputMode: TERMINATE` 时自动终止前需操作者确认；`ALWAYS` 时每完成一轮都会询问是否继续。

```yaml
# cordis.yml row config
config:
  chat:
    speakerSelection: round_robin
    maxTurns: 50
    transcriptWindow: 10 # recent group messages per turn prompt
```

上下文变量是 swarm 级键值共享状态：`swarm_set_context` 写入（`by` 归因）、`swarm_get_context` 读取、注入每轮提示词、随检查点保存、由恢复 fold 重建。

## 轻量记忆

`swarm_memory_write` 把 swarm 级事实（决策、发现、约束）落为 `swarm/memory-written` 事件；`swarm_memory_query` 按自由文本检索。评分是纯词项的——小写分词重叠计数、tag 精确命中双倍加权、同分新近者优先——不依赖任何 embedding 服务。记忆只存在于持久化日志中：冷启动恢复重放全日志即自动保留，条目 id（`mem-<n>`）跨重启不冲突。fold 视图按 `memory.maxEntries` 裁剪为最新 N 条（日志本身从不截断）。

```yaml
# cordis.yml row config
config:
  memory:
    maxEntries: 200 # fold view cap
    queryLimit: 5   # default swarm_memory_query limit
```

## 架构

- **`src/runtime.ts`**：`SwarmRuntime`——按 orchestrator 管理生命周期、子角色、消息路由和检查点快照
- **`src/domain.ts`**：纯事件 fold 逻辑——从 session 事件重建全部状态
- **`src/resume.ts`**：冷启动恢复——按 fold 恢复运行时、重新建立子角色并回放历史
- **`src/tools.ts`**：Orchestrator 工具定义
- **`src/types.ts`**：session 事件类型（`swarm/role-spawned`、`swarm/role-message` 等）
- **`src/panel-model.ts`**：`swarm` 投影——面板 wire model 与增量 reducer
- **`src/memory.ts`**：轻量记忆检索——对 fold 后的条目进行词项评分
- **`src/client/`**：浏览器部分——会话头部 swarm 面板（无 JSX，使用内联样式）
- **`src/index.ts`**：函数插件入口（`name` + `apply`）

## 会话事件

| 事件 | 说明 |
|------|------|
| `swarm/created` | 创建 swarm |
| `swarm/role-spawned` | 启动子 agent（记录角色的模型和系统提示词） |
| `swarm/role-message` | 角色之间发送消息 |
| `swarm/role-exited` | 角色已结束、中断或出错 |
| `swarm/topology-changed` | 通信拓扑变更 |
| `swarm/destroyed` | swarm 已终止 |
| `swarm/checkpoint` | 保存状态快照（角色、拓扑、消息数、最近发言人） |
| `swarm/resumed` | 冷启动恢复完成；记录恢复点和各角色结果 |
| `swarm/hitl-requested` | Orchestrator 向操作者提问并等待回答 |
| `swarm/hitl-resolved` | 待处理问题已结束（`answered` 带答案文本，或 `cancelled`） |
| `swarm/chat-started` | 群聊引擎已启动（话题、发言策略、终止条件） |
| `swarm/chat-ended` | 引擎已停止，并记录停止原因 |
| `swarm/context-updated` | 上下文变量已写入 |
| `swarm/memory-written` | 已写入记忆条目（id、文本、标签、归因） |

## 人机协作（HITL）

`swarm_ask_user` 让 Orchestrator 暂停工具调用，等待操作者通过宿主的 user-questions provider（`ctx.userQuestions`，已在 `inject` 中声明）作答。提问先落 `swarm/hitl-requested` 事件，等待结束后恰好落一条 `swarm/hitl-resolved`（`answered` 带答案文本，或 `cancelled`）。传入 `routeTo` 可把答案作为来自 `human` 的消息路由给某个角色。

交互语义：中断角色不会取消待答的提问（HITL 是 swarm 级）；`swarm_terminate` 会以 `cancelled` 结果取消它。冷启动恢复后，未作答的提问会出现在 `swarm_list_children` 的 `pendingHitl` 投影中——重启后没有存活等待者，Orchestrator 应重新提问；请求 id（`hitl-<n>`）不会与崩溃前的请求冲突。

```yaml
# cordis.yml row config
config:
  humanInputMode: TERMINATE # ALWAYS | TERMINATE | NEVER
```

- `ALWAYS` / `TERMINATE`：启用 `swarm_ask_user`（两者的区别由 M3 轮次引擎消费）。
- `NEVER`：`swarm_ask_user` 返回 `unavailable` 错误，不落任何事件。

## 检查点与冷启动恢复

所有 swarm 事实都写入 Orchestrator 的持久化 session log，因此 swarm 可以在宿主进程重启后恢复。会话被 resume（`ctx.agents.resume`）时，插件会：

1. 从事件 fold 同步重建每个 `SwarmRuntime`——角色映射、拓扑、终止状态。
2. 在后台重新建立每个运行中的角色：子会话仍存在的角色通过 `followup()` 冷启动恢复、历史完整保留；子会话丢失的角色按其记录的定义重新 spawn，并按原始顺序 replay 其入向 `swarm/role-message` 历史。
3. 追加一条 `swarm/resumed` 事实，记录恢复点（最新检查点）与每个角色的结果（`resumed` / `respawned`）。

检查点是 log 之上的标记——恢复始终重新 fold 完整日志。可通过 `swarm_checkpoint` 工具手动保存，或按配置频率自动保存：

```yaml
# cordis.yml row config
config:
  checkpoint:
    frequency: auto # auto | manual | per_turn
```

- `auto`（默认）：结构变更（spawn、退出、拓扑、终止）后在下一个 idle 边界保存快照。
- `per_turn`：每轮结束后也保存仅有消息进展的快照。
- `manual`：仅在 Orchestrator 调用 `swarm_checkpoint` 时保存。

> **注意：** 插件在加载期间向 session 持久化读取路径注册其 `swarm/*` 事件词表。卸载插件后，swarm 会话将按设计被识别为"由更新版本 harness 写入"而被拒绝读取。

## 可观测性与 Web 面板

宿主组装 session projection 能力（`ctx.sessionProjections`）时，插件会注册一个 `swarm` 投影单元，把每个 `swarm/*` 事件增量 fold 成会话级面板模型（`Record<swarmId, SwarmPanelSwarm> | null`）：角色名册与拓扑模式、每条已路由 `swarm/role-message` 及其父子/兄弟归因、群聊 transcript、待答 HITL 请求、上下文变量、群聊引擎状态，以及最新检查点/恢复标记。fold 是增量的——无关事件返回同一状态引用，因此变更推送只会在面板值真正变化时触发。

浏览器端以 `dsh-swarm-panel/client` 导出（经 package.json 的 `dsh.client` 声明发现）：一个 Conversation Flow 的 `conversation.view` 页签，外加头部的 swarm 计数徽章——无 RPC、无客户端 store，也不发起新的模型请求。该页签始终列在 Chat 和 Trajectory 旁边；徽章在会话还没有任何 swarm 时隐藏。Auto-scroll / Live 只控制视口跟随。空状态覆盖无 swarm、等待投影、projection 错误、无消息、无匹配、已终止和 pending HITL。每个角色泳道可打开该角色的子会话（`ctx.uiWorkspace.openSession`）；打开持久化的子会话会在宿主侧触发冷启动恢复，这就是面板触发恢复的方式。

## 兼容性与开发

当前包面向 DeepSeek Harness `0.2.x` 发布线（`0.2.0-rc.2` 及兼容版本——即当前桌面版内置的运行时），以及 Node.js `22.19+` 或 `24+`。运行时消费者通过 Harness profile 安装已发布包；源码级类型检查和测试需要匹配 tag `dsh-v0.2.0-rc.2` 的 Harness 工作区，只有开发依赖使用 `workspace:*`。该工作区必须在 `pnpm-workspace.yaml` 的 `packages:` 下声明 `plugins/*`（0.2.0 不再自带该 glob）。版本历史见 [CHANGELOG](https://github.com/stephenlzc/dsh-swarm-panel/blob/main/CHANGELOG.md)，当前版本为 **1.0.1**。

在匹配的 Harness 工作区中运行：

```bash
CI=true pnpm typecheck
CI=true pnpm test
pnpm build
npm pack --dry-run --json
```

根目录的发布清单区分了这些无 key 门禁、真实 API 冷启动测试和外部安装检查。

## 已知限制 / Roadmap

- **A2A / ACP 外部协议接入**：未交付（M5 范围控制）；事件模型为其留有空间。
- **嵌套 sub-swarm**：未交付——"只有 root agent 是 orchestrator" 的单层假设是有意为之；取舍记录在 PLAN.md（M7 设计注记）。
- **记忆消费方式**：记忆仅由 Orchestrator 写入/查询；角色不直接写，轮次提示词暂不注入记忆。
- **面板文案**目前仅英文（未接 locale 命名空间）。
- 真实 API 冷启动恢复 e2e（`tests/cold-resume.e2e.ts`）仅在设置 `DEEPSEEK_API_KEY` 时运行；常驻 mock-adapter 等价用例在 `tests/chat.spec.ts`。

## 里程碑

- **M0**：现状审计 + 数据模型扩展
- **M1**：跨会话冷启动恢复 / checkpoint
- **M2**：人机协作（简单 ask_user / 复杂 GUI 审批面板）
- **M3**：开放式群聊（speaker selection、上下文变量、终止条件）
- **M4**：可观测性 + GUI 面板（右侧 dock tab）
- **M5**：高级（嵌套 swarm、memory、A2A/ACP）

## 许可证

MIT
