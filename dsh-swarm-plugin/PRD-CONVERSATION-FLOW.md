# Conversation Flow Panel PRD

## 1. 产品定义

Conversation Flow 是 `dsh-swarm-panel` 的 Web 可观测面板，用一条可筛选、可暂停、可展开的 Agent 消息流解释 swarm 内部的协作过程。

面板必须让操作者在几秒内回答三个问题：谁向谁发送了消息、消息通过父子还是兄弟关系传递、这条消息之后发生了什么。

本 PRD 针对 DeepSeek Harness 的现有浅色 Web UI 和 session-header 入口；不改变插件的事件命名空间、relay 安全模型或持久化格式。

## 2. 用户与场景

### 2.1 目标用户

- 操作 swarm 的开发者：确认 Orchestrator 是否按预期分派任务。
- 调试插件的维护者：定位错误路由、重复消息、角色停滞和 HITL 等待。
- 展示 swarm 能力的用户：直观看到父子、兄弟和混合交互，而不是只看到角色列表。

### 2.2 核心场景

1. Orchestrator 把任务分给 Planner，Planner 再把研究任务发送给 Researcher。
2. Researcher 和 Reviewer 通过 peer-to-peer 交换结果，操作者需要确认这不是 Orchestrator 代发。
3. Mixed topology 下，不同消息使用不同 attribution；面板必须按每条消息的实际归因显示路由。
4. 某条消息要求人工确认，Human lane 显示等待状态并能跳转到原会话。
5. 实时运行期间，消息不断到达；操作者可以暂停自动滚动，检查历史后再恢复 Live。

## 3. 设计目标

- 关系优先：泳道、方向箭头和 route badge 同时表达发送者、接收者和归因。
- 时间优先：所有已记录的 Agent-to-Agent 消息按 session event 顺序排列，消息详情保留完整元数据。
- 混合拓扑可解释：全局显示当前 topology mode，每条消息显示实际 `parent-child` 或 `peer` 路由。
- 逐步展开：默认展示摘要和短内容，点击消息后再显示完整内容、session id 和路由信息。
- 复用现有 DSH UI：使用现有主题 token、按钮、输入框、状态色和会话打开动作。
- 可审计：面板只消费 session projection，不直接读取 host runtime，不发起新的模型请求。

## 4. 非目标

- 不在本期增加可拖拽的 Agent/Flow Builder。
- 不在本期改变 `swarm_send_to`、`swarm_set_topology` 或其他模型工具的参数。
- 不在本期新增 session event 类型、数据库表、迁移或新的实时 RPC。
- 不在本期实现面板内发送 Agent 消息、修改拓扑或终止角色；面板操作以查看和打开子会话为主。
- 不把完整 session transcript 复制到浏览器；消息内容只通过已有 projection 到达客户端。

## 5. 信息架构

### 5.1 Header 与 Live 状态

面板继续从 session header action 打开，但打开后使用宽面板或右侧 inspector，而不是 360px popover。顶部显示 swarm 名称、当前 topology、Active/Paused/Terminated 状态、消息总数和 Live 开关。

### 5.2 Topology summary strip

顶部显示简化的关系摘要：Orchestrator → Planner → Researcher，并以虚线或双向箭头标记 peer route。Mixed 模式同时显示 `Mixed` 和最近若干条消息的实际 route 分布。

摘要 strip 是导航和解释组件，不承担完整图谱布局；复杂关系统一在下方消息流中表达。

### 5.3 Filter row

过滤器至少包括 `All messages`、`Parent → Child`、`Peer ↔ Peer`、`Mixed / System` 和 `Human input`，每个过滤器显示当前数量。

过滤器必须组合工作：文本搜索、角色筛选和 route 类型筛选可以同时使用；清除筛选后回到最新消息位置。

### 5.4 Conversation canvas

主区域采用泳道布局：Orchestrator、每个 role 和 Human 各占一列；消息卡片按时间从上到下排列，连接线从发送者列指向接收者列。

每条消息至少显示时间、消息类型、发送者、接收者、route badge 和截断后的内容预览。消息卡片的颜色只表达 route 或状态，不为每个 Agent 分配强烈的独立颜色。

### 5.5 Message details

点击消息打开右侧详情区，显示完整内容、消息时间、`from`、`to`、`senderSessionId`、实际 attribution、route 类型、消息序号和关联 Agent。详情区提供 `Copy message`、`Copy event metadata` 和 `Open sender/recipient session` 动作；没有目标 session 时动作禁用并保留原因。

### 5.6 Human lane 与 HITL

Human lane 显示 `swarm/hitl-requested`、等待中的问题、已回答或取消的结果。待回答状态使用警告色，但不阻塞其他消息浏览；点击后打开原始 swarm 会话。

### 5.7 Live controls

Live 模式下新消息自动追加并保持视口在底部；用户向上滚动后自动暂停滚动，并显示 `N new messages` 提示。`Pause live` 只暂停视图跟随，不暂停 swarm runtime 或 Agent。

## 6. 路由语义

### 6.1 Parent-child

`parent-child` 表示消息以 Orchestrator session 作为被接收方感知的 sender。显示为实线单向箭头，badge 为 `parent → child`；即使 `from` 是某个 role，只要 `senderSessionId` 是 Orchestrator session，仍按 parent attribution 显示。

### 6.2 Peer-to-peer

`peer` 表示消息以发送 role 的 child session 作为 sender。显示为虚线双向风格，badge 为 `peer ↔ peer`；`from` 和 `to` 保留真实 role 名称。

### 6.3 Mixed

`mixed` 是 swarm 的全局配置，不把所有消息都标成 mixed。面板根据每条事件的 `senderSessionId` 与 role child ids 判断实际 attribution，并将该条消息渲染为 parent-child 或 peer；顶部同时保留 `mixed` 全局标识。

### 6.4 Group message

`to: group` 的群聊消息在发送者泳道渲染一张带 group badge 的消息卡片；它不在其他泳道重复渲染，也不伪造成多条 relay 消息——接收方集合已经包含在卡片 metadata 里。

## 7. 数据要求

现有事件已提供 `from`、`to`、`senderSessionId`、`content` 和 `sentAt`，无需改变 durable event schema。

现有 `SwarmPanelSwarm` 已提供角色、状态、模型、topology、messageCount、pending HITL、context、chat、checkpoint 和 resume 数据；projection 需要新增或扩展一个面向流视图的消息集合，包含所有 `swarm/role-message`，而不仅是 `to: group` 的 transcript。

推荐的客户端消息字段：`from`、`to`、`senderSessionId`、`content`、`sentAt`、事件顺序号和由 projection 计算的实际 attribution。事件顺序号用于稳定 React key 和详情定位，不作为新的持久化 id。

projection 必须对无关事件返回同一引用，并在消息顺序不变时保持稳定顺序。浏览器只展示受控窗口，完整日志仍由 session persistence 负责。

## 8. 可访问性与状态

- 面板、详情区和筛选器使用语义 landmark、button、label 和 `aria-expanded`。
- 不能只用颜色区分 route；每个 route 必须同时有文字 badge 或图标语义。
- 键盘可以打开面板、切换过滤器、聚焦消息、打开详情并关闭详情。
- 空 swarm、无消息、无匹配结果、等待投影、终止 swarm 和 projection 错误都必须有明确文案。
- 长消息和长 role 名称截断显示，但 title 或详情区保留完整值。

## 9. 成功标准

- 操作者无需阅读模型回复，就能从面板识别一条消息的 `from → to` 和实际 route。
- 一个同时包含 parent-child、peer 和 mixed 的 fixture 能在同一面板中正确显示三种关系。
- 点击任意消息可以看到完整消息和 sender session metadata。
- 新消息实时到达时，Live、Pause 和 `N new messages` 行为可预测。
- 面板不增加新的模型请求，不修改旧 session 的读取方式，不引入新的持久化格式。
- 现有 Swarm runtime、tool、resume 和 session projection 测试继续通过。

## 10. 交付物

- `src/panel-model.ts`：全量 role-message projection 与 route attribution。
- `src/client/SwarmAction.ts`：Conversation Flow 面板、泳道、筛选、详情和 Live 状态。
- `tests/panel-model.spec.ts`：三种 route、group message、稳定顺序和无关事件引用测试。
- `tests/swarm-action.client.spec.ts`：过滤、消息详情、键盘/打开 session、空状态和 Live 行为测试。
- README 截图或示例：展示真实的父子、兄弟和混合消息流。
