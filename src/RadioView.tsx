import { Bookmark, BookmarkCheck, ExternalLink, MessageSquare, Pause, Play, Radio, RotateCcw, SkipForward } from 'lucide-react'
import { useRef } from 'react'
import { formatDate, formatDuration, recommendationDate } from './lib'
import { usePlayer } from './player'
import type { Episode } from './types'

export function RadioView({ episodes, saved, onSavedChange }: { episodes: Episode[]; saved: Set<string>; onSavedChange: (ids: Set<string>) => void }) {
  const player = usePlayer()
  const touchStart = useRef(0)
  const station = player.active ?? player.initialEpisode
  const toggleSave = () => {
    if (!station) return
    const next = new Set(saved)
    if (next.has(station.id)) next.delete(station.id)
    else next.add(station.id)
    onSavedChange(next)
  }
  if (!station) return <div className="empty-state"><Radio /><h2>No stations available</h2><p className="lede">The catalog import has not produced any playable episodes yet.</p></div>
  return <section id="radio" aria-labelledby="radio-title" className="radio-view" data-episode-id={station.id} onTouchStart={(event) => { touchStart.current = event.changedTouches[0].clientX }} onTouchEnd={(event) => { if (Math.abs(event.changedTouches[0].clientX - touchStart.current) > 70) player.tune() }}>
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
          <button type="button" className="tune-button" onClick={player.tune} disabled={!player.canTune}><SkipForward /> Next</button>
        </div>
        <div className="radio-secondary"><button type="button" onClick={() => player.playEpisode(station)}><RotateCcw /> Play from start</button><button type="button" onClick={toggleSave} aria-label={saved.has(station.id) ? 'Unsave current episode' : 'Save current episode'} aria-pressed={saved.has(station.id)}>{saved.has(station.id) ? <BookmarkCheck /> : <Bookmark />}{saved.has(station.id) ? 'Saved' : 'Save'}</button></div>
      </div>
    </div>
    <aside className="radio-context" aria-label="Hacker News comment context" key={station.id}>
      <h3><MessageSquare size={16} /> From Hacker News</h3>
      {station.recommendations.length ? station.recommendations.map((comment, index) => {
        const context = <div className="radio-comment">
          <div className="comment-byline"><span>{comment.author}</span><span>{formatDate(comment.createdAt)}</span></div>
          <a className="comment-thread" href={comment.storyUrl} target="_blank" rel="noreferrer">{comment.storyTitle}<ExternalLink size={13} /></a>
          <blockquote>{comment.excerpt}</blockquote>
          <a className="comment-source" href={comment.commentUrl} target="_blank" rel="noreferrer">Read original comment <ExternalLink size={13} /></a>
        </div>
        return index === 0 ? <div key={comment.commentId}>{context}</div> : <details key={comment.commentId}><summary>Also shared by {comment.author}</summary>{context}</details>
      }) : <p>No comment context is available for this episode.</p>}
    </aside>
  </section>
}
