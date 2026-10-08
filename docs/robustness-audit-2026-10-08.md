# G4 对抗性稳健性审查 — dsh-swarm-panel 0.2.0

- 审查对象：/Users/cong/Documents/AI_Project/dsh-swarm-panel/dsh-swarm-plugin（工作区未提交状态）
- 被审源码版本：repo HEAD 8d8b1a8 + 工作树修改；审查用副本 /tmp/tc/plugin/src 与工作区 src **逐字节相同**（`diff -r` 无输出，审查时点 2026-10-08）
- 审查方式：只读通读 src/*.ts + src/client/*.ts + tests，并在 `/tmp/verify-audit/adversarial` 用 harness 0.2.0-rc.2 真实栈（cordis + AgentLoop + SubagentRuntime + SubagentSpawn + JSONL 持久化 + UserQuestionService + + MockAdapter）写对抗性探针复现。
- 未写仓库任何文件；所有产物在 /tmp/verify-audit/。
- 复现命令（7 个 probe 共 25 个用例，全部通过=断言的观测成立）：
  ```bash
  cd /tmp/verify-audit/adversarial
  /tmp/tc/node_modules/.bin/vitest run --root /tmp/verify-audit/adversarial --reporter=basic
  # 单次全量日志：/tmp/verify-audit/all-probes.log（另有 probe1..7.log）
  # probe 源文件：probe-1-pure.spec.ts … probe-7-harness.spec.ts（+ mock-adapter.ts 复制自 harness 测试）
  ```
- 计数：**阻断 0 / 高 2 / 中 7 / 低 6 / 未验证假设 3**。

---

## 高

### G4-01 [高] 子代理处于 maintenance（压缩）阶段时，group-chat 轮次记录到的是"上一轮的旧回复"

- 位置：`src/runtime.ts:582-604`（`awaitChildReply.evaluate`），关键行 `584` `if (child.status !== 'idle') return undefined`、`587-594`（watermark 初值 0，找不到本次投递的 `user/message` 就退化为 0）、`595-601`（从日志尾部回扫任意 `assistant/message`）；调用点 `src/runtime.ts:565-579`（runTurn）、`src/engine.ts:213-215`。
- 触发条件（可复现）：
  1. 子代理已经被 deliver 过一次并留有 `assistant/message`（例如 spawn 的初始 prompt 回复）；
  2. 子代理此刻处于 **maintenance phase**（`agent.runMaintenance`：自动压缩 compaction-basic、`/compact`、subagent settlement teardown，见 harness `packages/compaction/compaction-basic/src/index.ts:390`、`packages/subagent/subagent/src/continuation-activation.ts:752`）。
  3. 此时 `swarm_next_turn` 投递 turn prompt：harness 的 `status` getter 把 `maintenance` 报成 `'idle'`（`packages/core/agent-loop/src/agent.ts:145-147`），`followup` 的 `wakeDriver` 在非 idle phase 只置 latch 不改状态（`agent.ts:212-225`），而 `user/message` 事件要等 driver claim 时才 append（`agent.ts:421`）。
  4. 于是首次 `evaluate()` 立刻通过 idle 检查、watermark 又找不到本次 messageId，便从日志尾部回扫，返回**上一轮**的 assistant/message。
- 后果：group transcript 记录旧文本（不是本次回复）；`terminationMessage`/Chat 停止条件基于错误文本判断；真实回复稍后落到子会话但永不入 transcript → 观感与裁决双双错误。
- 原始证据（probe-3，真实栈 + MockAdapter）：
  ```
  assistant messages before the turn = ["ok"]
  child.status during maintenance = idle
  recorded turn = {"swarmId":"sw","turns":[{"speaker":"alpha","reply":"ok"}],"ended":false}
  group transcript = [{"from":"alpha","content":"ok"}]
  assistant messages after the real reply = ["ok","alpha speaks"]
  ```
  即本轮真实回复 `"alpha speaks"` 被丢弃，记录成 spawn 阶段的 `"ok"`。
- 最小修复：`evaluate()` 里把"未找到本次 messageId 的 `user/message`"视为**未就绪**（返回 undefined 继续等待），不要退化成从 0 扫描：
  ```ts
  let watermark = -1
  for (...) { if (user/message && id===messageId) { watermark = index; break } }
  if (watermark < 0) return undefined      // ← 关键
  for (let index = events.length - 1; index > watermark; index--) ...
  ```
  另建议给 awaitChildReply 增加超时/取消兜底（见 G4-08）。
- 验证方式：`probe-3-harness.spec.ts` 第一个用例（`vitest run --root /tmp/verify-audit/adversarial probe-3-harness.spec.ts`）。
- 置信度：高（机制与观测均确证）；发生**频率**取决于投递瞬间恰好命中 maintenance 窗口（压缩可能持续数秒），非每日必现但真实存在。

### G4-02 [高] 插件未激活时，带 swarm 事件的会话直接不可加载（事件缺 `ignorable`，靠改全局 Set 续命）

- 位置：`src/index.ts:198-235`（`SWARM_EVENT_TYPES` / `registerSwarmEventTypes` 直接改写 `KNOWN_SESSION_EVENT_TYPES`），所有 `session.append('swarm/*')` 均不带 `ignorable`（如 `runtime.ts:238, 297, 357, 405, 430, 497, 540, 643`）；harness 侧拒绝点 `packages/session/session-persistence/src/storage-contract.ts:73-78`，而 `Session.append`（`packages/core/session/src/index.ts:722-737`）**没有** ignorable 选项。
- 触发条件：任意一次 `swarm/*` 落盘后，用（a）`enabled:false`、（b）从 profile 移除/卸载插件、（c）插件加载失败、（d）换了不含该插件的 harness，去 resume 该会话。
- 后果：`SessionFormatUnsupportedError`，**整个会话打不开**（不是面板降级）。用户"临时关掉插件"就会永久性打不开自己的会话日志。
- 原始证据（probe-3，同一持久化 root，先写后读）：
  ```
  raw swarm event envelope = {"type":"swarm/role-spawned","seq":2,...}      # 无 ignorable 字段
  resume WITH plugin: ok, events = 16
  resume WITH plugin disabled FAILED = SessionFormatUnsupportedError: session "adv-ignorable-root"
    contains event type "swarm/created" (seq 0) unknown to this harness and not marked ignorable;
    refusing to interpret the log — it was likely written by a newer harness
  ```
- 说明/最小修复：harness 的 catalog header 明确写了 *"event-name registration was rejected because it does not classify omission safety and would make reads composition-dependent"*，即本插件注释里"注册词表是官方延期的扩展面"的说法与 0.2.0-rc.2 源码相矛盾；插件侧无法给 `append` 传 `ignorable`。因此可做的最小修复是：(1) 删除/纠正 `index.ts:198-205` 的错误论证，明确这是平台契约缺口；(2) 把"本插件是打开含 swarm 会话的硬前置"写进 README 并在 host 侧检测（例如打开会话时若已知类型缺失则显式报友好错误而不是让持久化层拒绝）；(3) 在上游为 out-of-repo 事件提供 `ignorable` 落盘通道。
- 验证方式：`probe-3-harness.spec.ts` 第二个用例。
- 置信度：高（端到端复现）。

---

## 中

### G4-03 [中] `terminate()`/`interrupt()` 非异常安全：`subagents.interrupt` 抛错即"半终止"

- 位置：`src/runtime.ts:347-366`（interrupt：先 interrupt 再 append `role-exited` 再 delete，任一步抛错则后续全跳）、`src/runtime.ts:638-649`（terminate：`cancelPendingHitl → interrupt(undefined) → append destroyed → terminated=true`，interrupt 抛错则 destroyed 不写、terminated 保持 false）；`src/tools.ts:611-617`（swarm_interrupt 的 execute 无 try/catch，与 `dispose()` 的 try/catch 不对称）。
- 触发条件：harness `interrupt` 在 authority 校验失败时抛 `UNAUTHORIZED`（`packages/subagent/subagent/src/continuation-activation.ts:291-308`：`ctx.agents.get(caller.id) !== caller`，或 `!activation.ancestry.has(agent)`，例如 UI 直接把 childId 作为 root 冷恢复后它不再是该 orchestrator 的后代）。
- 后果：`swarm_terminate` 返回 `internal_error`，但（a）无 `swarm/destroyed`，（b）角色在 fold 中仍是 running，（c）`swarm_start_chat`/`swarm_next_turn` 继续可用 —— 编排层以为已终止，实际继续跑。
- 原始证据（probe-2）：
  ```
  terminate result isError = true value = undefined
  roles after failed terminate = [{"roleName":"worker","childId":"c1","status":"running"}]
  swarm/destroyed present = false
  start_chat after failed terminate = {"swarmId":"s","topic":"T","speakerSelection":"round_robin"}
  ```
- 最小修复：`interrupt` 每个 child 用 try/catch 包裹（与 dispose 一致），无论成败都 append `role-exited` 并 delete；`terminate` 先写 `swarm/destroyed`、置 `terminated=true`，再 best-effort interrupt。
- 验证方式：`probe-2-harness.spec.ts` "terminate is not exception-safe"。
- 置信度：高（异常路径确证；触发需要 harness 的 UNAUTHORIZED 前提）。

### G4-04 [中] 已终止的 swarm 仍可 `swarm_spawn`，产生永远无人 interrupt 的孤儿子代理

- 位置：`src/runtime.ts:196-247`（spawnRole 无 `terminated` 守卫）、`src/tools.ts:484-502`；对照 `src/engine.ts:184-188`（next_turn 有 terminated 守卫）与 `src/runtime.ts:125-132`（hydrate 会恢复 terminated）。
- 触发条件：orchestrator 先 `swarm_terminate` 再 `swarm_spawn`（模型连续两次调用 / 用户中途改主意）。
- 后果：`swarm/role-spawned` 落在 `swarm/destroyed` **之后**；新角色可被 list 成 running，但 next_turn 立即 `swarm-terminated` 返回，因此它永远不会被驱动也永远不会被 interrupt（`children` 里的它只在 dispose 时被处理）；面板显示"已终止 swarm 里有 running 角色"。
- 原始证据（probe-2）：
  ```
  spawn-after-terminate isError = false value = {"swarmId":"s","roleName":"reborn","childId":"c2"}
  list after terminate+spawn = {"roles":[{"roleName":"worker","status":"exited"},{"roleName":"reborn","status":"running"}],...}
  event tail = ["swarm/created","swarm/role-spawned","swarm/role-exited","swarm/destroyed","swarm/role-spawned"]
  interrupt calls = ["c1"]          # c2 从未被 interrupt
  next_turn after terminate = {"turns":[],"ended":true,"endReason":"swarm-terminated"}
  ```
- 最小修复：`spawnRole`/`sendMessage`/`askUser` 入口统一 `if (this.terminated) throw new Error('swarm: terminated')`；工具层映射成 `invalid_argument`/`unavailable`。
- 验证方式：`probe-2-harness.spec.ts` "spawn vs terminate lifecycle"。
- 置信度：高。

### G4-05 [中] 重新 spawn 同名角色不会 interrupt 被替换的旧子代理（活体泄漏）

- 位置：`src/runtime.ts:228-230`，`this.children.set(roleName, childId)` 直接覆盖，旧映射被丢弃且无 `interrupt`；工具描述（`src/tools.ts:463-464`）把"re-spawning a named role replaces it"当作特性。
- 触发条件：对一个 running 角色再次 `swarm_spawn`（模型重试/改名失败常见）。
- 后果：旧子代理继续驻留、继续消耗 token、其 `senderSessionId` 仍在历史消息里但已不在 roster；`interrupt`/`dispose` 只处理新映射（`dispose` 里 `children` 已无旧 id）。
- 原始证据（probe-2）：
  ```
  re-spawn value = {"swarmId":"s","roleName":"worker","childId":"c2"}
  interrupt calls after re-spawn = []
  interrupt calls after terminate = ["c2"]     # c1 从未被中断
  ```
- 最小修复：spawnRole 覆盖前先 `const previous = this.children.get(roleName); if (previous) interrupt(previous)`，或明确拒绝同名重复 spawn（`invalid_argument`）。
- 验证方式：`probe-2-harness.spec.ts` 同上用例。
- 置信度：高。

### G4-06 [中] 已终止 swarm 上的 `swarm_ask_user` 会挂起，且没有任何 swarm 工具能取消它

- 位置：`src/runtime.ts:398-470`（askUser 无 `terminated` 守卫，先 append `hitl-requested` 再挂 wait）、`src/runtime.ts:633-641`（terminate 只 abort 当下 `pendingHitl`，且 `if (this.terminated) return` 使二次 terminate 成为 no-op）。
- 触发条件：`swarm_terminate` 之后调用 `swarm_ask_user`（humanInputMode 默认 TERMINATE，工具仍可用）。
- 后果：`swarm/hitl-requested` 落在 `swarm/destroyed` 之后且永不 resolve；只有 orchestrator 自身 tool-call 的 signal abort 才能结束（届时写 `hitl-resolved: cancelled`）。若该 tool call 的 signal 长时间不 abort，编排被永久阻塞在 HITL 上。
- 原始证据（probe-2）：
  ```
  ask after terminate = still-pending-after-300ms
  event types tail = ["swarm/role-spawned","swarm/role-exited","swarm/destroyed","swarm/hitl-requested"]
  second terminate = {"ok":true}
  after second terminate = still-pending-after-2nd-terminate
  after tool abort = settled (hitl-resolved 落盘)
  hitl events = ["swarm/hitl-requested","swarm/hitl-resolved"]
  ```
- 最小修复：askUser 首行 `if (this.terminated) throw ...`（或直接返回 `{outcome:'cancelled'}` 且不落 `hitl-requested`）；`terminate` 去掉 early-return，或在 ended 状态也执行一次 `cancelPendingHitl()`。
- 验证方式：`probe-2-harness.spec.ts` "HITL after termination"。
- 置信度：高。

### G4-07 [中] 角色永不 settle：`markRoleSettled` 是死代码，harness 的 `subagent-settled` 通知被忽略

- 位置：`src/runtime.ts:369-380`（`markRoleSettled`，全 src 无调用者；`grep -n markRoleSettled src/*.ts` 只命中定义行）、`src/engine.ts:57-68`（`no-roles` 停止条件需要 activeRoleCount===0）、`src/resume.ts:83,158`（冷恢复只按 `status==='running'` 重新激活）。harness 的结算通知见 `packages/subagent/subagent/src/continuation-messages.ts:118-139`（`source.kind==='subagent-settled'`，`senderSessionId` = child id）。
- 触发条件：任意子代理自然结束一次任务（初始 prompt 完成、或把活干完）。
- 后果：fold/面板永远显示 running → 面板"Active"；`no-roles` 终止不可达；`swarm_list_children` 对 finished 子代理撒谎；**冷恢复会给已经结束的子代理再投一次恢复通知，把它重新唤醒并消耗一次 LLM turn**。
- 原始证据（probe-4，真实栈）：
  ```
  settlement notices seen by the parent = [{"source":{"kind":"subagent-settled","senderSessionId":"a5f8..."}}]
  role status after the child finished = [{"roleName":"alpha","status":"running"}]
  swarm/role-exited events = 0
  ```
- 最小修复：在 runtime/index 监听 orchestrator 的 `session/event`，遇到 `user/message` 且 `source.kind==='subagent-settled'` 时，按 `senderSessionId` 找到角色并 `markRoleSettled(name,'settled')`（错误终止则 'error'）；`hydrate` 已经会跳过 exited 角色，冷恢复的"唤醒死人"问题同时解决。
- 验证方式：`probe-4-harness.spec.ts` 第一个用例。
- 置信度：高。

### G4-08 [中] turn 进行中被 `swarm_interrupt`：要么回复被丢弃并报误导性 internal_error，要么该 tool call 永不 settle

- 位置：`src/engine.ts:213-215`（`await runtime.runTurn(...)` 后紧跟 `runtime.recordGroupMessage(...)`，中间不再校验角色是否还在）、`src/runtime.ts:536-548`（recordGroupMessage 对未知角色抛错）、`src/runtime.ts:347-366`（interrupt 会 `children.delete(name)`）、`src/runtime.ts:605-629`（awaitChildReply 无超时、只受 signal 控制）。
- 触发条件：chat 进行中，orchestrator 对正在说话的 role 调 `swarm_interrupt`（用户明确要求停止该 role）。
- 后果（两种都被复现）：
  - 子代理已落一条部分 assistant/message：awaitChildReply 正常返回 → recordGroupMessage 抛 `swarm: unknown role alpha` → 工具返回 `internal_error`，**该轮回复被静默丢弃（role-message 计 0）**；
  - 子代理被中断时没有任何 assistant/message：awaitChildReply 永不 settle → `swarm_next_turn` 永久 pending，直到 orchestrator 自己的 tool signal 被 abort。
- 原始证据（probe-6）：
  ```
  [partial] next_turn after interrupt = settled:{"code":"internal_error","message":"swarm: unknown role alpha"}
  [partial] child assistant messages = 1 | logged group messages = 0
  [empty]   next_turn after interrupt = still-pending-700ms-after-interrupt
  [empty]   child assistant messages = 0 | logged group messages = 0
  ```
- 最小修复：`runChatTurns` 在 `runTurn` 后、`recordGroupMessage` 前重读 `runtime.state()`，角色已 exited 则记 `endReason:'role-interrupted'` 收尾而不是抛错；`awaitChildReply` 增加超时（如可配置）与"角色被 interrupt"的显式取消通道；`recordGroupMessage` 对已退出角色返回 boolean 而非抛错。
- 验证方式：`probe-5-harness.spec.ts`、`probe-6-harness.spec.ts`。
- 置信度：高（两条路径均端到端复现）。

### G4-09 [中] 冷恢复的 catch-all 把任意投递失败当成"子会话丢失"，直接重 spawn 出重复子代理

- 位置：`src/resume.ts:104-136`（`catch (error) { signal.throwIfAborted(); if (runtime.isTerminated) throw error; /* fall through to re-spawn */ }`）。
- 触发条件：恢复通知 `deliverUnlogged` 因任何非 abort、非 terminated 的原因失败一次（临时 relay/锁失败、该 child 的 activation 正在关闭 `ACTIVATION_CLOSING`、`UNAUTHORIZED` 等）；下一次投递成功。
- 后果：`swarm/role-spawned` 追加新 childId，旧子会话被顶掉且**从不 interrupt**；`swarm/resumed` 记录 `action:'respawned'`；若旧子代理仍活着，就等于同名双活。
- 原始证据（probe-4）：
  ```
  pending resume = ["s"]
  role-spawned events = [{"roleName":"alpha","childId":"c1"},{"roleName":"alpha","childId":"c2"}]
  swarm/resumed records = [[{"roleName":"alpha","childId":"c2","action":"respawned"}]]
  interrupt calls on the replaced child = []
  ```
- 最小修复：区分"子会话不存在"（`not_found` 类错误 / host 明确的 child-missing 码）与其它错误；只有前者才 respawn，其余记 warning 并跳过（不写 `swarm/resumed` 记录或标 `action:'failed'`）。
- 验证方式：`probe-4-harness.spec.ts` 第二个用例。
- 置信度：高（路径确证；触发需要一次投递失败）。

---

## 低

### G4-10 [低] 事件词表注册是全局 Set，无引用计数；卸载任一插件实例会抹掉所有实例的词表

- 位置：`src/index.ts:229-235`（add/delete `KNOWN_SESSION_EVENT_TYPES`）、`src/index.ts:328-331, 403-410`（effect 生命周期）。
- 触发条件：同进程装载两个实例（HMR 替换、两个 profile）后再卸载其中一个。
- 原始证据（probe-4）：
  ```
  after apply = true
  after unloading ONE of two instances, still known = false     # 另一个实例仍在运行
  ```
- 后果：仍在运行的实例写入的新 session 在下次冷启动读取时会被持久化层拒绝（与 G4-02 同源）。当前进程内 append 不校验词表，所以不会立刻报错，属于"延迟爆炸"。
- 最小修复：模块级 refcount（`let registrations = 0`，add 一次/最后一个卸载时 delete），或直接放弃该机制并推动上游 ignorable 通道。
- 置信度：高（复现）；真实触发频率取决于是否存在双实例（中等偏低）。

### G4-11 [低] 每次工具调用都把**整个会话日志**折一遍：O(n) 重复扫描

- 位置：`src/runtime.ts:652-654`（`state()` 每次调用 `foldSwarmEvents(allEvents)`）、`src/runtime.ts:473-480`（nextHitlRequestId 全量扫描）、`src/runtime.ts:665-681`（writeMemory 全量 filter）；调用点：`engine.ts:181,210,217`、`tools.ts:580,656` 等。
- 实测（probe-3，20 万事件合成会话）：`state()` 平均 **1.86 ms/次**，`writeMemory` 0.86 ms/次 → 一次 `swarm_next_turn`（2–3 次 fold）约 4–6 ms 纯开销，且随会话长度线性增长；长会话（10 万+ 事件）每个 swarm 工具调用都要付这个成本。
- 最小修复：运行期内增量维护 fold（或缓存最后一次 fold 的 seq + 状态，只折新增事件）；`nextHitlRequestId`/`writeMemory` 维护内存计数器。
- 置信度：高（数值可复现），影响为性能而非正确性。

### G4-12 [低] fold 与 panel-model 的若干语义分歧

全部为纯函数层，probe-1 输出为证：
1. 重复 requestId 的 `swarm/hitl-requested`：domain 用 Map 去重（`domain.ts:101-113`），panel 直接 push 重复（`panel-model.ts:322-332`）→ `domain pending=[{hitl-1,q1-again}]` vs `panel pending=[{hitl-1,q1},{hitl-1,q1-again}]`。
2. `swarm/resumed` 指向一个 fold 认为 exited 的角色：domain 保持 `exited/error`，panel 翻成 `running`（`panel-model.ts:303-320`）。本版本自身不会产生（resume 只列 running 角色），外来/未来写入者可达。
3. `swarm/destroyed` 时 chat 仍 active：两边都保持 `active:true`（`panel-model.ts:293-296`），面板 meta 会显示 "terminated … chat running"（`src/client/SwarmAction.ts:753-756`）。
4. `FLOW_WINDOW=200` 只截 `flow`；`transcript` 无上限（`panel-model.ts:50, 277-279`）→ 实测 250 条消息时 `transcript=250, flow=200`；projection wire 负载随会话无限增长（面板 footer 的 total 又取自被截断的 flow）。
5. 显式 `attribution:'peer'` 在 parent-child 拓扑下同样生效（`runtime.ts:336-344`），与工具描述"only meaningful in mixed"（`tools.ts:518-522`）不符。
- 最小修复：panel 侧 hitl 按 requestId upsert；resumed 只在 fold 状态为 running 时翻状态；`destroyed` 同步 `chat.active=false`；给 `transcript` 也用窗口或改 footer 计数源；`resolveSenderSessionId` 在非 mixed 拓扑忽略显式 peer 覆盖。
- 置信度：高（输出为证），影响为显示/一致性类。

### G4-13 [低] projection `stateSchema` 严格性：`chat.startedAt` 必填 + `restore()` 用 `.parse` 抛错

- 位置：schema `src/index.ts:277-286`（`chat.startedAt: zod.string()` 必填）与 reducer `src/panel-model.ts:343-364`（原样拷贝 `data.startedAt`，无 `asString` 兜底）；harness `packages/session/session-projection/src/index.ts:521` 在 `restore()` 用 `stateSchema.parse`（**抛**），而 `viewCheckpoint` 是 try/catch 跳过（`:462-464`）。
- 触发条件：任何缺 `startedAt` 的 `swarm/chat-started` 事件（旧版本写入者、被裁剪/手改的日志）。本版本自身写的事件都带该字段。
- 后果：模型校验失败 → `restore()` 抛错 → 会话投影恢复失败（不是面板降级）。
- 原始证据（probe-1）：
  ```
  stateSchema null -> true
  stateSchema {} -> true
  stateSchema(model).success = true        # 全事件序列产出的模型通过
  subset swarm/chat-started -> false
    [{"expected":"string","path":["sw","chat","startedAt"],"message":"Invalid input: expected string, received undefined"}, ...]
  ```
- 结论：任务里担心的"stateSchema 是否会拒绝 null / 空对象"**实测不会**（两者都 true）；真正的风险只在缺字段的历史写入者上，且失败模式是硬恢复错误。
- 最小修复：`startedAt: zod.string().optional()`（或在 reducer 用 `asString` 兜底），并建议 host 侧对可恢复的字段一律 optional。
- 置信度：高（构造复现）；实际可达性低（需要外来写入者）。

### G4-14 [低] 冷恢复期间被 terminate：`swarm/resumed` 会追加在 `swarm/destroyed` 之后，面板"复活"已退出角色

- 位置：`src/resume.ts:146-168`（循环里只检查 `runtime.isTerminated`，但如果 terminate 发生在某一个 role 投递**成功之后**，records 已非空，仍会 append `swarm/resumed`）、`src/panel-model.ts:303-320`（resumed 把角色翻成 running，不清 `terminated`）。
- 原始证据（probe-7）：
  ```
  event tail = ["swarm/role-spawned","swarm/role-spawned","swarm/role-exited","swarm/role-exited","swarm/destroyed","swarm/resumed"]
  swarm/resumed index = 6 swarm/destroyed index = 5 => resumed AFTER destroyed = true
  resumed records = {"roles":[{"roleName":"alpha","childId":"c1","action":"resumed"}],...}
  panel terminated = true | roles = [["alpha","running"],["beta","exited"]]
  pending after termination = []          # 已终止 swarm 不会被重新激活 ✔
  pending on a duplicate hydrate = []     # 重复 hydrate 幂等 ✔
  ```
- 最小修复：append `swarm/resumed` 前重读 `runtime.state().terminated`，terminated 则跳过/记录为 aborted。
- 置信度：高（复现）；触发是窄窗口。

### G4-15 [低] 人类答复投递的 source 语义：`from:'human'` 的答案以 `agent-message` 源投递给子代理

- 位置：`src/runtime.ts:287-305`、`src/runtime.ts:316-329`（统一传 `{kind:'agent-message', form:'relay', senderSessionId: this.agent.session.id}`）；工具描述与实现声称"attributed to human"（`tools.ts:674, 693, 706`）。harness 侧 `queuePrompt` 用 `createUserMessage({content, source})`（`packages/subagent/subagent/src/continuation.ts:490-506`），非 `createAgentMessage` 前缀路径。
- 后果：swarm 日志/面板显示 human，子代理会话里该消息的 durable source 却是 orchestrator 的 agent-message（子会话 UI 归属不一致）。功能不坏，但"human attribution"是名义上的。
- 最小修复：为 human 答复使用与语义一致的 source（若 harness 无 human 源，至少在文档里写明是 orchestrator 代理转述）。
- 置信度：中（源码确证；未端到端断言 child 侧渲染）。

### G4-16 [低/信息] 并发执行假设：`swarm_next_turn` 无串行化保护，但目前被调度器兜住

- 位置：`src/engine.ts:167-239`（无 per-runtime 互斥）、`src/tools.ts` 各 `defineTool`（均未声明 `isConcurrencySafe`）。
- 实测（probe-2，直接并发 `ctx.tools.execute`）：
  ```
  SEQUENTIAL speakers = ["alpha","beta"]
  PARALLEL  speakers = ["alpha:alpha speaks","alpha:alpha speaks"]
  group transcript = ["alpha","beta","alpha","alpha"]
  ```
- 可达性判定（**重要**）：harness 的调度器对"未声明 `isConcurrencySafe`"的工具一律判为 `exclusive`（`packages/core/tools/src/index.ts:1298-1311`），`executeToolCalls` 据此形成栅栏（`packages/core/agent-loop/src/tool-calls.ts:83-92`）。因此**经原生 agent loop 的并发工具调用不会命中该竞态**；仅当有人绕过调度器直接并发执行（第三方插件/测试/PTC 嵌套）或未来给这些工具声明 concurrency-safe 时才暴露。
- 建议：加一个 per-runtime 的 in-flight 互斥（第二个并发调用直接返回 `unavailable: another turn is in flight`），把保护从调度器默认值变成显式契约。
- 置信度：高（观测），可达性判定高（源码）。

---

## 已验证为"没问题"的点（负结果，避免误报）

- 取消/中断传播本身是对称的：`askUser` 的 abort → `controller.abort()` → `cancelled` → `hitl-resolved: cancelled` → `finally` 删 `pendingHitl`（`runtime.ts:414-469`），探针里 abort 后事件序列正确；`terminate` 能取消**当时**挂起的 ask（既有测试也是这么断言的）。
- `hitl-<n>` id 在并发下不冲突：计数+append 都在首个 await 之前同步完成（`runtime.ts:404-418`）。probe-5 并发两个 `swarm_ask_user` → `["hitl-1","hitl-2"]`，答复各自正确。`mem-<n>` 同理（`writeMemory` 全程同步）。
- `awaitChildReply` 的监听器在 resolve/abort/reject 三条路径都清理（`runtime.ts:613-628`），无监听器泄漏。
- projection `stateSchema` 接受 `null` 与 `{}`，也接受本版本全事件序列产出的完整模型（见 G4-13 证据）。
- `hydrateSwarmRuntimes` 幂等、已终止 swarm 不重新激活、重复 hydrate 返回空（probe-7 输出）。
- `foldSwarmEvents` 对 `swarm/resumed` 的忽略是有意设计且自洽（角色状态由 role-spawned/role-exited 决定）。

## 未验证假设（无端到端证据，明确标注）

1. **跨模块实例的 Set 共享**：`index.ts:230` 依赖插件的 `@deepseek-ai/dsh-session` 与持久化读路径是同一模块实例。单 pnpm 树成立；若安装树里出现重复副本，注册静默失效、下次冷启动会话不可读。未构造重复实例验证。
2. **`stateVersion: 2` 与历史持久化行的交互**：`restore()` 对 ver 不匹配的行在 `baseSeq > 0` 时抛 "re-read from seq 0"（harness 侧契约，调用方应重读）。未验证真实 host 是否总能正确重读。
3. **UI 直接以 root 打开 childId 后 `interrupt` 的 UNAUTHORIZED**：这是 G4-03/G4-08 的"现实触发条件"推断（harness 源码 `continuation-activation.ts:291-308`），未在真实 host+UI 组合里复现。

## 结论

- 版本 0.2.0 的**纯函数层（domain/panel-model/memory）与投影 schema 基本稳健**：schema 不拒绝合法状态，fold 与面板只在边角语义上分歧。
- 真正的生产风险集中在 **生命周期与投递边界**：G4-01（旧回复被当成本轮回复）、G4-02（插件未激活会话即不可读）为高；G4-03/04/05/06/07/08/09 为中的"半应用/孤儿/挂起/永不 settle"族缺陷，均有可复现的原始输出。
- 修复优先级建议：G4-01（一行 watermark 修复 + 超时）、G4-02（文档/检测 + 上游 ignorable）、G4-03/04/06（terminated 守卫与异常安全，改动小、收益大）、G4-07（结算检测，顺带修掉冷恢复唤醒死人）、G4-08/09。

---

## 修复状态（2026-10-08，Lead + 回归测试）

| ID | 严重度 | 状态 | 修复位置 / 说明 |
| --- | --- | --- | --- |
| G4-01 | 高 | ✅ 已修 | `src/runtime.ts` `awaitChildReply`：watermark 未命中时返回 undefined（不再回退到 0 扫描），并加 `turnTimeoutMs`（默认 300000）兜底 |
| G4-02 | 高 | ⚠️ 缓解 | `src/index.ts`：纠正与 Harness 设计矛盾的注释；新增 `keepEventVocabularyWhenDisabled` 开关，让"临时停用"的插件仍保持会话可读。上游仍缺 `ignorable` 落盘通道（本报告保留） |
| G4-03 | 中 | ✅ 已修 | `runtime.interrupt` 每步 try/catch 且始终写 `role-exited`；`terminate` 先置 terminated 并写 `swarm/destroyed`，再 best-effort interrupt；`tools.ts` 的 interrupt/terminate 也包 try/catch |
| G4-04 | 中 | ✅ 已修 | `runtime.assertActive` + 工具层 `terminatedError`（spawn/send/set_topology/ask/start_chat/set_context/memory_write 全部返回 `invalid_argument`） |
| G4-05 | 中 | ✅ 已修 | `spawnRole` 覆盖同名映射前先 `interrupt` 旧 child；`resume` 快照已按新语义更新 |
| G4-06 | 中 | ✅ 已修 | `askUser` 入口 assertActive；`terminate` 幂等调用仍会 `cancelPendingHitl` |
| G4-07 | 中 | ❌ 不接线（有据） | 实测 `subagent-settled` 是**一次 activation 结束**而非角色永久结束：接线后 `tests/chat.spec.ts` 出现 7 项回归（生成回合后角色被误判 exited，speaker roster 只剩 gamma）。已在 `src/index.ts` 写明该结论；`markChildSettled` 作为 API 保留 |
| G4-08 | 中 | ✅ 已修 | 每角色 `AbortController` + `RoleTurnError`；引擎按 `role-interrupted`/`turn-timeout`/`swarm-terminated` 正常收尾；`recordGroupMessage` 改为返回 boolean |
| G4-09 | 中 | ✅ 已修 | 只有 `SubagentError.code === 'NOT_RESUMABLE'` 才重 spawn，其余记 warning 并跳过（不再误杀活体 child） |
| G4-10 | 低 | ✅ 已修 | 事件词表注册引用计数，最后一个实例卸载才移除 |
| G4-11 | 低 | ✅ 已修 | `state()` 按 (log 长度, topology, memory 上限) 记忆化；`hitl`/`mem` 计数改为内存计数器，`hydrate` 一次性重播 |
| G4-12 | 低 | ✅ 部分已修 | (1) hitl 按 requestId upsert；(2) destroyed 关闭 chat（active=false）；(4) transcript 同样按 FLOW_WINDOW 截断；(5) 显式 peer 仅在 mixed 生效。(3) `resumed` 翻状态保留：插件自身只对 running 角色写 resumed，语义自洽 |
| G4-13 | 低 | ✅ 已修 | `chat.startedAt` 改为 optional，reducer 用 `asString` 兜底 |
| G4-14 | 低 | ✅ 已修 | 追加 `swarm/resumed` 前复查 `runtime.state().terminated` |
| G4-15 | 低 | 📝 仅文档 | Harness 无 human 源，答复仍以 orchestrator 的 `agent-message` 源投递；此为名义归因，已在代码注释记录 |
| G4-16 | 信息 | ✅ 加固 | `beginTurn`/`endTurn` 显式互斥，第二个并发调用返回 `unavailable: another turn is already in flight` |

**回归测试**：新增 `tests/robustness.spec.ts`（10 项，覆盖 G4-03/04/05/06/10/12/13；G4-07 因撤回而 skip）。
**门禁复验**：host/client `tsc` 0 error；`vitest run` **93 passed / 2 skipped**（另一 skip 为需 API key 的 cold-resume）；CI 路径 `tsdown` 构建通过并回写 `lib/`；浏览器 host E2E（无 shim）**1 passed**。

