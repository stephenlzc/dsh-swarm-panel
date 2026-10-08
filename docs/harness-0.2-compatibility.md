# DeepSeek Harness 0.2.0-rc.2 兼容性评估与迁移记录

> 评估日期：2026-10-08
> 结论：**必须升级**。插件原目标 `0.1.0-rc.7` 在工作区 API、事件读取、子代理投递、
> 会话投影、Web 客户端 seam、包版本范围六个层面与当前桌面版不兼容。

## 1. 版本事实（先纠正一个前提）

| 事实来源 | 值 |
| --- | --- |
| `/Applications/DeepSeek Harness.app/Contents/Info.plist` | `CFBundleShortVersionString = 0.2.0-rc.2` |
| 应用内 `@deepseek-ai/dsh-desktop` / `dsh-desktop-runtime` | `0.2.0-rc.2` |
| 更新源 `download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml` | `version: 0.2.0-rc.2`（nightly 为唯一通道；`stable/beta/alpha` 均 404） |
| 插件原目标（README/CI/peer） | `0.1.0-rc.7` |
| 公开 npm 最新预发布 | `0.2.0-rc.2`（`0.2.1-alpha.1` 已存在但未进入桌面通道） |

**没有名为 1.0 的桌面构建。** 当前安装的桌面版（也是更新源上的最新版）就是
`0.2.0-rc.2`；Harness README 里的“0.2 预览版”说法与之一致。因此本次要做的兼容性
升级是 `0.1.0-rc.7 → 0.2.0-rc.2`。

## 2. 破坏性变更与修复清单

| # | 位置 | 0.1.0-rc.7 | 0.2.0-rc.2 | 修复 |
| --- | --- | --- | --- | --- |
| B1 | 包版本范围 | peer/dependency 全部 `^0.1.0-rc.7`、`dsh-brand ^0.0.1-rc.1` | `^0.1.0-rc.7` 不满足 `0.2.0-rc.2`（`^0.x` 上界为 `0.2.0`） | 全部改为 `^0.2.0-rc.2`，包版本 `0.1.0 → 0.2.0` |
| B2 | `@deepseek-ai/dsh-client-runtime` | 提供 `ClientContext`/`SessionId` 重导出，被 peer/dev/client 导入/tsdown external 引用 | **整包移除** | 删除依赖；`ClientContext` 改用 `@deepseek-ai/cordis` 的 `Context`；`SessionId` 改从 `@deepseek-ai/dsh-session/types` |
| B3 | `dsh.client.inject` | `[dsh-client-runtime, dsh-client-ui-conversation]` | `dsh-client-runtime` 不存在 | 改为 `[dsh-client-ui-conversation, dsh-client-ui-workspace]` |
| B4 | `session.events` | `Session.events` 只读属性 | 属性移除，`snapshotEvents()`/`ownEvents()`/`eventAt()` 为 deprecated 读法 | 生产代码 5 处、测试 30+ 处改用 `snapshotEvents()` |
| B5 | `ctx.subagents.followup()` | 公开方法，接受自定义 `source.senderSessionId` | 方法移除；`sendMessage(sender, target, content, {signal})` 从 exact live sender 推导归因 | 改用 host-only seam `queueHostSubagentPrompt()`（`@deepseek-ai/dsh-subagent/internal`），保留 peer 归因；source kind `coordinator → agent-message` |
| B6 | `sessionProjections.register()` | `{ key, schema, init, apply, view, stateVersion }` | `{ key, stateSchema, init(header, inheritedEventCount), apply, wire: { viewSchema, view }, stateVersion }` | 同步改写；`panel-model.ts` 同时声明 `SessionProjectionStateMap.swarm` |
| B7 | Web 模块表（tsdown 硬编码） | 含已删除的 `dsh-client-web-react`/`dsh-client-schema-form`/`dsh-client-ui-attachment` | 0.2.0 平台表为 react/cordis/`dsh-client-store`/`ui-slots`/`ui-primitives`/`ui-dockkit` | `PLATFORM_MODULES` 对齐 0.2.0；`CLIENT_EXTERNALS` 去掉 `dsh-client-runtime/client` |
| B8 | 子会话导航 | `ctx.sessions.open(childId)` | 该方法不存在；导航经 `ctx.uiWorkspace.openSession(target)` | 客户端 `inject` 由 `['sessions','slots']` 改为 `['uiWorkspace','slots']` |
| B9 | 客户端 Context 合并 | `PropsRuntime` 由 runtime 包间接带入 | 需显式引入 `ui-renderer/client`（`ctx.slots`）与 `ui-session/client`（`sessionId`/`useProjection`） | 增加两个 type-only import |
| B10 | 事件词汇注册 | 可自行往 `KNOWN_SESSION_EVENT_TYPES` 注册 | 0.2.0 明确拒绝“注册事件名”作为兼容机制，改用 envelope `ignorable: true`；但 `append()` **没有**公开写 ignorable 的入口 | 保留现有注册（进程内仍有效），风险见第 4 节 |
| B11 | 源码工作区 | CI 把插件软链到 `harness/plugins/` | 0.2.0 的 `pnpm-workspace.yaml` **不再包含** `plugins/*`，`workspace:*` 无法解析 | CI 挂载步骤显式插入 `- 'plugins/*'`；本地需同样处理 |

## 3. 测试夹具兼容（非产品缺陷，但会红）

| # | 夹具 | 变化 | 修复 |
| --- | --- | --- | --- |
| T1 | `mountAgentLoopTestDependencies` | 现在自己挂 `SessionProjectionRegistry` | 删除各 spec 里重复的 `ctx.plugin(SessionProjectionRegistry)` |
| T2 | `ctx.agents.create()` | 不再从调用者上下文推断 ownership，必须显式 `parentAgent` | 子代理用 `{ parentAgent: root.agent }` 创建 |
| T3 | `CallId` | 品牌函数改名为 `ToolCallId` | 测试导入/调用同步改名 |
| T4 | `ctx.userQuestions.registerProvider()` | 方法移除，改用 `ctx.on('user-questions/request', …)` 瀑布 | 测试桩改为事件监听 |
| T5 | continuable children | 需要 host 里挂载 `@deepseek-ai/dsh-session-query` | chat/cold-resume 夹具挂 `SessionQueryEngine` |
| T6 | 子代理投递 spy | `followup` 不存在 | 改为 `vi.spyOn(subagents, deliverSubagentPrompt)` |

### 3.1 浏览器 host E2E（`tests/host/conversation-flow.e2e.ts`）

该用例在 0.2.0 下原本**无法启动**，共 4 处需要改：

| # | 位置 | 0.1.0-rc.7 | 0.2.0-rc.2 | 修复 |
| --- | --- | --- | --- | --- |
| E1 | 灯塔夹具路径 | `apps/web/tests/snapshots/lifecycle-chrome/session.jsonl` | 夹具迁到仓库根 `snapshots/web/lifecycle-chrome/`，且按 session 格式版本命名 | 指向 `snapshots/web/lifecycle-chrome/session.v4.jsonl` |
| E2 | scaffold profile 组装 | 覆盖层直接 `insert` 插件名即可解析 | 覆盖层按裸包名 insert，必须像 `dsh plugin add` 一样把包装进 profile；否则 Loader 报 `dsh-swarm-panel: failed to import` | `launchWebScaffold({ extraOverlayPath, profile: { packages: [{ dir: join(HERE,'..','..'), enabled: false }] } })` |
| E3 | 夹具事件形状 | 行内带 `seq`/`time` | v4 夹具行不带 `seq`/`time`（由加载器按行序赋值），混用会报 `cannot mix projected and complete body rows`；且 v4 读路径拒绝未知事件类型 | 注入行去掉 `seq`/`time`，并加 `ignorable: true`（外部事件契约） |
| E4 | 页面地址 | `scaffold.baseUrl` | 0.2.0 的 shell 需要进程 token | 改用 `scaffold.authenticatedUrl` |

> E3 同时验证了第 4 节第 1 条的结论：**外部插件事件必须带 `ignorable: true` 才能被
> 0.2.0 的 v4 读路径接受**。

**E5（2026-10-08 补）布局无关化**：该用例原先用静态相对路径
`../../../../deepseek-harness/apps/web/tests/scaffold.ts`，只在"插件检出与
`deepseek-harness` 同级"时成立；把包挂到 `<harness>/plugins/dsh-swarm-panel` 下运行会直接
`Cannot find module`，必须手工在 harness 根造一个 `deepseek-harness` 兼容软链。
现在用例改为**候选路径探测 + 动态 import**：依次尝试 `<parent>/deepseek-harness/`（同级布局）
与 `<harness>/`（挂载布局），可用 `DSH_HARNESS_ROOT` 覆盖，两者都找不到才报错。
复验：删除该 shim 后同一命令仍然 **1 passed**，仓库资产哈希不变。

### 3.2 已提交构建产物必须来自 CI 路径（2026-10-08 修正）

仓库里原先提交的 `lib/` 是在"把 devDependencies 的 `workspace:*` 改写成 `0.2.0-rc.2`"
的临时清单下构建的（早期验证环境的做法），与 CI 的
`pnpm --filter dsh-swarm-panel run build`（真实 `package.json` + workspace 链接）产物
**不一致**：

| 文件 | 原提交 | CI 路径构建 |
| --- | --- | --- |
| `lib/index.js` | 88370 B | 88389 B |
| `lib/index.d.ts` | 194159 B | 194060 B |
| `lib/client.js` | 52148 B | 52115 B |

构建本身是**确定性**的（连续两次构建字节完全一致），所以这种差异可复现、必须消除。
已改用 CI 路径产物替换 `lib/`，并复验：客户端 bundle 冒烟通过（导航确实调用
`uiWorkspace.openSession`）、浏览器 host E2E（删 shim）**1 passed**。

> 教训：验证"产物与源码一致"时，必须用与发布/CI 相同的 package.json 与工作区布局；
> 改写清单后再比对会得到假阳性。

## 4. 仍然存在的风险与限制（需要上游或后续工作）

1. **外部事件的 `ignorable` 标记**：0.2.0 的持久化读路径要求未知事件显式带
   `ignorable: true`，且 v0→v1 迁移对未知事件一律拒绝（除插件已注册的类型）。
   `Session.append()` 目前没有为外部事件写 ignorable 的公开入口，因此：
   - 插件加载时（正常情况）读取含 `swarm/*` 的会话可用；
   - 若在**未加载插件**的进程里读取或迁移这些历史会话，会被拒绝。
   建议向 Harness 反馈一个 out-of-repo 插件的事件声明/压缩入口。
2. **同步历史读取已废弃**：`snapshotEvents()` 系列在 0.2.0 标为 deprecated，
   新的一等公民应改用 projection。本插件的 fold 依赖完整日志，短期保留；
   中期可把 fold 迁到 projection state 上。
3. **peer 归因依赖 `/internal`**：`queueHostSubagentPrompt` 位于
   `@deepseek-ai/dsh-subagent/internal`，是该版本提供的 host adapter 面；若未来
   收紧，peer 语义需要降级为“仅日志展示”。
4. **浏览器 host E2E 已通过**（修复见 3.1）：在 `dsh-v0.2.0-rc.2` 检出上完成
   `pnpm build:lib` + `pnpm build:web` 后，用例在真实 web shell 中 1 passed。
   注意本机 npm 镜像（`gh.zhicong.cc`）无法下载 `@deepseek-ai/libreoffice-kit-darwin-arm64@0.1.1`
   （`dsh-web-app` bundle 的传递依赖），本次改用 `https://registry.npmmirror.com` 完成安装；
   CI 请使用默认/官方 registry。

## 5. 验证方式与本次证据

前置：Harness `dsh-v0.2.0-rc.2` 检出，插件挂到 `plugins/dsh-swarm-panel`
（**复制而不是软链**：pnpm 不会为指向工作区外的软链目标安装依赖），
`pnpm-workspace.yaml` 加入 `plugins/*`，然后

还需在 `pnpm-workspace.yaml` 里补上 0.2.0 移除的两项：`- 'plugins/*'` 与
`linkWorkspacePackages: true`（后者缺失时插件的公开 peer/dependency 范围会解析出
**重复的 registry 拷贝**，branded symbol 身份不一致，tsc 与运行时都会出问题）。

```bash
pnpm install --no-frozen-lockfile
pnpm build:lib              # 工作区包以 lib/ 为入口，源码模式必须先构建
pnpm build:native-system    # persistence 的 flock 原生插件
CI=true pnpm --filter dsh-swarm-panel run typecheck
pnpm --filter dsh-swarm-panel run build
pnpm build:web              # host E2E 需要 web 前端 dist

# 插件单测：chat.spec.ts 通过 ../../../../deepseek-harness 引用 Harness 源码，
# 必须从仓库本体路径运行（挂载副本里该相对路径不存在）。把仓库的 node_modules
# 指向工作区安装结果即可：
ln -s <harness>/plugins/dsh-swarm-panel/node_modules <plugin>/node_modules
cd <plugin> && CI=true <harness>/node_modules/.bin/vitest run

# host E2E：vitest 4 会用 include 过滤显式文件名，需要 harness 侧 wrapper 配置
# 把 plugins/dsh-swarm-panel/tests/host/**/*.e2e.ts 加入 include，再按名字过滤：
cd <harness> && pnpm exec vitest run --config vitest.swarm-e2e.config.ts plugins/dsh-swarm-panel
```

> 本次实测补充：`--no-frozen-lockfile` 在第三方镜像上会重新解析依赖，
> 可能把 `micromark-util-types` 之类的传递依赖升到与提交 lockfile 不同的补丁版本，
> 使 Harness 自身的 `tsc -b` 报错。CI 环境请保持 `pnpm-lock.yaml` 原样
> （只允许新增 `plugins/dsh-swarm-panel` importer），避免这种漂移。

本次实际得到的证据（两层环境）：

**A. 公开发布包 `0.2.0-rc.2`（`/tmp` 独立环境）**

- `tsc --noEmit`（host）与 `tsc --noEmit -p tsconfig.client.json`（client）：0 error。
- `vitest run`（vitest 2.x）：**84 passed / 1 skipped**。
- `tsdown` 构建成功；宿主 bundle 可在 0.2.0 运行时下 import 出 `name/inject/apply`；
  客户端 bundle 可在 `__ModuleLoader__` 工厂下加载并注册两个 slot，
  且导航动词确实调用 `uiWorkspace.openSession`。

**B. Harness `dsh-v0.2.0-rc.2` 源码工作区（`plugins/dsh-swarm-panel` 挂载）**

- `tsc` host + client：0 error；`tsdown` 构建：0 error。
- `vitest run`（工作区 vitest 4.1.8，仓库本体路径）：**84 passed / 1 skipped**。
- 浏览器 host E2E（真实 web shell + chromium）：**1 passed**
  （`opens inspector, HITL, Live/Pause, and empty-match in the real host shell`）。
- 未获得：real-API cold-resume（需要 `DEEPSEEK_API_KEY`，本机未提供）。

## 6. 用户侧需要做什么

1. 插件必须重新构建并**重新安装**：`dsh plugin --profile <profile> add file:<本项目>/dsh-swarm-plugin`
   （或重新 `add` GitHub/本地包）。旧构建里引用 `dsh-client-runtime`、`followup`、
   `session.events`，在 0.2.0 下会安装/运行失败。
2. 重新打开会话后，Harness 会把旧会话从 format 0 迁移到 format 4；
   迁移时插件需处于加载状态（正常流程即是如此）。
3. 若之前用 `0.1.0-rc.7` 源码工作区开发，需要把 Harness 检出切到
   `dsh-v0.2.0-rc.2`，并给 `pnpm-workspace.yaml` 加 `plugins/*` 与
   `linkWorkspacePackages: true`（两者在 0.2.0 都被移除）。
4. 已经 install 过 0.1.0 的桌面/网页 profile 不会自动更新，需要重新执行
   `dsh plugin --profile <profile> add` 指向 0.2.0 构建产物。
5. **不要把插件装进桌面版保留的 `desktop` profile**（`dsh plugin --profile desktop add …`）。
   实测会往该 profile 写入 `node_modules/`（含 `@deepseek-ai/dsh-tools`、`dsh-brand`
   等**重复副本**）与 `pnpm-lock.yaml`，改变 app 启动时的模块解析，表现为**每个回合都以
   `Cannot read properties of undefined (reading 'prepare')` 失败**，并且重启 app、新建
   会话、卸载/关闭插件都无效——只有把整个 profile 目录还原才能恢复。验证插件请用独立
   profile（`dsh plugin --profile dswarm add file:…`），并用 `--dump-config` 确认组合进树。

## 7. 稳健性审查（2026-10-08）

用 4 个并行门禁验证本工作区的修改：单测/类型、构建产物一致性、浏览器 host E2E、
对抗性审查。前三项通过；对抗性审查另外发现 **2 项高危、7 项中危、6 项低危**稳健性缺陷
（`awaitChildReply` 在子代理 maintenance 窗口可能记录上一轮回复；事件缺 `ignorable`
导致卸载插件后会话打不开；terminate/interrupt 非异常安全；已终止 swarm 仍可 spawn；
重 spawn 不中断旧 child；terminate 后 `swarm_ask_user` 永久挂起；角色永不 settle；
turn 中途 interrupt 丢回复；resume 的 catch-all 误判等）。完整清单、文件:行号、
原始复现输出与最小修复建议见 [robustness-audit-2026-10-08.md](robustness-audit-2026-10-08.md)，
对抗性探针源码见 [该目录](robustness-audit-2026-10-08-probes/)。

**修复已完成**（2026-10-08）：除 G4-07（实测 `subagent-settled` 是"一次 activation 结束"而非角色结束，接线会造成 chat 引擎 7 项回归，故不接线并记录）与 G4-15（仅文档）外全部修复，并新增
[`tests/robustness.spec.ts`](../dsh-swarm-plugin/tests/robustness.spec.ts)（10 项回归）。
复验：host/client `tsc` 0 error、`vitest run` **93 passed / 2 skipped**、CI 路径构建通过、浏览器 host E2E（无 shim）1 passed。逐条状态见审计报告末尾的"修复状态"表。
