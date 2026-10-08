# dsh-swarm-panel

[English](README.md) · [中文](README.zh-CN.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

[![CI](https://github.com/stephenlzc/dsh-swarm-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/stephenlzc/dsh-swarm-panel/actions/workflows/ci.yml)

Plugin de observabilidade do Conversation Flow para o [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): acompanhe como um Orchestrator coordena child agents, inspecione mensagens roteadas, acompanhe mudanças de topology e abra qualquer child session pela interface web.

![Visão geral do Conversation Flow](dsh-swarm-plugin/assets/swarm-panel.png)

Este repositório contém o plugin independente `dsh-swarm-panel`. Ele não é o mesmo pacote que o antigo plugin `dsh-agent-swarm`, que existia dentro de um checkout do Harness.

## O que ele adiciona

- Um swarm runtime durável com routing parent-child, peer-to-peer e misto.
- Recuperação por checkpoint e cold resume a partir do session event log.
- Group chat turns, contexto compartilhado, memória leve e pausas human-in-the-loop.
- Uma aba Conversation Flow composta pelo host com topology, swimlanes, filtros de rota, inspector de mensagens, Live follow e navegação para child sessions.

## Galeria da UI

A galeria usa um fixture determinístico para mostrar estados visuais importantes sem expor um workspace real ou credenciais de API.

| Visão desktop | Inspector de mensagens |
| --- | --- |
| ![Visão desktop](dsh-swarm-plugin/assets/swarm-panel-host-desktop.png) | ![Inspector de mensagens](dsh-swarm-plugin/assets/swarm-panel-host.png) |

| Layout responsivo | Topology e Human input |
| --- | --- |
| ![Conversation Flow responsivo](dsh-swarm-plugin/assets/swarm-panel-host-narrow.png) | ![Topology e Human input](dsh-swarm-plugin/assets/swarm-panel.png) |

### Tour curto

![Tour do Conversation Flow](dsh-swarm-plugin/assets/conversation-flow-tour.gif)

O tour mostra a visão desktop, o inspector de uma mensagem selecionada e o layout responsivo 390×844. Não contém saída de modelo nem credenciais.

## Início rápido

O plugin roda dentro de uma instalação compatível do DeepSeek Harness. Instale o Harness primeiro e depois adicione o plugin ao profile `web`.

### Depois da publicação no npm

```bash
dsh plugin --profile web add dsh-swarm-panel
dsh web
```

### Instalação direta pelo GitHub

Atualmente o plugin está no subdiretório `dsh-swarm-plugin/` deste repositório. Use a sintaxe de subdiretório Git do pnpm:

```bash
dsh plugin --profile web add 'github:stephenlzc/dsh-swarm-panel#path:dsh-swarm-plugin'
dsh web
```

Para uma instalação reproduzível, fixe o commit:

```bash
dsh plugin --profile web add \
  'github:stephenlzc/dsh-swarm-panel#path:dsh-swarm-plugin&<commit-sha>'
```

Use npm para versões estáveis depois da publicação. Antes de instalar pelo GitHub, revise e confie no código-fonte e no código que possa ser executado durante a instalação.

### A partir de um checkout local

```bash
git clone https://github.com/stephenlzc/dsh-swarm-panel.git
dsh plugin --profile web add file:./dsh-swarm-panel/dsh-swarm-plugin
dsh web
```

Crie ou abra uma session, peça ao Orchestrator para criar um swarm e abra a aba **Conversation Flow** ao lado de Chat e Trajectory.

## Ambiente compatível

| Componente | Alvo |
| --- | --- |
| DeepSeek Harness | `0.2.0-rc.2` workspace API e versões compatíveis |
| Node.js | `22.19+` ou Node `24+` |
| Browser | DeepSeek Harness `web` profile |
| Package | `dsh-swarm-panel@0.2.0` |

## Status da verificação

- 84 testes do plugin sem chave e 1 teste real-API de cold-resume passaram.
- O browser E2E composto pelo host passou no Web shell real.
- As verificações TypeScript de host/client e a instalação do tarball passaram.
- Foram verificados manualmente o inspector, filtros de route/Agent, estado vazio de busca, Live pause/resume, HITL, navegação de child session, coexistência do teclado e viewport 390×844.

## Limitações conhecidas

- Export, bridge A2A/ACP e nested sub-swarms ainda não estão implementados.
- Memory é um retrieval léxico pertencente ao Orchestrator e ainda não é injetada automaticamente em cada turn prompt.
- Os textos da UI do Conversation Flow estão atualmente apenas em inglês; o README oferece suporte multilíngue.

Consulte o [README detalhado do plugin](dsh-swarm-plugin/README.md), o [README do plugin em chinês](dsh-swarm-plugin/README.zh.md) e o [release checklist](docs/release-checklist.md).

## Licença

MIT. Consulte [`dsh-swarm-plugin/LICENSE`](dsh-swarm-plugin/LICENSE).

## Convite para Issues e Pull Requests

Encontrou um erro, tem uma ideia ou quer melhorar o plugin? Abra uma [issue](https://github.com/stephenlzc/dsh-swarm-panel/issues) ou envie um [pull request](https://github.com/stephenlzc/dsh-swarm-panel/pulls).

Forks são bem-vindos. Fique à vontade para criar suas próprias extensões, melhorias de UI, integrações e experimentos de fluxo de trabalho com base no `dsh-swarm-panel`.
