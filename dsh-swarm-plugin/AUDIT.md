# M0 现状审计报告

> 审计日期：2026-08-18
> 审计范围：`plugins/dsh-swarm-plugin/` 全部源码 + 测试
> 参照基线：`packages/schedule/schedule/`（官方 function plugin 参考实现）
> 修复状态：✅ **F1-F7 + M1-M4 已全部修复，typecheck / 7 测试 / build 全部通过**

---

## 结论摘要

审计发现代码是**能表达设计意图的骨架，但 API 用法与 DSH 真实接口严重不符**（defineTool 参数、output schema、execute 返回值、SessionEventMap 声明、session.events 属性用法全部不一致）。已按修复清单重写全部核心 API 调用。

**修复后验证结果**：
- ✅ `tsc --noEmit` 源码 + 测试 0 错误
- ✅ `vitest run` 7/7 通过
- ✅ `tsdown` build 成功（lib/index.js + lib/index.d.ts）
- ✅ 加入 pnpm workspace（`plugins/*`），依赖用 `workspace:*` 解析
- 🟡 **次要（Minor）**：规范偏离，不影响运行但需修正。

---

## 🔴 致命问题（7 项）

### F1. `defineTool` 参数 schema 用错了库

**现状**（`src/tools.ts`）：用 Schemastery `z.object()` 定义工具参数。

```ts
import z from '@deepseek-ai/schemastery'
const SPAWN_ARGS = z.object({ roleName: z.string().min(1).max(64), ... })
```

**正确做法**（`schedule/src/tools.ts`）：`defineTool` 的 `parameters` 是**纯 JSON Schema 对象**，不是 Schemastery。

```ts
parameters: {
  roleName: { type: 'string', required: true, description: '...' },
  systemPrompt: { type: 'string', description: '...' },
}
```

**影响**：`defineTool` 的类型签名不匹配，编译失败。

### F2. `output.schema` 缺少 `oneOf` 判别联合 + `render` 是函数不是字符串

**现状**：`output: { schema: OUTPUT_SPAWN, render: 'generic' }` —— `render: 'generic'` 是错的，且 schema 只是成功值，没有错误分支。

**正确做法**：`output: { schema: ONE_OF_SCHEMA, render: renderValue }`，其中：
- `schema` 是 `{ oneOf: [成功值schema, ...错误schema] }`
- `render` 是函数 `(args, value) => ContentBlock[]`

```ts
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}
```

**影响**：编译失败 + 模型无法正确理解工具返回的错误。

### F3. `execute` 返回值结构错误

**现状**：返回 `{ code: 'ok', value: {...} }` 或 `{ code: 'error', message: '...' }`。

**正确做法**：直接返回判别联合值 —— 成功时返回**值本身**，失败时返回 `{ code, message }`。

```ts
// 成功：直接返回值
return { swarmId, roleName, childId }
// 失败：返回错误对象
return { code: 'invalid_argument', message: '...' }
```

**影响**：工具输出 schema 与实际返回值不匹配，模型看到的输出结构错误。

### F4. `SessionEventMap` 声明合并缺失

**现状**：`types.ts` 只有 `import type {} from '@deepseek-ai/dsh-session/types'`，没有声明 swarm 事件。

**正确做法**：必须用声明合并注册事件类型。

```ts
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'swarm/created': SwarmCreatedEvent
    'swarm/role-spawned': RoleSpawnedEvent
    // ... 每个事件都要声明
  }
}
```

**影响**：`session.append('swarm/created', ...)` 无法通过 typecheck（SessionEventMap 不认识这些 key）。

### F5. `session.events` 是属性不是方法，且事件结构是 `{ type, data }` 不是 `{ payload }`

**现状**（`domain.ts` / `tests`）：`session.events()`（方法调用）+ `event.payload` + `e.kind`。

**正确做法**（`schedule/src/domain.ts:585`）：

```ts
// session.events 是 readonly SessionEvent[] 属性
for (const event of events.slice(seedLength)) {
  if (event.type !== 'schedule/change') continue  // .type 不是 .kind
  const change = decodeScheduleChange(event.data)   // .data 不是 .payload
}
```

**影响**：运行时 `session.events()` 报错（不是函数），fold 逻辑完全无法工作。

### F6. `agent.session.events` / `session.append` 的 type 泛型参数错误

**现状**：`this.agent.session.append<'swarm/topology-changed'>('swarm/topology-changed', {...})`。

**正确做法**：`agent.session.append('swarm/topology-changed', {...})` —— append 的第一个参数就是事件 type 字符串，不需要泛型显式指定（声明合并后 TS 自动推断）。

**影响**：语法虽可能通过，但属于多余写法，且暴露了 F4 的声明缺失。

### F7. 测试断言了错误的返回值结构

**现状**（`tests/plugin.spec.ts`）：断言 `created.value` 是 `{ code: 'ok', value: {...} }`。

**正确做法**：按 F3 修复后，`execute` 直接返回 `{ swarmId, roleName, childId }`（成功）或 `{ code, message }`（失败）。测试要改成断言成功值本身，或通过 `isError` / code 判断。

**影响**：测试全部失败。

---

## 🟠 重要问题（4 项）

### M1. 模块级 `_runtimes` 状态泄漏，生命周期不可逆

**现状**（`tools.ts:91`）：`const _runtimes = new Map<string, SwarmRuntime>()` 是模块级变量，跨插件实例、跨 agent 共享，dispose 时**不清理**。

**正确做法**（`schedule/src/index.ts:41`）：在 `apply()` 里用 `const runtimes = new Map<Agent, OwnerCleanup>()` 管理，`ctx.effect` 的 cleanup 里 `runtimes.clear()` + `Promise.allSettled(cleanup)`。

**影响**：插件卸载后旧 runtime 仍驻留内存；多次挂载同一插件会污染状态；违反 DSH "registrations are effects" 原则。

### M2. `index.ts` 有死代码（`RUNTIME_KEY` symbol map 从未被使用）

**现状**：`index.ts` 创建了 `RUNTIME_KEY` symbol map 存 per-agent runtimes，但 `tools.ts` 用的是模块级 `_runtimes`，两者互不关联。index.ts 的 cleanup 遍历的是空 map。

**正确做法**：统一用一个 `Map<Agent, SwarmRuntime[]>` 或类似结构，`apply()` 管理，`tools.ts` 通过参数接收而不是模块级变量。

### M3. `sendMessage` 的 `senderSessionId` 计算后又被忽略

**现状**（`runtime.ts:142-190`）：先计算 `senderSessionId`（用于 event log），但实际 `followup()` 调用里**硬编码**了 sender（`from === 'orchestrator'` → `this.agent.id`，否则 → `fromChildId`），两者在 `parent-child` 拓扑下不一致。

**正确做法**：`followup()` 的 `senderSessionId` 必须与 event log 一致，都用同一个计算出的值。

### M4. `swarm/destroyed` 事件未在 fold 中处理

**现状**：`domain.ts` 的 `applySwarmEvent` 处理了 `created`/`topology-changed`/`role-spawned`/`role-exited`/`role-message`，但**漏了 `destroyed`**。terminate 后 fold 状态仍显示角色活跃。

**正确做法**：增加 `swarm/destroyed` 分支，标记 swarm 终止。

---

## 🟡 次要问题（5 项）

### N1. `presentCall` 缺失

`defineTool` 应提供 `presentCall: args => present('...', 'read', rawInput)` 用于 UI 卡片。当前所有工具都没有。

### N2. `spawnRole` 混用 `ctx.subagents` 属性与 `ctx.get('subagents')`

`runtime.ts:99` 用 `this.ctx.subagents`（属性访问），`runtime.ts:158` 用 `this.ctx.get('subagents')`。应统一。`SwarmRuntime` 不是插件，应显式接收或统一用 `ctx.get`。

### N3. fork 处理（`seedLength`）缺失

schedule 的 fold 用 `agent.session.header.seedLength ?? 0` 处理 fork。swarm 的 fold 从 `events[0]` 开始，fork 场景会重复 fold。

### N4. `schemastery` 依赖未在 package.json 声明

`tools.ts` import `@deepseek-ai/schemastery`，但 package.json 的 dependencies 里没有（且 F1 修复后根本不需要它）。

### N5. 测试里 `settle()` helper 未使用 + `agentEvents` 导入未使用

`tests/plugin.spec.ts` 的 `settle()` 和 `agentEvents` 是死代码。

---

## 数据模型缺口（对应 PLAN.md M0）

PLAN.md M0 要求新增以下事件，当前**全部缺失**：

| 事件 | 用途 | 状态 |
|------|------|------|
| `swarm/checkpoint` | 冷启动恢复检查点 | ❌ 缺失 |
| `swarm/hitl-requested` | 人机协作请求 | ❌ 缺失 |
| `swarm/hitl-resolved` | 人机协作解决 | ❌ 缺失 |
| `swarm/context-updated` | ContextVariables 更新 | ❌ 缺失 |
| `swarm/turn-completed` | 群聊轮次完成 | ❌ 缺失 |
| `swarm/terminated` | 终止（区别于 destroyed） | ❌ 缺失 |

此外 `SwarmCheckpoint` 结构（messages、context variables、current speaker、pending HITL、role childId map）也**未定义**。

---

## 修复顺序建议

1. **先修 F1-F7**（API 对齐）：这是让代码能编译、能跑的前提。
   - 重写 `tools.ts` 用 JSON Schema + `oneOf` + `renderValue` + `presentCall`。
   - `types.ts` 加 `SessionEventMap` 声明合并。
   - `domain.ts` 改用 `session.events` 属性 + `.type`/`.data`。
   - `runtime.ts` 修 `sendMessage` 归因 bug + 统一 `ctx.get`。
   - 重写测试断言。
2. **再修 M1-M4**（生命周期 + 状态正确性）。
   - `index.ts` 统一用 `Map<Agent, ...>` 管理 runtime。
   - `tools.ts` 的 runtime 通过参数传入。
   - fold 补 `swarm/destroyed`。
3. **最后补 N1-N5 + 数据模型缺口**（PLAN.md M0 的新事件）。
