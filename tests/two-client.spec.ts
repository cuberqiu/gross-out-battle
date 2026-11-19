import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { QUESTIONS } from '../shared/questions'
import { syncIndex, verdictFor } from '../shared/verdicts'

mkdirSync('screenshots', { recursive: true })

test('question bank and sync index', () => {
  expect(QUESTIONS.length).toBeGreaterThanOrEqual(20)
  for (const question of QUESTIONS) {
    expect(question.prompt.length).toBeGreaterThan(0)
    expect(question.options.length).toBeGreaterThanOrEqual(3)
  }
  expect(verdictFor(0)).toBe('已经没有默契了')
  expect(verdictFor(30)).toBe('已经没有默契了')
  expect(verdictFor(31)).toBe('勉强算认识')
  expect(verdictFor(67)).toBe('臭味相投')
  expect(verdictFor(90)).toBe('心灵相通的恶心搭档')
  expect(syncIndex(2, 3, 0)).toBe(67)
  expect(syncIndex(0, 0, 1)).toBe(10)
})

async function settle(page: Page) {
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))]))
}

async function dismissHowTo(page: Page) {
  const button = page.getByTestId('howto-dismiss')
  await expect(button).toBeVisible()
  await button.click()
  await expect(page.getByTestId('howto')).toBeHidden()
}

async function shot(page: Page, name: string) {
  await settle(page)
  await page.screenshot({ path: `screenshots/${name}.png` })
}

function contexts(browser: Browser) {
  return Promise.all([
    browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'zh-CN' }),
    browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'zh-CN',
      isMobile: true,
      hasTouch: true,
    }),
  ])
}

async function closePair(desktop: BrowserContext, phone: BrowserContext) {
  await desktop.close()
  await phone.close()
}

async function throwAt(page: Page, itemId: string, x: number, y: number) {
  await page.getByTestId(`item-${itemId}`).click()
  const arena = page.getByTestId('arena')
  const box = await arena.boundingBox()
  if (!box) throw new Error('找不到对战区域')
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
  await page.waitForTimeout(220)
}

async function answer(host: Page, guest: Page, same: boolean) {
  await expect(host.getByTestId('sync-question')).toBeVisible()
  await expect(guest.getByTestId('sync-prompt')).toHaveText(await host.getByTestId('sync-prompt').innerText())
  const id0 = await host.locator('[data-option]').nth(0).getAttribute('data-option')
  const id1 = await host.locator('[data-option]').nth(1).getAttribute('data-option')
  if (!id0 || !id1) throw new Error('题目没有选项')
  if (same) {
    await host.locator(`[data-option="${id0}"]`).click()
    await guest.locator(`[data-option="${id0}"]`).click()
    await expect(host.getByTestId('sync-reveal')).toHaveAttribute('data-matched', 'yes')
    await expect(host.getByTestId('sync-reveal')).toContainText('默契+1')
  } else {
    await host.locator(`[data-option="${id0}"]`).click()
    await guest.locator(`[data-option="${id1}"]`).click()
    await expect(host.getByTestId('sync-reveal')).toHaveAttribute('data-matched', 'no')
    await expect(host.getByTestId('sync-reveal')).toContainText('没有默契了')
    await expect(guest.getByTestId('sync-reveal')).toContainText('没有默契了')
    await expect(host.locator('[data-testid="splat"][data-punishment="true"]').first()).toBeVisible()
    await expect(guest.locator('[data-testid="splat"][data-punishment="true"]').first()).toBeVisible()
  }
}

test('lobby, gross battle, wipe, accidental sync, result and rematch', async ({ browser }) => {
  const [desktop, phone] = await contexts(browser)
  const host = await desktop.newPage()
  const guest = await phone.newPage()
  try {
    await host.goto('/')
    await expect(host.getByTestId('howto')).toBeVisible()
    await shot(host, 'howto')
    await dismissHowTo(host)
    await host.getByTestId('nickname').fill('臭臭侠')
    await host.getByTestId('mode-gross').click()
    await expect(host.getByTestId('create-room')).toBeEnabled()
    await shot(host, 'lobby')
    await host.getByTestId('create-room').click()
    await expect(host.getByTestId('room-code')).toBeVisible()
    const code = (await host.getByTestId('room-code').innerText()).trim()
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/)
    await expect
      .poll(async () => host.getByTestId('qr').evaluate((el: HTMLCanvasElement) => el.width))
      .toBeGreaterThan(20)
    await shot(host, 'waiting')

    await guest.goto(`/?room=${code}`)
    await dismissHowTo(guest)
    await guest.getByTestId('nickname').fill('番茄投手')
    await expect(guest.getByTestId('room-code-input')).toHaveValue(code)
    await guest.getByTestId('join-room').click()
    await expect(host.getByText('番茄投手')).toBeVisible()
    await expect(host.getByTestId('start-game')).toBeEnabled()
    await host.getByTestId('start-game').click()
    await expect(host.getByTestId('arena')).toHaveAttribute('data-phase', 'battle')
    await expect(guest.getByTestId('arena')).toHaveAttribute('data-phase', 'battle')

    await throwAt(host, 'tomato', 0.32, 0.36)
    await expect(guest.getByTestId('arena')).toHaveAttribute('data-last-effect', 'shake')
    await throwAt(host, 'wasabi', 0.62, 0.48)
    await expect(guest.getByTestId('arena')).toHaveAttribute('data-flipped', 'true')
    await expect(guest.getByTestId('arena')).toHaveAttribute('data-flipped', 'false', { timeout: 5000 })

    await throwAt(host, 'sock', 0.4, 0.42)
    await throwAt(host, 'slime', 0.58, 0.62)
    await throwAt(host, 'fart', 0.7, 0.34)
    await throwAt(host, 'roach', 0.46, 0.55)
    await throwAt(host, 'leftover', 0.3, 0.68)
    await throwAt(host, 'snot', 0.66, 0.5)
    await throwAt(guest, 'tomato', 0.5, 0.4)
    await throwAt(guest, 'sock', 0.38, 0.58)

    await expect.poll(async () => host.locator('[data-testid="splat"]').count()).toBeGreaterThan(0)
    await expect.poll(async () => guest.locator('[data-testid="splat"]').count()).toBeGreaterThan(5)
    await expect.poll(async () => {
      const mine = await host.getByTestId('score-self').innerText()
      const theirs = await guest.getByTestId('score-opp').innerText()
      return mine === theirs && mine !== '0'
    }).toBe(true)

    const roach = guest.locator('[data-item="roach"]').first()
    const firstPose = await roach.evaluate((el: HTMLElement) => el.style.transform)
    await guest.waitForTimeout(450)
    const secondPose = await roach.evaluate((el: HTMLElement) => el.style.transform)
    expect(secondPose).not.toBe(firstPose)

    await shot(guest, 'battle-splats')
    await shot(host, 'battle-desktop')

    const beforeCount = await guest.locator('[data-testid="splat"]').count()
    const beforeScore = Number(await host.getByTestId('score-self').innerText())
    const sock = guest.locator('[data-item="sock"]').first()
    const box = await sock.boundingBox()
    if (!box) throw new Error('臭袜子没有糊上来')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    for (let pass = 0; pass < 5; pass += 1) {
      await guest.mouse.move(x - 36, y - 16)
      await guest.mouse.down()
      await guest.mouse.move(x + 48, y + 28, { steps: 14 })
      await guest.mouse.move(x - 24, y + 8, { steps: 10 })
      await guest.mouse.up()
    }
    await expect.poll(async () => guest.locator('[data-testid="splat"]').count()).toBeLessThan(beforeCount)
    await expect.poll(async () => Number(await host.getByTestId('score-self').innerText())).toBeLessThan(beforeScore)
    const afterMine = await host.getByTestId('score-self').innerText()
    await expect(guest.getByTestId('score-opp')).toHaveText(afterMine)

    await Promise.all([throwAt(host, 'fart', 0.34, 0.3), throwAt(guest, 'fart', 0.6, 0.44)])
    await expect(host.getByTestId('accident-banner')).toContainText('居然有默契')
    await shot(host, 'accident')
    await expect(host.getByTestId('sync-index')).toHaveText('10')

    await expect(host.getByTestId('result-screen')).toBeVisible({ timeout: 35_000 })
    await expect(guest.getByTestId('result-screen')).toBeVisible()
    await expect(host.getByTestId('result-stamp')).toHaveText('今日最臭王')
    await expect(host.getByTestId('result-verdict')).toContainText('已经没有默契了')
    await expect(host.getByTestId('result-headline')).toContainText('糊成了传奇')
    await shot(host, 'result')

    await host.getByTestId('rematch').click()
    await expect(host.getByTestId('rematch')).toContainText('等待')
    await guest.getByTestId('rematch').scrollIntoViewIfNeeded()
    await guest.getByTestId('rematch').click()
    await expect(host.getByTestId('arena')).toBeVisible()
    await expect(guest.getByTestId('arena')).toHaveAttribute('data-phase', 'battle')
  } finally {
    await closePair(desktop, phone)
  }
})

test('sync quiz match, mismatch punishment, and shared verdict', async ({ browser }) => {
  const [desktop, phone] = await contexts(browser)
  const host = await desktop.newPage()
  const guest = await phone.newPage()
  try {
    await host.goto('/')
    await dismissHowTo(host)
    await host.getByTestId('nickname').fill('臭臭侠')
    await host.getByTestId('mode-sync').click()
    await expect(host.getByTestId('create-room')).toBeEnabled()
    await host.getByTestId('create-room').click()
    const code = (await host.getByTestId('room-code').innerText()).trim()
    await guest.goto(`/?room=${code}`)
    await dismissHowTo(guest)
    await guest.getByTestId('nickname').fill('番茄投手')
    await guest.getByTestId('join-room').click()
    await expect(host.getByTestId('start-game')).toBeEnabled()
    await host.getByTestId('start-game').click()

    await expect(host.getByTestId('sync-question')).toBeVisible()
    await shot(host, 'sync-question')
    await answer(host, guest, true)
    await shot(host, 'sync-plus')

    await answer(host, guest, false)
    await shot(host, 'no-sync')
    await shot(guest, 'no-sync-phone')

    await answer(host, guest, true)
    await expect(host.getByTestId('result-screen')).toBeVisible({ timeout: 12_000 })
    await expect(host.getByTestId('result-sync')).toHaveText('67')
    await expect(host.getByTestId('result-verdict')).toContainText('臭味相投')
    await expect(guest.getByTestId('result-verdict')).toContainText('臭味相投')
    await shot(host, 'result-sync')
  } finally {
    await closePair(desktop, phone)
  }
})

test('mixed mode alternates throwing and a sync question', async ({ browser }) => {
  const [desktop, phone] = await contexts(browser)
  const host = await desktop.newPage()
  const guest = await phone.newPage()
  try {
    await host.goto('/')
    await dismissHowTo(host)
    await host.getByTestId('nickname').fill('臭臭侠')
    await host.getByTestId('mode-mixed').click()
    await expect(host.getByTestId('create-room')).toBeEnabled()
    await host.getByTestId('create-room').click()
    const code = (await host.getByTestId('room-code').innerText()).trim()
    await guest.goto(`/?room=${code}`)
    await dismissHowTo(guest)
    await guest.getByTestId('nickname').fill('番茄投手')
    await guest.getByTestId('join-room').click()
    await host.getByTestId('start-game').click()
    await expect(host.getByTestId('arena')).toHaveAttribute('data-phase', 'battle')
    await throwAt(host, 'slime', 0.48, 0.46)
    await throwAt(host, 'tomato', 0.62, 0.58)
    await expect(guest.locator('[data-testid="splat"]').first()).toBeVisible()
    await expect(host.getByTestId('sync-question')).toBeVisible({ timeout: 10_000 })
    await answer(host, guest, true)
    await expect(host.getByTestId('result-screen')).toBeVisible({ timeout: 12_000 })
    await expect(host.getByTestId('result-stamp')).toHaveText('今日最臭王')
    await expect(host.getByTestId('result-sync')).toHaveText('100')
    await expect(host.getByTestId('result-verdict')).toContainText('心灵相通的恶心搭档')
    const grosses = await host.getByTestId('result-gross').allInnerTexts()
    expect(grosses.map(Number).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0)
    await shot(host, 'result-mixed')
  } finally {
    await closePair(desktop, phone)
  }
})

test('http transport creates, joins, and starts against a websocket peer', async ({ browser }) => {
  const [desktop, phone] = await contexts(browser)
  const host = await desktop.newPage()
  const guest = await phone.newPage()
  let hostSockets = 0
  host.on('websocket', () => {
    hostSockets += 1
  })
  const guestSocket = guest.waitForEvent('websocket')
  try {
    const opened = host.waitForResponse((res) => res.url().includes('/rt/open') && res.status() === 200)
    await host.goto('/?transport=http')
    await opened
    await dismissHowTo(host)
    await host.getByTestId('nickname').fill('臭臭侠')
    await expect(host.getByTestId('create-room')).toBeEnabled()
    expect(hostSockets).toBe(0)
    await host.getByTestId('create-room').click()
    await expect(host.getByTestId('room-code')).toBeVisible()
    const code = (await host.getByTestId('room-code').innerText()).trim()
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/)

    await guest.goto(`/?room=${code}`)
    await guestSocket
    await dismissHowTo(guest)
    await guest.getByTestId('nickname').fill('番茄投手')
    await guest.getByTestId('join-room').click()
    await expect(host.getByText('番茄投手')).toBeVisible()
    await expect(host.getByTestId('start-game')).toBeEnabled()
    await host.getByTestId('start-game').click()
    await expect(host.getByTestId('arena')).toHaveAttribute('data-phase', 'battle')
    await expect(guest.getByTestId('arena')).toHaveAttribute('data-phase', 'battle')

    await throwAt(host, 'sock', 0.42, 0.46)
    await expect(guest.locator('[data-item="sock"]')).toBeVisible()
    await throwAt(guest, 'tomato', 0.55, 0.4)
    await expect(host.locator('[data-item="tomato"]')).toBeVisible()
    expect(hostSockets).toBe(0)
  } finally {
    await closePair(desktop, phone)
  }
})

test('a dropped friend pauses the round and then forfeits', async ({ browser }) => {
  const [desktop, phone] = await contexts(browser)
  const host = await desktop.newPage()
  const guest = await phone.newPage()
  try {
    await host.goto('/')
    await dismissHowTo(host)
    await host.getByTestId('nickname').fill('臭臭侠')
    await expect(host.getByTestId('create-room')).toBeEnabled()
    await host.getByTestId('create-room').click()
    const code = (await host.getByTestId('room-code').innerText()).trim()
    await guest.goto(`/?room=${code}`)
    await dismissHowTo(guest)
    await guest.getByTestId('nickname').fill('番茄投手')
    await guest.getByTestId('join-room').click()
    await host.getByTestId('start-game').click()
    await expect(host.getByTestId('arena')).toHaveAttribute('data-phase', 'battle')
    await guest.close()
    await expect(host.getByTestId('disconnect-banner')).toContainText('信号不稳')
    await expect(host.getByTestId('result-screen')).toBeVisible({ timeout: 10_000 })
    await expect(host.getByTestId('result-headline')).toContainText('临阵脱逃')
    await shot(host, 'disconnect')
  } finally {
    await desktop.close()
    await phone.close()
  }
})
