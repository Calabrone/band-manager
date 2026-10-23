<?php
declare(strict_types=1);

final class HttpError extends Exception
{
    public function __construct(public int $status, public string $detail)
    {
        parent::__construct($detail);
    }
}

final class Http
{
    public static function send(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        if ($status !== 204) {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
        }
        exit;
    }

    public static function fail(int $status, string $detail): never
    {
        throw new HttpError($status, $detail);
    }

    /**
     * Legge il body JSON. $fields: nome => tipo ('string', 'int', oppure '?string'/'?int' se opzionale).
     * Campi mancanti o di tipo errato -> 422 (come la validazione Pydantic di FastAPI).
     */
    public static function body(array $fields = []): array
    {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw === false || trim($raw) === '' ? '{}' : $raw, true);
        if (!is_array($data)) {
            self::fail(422, 'Corpo della richiesta non valido');
        }
        $out = [];
        foreach ($fields as $name => $type) {
            $optional = $type[0] === '?';
            $t = ltrim($type, '?');
            $present = array_key_exists($name, $data) && $data[$name] !== null;
            if (!$present) {
                if (!$optional) {
                    self::fail(422, "Campo obbligatorio mancante: $name");
                }
                $out[$name] = null;
                continue;
            }
            $v = $data[$name];
            $ok = $t === 'string' ? is_string($v) : is_int($v);
            if (!$ok) {
                self::fail(422, "Tipo non valido per il campo: $name");
            }
            $out[$name] = $v;
        }
        return $out;
    }

    /** Token JWT da Authorization: Bearer, con fallback su X-Auth-Token (CGI/FastCGI puo' scartare Authorization). */
    public static function bearerToken(): ?string
    {
        foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $key) {
            $v = trim((string)($_SERVER[$key] ?? ''));
            if ($v !== '' && stripos($v, 'Bearer ') === 0) {
                return trim(substr($v, 7));
            }
        }
        $x = trim((string)($_SERVER['HTTP_X_AUTH_TOKEN'] ?? ''));
        return $x !== '' ? $x : null;
    }

    public static function log(string $message): void
    {
        $file = dirname(__DIR__) . '/data/error.log';
        @file_put_contents($file, '[' . gmdate('c') . '] ' . $message . "\n", FILE_APPEND | LOCK_EX);
    }
}
