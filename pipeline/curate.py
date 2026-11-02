from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path

import httpx

CATALOG = Path('public/data/catalog.json')
REPORT = Path('reports/curation.json')
ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
MODEL = 'deepseek/deepseek-v4.1-flash-1017'
TOPICS = {'Technology', 'Science', 'Business', 'History', 'Society', 'Health', 'Arts', 'Other'}
UNSTABLE = re.compile(r'(Signature=|Key-Pair-Id=|timetoken=|request_event_id=|session_id=|validation=|pbss=|le=.*&exp=)', re.I)


def clean_show(title: str, show: str) -> tuple[str, str]:
    if show in {'overcast.fm', 'omny.fm', 'Pocket Casts', 'Podcast'}:
        for separator in (' — ', ' - '):
            if separator in title:
                episode, candidate = title.rsplit(separator, 1)
                if len(candidate) >= 3:
                    return episode.strip(), candidate.strip()
    return title, show


async def curate_batch(client: httpx.AsyncClient, batch: list[dict]) -> dict[str, dict]:
    key = os.environ.get('OPENROUTER_API_KEY')
    if not key:
        return {}
    payload = [{'id': item['id'], 'title': item['title'], 'show': item['showName'], 'excerpt': ' '.join(rec['excerpt'] for rec in item['recommendations'][:3])[:1000]} for item in batch]
    prompt = ('For each podcast episode, decide whether the HN comment excerpt is a genuine recommendation of that specific episode, '
              'rather than spam, self-promotion, an unrelated link, or a whole-show recommendation. Write one factual search-result '
              'description of at most 180 characters using only the title/show/excerpt context; do not invent details. Choose exactly '
              'one topic. Return a JSON object with key "items" containing an array; each item must have id (same string), '
              'recommended (boolean), description (string), topic (one of Technology, Science, Business, History, Society, Health, Arts, Other). '
              'Input: ' + json.dumps(payload, ensure_ascii=False))
    response = await client.post(ENDPOINT, headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}, json={
        'model': MODEL,
        'messages': [{'role': 'system', 'content': 'Return only valid JSON. Be concise and literal.'}, {'role': 'user', 'content': prompt}],
        'response_format': {'type': 'json_object'},
        'reasoning_effort': 'low',
        'temperature': 0.15,
        'max_tokens': 8000,
    }, timeout=90)
    response.raise_for_status()
    content = response.json()['choices'][0]['message']['content']
    parsed = json.loads(content)
    items = parsed.get('items', parsed if isinstance(parsed, list) else [])
    return {str(item['id']): item for item in items if isinstance(item, dict) and 'id' in item}


async def main() -> None:
    catalog = json.loads(CATALOG.read_text())
    stable = []
    removed = []
    for item in catalog['entries']:
        if UNSTABLE.search(item['audioUrl']):
            removed.append({'id': item['id'], 'reason': 'unstable_signed_audio_url', 'url': item['audioUrl']})
            continue
        fixed_title, fixed_show = clean_show(item['title'], item['showName'])
        item['title'], item['showName'] = fixed_title, fixed_show
        stable.append(item)
    async with httpx.AsyncClient(http2=True) as client:
        for start in range(0, len(stable), 15):
            batch = stable[start:start + 15]
            try:
                result = await curate_batch(client, batch)
            except Exception as error:
                print(f'Curation batch {start} failed: {error}')
                continue
            for item in batch:
                cur = result.get(item['id'])
                if cur and cur.get('recommended') is True and cur.get('description'):
                    item['description'] = str(cur['description']).strip()[:220]
                    item['topics'] = [cur.get('topic') if cur.get('topic') in TOPICS else item['topics'][0]]
            print(f'Curated {min(start + 15, len(stable))}/{len(stable)}')
    # One short episode was discovered from a tutorial page; keep the POC radio threshold honest.
    stable = [item for item in stable if item['durationSeconds'] == 0 or item['durationSeconds'] >= 600]
    stable.sort(key=lambda item: (-item['recommendationCount'], item['showName'].lower(), item['title'].lower()))
    catalog['entries'] = stable
    catalog['audit']['playableEpisodes'] = len(stable)
    catalog['audit']['rejected']['unstable_signed_audio_url'] = len(removed)
    CATALOG.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + '\n')
    REPORT.write_text(json.dumps({'removed': removed, 'remaining': len(stable), 'curatedWithAI': bool(os.environ.get('OPENROUTER_API_KEY'))}, indent=2) + '\n')
    print(f'Wrote {len(stable)} stable episodes; removed {len(removed)} signed URLs')


if __name__ == '__main__':
    asyncio.run(main())
