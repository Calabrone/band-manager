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
    // Modello OpenAI ospitato da Groq (llama-3.3-70b-versatile non e' piu' disponibile).
    // E' un modello con ragionamento: i token di ragionamento rientrano in max_completion_tokens,
    // quindi i limiti sono larghi e reasoning_effort e' basso.
    private const MODEL = 'openai/gpt-oss-120b';

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
            'max_completion_tokens' => $maxTokens,
            'reasoning_effort' => 'low',
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
                strtr(self::VALIDATE_USER, ['{artist}' => $artist, '{title}' => $title]), 1024);
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
                strtr(self::CHORDS_USER, ['{artist}' => $artist, '{title}' => $title]), 4096);
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

/**
 * Invio email. Con smtp_host in config.php usa SMTP autenticato (curl smtps://): su Aruba mail() risulta
 * disabilitata (restituisce false). Senza smtp_* ripiega su mail(). Mittente: mail_from.
 */
final class Mailer
{
    public static function send(string $to, string $subject, string $body): bool
    {
        if (Config::get('smtp_host') !== '') {
            $from = Config::get('mail_from');
            return self::viaSmtp($to, $subject, $body, $from !== '' ? $from : 'Band Manager <noreply@motorn.it>');
        }
        return self::viaMail($to, $subject, $body);
    }

    private static function viaMail(string $to, string $subject, string $body): bool
    {
        $from = Config::get('mail_from');
        if ($from === '') {
            $from = 'Band Manager <noreply@motorn.it>';
        }
        $headers = implode("
", [
            'From: ' . $from,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
        ]);
        $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
        $ok = @mail($to, $encodedSubject, $body, $headers);
        if (!$ok) {
            Http::log("Mailer: invio fallito verso $to");
        }
        return $ok;
    }

    /** Indirizzo nudo da "Nome <indirizzo>". */
    private static function address(string $from): string
    {
        return preg_match('/<([^<>\s]+)>/', $from, $m) ? $m[1] : trim($from);
    }

    private static function viaSmtp(string $to, string $subject, string $body, string $from): bool
    {
        $host = Config::get('smtp_host');
        $port = Config::get('smtp_port') ?: '465';
        $user = Config::get('smtp_user');
        $envelopeFrom = self::address($from);
        $domain = substr(strrchr($envelopeFrom, '@') ?: '@localhost', 1);

        $msg = implode("\r\n", [
            'From: ' . $from,
            'To: ' . $to,
            'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
            'Date: ' . gmdate('r'),
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $domain . '>',
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            rtrim(chunk_split(base64_encode($body), 76, "\r\n")),
            '',
        ]);

        $pos = 0;
        $ch = curl_init(($port === '465' ? 'smtps' : 'smtp') . "://$host:$port");
        curl_setopt_array($ch, [
            CURLOPT_USERNAME => $user,
            CURLOPT_PASSWORD => Config::get('smtp_pass'),
            CURLOPT_MAIL_FROM => "<$envelopeFrom>",
            CURLOPT_MAIL_RCPT => ["<$to>"],
            CURLOPT_UPLOAD => true,
            CURLOPT_READFUNCTION => function ($c, $fd, int $len) use ($msg, &$pos): string {
                $chunk = substr($msg, $pos, $len);
                $pos += strlen($chunk);
                return $chunk;
            },
            CURLOPT_INFILESIZE => strlen($msg),
            CURLOPT_USE_SSL => CURLUSESSL_ALL,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 25,
        ]);
        $ok = curl_exec($ch) !== false;
        if (!$ok) {
            // Solo l'errore di curl: mai la password
            Http::log("Mailer: SMTP fallito verso $to (" . curl_error($ch) . ')');
        }
        return $ok;
    }
}
