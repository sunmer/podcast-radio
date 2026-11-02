import { expect, test } from '@playwright/test'

test('discover renders verified catalog and can start a card', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Hacker Radio', exact: true })).toBeVisible()
  await expect(page.getByText(/\d+ episodes recommended/)).toBeVisible()
  const play = page.locator('#discover').getByRole('button', { name: /^Play / }).first()
  await expect(play).toBeVisible()
  await play.click()
  await expect(page.getByLabel('Now playing')).toBeVisible()
  const title = await page.locator('.player-copy strong').textContent()
  await expect(page.locator('.station-title')).toHaveText(title!)
  await expect(page.getByRole('heading', { name: 'All recommended episodes', exact: true })).toBeVisible()
  await expect(page.getByText('For you', { exact: true })).toHaveCount(0)
  await expect(page.getByText('BASED ON YOUR LISTENING', { exact: true })).toHaveCount(0)
  await expect(page.locator('.episode-card')).toHaveCount(104)
})

test('radio is first and Discover is on the same page', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('button', { name: /Play radio|Pause radio/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible()
  await expect(page.locator('#discover')).toBeAttached()
  const radio = await page.locator('#radio').boundingBox()
  const discover = await page.locator('#discover').boundingBox()
  expect(radio!.y + radio!.height).toBeLessThanOrEqual(discover!.y + 1)
  await page.getByRole('link', { name: 'Discover', exact: true }).click()
  await expect(page).toHaveURL(/#discover$/)
  await page.getByRole('textbox', { name: 'Search episodes' }).fill('nuclear')
  await page.getByRole('link', { name: 'Radio', exact: true }).click()
  await expect(page).toHaveURL(/#radio$/)
  await expect(page.getByRole('textbox', { name: 'Search episodes' })).toHaveValue('nuclear')
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

test('radio plays the displayed pick from the middle and Next works repeatedly', async ({ page }) => {
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
  await expect(page.locator('.station-title')).toBeVisible()
  const initial = await page.locator('.station-title').textContent()
  await page.getByRole('button', { name: 'Play radio', exact: true }).click()
  await expect(page.locator('.player-copy strong')).toHaveText(initial!)
  const audio = page.locator('audio[data-player]')
  await expect.poll(() => audio.evaluate((element) => {
    const media = element as HTMLAudioElement
    return !media.paused && media.readyState >= 2 && media.currentTime >= 178 && media.volume > 0
  }), { timeout: 30000 }).toBe(true)
  for (let station = 0; station < 2; station += 1) {
    const previous = await audio.getAttribute('src')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
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
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  const playBounds = await page.getByRole('button', { name: 'Play radio', exact: true }).boundingBox()
  expect(playBounds).not.toBeNull()
  expect(playBounds!.y + playBounds!.height).toBeLessThan(page.viewportSize()!.height - 76)
  await page.screenshot({ path: `reports/radio-${test.info().project.name}.png` })
})

test('saved state is shared between the radio and Discover', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Save current episode', exact: true }).click()
  await page.getByRole('button', { name: 'Saved', exact: true }).click()
  await expect(page.locator('.episode-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Remove from saved', exact: true }).click()
  await expect(page.locator('.episode-card')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save current episode', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

test('tuning variants last two seconds, change, and stop on pause', async ({ page }) => {
  await page.addInitScript(() => {
    type Clip = { duration: number; fingerprint: number; started: number; stopped: boolean }
    const clips: Clip[] = []
    Object.assign(window, { tuningClips: clips })
    const create = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this)
      const start = source.start.bind(source)
      const stop = source.stop.bind(source)
      let clip: Clip
      source.start = (...args: Parameters<typeof start>) => {
        clip = { duration: source.buffer!.duration, fingerprint: source.buffer!.getChannelData(0)[1000], started: performance.now(), stopped: false }
        clips.push(clip)
        start(...args)
      }
      source.stop = (...args: Parameters<typeof stop>) => {
        if (clip) clip.stopped = true
        stop(...args)
      }
      return source
    }
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'Play radio', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('TUNING')
  await page.waitForTimeout(500)
  await expect(page.getByRole('status')).toHaveText('TUNING')
  await expect(page.getByRole('status')).toHaveText('ON AIR', { timeout: 25000 })
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('TUNING')
  await expect(page.getByRole('button', { name: 'Pause radio', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pause radio', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('STANDBY')
  const clips = await page.evaluate(() => (window as unknown as { tuningClips: { duration: number; fingerprint: number; stopped: boolean }[] }).tuningClips)
  expect(clips.length).toBeGreaterThanOrEqual(2)
  expect(clips.every((clip) => clip.duration === 2 && clip.stopped)).toBe(true)
  for (let index = 1; index < clips.length; index += 1) expect(clips[index].fingerprint).not.toBe(clips[index - 1].fingerprint)
})

test('initial radio pick changes on reload and remains stable while browsing', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('.station-title')).toBeVisible()
  const first = await page.locator('#radio').getAttribute('data-episode-id')
  await page.getByRole('button', { name: 'About', exact: true }).click()
  await expect(page.locator('#radio')).toHaveAttribute('data-episode-id', first!)
  await page.reload()
  await expect(page.locator('#radio')).not.toHaveAttribute('data-episode-id', first!)
  await expect(page.getByRole('status')).toHaveText('STANDBY')
})

test('radio comment context matches the current episode and updates on Next', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('.station-title')).toBeVisible()
  const entries = await page.evaluate(async () => (await (await fetch(new URL('data/catalog.json', document.baseURI))).json()).entries)
  const verifyContext = async () => {
    const id = await page.locator('#radio').getAttribute('data-episode-id')
    const episode = entries.find((entry: { id: string }) => entry.id === id)
    const context = page.getByRole('complementary', { name: 'Hacker News comment context' })
    const first = episode.recommendations[0]
    await expect(context.locator('blockquote').first()).toHaveText(first.excerpt)
    await expect(context.locator('.comment-byline').first()).toContainText(first.author)
    await expect(context.locator('.comment-thread').first()).toHaveText(first.storyTitle)
    await expect(context.locator('.comment-source').first()).toHaveAttribute('href', first.commentUrl)
    if (episode.recommendations.length > 1) {
      await context.locator('summary').first().click()
      await expect(context.locator('.comment-source').nth(1)).toBeVisible()
    }
    return id
  }
  const firstId = await verifyContext()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.locator('#radio')).not.toHaveAttribute('data-episode-id', firstId!)
  await verifyContext()
  await page.getByRole('complementary', { name: 'Hacker News comment context' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `reports/context-${test.info().project.name}.png` })
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
