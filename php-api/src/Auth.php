<?php
declare(strict_types=1);

final class Auth
{
    private const TOKEN_DAYS = 7;
    public const INVITE_TTL = 7 * 86400;
    public const RESET_TTL = 3600;
    public const DEFAULT_ADMIN_PASSWORD = 'admin123';

    /** Token casuale a 256 bit (esadecimale): va dato all'utente, a DB si salva solo hashToken(). */
    public static function newToken(): string
    {
        return bin2hex(random_bytes(32));
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function hashPassword(string $plain): string
    {
        return password_hash($plain, PASSWORD_BCRYPT);
    }

    public static function verifyPassword(string $plain, string $hash): bool
    {
        return password_verify($plain, $hash);
    }

    private static function b64(string $s): string
    {
        return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    }

    private static function unb64(string $s): string|false
    {
        return base64_decode(strtr($s, '-_', '+/'), true);
    }

    public static function createToken(int $userId, int $tokenVersion = 0): string
    {
        $header = self::b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = self::b64(json_encode([
            'sub' => (string)$userId,
            'tv' => $tokenVersion,
            'exp' => time() + self::TOKEN_DAYS * 86400,
        ]));
        $sig = self::b64(hash_hmac('sha256', "$header.$payload", Config::get('secret_key'), true));
        return "$header.$payload.$sig";
    }

    /** @return ?array{id:int,tv:int} id utente e versione se il token e' valido (firma HS256 + scadenza), altrimenti null. */
    public static function decodeToken(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }
        [$h, $p, $s] = $parts;
        $header = json_decode((string)self::unb64($h), true);
        if (!is_array($header) || ($header['alg'] ?? null) !== 'HS256') {
            return null;
        }
        $expected = self::b64(hash_hmac('sha256', "$h.$p", Config::get('secret_key'), true));
        if (!hash_equals($expected, $s)) {
            return null;
        }
        $payload = json_decode((string)self::unb64($p), true);
        if (!is_array($payload) || !isset($payload['exp'], $payload['sub']) || (int)$payload['exp'] < time()) {
            return null;
        }
        if (!ctype_digit((string)$payload['sub'])) {
            return null;
        }
        // I token emessi prima dell'introduzione di "tv" valgono come versione 0
        return ['id' => (int)$payload['sub'], 'tv' => (int)($payload['tv'] ?? 0)];
    }

    public static function currentUser(): array
    {
        $token = Http::bearerToken();
        $decoded = $token === null ? null : self::decodeToken($token);
        if ($decoded === null) {
            Http::fail(401, 'Token non valido');
        }
        $user = Db::one('SELECT * FROM "user" WHERE id = ?', [$decoded['id']]);
        if ($user === null) {
            Http::fail(401, 'Utente non trovato');
        }
        if ((int)$user['token_version'] !== $decoded['tv']) {
            Http::fail(401, 'Token non valido');
        }
        return $user;
    }

    public static function requireAdmin(): array
    {
        $user = self::currentUser();
        if ($user['role'] !== 'admin') {
            Http::fail(403, "Accesso riservato all'admin");
        }
        return $user;
    }
}

/** Limite di tentativi per IP (tabella rate_hit): protegge login e richieste di reset. */
final class RateLimit
{
    private static function bucket(string $name): string
    {
        return $name . ':' . ($_SERVER['REMOTE_ADDR'] ?? '-');
    }

    public static function tooMany(string $name, int $max, int $windowSeconds): bool
    {
        $n = (int)Db::one(
            'SELECT COUNT(*) AS n FROM rate_hit WHERE bucket = ? AND ts > ?',
            [self::bucket($name), time() - $windowSeconds]
        )['n'];
        return $n >= $max;
    }

    public static function hit(string $name): void
    {
        Db::exec('DELETE FROM rate_hit WHERE ts < ?', [time() - 86400]);
        Db::exec('INSERT INTO rate_hit (bucket, ts) VALUES (?, ?)', [self::bucket($name), time()]);
    }
}
