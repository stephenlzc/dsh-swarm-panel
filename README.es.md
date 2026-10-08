# dsh-swarm-panel

[English](README.md) · [中文](README.zh-CN.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

[![CI](https://github.com/stephenlzc/dsh-swarm-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/stephenlzc/dsh-swarm-panel/actions/workflows/ci.yml)

Plugin de observabilidad de Conversation Flow para [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): observa cómo un Orchestrator coordina child agents, inspecciona mensajes enrutados, sigue los cambios de topology y abre cualquier child session desde la interfaz web.

![Resumen de Conversation Flow](dsh-swarm-plugin/assets/swarm-panel.png)

Este repositorio contiene el plugin independiente `dsh-swarm-panel`. No es el mismo paquete que el antiguo plugin `dsh-agent-swarm` que vivía dentro de un checkout de Harness.

## Qué añade

- Un swarm runtime duradero con routing parent-child, peer-to-peer y mixto.
- Recuperación mediante checkpoints y cold resume desde el session event log.
- Group chat turns, contexto compartido, memoria ligera y pausas human-in-the-loop.
- Una pestaña Conversation Flow compuesta por el host con topology, swimlanes, filtros de rutas, inspector de mensajes, Live follow y navegación a child sessions.

## Galería UI

La galería usa un fixture determinista para mostrar estados visuales importantes sin exponer un workspace real ni credenciales de API.

| Resumen de escritorio | Inspector de mensajes |
| --- | --- |
| ![Resumen de escritorio](dsh-swarm-plugin/assets/swarm-panel-host-desktop.png) | ![Inspector de mensajes](dsh-swarm-plugin/assets/swarm-panel-host.png) |

| Diseño responsive | Topology y Human input |
| --- | --- |
| ![Conversation Flow responsive](dsh-swarm-plugin/assets/swarm-panel-host-narrow.png) | ![Topology y Human input](dsh-swarm-plugin/assets/swarm-panel.png) |

### Tour corto

![Tour de Conversation Flow](dsh-swarm-plugin/assets/conversation-flow-tour.gif)

El tour muestra el resumen de escritorio, el inspector de un mensaje seleccionado y el diseño responsive 390×844. No contiene salida de modelo ni credenciales.

## Inicio rápido

El plugin funciona dentro de una instalación compatible de DeepSeek Harness. Instala Harness primero y después añade el plugin al profile `web`.

### Después de publicar en npm

```bash
dsh plugin --profile web add dsh-swarm-panel
dsh web
```

### Instalación directa desde GitHub

El plugin está actualmente en el subdirectorio `dsh-swarm-plugin/` del repositorio. Usa la sintaxis de subdirectorio Git de pnpm:

```bash
dsh plugin --profile web add 'github:stephenlzc/dsh-swarm-panel#path:dsh-swarm-plugin'
dsh web
```

Para una instalación reproducible, fija el commit:

```bash
dsh plugin --profile web add \
  'github:stephenlzc/dsh-swarm-panel#path:dsh-swarm-plugin&<commit-sha>'
```

Usa npm para versiones estables después de la publicación. Antes de instalar desde GitHub, revisa y confía en el código fuente y en el código que pueda ejecutarse durante la instalación.

### Desde un checkout local

```bash
git clone https://github.com/stephenlzc/dsh-swarm-panel.git
dsh plugin --profile web add file:./dsh-swarm-panel/dsh-swarm-plugin
dsh web
```

Crea o abre una session, pide al Orchestrator que cree un swarm y abre la pestaña **Conversation Flow** junto a Chat y Trajectory.

## Entorno compatible

| Componente | Objetivo |
| --- | --- |
| DeepSeek Harness | `0.2.0-rc.2` workspace API y versiones compatibles |
| Node.js | `22.19+` o Node `24+` |
| Browser | DeepSeek Harness `web` profile |
| Package | `dsh-swarm-panel@1.0.1` |

> **Versión 1.0.1** — compatibilidad con DeepSeek Harness `0.2.0-rc.2` y 16 correcciones de robustez de la auditoría. Consulta el [CHANGELOG](CHANGELOG.md) para la lista completa y las notas de actualización.

## Estado de verificación

- Pasaron 93 tests del plugin sin clave (el test real-API de cold-resume se omite sin clave).
- Pasó el browser E2E compuesto por el host en el Web shell real.
- Pasaron las comprobaciones TypeScript de host/client y la instalación del tarball.
- Se verificaron manualmente el inspector, filtros de route/Agent, estado vacío de búsqueda, Live pause/resume, HITL, navegación de child session, coexistencia del teclado y viewport 390×844.

## Limitaciones conocidas

- Export, el bridge A2A/ACP y los nested sub-swarms todavía no están implementados.
- Memory es un retrieval léxico propiedad del Orchestrator y aún no se inyecta automáticamente en cada turn prompt.
- El texto de la UI de Conversation Flow es actualmente solo en inglés; el README sí ofrece soporte multilingüe.

Consulta el [README detallado del plugin](dsh-swarm-plugin/README.md), el [README del plugin en chino](dsh-swarm-plugin/README.zh.md) y el [release checklist](docs/release-checklist.md).

## Licencia

MIT. Consulta [`dsh-swarm-plugin/LICENSE`](dsh-swarm-plugin/LICENSE).

## Invitación a Issues y Pull Requests

¿Encontraste un error, tienes una idea o quieres mejorar el plugin? Abre un [issue](https://github.com/stephenlzc/dsh-swarm-panel/issues) o envía un [pull request](https://github.com/stephenlzc/dsh-swarm-panel/pulls).

Los forks son bienvenidos. Puedes crear tus propias extensiones, mejoras de UI, integraciones y experimentos de flujo de trabajo sobre `dsh-swarm-panel`.
