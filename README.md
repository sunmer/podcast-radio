# Hacker Radio

A one-off proof of concept that turns podcast episodes recommended in Hacker News comments into a browsable catalog and a random radio player.

**Live site:** https://sunmer.github.io/podcast-radio/

## What is included

- One radio-first page with Discover directly below, section navigation, and shared playback and saves.
- Discover with one "All recommended episodes" catalog, search, topic and length filters, sorting, saves, and play history.
- A random initial radio pick (avoiding the previous initial pick in the same tab), with Play starting the displayed episode and Next advancing it.
- Current episode context with HN author, discussion title, comment excerpt, and links to the original comment and discussion.
- Radio with three original two-second synthesized tuning variants, mid-episode starts, keyboard controls, Media Session hooks, and automatic station changes.
- 104 podcast episodes with direct publisher audio links and provenance links back to the HN comments that linked them.
- A JSON catalog download at `data/catalog.json`, relative to the site.
- A one-off Python import pipeline and explicit link-audit tooling.

Audio is streamed directly from podcast publishers. Nothing is copied or rehosted.

The tuning effects in `src/tuning.ts` mix bandwidth-changing hiss, crackles, carrier sweeps, and squelch dips. Variants are cached in memory, chosen randomly without immediate repeats, and faded when playback begins (two-second minimum, four-second loading timeout). These are original synthesized effects, not clips from the suggested Soundsnap recording. Using that recording requires a licensed original and confirmation of the appropriate distribution terms before placing assets in a public repository.

## Development

```bash
npm install
npm run dev
npm run build
npm run test:e2e
npm run test:links
npm run test:media # Requires a running local preview or SITE_URL.
```

The catalog refresh is intentionally manual. There is no schedule; recurring scans can be added later if the POC sees real use.

## Catalog

`public/data/catalog.json` is the source the deployed client reads. The import report and launch audits live under `reports/`. Audio and artwork are checked separately from HN pages, where rate limiting is reported as inconclusive, not as a successful check. The browser media audit tests decoding, playback, and seeking for every entry.

The importer scans public HN search results for podcast-platform and direct-audio links, resolves Apple episode pages and podcast-platform metadata, verifies audio bytes and byte-range support, and drops signed or expiring asset URLs.

```bash
uv run python -m pipeline --max-pages 20
```

Podcast Index credentials and `OPENROUTER_API_KEY` are optional for future enrichment and are never required by the deployed site.

## POC limitations

The import uses public HN search results rather than the complete historical dataset. Full AI recommendation screening and rewritten descriptions are not complete; deterministic descriptions and tags are retained. Catalog presence is not proof that every comment is an endorsement. Publication dates are unavailable for this import; the UI labels the HN sharing date instead. Spotify-only, paid, show-level, and expiring audio links are excluded. Publisher availability can change after the launch audit. Native iPhone lock-screen behavior still needs a real-device test.

## Publishing

GitHub Pages serves the committed `docs/` directory on `main`; no Actions workflow or scheduled scan is needed. To rebuild it:

```bash
GITHUB_ACTIONS=true npm run build -- --outDir docs
```

To test the deployed site:

```bash
SITE_URL=https://sunmer.github.io/podcast-radio/ npm run test:e2e
SITE_URL=https://sunmer.github.io/podcast-radio/ npm run test:media
```
