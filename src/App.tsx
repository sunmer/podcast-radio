import { AlertCircle, Download, ExternalLink, Info, Radio, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import './App.css'
import { Discover } from './Discover'
import { assetUrl } from './lib'
import { PlayerProvider } from './player'
import { RadioView } from './RadioView'
import type { Catalog } from './types'

type View = 'discover' | 'radio'

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('discover')
  const [showAbout, setShowAbout] = useState(false)
  const [, setSaved] = useState(() => new Set<string>())

  useEffect(() => {
    fetch(assetUrl('data/catalog.json'))
      .then((response) => { if (!response.ok) throw new Error(`Catalog request failed (${response.status})`); return response.json() as Promise<Catalog> })
      .then(setCatalog)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load the catalog'))
  }, [])

  if (error) return <main className="loading-state"><AlertCircle /><h1>Could not load Hacker Radio</h1><p>{error}</p></main>
  if (!catalog) return <main className="loading-state"><Radio className="pulse" /><h1>Finding the signal…</h1><p>Loading verified podcast recommendations.</p></main>
  if (!catalog.entries.length) return <main className="loading-state"><Radio /><h1>The catalog is empty</h1><p>The pipeline did not find any playable episodes. Check the import report for excluded links.</p></main>

  return <PlayerProvider episodes={catalog.entries}>
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={assetUrl('')} aria-label="Hacker Radio home"><span className="brand-mark"><Radio /></span><span>HACKER<br /><b>RADIO</b></span></a>
        <nav aria-label="Main navigation"><button type="button" className={view === 'discover' ? 'active' : ''} onClick={() => setView('discover')}><Search />Discover</button><button type="button" className={view === 'radio' ? 'active' : ''} onClick={() => setView('radio')}><Radio />Radio</button></nav>
        <div className="top-actions"><button type="button" className="text-button" onClick={() => setShowAbout(!showAbout)}><Info />About</button><a className="download-button" href={assetUrl('data/catalog.json')} download><Download />Data</a></div>
      </header>
      {showAbout && <aside className="about-banner"><Info /><p>Hacker Radio is a one-off proof of concept built from podcast episodes linked in public Hacker News comments. Audio plays directly from each publisher; nothing is rehosted. Audio and artwork were checked for launch. HN may rate-limit checks of the original comments.</p><button type="button" className="text-button" onClick={() => setShowAbout(false)}>Close</button></aside>}
      <main>{view === 'discover' ? <Discover episodes={catalog.entries} onSavedChange={setSaved} /> : <RadioView episodes={catalog.entries} />}</main>
      <footer><span>Built from public HN comments</span><span>{catalog.entries.length} verified episodes · Catalog {new Date(catalog.generatedAt).toLocaleDateString()}</span><a href="https://news.ycombinator.com" target="_blank" rel="noreferrer">Hacker News <ExternalLink /></a></footer>
    </div>
  </PlayerProvider>
}
