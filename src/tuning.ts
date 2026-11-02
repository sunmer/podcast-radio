export const TUNING_SECONDS = 2
export const TUNING_VARIANTS = 3

// Original synthesized effects, not recordings or extracts from third-party libraries.
export function createTuningSamples(sampleRate: number, variant: number): Float32Array {
  const samples = new Float32Array(Math.round(sampleRate * TUNING_SECONDS))
  let seed = [74123, 19579, 82781][variant % TUNING_VARIANTS]
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const stations = Array.from({ length: 3 }, (_, index) => ({
    center: 0.25 + index * 0.57 + random() * 0.22,
    width: 0.055 + random() * 0.06,
    pitch: 180 + random() * 380,
  }))
  let low = 0
  let rumble = 0
  let crackle = 0
  let phase = 0
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate
    const white = random() * 2 - 1
    // A changing receiver bandwidth and brief squelch dips break up the flat hiss.
    const cutoff = 1400 + 3400 * (0.5 + 0.5 * Math.sin(time * (7 + variant) + variant))
    low += (1 - Math.exp(-2 * Math.PI * cutoff / sampleRate)) * (white - low)
    rumble += (1 - Math.exp(-2 * Math.PI * 180 / sampleRate)) * (low - rumble)
    let signal = 0
    let carrier = 0
    for (const station of stations) {
      const distance = (time - station.center) / station.width
      const envelope = Math.exp(-distance * distance * 0.5)
      signal += envelope
      carrier += envelope * Math.sin(2 * Math.PI * (station.pitch * time + 90 * distance * time))
    }
    const flutter = 0.75 + 0.25 * Math.sin(time * 31 + Math.sin(time * 13))
    const hiss = (low - rumble) * (0.85 - 0.72 * Math.min(1, signal)) * flutter
    if (random() < 26 / sampleRate) crackle = (random() * 2 - 1) * 0.6
    crackle *= Math.exp(-1 / (sampleRate * 0.0018))
    phase += 2 * Math.PI * (700 + 480 * Math.sin(time * 4 + variant)) / sampleRate
    const whistle = Math.sin(phase) * Math.pow(Math.max(0, Math.sin(time * 8 + variant)), 14) * 0.045
    const fade = Math.min(1, time / 0.025, (samples.length - 1 - index) / (sampleRate * 0.035))
    samples[index] = Math.tanh(hiss * 1.7 + crackle + carrier * 0.075 + whistle) * fade * 0.5
  }
  return samples
}

export function nextTuningVariant(previous: number, random = Math.random): number {
  if (previous < 0) return Math.floor(random() * TUNING_VARIANTS)
  return (previous + 1 + Math.floor(random() * (TUNING_VARIANTS - 1))) % TUNING_VARIANTS
}

const buffers = new WeakMap<BaseAudioContext, AudioBuffer[]>()

export function createTuningSource(ctx: AudioContext, variant: number): AudioBufferSourceNode {
  let bank = buffers.get(ctx)
  if (!bank) {
    bank = Array.from({ length: TUNING_VARIANTS }, (_, index) => {
      const samples = createTuningSamples(ctx.sampleRate, index)
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
      buffer.getChannelData(0).set(samples)
      return buffer
    })
    buffers.set(ctx, bank)
  }
  const source = ctx.createBufferSource()
  source.buffer = bank[variant]
  source.loop = true
  return source
}
