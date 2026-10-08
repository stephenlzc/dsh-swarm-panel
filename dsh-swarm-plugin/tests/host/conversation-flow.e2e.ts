/**
 * Host-composed Conversation Flow: real web shell + this plugin's client
 * bundle. Run from a DeepSeek Harness checkout at tag `dsh-v0.2.0-rc.2`, with
 * this package mounted at `plugins/dsh-swarm-panel` and the workspace libs and
 * web dist built (`pnpm build:lib`, `pnpm build:native-system`, `pnpm build:web`).
 *
 * `vitest run --config vitest.web.config.ts <absolute test file>` no longer
 * selects the file (vitest 4 filters explicit paths through `test.include`), so
 * add this lane to a wrapper config's include and filter by its directory:
 *
 *   pnpm exec vitest run --config vitest.swarm-e2e.config.ts plugins/dsh-swarm-panel
 *
 * Not part of the plugin-local vitest include (see vitest.config.ts exclude).
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = join(HERE, 'dsh-swarm-panel.overlay.yml')
const ASSET = join(HERE, '../../assets/swarm-panel.png')
const EVIDENCE = process.env.CONVERSATION_FLOW_EVIDENCE ?? dirname(ASSET)

/**
 * Locate the DeepSeek Harness checkout this lane exercises. Two layouts resolve
 * so the same file runs from the plugin checkout and from a package mounted
 * inside the Harness tree, with no fixture symlink:
 *  - sibling: `<parent>/dsh-swarm-panel/dsh-swarm-plugin/tests/host` → `<parent>/deepseek-harness`
 *  - mounted: `<harness>/plugins/dsh-swarm-panel/tests/host`        → `<harness>`
 * `DSH_HARNESS_ROOT` overrides both.
 */
function resolveHarnessRoot(): URL {
  const override = process.env.DSH_HARNESS_ROOT
  const candidates = override !== undefined && override.length > 0
    ? [new URL(override.endsWith('/') ? override : `${override}/`)]
    : [new URL('../../../../deepseek-harness/', import.meta.url), new URL('../../../../', import.meta.url)]
  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(new URL('apps/web/tests/scaffold.ts', candidate)))) return candidate
  }
  throw new Error(
    `host E2E cannot locate the DeepSeek Harness checkout; tried ${candidates.map(candidate => candidate.href).join(', ')}. `
    + 'Run it from a Harness checkout with the workspace libs and web dist built, or set DSH_HARNESS_ROOT.',
  )
}

const HARNESS_ROOT = resolveHarnessRoot()
// Dynamic imports keep this file layout-independent; the Harness modules'
// own imports (playwright, …) then resolve from the Harness tree.
const { launchWebScaffold, realizeSeedFixture, seedSession, watchConsole } = await import(
  new URL('apps/web/tests/scaffold.ts', HARNESS_ROOT).href
)
const { newEnglishPage } = await import(new URL('apps/web/tests/support.ts', HARNESS_ROOT).href)
type WebScaffold = Awaited<ReturnType<typeof launchWebScaffold>>
// Harness 0.2.0 keeps the web lane's fixtures under <repo>/snapshots/web and
// versions the file name (the current session format is v4).
const LIGHTHOUSE = fileURLToPath(new URL('snapshots/web/lifecycle-chrome/session.v4.jsonl', HARNESS_ROOT))
const SEED_ID = 'conversation-flow-host'

/**
 * Harness 0.2.0 fixtures carry no \`seq\`/\`time\` envelope fields: the loader
 * assigns both by row order, and mixing a sequenced row with unsequenced ones
 * fails the fixture parser ("cannot mix projected and complete body rows").
 * The swarm rows are therefore injected verbatim.
 */
function withSwarmFlow(raw: string): string {
  const lines = raw.trimEnd().split('\n')
  const last = JSON.parse(lines.at(-1)!) as { type: string }
  if (last.type !== 'turn/end') throw new Error(`expected turn/end, got ${last.type}`)
  const payloads: Array<{ type: string; data: Record<string, unknown> }> = [
    { type: 'swarm/created', data: { swarmId: 'default', createdAt: '2026-01-01T00:00:00Z' } },
    { type: 'swarm/topology-changed', data: { swarmId: 'default', mode: 'mixed' } },
    { type: 'swarm/role-spawned', data: { swarmId: 'default', roleName: 'planner', childId: 'child-planner' } },
    { type: 'swarm/role-spawned', data: { swarmId: 'default', roleName: 'researcher', childId: 'child-researcher' } },
    { type: 'swarm/role-spawned', data: { swarmId: 'default', roleName: 'reviewer', childId: 'child-reviewer' } },
    { type: 'swarm/role-exited', data: { swarmId: 'default', roleName: 'reviewer', outcome: 'error' } },
    {
      type: 'swarm/role-message',
      data: {
        swarmId: 'default', from: 'orchestrator', to: 'planner', senderSessionId: 'root',
        content: 'Plan request — Let\'s plan a 3-phase rollout.', sentAt: '2026-01-01T17:21:03Z',
      },
    },
    {
      type: 'swarm/role-message',
      data: {
        swarmId: 'default', from: 'planner', to: 'researcher', senderSessionId: 'child-planner',
        content: 'Research request — Gather data on market impact.', sentAt: '2026-01-01T17:21:08Z',
      },
    },
    {
      type: 'swarm/role-message',
      data: {
        swarmId: 'default', from: 'researcher', to: 'reviewer', senderSessionId: 'child-researcher',
        content: 'Peer review request — Please review findings for accuracy.', sentAt: '2026-01-01T17:21:14Z',
      },
    },
    {
      type: 'swarm/role-message',
      data: {
        swarmId: 'default', from: 'researcher', to: 'group', senderSessionId: 'child-researcher',
        content: 'the plan', sentAt: '2026-01-01T17:21:17Z',
      },
    },
    {
      type: 'swarm/hitl-requested',
      data: {
        swarmId: 'default', requestId: 'hitl-1',
        question: 'Please approve the draft plan before execution.', requestedAt: '2026-01-01T17:21:28Z',
      },
    },
  ]
  // Harness 0.2.0's v4 reader refuses an unknown type unless the stored
  // envelope marks it `ignorable` — the documented contract for out-of-repo
  // plugin events. The production append path cannot set the marker yet, but
  // the fixture is hand-authored and must carry it.
  const injected = payloads.map(event => JSON.stringify({ ...event, ignorable: true }))
  return [lines[0], ...lines.slice(1, -1), ...injected, JSON.stringify(last)].join('\n') + '\n'
}

describe('host Conversation Flow composition', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
      // The overlay inserts this package by bare name, so the scaffold profile
      // must install it the way `dsh plugin add` does; without the profile
      // package the loader reports "dsh-swarm-panel: failed to import".
      profile: { packages: [{ dir: join(HERE, '..', '..'), enabled: false }] },
    })
    const sessionCwd = join(scaffold.workspaceCwd, 'workspace')
    mkdirSync(sessionCwd, { recursive: true })
    const raw = await readFile(LIGHTHOUSE, 'utf8')
    await seedSession(scaffold, withSwarmFlow(realizeSeedFixture(scaffold, raw, SEED_ID)), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 1057)
    tripwire = watchConsole(page)
    // 0.2.0 gates the shell behind the scaffold's process-token URL.
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  async function openFlow(): Promise<void> {
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    await page.getByRole('tab', { name: 'Conversation Flow' }).click()
    await page.getByLabel('Conversation Flow').waitFor({ timeout: 15_000 })
  }

  it('opens inspector, HITL, Live/Pause, and empty-match in the real host shell', async () => {
    mkdirSync(EVIDENCE, { recursive: true })
    await openFlow()
    const canvas = page.getByLabel('Conversation Flow')
    const text = await canvas.innerText()
    expect(text).toContain('planner')
    expect(text).toMatch(/parent → child/)
    expect(text).toMatch(/peer ↔ peer/)
    expect(text).toMatch(/UTC[+-]/)
    expect(text).toContain('Error')
    expect(await page.getByRole('button', { name: /Export/i }).count()).toBe(0)

    await page.locator('[data-flow-seq]').first().click()
    const details = page.getByRole('complementary', { name: 'message details' })
    const detailText = await details.innerText()
    expect(detailText).toContain('Route')
    expect(detailText).toContain('From')
    expect(detailText).toContain('To')
    expect(detailText).toContain('Status')
    expect(detailText).toContain('Content preview')
    expect(await details.getByRole('button', { name: 'Copy ID' }).count()).toBe(1)
    expect(await details.getByRole('button', { name: /Open .* session/ }).count()).toBeGreaterThan(0)

    await page.screenshot({ path: join(EVIDENCE, 'swarm-panel-host-desktop.png') })
    copyFileSync(join(EVIDENCE, 'swarm-panel-host-desktop.png'), join(EVIDENCE, 'swarm-panel-host.png'))
    copyFileSync(join(EVIDENCE, 'swarm-panel-host-desktop.png'), ASSET)

    const live = page.getByRole('checkbox', { name: 'Live follow on' })
    await live.click()
    expect(await page.locator('[data-live="paused"]').count()).toBe(1)
    await page.getByRole('checkbox', { name: 'Live follow paused' }).click()
    expect(await page.locator('[data-live="on"]').count()).toBe(1)

    const opens: string[] = []
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/api/')) opens.push(request.url())
    })
    await page.getByRole('button', { name: 'Human input pending: Please approve the draft plan before execution.' }).click()
    await page.waitForTimeout(500)

    await page.getByLabel('Search messages').fill('no-such-message')
    expect(await canvas.innerText()).toContain('No matching messages. Clear filters to see the full flow.')
    await page.getByRole('button', { name: 'Clear filters' }).first().click()
    expect(await page.locator('[data-flow-seq]').count()).toBeGreaterThan(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(EVIDENCE, 'swarm-panel-host-narrow.png') })
    await page.setViewportSize({ width: 1488, height: 1057 })

    await page.getByRole('tab', { name: 'Chat', exact: true }).focus()
    const intercepted = await page.evaluate(() => {
      let prevented = false
      const handler = (event: KeyboardEvent) => { if (event.defaultPrevented) prevented = true }
      window.addEventListener('keydown', handler)
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      window.removeEventListener('keydown', handler)
      return prevented
    })
    expect(intercepted).toBe(false)
    expect(tripwire.pageErrors).toEqual([])
    writeFileSync(join(EVIDENCE, 'browser-pass-1.log'), [
      'host e2e: inspector complementary, HITL click, Live/Pause, no-match empty, Chat-tab arrows',
      `apiPosts=${JSON.stringify(opens)}`,
      `pageErrors=${JSON.stringify(tripwire.pageErrors)}`,
    ].join('\n') + '\n')
  })
})
