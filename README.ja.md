# dsh-swarm-panel

[English](README.md) · [中文](README.zh-CN.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

[![CI](https://github.com/stephenlzc/dsh-swarm-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/stephenlzc/dsh-swarm-panel/actions/workflows/ci.yml)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 向けの Conversation Flow 可観測性プラグインです。Orchestrator による child agent の調整、ルーティングされたメッセージ、topology の変化を確認し、Web UI から child session を開けます。

![Conversation Flow 概要](dsh-swarm-plugin/assets/swarm-panel.png)

このリポジトリは独立した `dsh-swarm-panel` プラグインです。Harness のソースツリーに過去存在した `dsh-agent-swarm` プラグインとは別のパッケージです。

## 主な機能

- parent-child、peer-to-peer、mixed routing に対応した永続 swarm runtime。
- session event log の checkpoint と cold resume による復元。
- group chat turn、共有 context、軽量 memory、human-in-the-loop の一時停止。
- topology、swimlane、route filter、message inspector、Live follow、child-session navigation を備えた Conversation Flow タブ。

## UI ギャラリー

ギャラリーは決定的な replay fixture を使用しており、実際の workspace や API credential を公開しません。

| デスクトップ概要 | メッセージ inspector |
| --- | --- |
| ![デスクトップ概要](dsh-swarm-plugin/assets/swarm-panel-host-desktop.png) | ![メッセージ inspector](dsh-swarm-plugin/assets/swarm-panel-host.png) |

| レスポンシブ表示 | topology と Human input |
| --- | --- |
| ![レスポンシブ Conversation Flow](dsh-swarm-plugin/assets/swarm-panel-host-narrow.png) | ![topology と Human input](dsh-swarm-plugin/assets/swarm-panel.png) |

### ショートツアー

![Conversation Flow ツアー](dsh-swarm-plugin/assets/conversation-flow-tour.gif)

デスクトップ概要、選択したメッセージ inspector、390×844 のレスポンシブ表示を順に示します。モデル出力や credential は含みません。

## クイックスタート

互換性のある DeepSeek Harness 環境で動作します。まず Harness をインストールし、その後 `web` profile にプラグインを追加してください。

### npm 公開後

```bash
dsh plugin --profile web add dsh-swarm-panel
dsh web
```

### GitHub から直接インストール

現在、プラグインはリポジトリ内の `dsh-swarm-plugin/` サブディレクトリにあります。pnpm の Git subdirectory 構文を使用します。

```bash
dsh plugin --profile web add 'github:stephenlzc/dsh-swarm-panel#path:dsh-swarm-plugin'
dsh web
```

再現可能なインストールでは commit を固定してください。

```bash
dsh plugin --profile web add \
  'github:stephenlzc/dsh-swarm-panel#path:dsh-swarm-plugin&<commit-sha>'
```

安定版は npm 公開後に npm コマンドを使い、GitHub からインストールする前にソースとインストール時コードを確認してください。

### ローカル checkout からインストール

```bash
git clone https://github.com/stephenlzc/dsh-swarm-panel.git
dsh plugin --profile web add file:./dsh-swarm-panel/dsh-swarm-plugin
dsh web
```

session を作成し、Orchestrator に swarm の作成を依頼して、Chat と Trajectory の隣にある **Conversation Flow** タブを開きます。

## 対応環境

| コンポーネント | 対象 |
| --- | --- |
| DeepSeek Harness | `0.1.0-rc.7` workspace API と互換リリース |
| Node.js | `22.19+` または `24+` |
| Browser | DeepSeek Harness `web` profile |
| Package | `dsh-swarm-panel@0.1.0` |

## 検証状況

- keyless plugin test 84 件と real-API cold-resume test 1 件が成功しています。
- 実際の Web shell による host-composed browser E2E が成功しています。
- host/client の TypeScript 検査と tarball インストール検証が成功しています。
- message inspector、route/Agent filter、検索の空状態、Live pause/resume、HITL、child-session navigation、キーボード共存、390×844 レイアウトを手動確認しています。

## 既知の制限

- Export、A2A/ACP bridge、nested sub-swarm は未提供です。
- Memory は Orchestrator 所有の lexical retrieval で、すべての turn prompt に自動注入されません。
- Conversation Flow パネルの UI 文言は現在英語のみです。README は多言語に対応しています。

詳細は[プラグイン README](dsh-swarm-plugin/README.md)、[中国語プラグイン README](dsh-swarm-plugin/README.zh.md)、[release checklist](docs/release-checklist.md)をご覧ください。

## ライセンス

MIT。 [`dsh-swarm-plugin/LICENSE`](dsh-swarm-plugin/LICENSE) を参照してください。
