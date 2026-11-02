import { expect, test } from '@playwright/test'
import { createTuningSamples, nextTuningVariant, TUNING_VARIANTS } from '../src/tuning'

test('three distinct two-second effects are bounded, faded, and nonuniform', () => {
  const sampleRate = 44100
  const fingerprints = new Set<number>()
  for (let variant = 0; variant < TUNING_VARIANTS; variant += 1) {
    const samples = createTuningSamples(sampleRate, variant)
    expect(samples.length).toBe(sampleRate * 2)
    expect(Math.abs(samples[0])).toBe(0)
    expect(Math.abs(samples.at(-1)!)).toBe(0)
    fingerprints.add(samples[1000])
    expect(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 0.5)).toBe(true)
    const windows: number[] = []
    for (let start = 0; start < samples.length; start += sampleRate / 10) {
      let energy = 0
      for (const sample of samples.slice(start, start + sampleRate / 10)) {
        energy += sample * sample
      }
      windows.push(Math.sqrt(energy / (sampleRate / 10)))
    }
    expect(Math.max(...windows)).toBeGreaterThan(0.04)
    expect(Math.max(...windows) / Math.min(...windows)).toBeGreaterThan(1.5)
  }
  expect(fingerprints.size).toBe(3)
})

test('random tuning selection never immediately repeats a variant', () => {
  for (const random of [0, 0.49, 0.99]) {
    for (let previous = -1; previous < TUNING_VARIANTS; previous += 1) {
      const next = nextTuningVariant(previous, () => random)
      expect(next).toBeGreaterThanOrEqual(0)
      expect(next).toBeLessThan(TUNING_VARIANTS)
      expect(next).not.toBe(previous)
    }
  }
})
