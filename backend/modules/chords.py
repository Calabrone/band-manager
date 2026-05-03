from urllib.parse import quote

import httpx


def fetch_chords_url(artist: str, title: str) -> str | None:
    query = quote(f"{artist} {title}")
    api_url = f"https://www.songsterr.com/a/ra/songs.json?pattern={query}"

    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(api_url, headers={"User-Agent": "BandManager/1.0"})
            resp.raise_for_status()
            songs = resp.json()
            if songs:
                song = songs[0]
                song_id = song.get("id")
                # Costruisce slug dall'artista e titolo normalizzati
                artist_slug = song.get("artist", {}).get("nameWithoutThePrefix", artist)
                title_slug = song.get("title", title)
                slug = _slugify(f"{artist_slug}-{title_slug}")
                return f"https://www.songsterr.com/a/wsa/{slug}-tab-s{song_id}"
    except Exception:
        pass

    # Fallback: URL di ricerca generico su Songsterr
    return f"https://www.songsterr.com/a/wa/songs?pattern={query}"


def _slugify(text: str) -> str:
    import re
    text = text.lower()
    text = re.sub(r"[^a-z0-9\-]", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")
