import { Bookmark, BookmarkCheck, Pause, Play, Radio, RotateCcw, SkipForward } from 'lucide-react'
import { useRef, useState } from 'react'
import { formatDate, formatDuration, recommendationDate } from './lib'
import { usePlayer } from './player'
import { savedStore } from './storage'
import type { Episode } from './types'

export function RadioView({ episodes }: { episodes: Episode[] }) {
  const player = usePlayer()
  const [saved, setSaved] = useState(() => savedStore.get())
  const touchStart = useRef(0)
  const fallbackStation = episodes[0] ?? null
  const station = player.mode === 'radio' ? player.active : fallbackStation
  const toggleSave = () => {
    if (!station) return
    const next = new Set(saved)
    if (next.has(station.id)) next.delete(station.id)
    else next.add(station.id)
    setSaved(next); savedStore.set(next)
  }
  if (!station) return <div className="empty-state"><Radio /><h2>No stations available</h2><p className="lede">The catalog import has not produced any playable episodes yet.</p></div>
  return <section className="radio-view" onTouchStart={(event) => { touchStart.current = event.changedTouches[0].clientX }} onTouchEnd={(event) => { if (Math.abs(event.changedTouches[0].clientX - touchStart.current) > 70) player.tune() }}>
    <div className="radio-stage">
      <div className="radio-image-wrap"><img className={`radio-art ${player.playing && player.mode === 'radio' ? 'is-live' : ''}`} src={station.artworkUrl} alt={`${station.showName} artwork`} /><span className="on-air">{player.playing && player.mode === 'radio' ? <><i /> ON AIR</> : 'STANDBY'}</span></div>
      <div className="radio-copy">
        <span className="eyebrow">{station.showName}</span>
        <h1>{station.title}</h1>
        <p>{station.description}</p>
        <div className="station-meta"><span>{formatDuration(station.durationSeconds)}</span><span>{station.publishedAt ? formatDate(station.publishedAt) : `Shared ${formatDate(recommendationDate(station))}`}</span>{station.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>
        <div className="radio-actions">
          <button type="button" className="radio-play" onClick={() => player.mode === 'radio' ? player.toggle() : player.playRadio()} aria-label={player.playing && player.mode === 'radio' ? 'Pause radio' : 'Play radio'}>{player.playing && player.mode === 'radio' ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
          <button type="button" className="tune-button" onClick={player.tune}><SkipForward /> Tune</button>
        </div>
        <div className="radio-secondary"><button type="button" onClick={() => player.playEpisode(station)}><RotateCcw /> Play from start</button><button type="button" onClick={toggleSave}>{saved.has(station.id) ? <BookmarkCheck /> : <Bookmark />}{saved.has(station.id) ? 'Saved' : 'Save'}</button></div>
      </div>
    </div>
    <div className="radio-strip"><span>RANDOMLY RECOMMENDED</span><span>NO ALGORITHM</span><span>HN COMMUNITY PICKS</span><span>STREAM DIRECT FROM PUBLISHERS</span></div>
  </section>
}
