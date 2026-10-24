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
            ['PUT', '#^/auth/profile$#', 'updateProfile', 'user'],
            ['GET', '#^/auth/invite/(?<token>[0-9a-f]{64})$#', 'checkInvite', 'none'],
            ['POST', '#^/auth/register$#', 'register', 'none'],
            ['POST', '#^/auth/forgot$#', 'forgotPassword', 'none'],
            ['GET', '#^/auth/reset/(?<token>[0-9a-f]{64})$#', 'checkReset', 'none'],
            ['POST', '#^/auth/reset$#', 'resetPassword', 'none'],

            ['POST', '#^/songs/validate$#', 'validateSong', 'user'],
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

            ['GET', '#^/songs/(?<id>\d+)/videos$#', 'listVideos', 'user'],
            ['POST', '#^/songs/(?<id>\d+)/videos$#', 'createVideo', 'user'],
            ['PUT', '#^/songs/(?<id>\d+)/videos/(?<vid>\d+)$#', 'updateVideo', 'user'],
            ['DELETE', '#^/songs/(?<id>\d+)/videos/(?<vid>\d+)$#', 'deleteVideo', 'user'],
            ['POST', '#^/media/preview$#', 'mediaPreview', 'user'],

            ['GET', '#^/songs/(?<id>\d+)/audios$#', 'listAudios', 'user'],
            ['POST', '#^/songs/(?<id>\d+)/audios$#', 'createAudio', 'user'],
            ['PUT', '#^/songs/(?<id>\d+)/audios/(?<aid>\d+)$#', 'updateAudio', 'user'],
            ['DELETE', '#^/songs/(?<id>\d+)/audios/(?<aid>\d+)$#', 'deleteAudio', 'user'],
            // Accesso 'none': <audio> e il download non possono mandare Authorization, vale la firma in query
            ['GET', '#^/songs/(?<id>\d+)/audios/(?<aid>\d+)/file$#', 'audioFile', 'none'],

            ['GET', '#^/admin/users$#', 'adminListUsers', 'admin'],
            ['PUT', '#^/admin/users/(?<uid>\d+)/password$#', 'adminResetPassword', 'admin'],
            ['POST', '#^/admin/users/(?<uid>\d+)/reset-link$#', 'adminResetLink', 'admin'],
            ['GET', '#^/admin/invites$#', 'adminListInvites', 'admin'],
            ['POST', '#^/admin/invites$#', 'adminCreateInvite', 'admin'],
            ['DELETE', '#^/admin/invites/(?<iid>\d+)$#', 'adminRevokeInvite', 'admin'],
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
            // Password di default da cambiare: finche' non lo fa puo' solo vedere il profilo e cambiarla
            if ($user !== null && (int)$user['must_change_password'] === 1
                && !in_array($handler, ['me', 'changePassword'], true)) {
                Http::fail(403, 'Devi cambiare la password');
            }
            $ids = [];
            foreach ($found as $k => $v) {
                if (is_string($k)) {
                    $ids[$k] = $k === 'token' ? $v : (int)$v;
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
        return [
            'id' => (int)$u['id'],
            'username' => $u['username'],
            'role' => $u['role'],
            'email' => $u['email'],
            'must_change_password' => (bool)(int)$u['must_change_password'],
        ];
    }

    private const USERNAME_RE = '/^[A-Za-z0-9._-]{3,30}$/';

    private static function checkUsername(string $username, int $exceptId = 0): string
    {
        $username = trim($username);
        if (!preg_match(self::USERNAME_RE, $username)) {
            Http::fail(400, 'Username di 3-30 caratteri: lettere, numeri, punto, trattino e underscore');
        }
        if (Db::one('SELECT id FROM "user" WHERE username = ? COLLATE NOCASE AND id != ?', [$username, $exceptId]) !== null) {
            Http::fail(400, 'Username già esistente');
        }
        return $username;
    }

    /** Email normalizzata (trim); stringa vuota diventa null quando $allowEmpty. */
    private static function checkEmail(string $email, int $exceptId = 0, bool $allowEmpty = false): ?string
    {
        $email = trim($email);
        if ($email === '' && $allowEmpty) {
            return null;
        }
        if (mb_strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Http::fail(400, 'Email non valida');
        }
        if (Db::one('SELECT id FROM "user" WHERE email = ? COLLATE NOCASE AND id != ?', [$email, $exceptId]) !== null) {
            Http::fail(400, 'Email già in uso');
        }
        return $email;
    }

    private static function checkPassword(string $password): void
    {
        if (mb_strlen($password) < 6) {
            Http::fail(400, 'La password deve essere di almeno 6 caratteri');
        }
    }

    /** URL base dell'app (es. https://www.motorn.it/band): da config app_url o dedotto dalla richiesta. */
    private static function appUrl(): string
    {
        $cfg = Config::get('app_url');
        if ($cfg !== '') {
            return rtrim($cfg, '/');
        }
        $https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
        $apiDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
        $appDir = rtrim(str_replace('\\', '/', dirname($apiDir)), '/');
        return ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $appDir;
    }

    /** Invalida i JWT gia' emessi per l'utente e ritorna la riga aggiornata. */
    private static function bumpToken(int $userId): array
    {
        Db::exec('UPDATE "user" SET token_version = token_version + 1 WHERE id = ?', [$userId]);
        return Db::one('SELECT * FROM "user" WHERE id = ?', [$userId]);
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
        Http::send([
            'chords_enabled' => Settings::get('chords_enabled') === 'true',
            'max_upload_bytes' => Media::maxUploadBytes(),
        ]);
    }

    private static function login(array $p, ?array $user): void
    {
        if (RateLimit::tooMany('login', 20, 900)) {
            Http::fail(429, 'Troppi tentativi, riprova tra qualche minuto');
        }
        $b = Http::body(['username' => 'string', 'password' => 'string']);
        $u = Db::one('SELECT * FROM "user" WHERE username = ? COLLATE NOCASE', [trim($b['username'])]);
        if ($u === null || !Auth::verifyPassword($b['password'], $u['password_hash'])) {
            RateLimit::hit('login');
            Http::fail(401, 'Credenziali errate');
        }
        // Un admin con la password di default deve cambiarla prima di fare altro
        if ($u['role'] === 'admin' && $b['password'] === Auth::DEFAULT_ADMIN_PASSWORD
            && (int)$u['must_change_password'] === 0) {
            Db::exec('UPDATE "user" SET must_change_password = 1 WHERE id = ?', [$u['id']]);
            $u['must_change_password'] = 1;
        }
        Http::send([
            'token' => Auth::createToken((int)$u['id'], (int)$u['token_version']),
            'user' => self::userOut($u),
        ]);
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
        if ($b['new_password'] === Auth::DEFAULT_ADMIN_PASSWORD) {
            Http::fail(400, 'Scegli una password diversa da quella di default');
        }
        Db::exec(
            'UPDATE "user" SET password_hash = ?, must_change_password = 0 WHERE id = ?',
            [Auth::hashPassword($b['new_password']), $user['id']]
        );
        $fresh = self::bumpToken((int)$user['id']);
        Http::send([
            'ok' => true,
            'token' => Auth::createToken((int)$fresh['id'], (int)$fresh['token_version']),
            'user' => self::userOut($fresh),
        ]);
    }

    private static function updateProfile(array $p, array $user): void
    {
        $b = Http::body(['username' => '?string', 'email' => '?string']);
        $id = (int)$user['id'];
        $username = $b['username'] !== null ? self::checkUsername($b['username'], $id) : $user['username'];
        $email = $b['email'] !== null ? self::checkEmail($b['email'], $id, true) : $user['email'];
        Db::exec('UPDATE "user" SET username = ?, email = ? WHERE id = ?', [$username, $email, $id]);
        Http::send(self::userOut(Db::one('SELECT * FROM "user" WHERE id = ?', [$id])));
    }

    // ── Inviti e registrazione ───────────────────────────────────────────────

    /** Invito utilizzabile (non scaduto, usato o revocato) dal token in chiaro, altrimenti null. */
    private static function activeInvite(string $token): ?array
    {
        return Db::one(
            'SELECT * FROM invite WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?',
            [Auth::hashToken($token), Db::now()]
        );
    }

    private static function checkInvite(array $p, ?array $user): void
    {
        $invite = self::activeInvite($p['token']);
        Http::send($invite === null
            ? ['valid' => false]
            : ['valid' => true, 'role' => $invite['role'], 'expires_at' => Db::iso($invite['expires_at'])]);
    }

    private static function register(array $p, ?array $user): void
    {
        $b = Http::body(['token' => 'string', 'username' => 'string', 'email' => 'string', 'password' => 'string']);
        if (self::activeInvite($b['token']) === null) {
            Http::fail(400, 'Invito non valido o scaduto');
        }
        $username = self::checkUsername($b['username']);
        $email = self::checkEmail($b['email']);
        self::checkPassword($b['password']);

        $pdo = Db::pdo();
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            // Riletto dentro la transazione: due registrazioni con lo stesso link non passano entrambe
            $invite = self::activeInvite($b['token']);
            if ($invite === null) {
                Http::fail(400, 'Invito non valido o scaduto');
            }
            $now = Db::now();
            $id = Db::insert(
                'INSERT INTO "user" (username, password_hash, role, created_at, email) VALUES (?, ?, ?, ?, ?)',
                [$username, Auth::hashPassword($b['password']), $invite['role'], $now, $email]
            );
            Db::exec('UPDATE invite SET used_at = ?, used_by_id = ? WHERE id = ?', [$now, $id, $invite['id']]);
            $pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $pdo->exec('ROLLBACK');
            throw $e;
        }
        $u = Db::one('SELECT * FROM "user" WHERE id = ?', [$id]);
        Http::send(['token' => Auth::createToken($id, 0), 'user' => self::userOut($u)], 201);
    }

    // ── Recupero password ────────────────────────────────────────────────────

    private static function newResetLink(int $userId, ?int $adminId): array
    {
        $token = Auth::newToken();
        $expires = Db::future(Auth::RESET_TTL);
        Db::exec(
            'INSERT INTO password_reset (user_id, token_hash, created_at, expires_at, created_by_admin_id) VALUES (?, ?, ?, ?, ?)',
            [$userId, Auth::hashToken($token), Db::now(), $expires, $adminId]
        );
        return ['url' => self::appUrl() . '/reset/' . $token, 'expires_at' => Db::iso($expires)];
    }

    private static function activeReset(string $token): ?array
    {
        return Db::one(
            'SELECT * FROM password_reset WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
            [Auth::hashToken($token), Db::now()]
        );
    }

    private static function forgotPassword(array $p, ?array $user): void
    {
        $b = Http::body(['email' => 'string']);
        if (RateLimit::tooMany('forgot', 10, 900)) {
            Http::fail(429, 'Troppe richieste, riprova tra qualche minuto');
        }
        RateLimit::hit('forgot');
        $email = trim($b['email']);
        $u = $email === '' ? null : Db::one('SELECT * FROM "user" WHERE email = ? COLLATE NOCASE', [$email]);
        if ($u !== null) {
            $link = self::newResetLink((int)$u['id'], null);
            Mailer::send(
                $u['email'],
                'Band Manager: recupero password',
                "Ciao {$u['username']},\n\nper scegliere una nuova password apri questo link "
                . "(valido 1 ora, utilizzabile una sola volta):\n\n" . $link['url']
                . "\n\nSe non l'hai richiesto tu ignora questa email."
            );
        }
        // Stessa risposta esista o no l'email: nessuna enumerazione degli utenti
        Http::send(['ok' => true]);
    }

    private static function checkReset(array $p, ?array $user): void
    {
        Http::send(['valid' => self::activeReset($p['token']) !== null]);
    }

    private static function resetPassword(array $p, ?array $user): void
    {
        $b = Http::body(['token' => 'string', 'new_password' => 'string']);
        self::checkPassword($b['new_password']);
        if (self::activeReset($b['token']) === null) {
            Http::fail(400, 'Link non valido o scaduto');
        }
        $pdo = Db::pdo();
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            $reset = self::activeReset($b['token']);
            if ($reset === null) {
                Http::fail(400, 'Link non valido o scaduto');
            }
            Db::exec('UPDATE password_reset SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [Db::now(), $reset['user_id']]);
            Db::exec(
                'UPDATE "user" SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?',
                [Auth::hashPassword($b['new_password']), $reset['user_id']]
            );
            $pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $pdo->exec('ROLLBACK');
            throw $e;
        }
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

    /** Solo verifica (Groq): non scrive nulla, il record nasce con POST /songs. */
    private static function validateSong(array $p, array $user): void
    {
        set_time_limit(60);
        $b = Http::body(['artist' => 'string', 'title' => 'string']);
        $artist = trim($b['artist']);
        $title = trim($b['title']);
        if ($artist === '' || $title === '') {
            Http::fail(400, 'Artista e titolo sono obbligatori');
        }
        Http::send(Groq::validateSong($artist, $title, Settings::get('groq_api_key')));
    }

    /**
     * Crea il brano nella sezione scelta. Con force=true e' un brano non trovato che l'utente ha voluto
     * inserire comunque: resta non validato, con message come validation_error.
     */
    private static function createSong(array $p, array $user): void
    {
        $b = Http::body(['artist' => 'string', 'title' => 'string', 'category' => '?string', 'force' => '?bool', 'message' => '?string']);
        $category = $b['category'] ?? 'proposta';
        if (!in_array($category, self::CATEGORIES, true)) {
            Http::fail(400, 'Categoria non valida');
        }
        $error = null;
        if ($b['force'] === true) {
            $msg = trim((string)$b['message']);
            $error = $msg !== '' ? mb_substr($msg, 0, 500) : 'Inserito senza validazione';
        }
        $now = Db::now();
        $id = Db::insert(
            'INSERT INTO song (artist, title, category, validated, validation_error, proposed_by_id, last_modified_by_id, created_at, updated_at)
             VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)',
            [trim($b['artist']), trim($b['title']), $category, $error, $user['id'], $user['id'], $now, $now]
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
        Db::exec('DELETE FROM song_video WHERE song_id = ?', [$p['id']]);
        foreach (Db::all('SELECT stored_name FROM song_audio WHERE song_id = ?', [$p['id']]) as $a) {
            @unlink(Media::audioPath($a['stored_name']));
        }
        Db::exec('DELETE FROM song_audio WHERE song_id = ?', [$p['id']]);
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

    // ── Video e audio delle prove ────────────────────────────────────────────

    private static function videoOut(array $v): array
    {
        return [
            'id' => (int)$v['id'],
            'song_id' => (int)$v['song_id'],
            'user_id' => (int)$v['user_id'],
            'username' => self::username((int)$v['user_id']),
            'url' => $v['url'],
            'title' => $v['title'],
            'recorded_on' => $v['recorded_on'],
            'note' => $v['note'],
            'thumb_url' => $v['thumb_url'],
            'created_at' => Db::iso($v['created_at']),
            'updated_at' => Db::iso($v['updated_at']),
        ];
    }

    private static function audioOut(array $a): array
    {
        [$exp, $sig] = Media::sign((int)$a['id']);
        return [
            'id' => (int)$a['id'],
            'song_id' => (int)$a['song_id'],
            'user_id' => (int)$a['user_id'],
            'username' => self::username((int)$a['user_id']),
            'title' => $a['title'],
            'recorded_on' => $a['recorded_on'],
            'note' => $a['note'],
            'original_name' => $a['original_name'],
            'mime' => Media::AUDIO_TYPES[$a['ext']] ?? 'application/octet-stream',
            'size' => (int)$a['size'],
            'file_url' => self::appUrl() . "/api/songs/{$a['song_id']}/audios/{$a['id']}/file?e=$exp&s=$sig",
            'created_at' => Db::iso($a['created_at']),
            'updated_at' => Db::iso($a['updated_at']),
        ];
    }

    /** Solo chi ha caricato il contenuto lo modifica o elimina (nemmeno l'admin). */
    private static function requireOwner(array $row, array $user): void
    {
        if ((int)$row['user_id'] !== (int)$user['id']) {
            Http::fail(403, 'Puoi modificare solo i tuoi contenuti');
        }
    }

    private static function video(array $p): array
    {
        $v = Db::one('SELECT * FROM song_video WHERE id = ? AND song_id = ?', [$p['vid'], $p['id']]);
        if ($v === null) {
            Http::fail(404, 'Video non trovato');
        }
        return $v;
    }

    private static function audio(array $p): array
    {
        $a = Db::one('SELECT * FROM song_audio WHERE id = ? AND song_id = ?', [$p['aid'], $p['id']]);
        if ($a === null) {
            Http::fail(404, 'Audio non trovato');
        }
        return $a;
    }

    private static function listVideos(array $p, array $user): void
    {
        self::song($p['id']);
        $rows = Db::all('SELECT * FROM song_video WHERE song_id = ? ORDER BY recorded_on DESC, id DESC', [$p['id']]);
        Http::send(array_map([self::class, 'videoOut'], $rows));
    }

    private static function createVideo(array $p, array $user): void
    {
        $b = Http::body(['url' => 'string', 'title' => 'string', 'recorded_on' => 'string', 'note' => '?string', 'thumb_url' => '?string']);
        self::song($p['id']);
        $url = Media::checkUrl($b['url']);
        $title = Media::checkTitle($b['title']);
        $date = Media::checkDate($b['recorded_on']);
        $note = Media::checkNote($b['note']);
        // La miniatura e' solo un suggerimento: se non e' un https valido si ignora
        $thumb = $b['thumb_url'] !== null ? trim($b['thumb_url']) : null;
        if ($thumb !== null && (!str_starts_with(strtolower($thumb), 'https://') || mb_strlen($thumb) > Media::URL_MAX)) {
            $thumb = null;
        }
        $now = Db::now();
        $id = Db::insert(
            'INSERT INTO song_video (song_id, user_id, url, title, recorded_on, note, thumb_url, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$p['id'], $user['id'], $url, $title, $date, $note, $thumb, $now, $now]
        );
        Http::send(self::videoOut(Db::one('SELECT * FROM song_video WHERE id = ?', [$id])), 201);
    }

    private static function updateVideo(array $p, array $user): void
    {
        $b = Http::body(['title' => '?string', 'recorded_on' => '?string', 'note' => '?string']);
        $v = self::video($p);
        self::requireOwner($v, $user);
        $title = $b['title'] !== null ? Media::checkTitle($b['title']) : $v['title'];
        $date = $b['recorded_on'] !== null ? Media::checkDate($b['recorded_on']) : $v['recorded_on'];
        $note = $b['note'] !== null ? Media::checkNote($b['note']) : $v['note'];
        Db::exec(
            'UPDATE song_video SET title = ?, recorded_on = ?, note = ?, updated_at = ? WHERE id = ?',
            [$title, $date, $note, Db::now(), $v['id']]
        );
        Http::send(self::videoOut(Db::one('SELECT * FROM song_video WHERE id = ?', [$v['id']])));
    }

    private static function deleteVideo(array $p, array $user): void
    {
        $v = self::video($p);
        self::requireOwner($v, $user);
        Db::exec('DELETE FROM song_video WHERE id = ?', [$v['id']]);
        Http::send(null, 204);
    }

    /** Anteprima best effort di un link: qualunque problema di rete da' valori null, non un errore. */
    private static function mediaPreview(array $p, array $user): void
    {
        $b = Http::body(['url' => 'string']);
        $url = Media::checkUrl($b['url']);
        if (RateLimit::tooMany('preview', 30, 600)) {
            Http::fail(429, 'Troppe richieste, riprova tra qualche minuto');
        }
        RateLimit::hit('preview');
        set_time_limit(40);
        Http::send(LinkPreview::fetch($url));
    }

    private static function listAudios(array $p, array $user): void
    {
        self::song($p['id']);
        $rows = Db::all('SELECT * FROM song_audio WHERE song_id = ? ORDER BY recorded_on DESC, id DESC', [$p['id']]);
        Http::send(array_map([self::class, 'audioOut'], $rows));
    }

    private static function createAudio(array $p, array $user): void
    {
        ignore_user_abort(true);
        set_time_limit(300);
        self::song($p['id']);
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
        $b = Http::form(['title' => 'string', 'recorded_on' => 'string', 'note' => '?string']);
        $title = Media::checkTitle($b['title']);
        $date = Media::checkDate($b['recorded_on']);
        $note = Media::checkNote($b['note']);

        $original = (string)preg_replace('/[\x00-\x1F\x7F]+/u', '', basename(str_replace('\\', '/', (string)$f['name'])));
        $ext = strtolower(pathinfo($original, PATHINFO_EXTENSION));
        if (!isset(Media::AUDIO_TYPES[$ext])) {
            Http::fail(400, 'Formato non supportato (ammessi: ' . implode(', ', array_keys(Media::AUDIO_TYPES)) . ')');
        }
        $size = (int)$f['size'];
        if ($size <= 0) {
            Http::fail(400, 'Il file è vuoto');
        }

        $dir = Media::audioDir();
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            Http::fail(500, 'Cartella audio non disponibile');
        }
        $stored = bin2hex(random_bytes(16));   // nessuna estensione: il file non e' mai eseguibile
        if (!move_uploaded_file($f['tmp_name'], Media::audioPath($stored))) {
            Http::fail(500, 'Salvataggio del file non riuscito');
        }
        $now = Db::now();
        try {
            $id = Db::insert(
                'INSERT INTO song_audio (song_id, user_id, title, recorded_on, note, original_name, stored_name, ext, mime, size, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$p['id'], $user['id'], $title, $date, $note, mb_substr($original, 0, 200), $stored, $ext, Media::AUDIO_TYPES[$ext], $size, $now, $now]
            );
        } catch (Throwable $e) {
            @unlink(Media::audioPath($stored));
            throw $e;
        }
        Http::send(self::audioOut(Db::one('SELECT * FROM song_audio WHERE id = ?', [$id])), 201);
    }

    private static function updateAudio(array $p, array $user): void
    {
        $b = Http::body(['title' => '?string', 'recorded_on' => '?string', 'note' => '?string']);
        $a = self::audio($p);
        self::requireOwner($a, $user);
        $title = $b['title'] !== null ? Media::checkTitle($b['title']) : $a['title'];
        $date = $b['recorded_on'] !== null ? Media::checkDate($b['recorded_on']) : $a['recorded_on'];
        $note = $b['note'] !== null ? Media::checkNote($b['note']) : $a['note'];
        Db::exec(
            'UPDATE song_audio SET title = ?, recorded_on = ?, note = ?, updated_at = ? WHERE id = ?',
            [$title, $date, $note, Db::now(), $a['id']]
        );
        Http::send(self::audioOut(Db::one('SELECT * FROM song_audio WHERE id = ?', [$a['id']])));
    }

    private static function deleteAudio(array $p, array $user): void
    {
        $a = self::audio($p);
        self::requireOwner($a, $user);
        Db::exec('DELETE FROM song_audio WHERE id = ?', [$a['id']]);
        @unlink(Media::audioPath($a['stored_name']));
        Http::send(null, 204);
    }

    private static function audioFile(array $p, ?array $user): void
    {
        $a = Db::one('SELECT * FROM song_audio WHERE id = ? AND song_id = ?', [$p['aid'], $p['id']]);
        if ($a === null) {
            Http::fail(404, 'Audio non trovato');
        }
        if (!Media::verify($p['aid'], $_GET['e'] ?? null, $_GET['s'] ?? null)) {
            Http::fail(403, 'Link non valido o scaduto');
        }
        Media::stream($a, ($_GET['dl'] ?? '') === '1');
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

    private static function adminCreateInvite(array $p, array $admin): void
    {
        $b = Http::body(['role' => '?string']);
        $role = $b['role'] ?? 'member';
        if (!in_array($role, ['admin', 'member'], true)) {
            Http::fail(400, 'Ruolo non valido');
        }
        $token = Auth::newToken();
        $expires = Db::future(Auth::INVITE_TTL);
        $id = Db::insert(
            'INSERT INTO invite (token_hash, role, created_by_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
            [Auth::hashToken($token), $role, $admin['id'], Db::now(), $expires]
        );
        // Il token in chiaro e' restituito solo qui: a DB resta l'hash
        Http::send([
            'id' => $id,
            'role' => $role,
            'token' => $token,
            'url' => self::appUrl() . '/invite/' . $token,
            'expires_at' => Db::iso($expires),
        ], 201);
    }

    private static function adminListInvites(array $p, array $admin): void
    {
        $rows = Db::all(
            'SELECT id, role, created_at, expires_at FROM invite
             WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC',
            [Db::now()]
        );
        Http::send(array_map(fn($i) => [
            'id' => (int)$i['id'],
            'role' => $i['role'],
            'created_at' => Db::iso($i['created_at']),
            'expires_at' => Db::iso($i['expires_at']),
        ], $rows));
    }

    private static function adminRevokeInvite(array $p, array $admin): void
    {
        $n = Db::exec(
            'UPDATE invite SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL',
            [Db::now(), $p['iid']]
        );
        if ($n === 0) {
            Http::fail(404, 'Invito non trovato');
        }
        Http::send(null, 204);
    }

    private static function adminResetLink(array $p, array $admin): void
    {
        if (Db::one('SELECT id FROM "user" WHERE id = ?', [$p['uid']]) === null) {
            Http::fail(404, 'Utente non trovato');
        }
        Http::send(self::newResetLink($p['uid'], (int)$admin['id']), 201);
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
        Db::exec(
            'UPDATE "user" SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
            [Auth::hashPassword($b['new_password']), $p['uid']]
        );
        Http::send(['ok' => true]);
    }

    private static function adminDeleteUser(array $p, array $admin): void
    {
        if ($p['uid'] === (int)$admin['id']) {
            Http::fail(400, 'Non puoi eliminare te stesso');
        }
        $target = Db::one('SELECT id, role FROM "user" WHERE id = ?', [$p['uid']]);
        if ($target === null) {
            Http::fail(404, 'Utente non trovato');
        }
        if ($target['role'] === 'admin' && (int)Db::one('SELECT COUNT(*) AS n FROM "user" WHERE role = \'admin\'')['n'] <= 1) {
            Http::fail(400, "Non puoi eliminare l'ultimo admin");
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
