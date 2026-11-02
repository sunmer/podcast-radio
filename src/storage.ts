import type { Topic } from './types'

const PREFIX = 'hacker-radio:v1:'
const read = <T>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(PREFIX + key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable in private browsing; playback still works.
  }
}

export const savedStore = {
  get: () => new Set(read<string[]>('saved', [])),
  set: (ids: Set<string>) => write('saved', [...ids]),
}

export const playedStore = {
  get: () => new Set(read<string[]>('played', [])),
  set: (ids: Set<string>) => write('played', [...ids]),
}

export const radioStore = {
  get: () => new Set(read<string[]>('radio-played', [])),
  set: (ids: Set<string>) => write('radio-played', [...ids]),
}

export const affinityStore = {
  get: () => read<Partial<Record<Topic, number>>>('affinity', {}),
  add: (topic: Topic, amount = 1) => {
    const current = read<Partial<Record<Topic, number>>>('affinity', {})
    current[topic] = (current[topic] ?? 0) + amount
    write('affinity', current)
  },
}
