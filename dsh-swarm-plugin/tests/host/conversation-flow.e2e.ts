/**
 * Host-composed Conversation Flow: real web shell + this plugin's client
 * bundle. Run from the DeepSeek Harness repo:
 *
 *   pnpm exec vitest run --config vitest.web.config.ts \
 *     /Users/cong/Documents/AI_Project/dsh-swarm-panel/dsh-swarm-plugin/tests/host/conversation-flow.e2e.ts
 *
 * Not part of the plugin-local vitest include (see vitest.config.ts exclude).
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  launchWebScaffold,
  realizeSeedFixture,
  seedSession,
  watchConsole,
  type WebScaffold,
} from '../../../../deepseek-harness/apps/web/tests/scaffold.ts'
import { newEnglishPage } from '../../../../deepseek-harness/apps/web/tests/support.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = join(HERE, 'dsh-swarm-panel.overlay.yml')
const ASSET = join(HERE, '../../assets/swarm-panel.png')
const EVIDENCE = process.env.CONVERSATION_FLOW_EVIDENCE ?? dirname(ASSET)
const LIGHTHOUSE = fileURLToPath(new URL(
  '../../../../deepseek-harness/apps/web/tests/snapshots/lifecycle-chrome/session.jsonl',
  import.meta.url,
))
const SEED_ID = 'conversation-flow-host'

function withSwarmFlow(raw: string): string {
  const lines = raw.trimEnd().split('\n')
  const last = JSON.parse(lines.at(-1)!) as { type: string; seq: number; time: number }
  if (last.type !== 'turn/end') throw new Error(`expected turn/end, got ${last.type}`)
  const prior = JSON.parse(lines.at(-2)!) as { seq: number; time: number }
  let seq = prior.seq + 1
  let time = prior.time + 1
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
  const injected = payloads.map(event => JSON.stringify({ ...event, seq: seq++, time: time++ }))
  last.seq = seq
  last.time = time
  return [lines[0], ...lines.slice(1, -1), ...injected, JSON.stringify(last)].join('\n') + '\n'
}

describe('host Conversation Flow composition', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    const sessionCwd = join(scaffold.workspaceCwd, 'workspace')
    mkdirSync(sessionCwd, { recursive: true })
    const raw = await readFile(LIGHTHOUSE, 'utf8')
    await seedSession(scaffold, withSwarmFlow(realizeSeedFixture(scaffold, raw, SEED_ID)), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 1057)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
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
