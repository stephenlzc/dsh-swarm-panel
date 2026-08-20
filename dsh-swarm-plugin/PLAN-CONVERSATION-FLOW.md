# Conversation Flow Panel Implementation Plan

## 1. 实施边界

本计划只覆盖 `dsh-swarm-panel` 的 Conversation Flow Web panel。执行顺序是先建立 projection 数据，再实现 client 呈现，最后用真实 Web profile 验证；不改 swarm runtime、模型工具参数、durable event schema 或数据库。

实现以 [PRD-CONVERSATION-FLOW.md](PRD-CONVERSATION-FLOW.md) 为验收依据。任何需要新增事件、改变 relay attribution 或引入 RPC 的方案都必须停止并重新评估范围。

## 2. 现状基线

- `src/types.ts` 的 `RoleMessageData` 已包含 `from`、`to`、`senderSessionId`、`content` 和 `sentAt`。
- `src/panel-model.ts` 当前只把 `to: group` 的消息放入 `transcript`，普通 role-to-role 消息只增加计数。
- `SwarmPanelSwarm` 已有角色、状态、模型、topology、HITL、context、chat、checkpoint 和 resume 投影。
- `src/client/SwarmAction.ts` 当前渲染 session-header popover、roster、HITL、context 和最近 group transcript。
- `tests/panel-model.spec.ts` 已覆盖生命周期 fold，`tests/swarm-action.client.spec.ts` 已覆盖当前面板交互。

## 3. 数据设计

### 3.1 Projection model

在 `SwarmPanelSwarm` 增加面向 Conversation Flow 的 `flow` 或等价字段。每个消息至少包含：

```ts
type SwarmPanelFlowMessage = {
  readonly seq: number
  readonly from: string
  readonly to: string
  readonly senderSessionId: string
  readonly content: string
  readonly sentAt: string
  readonly attribution: 'orchestrator' | 'peer'
}
```

保留现有 `transcript` 作为 group-chat engine 的语义；不要让群聊 prompt 所用 transcript 与可观测流消息互相污染。若实现选择重命名字段，必须同步更新所有 client、测试和 JSDoc。

### 3.2 Attribution fold

在 projection fold `swarm/role-message` 时保留所有消息。若 `senderSessionId` 等于任一已知 role 的 `childId`，则 attribution 为 `peer`；否则 attribution 为 `orchestrator`。`from: human` 仍显示为 Human lane，但 attribution 仍按其实际 sender session 记录。

Role spawn 事件晚于 message 事件时，先保留原始 sender session id，待后续 fold 或 client 重新计算 attribution；不能丢弃消息。

`to: group` 的消息进入 flow，但不生成复制到每个 role 的伪消息。group 由单独的 marker 表达。

### 3.3 Reference and limits

使用 event `seq` 作为稳定消息 key 和详情定位依据。不要生成随机 id，也不要把 session event 写回去。完整日志仍保持在 session persistence 中，client projection 可以提供最近窗口，但窗口策略必须集中定义并在测试中覆盖。

## 4. Client 实施阶段

### Phase A — Panel shell

1. 将当前 360px popover 改为宽面板，保持 session-header 的 `Swarms: N` 入口和现有主题 token。
2. 建立顶部 swarm header、topology summary strip、filter row、conversation canvas、details drawer 和 footer live controls。
3. 先用现有 projection 字段渲染 roster、状态、HITL、context、chat、checkpoint 和 summary，不在 client 内创建第二份 swarm store。

### Phase B — Conversation canvas

1. 根据 flow message participants 构建稳定泳道：Orchestrator、按 spawn order 的 roles、Human。
2. 每条消息显示时间、类型、route badge、from/to 和短内容；按 `seq` 排序。
3. 用实线表达 parent-child，用虚线/双向箭头表达 peer；mixed 只改变顶部全局标签，单条消息仍按 attribution 渲染。
4. 对 group message 使用 group marker；不要复制消息卡片。
5. 在消息卡片上添加选中状态和键盘 focus 状态。

### Phase C — Filters and details

1. 实现 route、sender、recipient、文本搜索和 human input 过滤，并显示匹配数量。
2. 过滤结果为空时显示明确空状态，并提供 Clear filters。
3. 点击或键盘确认消息打开 details drawer，显示完整 content、seq、时间、from、to、sender session、attribution 和可用的 open-session actions。
4. 点击 role header 或详情中的 session action 调用现有 `onOpenSession`；不新增 host RPC。

### Phase D — Live behavior and states

1. projection model 引用改变时追加新消息，Live 开启且视口在底部时自动跟随。
2. 用户向上滚动时暂停自动跟随，显示 `N new messages`，点击后回到底部。
3. 处理 loading、no swarm、no messages、no matches、terminated、pending HITL 和 projection error 状态。
4. 为所有 icon button 添加 accessible name，为弹层、详情区和筛选控件补齐 keyboard interaction。

## 5. 测试计划

### 5.1 Projection tests

- parent-child：Orchestrator sender session → role。
- peer：child sender session → sibling role。
- mixed：同一个 swarm 中同时出现 orchestrator-attributed 和 peer-attributed 消息。
- group message：只产生一个 group marker，不复制为多条 role 消息。
- role spawn 顺序稳定，后续 role-exited、resume 不改变历史消息顺序。
- 无关 event 返回同一 model reference。
- message `seq` 稳定，重复 fold 不生成重复消息。

### 5.2 Client tests

- renders lanes and route badges for all three interaction types。
- filters by route、sender、recipient、search text and human input。
- opens message detail and displays full metadata。
- opens sender/recipient child session when available。
- live toggle、pause-on-scroll 和 new-message affordance 行为正确。
- empty、terminated、pending HITL 和 no-match 状态可读。
- keyboard focus、Enter/Space、Escape 和 accessible names 可用。

## 6. 验证命令

实现后至少运行：

```sh
pnpm --filter dsh-swarm-panel typecheck
pnpm exec vitest run plugins/dsh-swarm-plugin/tests/panel-model.spec.ts plugins/dsh-swarm-plugin/tests/swarm-action.client.spec.ts
pnpm --filter dsh-swarm-panel build
git diff --check
```

如果修改了 README 截图或双语 README，还要运行对应的 translation pairing check，并在真实 Web profile 中创建至少三角色 swarm，验证 parent-child、peer 和 mixed 消息各一条。

## 7. 浏览器验收脚本

1. 启动干净的 Web profile 并打开新 session。
2. 创建 `default` swarm，spawn `planner`、`researcher`、`reviewer`。
3. 发送一条 Orchestrator → Planner 的消息，确认显示 `parent → child`。
4. 切换到 peer 或 mixed，发送 Planner → Researcher 和 Researcher → Reviewer 的消息，确认显示 `peer ↔ peer`。
5. 触发一次 HITL，确认 Human lane 出现 pending message。
6. 点击任意消息，确认详情区显示完整内容、route、sender session 和时间。
7. 向上滚动并暂停 Live，再产生新消息，确认出现 `N new messages`，恢复 Live 后回到底部。
8. 点击 role 或详情中的 open-session，确认进入正确 child session。

## 8. 交付判断

实现完成的最低条件是：数据 projection 能区分实际 parent/peer attribution，Conversation Flow 能显示所有已记录 role-message，三类 route 可以筛选，消息详情可读，Live 行为可控，旧 runtime/tool/resume 测试不回归。

如果真实浏览器无法同时产生三种 route，则使用 projection fixture 验证语义，并在交付报告中明确说明真实 API 场景未覆盖的部分；不得用静态假数据冒充真实运行结果。
