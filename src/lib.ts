import type { Episode, Topic } from './types'

const TOPIC_HINTS: Record<Topic, RegExp> = {
  Technology: /ai|software|computer|startup|internet|tech|crypto|programming|robot|chip|data|security|open source/i,
  Science: /science|physics|biology|space|drug|research|climate|medicine|math/i,
  Business: /business|market|finance|invest|econom|money|company|trade|bank|capital/i,
  History: /history|historical|ancient|war|century|archive|past/i,
  Society: /society|culture|politics|policy|media|law|internet|community|social/i,
  Health: /health|fitness|sleep|mental|medical|doctor|diet|wellness/i,
  Arts: /art|music|film|design|writing|book|author|literature|creative/i,
  Other: /./,
}

export function inferTopic(text: string): Topic {
  const priority: Topic[] = ['Technology', 'Science', 'History', 'Business', 'Health', 'Arts', 'Society', 'Other']
  return priority.find((topic) => TOPIC_HINTS[topic].test(text)) ?? 'Other'
}

export function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function shortDescription(value: string): string {
  const clean = cleanText(value)
  if (!clean) return 'A recommended listen from the Hacker News community.'
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean]
  return sentences.slice(0, 2).join(' ').slice(0, 260).trim()
}

export function formatDuration(seconds: number): string {
  if (!seconds) return 'Length n/a'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${Math.max(1, minutes)}m`
}

export function formatDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date unknown'
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(value))
}

export function recommendationDate(episode: Episode): string {
  return [...episode.recommendations].map((item) => item.createdAt).sort().at(-1) ?? ''
}

export function episodeSearchText(episode: Episode): string {
  return [episode.title, episode.showName, episode.description, ...episode.topics].join(' ').toLowerCase()
}

export function chooseRadioStart(durationSeconds: number): number {
  const minimum = 3 * 60
  const halfway = Math.floor(durationSeconds / 2)
  if (halfway <= minimum) return Math.max(0, Math.floor(durationSeconds * 0.25))
  return Math.floor(minimum + Math.random() * (halfway - minimum))
}

export function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}
