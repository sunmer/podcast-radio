import { expect, test } from '@playwright/test'

test('discover renders verified catalog and can start a card', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Hacker Radio', exact: true })).toBeVisible()
  await expect(page.getByText(/\d+ episodes recommended/)).toBeVisible()
  const play = page.getByRole('button', { name: /^Play / }).first()
  await expect(play).toBeVisible()
  await play.click()
  await expect(page.getByLabel('Now playing')).toBeVisible()
})

test('radio view exposes the station controls', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Radio', exact: true }).click()
  await expect(page.getByRole('button', { name: /Play radio|Pause radio/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tune', exact: true })).toBeVisible()
})

test('mobile layout has no horizontal overflow', async ({ page }) => {
  await page.goto('./')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  expect(overflow).toBe(false)
})

test('the first playable audio source loads media in Chromium', async ({ page }) => {
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const catalog = await (await fetch(new URL('data/catalog.json', document.baseURI))).json()
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.src = catalog.entries[0].audioUrl
    return await new Promise<{ ok: boolean; readyState: number; error: string | null }>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: audio.readyState >= 1, readyState: audio.readyState, error: 'timeout' }), 15000)
      audio.onloadedmetadata = () => { clearTimeout(timer); resolve({ ok: true, readyState: audio.readyState, error: null }) }
      audio.onerror = () => { clearTimeout(timer); resolve({ ok: false, readyState: audio.readyState, error: audio.error?.message ?? 'media error' }) }
      audio.load()
    })
  })
  expect(result.ok).toBe(true)
})

test('radio plays from the middle and Tune works repeatedly', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudio = window.Audio
    window.Audio = function (...args: ConstructorParameters<typeof Audio>) {
      const audio = new NativeAudio(...args)
      if (!document.querySelector('audio[data-player]')) {
        audio.dataset.player = 'true'
        document.documentElement.append(audio)
      }
      return audio
    } as typeof Audio
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'Radio', exact: true }).click()
  await page.getByRole('button', { name: 'Play radio', exact: true }).click()
  const audio = page.locator('audio[data-player]')
  await expect.poll(() => audio.evaluate((element) => {
    const media = element as HTMLAudioElement
    return !media.paused && media.readyState >= 2 && media.currentTime >= 178 && media.volume > 0
  }), { timeout: 30000 }).toBe(true)
  for (let station = 0; station < 2; station += 1) {
    const previous = await audio.getAttribute('src')
    await page.getByRole('button', { name: 'Tune', exact: true }).click()
    await expect(audio).not.toHaveAttribute('src', previous!)
    await expect.poll(() => audio.evaluate((element) => {
      const media = element as HTMLAudioElement
      return !media.paused && media.readyState >= 2 && media.currentTime >= 178 && media.volume > 0
    }), { timeout: 30000 }).toBe(true)
  }
  const previous = await audio.getAttribute('src')
  await page.keyboard.press('ArrowRight')
  await expect(audio).not.toHaveAttribute('src', previous!)
  await expect.poll(() => audio.evaluate((element) => {
    const media = element as HTMLAudioElement
    return !media.paused && media.readyState >= 2 && media.volume > 0
  }), { timeout: 15000 }).toBe(true)
  await page.getByRole('button', { name: 'Pause radio', exact: true }).click()
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `reports/radio-${test.info().project.name}.png`, fullPage: true })
})

test('search and saved episodes work', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Save episode', exact: true }).first().click()
  await page.getByRole('button', { name: 'Saved', exact: true }).click()
  await expect(page.locator('.episode-card')).toHaveCount(1)
  await page.reload()
  await page.getByRole('button', { name: 'Saved', exact: true }).click()
  await expect(page.locator('.episode-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Saved', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search episodes' }).fill('no-matching-episode-123456789')
  await expect(page.getByRole('heading', { name: 'No episodes found' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search episodes' }).clear()
  await page.screenshot({ path: `reports/discover-${test.info().project.name}.png` })
})
