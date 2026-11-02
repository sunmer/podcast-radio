import fs from 'node:fs/promises'

const catalog = JSON.parse(await fs.readFile(new URL('../public/data/catalog.json', import.meta.url), 'utf8'))
const failures = []
const inconclusive = []
const seen = new Set()
let checks = 0

async function request(url, kind) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Range: 'bytes=0-1023', 'User-Agent': 'HackerRadioPOC/1.0 (link audit)' },
      signal: controller.signal,
    })
    const type = response.headers.get('content-type') ?? ''
    const hnThrottled = kind === 'recommendation' && url.includes('news.ycombinator.com') && (response.status === 429 || response.status === 403)
    if (hnThrottled) {
      inconclusive.push({ kind, url, status: response.status, reason: 'HN rate limiting or access restriction' })
      await response.body?.cancel()
      return
    }
    const allowed = kind === 'artwork' ? type.startsWith('image/') : kind === 'audio' ? /audio\/|octet-stream|video\/mp4/.test(type) : /text\/html/.test(type)
    const ok = response.ok && allowed
    if (!ok) failures.push({ kind, url, status: response.status, type })
    await response.body?.cancel()
  } catch (error) {
    failures.push({ kind, url, error: error instanceof Error ? error.name + ': ' + error.message : String(error) })
  } finally {
    clearTimeout(timer)
    checks += 1
    if (checks % 25 === 0) console.log(`Checked ${checks}/${seen.size} links; ${failures.length} failed`)
  }
}

const tasks = []
for (const entry of catalog.entries) {
  tasks.push([entry.audioUrl, 'audio'])
  tasks.push([entry.artworkUrl, 'artwork'])
  for (const recommendation of entry.recommendations) tasks.push([recommendation.commentUrl, 'recommendation'])
}
const unique = [...new Map(tasks.filter(([url]) => url).map(([url, kind]) => [url, kind])).entries()]
for (const [url] of unique) seen.add(url)
console.log(`Auditing ${unique.length} unique links`)
const concurrency = 6
for (let index = 0; index < unique.length; index += concurrency) {
  await Promise.all(unique.slice(index, index + concurrency).map(([url, kind]) => request(url, kind)))
}

await fs.mkdir(new URL('../reports/', import.meta.url), { recursive: true })
await fs.writeFile(new URL('../reports/link-audit.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), checks, failures, inconclusive }, null, 2) + '\n')
console.log(`Checked ${checks} unique links; ${failures.length} failed; ${inconclusive.length} inconclusive`)
if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 20), null, 2))
  process.exit(1)
}
