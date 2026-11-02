import { Pause, Play, SkipForward, Volume2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chooseRadioStart, formatDuration, shuffle } from './lib'
import { affinityStore, playedStore, radioStore } from './storage'
import type { Episode } from './types'

type PlayerMode = 'episode' | 'radio'

interface PlayerContextValue {
  active: Episode | null
  mode: PlayerMode | null
  playing: boolean
  progress: number
  duration: number
  playEpisode: (episode: Episode, mode?: PlayerMode) => void
  playRadio: () => void
  tune: () => void
  toggle: () => void
  canTune: boolean
  error: string | null
}

export function createStaticNoise(ctx: AudioContext): AudioBufferSourceNode {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 5, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true
  return source
}

export function PlayerProvider({ children, episodes }: { children: ReactNode; episodes: Episode[] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const staticSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const staticGainRef = useRef<GainNode | null>(null)
  const transitionTimer = useRef<number | undefined>(undefined)
  const transitionStarted = useRef(0)
  const requestId = useRef(0)
  const failedStations = useRef(new Set<string>())
  const nextStationRef = useRef<() => void>(() => {})
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<Episode | null>(null)
  const [mode, setMode] = useState<PlayerMode | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [radioPlayed, setRadioPlayed] = useState(() => radioStore.get())
  const [radioQueue, setRadioQueue] = useState<Episode[]>([])
  const canTune = episodes.filter((episode) => episode.durationSeconds >= 600).length > 1

  useEffect(() => {
    if (audioRef.current) return
    audioRef.current = new Audio()
    audioRef.current.preload = 'metadata'
  }, [])

  const stopStatic = useCallback(() => {
    const source = staticSourceRef.current
    const gain = staticGainRef.current
    const ctx = audioContextRef.current
    staticSourceRef.current = null
    staticGainRef.current = null
    if (!source || !gain || !ctx) return
    gain.gain.cancelScheduledValues(ctx.currentTime)
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12)
    source.stop(ctx.currentTime + 0.13)
    source.onended = () => { source.disconnect(); gain.disconnect() }
  }, [])

  const beginStatic = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = 0
    audioContextRef.current ??= new AudioContext()
    const ctx = audioContextRef.current
    void ctx.resume().catch(() => {})
    const source = createStaticNoise(ctx)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.12)
    source.connect(gain).connect(ctx.destination)
    source.start()
    staticSourceRef.current = source
    staticGainRef.current = gain
  }, [])

  const remember = useCallback((episode: Episode, radio: boolean) => {
    const set = playedStore.get()
    set.add(episode.id)
    playedStore.set(set)
    episode.topics.forEach((topic) => affinityStore.add(topic))
    if (radio) {
      const next = new Set(radioPlayed).add(episode.id)
      setRadioPlayed(next)
      radioStore.set(next)
    }
  }, [radioPlayed])

  const playEpisode = useCallback((episode: Episode, requestedMode: PlayerMode = 'episode') => {
    const audio = audioRef.current
    if (!audio) return
    const id = ++requestId.current
    window.clearTimeout(transitionTimer.current)
    stopStatic()
    audio.pause()
    setError(null)
    setPlaying(false)
    transitionStarted.current = performance.now()
    if (requestedMode === 'radio') {
      try { beginStatic() } catch { /* Playback can continue without the static effect. */ }
    }
    setActive(episode)
    setMode(requestedMode)
    setProgress(0)
    setDuration(episode.durationSeconds)
    audio.src = episode.audioUrl
    audio.volume = requestedMode === 'radio' ? 0 : 1
    const startAt = requestedMode === 'radio' ? chooseRadioStart(episode.durationSeconds) : 0
    const fail = () => {
      if (id !== requestId.current) return
      ++requestId.current
      window.clearTimeout(transitionTimer.current)
      stopStatic()
      audio.pause()
      setPlaying(false)
      if (requestedMode === 'radio') {
        failedStations.current.add(episode.id)
        if (failedStations.current.size < Math.min(5, episodes.length)) {
          nextStationRef.current()
          return
        }
      }
      setError('This audio could not start. Try another episode or tune again.')
    }
    audio.onerror = fail
    audio.onloadedmetadata = () => {
      if (id !== requestId.current) return
      audio.currentTime = startAt
    }
    // Wait for actual decoded media at the requested position, not just a play event.
    const finishTransition = () => {
      if (id !== requestId.current || audio.readyState < 2 || audio.seeking) return
      if (startAt && audio.currentTime < startAt - 2) return
      window.clearTimeout(transitionTimer.current)
      const remaining = requestedMode === 'radio' ? Math.max(0, 1000 - (performance.now() - transitionStarted.current)) : 0
      transitionTimer.current = window.setTimeout(() => {
        if (id !== requestId.current) return
        stopStatic()
        audio.volume = 1
        failedStations.current.clear()
        audio.onplaying = null
        audio.onseeked = null
      }, remaining)
    }
    audio.onplaying = finishTransition
    audio.onseeked = finishTransition
    transitionTimer.current = window.setTimeout(fail, requestedMode === 'radio' ? 4000 : 15000)
    void audio.play().then(() => {
      if (id !== requestId.current) return
      setPlaying(true)
      remember(episode, requestedMode === 'radio')
      finishTransition()
    }).catch(fail)
  }, [beginStatic, remember, stopStatic, episodes.length])

  const buildQueue = useCallback(() => {
    const threshold = Math.max(1, Math.ceil(episodes.length * 0.8))
    let pool = episodes.filter((episode) => episode.durationSeconds >= 600 && !radioPlayed.has(episode.id))
    if (!pool.length || radioPlayed.size >= threshold) {
      pool = episodes.filter((episode) => episode.durationSeconds >= 600)
      setRadioPlayed(new Set())
      radioStore.set(new Set())
    }
    return shuffle(pool)
  }, [episodes, radioPlayed])

  const nextStation = useCallback(() => {
    const queue = radioQueue.some((episode) => episode.id !== active?.id && !failedStations.current.has(episode.id)) ? radioQueue : buildQueue()
    const next = queue.find((episode) => episode.id !== active?.id && !failedStations.current.has(episode.id))
    if (!next) {
      setError('No other station is available. Try playing an episode from Discover.')
      return
    }
    setRadioQueue(queue.filter((episode) => episode.id !== next.id))
    playEpisode(next, 'radio')
  }, [active?.id, buildQueue, playEpisode, radioQueue])
  useEffect(() => { nextStationRef.current = nextStation }, [nextStation])

  const playRadio = useCallback(() => { failedStations.current.clear(); nextStation() }, [nextStation])
  const tune = useCallback(() => {
    failedStations.current.clear()
    nextStation()
  }, [nextStation])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !active) return
    if (error) { failedStations.current.clear(); playEpisode(active, mode ?? 'episode') }
    else if (audio.paused) void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    else {
      window.clearTimeout(transitionTimer.current)
      stopStatic()
      audio.volume = 1
      audio.pause()
      setPlaying(false)
    }
  }, [active, stopStatic, error, mode, playEpisode])

  useEffect(() => {
    const next = radioQueue[0]
    if (!next) return
    const preload = new Audio()
    preload.preload = 'metadata'
    preload.src = next.audioUrl
    return () => { preload.removeAttribute('src'); preload.load() }
  }, [radioQueue])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => setProgress(audio.currentTime)
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : active?.durationSeconds ?? 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => mode === 'radio' ? nextStation() : setPlaying(false)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
  }, [active?.durationSeconds, mode, nextStation])

  useEffect(() => {
    if (!active || !('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: active.title,
      artist: active.showName,
      album: 'Hacker Radio',
      artwork: [{ src: active.artworkUrl, sizes: '512x512', type: 'image/jpeg' }],
    })
    navigator.mediaSession.setActionHandler('play', () => void audioRef.current?.play())
    navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause())
    navigator.mediaSession.setActionHandler('nexttrack', tune)
    return () => {
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
    }
  }, [active, tune])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      if (event.code === 'Space' && !['BUTTON', 'A'].includes(target.tagName)) {
        event.preventDefault()
        if (active) toggle()
        else playRadio()
      }
      if (event.code === 'ArrowRight' || event.key.toLowerCase() === 'n') { event.preventDefault(); tune() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, tune, active, playRadio])

  useEffect(() => () => {
    ++requestId.current
    window.clearTimeout(transitionTimer.current)
    stopStatic()
    audioRef.current?.pause()
  }, [stopStatic])

  const value = useMemo(() => ({ active, mode, playing, progress, duration, playEpisode, playRadio, tune, toggle, canTune, error }), [active, mode, playing, progress, duration, playEpisode, playRadio, tune, toggle, canTune, error])
  return <PlayerContext.Provider value={value}>{children}<PlayerBar /></PlayerContext.Provider>
}

import { createContext, useContext } from 'react'
const PlayerContext = createContext<PlayerContextValue | null>(null)
export function usePlayer() {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer must be used inside PlayerProvider')
  return value
}

function PlayerBar() {
  const { active, mode, playing, progress, duration, toggle, tune, canTune, error } = usePlayer()
  if (!active) return null
  return (
    <aside className="player-bar" aria-label="Now playing">
      <img src={active.artworkUrl} alt="" className="player-art" />
      <div className="player-copy">
        <span className="eyebrow">{mode === 'radio' ? 'ON AIR' : active.showName}</span>
        <strong>{active.title}</strong>
        <span>{formatDuration(duration || active.durationSeconds)}</span>
        {error && <span role="alert">{error}</span>}
      </div>
      <div className="player-progress"><span style={{ width: `${duration ? Math.min(100, progress / duration * 100) : 0}%` }} /></div>
      <button type="button" className="icon-button primary" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause /> : <Play />}
      </button>
      <button type="button" className="icon-button" onClick={tune} disabled={!canTune} aria-label="Tune to next station"><SkipForward /></button>
      <Volume2 className="volume-icon" aria-hidden="true" />
    </aside>
  )
}
