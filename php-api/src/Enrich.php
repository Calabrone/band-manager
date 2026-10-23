<?php
declare(strict_types=1);

final class Settings
{
    public static function get(string $key): string
    {
        $row = Db::one('SELECT value FROM appsetting WHERE "key" = ?', [$key]);
        return $row === null ? '' : (string)$row['value'];
    }
}

/** Pipeline di arricchimento di un brano (equivalente di enrich_song_bg). */
final class Enrich
{
    public static function run(int $songId): void
    {
        $song = Db::one('SELECT * FROM song WHERE id = ?', [$songId]);
        if ($song === null) {
            return;
        }
        $groqKey = Settings::get('groq_api_key');
        $geniusKey = Settings::get('genius_api_key');

        $result = Groq::validateSong($song['artist'], $song['title'], $groqKey);
        if (!$result['valid']) {
            Db::exec('UPDATE song SET validation_error = ?, validated = 0 WHERE id = ?', [$result['message'], $songId]);
            return;
        }
        $artist = $result['artist_normalized'];
        $title = $result['title_normalized'];

        $cover = Genius::cover($artist, $title, $geniusKey);
        $lyrics = LyricsOvh::fetch($artist, $title);

        $chordsText = $song['chords_text'];
        $chordsUrl = $song['chords_url'];
        if (Settings::get('chords_enabled') === 'true') {
            $chordsText = Groq::chordsText($artist, $title, $groqKey);
            $chordsUrl = Songsterr::chordsUrl($artist, $title);
        }
        $youtube = 'https://music.youtube.com/search?q=' . rawurlencode("$artist $title");

        Db::exec(
            'UPDATE song SET artist = ?, title = ?, lyrics = ?, cover_url = ?, chords_text = ?, chords_url = ?,
                youtube_url = ?, validated = 1, validation_error = NULL, updated_at = ? WHERE id = ?',
            [$artist, $title, $lyrics, $cover, $chordsText, $chordsUrl, $youtube, Db::now(), $songId]
        );
    }
}
