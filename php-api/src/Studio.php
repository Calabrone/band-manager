<?php
declare(strict_types=1);

/**
 * Sala prove: brani di prova con contenuti audio/video, marker e commenti.
 * Spec: .kiro/specs/rehearsal-studio/. Le route sono nella tabella di Routes.php ("Studio::metodo").
 */
final class Studio
{
    public const STATUSES = ['idea', 'lavorazione', 'pronto', 'promosso', 'archiviato'];
    /** Stati impostabili a mano: "promosso" si raggiunge solo con la promozione. */
    private const SETTABLE = ['idea', 'lavorazione', 'pronto', 'archiviato'];

    private const DESC_PROJECT_MAX = 2000;
    private const DESC_TAKE_MAX = 1000;
    private const KEY_MAX = 20;
    private const LABEL_MAX = 80;
    private const COMMENT_MAX = 2000;
    private const MIN_TRIM_MS = 200;
    private const MAX_OFFSET_MS = 2000;
    private const MAX_DURATION_MS = 43200000;   // 12 ore
    private const PEAKS_MAX_COUNT = 16000;
    private const PEAKS_MAX_BYTES = 120000;
    /** Tolleranza sulla durata dichiarata dal client (metadata dei browser imprecisi). */
    private const DURATION_SLACK_MS = 500;

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static function n(mixed $v): ?int
    {
        return $v === null ? null : (int)$v;
    }

    /** Corpo JSON grezzo: serve per distinguere un campo assente da uno null (che cancella il valore). */
    private static function json(): array
    {
        $raw = file_get_contents('php://input');
        $d = json_decode($raw === false || trim($raw) === '' ? '{}' : $raw, true);
        if (!is_array($d)) {
            Http::fail(422, 'Corpo della richiesta non valido');
        }
        return $d;
    }

    /** Testo ripulito; null se vuoto (errore 400 se $required). */
    private static function text(mixed $v, int $max, string $label, bool $required = false): ?string
    {
        if ($v === null) {
            if ($required) {
                Http::fail(400, "$label è obbligatorio");
            }
            return null;
        }
        if (!is_string($v)) {
            Http::fail(422, "Tipo non valido per il campo: $label");
        }
        $v = trim($v);
        if ($v === '') {
            if ($required) {
                Http::fail(400, "$label è obbligatorio");
            }
            return null;
        }
        if (mb_strlen($v) > $max) {
            Http::fail(400, "$label troppo lungo (max $max caratteri)");
        }
        return $v;
    }

    private static function checkBpm(mixed $v): ?int
    {
        if ($v === null) {
            return null;
        }
        if (!is_int($v)) {
            Http::fail(422, 'Tipo non valido per il campo: bpm');
        }
        if ($v < 40 || $v > 300) {
            Http::fail(400, 'BPM non valido (da 40 a 300)');
        }
        return $v;
    }

    private static function touch(int $projectId): void
    {
        Db::exec('UPDATE studio_project SET last_activity_at = ? WHERE id = ?', [Db::now(), $projectId]);
    }

    private static function project(int $id): array
    {
        $p = Db::one('SELECT * FROM studio_project WHERE id = ?', [$id]);
        if ($p === null) {
            Http::fail(404, 'Brano di prova non trovato');
        }
        return $p;
    }

    private static function take(int $id): array
    {
        $t = Db::one('SELECT * FROM studio_take WHERE id = ?', [$id]);
        if ($t === null) {
            Http::fail(404, 'Contenuto non trovato');
        }
        return $t;
    }

    /** Il brano di prova lo gestisce chi l'ha creato o l'admin. */
    private static function requireProjectOwner(array $project, array $user): void
    {
        if ((int)$project['created_by_id'] !== (int)$user['id'] && $user['role'] !== 'admin') {
            Http::fail(403, "Solo chi ha creato il brano o l'admin può farlo");
        }
    }

    /** Contenuti, marker e commenti li modifica solo l'autore (nemmeno l'admin). */
    private static function requireAuthor(array $row, array $user): void
    {
        if ((int)$row['user_id'] !== (int)$user['id']) {
            Http::fail(403, 'Puoi modificare solo i tuoi contenuti');
        }
    }

    // ── Output ───────────────────────────────────────────────────────────────

    private static function projectOut(array $p): array
    {
        $take = Db::one(
            'SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM studio_take WHERE project_id = ?',
            [(int)$p['id']]
        );
        return [
            'id' => (int)$p['id'],
            'title' => $p['title'],
            'description' => $p['description'],
            'status' => $p['status'],
            'bpm' => self::n($p['bpm']),
            'music_key' => $p['music_key'],
            'created_by_id' => (int)$p['created_by_id'],
            'created_by' => Routes::username((int)$p['created_by_id']),
            'song_id' => self::n($p['song_id']),
            'has_lyrics' => trim((string)($p['lyrics'] ?? '')) !== '',
            'take_count' => (int)$take['n'],
            'total_bytes' => (int)$take['bytes'],
            'created_at' => Db::iso($p['created_at']),
            'updated_at' => Db::iso($p['updated_at']),
            'last_activity_at' => Db::iso($p['last_activity_at']),
        ];
    }

    private static function fileUrl(array $t): string
    {
        [$exp, $sig] = Media::sign((int)$t['id'], 'take');
        return Routes::appUrl() . "/api/studio/takes/{$t['id']}/file?e=$exp&s=$sig";
    }

    private static function takeOut(array $t, bool $full = false): array
    {
        $id = (int)$t['id'];
        $out = [
            'id' => $id,
            'project_id' => (int)$t['project_id'],
            'user_id' => (int)$t['user_id'],
            'username' => Routes::username((int)$t['user_id']),
            'title' => $t['title'],
            'description' => $t['description'],
            'kind' => $t['kind'],
            'original_name' => $t['original_name'],
            'mime' => $t['mime'],
            'size' => (int)$t['size'],
            'duration_ms' => self::n($t['duration_ms']),
            'trim_start_ms' => self::n($t['trim_start_ms']),
            'trim_end_ms' => self::n($t['trim_end_ms']),
            'base_take_id' => self::n($t['base_take_id']),
            'offset_ms' => self::n($t['offset_ms']),
            'sync_ms' => self::n($t['sync_ms']),
            'base_start_ms' => self::n($t['base_start_ms']),
            'base_loop_start_ms' => self::n($t['base_loop_start_ms']),
            'base_loop_end_ms' => self::n($t['base_loop_end_ms']),
            'recorded_in_app' => (bool)(int)$t['recorded_in_app'],
            'has_peaks' => $t['peaks'] !== null,
            'file_url' => self::fileUrl($t),
            'marker_count' => isset($t['marker_count'])
                ? (int)$t['marker_count']
                : (int)Db::one('SELECT COUNT(*) AS n FROM studio_marker WHERE take_id = ?', [$id])['n'],
            'comment_count' => isset($t['comment_count'])
                ? (int)$t['comment_count']
                : (int)Db::one('SELECT COUNT(*) AS n FROM studio_comment WHERE take_id = ?', [$id])['n'],
            'created_at' => Db::iso($t['created_at']),
            'updated_at' => Db::iso($t['updated_at']),
        ];
        if ($full) {
            $out['peaks'] = $t['peaks'] === null ? null : json_decode($t['peaks'], true);
            $out['base'] = null;
            if ($t['base_take_id'] !== null && ($b = Db::one('SELECT * FROM studio_take WHERE id = ?', [(int)$t['base_take_id']])) !== null) {
                $out['base'] = [
                    'id' => (int)$b['id'],
                    'title' => $b['title'],
                    'username' => Routes::username((int)$b['user_id']),
                    'kind' => $b['kind'],
                    'mime' => $b['mime'],
                    'duration_ms' => self::n($b['duration_ms']),
                    'trim_start_ms' => self::n($b['trim_start_ms']),
                    'trim_end_ms' => self::n($b['trim_end_ms']),
                    'file_url' => self::fileUrl($b),
                    'peaks' => $b['peaks'] === null ? null : json_decode($b['peaks'], true),
                ];
            }
        }
        return $out;
    }

    private static function markerOut(array $m): array
    {
        return [
            'id' => (int)$m['id'],
            'take_id' => (int)$m['take_id'],
            'user_id' => (int)$m['user_id'],
            'username' => Routes::username((int)$m['user_id']),
            'time_ms' => (int)$m['time_ms'],
            'label' => $m['label'],
            'created_at' => Db::iso($m['created_at']),
            'updated_at' => Db::iso($m['updated_at']),
        ];
    }

    private static function commentOut(array $c): array
    {
        return [
            'id' => (int)$c['id'],
            'take_id' => (int)$c['take_id'],
            'user_id' => (int)$c['user_id'],
            'username' => Routes::username((int)$c['user_id']),
            'content' => $c['content'],
            'created_at' => Db::iso($c['created_at']),
            'updated_at' => Db::iso($c['updated_at']),
        ];
    }

    // ── Brani di prova ───────────────────────────────────────────────────────

    public static function listProjects(array $p, array $user): void
    {
        $raw = $_GET['status'] ?? null;
        $wanted = [];
        foreach (is_array($raw) ? $raw : (is_string($raw) ? explode(',', $raw) : []) as $s) {
            if (is_string($s) && in_array(trim($s), self::STATUSES, true)) {
                $wanted[] = trim($s);
            }
        }
        if ($wanted === []) {
            $wanted = array_values(array_diff(self::STATUSES, ['archiviato']));
        }
        $in = implode(',', array_fill(0, count($wanted), '?'));
        $rows = Db::all("SELECT * FROM studio_project WHERE status IN ($in) ORDER BY last_activity_at DESC, id DESC", $wanted);
        Http::send(array_map([self::class, 'projectOut'], $rows));
    }

    public static function createProject(array $p, array $user): void
    {
        $b = self::json();
        $title = self::text($b['title'] ?? null, Media::TITLE_MAX, 'Il titolo', true);
        $desc = self::text($b['description'] ?? null, self::DESC_PROJECT_MAX, 'Descrizione');
        $bpm = self::checkBpm($b['bpm'] ?? null);
        $key = self::text($b['music_key'] ?? null, self::KEY_MAX, 'Tonalità');
        $now = Db::now();
        $id = Db::insert(
            "INSERT INTO studio_project (title, description, status, bpm, music_key, created_by_id, created_at, updated_at, last_activity_at)
             VALUES (?, ?, 'idea', ?, ?, ?, ?, ?, ?)",
            [$title, $desc, $bpm, $key, $user['id'], $now, $now, $now]
        );
        Http::send(self::projectOut(self::project($id)), 201);
    }

    public static function getProject(array $p, array $user): void
    {
        $pr = self::project($p['pid']);
        $takes = Db::all(
            'SELECT t.*,
                    (SELECT COUNT(*) FROM studio_marker m WHERE m.take_id = t.id) AS marker_count,
                    (SELECT COUNT(*) FROM studio_comment c WHERE c.take_id = t.id) AS comment_count
             FROM studio_take t WHERE t.project_id = ? ORDER BY t.created_at, t.id',
            [$pr['id']]
        );
        $out = self::projectOut($pr);
        $out['lyrics'] = $pr['lyrics'];
        $out['takes'] = array_map(fn(array $t) => self::takeOut($t), $takes);
        Http::send($out);
    }

    public static function updateProject(array $p, array $user): void
    {
        $pr = self::project($p['pid']);
        self::requireProjectOwner($pr, $user);
        $b = self::json();
        $title = array_key_exists('title', $b) ? self::text($b['title'], Media::TITLE_MAX, 'Il titolo', true) : $pr['title'];
        $desc = array_key_exists('description', $b) ? self::text($b['description'], self::DESC_PROJECT_MAX, 'Descrizione') : $pr['description'];
        $bpm = array_key_exists('bpm', $b) ? self::checkBpm($b['bpm']) : self::n($pr['bpm']);
        $key = array_key_exists('music_key', $b) ? self::text($b['music_key'], self::KEY_MAX, 'Tonalità') : $pr['music_key'];
        Db::exec(
            'UPDATE studio_project SET title = ?, description = ?, bpm = ?, music_key = ?, updated_at = ? WHERE id = ?',
            [$title, $desc, $bpm, $key, Db::now(), $pr['id']]
        );
        Http::send(self::projectOut(self::project((int)$pr['id'])));
    }

    public static function setStatus(array $p, array $user): void
    {
        $b = Http::body(['status' => 'string']);
        $pr = self::project($p['pid']);
        self::requireProjectOwner($pr, $user);
        if ($pr['status'] === 'promosso') {
            Http::fail(409, 'Il brano è già stato promosso: per cambiarne lo stato elimina prima il brano nella lista');
        }
        if (!in_array($b['status'], self::SETTABLE, true)) {
            Http::fail(400, $b['status'] === 'promosso' ? 'Per promuovere un brano usa la promozione' : 'Stato non valido');
        }
        Db::exec('UPDATE studio_project SET status = ?, updated_at = ? WHERE id = ?', [$b['status'], Db::now(), $pr['id']]);
        Http::send(self::projectOut(self::project((int)$pr['id'])));
    }

    /** Sposta un brano Pronto nelle sezioni delle cover: crea il brano (inedito) e collega il progetto. */
    public static function promote(array $p, array $user): void
    {
        $b = Http::body(['title' => 'string', 'artist' => 'string', 'category' => 'string']);
        $title = self::text($b['title'], Media::TITLE_MAX, 'Il titolo', true);
        $artist = self::text($b['artist'], Media::TITLE_MAX, "L'artista", true);
        if (!in_array($b['category'], Routes::CATEGORIES, true)) {
            Http::fail(400, 'Categoria non valida');
        }
        $pdo = Db::pdo();
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            $pr = self::project($p['pid']);
            self::requireProjectOwner($pr, $user);
            if ($pr['status'] !== 'pronto') {
                Http::fail(409, $pr['status'] === 'promosso'
                    ? 'Il brano è già stato promosso'
                    : 'Solo un brano in stato "Pronto" si può promuovere');
            }
            Routes::assertNotDuplicate($artist, $title);
            $hasLyrics = trim((string)$pr['lyrics']) !== '';
            $now = Db::now();
            $songId = Db::insert(
                "INSERT INTO song (artist, title, category, validated, validation_error, unverified, lyrics, lyrics_source,
                                   proposed_by_id, last_modified_by_id, created_at, updated_at)
                 VALUES (?, ?, ?, 1, NULL, 1, ?, ?, ?, ?, ?, ?)",
                [$artist, $title, $b['category'], $hasLyrics ? $pr['lyrics'] : null, $hasLyrics ? 'manual' : null,
                 $user['id'], $user['id'], $now, $now]
            );
            Db::exec(
                "UPDATE studio_project SET status = 'promosso', song_id = ?, updated_at = ?, last_activity_at = ? WHERE id = ?",
                [$songId, $now, $now, $pr['id']]
            );
            $pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $pdo->exec('ROLLBACK');
            throw $e;
        }
        Http::send(['song_id' => $songId], 201);
    }

    public static function deleteProject(array $p, array $user): void
    {
        $pr = self::project($p['pid']);
        self::requireProjectOwner($pr, $user);
        if ($pr['song_id'] !== null && Db::one('SELECT id FROM song WHERE id = ?', [(int)$pr['song_id']]) !== null) {
            Http::fail(409, 'Il brano è stato promosso: elimina prima il brano nella lista principale');
        }
        foreach (Db::all('SELECT * FROM studio_take WHERE project_id = ?', [$pr['id']]) as $t) {
            self::removeTake($t);
        }
        Db::exec('DELETE FROM studio_project_comment WHERE project_id = ?', [$pr['id']]);
        Db::exec('DELETE FROM studio_project_video WHERE project_id = ?', [$pr['id']]);
        Db::exec('DELETE FROM studio_project WHERE id = ?', [$pr['id']]);
        Http::send(null, 204);
    }

    public static function usage(array $p, array $user): void
    {
        $r = Db::one('SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS n FROM studio_take');
        Http::send(['bytes' => (int)$r['bytes'], 'count' => (int)$r['n']]);
    }

    // ── Contenuti ────────────────────────────────────────────────────────────

    /** Intero da un campo multipart; null se assente o vuoto, 422 se non valido o fuori intervallo. */
    private static function formInt(string $name, ?int $min = null, ?int $max = null): ?int
    {
        $v = $_POST[$name] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v) || !preg_match('/^-?\d{1,9}$/', $v)) {
            Http::fail(422, "Valore non valido per il campo: $name");
        }
        $n = (int)$v;
        if (($min !== null && $n < $min) || ($max !== null && $n > $max)) {
            Http::fail(422, "Valore fuori intervallo per il campo: $name");
        }
        return $n;
    }

    /** Taglio predefinito: o entrambi i valori o nessuno; durata minima; non oltre la durata del contenuto. */
    private static function checkTrim(?int $start, ?int $end, ?int $duration): void
    {
        if (($start === null) !== ($end === null)) {
            Http::fail(422, 'Indica sia l\'inizio sia la fine del taglio');
        }
        if ($start === null) {
            return;
        }
        if ($start < 0 || $end - $start < self::MIN_TRIM_MS) {
            Http::fail(422, 'Taglio non valido (almeno ' . self::MIN_TRIM_MS . ' ms)');
        }
        if ($duration !== null && $end > $duration + self::DURATION_SLACK_MS) {
            Http::fail(422, 'Il taglio supera la durata del contenuto');
        }
    }

    /** Forma d'onda facoltativa: lista di interi 0-255; qualunque anomalia la scarta senza errore. */
    private static function cleanPeaks(mixed $raw): ?string
    {
        if (!is_string($raw) || $raw === '' || strlen($raw) > self::PEAKS_MAX_BYTES) {
            return null;
        }
        $a = json_decode($raw, true);
        if (!is_array($a) || $a === [] || !array_is_list($a) || count($a) > self::PEAKS_MAX_COUNT) {
            return null;
        }
        foreach ($a as $v) {
            if (!is_int($v) || $v < 0 || $v > 255) {
                return null;
            }
        }
        return json_encode($a);
    }

    public static function createTake(array $p, array $user): void
    {
        ignore_user_abort(true);
        set_time_limit(300);
        $pr = self::project($p['pid']);
        $max = Media::maxUploadBytes();
        $tooBig = 'File troppo grande' . ($max > 0 ? ' (max ' . (int)floor($max / 1048576) . ' MB)' : '');
        // post_max_size superato: PHP scarta tutto e lascia $_POST e $_FILES vuoti
        if ($_FILES === [] && $_POST === [] && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
            Http::fail(413, $tooBig);
        }
        $f = $_FILES['file'] ?? null;
        if (!is_array($f) || is_array($f['name'] ?? null)) {
            Http::fail(422, 'Campo obbligatorio mancante: file');
        }
        if (in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            Http::fail(413, $tooBig);
        }
        if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
            Http::fail(400, 'Upload non riuscito, riprova');
        }
        $b = Http::form([
            'kind' => 'string', 'title' => 'string', 'description' => '?string', 'peaks' => '?string', 'recorded_in_app' => '?string',
        ]);
        $kind = $b['kind'];
        if (!in_array($kind, ['audio', 'video'], true)) {
            Http::fail(400, 'Tipo di contenuto non valido (audio o video)');
        }
        $title = self::text($b['title'], Media::TITLE_MAX, 'Il titolo', true);
        $desc = self::text($b['description'], self::DESC_TAKE_MAX, 'Descrizione');

        $duration = self::formInt('duration_ms', 0, self::MAX_DURATION_MS);
        $trimStart = self::formInt('trim_start_ms', 0, self::MAX_DURATION_MS);
        $trimEnd = self::formInt('trim_end_ms', 0, self::MAX_DURATION_MS);
        self::checkTrim($trimStart, $trimEnd, $duration);

        $baseId = self::formInt('base_take_id', 1);
        $offset = self::formInt('offset_ms', -self::MAX_OFFSET_MS, self::MAX_OFFSET_MS);
        $sync = self::formInt('sync_ms', 0, self::MAX_DURATION_MS);
        $baseStart = self::formInt('base_start_ms', 0, self::MAX_DURATION_MS);
        $loopStart = self::formInt('base_loop_start_ms', 0, self::MAX_DURATION_MS);
        $loopEnd = self::formInt('base_loop_end_ms', 0, self::MAX_DURATION_MS);
        if ($baseId !== null) {
            $base = Db::one('SELECT id FROM studio_take WHERE id = ? AND project_id = ?', [$baseId, $pr['id']]);
            if ($base === null) {
                Http::fail(422, 'Il contenuto di base deve appartenere allo stesso brano di prova');
            }
            if (($loopStart === null) !== ($loopEnd === null) || ($loopStart !== null && $loopEnd - $loopStart < self::MIN_TRIM_MS)) {
                Http::fail(422, 'Loop della base non valido');
            }
        } elseif ($offset !== null || $sync !== null || $baseStart !== null || $loopStart !== null || $loopEnd !== null) {
            Http::fail(422, 'I dati di sovraincisione richiedono un contenuto di base');
        }

        $original = (string)preg_replace('/[\x00-\x1F\x7F]+/u', '', basename(str_replace('\\', '/', (string)$f['name'])));
        $ext = strtolower(pathinfo($original, PATHINFO_EXTENSION));
        $mime = Media::studioMime($ext, $kind);
        if ($mime === null) {
            Http::fail(400, 'Formato non supportato per ' . ($kind === 'video' ? 'un video' : 'un audio')
                . ' (ammessi: ' . implode(', ', Media::studioExts($kind)) . ')');
        }
        $size = (int)$f['size'];
        if ($size <= 0) {
            Http::fail(400, 'Il file è vuoto');
        }

        $dir = Media::studioDir();
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            Http::fail(500, 'Cartella dei contenuti non disponibile');
        }
        $stored = bin2hex(random_bytes(16));   // nessuna estensione: il file non e' mai eseguibile
        if (!move_uploaded_file($f['tmp_name'], Media::studioPath($stored))) {
            Http::fail(500, 'Salvataggio del file non riuscito');
        }
        $now = Db::now();
        try {
            $id = Db::insert(
                'INSERT INTO studio_take (project_id, user_id, title, description, kind, original_name, stored_name, ext, mime, size,
                                          duration_ms, trim_start_ms, trim_end_ms, peaks, base_take_id, offset_ms, sync_ms, base_start_ms,
                                          base_loop_start_ms, base_loop_end_ms, recorded_in_app, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$pr['id'], $user['id'], $title, $desc, $kind, mb_substr($original, 0, 200), $stored, $ext, $mime, $size,
                 $duration, $trimStart, $trimEnd, self::cleanPeaks($b['peaks']), $baseId, $offset, $sync, $baseStart,
                 $loopStart, $loopEnd, $b['recorded_in_app'] === '1' ? 1 : 0, $now, $now]
            );
        } catch (Throwable $e) {
            @unlink(Media::studioPath($stored));
            throw $e;
        }
        self::touch((int)$pr['id']);
        Http::send(self::takeOut(self::take($id)), 201);
    }

    public static function getTake(array $p, array $user): void
    {
        Http::send(self::takeOut(self::take($p['tid']), true));
    }

    public static function updateTake(array $p, array $user): void
    {
        $t = self::take($p['tid']);
        self::requireAuthor($t, $user);
        $b = self::json();
        $title = array_key_exists('title', $b) ? self::text($b['title'], Media::TITLE_MAX, 'Il titolo', true) : $t['title'];
        $desc = array_key_exists('description', $b) ? self::text($b['description'], self::DESC_TAKE_MAX, 'Descrizione') : $t['description'];

        $start = self::n($t['trim_start_ms']);
        $end = self::n($t['trim_end_ms']);
        if (array_key_exists('trim_start_ms', $b) || array_key_exists('trim_end_ms', $b)) {
            if (!array_key_exists('trim_start_ms', $b) || !array_key_exists('trim_end_ms', $b)) {
                Http::fail(422, 'Indica sia l\'inizio sia la fine del taglio');
            }
            foreach (['trim_start_ms', 'trim_end_ms'] as $k) {
                if ($b[$k] !== null && (!is_int($b[$k]) || $b[$k] > self::MAX_DURATION_MS)) {
                    Http::fail(422, "Valore non valido per il campo: $k");
                }
            }
            [$start, $end] = [$b['trim_start_ms'], $b['trim_end_ms']];
            self::checkTrim($start, $end, self::n($t['duration_ms']));
        }

        $offset = self::n($t['offset_ms']);
        if (array_key_exists('offset_ms', $b)) {
            if ($t['base_take_id'] === null) {
                Http::fail(422, "L'offset vale solo per le sovraincisioni");
            }
            if ($b['offset_ms'] !== null && (!is_int($b['offset_ms']) || abs($b['offset_ms']) > self::MAX_OFFSET_MS)) {
                Http::fail(422, 'Offset non valido (±' . self::MAX_OFFSET_MS . ' ms)');
            }
            $offset = $b['offset_ms'];
        }
        Db::exec(
            'UPDATE studio_take SET title = ?, description = ?, trim_start_ms = ?, trim_end_ms = ?, offset_ms = ?, updated_at = ? WHERE id = ?',
            [$title, $desc, $start, $end, $offset, Db::now(), $t['id']]
        );
        self::touch((int)$t['project_id']);
        Http::send(self::takeOut(self::take((int)$t['id']), true));
    }

    /** Elimina un contenuto: file, marker, commenti; le sovraincisioni costruite sopra restano come contenuti normali. */
    private static function removeTake(array $t): void
    {
        @unlink(Media::studioPath($t['stored_name']));
        Db::exec('DELETE FROM studio_marker WHERE take_id = ?', [$t['id']]);
        Db::exec('DELETE FROM studio_comment WHERE take_id = ?', [$t['id']]);
        Db::exec(
            'UPDATE studio_take SET base_take_id = NULL, offset_ms = NULL, sync_ms = NULL, base_start_ms = NULL,
                    base_loop_start_ms = NULL, base_loop_end_ms = NULL WHERE base_take_id = ?',
            [$t['id']]
        );
        Db::exec('DELETE FROM studio_take WHERE id = ?', [$t['id']]);
    }

    public static function deleteTake(array $p, array $user): void
    {
        $t = self::take($p['tid']);
        self::requireAuthor($t, $user);
        self::removeTake($t);
        self::touch((int)$t['project_id']);
        Http::send(null, 204);
    }

    public static function takeFile(array $p, ?array $user): void
    {
        $t = self::take($p['tid']);
        if (!Media::verify($p['tid'], $_GET['e'] ?? null, $_GET['s'] ?? null, 'take')) {
            Http::fail(403, 'Link non valido o scaduto');
        }
        Media::stream($t, ($_GET['dl'] ?? '') === '1', Media::studioDir(), $t['mime']);
    }

    // ── Marker ───────────────────────────────────────────────────────────────

    private static function marker(array $p): array
    {
        $m = Db::one('SELECT * FROM studio_marker WHERE id = ? AND take_id = ?', [$p['mid'], $p['tid']]);
        if ($m === null) {
            Http::fail(404, 'Marker non trovato');
        }
        return $m;
    }

    private static function checkMarkerTime(mixed $v, array $take): int
    {
        if (!is_int($v)) {
            Http::fail(422, 'Tipo non valido per il campo: time_ms');
        }
        $dur = self::n($take['duration_ms']);
        if ($v < 0 || $v > self::MAX_DURATION_MS || ($dur !== null && $v > $dur + self::DURATION_SLACK_MS)) {
            Http::fail(422, 'Posizione del marker non valida');
        }
        return $v;
    }

    public static function listMarkers(array $p, array $user): void
    {
        self::take($p['tid']);
        $rows = Db::all('SELECT * FROM studio_marker WHERE take_id = ? ORDER BY time_ms, id', [$p['tid']]);
        Http::send(array_map([self::class, 'markerOut'], $rows));
    }

    public static function createMarker(array $p, array $user): void
    {
        $t = self::take($p['tid']);
        $b = self::json();
        $time = self::checkMarkerTime($b['time_ms'] ?? null, $t);
        $label = self::text($b['label'] ?? null, self::LABEL_MAX, 'La nota', true);
        $now = Db::now();
        $id = Db::insert(
            'INSERT INTO studio_marker (take_id, user_id, time_ms, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [$t['id'], $user['id'], $time, $label, $now, $now]
        );
        self::touch((int)$t['project_id']);
        Http::send(self::markerOut(Db::one('SELECT * FROM studio_marker WHERE id = ?', [$id])), 201);
    }

    public static function updateMarker(array $p, array $user): void
    {
        $t = self::take($p['tid']);
        $m = self::marker($p);
        self::requireAuthor($m, $user);
        $b = self::json();
        $time = array_key_exists('time_ms', $b) ? self::checkMarkerTime($b['time_ms'], $t) : (int)$m['time_ms'];
        $label = array_key_exists('label', $b) ? self::text($b['label'], self::LABEL_MAX, 'La nota', true) : $m['label'];
        Db::exec('UPDATE studio_marker SET time_ms = ?, label = ?, updated_at = ? WHERE id = ?', [$time, $label, Db::now(), $m['id']]);
        Http::send(self::markerOut(Db::one('SELECT * FROM studio_marker WHERE id = ?', [$m['id']])));
    }

    public static function deleteMarker(array $p, array $user): void
    {
        $t = self::take($p['tid']);
        $m = self::marker($p);
        self::requireAuthor($m, $user);
        Db::exec('DELETE FROM studio_marker WHERE id = ?', [$m['id']]);
        self::touch((int)$t['project_id']);
        Http::send(null, 204);
    }

    // ── Commenti ─────────────────────────────────────────────────────────────

    private static function comment(array $p): array
    {
        $c = Db::one('SELECT * FROM studio_comment WHERE id = ? AND take_id = ?', [$p['cid'], $p['tid']]);
        if ($c === null) {
            Http::fail(404, 'Commento non trovato');
        }
        return $c;
    }

    public static function listComments(array $p, array $user): void
    {
        self::take($p['tid']);
        $rows = Db::all('SELECT * FROM studio_comment WHERE take_id = ? ORDER BY created_at, id', [$p['tid']]);
        Http::send(array_map([self::class, 'commentOut'], $rows));
    }

    public static function createComment(array $p, array $user): void
    {
        $t = self::take($p['tid']);
        $b = Http::body(['content' => 'string']);
        $content = self::text($b['content'], self::COMMENT_MAX, 'Il commento', true);
        $now = Db::now();
        $id = Db::insert(
            'INSERT INTO studio_comment (take_id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            [$t['id'], $user['id'], $content, $now, $now]
        );
        self::touch((int)$t['project_id']);
        Http::send(self::commentOut(Db::one('SELECT * FROM studio_comment WHERE id = ?', [$id])), 201);
    }

    public static function updateComment(array $p, array $user): void
    {
        self::take($p['tid']);
        $c = self::comment($p);
        self::requireAuthor($c, $user);
        $b = Http::body(['content' => 'string']);
        $content = self::text($b['content'], self::COMMENT_MAX, 'Il commento', true);
        Db::exec('UPDATE studio_comment SET content = ?, updated_at = ? WHERE id = ?', [$content, Db::now(), $c['id']]);
        Http::send(self::commentOut(Db::one('SELECT * FROM studio_comment WHERE id = ?', [$c['id']])));
    }

    public static function deleteComment(array $p, array $user): void
    {
        $t = self::take($p['tid']);
        $c = self::comment($p);
        self::requireAuthor($c, $user);
        Db::exec('DELETE FROM studio_comment WHERE id = ?', [$c['id']]);
        self::touch((int)$t['project_id']);
        Http::send(null, 204);
    }

    // ── Testo del brano di prova ─────────────────────────────────────────────

    /** Il testo lo modificano tutti gli utenti autenticati (come per le cover). Testo vuoto = nessun testo. */
    public static function updateLyrics(array $p, array $user): void
    {
        $b = Http::body(['lyrics' => 'string']);
        $pr = self::project($p['pid']);
        $lyrics = Routes::cleanLyrics($b['lyrics']);
        if (mb_strlen($lyrics) > Routes::LYRICS_MAX) {
            Http::fail(400, 'Testo troppo lungo (max ' . Routes::LYRICS_MAX . ' caratteri)');
        }
        $now = Db::now();
        Db::exec(
            'UPDATE studio_project SET lyrics = ?, updated_at = ?, last_activity_at = ? WHERE id = ?',
            [trim($lyrics) === '' ? null : $lyrics, $now, $now, $pr['id']]
        );
        self::getProject($p, $user);
    }

    /** Legge testo e accordi da una foto. Non salva nulla: decide l'editor. */
    public static function ocrLyrics(array $p, array $user): void
    {
        self::project($p['pid']);
        Http::send(Routes::ocrUpload());
    }

    // ── Commenti del brano di prova ──────────────────────────────────────────

    private static function projectCommentOut(array $c): array
    {
        return [
            'id' => (int)$c['id'],
            'project_id' => (int)$c['project_id'],
            'user_id' => (int)$c['user_id'],
            'username' => Routes::username((int)$c['user_id']),
            'content' => $c['content'],
            'parent_id' => $c['parent_id'] === null ? null : (int)$c['parent_id'],
            'created_at' => Db::iso($c['created_at']),
            'updated_at' => Db::iso($c['updated_at']),
        ];
    }

    private static function projectComment(array $p): array
    {
        $c = Db::one('SELECT * FROM studio_project_comment WHERE id = ? AND project_id = ?', [$p['cid'], $p['pid']]);
        if ($c === null) {
            Http::fail(404, 'Commento non trovato');
        }
        return $c;
    }

    public static function listProjectComments(array $p, array $user): void
    {
        self::project($p['pid']);
        $rows = Db::all('SELECT * FROM studio_project_comment WHERE project_id = ? ORDER BY created_at, id', [$p['pid']]);
        Http::send(array_map([self::class, 'projectCommentOut'], $rows));
    }

    public static function createProjectComment(array $p, array $user): void
    {
        $b = Http::body(['content' => 'string', 'parent_id' => '?int']);
        $pr = self::project($p['pid']);
        $content = self::text($b['content'], self::COMMENT_MAX, 'Il commento', true);
        if ($b['parent_id'] !== null) {
            $parent = Db::one('SELECT * FROM studio_project_comment WHERE id = ?', [$b['parent_id']]);
            if ($parent === null || (int)$parent['project_id'] !== (int)$pr['id']) {
                Http::fail(400, 'Commento padre non valido');
            }
            if ($parent['parent_id'] !== null) {
                Http::fail(400, 'Nidificazione massima raggiunta');
            }
        }
        $now = Db::now();
        $id = Db::insert(
            'INSERT INTO studio_project_comment (project_id, user_id, content, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [$pr['id'], $user['id'], $content, $b['parent_id'], $now, $now]
        );
        self::touch((int)$pr['id']);
        Http::send(self::projectCommentOut(Db::one('SELECT * FROM studio_project_comment WHERE id = ?', [$id])), 201);
    }

    public static function updateProjectComment(array $p, array $user): void
    {
        self::project($p['pid']);
        $c = self::projectComment($p);
        self::requireAuthor($c, $user);
        $b = Http::body(['content' => 'string']);
        $content = self::text($b['content'], self::COMMENT_MAX, 'Il commento', true);
        Db::exec('UPDATE studio_project_comment SET content = ?, updated_at = ? WHERE id = ?', [$content, Db::now(), $c['id']]);
        Http::send(self::projectCommentOut(Db::one('SELECT * FROM studio_project_comment WHERE id = ?', [$c['id']])));
    }

    /** Elimina l'autore o l'admin (come per le cover); un commento principale porta via le risposte. */
    public static function deleteProjectComment(array $p, array $user): void
    {
        self::project($p['pid']);
        $c = self::projectComment($p);
        if ((int)$c['user_id'] !== (int)$user['id'] && $user['role'] !== 'admin') {
            Http::fail(403, 'Non puoi eliminare questo commento');
        }
        if ($c['parent_id'] === null) {
            Db::exec('DELETE FROM studio_project_comment WHERE parent_id = ?', [$c['id']]);
        }
        Db::exec('DELETE FROM studio_project_comment WHERE id = ?', [$c['id']]);
        Http::send(null, 204);
    }

    // ── Link video del brano di prova ────────────────────────────────────────

    private static function projectVideoOut(array $v): array
    {
        return [
            'id' => (int)$v['id'],
            'project_id' => (int)$v['project_id'],
            'user_id' => (int)$v['user_id'],
            'username' => Routes::username((int)$v['user_id']),
            'url' => $v['url'],
            'title' => $v['title'],
            'recorded_on' => $v['recorded_on'],
            'note' => $v['note'],
            'thumb_url' => $v['thumb_url'],
            'cover_thumb' => Routes::videoThumb($v),
            'created_at' => Db::iso($v['created_at']),
            'updated_at' => Db::iso($v['updated_at']),
        ];
    }

    private static function projectVideo(array $p): array
    {
        $v = Db::one('SELECT * FROM studio_project_video WHERE id = ? AND project_id = ?', [$p['vid'], $p['pid']]);
        if ($v === null) {
            Http::fail(404, 'Video non trovato');
        }
        return $v;
    }

    public static function listProjectVideos(array $p, array $user): void
    {
        self::project($p['pid']);
        $rows = Db::all('SELECT * FROM studio_project_video WHERE project_id = ? ORDER BY recorded_on DESC, id DESC', [$p['pid']]);
        Http::send(array_map([self::class, 'projectVideoOut'], $rows));
    }

    public static function createProjectVideo(array $p, array $user): void
    {
        $pr = self::project($p['pid']);
        [$url, $title, $date, $note, $thumb] = Routes::videoCreateFields();
        $now = Db::now();
        $id = Db::insert(
            'INSERT INTO studio_project_video (project_id, user_id, url, title, recorded_on, note, thumb_url, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$pr['id'], $user['id'], $url, $title, $date, $note, $thumb, $now, $now]
        );
        self::touch((int)$pr['id']);
        Http::send(self::projectVideoOut(Db::one('SELECT * FROM studio_project_video WHERE id = ?', [$id])), 201);
    }

    public static function updateProjectVideo(array $p, array $user): void
    {
        self::project($p['pid']);
        $v = self::projectVideo($p);
        self::requireAuthor($v, $user);
        [$title, $date, $note] = Routes::videoEditFields($v);
        Db::exec(
            'UPDATE studio_project_video SET title = ?, recorded_on = ?, note = ?, updated_at = ? WHERE id = ?',
            [$title, $date, $note, Db::now(), $v['id']]
        );
        Http::send(self::projectVideoOut(Db::one('SELECT * FROM studio_project_video WHERE id = ?', [$v['id']])));
    }

    public static function deleteProjectVideo(array $p, array $user): void
    {
        self::project($p['pid']);
        $v = self::projectVideo($p);
        self::requireAuthor($v, $user);
        Db::exec('DELETE FROM studio_project_video WHERE id = ?', [$v['id']]);
        Http::send(null, 204);
    }

    // ── Spostamento di un brano in "Prove" ───────────────────────────────────

    /**
     * Porta un brano delle cover nelle prove con testo, commenti, link video e audio, poi elimina il brano.
     * Se il brano era stato promosso da un brano di prova, torna in quel progetto (stato "idea").
     * Atomico: transazione sul DB e, se qualcosa fallisce, i file audio tornano nella cartella d'origine.
     */
    public static function moveSong(array $p, array $user): void
    {
        $songId = (int)$p['id'];
        $pdo = Db::pdo();
        $moved = [];   // [da, a] dei file spostati, per il ripristino
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            $song = Db::one('SELECT * FROM song WHERE id = ?', [$songId]);
            if ($song === null) {
                Http::fail(404, 'Brano non trovato');
            }
            if ((int)$song['proposed_by_id'] !== (int)$user['id'] && $user['role'] !== 'admin') {
                Http::fail(403, "Solo chi ha proposto il brano o l'admin può spostarlo in Prove");
            }
            $now = Db::now();
            $hasLyrics = trim((string)$song['lyrics']) !== '';
            $pr = Db::one('SELECT * FROM studio_project WHERE song_id = ?', [$songId]);
            if ($pr !== null) {
                Db::exec(
                    "UPDATE studio_project SET song_id = NULL, status = 'idea', lyrics = ?, updated_at = ?, last_activity_at = ? WHERE id = ?",
                    [$hasLyrics ? $song['lyrics'] : $pr['lyrics'], $now, $now, $pr['id']]
                );
                $pid = (int)$pr['id'];
            } else {
                $pid = Db::insert(
                    "INSERT INTO studio_project (title, status, lyrics, created_by_id, created_at, updated_at, last_activity_at)
                     VALUES (?, 'idea', ?, ?, ?, ?, ?)",
                    [$song['title'], $hasLyrics ? $song['lyrics'] : null, $song['proposed_by_id'], $now, $now, $now]
                );
            }

            // Commenti: prima i principali, poi le risposte, con la mappa vecchio id -> nuovo id
            $map = [];
            $comments = Db::all('SELECT * FROM comment WHERE song_id = ? ORDER BY created_at, id', [$songId]);
            foreach ([true, false] as $top) {
                foreach ($comments as $c) {
                    if (($c['parent_id'] === null) !== $top) {
                        continue;
                    }
                    $parent = $c['parent_id'] === null ? null : ($map[(int)$c['parent_id']] ?? null);
                    $map[(int)$c['id']] = Db::insert(
                        'INSERT INTO studio_project_comment (project_id, user_id, content, parent_id, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?)',
                        [$pid, $c['user_id'], $c['content'], $parent, $c['created_at'], $c['updated_at']]
                    );
                }
            }

            Db::exec(
                'INSERT INTO studio_project_video (project_id, user_id, url, title, recorded_on, note, thumb_url, created_at, updated_at)
                 SELECT ?, user_id, url, title, recorded_on, note, thumb_url, created_at, updated_at FROM song_video WHERE song_id = ?',
                [$pid, $songId]
            );

            // Audio -> contenuti audio del brano di prova (stesso file, spostato di cartella)
            $dir = Media::studioDir();
            if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
                Http::fail(500, 'Cartella dei contenuti non disponibile');
            }
            foreach (Db::all('SELECT * FROM song_audio WHERE song_id = ? ORDER BY id', [$songId]) as $a) {
                $from = Media::audioPath($a['stored_name']);
                $to = Media::studioPath($a['stored_name']);
                if (!is_file($from) || !rename($from, $to)) {
                    throw new RuntimeException('Spostamento del file audio non riuscito: ' . $a['title']);
                }
                $moved[] = [$from, $to];
                $day = DateTime::createFromFormat('Y-m-d', (string)$a['recorded_on']);
                $desc = ($day ? 'Registrato il ' . $day->format('d/m/Y') : 'Registrato il ' . $a['recorded_on'])
                    . ($a['note'] !== null && $a['note'] !== '' ? "\n" . $a['note'] : '');
                Db::exec(
                    "INSERT INTO studio_take (project_id, user_id, title, description, kind, original_name, stored_name, ext, mime, size,
                                              recorded_in_app, created_at, updated_at)
                     VALUES (?, ?, ?, ?, 'audio', ?, ?, ?, ?, ?, 0, ?, ?)",
                    [$pid, $a['user_id'], $a['title'], mb_substr($desc, 0, self::DESC_TAKE_MAX), $a['original_name'], $a['stored_name'],
                     $a['ext'], Media::AUDIO_TYPES[$a['ext']] ?? 'application/octet-stream', $a['size'], $a['created_at'], $a['updated_at']]
                );
            }

            Db::exec('DELETE FROM comment WHERE song_id = ?', [$songId]);
            Db::exec('DELETE FROM songlike WHERE song_id = ?', [$songId]);
            Db::exec('DELETE FROM song_video WHERE song_id = ?', [$songId]);
            Db::exec('DELETE FROM song_audio WHERE song_id = ?', [$songId]);
            Db::exec('DELETE FROM song WHERE id = ?', [$songId]);
            $pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $pdo->exec('ROLLBACK');
            foreach (array_reverse($moved) as [$from, $to]) {
                @rename($to, $from);
            }
            throw $e;
        }
        Http::send(['project_id' => $pid]);
    }
}
