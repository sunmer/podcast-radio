import fs from 'node:fs/promises'
const catalog = JSON.parse(await fs.readFile(new URL('../public/data/catalog.json', import.meta.url), 'utf8'))
const required = ['id', 'showName', 'title', 'description', 'audioUrl', 'artworkUrl']
const errors = []
const ids = new Set()
for (const entry of catalog.entries) {
  for (const key of required) if (!entry[key]) errors.push(`${entry.id || 'unknown'}: missing ${key}`)
  if (ids.has(entry.id)) errors.push(`duplicate id: ${entry.id}`)
  ids.add(entry.id)
  if (!Array.isArray(entry.topics) || entry.topics.length === 0) errors.push(`${entry.id}: missing topic`)
  if (!entry.verification || entry.verification.status !== 'playable') errors.push(`${entry.id}: unverified`)
  if (!Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0) errors.push(`${entry.id}: missing duration`)
  if (!entry.verification?.browserPlayback || !entry.verification?.browserSeeking) errors.push(`${entry.id}: missing browser playback/seek verification`)
}
if (!catalog.entries.length) errors.push('launch gate: catalog is empty')
if (catalog.entries.filter((entry) => entry.durationSeconds >= 600).length < 2) errors.push('launch gate: radio needs at least two eligible episodes')
console.log(`${catalog.entries.length} episodes checked`)
if (errors.length) { console.error(errors.slice(0, 30).join('\n')); process.exit(1) }
