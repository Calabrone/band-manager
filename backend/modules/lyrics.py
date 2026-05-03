import logging
from urllib.parse import quote

import requests
import lyricsgenius

logger = logging.getLogger(__name__)

LYRICS_OVH_BASE = "https://api.lyrics.ovh/v1"


def _fetch_lyrics_ovh(artist: str, title: str) -> str | None:
    try:
        url = f"{LYRICS_OVH_BASE}/{quote(artist)}/{quote(title)}"
        resp = requests.get(url, timeout=15)
        if resp.status_code == 200:
            return resp.json().get("lyrics")
        logger.warning("lyrics.ovh: status %d for '%s - %s'", resp.status_code, artist, title)
    except Exception as e:
        logger.warning("lyrics.ovh error for '%s - %s': %s", artist, title, e)
    return None


def fetch_lyrics_and_cover(artist: str, title: str, genius_api_key: str) -> dict:
    cover_url = None

    if genius_api_key:
        try:
            genius = lyricsgenius.Genius(
                genius_api_key,
                verbose=False,
                remove_section_headers=True,
                skip_non_songs=True,
                timeout=20,
            )
            results = genius.search_songs(f"{artist} {title}", per_page=5)
            if results and results.get("hits"):
                for hit in results["hits"]:
                    result = hit.get("result", {})
                    primary = result.get("primary_artist", {}).get("name", "").lower()
                    if artist.lower() not in primary and primary not in artist.lower():
                        continue
                    cover_url = result.get("song_art_image_url")
                    logger.info("Genius: cover found for '%s - %s'", artist, title)
                    break
            else:
                logger.warning("Genius: no results for '%s - %s'", artist, title)
        except Exception as e:
            logger.error("Genius search error for '%s - %s': %s", artist, title, e)

    lyrics = _fetch_lyrics_ovh(artist, title)
    if lyrics:
        logger.info("lyrics.ovh: lyrics found for '%s - %s'", artist, title)
    else:
        logger.warning("No lyrics found for '%s - %s'", artist, title)

    return {"lyrics": lyrics, "cover_url": cover_url}
