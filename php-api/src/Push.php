<?php
declare(strict_types=1);

/**
 * Web Push senza librerie: firma VAPID (ES256, RFC 8292) e cifratura del contenuto (RFC 8291, aes128gcm)
 * con le sole estensioni openssl e curl. Gli invii si accodano durante la richiesta e partono a risposta
 * gia' inviata (shutdown), in parallelo con curl_multi.
 */
final class Push
{
    /** Servizi push accettati (R6.1): solo https e solo questi host, niente richieste verso host arbitrari. */
    private const HOST_ALLOW = [
        '/^fcm\.googleapis\.com$/',
        '/^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/',
        '/^([a-z0-9-]+\.)*push\.apple\.com$/',
        '/^([a-z0-9-]+\.)*notify\.windows\.com$/',
    ];
    /** Host fittizio ammesso solo in modalita' cattura (test). */
    public const TEST_HOST = 'push.test.invalid';

    private const SPKI_P256_PREFIX = '3059301306072a8648ce3d020106082a8648ce3d030107034200';
    private const MAX_FAILS = 5;

    /** @var list<array{sub: array, payload: string, topic: string}> */
    private static array $queue = [];
    private static bool $hooked = false;

    // ── Codifiche ────────────────────────────────────────────────────────────

    public static function b64uEncode(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }

    public static function b64uDecode(string $s): ?string
    {
        if (!preg_match('/^[A-Za-z0-9_-]*={0,2}$/', $s)) {
            return null;
        }
        $bin = base64_decode(strtr(rtrim($s, '='), '-_', '+/'), true);
        return $bin === false ? null : $bin;
    }

    /** Chiave pubblica P-256 (punto non compresso di 65 byte) in PEM SubjectPublicKeyInfo. */
    public static function publicPem(string $point): string
    {
        $der = hex2bin(self::SPKI_P256_PREFIX) . $point;
        return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
    }

    /** Chiave privata P-256 (scalare d di 32 byte + punto pubblico) in PEM SEC1. */
    public static function privatePem(string $d, string $point): string
    {
        $der = hex2bin('30770201010420') . $d . hex2bin('a00a06082a8648ce3d030107a144034200') . $point;
        return "-----BEGIN EC PRIVATE KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END EC PRIVATE KEY-----\n";
    }

    /** Firma ECDSA DER (SEQUENCE di due INTEGER) → r‖s di 64 byte, come vuole JWS ES256. */
    public static function derToRaw(string $der): string
    {
        $pos = 0;
        $len = strlen($der);
        if ($len < 8 || ord($der[$pos++]) !== 0x30) {
            throw new RuntimeException('Firma DER non valida');
        }
        $seqLen = ord($der[$pos++]);
        if ($seqLen & 0x80) {
            $pos += $seqLen & 0x7f;
        }
        $out = '';
        for ($i = 0; $i < 2; $i++) {
            if ($pos >= $len || ord($der[$pos++]) !== 0x02) {
                throw new RuntimeException('Firma DER non valida');
            }
            $n = ord($der[$pos++]);
            $int = ltrim(substr($der, $pos, $n), "\x00");
            $pos += $n;
            if (strlen($int) > 32) {
                throw new RuntimeException('Firma DER non valida');
            }
            $out .= str_pad($int, 32, "\x00", STR_PAD_LEFT);
        }
        return $out;
    }

    /** Coppia P-256 nuova: [scalare d, punto pubblico 65 byte]. */
    private static function newKeyPair(): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        if ($key === false) {
            throw new RuntimeException('Generazione chiave EC fallita: ' . (string)openssl_error_string());
        }
        $ec = openssl_pkey_get_details($key)['ec'];
        $pad = fn(string $v) => str_pad($v, 32, "\x00", STR_PAD_LEFT);
        return [$pad($ec['d']), "\x04" . $pad($ec['x']) . $pad($ec['y'])];
    }

    // ── Chiavi VAPID ─────────────────────────────────────────────────────────

    /** [d, punto pubblico] della chiave VAPID del server, generata e salvata alla prima necessita' (R6.2). */
    public static function vapidKeys(): array
    {
        $get = fn() => Db::all('SELECT "key", value FROM appsetting WHERE "key" IN (\'vapid_public\', \'vapid_private\')');
        $rows = array_column($get(), 'value', 'key');
        if (!isset($rows['vapid_public'], $rows['vapid_private'])) {
            [$d, $pub] = self::newKeyPair();
            $pdo = Db::pdo();
            $pdo->exec('BEGIN IMMEDIATE');
            try {
                // Due richieste in contemporanea: vince la prima, la seconda rilegge
                $st = $pdo->prepare('INSERT OR IGNORE INTO appsetting ("key", value) VALUES (?, ?)');
                $st->execute(['vapid_private', self::b64uEncode($d)]);
                if ($st->rowCount() === 1) {
                    $pdo->prepare('INSERT OR REPLACE INTO appsetting ("key", value) VALUES (?, ?)')
                        ->execute(['vapid_public', self::b64uEncode($pub)]);
                }
                $pdo->exec('COMMIT');
            } catch (Throwable $e) {
                $pdo->exec('ROLLBACK');
                throw $e;
            }
            $rows = array_column($get(), 'value', 'key');
        }
        return [self::b64uDecode($rows['vapid_private']), self::b64uDecode($rows['vapid_public'])];
    }

    public static function publicKey(): string
    {
        return self::b64uEncode(self::vapidKeys()[1]);
    }

    /** Header Authorization VAPID per l'origine dell'endpoint. */
    public static function vapidHeader(string $endpoint, ?int $now = null): string
    {
        [$d, $pub] = self::vapidKeys();
        $u = parse_url($endpoint);
        $aud = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
        $from = Config::get('mail_from');
        $sub = preg_match('/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/', $from, $m) ? $m[0] : 'noreply@motorn.it';
        $head = self::b64uEncode('{"typ":"JWT","alg":"ES256"}');
        $claims = self::b64uEncode(json_encode(
            ['aud' => $aud, 'exp' => ($now ?? time()) + 12 * 3600, 'sub' => 'mailto:' . $sub],
            JSON_UNESCAPED_SLASHES
        ));
        $input = "$head.$claims";
        if (!openssl_sign($input, $der, self::privatePem($d, $pub), OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('Firma VAPID fallita');
        }
        return 'vapid t=' . $input . '.' . self::b64uEncode(self::derToRaw($der)) . ', k=' . self::b64uEncode($pub);
    }

    // ── Cifratura RFC 8291 ───────────────────────────────────────────────────

    /**
     * Corpo cifrato aes128gcm (un solo record). $salt e $asKey ([d, punto]) servono solo ai test con i vettori
     * di RFC 8291: in uso normale si generano a ogni messaggio.
     */
    public static function encrypt(string $payload, string $uaPublic, string $authSecret, ?string $salt = null, ?array $asKey = null): string
    {
        if (strlen($uaPublic) !== 65 || $uaPublic[0] !== "\x04" || strlen($authSecret) !== 16) {
            throw new InvalidArgumentException('Chiavi della sottoscrizione non valide');
        }
        $salt ??= random_bytes(16);
        [$asD, $asPub] = $asKey ?? self::newKeyPair();
        $secret = openssl_pkey_derive(openssl_pkey_get_public(self::publicPem($uaPublic)), openssl_pkey_get_private(self::privatePem($asD, $asPub)), 32);
        if ($secret === false) {
            throw new RuntimeException('ECDH fallito: ' . (string)openssl_error_string());
        }
        $ikm = hash_hkdf('sha256', $secret, 32, "WebPush: info\x00" . $uaPublic . $asPub, $authSecret);
        $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\x00", $salt);
        $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\x00", $salt);
        $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
        if ($cipher === false) {
            throw new RuntimeException('Cifratura fallita');
        }
        return $salt . pack('N', 4096) . chr(65) . $asPub . $cipher . $tag;
    }

    // ── Sottoscrizioni ───────────────────────────────────────────────────────

    public static function captureMode(): bool
    {
        return Config::get('push_capture') === '1';
    }

    public static function endpointAllowed(string $endpoint): bool
    {
        if (strlen($endpoint) > 1024) {
            return false;
        }
        $u = parse_url($endpoint);
        if (!is_array($u) || ($u['scheme'] ?? '') !== 'https' || empty($u['host']) || isset($u['user']) || isset($u['port'])) {
            return false;
        }
        $host = strtolower($u['host']);
        if ($host === self::TEST_HOST) {
            return self::captureMode();
        }
        foreach (self::HOST_ALLOW as $re) {
            if (preg_match($re, $host)) {
                return true;
            }
        }
        return false;
    }

    // ── Invio ────────────────────────────────────────────────────────────────

    public static function pending(): bool
    {
        return self::$queue !== [];
    }

    /** Accoda $message (array JSON) per tutti i dispositivi dell'utente. */
    public static function queue(int $userId, array $message): void
    {
        $subs = Db::all('SELECT * FROM push_subscription WHERE user_id = ?', [$userId]);
        if ($subs === []) {
            return;
        }
        $payload = json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $topic = substr(self::b64uEncode(hash('sha256', (string)($message['tag'] ?? ''), true)), 0, 32);
        foreach ($subs as $s) {
            self::$queue[] = ['sub' => $s, 'payload' => $payload, 'topic' => $topic];
        }
        self::hook();
    }

    /** Registra (una volta) il lavoro da fare a risposta inviata. */
    public static function hook(): void
    {
        if (!self::$hooked) {
            self::$hooked = true;
            register_shutdown_function([self::class, 'afterResponse']);
        }
    }

    public static function afterResponse(): void
    {
        ignore_user_abort(true);
        if (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        }
        try {
            self::flush();
        } catch (Throwable $e) {
            Http::log('Push: ' . $e->getMessage());
        }
        try {
            Notify::purge();
        } catch (Throwable $e) {
            Http::log('Notify purge: ' . $e->getMessage());
        }
    }

    public static function flush(): void
    {
        $queue = self::$queue;
        self::$queue = [];
        if ($queue === []) {
            return;
        }
        $requests = [];
        foreach ($queue as $item) {
            $s = $item['sub'];
            try {
                $body = self::encrypt($item['payload'], (string)self::b64uDecode($s['p256dh']), (string)self::b64uDecode($s['auth']));
                $headers = [
                    'Authorization: ' . self::vapidHeader($s['endpoint']),
                    'Content-Type: application/octet-stream',
                    'Content-Encoding: aes128gcm',
                    'TTL: 86400',
                    'Urgency: normal',
                    'Topic: ' . $item['topic'],
                ];
            } catch (Throwable $e) {
                Http::log('Push encrypt #' . $s['id'] . ': ' . $e->getMessage());
                continue;
            }
            $requests[] = [$s, $headers, $body];
        }
        if (self::captureMode()) {
            $file = dirname(__DIR__) . '/data/push_capture.jsonl';
            foreach ($requests as [$s, $headers, $body]) {
                @file_put_contents($file, json_encode([
                    'endpoint' => $s['endpoint'], 'user_id' => (int)$s['user_id'],
                    'headers' => $headers, 'body' => base64_encode($body),
                ], JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
                self::result($s, str_contains($s['endpoint'], '/gone') ? 410 : 201);
            }
            return;
        }
        $mh = curl_multi_init();
        $handles = [];
        foreach ($requests as $i => [$s, $headers, $body]) {
            $ch = curl_init($s['endpoint']);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => 3,
                CURLOPT_TIMEOUT => 6,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            ]);
            curl_multi_add_handle($mh, $ch);
            $handles[$i] = $ch;
        }
        do {
            $status = curl_multi_exec($mh, $running);
            if ($running) {
                curl_multi_select($mh, 1.0);
            }
        } while ($running && $status === CURLM_OK);
        foreach ($handles as $i => $ch) {
            $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            if ($code < 200 || $code >= 300) {
                Http::log('Push #' . $requests[$i][0]['id'] . ' HTTP ' . $code . ' ' . substr((string)curl_multi_getcontent($ch), 0, 200) . ' ' . curl_error($ch));
            }
            self::result($requests[$i][0], $code);
            curl_multi_remove_handle($mh, $ch);
        }
        curl_multi_close($mh);
    }

    /** Esito di un invio: 2xx ok, 404/410 sottoscrizione morta (R3.7), altro conta i fallimenti. */
    private static function result(array $sub, int $code): void
    {
        if ($code >= 200 && $code < 300) {
            Db::exec('UPDATE push_subscription SET last_ok_at = ?, fail_count = 0 WHERE id = ?', [Db::now(), $sub['id']]);
        } elseif ($code === 404 || $code === 410) {
            Db::exec('DELETE FROM push_subscription WHERE id = ?', [$sub['id']]);
        } else {
            Db::exec('UPDATE push_subscription SET fail_count = fail_count + 1 WHERE id = ?', [$sub['id']]);
            Db::exec('DELETE FROM push_subscription WHERE id = ? AND fail_count >= ?', [$sub['id'], self::MAX_FAILS]);
        }
    }
}
