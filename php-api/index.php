<?php
declare(strict_types=1);

// Front controller dell'API: .htaccess instrada qui tutto /api/*.
ini_set('display_errors', '0');

foreach (['Http', 'Db', 'Auth', 'Services', 'Media', 'Enrich', 'Routes'] as $file) {
    require __DIR__ . "/src/$file.php";
}

set_exception_handler(function (Throwable $e): void {
    if ($e instanceof HttpError) {
        Http::send(['detail' => $e->detail], $e->status);
    }
    Http::log(get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    Http::send(['detail' => 'Errore interno'], 500);
});

// Path relativo alla cartella dello script (funziona con qualsiasi prefisso, es. /band/api)
$uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
$path = str_starts_with($uriPath, $base) ? substr($uriPath, strlen($base)) : $uriPath;
$path = '/' . trim($path, '/');

Routes::dispatch($_SERVER['REQUEST_METHOD'] ?? 'GET', $path);
