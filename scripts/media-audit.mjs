import fs from 'node:fs/promises'
import { chromium } from '@playwright/test'

const site = process.env.SITE_URL ?? 'http://127.0.0.1:4173/'
const browser = await chromium.launch()
const context = await browser.newContext()
const catalogPage = await context.newPage()
await catalogPage.goto(site)
const catalog = await catalogPage.evaluate(async () => (await fetch(new URL('data/catalog.json', document.baseURI))).json())
await catalogPage.close()
const results = []
let cursor = 0

try {
  await Promise.all(Array.from({ length: 4 }, async () => {
    const page = await context.newPage()
    await page.goto(site)
    while (cursor < catalog.entries.length) {
      const episode = catalog.entries[cursor++]
      const result = await page.evaluate(async (entry) => {
        const audio = new Audio()
        audio.muted = true
        audio.preload = 'auto'
        document.body.append(audio)
        let start = 0
        const outcome = await new Promise((resolve) => {
          const timer = setTimeout(() => finish({ ok: false, error: 'Media playback or seek timed out' }), 25000)
          function finish(value) {
            clearTimeout(timer)
            audio.onerror = null
            audio.ontimeupdate = null
            resolve({ ...value, duration: audio.duration, position: audio.currentTime })
          }
          audio.onerror = () => finish({ ok: false, error: audio.error?.message ?? 'Media error' })
          audio.onloadedmetadata = () => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
              finish({ ok: false, error: 'Invalid duration' })
              return
            }
            start = Math.min(180, audio.duration / 2)
            audio.currentTime = start
          }
          audio.ontimeupdate = () => {
            if (start > 0 && audio.currentTime >= start + 0.2 && !audio.seeking && audio.readyState >= 2) {
              finish({ ok: true })
            }
          }
          audio.src = entry.audioUrl
          audio.play().catch((error) => finish({ ok: false, error: error.message }))
        })
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
        audio.remove()
        return outcome
      }, episode)
      results.push({ id: episode.id, title: episode.title, ...result })
      console.log(`${results.length}/${catalog.entries.length} ${result.ok ? 'PASS' : 'FAIL'} ${episode.title}${result.error ? `: ${result.error}` : ''}`)
    }
    await page.close()
  }))
} finally {
  await browser.close()
}
const failures = results.filter((result) => !result.ok)
await fs.writeFile(new URL('../reports/media-audit.json', import.meta.url), JSON.stringify({
  checkedAt: new Date().toISOString(), site, checks: results.length, failures, results,
}, null, 2) + '\n')
console.log(`Browser playback and seeking: ${results.length - failures.length}/${results.length} passed`)
if (failures.length) process.exitCode = 1
