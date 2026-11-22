<?php
declare(strict_types=1);

/**
 * Notifiche: eventi sui contenuti → storico per destinatario (con raggruppamento) → push.
 * Spec: .kiro/specs/push-notifications/.
 */
final class Notify
{
    public const DEFAULT_PREFS = ['song' => 'all', 'like' => 'all', 'comment' => 'all', 'media' => 'all'];
    private const PREF_VALUES = ['song' => ['all', 'off'], 'like' => ['all', 'mine', 'off'],
        'comment' => ['all', 'mine', 'off'], 'media' => ['all', 'mine', 'off']];
    private const KINDS = ['song_new', 'project_new', 'promoted', 'like', 'comment', 'media'];

    public const GROUP_WINDOW = 1800;   // R5.1: 30 minuti dall'ultimo aggiornamento
    public const PUSH_INTERVAL = 180;   // R5.4: una push ogni 3 minuti per gruppo
    private const EXCERPT_MAX = 140;
    private const MAX_SUBS = 10;

    // ── Preferenze ───────────────────────────────────────────────────────────

    public static function prefsOf(array $user): array
    {
        $saved = json_decode((string)($user['notify_prefs'] ?? ''), true);
        $out = self::DEFAULT_PREFS;
        if (is_array($saved)) {
            foreach (self::PREF_VALUES as $k => $allowed) {
                if (isset($saved[$k]) && in_array($saved[$k], $allowed, true)) {
                    $out[$k] = $saved[$k];
                }
            }
        }
        return $out;
    }

    private static function category(string $kind): string
    {
        return in_array($kind, ['song_new', 'project_new', 'promoted'], true) ? 'song' : $kind;
    }

    // ── Eventi ───────────────────────────────────────────────────────────────

    /**
     * Registra un evento per tutti gli altri utenti (R1). $ctx: title, url, owners (id per il filtro "mine"),
     * excerpt (facoltativo). Non fa mai fallire l'azione dell'utente: gli errori finiscono nel log.
     */
    public static function event(string $kind, string $targetType, int $targetId, array $actor, array $ctx): void
    {
        try {
            self::record($kind, $targetType, $targetId, (int)$actor['id'], $ctx);
        } catch (Throwable $e) {
            Http::log("Notify::event $kind: " . $e->getMessage());
        }
    }

    private static function record(string $kind, string $targetType, int $targetId, int $actorId, array $ctx): void
    {
        if (!in_array($kind, self::KINDS, true)) {
            throw new InvalidArgumentException("Tipo di notifica sconosciuto: $kind");
        }
        $cat = self::category($kind);
        $owners = array_map('intval', $ctx['owners'] ?? []);
        $groupKey = match ($kind) {
            'song_new', 'project_new' => "$kind:actor:$actorId",
            default => "$kind:$targetType:$targetId",
        };
        $title = mb_substr(trim((string)$ctx['title']), 0, 200);
        $excerpt = isset($ctx['excerpt']) ? self::excerpt((string)$ctx['excerpt']) : null;
        $url = (string)$ctx['url'];

        $pdo = Db::pdo();
        $now = Db::now();
        $windowStart = Db::future(-self::GROUP_WINDOW);
        $pushBefore = Db::future(-self::PUSH_INTERVAL);
        $toPush = [];
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            foreach (Db::all('SELECT id, notify_prefs FROM "user" WHERE id != ?', [$actorId]) as $u) {
                $pref = self::prefsOf($u)[$cat];
                if ($pref === 'off' || ($pref === 'mine' && !in_array((int)$u['id'], $owners, true))) {
                    continue;
                }
                $uid = (int)$u['id'];
                $row = $kind === 'promoted' ? null : Db::one(
                    'SELECT * FROM notification WHERE user_id = ? AND group_key = ? AND read_at IS NULL AND updated_at >= ?
                     ORDER BY id DESC LIMIT 1',
                    [$uid, $groupKey, $windowStart]
                );
                if ($row === null) {
                    $nid = Db::insert(
                        'INSERT INTO notification (user_id, kind, target_type, target_id, group_key, actors, count, title, excerpt, url,
                         created_at, updated_at, pushed_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)',
                        [$uid, $kind, $targetType, $targetId, $groupKey, json_encode([$actorId]), $title, $excerpt, $url, $now, $now, $now]
                    );
                    $toPush[] = [$uid, $nid, true];
                    continue;
                }
                $actors = array_values(array_unique(array_merge([$actorId], array_map('intval', json_decode($row['actors'], true) ?: []))));
                $count = $kind === 'like' ? count($actors) : (int)$row['count'] + 1;
                $newUrl = match ($kind) {
                    'song_new' => '/',
                    'project_new' => '/studio',
                    'comment', 'media' => $url,   // porta all'elemento più recente
                    default => $row['url'],
                };
                $push = $row['pushed_at'] === null || $row['pushed_at'] <= $pushBefore;
                Db::exec(
                    'UPDATE notification SET actors = ?, count = ?, title = ?, excerpt = ?, url = ?, target_id = ?, updated_at = ?,
                     pushed_at = ? WHERE id = ?',
                    [json_encode($actors), $count, $title, $excerpt, $newUrl, $targetId, $now, $push ? $now : $row['pushed_at'], $row['id']]
                );
                if ($push) {
                    $toPush[] = [$uid, (int)$row['id'], false];
                }
            }
            $pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $pdo->exec('ROLLBACK');
            throw $e;
        }
        foreach ($toPush as [$uid, $nid, $isNew]) {
            self::queuePush($uid, $nid, $isNew);
        }
    }

    private static function excerpt(string $s): string
    {
        // Citazioni dei commenti delle prove ([[m:12]], [[t:3400]]) non hanno senso fuori dall'app
        $s = trim((string)preg_replace(['/\[\[[mt]:\d+\]\]/', '/\s+/u'], ['', ' '], $s));
        return mb_strlen($s) > self::EXCERPT_MAX ? rtrim(mb_substr($s, 0, self::EXCERPT_MAX - 1)) . '…' : $s;
    }

    private static function queuePush(int $uid, int $nid, bool $isNew): void
    {
        $row = Db::one('SELECT * FROM notification WHERE id = ?', [$nid]);
        if ($row === null) {
            return;
        }
        $text = self::text($row, self::names(json_decode($row['actors'], true) ?: []));
        Push::queue($uid, [
            'title' => self::bandName(),
            'body' => $text . ($row['kind'] === 'comment' && $row['excerpt'] ? "\n" . $row['excerpt'] : ''),
            'url' => $row['url'],
            'tag' => $row['group_key'],
            'nid' => $nid,
            'renotify' => $isNew,
            'unread' => self::unreadCount($uid),
        ]);
    }

    /** Toglie un like ancora non letto (R5.5). */
    public static function retractLike(int $songId, int $actorId): void
    {
        try {
            foreach (Db::all('SELECT id, actors FROM notification WHERE group_key = ? AND read_at IS NULL', ["like:song:$songId"]) as $r) {
                $actors = array_map('intval', json_decode($r['actors'], true) ?: []);
                if (!in_array($actorId, $actors, true)) {
                    continue;
                }
                $actors = array_values(array_diff($actors, [$actorId]));
                if ($actors === []) {
                    Db::exec('DELETE FROM notification WHERE id = ?', [$r['id']]);
                } else {
                    Db::exec('UPDATE notification SET actors = ?, count = ? WHERE id = ?', [json_encode($actors), count($actors), $r['id']]);
                }
            }
        } catch (Throwable $e) {
            Http::log('Notify::retractLike: ' . $e->getMessage());
        }
    }

    /** Elimina le notifiche di un contenuto rimosso (R2.9); per un progetto anche quelle dei suoi take. */
    public static function forget(string $targetType, int $targetId): void
    {
        if ($targetType === 'project') {
            Db::exec("DELETE FROM notification WHERE target_type = 'take' AND target_id IN (SELECT id FROM studio_take WHERE project_id = ?)", [$targetId]);
        }
        Db::exec('DELETE FROM notification WHERE target_type = ? AND target_id = ?', [$targetType, $targetId]);
    }

    public static function forgetUser(int $userId): void
    {
        Db::exec('DELETE FROM notification WHERE user_id = ?', [$userId]);
        Db::exec('DELETE FROM push_subscription WHERE user_id = ?', [$userId]);
    }

    /** Pulizia giornaliera (R2.8): lette > 30 giorni, tutte > 90 giorni. */
    public static function purge(): void
    {
        $today = gmdate('Y-m-d');
        $last = Db::one('SELECT value FROM appsetting WHERE "key" = \'notify_last_purge\'');
        if ($last !== null && $last['value'] === $today) {
            return;
        }
        Db::exec('INSERT INTO appsetting ("key", value) VALUES (\'notify_last_purge\', ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value', [$today]);
        Db::exec('DELETE FROM notification WHERE (read_at IS NOT NULL AND updated_at < ?) OR updated_at < ?',
            [Db::future(-30 * 86400), Db::future(-90 * 86400)]);
    }

    // ── Testi (unica fonte, storico e push) ──────────────────────────────────

    /** @return array<int,string> id => username */
    private static function names(array $ids): array
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        if ($ids === []) {
            return [];
        }
        $rows = Db::all('SELECT id, username FROM "user" WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids);
        return array_column($rows, 'username', 'id');
    }

    private static function bandName(): string
    {
        $r = Db::one('SELECT value FROM appsetting WHERE "key" = \'band_name\'');
        $name = trim((string)($r['value'] ?? ''));
        return $name !== '' ? $name : 'Band Manager';
    }

    private static function who(array $ids, array $names): string
    {
        $list = array_map(fn($id) => $names[$id] ?? 'Un membro', array_values($ids));
        $n = count($list);
        return match (true) {
            $n <= 1 => $list[0] ?? 'Un membro',
            $n === 2 => "$list[0] e $list[1]",
            $n === 3 => "$list[0], $list[1] e $list[2]",
            default => "$list[0], $list[1] e altri " . ($n - 2),
        };
    }

    /** Testo della notifica; il titolo del contenuto sta tra «» (il frontend lo mette in corsivo). */
    public static function text(array $row, array $names): string
    {
        $actors = array_map('intval', json_decode((string)$row['actors'], true) ?: []);
        $a = self::who(array_slice($actors, 0, 1), $names);
        $n = (int)$row['count'];
        $t = '«' . $row['title'] . '»';
        $many = count($actors) > 1;
        return match ($row['kind']) {
            'song_new' => $n > 1 ? "$a ha aggiunto $n brani" : "$a ha aggiunto $t",
            'project_new' => $n > 1 ? "$a ha creato $n brani di prova" : "$a ha creato il brano di prova $t",
            'promoted' => "$a ha promosso $t in repertorio",
            'like' => $many ? self::who($actors, $names) . " hanno messo mi piace a $t" : "$a ha messo mi piace a $t",
            'comment' => $n <= 1 ? "$a ha commentato $t" : ($many ? "$n nuovi commenti su $t" : "$a ha scritto $n commenti su $t"),
            'media' => $n <= 1
                ? "$a ha aggiunto " . match ($row['excerpt']) {
                    'video' => 'un video',
                    'audio' => 'un audio',
                    default => 'un contenuto',
                } . " a $t"
                : ($many ? "$n nuovi contenuti su $t" : "$a ha aggiunto $n contenuti a $t"),
            default => $t,
        };
    }

    // ── API ──────────────────────────────────────────────────────────────────

    public static function unreadCount(int $uid): int
    {
        return (int)Db::one('SELECT COUNT(*) AS n FROM notification WHERE user_id = ? AND read_at IS NULL', [$uid])['n'];
    }

    public static function list(array $p, array $user): void
    {
        Push::hook();   // pulizia giornaliera a risposta inviata
        $uid = (int)$user['id'];
        $limit = max(1, min(50, (int)($_GET['limit'] ?? 30)));
        $offset = max(0, (int)($_GET['offset'] ?? 0));
        $rows = Db::all('SELECT * FROM notification WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?',
            [$uid, $limit + 1, $offset]);
        $hasMore = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);
        $ids = [];
        foreach ($rows as $r) {
            $ids = array_merge($ids, json_decode($r['actors'], true) ?: []);
        }
        $names = self::names($ids);
        $items = array_map(function (array $r) use ($names) {
            $actors = array_map('intval', json_decode($r['actors'], true) ?: []);
            return [
                'id' => (int)$r['id'],
                'kind' => $r['kind'],
                'url' => $r['url'],
                'title' => $r['title'],
                'text' => self::text($r, $names),
                'excerpt' => $r['kind'] === 'comment' ? $r['excerpt'] : null,
                'actors' => array_map(fn($id) => ['id' => $id, 'username' => $names[$id] ?? null], array_slice($actors, 0, 3)),
                'count' => (int)$r['count'],
                'created_at' => Db::iso($r['created_at']),
                'updated_at' => Db::iso($r['updated_at']),
                'read' => $r['read_at'] !== null,
            ];
        }, $rows);
        Http::send(['items' => $items, 'unread' => self::unreadCount($uid), 'has_more' => $hasMore]);
    }

    public static function unread(array $p, array $user): void
    {
        Http::send(['unread' => self::unreadCount((int)$user['id'])]);
    }

    public static function markRead(array $p, array $user): void
    {
        $b = Http::body(['ids' => '?array', 'all' => '?bool']);
        $uid = (int)$user['id'];
        if ($b['all'] === true) {
            Db::exec('UPDATE notification SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [Db::now(), $uid]);
        } elseif (is_array($b['ids'])) {
            $ids = array_values(array_filter($b['ids'], 'is_int'));
            if (count($ids) !== count($b['ids']) || count($ids) > 200) {
                Http::fail(422, 'ids non validi');
            }
            if ($ids !== []) {
                Db::exec('UPDATE notification SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN ('
                    . implode(',', array_fill(0, count($ids), '?')) . ')', array_merge([Db::now(), $uid], $ids));
            }
        } else {
            Http::fail(422, 'Indicare ids oppure all');
        }
        Http::send(['unread' => self::unreadCount($uid)]);
    }

    public static function updatePrefs(array $p, array $user): void
    {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw === false ? '' : $raw, true);
        if (!is_array($data) || $data === [] || array_is_list($data)) {
            Http::fail(422, 'Preferenze non valide');
        }
        $prefs = self::prefsOf($user);
        foreach ($data as $k => $v) {
            if (!isset(self::PREF_VALUES[$k]) || !in_array($v, self::PREF_VALUES[$k], true)) {
                Http::fail(422, "Preferenza non valida: $k");
            }
            $prefs[$k] = $v;
        }
        Db::exec('UPDATE "user" SET notify_prefs = ? WHERE id = ?', [json_encode($prefs), $user['id']]);
        Http::send(['notify_prefs' => $prefs]);
    }

    public static function pushKey(array $p, array $user): void
    {
        Http::send(['public_key' => Push::publicKey()]);
    }

    public static function subscribe(array $p, array $user): void
    {
        $b = Http::body(['endpoint' => 'string', 'keys' => 'array']);
        $endpoint = trim($b['endpoint']);
        $p256 = is_string($b['keys']['p256dh'] ?? null) ? Push::b64uDecode($b['keys']['p256dh']) : null;
        $auth = is_string($b['keys']['auth'] ?? null) ? Push::b64uDecode($b['keys']['auth']) : null;
        if (!Push::endpointAllowed($endpoint)) {
            Http::fail(422, 'Servizio push non supportato');
        }
        if ($p256 === null || strlen($p256) !== 65 || $p256[0] !== "\x04" || $auth === null || strlen($auth) !== 16) {
            Http::fail(422, 'Chiavi della sottoscrizione non valide');
        }
        $uid = (int)$user['id'];
        $ua = mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300);
        $existing = Db::one('SELECT id FROM push_subscription WHERE endpoint = ?', [$endpoint]);
        if ($existing !== null) {
            // Stesso dispositivo: passa all'utente attuale (dispositivo condiviso) e aggiorna le chiavi
            Db::exec('UPDATE push_subscription SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?, fail_count = 0 WHERE id = ?',
                [$uid, Push::b64uEncode($p256), Push::b64uEncode($auth), $ua, $existing['id']]);
        } else {
            Db::insert('INSERT INTO push_subscription (user_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [$uid, $endpoint, Push::b64uEncode($p256), Push::b64uEncode($auth), $ua, Db::now()]);
        }
        $extra = Db::all('SELECT id FROM push_subscription WHERE user_id = ? ORDER BY id DESC LIMIT -1 OFFSET ?', [$uid, self::MAX_SUBS]);
        foreach ($extra as $r) {
            Db::exec('DELETE FROM push_subscription WHERE id = ?', [$r['id']]);
        }
        Http::send(['ok' => true]);
    }

    public static function unsubscribe(array $p, array $user): void
    {
        $b = Http::body(['endpoint' => 'string']);
        Db::exec('DELETE FROM push_subscription WHERE endpoint = ? AND user_id = ?', [$b['endpoint'], $user['id']]);
        Http::send(null, 204);
    }

    public static function test(array $p, array $user): void
    {
        $uid = (int)$user['id'];
        $bucket = "pushtest:$uid";
        if (Db::one('SELECT id FROM rate_hit WHERE bucket = ? AND ts > ?', [$bucket, time() - 10]) !== null) {
            Http::fail(429, 'Attendi qualche secondo prima di un altro invio di prova');
        }
        Db::exec('INSERT INTO rate_hit (bucket, ts) VALUES (?, ?)', [$bucket, time()]);
        $n = (int)Db::one('SELECT COUNT(*) AS n FROM push_subscription WHERE user_id = ?', [$uid])['n'];
        if ($n === 0) {
            Http::fail(409, 'Nessun dispositivo con le notifiche attive');
        }
        Push::queue($uid, [
            'title' => self::bandName(),
            'body' => 'Notifiche attive: riceverai qui le novità della band.',
            'url' => '/notifications',
            'tag' => 'test',
            'renotify' => true,
            'unread' => self::unreadCount($uid),
        ]);
        Http::send(['devices' => $n]);
    }

    /** Solo test (push_capture): restituisce e svuota le push "inviate". */
    public static function capture(array $p, array $admin): void
    {
        if (!Push::captureMode()) {
            Http::fail(404, 'Not Found');
        }
        $file = dirname(__DIR__) . '/data/push_capture.jsonl';
        $lines = is_file($file) ? file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
        @unlink($file);
        Http::send(array_map(fn($l) => json_decode($l, true), $lines ?: []));
    }
}
