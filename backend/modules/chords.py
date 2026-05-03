from urllib.parse import quote

import httpx


def fetch_chords_url(artist: str, title: str) -> str:
    """Returns direct Songsterr song URL using the song ID from their search API."""
    query = quote(f"{artist} {title}")
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"https://www.songsterr.com/a/ra/songs.json?pattern={query}",
                headers={"User-Agent": "BandManager/1.0"},
            )
            resp.raise_for_status()
            songs = resp.json()
            if songs:
                song_id = songs[0].get("id")
                if song_id:
                    return f"https://www.songsterr.com/a/wa/song.view?id={song_id}"
    except Exception:
        pass
    return f"https://www.songsterr.com/?pattern={query}"
