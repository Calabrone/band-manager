<?php
declare(strict_types=1);

/** Client HTTP minimale su curl (allow_url_fopen e' disabilitato sull'hosting). */
final class Curl
{
    /** @return array{0:int,1:?string,2:string} [status http, body|null, errore curl] */
    public static function request(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 20): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_USERAGENT => 'BandManager/1.0',
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $resp = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        return [$status, is_string($resp) ? $resp : null, $err];
    }
}

final class Groq
{
    private const URL = 'https://api.groq.com/openai/v1/chat/completions';
    private const MODEL = 'llama-3.3-70b-versatile';

    private const VALIDATE_SYSTEM = <<<'T'
Sei un esperto di musica. Il tuo compito è verificare se esiste una canzone reale con i dati forniti.
Rispondi SEMPRE e SOLO con un oggetto JSON valido, senza markdown, senza spiegazioni aggiuntive.
T;

    private const VALIDATE_USER = <<<'T'
Verifica se esiste questa canzone:
Artista: {artist}
Titolo: {title}

Rispondi con JSON esatto in questo formato:
{"valid": true/false, "artist_normalized": "nome artista corretto", "title_normalized": "titolo corretto", "message": "motivo se non valida, stringa vuota se valida"}
T;

    private const CHORDS_SYSTEM = 'Sei un musicista esperto con conoscenza precisa degli accordi delle canzoni. '
        . 'Genera schemi accordi nel formato chord-over-lyrics: '
        . 'scrivi il nome dell\'accordo sopra la parola/sillaba esatta in cui cambia. '
        . 'Rispondi SOLO con lo schema, niente spiegazioni, niente markdown.';

    private const CHORDS_USER = <<<'T'
Genera lo schema accordi completo per "{title}" di {artist}.

Usa il formato chord-over-lyrics:
- Nome accordo posizionato sopra la parola dove cambia (allineamento con spazi)
- Sezioni tra parentesi quadre: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Bridge], [Outro]
- Usa i nomi reali degli accordi (Am, G, F, E, Cadd9, D/F#, Bm7 ecc.)
- Se una sezione si ripete, scrivi "(repeat)" invece di copiare

Formato di esempio:
[Intro]
Am      G       F       E

[Verse 1]
Am              G
When I was young I knew everything
F                   E
She a punk who rarely ever took advice

[Chorus]
F       C           G          Am
Now I'm falling apart with all my heart

Genera lo schema completo per "{title}" di {artist}.
Se la canzone non è conosciuta con precisione, scrivi: Non disponibile
T;

    private static function chat(string $key, string $system, string $user, int $maxTokens): string
    {
        $payload = json_encode([
            'model' => self::MODEL,
            'messages' => [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => $user],
            ],
            'temperature' => 0.1,
            'max_tokens' => $maxTokens,
        ], JSON_UNESCAPED_UNICODE);
        [$status, $body, $err] = Curl::request(
            'POST', self::URL,
            ['Authorization: Bearer ' . $key, 'Content-Type: application/json'],
            $payload, 40
        );
        if ($body === null) {
            throw new RuntimeException($err !== '' ? $err : 'Errore di rete');
        }
        $data = json_decode($body, true);
        if ($status !== 200) {
            $msg = is_array($data) ? ($data['error']['message'] ?? $body) : $body;
            throw new RuntimeException("Error code: $status - $msg");
        }
        $content = $data['choices'][0]['message']['content'] ?? null;
        if (!is_string($content)) {
            throw new RuntimeException('Risposta non valida dal modello');
        }
        return trim($content);
    }

    /** @return array{valid:bool,artist_normalized:string,title_normalized:string,message:string} */
    public static function validateSong(string $artist, string $title, string $key): array
    {
        $fail = fn(string $msg) => [
            'valid' => false, 'artist_normalized' => $artist, 'title_normalized' => $title, 'message' => $msg,
        ];
        if ($key === '') {
            return $fail('Groq API key non configurata. Impostala dalla pagina Admin.');
        }
        try {
            $raw = self::chat($key, self::VALIDATE_SYSTEM,
                strtr(self::VALIDATE_USER, ['{artist}' => $artist, '{title}' => $title]), 200);
        } catch (Throwable $e) {
            return $fail('Errore validazione: ' . $e->getMessage());
        }
        // Estrae il JSON anche se c'e' testo attorno
        if (preg_match('/\{.*\}/s', $raw, $m)) {
            $data = json_decode($m[0], true);
            if (is_array($data)) {
                $a = $data['artist_normalized'] ?? null;
                $t = $data['title_normalized'] ?? null;
                return [
                    'valid' => (bool)($data['valid'] ?? false),
                    'artist_normalized' => is_string($a) && trim($a) !== '' ? trim($a) : $artist,
                    'title_normalized' => is_string($t) && trim($t) !== '' ? trim($t) : $title,
                    'message' => (string)($data['message'] ?? ''),
                ];
            }
        }
        return $fail('Risposta non valida dal modello');
    }

    public static function chordsText(string $artist, string $title, string $key): ?string
    {
        if ($key === '') {
            return null;
        }
        try {
            $text = self::chat($key, self::CHORDS_SYSTEM,
                strtr(self::CHORDS_USER, ['{artist}' => $artist, '{title}' => $title]), 1500);
        } catch (Throwable $e) {
            return null;
        }
        if ($text === '' || stripos($text, 'non disponibile') === 0) {
            return null;
        }
        return $text;
    }
}

final class Genius
{
    /** Cover del brano dalla ricerca ufficiale Genius (solo con API key). */
    public static function cover(string $artist, string $title, string $key): ?string
    {
        if ($key === '') {
            return null;
        }
        $url = 'https://api.genius.com/search?per_page=5&q=' . rawurlencode("$artist $title");
        [$status, $body] = Curl::request('GET', $url, ['Authorization: Bearer ' . $key], null, 20);
        if ($status !== 200 || $body === null) {
            Http::log("Genius: status $status per '$artist - $title'");
            return null;
        }
        $data = json_decode($body, true);
        $artistL = mb_strtolower($artist);
        foreach ($data['response']['hits'] ?? [] as $hit) {
            $result = $hit['result'] ?? [];
            $primary = mb_strtolower((string)($result['primary_artist']['name'] ?? ''));
            if (!str_contains($primary, $artistL) && !str_contains($artistL, $primary)) {
                continue;
            }
            return $result['song_art_image_url'] ?? null;
        }
        return null;
    }
}

final class LyricsOvh
{
    public static function fetch(string $artist, string $title): ?string
    {
        $url = 'https://api.lyrics.ovh/v1/' . rawurlencode($artist) . '/' . rawurlencode($title);
        [$status, $body] = Curl::request('GET', $url, [], null, 15);
        if ($status !== 200 || $body === null) {
            Http::log("lyrics.ovh: status $status per '$artist - $title'");
            return null;
        }
        $lyrics = (json_decode($body, true) ?? [])['lyrics'] ?? null;
        return is_string($lyrics) && $lyrics !== '' ? $lyrics : null;
    }
}

final class Songsterr
{
    public static function chordsUrl(string $artist, string $title): string
    {
        $q = rawurlencode("$artist $title");
        [$status, $body] = Curl::request('GET', "https://www.songsterr.com/a/ra/songs.json?pattern=$q", [], null, 10);
        if ($status === 200 && $body !== null) {
            $songs = json_decode($body, true);
            $id = is_array($songs) && isset($songs[0]['id']) ? $songs[0]['id'] : null;
            if ($id) {
                return "https://www.songsterr.com/a/wa/song.view?id=$id";
            }
        }
        return "https://www.songsterr.com/?pattern=$q";
    }
}
