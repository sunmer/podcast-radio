import { Bookmark, BookmarkCheck, Pause, Play, Radio, RotateCcw, SkipForward } from 'lucide-react'
import { useRef } from 'react'
import { formatDate, formatDuration, recommendationDate } from './lib'
import { usePlayer } from './player'
import type { Episode } from './types'

export function RadioView({ episodes, saved, onSavedChange }: { episodes: Episode[]; saved: Set<string>; onSavedChange: (ids: Set<string>) => void }) {
  const player = usePlayer()
  const touchStart = useRef(0)
  const fallbackStation = episodes[0] ?? null
  const station = player.active ?? fallbackStation
  const toggleSave = () => {
    if (!station) return
    const next = new Set(saved)
    if (next.has(station.id)) next.delete(station.id)
    else next.add(station.id)
    onSavedChange(next)
  }
  if (!station) return <div className="empty-state"><Radio /><h2>No stations available</h2><p className="lede">The catalog import has not produced any playable episodes yet.</p></div>
  return <section id="radio" aria-labelledby="radio-title" className="radio-view" onTouchStart={(event) => { touchStart.current = event.changedTouches[0].clientX }} onTouchEnd={(event) => { if (Math.abs(event.changedTouches[0].clientX - touchStart.current) > 70) player.tune() }}>
    <header className="radio-heading"><h1 id="radio-title">Hacker Radio</h1><span className="eyebrow">{episodes.length} community picks</span></header>
    <div className="radio-stage">
      <div className="radio-image-wrap"><img className={`radio-art ${player.playing && !player.tuning ? 'is-live' : ''}`} src={station.artworkUrl} alt={`${station.showName} artwork`} /><span className="on-air" role="status">{player.tuning ? 'TUNING' : player.playing ? <><i /> ON AIR</> : 'STANDBY'}</span></div>
      <div className="radio-copy">
        <span className="eyebrow">{station.showName}</span>
        <h2 className="station-title">{station.title}</h2>
        <p>{station.description}</p>
        <div className="station-meta"><span>{formatDuration(station.durationSeconds)}</span><span>{station.publishedAt ? formatDate(station.publishedAt) : `Shared ${formatDate(recommendationDate(station))}`}</span>{station.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>
        <div className="radio-actions">
          <button type="button" className="radio-play" onClick={() => player.active ? player.toggle() : player.playRadio()} aria-label={player.playing ? 'Pause radio' : 'Play radio'}>{player.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
          <button type="button" className="tune-button" onClick={player.tune}><SkipForward /> Tune</button>
        </div>
        <div className="radio-secondary"><button type="button" onClick={() => player.playEpisode(station)}><RotateCcw /> Play from start</button><button type="button" onClick={toggleSave} aria-label={saved.has(station.id) ? 'Unsave current episode' : 'Save current episode'} aria-pressed={saved.has(station.id)}>{saved.has(station.id) ? <BookmarkCheck /> : <Bookmark />}{saved.has(station.id) ? 'Saved' : 'Save'}</button></div>
      </div>
    </div>
  </section>
}
