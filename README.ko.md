# dsh-swarm-panel

[English](README.md) · [中文](README.zh-CN.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

[![CI](https://github.com/stephenlzc/dsh-swarm-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/stephenlzc/dsh-swarm-panel/actions/workflows/ci.yml)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)를 위한 Conversation Flow 관찰 플러그인입니다. Orchestrator가 child agent를 어떻게 조정하는지 확인하고, 라우팅된 메시지와 topology를 살펴보며, Web UI에서 child session을 열 수 있습니다.

![Conversation Flow 개요](dsh-swarm-plugin/assets/swarm-panel.png)

이 저장소는 독립적인 `dsh-swarm-panel` 플러그인입니다. Harness 저장소에 과거 포함되었던 `dsh-agent-swarm` 플러그인과는 별개입니다.

## 주요 기능

- parent-child, peer-to-peer, mixed routing을 지원하는 영속 swarm runtime.
- session event log의 checkpoint와 cold resume을 통한 복구.
- group chat turn, 공유 context, 경량 memory, human-in-the-loop 일시 중지.
- topology, swimlane, route filter, message inspector, Live follow, child-session navigation을 제공하는 Conversation Flow 탭.

## UI 갤러리

갤러리는 결정적인 replay fixture를 사용하므로 실제 workspace나 API credential을 노출하지 않습니다.

| 데스크톱 개요 | 메시지 inspector |
| --- | --- |
| ![데스크톱 개요](dsh-swarm-plugin/assets/swarm-panel-host-desktop.png) | ![메시지 inspector](dsh-swarm-plugin/assets/swarm-panel-host.png) |

| 반응형 레이아웃 | topology와 Human input |
| --- | --- |
| ![반응형 Conversation Flow](dsh-swarm-plugin/assets/swarm-panel-host-narrow.png) | ![topology와 Human input](dsh-swarm-plugin/assets/swarm-panel.png) |

### 짧은 투어

![Conversation Flow 투어](dsh-swarm-plugin/assets/conversation-flow-tour.gif)

데스크톱 개요, 선택한 메시지 inspector, 390×844 반응형 레이아웃을 보여주는 GIF입니다. 실제 모델 출력이나 credential은 포함하지 않습니다.

## 빠른 시작

호환되는 DeepSeek Harness 설치에서 플러그인을 실행합니다. Harness를 먼저 설치한 뒤 `web` profile에 플러그인을 추가하세요.

### npm 공개 후

```bash
dsh plugin --profile web add dsh-swarm-panel
dsh web
```

### GitHub에서 직접 설치

플러그인은 현재 저장소의 `dsh-swarm-plugin/` 하위 디렉터리에 있습니다. pnpm Git subdirectory 문법을 사용하세요.

```bash
dsh plugin --profile web add 'github:stephenlzc/dsh-swarm-panel#path:dsh-swarm-plugin'
dsh web
```

재현 가능한 설치에는 commit을 고정하세요.

```bash
dsh plugin --profile web add \
  'github:stephenlzc/dsh-swarm-panel#path:dsh-swarm-plugin&<commit-sha>'
```

안정 버전은 npm 공개 후 npm 명령을 사용하고, GitHub 설치 전에는 소스와 설치 단계 코드를 검토하세요.

### 로컬 checkout에서 설치

```bash
git clone https://github.com/stephenlzc/dsh-swarm-panel.git
dsh plugin --profile web add file:./dsh-swarm-panel/dsh-swarm-plugin
dsh web
```

session을 만들고 Orchestrator에게 swarm 생성을 요청한 뒤 Chat과 Trajectory 옆의 **Conversation Flow** 탭을 여세요.

## 지원 환경

| 구성 요소 | 대상 |
| --- | --- |
| DeepSeek Harness | `0.2.0-rc.2` workspace API 및 호환 릴리스 |
| Node.js | `22.19+` 또는 `24+` |
| Browser | DeepSeek Harness `web` profile |
| Package | `dsh-swarm-panel@1.0.1` |

> **1.0.1 릴리스** — DeepSeek Harness `0.2.0-rc.2` 호환성과 감사에서 발견된 16개 견고성 수정이 포함되었습니다. 전체 목록과 업그레이드 안내는 [CHANGELOG](CHANGELOG.md)를 참고하세요.

## 검증 상태

- keyless 플러그인 테스트 93개가 통과했습니다 (real-API cold-resume은 키가 없으면 건너뜁니다).
- 실제 Web shell의 host-composed browser E2E가 통과했습니다.
- host/client TypeScript 검사와 tarball 설치 검증이 통과했습니다.
- message inspector, route/Agent filter, 검색 빈 상태, Live pause/resume, HITL, child-session navigation, 키보드 공존, 390×844 레이아웃을 수동 확인했습니다.

## 알려진 제한

- Export, A2A/ACP bridge, nested sub-swarm은 아직 제공하지 않습니다.
- Memory는 Orchestrator 소유 lexical retrieval이며 모든 turn prompt에 자동 주입되지 않습니다.
- Conversation Flow 패널 UI 문구는 현재 영어이며, 이 저장소의 README는 다국어를 지원합니다.

자세한 내용은 [상세 플러그인 README](dsh-swarm-plugin/README.md), [중국어 플러그인 README](dsh-swarm-plugin/README.zh.md), [release checklist](docs/release-checklist.md)를 참고하세요.

## 라이선스

MIT. [`dsh-swarm-plugin/LICENSE`](dsh-swarm-plugin/LICENSE)를 참조하세요.

## Issue와 Pull Request를 환영합니다

버그를 발견했거나 아이디어가 있거나 플러그인을 개선하고 싶다면 [Issue](https://github.com/stephenlzc/dsh-swarm-panel/issues)를 열거나 [Pull Request](https://github.com/stephenlzc/dsh-swarm-panel/pulls)를 보내 주세요.

Fork도 환영합니다. `dsh-swarm-panel`을 바탕으로 자신만의 확장, UI 개선, 통합 기능과 워크플로 실험을 자유롭게 만들어 보세요.
