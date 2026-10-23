<?php
// Preflight Aruba — TEMPORANEO. Va cancellato dal server dopo l'uso.
// Il token viene sostituito dallo script di upload.
header('Content-Type: application/json; charset=utf-8');
$TOKEN = '__TOKEN__';
if (!hash_equals($TOKEN, (string)($_GET['t'] ?? ''))) {
    http_response_code(403);
    echo '{"detail":"forbidden"}';
    exit;
}

function out($data) { echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT); exit; }

$mode = $_GET['mode'] ?? 'info';

if ($mode === 'sleep') {
    $n = min(max((int)($_GET['n'] ?? 5), 0), 120);
    set_time_limit($n + 10);
    ignore_user_abort(true);
    sleep($n);
    out(['slept' => $n]);
}

if ($mode === 'sqlite') {
    $dir = __DIR__ . '/api/data';
    $res = ['dir' => $dir, 'dir_exists' => is_dir($dir), 'dir_writable' => is_writable($dir)];
    try {
        $pdo = new PDO('sqlite:' . $dir . '/preflight.db');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->exec('PRAGMA busy_timeout=5000');
        $pdo->exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)');
        $pdo->prepare('INSERT INTO t (v) VALUES (?)')->execute([date('c')]);
        $res['rows'] = (int)$pdo->query('SELECT COUNT(*) FROM t')->fetchColumn();
        $res['sqlite_version'] = $pdo->query('SELECT sqlite_version()')->fetchColumn();
        $res['journal_mode'] = $pdo->query('PRAGMA journal_mode')->fetchColumn();
        $res['ok'] = true;
    } catch (Throwable $e) {
        $res['ok'] = false;
        $res['error'] = $e->getMessage();
    }
    out($res);
}

if ($mode === 'curl') {
    $targets = [
        'groq'      => 'https://api.groq.com/openai/v1/models',
        'genius'    => 'https://api.genius.com/search?q=test',
        'lyrics_ovh'=> 'https://api.lyrics.ovh/v1/Coldplay/Yellow',
        'songsterr' => 'https://www.songsterr.com/a/ra/songs.json?pattern=coldplay',
    ];
    $res = [];
    foreach ($targets as $name => $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_USERAGENT => 'BandManager/1.0',
        ]);
        $body = curl_exec($ch);
        $res[$name] = [
            'http' => curl_getinfo($ch, CURLINFO_RESPONSE_CODE),
            'time' => round(curl_getinfo($ch, CURLINFO_TOTAL_TIME), 2),
            'bytes' => is_string($body) ? strlen($body) : 0,
            'error' => curl_error($ch) ?: null,
        ];
        curl_close($ch);
    }
    out($res);
}

// info / api (raggiunta anche via rewrite /api/...)
$auth = [
    'HTTP_AUTHORIZATION'          => $_SERVER['HTTP_AUTHORIZATION'] ?? null,
    'REDIRECT_HTTP_AUTHORIZATION' => $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null,
    'HTTP_X_AUTH_TOKEN'           => $_SERVER['HTTP_X_AUTH_TOKEN'] ?? null,
];
out([
    'php' => PHP_VERSION,
    'sapi' => PHP_SAPI,
    'ext' => [
        'pdo_sqlite' => extension_loaded('pdo_sqlite'),
        'curl' => extension_loaded('curl'),
        'mbstring' => extension_loaded('mbstring'),
        'sodium' => extension_loaded('sodium'),
    ],
    'max_execution_time' => ini_get('max_execution_time'),
    'allow_url_fopen' => ini_get('allow_url_fopen'),
    'host' => $_SERVER['HTTP_HOST'] ?? null,
    'https' => $_SERVER['HTTPS'] ?? null,
    'request_uri' => $_SERVER['REQUEST_URI'] ?? null,
    'redirect_url' => $_SERVER['REDIRECT_URL'] ?? null,
    'method' => $_SERVER['REQUEST_METHOD'] ?? null,
    'path_param' => $_GET['path'] ?? null,
    'script_filename' => $_SERVER['SCRIPT_FILENAME'] ?? null,
    'document_root' => $_SERVER['DOCUMENT_ROOT'] ?? null,
    'auth_seen' => $auth,
]);
