# dsh-swarm-panel

独立 Git 仓库。唯一项目名 / npm 包名 / Cordis 插件名均为 **`dsh-swarm-panel`**，与上游 DeepSeek Harness 里的 `dsh-agent-swarm` 区分，避免包名和插件 id 冲突。

本目录从 `deepseek-harness` 迁出，用于独立开发 Conversation Flow / swarm panel。来源：`/Users/cong/Documents/AI_Project/deepseek-harness`。

## 目录结构

```
dsh-swarm-panel/
├── dsh-swarm-plugin/        # 插件源码（完整迁移，仅排除 node_modules，它是指向仓库工作区的符号链接）
│   ├── src/                 # 运行时 + client 端实现（SwarmAction.ts 等）
│   ├── tests/               # 单元 / 端到端 / 快照测试
│   ├── lib/                 # tsdown 构建产物
│   ├── assets/swarm-panel.png   # 插件 UI 截图
│   ├── PLAN.md / PLAN-CONVERSATION-FLOW.md   # 开发 plan 与对话流 plan
│   ├── PRD-CONVERSATION-FLOW.md / M2-M5.md   # PRD 对话流 / 里程碑
│   ├── AUDIT.md / AGENTS.md / README.md / README.zh.md
│   └── package.json         # dsh-swarm-panel
├── docs/
│   ├── conversation/        # 设计与开发对话产物（仓库根目录文件）
│   │   ├── PRD.md                           # 产品需求文档
│   │   ├── SWARM-RESEARCH.md                # swarm 调研
│   │   ├── design-qa.md                     # 设计 QA
│   │   └── evidence-review-conversation-flow-clone-fidelity.md  # 对话流保真审查报告
│   ├── harness/             # DeepSeek Harness 架构 / 插件开发文档（下载自仓库）
│   │   ├── AGENTS.md / packages-AGENTS.md / docs-AGENTS.md
│   │   ├── architecture.md(.zh)  capability-seams  cordis-primer  defensive-patterns
│   │   ├── development  testing  glossary  subsystems-README
│   │   ├── cookbook/        # extension-cookbook、adding-a-tool / a-conversation-node / a-package / a-settings-card
│   │   └── notes/           # 与本插件最相关的已实现架构 Agent Notes（中英对照）
│   └── screenshots/         # 截图：swarm-panel.png + web-e2e-* 界面截图
└── README.md
```

## 迁移说明

- `dsh-swarm-plugin/` 为 `plugins/dsh-swarm-plugin` 的完整副本，排除 `node_modules`（内含指向 harness 工作区的符号链接，迁移后失效）。`lib/` 为构建产物，一并保留。
- 插件包名 `dsh-swarm-panel`（Cordis `name` / 客户端 bundle id 同步为此名）。peerDependencies 仍指向 `@deepseek-ai/*` 工作区包；如需在此目录独立运行测试/构建，请重新 `pnpm install` 并接入同版本 harness 工作区。
- 本地安装：`dsh plugin --profile web add file:./dsh-swarm-plugin`。
- 仓库根目录的 `PRD.md`、`SWARM-RESEARCH.md`、`design-qa.md` 及 `.omo/evidence/` 下的保真审查报告归入 `docs/conversation/`。
- `docs/harness/` 收录 DeepSeek Harness 的架构与插件开发文档（含中英双语及 i18n 清单），以及挑选的 8 篇与本客户端插件最相关的 Agent Notes。
- 未发现名为 "PROM" 的文件（仓库与插件中均无）；如指 PRD/PLAN，均已迁移。

## 版本记录

| 项目 | 来源 commit |
| --- | --- |
| 插件 | `4ac2de3c22`(feat)、`beeee88945`(fix)、`46198cce02`(docs) 及未提交改动 |
| 根目录 PRD/SWARM-RESEARCH/design-qa | 工作区当前状态 |

迁移时间：2026-08-21
