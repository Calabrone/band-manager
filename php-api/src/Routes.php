<?php
declare(strict_types=1);

final class Routes
{
    private const CATEGORIES = ['proposta', 'da_provare', 'in_scaletta'];

    /** [metodo, regex del path, handler, accesso: none|user|admin] */
    private static function table(): array
    {
        return [
            ['GET', '#^/config$#', 'config', 'user'],

            ['POST', '#^/auth/login$#', 'login', 'none'],
            ['GET', '#^/auth/me$#', 'me', 'user'],
            ['PUT', '#^/auth/password$#', 'changePassword', 'user'],

            ['GET', '#^/songs$#', 'listSongs', 'user'],
            ['POST', '#^/songs$#', 'createSong', 'user'],
            ['GET', '#^/songs/(?<id>\d+)$#', 'getSong', 'user'],
            ['PUT', '#^/songs/(?<id>\d+)$#', 'updateSong', 'user'],
            ['DELETE', '#^/songs/(?<id>\d+)$#', 'deleteSong', 'user'],
            ['PUT', '#^/songs/(?<id>\d+)/category$#', 'changeCategory', 'user'],
            ['POST', '#^/songs/(?<id>\d+)/enrich$#', 'enrichSong', 'user'],

            ['GET', '#^/songs/(?<id>\d+)/comments$#', 'listComments', 'user'],
            ['POST', '#^/songs/(?<id>\d+)/comments$#', 'createComment', 'user'],
            ['PUT', '#^/songs/(?<id>\d+)/comments/(?<cid>\d+)$#', 'updateComment', 'user'],
            ['DELETE', '#^/songs/(?<id>\d+)/comments/(?<cid>\d+)$#', 'deleteComment', 'user'],

            ['GET', '#^/songs/(?<id>\d+)/likes$#', 'getLikes', 'user'],
            ['POST', '#^/songs/(?<id>\d+)/likes$#', 'toggleLike', 'user'],

            ['GET', '#^/admin/users$#', 'adminListUsers', 'admin'],
            ['POST', '#^/admin/users$#', 'adminCreateUser', 'admin'],
            ['PUT', '#^/admin/users/(?<uid>\d+)/password$#', 'adminResetPassword', 'admin'],
            ['DELETE', '#^/admin/users/(?<uid>\d+)$#', 'adminDeleteUser', 'admin'],
            ['GET', '#^/admin/settings$#', 'adminGetSettings', 'admin'],
            ['PUT', '#^/admin/settings$#', 'adminUpdateSetting', 'admin'],
        ];
    }

    public static function dispatch(string $method, string $path): never
    {
        $pathMatched = false;
        foreach (self::table() as [$m, $re, $handler, $access]) {
            if (!preg_match($re, $path, $found)) {
                continue;
            }
            $pathMatched = true;
            if ($m !== $method) {
                continue;
            }
            $user = match ($access) {
                'user' => Auth::currentUser(),
                'admin' => Auth::requireAdmin(),
                default => null,
            };
            $ids = [];
            foreach ($found as $k => $v) {
                if (is_string($k)) {
                    $ids[$k] = (int)$v;
                }
            }
            self::$handler($ids, $user);
            exit;
        }
        Http::fail($pathMatched ? 405 : 404, $pathMatched ? 'Method Not Allowed' : 'Not Found');
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static function userOut(array $u): array
    {
        return ['id' => (int)$u['id'], 'username' => $u['username'], 'role' => $u['role']];
    }

    private static function username(int $id): string
    {
        $u = Db::one('SELECT username FROM "user" WHERE id = ?', [$id]);
        return $u === null ? '' : $u['username'];
    }

    private static function songOut(array $s): array
    {
        return [
            'id' => (int)$s['id'],
            'artist' => $s['artist'],
            'title' => $s['title'],
            'category' => $s['category'],
            'validated' => (bool)(int)$s['validated'],
            'validation_error' => $s['validation_error'],
            'lyrics' => $s['lyrics'],
            'chords_url' => $s['chords_url'],
            'chords_text' => $s['chords_text'],
            'youtube_url' => $s['youtube_url'],
            'cover_url' => $s['cover_url'],
            'proposed_by_id' => (int)$s['proposed_by_id'],
            'last_modified_by_id' => (int)$s['last_modified_by_id'],
            'created_at' => Db::iso($s['created_at']),
            'updated_at' => Db::iso($s['updated_at']),
            'proposed_by_username' => self::username((int)$s['proposed_by_id']),
            'last_modified_by_username' => self::username((int)$s['last_modified_by_id']),
        ];
    }

    private static function commentOut(array $c): array
    {
        return [
            'id' => (int)$c['id'],
            'song_id' => (int)$c['song_id'],
            'user_id' => (int)$c['user_id'],
            'username' => self::username((int)$c['user_id']),
            'content' => $c['content'],
            'parent_id' => $c['parent_id'] === null ? null : (int)$c['parent_id'],
            'created_at' => Db::iso($c['created_at']),
            'updated_at' => Db::iso($c['updated_at']),
        ];
    }

    private static function song(int $id): array
    {
        $song = Db::one('SELECT * FROM song WHERE id = ?', [$id]);
        if ($song === null) {
            Http::fail(404, 'Brano non trovato');
        }
        return $song;
    }

    private static function maskValue(string $v): string
    {
        $len = mb_strlen($v);
        return $len <= 4 ? str_repeat('*', $len) : str_repeat('*', $len - 4) . mb_substr($v, -4);
    }

    // ── Config / auth ────────────────────────────────────────────────────────

    private static function config(array $p, array $user): void
    {
        Http::send(['chords_enabled' => Settings::get('chords_enabled') === 'true']);
    }

    private static function login(array $p, ?array $user): void
    {
        $b = Http::body(['username' => 'string', 'password' => 'string']);
        $u = Db::one('SELECT * FROM "user" WHERE username = ?', [$b['username']]);
        if ($u === null || !Auth::verifyPassword($b['password'], $u['password_hash'])) {
            Http::fail(401, 'Credenziali errate');
        }
        Http::send(['token' => Auth::createToken((int)$u['id']), 'user' => self::userOut($u)]);
    }

    private static function me(array $p, array $user): void
    {
        Http::send(self::userOut($user));
    }

    private static function changePassword(array $p, array $user): void
    {
        $b = Http::body(['current_password' => 'string', 'new_password' => 'string']);
        if (!Auth::verifyPassword($b['current_password'], $user['password_hash'])) {
            Http::fail(400, 'Password attuale errata');
        }
        if (mb_strlen($b['new_password']) < 6) {
            Http::fail(400, 'La nuova password deve essere di almeno 6 caratteri');
        }
        Db::exec('UPDATE "user" SET password_hash = ? WHERE id = ?', [Auth::hashPassword($b['new_password']), $user['id']]);
        Http::send(['ok' => true]);
    }

    // ── Brani ────────────────────────────────────────────────────────────────

    private static function listSongs(array $p, array $user): void
    {
        $category = $_GET['category'] ?? null;
        if (is_string($category) && in_array($category, self::CATEGORIES, true)) {
            $rows = Db::all('SELECT * FROM song WHERE category = ? ORDER BY updated_at DESC', [$category]);
        } else {
            $rows = Db::all('SELECT * FROM song ORDER BY updated_at DESC');
        }
        Http::send(array_map([self::class, 'songOut'], $rows));
    }

    private static function createSong(array $p, array $user): void
    {
        $b = Http::body(['artist' => 'string', 'title' => 'string']);
        $now = Db::now();
        $id = Db::insert(
            'INSERT INTO song (artist, title, category, validated, proposed_by_id, last_modified_by_id, created_at, updated_at)
             VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
            [trim($b['artist']), trim($b['title']), 'proposta', $user['id'], $user['id'], $now, $now]
        );
        Http::send(self::songOut(self::song($id)), 201);
    }

    private static function getSong(array $p, array $user): void
    {
        Http::send(self::songOut(self::song($p['id'])));
    }

    private static function updateSong(array $p, array $user): void
    {
        $b = Http::body(['artist' => '?string', 'title' => '?string', 'category' => '?string']);
        $song = self::song($p['id']);
        $artist = $b['artist'] !== null ? trim($b['artist']) : $song['artist'];
        $title = $b['title'] !== null ? trim($b['title']) : $song['title'];
        $category = $song['category'];
        if ($b['category'] !== null) {
            if (!in_array($b['category'], self::CATEGORIES, true)) {
                Http::fail(400, 'Categoria non valida');
            }
            $category = $b['category'];
        }
        Db::exec(
            'UPDATE song SET artist = ?, title = ?, category = ?, last_modified_by_id = ?, updated_at = ? WHERE id = ?',
            [$artist, $title, $category, $user['id'], Db::now(), $p['id']]
        );
        Http::send(self::songOut(self::song($p['id'])));
    }

    private static function deleteSong(array $p, array $user): void
    {
        self::song($p['id']);
        Db::exec('DELETE FROM comment WHERE song_id = ?', [$p['id']]);
        Db::exec('DELETE FROM songlike WHERE song_id = ?', [$p['id']]);
        Db::exec('DELETE FROM song WHERE id = ?', [$p['id']]);
        Http::send(null, 204);
    }

    private static function changeCategory(array $p, array $user): void
    {
        $b = Http::body(['category' => 'string']);
        if (!in_array($b['category'], self::CATEGORIES, true)) {
            Http::fail(400, 'Categoria non valida');
        }
        self::song($p['id']);
        Db::exec(
            'UPDATE song SET category = ?, last_modified_by_id = ?, updated_at = ? WHERE id = ?',
            [$b['category'], $user['id'], Db::now(), $p['id']]
        );
        Http::send(self::songOut(self::song($p['id'])));
    }

    /**
     * Esegue l'arricchimento in questa richiesta (niente BackgroundTasks su PHP/CGI): il frontend
     * la lancia senza attendere e fa polling su GET /songs/{id}. ignore_user_abort la completa
     * anche se il client chiude la connessione.
     */
    private static function enrichSong(array $p, array $user): void
    {
        ignore_user_abort(true);
        set_time_limit(120);
        self::song($p['id']);
        Db::exec('UPDATE song SET validated = 0, validation_error = NULL WHERE id = ?', [$p['id']]);
        Enrich::run($p['id']);
        Http::send(['detail' => 'Enrichment completato']);
    }

    // ── Commenti ─────────────────────────────────────────────────────────────

    private static function listComments(array $p, array $user): void
    {
        self::song($p['id']);
        $rows = Db::all('SELECT * FROM comment WHERE song_id = ? ORDER BY created_at, id', [$p['id']]);
        Http::send(array_map([self::class, 'commentOut'], $rows));
    }

    private static function createComment(array $p, array $user): void
    {
        $b = Http::body(['content' => 'string', 'parent_id' => '?int']);
        $content = trim($b['content']);
        if ($content === '') {
            Http::fail(400, 'Il commento non può essere vuoto');
        }
        self::song($p['id']);
        if ($b['parent_id'] !== null) {
            $parent = Db::one('SELECT * FROM comment WHERE id = ?', [$b['parent_id']]);
            if ($parent === null || (int)$parent['song_id'] !== $p['id']) {
                Http::fail(400, 'Commento padre non valido');
            }
            if ($parent['parent_id'] !== null) {
                Http::fail(400, 'Nidificazione massima raggiunta');
            }
        }
        $now = Db::now();
        $id = Db::insert(
            'INSERT INTO comment (song_id, user_id, content, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [$p['id'], $user['id'], $content, $b['parent_id'], $now, $now]
        );
        Http::send(self::commentOut(Db::one('SELECT * FROM comment WHERE id = ?', [$id])), 201);
    }

    private static function comment(array $p): array
    {
        $c = Db::one('SELECT * FROM comment WHERE id = ?', [$p['cid']]);
        if ($c === null || (int)$c['song_id'] !== $p['id']) {
            Http::fail(404, 'Commento non trovato');
        }
        return $c;
    }

    private static function updateComment(array $p, array $user): void
    {
        $b = Http::body(['content' => 'string']);
        $c = self::comment($p);
        if ((int)$c['user_id'] !== (int)$user['id']) {
            Http::fail(403, 'Non puoi modificare questo commento');
        }
        $content = trim($b['content']);
        if ($content === '') {
            Http::fail(400, 'Il commento non può essere vuoto');
        }
        Db::exec('UPDATE comment SET content = ?, updated_at = ? WHERE id = ?', [$content, Db::now(), $p['cid']]);
        Http::send(self::commentOut(Db::one('SELECT * FROM comment WHERE id = ?', [$p['cid']])));
    }

    private static function deleteComment(array $p, array $user): void
    {
        $c = self::comment($p);
        if ((int)$c['user_id'] !== (int)$user['id'] && $user['role'] !== 'admin') {
            Http::fail(403, 'Non puoi eliminare questo commento');
        }
        if ($c['parent_id'] === null) {
            Db::exec('DELETE FROM comment WHERE parent_id = ?', [$p['cid']]);
        }
        Db::exec('DELETE FROM comment WHERE id = ?', [$p['cid']]);
        Http::send(null, 204);
    }

    // ── Like ─────────────────────────────────────────────────────────────────

    private static function likesOut(int $songId, int $userId, bool $liked): array
    {
        $count = (int)Db::one('SELECT COUNT(*) AS n FROM songlike WHERE song_id = ?', [$songId])['n'];
        return ['count' => $count, 'liked' => $liked];
    }

    private static function getLikes(array $p, array $user): void
    {
        self::song($p['id']);
        $liked = Db::one('SELECT 1 AS x FROM songlike WHERE song_id = ? AND user_id = ?', [$p['id'], $user['id']]) !== null;
        Http::send(self::likesOut($p['id'], (int)$user['id'], $liked));
    }

    private static function toggleLike(array $p, array $user): void
    {
        self::song($p['id']);
        $existing = Db::one('SELECT id FROM songlike WHERE song_id = ? AND user_id = ?', [$p['id'], $user['id']]);
        if ($existing !== null) {
            Db::exec('DELETE FROM songlike WHERE id = ?', [$existing['id']]);
        } else {
            Db::exec('INSERT INTO songlike (song_id, user_id) VALUES (?, ?)', [$p['id'], $user['id']]);
        }
        Http::send(self::likesOut($p['id'], (int)$user['id'], $existing === null));
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    private static function adminListUsers(array $p, array $admin): void
    {
        $rows = Db::all('SELECT id, username, role, created_at FROM "user" ORDER BY id');
        Http::send(array_map(fn($u) => [
            'id' => (int)$u['id'],
            'username' => $u['username'],
            'role' => $u['role'],
            'created_at' => Db::iso($u['created_at']),
        ], $rows));
    }

    private static function adminCreateUser(array $p, array $admin): void
    {
        $b = Http::body(['username' => 'string', 'password' => 'string', 'role' => '?string']);
        $role = $b['role'] ?? 'member';
        if (Db::one('SELECT id FROM "user" WHERE username = ?', [$b['username']]) !== null) {
            Http::fail(400, 'Username già esistente');
        }
        if (!in_array($role, ['admin', 'member'], true)) {
            Http::fail(400, 'Ruolo non valido');
        }
        $id = Db::insert(
            'INSERT INTO "user" (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
            [$b['username'], Auth::hashPassword($b['password']), $role, Db::now()]
        );
        Http::send(['id' => $id, 'username' => $b['username'], 'role' => $role], 201);
    }

    private static function adminResetPassword(array $p, array $admin): void
    {
        $b = Http::body(['new_password' => 'string']);
        if (mb_strlen($b['new_password']) < 6) {
            Http::fail(400, 'La password deve essere di almeno 6 caratteri');
        }
        if (Db::one('SELECT id FROM "user" WHERE id = ?', [$p['uid']]) === null) {
            Http::fail(404, 'Utente non trovato');
        }
        Db::exec('UPDATE "user" SET password_hash = ? WHERE id = ?', [Auth::hashPassword($b['new_password']), $p['uid']]);
        Http::send(['ok' => true]);
    }

    private static function adminDeleteUser(array $p, array $admin): void
    {
        if ($p['uid'] === (int)$admin['id']) {
            Http::fail(400, 'Non puoi eliminare te stesso');
        }
        if (Db::one('SELECT id FROM "user" WHERE id = ?', [$p['uid']]) === null) {
            Http::fail(404, 'Utente non trovato');
        }
        Db::exec('DELETE FROM "user" WHERE id = ?', [$p['uid']]);
        Http::send(null, 204);
    }

    private static function adminGetSettings(array $p, array $admin): void
    {
        $rows = Db::all('SELECT "key", value FROM appsetting');
        Http::send(array_map(fn($s) => ['key' => $s['key'], 'value_masked' => self::maskValue($s['value'])], $rows));
    }

    private static function adminUpdateSetting(array $p, array $admin): void
    {
        $b = Http::body(['key' => 'string', 'value' => 'string']);
        $value = trim($b['value']);
        Db::exec(
            'INSERT INTO appsetting ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value',
            [$b['key'], $value]
        );
        Http::send(['key' => $b['key'], 'value_masked' => self::maskValue($value)]);
    }
}
