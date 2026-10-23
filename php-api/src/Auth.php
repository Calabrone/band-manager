<?php
declare(strict_types=1);

final class Auth
{
    private const TOKEN_DAYS = 7;

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

    public static function createToken(int $userId): string
    {
        $header = self::b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = self::b64(json_encode(['sub' => (string)$userId, 'exp' => time() + self::TOKEN_DAYS * 86400]));
        $sig = self::b64(hash_hmac('sha256', "$header.$payload", Config::get('secret_key'), true));
        return "$header.$payload.$sig";
    }

    /** Ritorna l'id utente se il token e' valido (firma HS256 + scadenza), altrimenti null. */
    public static function decodeToken(string $token): ?int
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
        return ctype_digit((string)$payload['sub']) ? (int)$payload['sub'] : null;
    }

    public static function currentUser(): array
    {
        $token = Http::bearerToken();
        $id = $token === null ? null : self::decodeToken($token);
        if ($id === null) {
            Http::fail(401, 'Token non valido');
        }
        $user = Db::one('SELECT * FROM "user" WHERE id = ?', [$id]);
        if ($user === null) {
            Http::fail(401, 'Utente non trovato');
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
