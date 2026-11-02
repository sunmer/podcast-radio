import { Bookmark, BookmarkCheck, ExternalLink, MessageSquare, Play, Radio, Search, Shuffle, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { episodeSearchText, formatDate, formatDuration, recommendationDate, shuffle } from './lib'
import { usePlayer } from './player'
import { type Episode, TOPICS, type Topic } from './types'

type LengthFilter = 'any' | 'short' | 'medium' | 'long'
type Sort = 'recommended' | 'newest' | 'shuffle'

interface Props {
  episodes: Episode[]
  saved: Set<string>
  onSavedChange: (ids: Set<string>) => void
}

export function Discover({ episodes, saved, onSavedChange }: Props) {
  const player = usePlayer()
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState<Topic | 'All'>('All')
  const [length, setLength] = useState<LengthFilter>('any')
  const [sort, setSort] = useState<Sort>('recommended')
  const [savedOnly, setSavedOnly] = useState(false)
  const [expandedRecommendations, setExpandedRecommendations] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let list = episodes.filter((episode) => {
      if (query && !episodeSearchText(episode).includes(query.toLowerCase())) return false
      if (topic !== 'All' && !episode.topics.includes(topic)) return false
      if (savedOnly && !saved.has(episode.id)) return false
      if (length === 'short' && episode.durationSeconds >= 1800) return false
      if (length === 'medium' && (episode.durationSeconds < 1800 || episode.durationSeconds > 5400)) return false
      if (length === 'long' && episode.durationSeconds <= 5400) return false
      return true
    })
    if (sort === 'recommended') list = list.sort((a, b) => b.recommendationCount - a.recommendationCount)
    if (sort === 'newest') list = list.sort((a, b) => +new Date(recommendationDate(b)) - +new Date(recommendationDate(a)))
    if (sort === 'shuffle') list = shuffle(list)
    return list
  }, [episodes, query, topic, length, sort, savedOnly, saved])

  const toggleSave = (episode: Episode) => {
    const next = new Set(saved)
    if (next.has(episode.id)) next.delete(episode.id)
    else next.add(episode.id)
    onSavedChange(next)
  }

  return (
    <section className="discover-view" id="discover" aria-labelledby="discover-title">
      <header className="discover-hero">
        <div>
          <span className="eyebrow"><Radio /> HN PODCAST INDEX</span>
          <h2 id="discover-title">Discover</h2>
          <p>{episodes.length} episodes recommended by real people, checked for this POC.</p>
        </div>
        <div className="hero-stat"><strong>{episodes.reduce((sum, item) => sum + item.recommendationCount, 0)}</strong><span>HN recommendations</span></div>
      </header>

      <div className="toolbar">
        <label className="search-field"><Search aria-hidden="true" /><span className="sr-only">Search episodes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search episodes, shows, topics" /></label>
        <button type="button" aria-pressed={savedOnly} className={`filter-button ${savedOnly ? 'active' : ''}`} onClick={() => setSavedOnly(!savedOnly)}><Bookmark size={16} /> Saved</button>
        <label className="select-field"><SlidersHorizontal size={16} aria-hidden="true" /><span className="sr-only">Length</span><select value={length} onChange={(event) => setLength(event.target.value as LengthFilter)}><option value="any">Any length</option><option value="short">Under 30 min</option><option value="medium">30–90 min</option><option value="long">Over 90 min</option></select></label>
        <label className="select-field"><span className="sr-only">Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="recommended">Most recommended</option><option value="newest">Recently shared</option><option value="shuffle">Shuffle</option></select></label>
      </div>
      <div className="topic-row" role="group" aria-label="Filter by topic">
        <button type="button" className={`topic-chip ${topic === 'All' ? 'active' : ''}`} onClick={() => setTopic('All')}>All topics</button>
        {TOPICS.map((item) => <button type="button" key={item} className={`topic-chip ${topic === item ? 'active' : ''}`} onClick={() => setTopic(item)}>{item}</button>)}
      </div>

      <section>
        <div className="section-heading"><h2>{savedOnly ? 'Saved episodes' : query ? `Results for “${query}”` : 'All recommended episodes'}</h2><span>{filtered.length} episodes</span></div>
        {filtered.length === 0 ? <div className="empty-state"><Shuffle /><h3>No episodes found</h3><p>Try a different search or filter.</p></div> : <div className="episode-grid">{filtered.map((episode) => <EpisodeCard key={episode.id} episode={episode} saved={saved.has(episode.id)} onSave={toggleSave} onPlay={() => player.playEpisode(episode)} expanded={expandedRecommendations === episode.id} onToggleRecommendations={() => setExpandedRecommendations(expandedRecommendations === episode.id ? null : episode.id)} />)}</div>}
      </section>
    </section>
  )
}

interface CardProps {
  episode: Episode
  saved: boolean
  onSave: (episode: Episode) => void
  onPlay: () => void
  expanded: boolean
  onToggleRecommendations: () => void
}

function EpisodeCard({ episode, saved, onSave, onPlay, expanded, onToggleRecommendations }: CardProps) {
  return <article className={`episode-card ${expanded ? 'expanded' : ''}`}>
    <div className="artwork-wrap"><img src={episode.artworkUrl} alt={`${episode.showName} artwork`} loading="lazy" /><button type="button" className="play-overlay" onClick={onPlay} aria-label={`Play ${episode.title}`}><Play fill="currentColor" /></button></div>
    <div className="card-body"><div className="card-kicker"><span>{episode.showName}</span><span>{episode.publishedAt ? formatDate(episode.publishedAt) : `Shared ${formatDate(recommendationDate(episode))}`}</span></div><h3>{episode.title}</h3><p>{episode.description}</p><div className="card-meta"><span>{formatDuration(episode.durationSeconds)}</span>{episode.topics.slice(0, 2).map((item) => <span key={item}>{item}</span>)}</div><div className="card-actions"><button type="button" className="recommendation-count" onClick={onToggleRecommendations}><MessageSquare size={15} />{episode.recommendationCount} HN {episode.recommendationCount === 1 ? 'mention' : 'mentions'}</button><button type="button" className="icon-button" onClick={() => onSave(episode)} aria-label={saved ? 'Remove from saved' : 'Save episode'}>{saved ? <BookmarkCheck /> : <Bookmark />}</button></div>{expanded && <div className="recommendations">{episode.recommendations.map((recommendation) => <div key={recommendation.commentId}><span>{recommendation.storyTitle}</span><p>{recommendation.excerpt}</p><a href={recommendation.commentUrl} target="_blank" rel="noreferrer">HN comment <ExternalLink size={13} /></a></div>)}</div>}</div>
  </article>
}
