from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

UA = "HackerRadioPOC/1.0 (contact: nima@autorank.ai)"
HN_SEARCH = "https://hn.algolia.com/api/v1/search_by_date"
TOPICS = ["Technology", "Science", "Business", "History", "Society", "Health", "Arts", "Other"]
TOPIC_RULES = {
    "Technology": re.compile(r"\b(ai|software|computer|startup|internet|tech|crypto|programming|robot|chip|data|security|open source|semiconductor)\b", re.I),
    "Science": re.compile(r"\b(science|physics|biology|space|drug|research|climate|medicine|math|scientist)\b", re.I),
    "Business": re.compile(r"\b(business|market|finance|invest|econom|money|company|trade|bank|capital|stock)\b", re.I),
    "History": re.compile(r"\b(history|historical|ancient|war|century|archive|past)\b", re.I),
    "Society": re.compile(r"\b(society|culture|politics|policy|media|law|community|social|government)\b", re.I),
    "Health": re.compile(r"\b(health|fitness|sleep|mental|medical|doctor|diet|wellness)\b", re.I),
    "Arts": re.compile(r"\b(art|music|film|design|writing|book|author|literature|creative)\b", re.I),
}
SOURCE_QUERIES = [
    "podcasts.apple.com",
    "overcast.fm",
    "pca.st",
    "pocketcasts.com",
    "traffic.megaphone.fm",
    "omny.fm",
    "podcast episode",
]
URL_RE = re.compile(r"https?://[^\s<>\"']+", re.I)
APPLE_EPISODE_RE = re.compile(r"podcasts\.apple\.com/(?P<country>[a-z]{2})/podcast/(?:[^/]+/)?id(?P<show>\d+)\?[^#\s]*\bi=(?P<episode>\d+)", re.I)
APPLE_PATH_EPISODE_RE = re.compile(r"podcasts\.apple\.com/(?P<country>[a-z]{2})/podcast/[^/]+/id(?P<show>\d+)\?i=(?P<episode>\d+)", re.I)
AUDIO_RE = re.compile(r"https?://[^\"'\s<>]+(?:\.mp3|\.m4a|\.aac)(?:\?[^\"'\s<>]*)?", re.I)
AUDIO_SIGNATURES = ((b"ID3", "mp3"), (b"\xff\xfb", "mp3"), (b"\xff\xf3", "mp3"), (b"ftyp", "m4a"), (b"ADTS", "aac"))


@dataclass
class Recommendation:
    commentId: str
    commentUrl: str
    storyId: str
    storyTitle: str
    storyUrl: str
    author: str
    createdAt: str
    excerpt: str
    originalUrl: str


@dataclass
class Verification:
    checkedAt: str
    status: str
    httpStatus: int
    contentType: str
    acceptsByteRanges: bool
    finalUrl: str
    signature: str


@dataclass
class Episode:
    id: str
    showName: str
    title: str
    description: str
    topics: list[str]
    durationSeconds: int
    publishedAt: str | None
    artworkUrl: str
    audioUrl: str
    feedUrl: str | None
    sourceUrl: str
    recommendations: list[Recommendation]
    recommendationCount: int
    verification: Verification


@dataclass
class Audit:
    discoveredComments: int = 0
    resolvedEpisodes: int = 0
    playableEpisodes: int = 0
    rejected: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    linkChecks: dict[str, int] = field(default_factory=lambda: {"artwork": 0, "audio": 0, "recommendations": 0, "failed": 0})


def clean_html(value: str) -> str:
    soup = BeautifulSoup(unescape(value or ""), "html.parser")
    return re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()


def clean_url(raw: str) -> str:
    value = unescape(raw).strip().replace("&#x2F;", "/").replace("&#38;", "&")
    return value.rstrip(".,;:!?)]}")


def links_in_comment(text: str) -> list[str]:
    normalized = unescape(text or "").replace("&#x2F;", "/").replace("&#47;", "/")
    return list(dict.fromkeys(clean_url(match.group(0)) for match in URL_RE.finditer(normalized)))


def is_candidate_link(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.netloc.lower().removeprefix("www.")
    if "spotify.com" in host:
        return False
    if host in {"podcasts.apple.com", "itunes.apple.com"}:
        return bool(re.search(r"[?&]i=\d+", parsed.query))
    if host == "overcast.fm":
        return parsed.path.startswith("/+") or "/episode" in parsed.path
    if host in {"pca.st", "pocketcasts.com"}:
        return "/episode/" in parsed.path
    if host.endswith("omny.fm") or host.endswith("megaphone.fm"):
        return True
    if parsed.path.lower().endswith((".mp3", ".m4a", ".aac")):
        return True
    if parsed.path.lower().endswith((".rss", ".xml")) or "rss" in parsed.path.lower() or "feed" in host:
        return True
    return False


def topic_for(*values: str) -> str:
    text = " ".join(values)
    for topic in ["Technology", "Science", "History", "Business", "Health", "Arts", "Society"]:
        if TOPIC_RULES[topic].search(text):
            return topic
    return "Other"


def short_description(value: str, title: str) -> str:
    text = clean_html(value)
    if not text:
        return f"A conversation recommended by the Hacker News community: {title}."
    text = re.sub(r"(?i)(advertising inquiries|privacy|opt-out|sponsor).*$", "", text).strip()
    sentences = re.split(r"(?<=[.!?])\s+", text)
    result = " ".join(sentences[:2]).strip()
    return result[:260].rstrip()


def parse_duration(value: Any) -> int:
    if isinstance(value, (int, float)) and value > 0:
        return int(value if value < 100000 else value / 1000)
    if isinstance(value, str):
        iso = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", value)
        if iso:
            h, m, s = (int(part or 0) for part in iso.groups())
            return h * 3600 + m * 60 + s
        if value.isdigit():
            return int(value)
    return 0


def parse_apple_episode(html: str, source_url: str) -> dict[str, Any] | None:
    soup = BeautifulSoup(html, "html.parser")
    schema = soup.find("script", {"id": "schema:episode"})
    data: dict[str, Any] = {}
    if schema:
        try:
            data = json.loads(schema.string or "{}")
        except json.JSONDecodeError:
            data = {}
    serialized = soup.find("script", {"id": "serialized-server-data"})
    server_text = serialized.string if serialized else ""
    def first(pattern: str) -> str:
        match = re.search(pattern, server_text)
        return json.loads(f'"{match.group(1)}"') if match else ""
    title = data.get("name") or first(r'"title":"((?:\\.|[^"\\])*)"') or soup.title.string or ""
    show = ((data.get("partOfSeries") or {}).get("name")) or first(r'"showTitle":"((?:\\.|[^"\\])*)"')
    audio = first(r'"streamUrl":"((?:\\.|[^"\\])*)"')
    if not audio:
        match = AUDIO_RE.search(server_text)
        audio = match.group(0) if match else ""
    duration = parse_duration(data.get("duration")) or parse_duration(first(r'"duration":(\d+)'))
    artwork = data.get("thumbnailUrl") or first(r'"(?:episodeArtwork|artwork)":\{"template":"((?:\\.|[^"\\])*)"')
    artwork = artwork.replace("{w}", "1200").replace("{h}", "1200").replace("{f}", "jpg") if artwork else ""
    feed = first(r'"feedUrl":"((?:\\.|[^"\\])*)"')
    description = data.get("description") or first(r'"summary":"((?:\\.|[^"\\])*)"')
    published = data.get("datePublished") or first(r'"releaseDate":"((?:\\.|[^"\\])*)"')
    if not title or not audio or not show:
        return None
    if not published:
        published = None
    return {"title": clean_html(title), "showName": clean_html(show), "audioUrl": clean_url(unescape(audio)), "durationSeconds": duration, "artworkUrl": unescape(artwork), "feedUrl": unescape(feed) or None, "description": clean_html(description), "publishedAt": published, "sourceUrl": source_url}


def parse_meta_page(html: str, source_url: str) -> dict[str, Any] | None:
    soup = BeautifulSoup(html, "html.parser")
    def meta(prop: str) -> str:
        tag = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
        return tag.get("content", "").strip() if tag else ""
    title = meta("og:title")
    description = meta("og:description")
    artwork = meta("og:image")
    audio_match = AUDIO_RE.search(html)
    audio = clean_url(html[audio_match.start():audio_match.end()].replace("\\u0026", "&").replace("\\/", "/")) if audio_match else ""
    if not title:
        return None
    show = meta("og:site_name") or source_url.split("/")[2]
    if show.lower().replace("www.", "") in {"overcast.fm", "omny.fm", "megaphone.fm", "pca.st", "pocketcasts.com"}:
        show = ""
    parsed = urlparse(source_url)
    if "pocketcasts.com" in parsed.netloc:
        jsonld = soup.find("script", {"type": "application/ld+json"})
        if jsonld:
            try:
                payload = json.loads(jsonld.string or "{}")
                if isinstance(payload, dict):
                    show = (payload.get("partOfSeries") or {}).get("name") or payload.get("partOfSeries", {}).get("name") or show
            except json.JSONDecodeError:
                pass
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) > 1 and parts[0] == "podcast" and show in {parsed.netloc, "Pocket Casts"}:
            show = parts[1].replace("-", " ").title()
    if not audio:
        return None
    if not show and " — " in title:
        title, show = title.rsplit(" — ", 1)
    if not show and " - " in title:
        show = title.rsplit(" - ", 1)[-1].strip()
    if not show:
        show = "Podcast"
    return {"title": clean_html(title), "showName": clean_html(show), "audioUrl": audio, "durationSeconds": 0, "artworkUrl": artwork, "feedUrl": None, "description": clean_html(description), "publishedAt": None, "sourceUrl": source_url}


async def verify_audio(client: httpx.AsyncClient, url: str) -> Verification | None:
    headers = {"Range": "bytes=0-2047", "User-Agent": UA, "Accept": "audio/*,*/*;q=0.8"}
    try:
        response = await client.get(url, headers=headers, follow_redirects=True, timeout=25)
    except httpx.HTTPError:
        return None
    content_type = response.headers.get("content-type", "").lower()
    body = response.content[:2048]
    signature = ""
    for prefix, kind in AUDIO_SIGNATURES:
        if body.startswith(prefix) or (kind == "m4a" and body[4:8] == b"ftyp"):
            signature = kind
            break
    if not re.match(r"audio/|application/octet-stream|video/mp4", content_type) or not signature or response.status_code not in (200, 206):
        return None
    return Verification(datetime.now(timezone.utc).isoformat(), "playable", response.status_code, content_type, "bytes" in response.headers.get("accept-ranges", "").lower() or response.status_code == 206, str(response.url), signature)


async def search_comments(client: httpx.AsyncClient, query: str, max_pages: int = 20) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for page in range(max_pages):
        params = {"query": query, "tags": "comment", "hitsPerPage": 1000, "page": page}
        response = await client.get(HN_SEARCH, params=params, headers={"User-Agent": UA}, timeout=30)
        response.raise_for_status()
        payload = response.json()
        hits.extend(payload.get("hits", []))
        if page + 1 >= payload.get("nbPages", 0) or payload.get("nbPages", 0) <= 1:
            break
    return hits


async def discover(client: httpx.AsyncClient, max_pages: int) -> tuple[list[dict[str, Any]], int]:
    hits_by_id: dict[str, dict[str, Any]] = {}
    for query in SOURCE_QUERIES:
        for hit in await search_comments(client, query, max_pages=max_pages):
            hits_by_id[str(hit.get("objectID"))] = hit
    comments = []
    for item in hits_by_id.values():
        urls = [url for url in links_in_comment(str(item.get("comment_text", ""))) if is_candidate_link(url)]
        if urls:
            comments.append({"id": str(item["objectID"]), "storyId": str(item.get("story_id", "")), "storyTitle": unescape(item.get("story_title") or "Hacker News discussion"), "author": item.get("author") or "HN user", "createdAt": item.get("created_at") or "", "text": clean_html(item.get("comment_text", "")), "urls": urls})
    return comments, len(hits_by_id)


async def resolve_url(client: httpx.AsyncClient, url: str, audit: Audit) -> dict[str, Any] | None:
    apple = APPLE_EPISODE_RE.search(url) or APPLE_PATH_EPISODE_RE.search(url)
    candidate_url = url
    if apple:
        country, show_id, episode_id = apple.group("country"), apple.group("show"), apple.group("episode")
        candidate_url = f"https://podcasts.apple.com/{country}/podcast/id{show_id}?i={episode_id}"
    try:
        response = await client.get(candidate_url, headers={"User-Agent": f"Mozilla/5.0 {UA}"}, follow_redirects=True, timeout=30)
    except httpx.HTTPError:
        audit.rejected["page_request_failed"] += 1
        return None
    if response.status_code >= 400 or "text/html" not in response.headers.get("content-type", ""):
        audit.rejected["page_not_html_or_error"] += 1
        return None
    parsed = parse_apple_episode(response.text, url) if "podcasts.apple.com" in response.url.host else parse_meta_page(response.text, url)
    if not parsed:
        audit.rejected["metadata_missing"] += 1
        return None
    return parsed


async def build_catalog(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    audit = Audit()
    async with httpx.AsyncClient(http2=True) as client:
        comments, search_hits = await discover(client, args.max_pages)
        audit.discoveredComments = len(comments)
        grouped: dict[str, dict[str, Any]] = {}
        recommenders: dict[str, list[Recommendation]] = defaultdict(list)
        for comment in comments:
            for url in comment["urls"]:
                resolved = await resolve_url(client, url, audit)
                if not resolved:
                    continue
                episode_id = urlparse(url).path.rsplit("/", 1)[-1] or f"{resolved['showName']}:{resolved['title']}"
                if resolved.get("sourceUrl") and "podcasts.apple.com" in resolved["sourceUrl"]:
                    match = re.search(r"[?&]i=(\d+)", resolved["sourceUrl"])
                    if match:
                        episode_id = match.group(1)
                grouped[episode_id] = resolved
                recommenders[episode_id].append(Recommendation(comment["id"], f"https://news.ycombinator.com/item?id={comment['id']}", comment["storyId"], comment["storyTitle"], f"https://news.ycombinator.com/item?id={comment['storyId']}", comment["author"], comment["createdAt"], comment["text"][:260], url))
        audit.resolvedEpisodes = len(grouped)
        entries: list[Episode] = []
        for episode_id, raw in grouped.items():
            verification = await verify_audio(client, raw["audioUrl"])
            if not verification:
                audit.rejected["audio_unplayable"] += 1
                continue
            try:
                art = await client.get(raw["artworkUrl"], headers={"User-Agent": UA}, follow_redirects=True, timeout=20)
                if art.status_code >= 400 or not art.headers.get("content-type", "").startswith("image/"):
                    audit.rejected["artwork_unreachable"] += 1
                    continue
            except httpx.HTTPError:
                audit.rejected["artwork_unreachable"] += 1
                continue
            topic = topic_for(raw["title"], raw["showName"], raw["description"])
            entries.append(Episode(str(episode_id), raw["showName"], raw["title"], short_description(raw["description"], raw["title"]), [topic], int(raw["durationSeconds"]), raw["publishedAt"], raw["artworkUrl"], raw["audioUrl"], raw["feedUrl"], raw["sourceUrl"], recommenders[episode_id], len(recommenders[episode_id]), verification))
        entries.sort(key=lambda item: (-item.recommendationCount, item.showName.lower(), item.title.lower()))
        audit.playableEpisodes = len(entries)
        catalog = {"catalogVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(), "entries": [asdict(item) for item in entries], "audit": {**asdict(audit), "rejected": dict(audit.rejected)}}
        report = {"searchHits": search_hits, "commentsWithCandidateLinks": len(comments), "resolved": len(grouped), "playable": len(entries), "rejected": dict(audit.rejected), "episodes": [{"id": item.id, "show": item.showName, "title": item.title, "audio": item.audioUrl, "source": item.sourceUrl} for item in entries]}
        return catalog, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-pages", type=int, default=20)
    parser.add_argument("--catalog", type=Path, default=Path("public/data/catalog.json"))
    parser.add_argument("--report", type=Path, default=Path("reports/link-audit.json"))
    args = parser.parse_args()
    catalog, report = asyncio.run(build_catalog(args))
    args.catalog.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.catalog.write_text(json.dumps(catalog, indent=2) + "\n")
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Catalog: {len(catalog['entries'])} verified episodes -> {args.catalog}")
    print(f"Rejected: {catalog['audit']['rejected']}")


if __name__ == "__main__":
    main()
