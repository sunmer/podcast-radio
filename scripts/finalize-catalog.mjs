import fs from 'node:fs/promises'

const catalogPath = new URL('../public/data/catalog.json', import.meta.url)
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
const audit = JSON.parse(await fs.readFile(new URL('../reports/media-audit.json', import.meta.url), 'utf8'))
const results = new Map(audit.results.map((result) => [result.id, result]))
if (catalog.entries.some((entry) => !results.has(entry.id))) throw new Error('Every entry must have a browser audit result')
const excluded = []
catalog.entries = catalog.entries.filter((entry) => {
  const result = results.get(entry.id)
  if (!result.ok) { excluded.push({ id: entry.id, reason: result.error }); return false }
  entry.durationSeconds = Math.round(result.duration)
  // The original fallback parser used the import timestamp when no publication date existed.
  if (entry.publishedAt?.startsWith(catalog.generatedAt.slice(0, 10))) entry.publishedAt = null
  entry.verification.browserCheckedAt = audit.checkedAt
  entry.verification.browserPlayback = true
  entry.verification.browserSeeking = true
  return true
})
catalog.audit.playableEpisodes = catalog.entries.length
catalog.audit.browserVerifiedEpisodes = catalog.entries.length
await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n')
await fs.writeFile(new URL('../reports/launch-exclusions.json', import.meta.url), JSON.stringify({ checkedAt: audit.checkedAt, excluded }, null, 2) + '\n')
console.log(`Launch catalog: ${catalog.entries.length} browser-verified episodes; ${excluded.length} excluded`)
