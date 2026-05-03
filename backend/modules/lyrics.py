import lyricsgenius


def fetch_lyrics_and_cover(artist: str, title: str, genius_api_key: str) -> dict:
    if not genius_api_key:
        return {"lyrics": None, "cover_url": None}

    try:
        genius = lyricsgenius.Genius(
            genius_api_key,
            verbose=False,
            remove_section_headers=True,
            skip_non_songs=True,
            timeout=15,
        )
        song = genius.search_song(title, artist)
        if song:
            return {
                "lyrics": song.lyrics,
                "cover_url": song.song_art_image_url,
            }
    except Exception:
        pass

    return {"lyrics": None, "cover_url": None}
