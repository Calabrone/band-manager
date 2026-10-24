<?php
declare(strict_types=1);

/** Audio delle prove: formati ammessi, URL firmati e streaming con Range. */
final class Media
{
    public const AUDIO_TYPES = [
        'mp3' => 'audio/mpeg',
        'm4a' => 'audio/mp4',
        'mp4' => 'audio/mp4',
        'aac' => 'audio/aac',
        'wav' => 'audio/wav',
        'ogg' => 'audio/ogg',
        'oga' => 'audio/ogg',
        'opus' => 'audio/ogg; codecs=opus',
        'flac' => 'audio/flac',
        'amr' => 'audio/amr',
        '3gp' => 'audio/3gpp',
        '3gpp' => 'audio/3gpp',
        'caf' => 'audio/x-caf',
        'webm' => 'audio/webm',
    ];

    /** Validita' del link firmato di ascolto/download. */
    public const URL_TTL = 6 * 3600;

    public const TITLE_MAX = 150;
    public const NOTE_MAX = 1000;
    public const URL_MAX = 2000;

    public static function audioDir(): string
    {
        return dirname(__DIR__) . '/data/audio';
    }

    public static function audioPath(string $storedName): string
    {
        return self::audioDir() . '/' . $storedName;
    }

    /** "128M" -> byte. */
    private static function iniBytes(string $v): int
    {
        $v = trim($v);
        if ($v === '') {
            return 0;
        }
        $n = (int)$v;
        return match (strtolower(substr($v, -1))) {
            'g' => $n * 1073741824,
            'm' => $n * 1048576,
            'k' => $n * 1024,
            default => $n,
        };
    }

    /** Dimensione massima di un upload: il piu' basso tra upload_max_filesize e post_max_size (0 = illimitato). */
    public static function maxUploadBytes(): int
    {
        $limits = array_filter([
            self::iniBytes((string)ini_get('upload_max_filesize')),
            self::iniBytes((string)ini_get('post_max_size')),
        ], fn(int $n) => $n > 0);
        return $limits === [] ? 0 : min($limits);
    }

    /** Data YYYY-MM-DD reale, non oltre domani (fusi orari). */
    public static function checkDate(string $s): string
    {
        $s = trim($s);
        $d = DateTime::createFromFormat('!Y-m-d', $s);
        if ($d === false || $d->format('Y-m-d') !== $s) {
            Http::fail(400, 'Data non valida (usa AAAA-MM-GG)');
        }
        if ($s > gmdate('Y-m-d', time() + 86400)) {
            Http::fail(400, 'La data non può essere nel futuro');
        }
        return $s;
    }

    public static function checkTitle(string $s): string
    {
        $s = trim($s);
        if ($s === '') {
            Http::fail(400, 'Il titolo è obbligatorio');
        }
        if (mb_strlen($s) > self::TITLE_MAX) {
            Http::fail(400, 'Titolo troppo lungo (max ' . self::TITLE_MAX . ' caratteri)');
        }
        return $s;
    }

    public static function checkNote(?string $s): ?string
    {
        $s = $s === null ? '' : trim($s);
        if (mb_strlen($s) > self::NOTE_MAX) {
            Http::fail(400, 'Nota troppo lunga (max ' . self::NOTE_MAX . ' caratteri)');
        }
        return $s === '' ? null : $s;
    }

    /** Link http/https valido. */
    public static function checkUrl(string $s): string
    {
        $s = trim($s);
        $scheme = strtolower((string)parse_url($s, PHP_URL_SCHEME));
        if ($s === '' || mb_strlen($s) > self::URL_MAX || !in_array($scheme, ['http', 'https'], true)
            || filter_var($s, FILTER_VALIDATE_URL) === false) {
            Http::fail(400, 'Link non valido (deve iniziare con http:// o https://)');
        }
        return $s;
    }

    // ── Link firmati ─────────────────────────────────────────────────────────

    private static function signature(int $audioId, int $exp): string
    {
        $mac = hash_hmac('sha256', "audio:$audioId:$exp", Config::get('secret_key'), true);
        return rtrim(strtr(base64_encode($mac), '+/', '-_'), '=');
    }

    /** @return array{0:int,1:string} [scadenza, firma] */
    public static function sign(int $audioId): array
    {
        $exp = time() + self::URL_TTL;
        return [$exp, self::signature($audioId, $exp)];
    }

    public static function verify(int $audioId, mixed $exp, mixed $sig): bool
    {
        if (!is_string($exp) || !ctype_digit($exp) || !is_string($sig) || (int)$exp < time()) {
            return false;
        }
        return hash_equals(self::signature($audioId, (int)$exp), $sig);
    }

    // ── Streaming ────────────────────────────────────────────────────────────

    /** Nome file sicuro per Content-Disposition (fallback ASCII + filename* UTF-8). */
    private static function disposition(string $kind, string $name): string
    {
        $clean = preg_replace('/[\x00-\x1F\x7F"\\\\\/]+/u', '_', $name) ?? 'audio';
        $ascii = preg_replace('/[^A-Za-z0-9._-]+/', '_', $clean) ?? 'audio';
        return $kind . '; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode($clean);
    }

    /** Invia il file (200 o 206 con Range, 416 se il range non e' valido). */
    public static function stream(array $audio, bool $download): never
    {
        $path = self::audioPath($audio['stored_name']);
        $size = is_file($path) ? (int)filesize($path) : -1;
        if ($size <= 0) {
            Http::fail(404, 'File non trovato');
        }
        $start = 0;
        $end = $size - 1;
        $status = 200;
        $range = trim((string)($_SERVER['HTTP_RANGE'] ?? ''));
        if ($range !== '' && preg_match('/^bytes=(\d*)-(\d*)$/', $range, $m) && ($m[1] !== '' || $m[2] !== '')) {
            if ($m[1] === '') {
                $start = max(0, $size - (int)$m[2]);
            } else {
                $start = (int)$m[1];
                if ($m[2] !== '') {
                    $end = min($end, (int)$m[2]);
                }
            }
            if ($start > $end || $start >= $size) {
                http_response_code(416);
                header("Content-Range: bytes */$size");
                exit;
            }
            $status = 206;
        }
        $length = $end - $start + 1;

        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        set_time_limit(0);
        http_response_code($status);
        header('Content-Type: ' . (self::AUDIO_TYPES[$audio['ext']] ?? 'application/octet-stream'));
        header('Accept-Ranges: bytes');
        header('Content-Length: ' . $length);
        if ($status === 206) {
            header("Content-Range: bytes $start-$end/$size");
        }
        header('Content-Disposition: ' . self::disposition($download ? 'attachment' : 'inline', $audio['original_name']));
        header('Cache-Control: private, max-age=3600');
        header('X-Content-Type-Options: nosniff');

        $fh = fopen($path, 'rb');
        if ($fh === false) {
            exit;
        }
        fseek($fh, $start);
        $left = $length;
        while ($left > 0 && !feof($fh) && !connection_aborted()) {
            $chunk = fread($fh, min(8192, $left));
            if ($chunk === false || $chunk === '') {
                break;
            }
            echo $chunk;
            $left -= strlen($chunk);
            flush();
        }
        fclose($fh);
        exit;
    }
}

/** Anteprima (titolo e immagine Open Graph) di un link, senza raggiungere reti interne. */
final class LinkPreview
{
    private const MAX_BYTES = 262144;
    private const MAX_HOPS = 3;

    /** Indirizzo pubblico a cui collegarsi per l'host dell'URL, o null se non consentito. */
    private static function publicIp(array $parts): ?string
    {
        $scheme = strtolower((string)($parts['scheme'] ?? ''));
        $host = trim((string)($parts['host'] ?? ''), '[]');
        $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
        if (!in_array($scheme, ['http', 'https'], true) || $host === '' || !in_array($port, [80, 443], true)) {
            return null;
        }
        $ips = filter_var($host, FILTER_VALIDATE_IP) !== false ? [$host] : (gethostbynamel($host) ?: []);
        if ($ips === []) {
            return null;
        }
        foreach ($ips as $ip) {
            if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
                return null;
            }
        }
        return $ips[0];
    }

    /** @return array{0:int,1:string,2:string,3:string} [status, location, content-type, body] */
    private static function get(string $url, string $ip, array $parts): array
    {
        $scheme = strtolower($parts['scheme']);
        $host = trim($parts['host'], '[]');
        $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
        $location = '';
        $type = '';
        $body = '';
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 5,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; BandManager/1.0; link preview)',
            CURLOPT_HTTPHEADER => ['Accept: text/html,application/xhtml+xml', 'Accept-Language: it,en;q=0.8'],
            CURLOPT_RESOLVE => ["$host:$port:$ip"],   // collega solo all'IP gia' verificato
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_HEADERFUNCTION => function ($c, string $line) use (&$location, &$type): int {
                if (stripos($line, 'location:') === 0) {
                    $location = trim(substr($line, 9));
                } elseif (stripos($line, 'content-type:') === 0) {
                    $type = strtolower(trim(substr($line, 13)));
                }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($c, string $chunk) use (&$body): int {
                $body .= $chunk;
                return strlen($body) > self::MAX_BYTES ? 0 : strlen($chunk);   // 0 interrompe il download
            },
        ]);
        curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        return [$status, $location, $type, $body];
    }

    private static function absolute(string $location, array $from): string
    {
        if (preg_match('#^https?://#i', $location)) {
            return $location;
        }
        $origin = $from['scheme'] . '://' . $from['host'] . (isset($from['port']) ? ':' . $from['port'] : '');
        return str_starts_with($location, '/') ? $origin . $location : $origin . '/' . $location;
    }

    private static function clean(?string $s, int $max): ?string
    {
        if ($s === null) {
            return null;
        }
        $s = trim((string)preg_replace('/\s+/u', ' ', $s));
        return $s === '' ? null : mb_substr($s, 0, $max);
    }

    /** @return array{title:?string,image:?string} sempre un risultato: i fallimenti danno valori null. */
    public static function fetch(string $url): array
    {
        $empty = ['title' => null, 'image' => null];
        $html = null;
        for ($hop = 0; $hop <= self::MAX_HOPS; $hop++) {
            $parts = parse_url($url);
            $ip = is_array($parts) ? self::publicIp($parts) : null;
            if ($ip === null) {
                return $empty;
            }
            [$status, $location, $type, $body] = self::get($url, $ip, $parts);
            if ($status >= 300 && $status < 400 && $location !== '') {
                $url = self::absolute($location, $parts);
                continue;
            }
            if ($status === 200 && ($type === '' || str_contains($type, 'html'))) {
                $html = $body;
            }
            break;
        }
        if ($html === null || $html === '') {
            return $empty;
        }

        $prev = libxml_use_internal_errors(true);
        $doc = new DOMDocument();
        $doc->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOWARNING | LIBXML_NOERROR);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        $meta = [];
        foreach ($doc->getElementsByTagName('meta') as $m) {
            $key = strtolower($m->getAttribute('property') ?: $m->getAttribute('name'));
            if ($key !== '' && !isset($meta[$key])) {
                $meta[$key] = $m->getAttribute('content');
            }
        }
        $title = $meta['og:title'] ?? null;
        if ($title === null || trim($title) === '') {
            $t = $doc->getElementsByTagName('title')->item(0);
            $title = $t?->textContent;
        }
        $image = $meta['og:image'] ?? $meta['twitter:image'] ?? null;
        $image = $image !== null ? trim($image) : null;
        if ($image !== null && (!str_starts_with(strtolower($image), 'https://') || mb_strlen($image) > Media::URL_MAX)) {
            $image = null;
        }
        return ['title' => self::clean($title, Media::TITLE_MAX), 'image' => $image === '' ? null : $image];
    }
}
