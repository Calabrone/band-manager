<?php
declare(strict_types=1);

final class Config
{
    private static ?array $cfg = null;

    public static function get(string $key): string
    {
        if (self::$cfg === null) {
            $file = dirname(__DIR__) . '/config.php';
            if (!is_file($file)) {
                Http::fail(500, 'Configurazione mancante');
            }
            self::$cfg = require $file;
        }
        return (string)(self::$cfg[$key] ?? '');
    }
}

final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo !== null) {
            return self::$pdo;
        }
        $path = Config::get('db_path');
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA busy_timeout=5000');
        // Come SQLAlchemy/SQLite oggi: FK non applicate dal DB, il cascade e' esplicito nel codice.
        $pdo->exec('PRAGMA foreign_keys=OFF');
        self::$pdo = $pdo;
        self::init($pdo);
        return $pdo;
    }

    public static function all(string $sql, array $params = []): array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    public static function one(string $sql, array $params = []): ?array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public static function exec(string $sql, array $params = []): int
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    public static function insert(string $sql, array $params = []): int
    {
        self::exec($sql, $params);
        return (int)self::pdo()->lastInsertId();
    }

    /** Timestamp UTC nel formato scritto da SQLModel: "Y-m-d H:i:s.u". */
    public static function now(): string
    {
        $t = microtime(true);
        return gmdate('Y-m-d H:i:s', (int)$t) . '.' . sprintf('%06d', (int)(($t - floor($t)) * 1000000));
    }

    /** Timestamp UTC (stesso formato di now()) tra $seconds secondi. */
    public static function future(int $seconds): string
    {
        $t = microtime(true) + $seconds;
        return gmdate('Y-m-d H:i:s', (int)$t) . '.' . sprintf('%06d', (int)(($t - floor($t)) * 1000000));
    }

    /** ISO 8601 senza timezone, come l'output di FastAPI ("T" al posto dello spazio). */
    public static function iso(string $dbDate): string
    {
        return str_replace(' ', 'T', $dbDate);
    }

    private static function init(PDO $pdo): void
    {
        if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() >= 2) {
            return;
        }
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            // Un'altra richiesta puo' aver inizializzato mentre aspettavamo il lock.
            $version = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
            if ($version >= 2) {
                $pdo->exec('COMMIT');
                return;
            }
            if ($version < 1) {
                foreach (self::schema() as $ddl) {
                    $pdo->exec($ddl);
                }
                // Migrazione sicura per DB creati prima di chords_text
                try {
                    $pdo->exec('ALTER TABLE song ADD COLUMN chords_text TEXT');
                } catch (Throwable $e) {
                    // colonna gia' presente
                }
                self::seed($pdo);
            }
            self::migrateV2($pdo);
            $pdo->exec('PRAGMA user_version=2');
            $pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $pdo->exec('ROLLBACK');
            throw $e;
        }
    }

    /** Inviti, reset password, email utente, invalidazione JWT, rate limit. */
    private static function migrateV2(PDO $pdo): void
    {
        $dup = $pdo->query('SELECT lower(username) AS u, COUNT(*) AS n FROM "user" GROUP BY lower(username) HAVING n > 1')->fetch();
        if ($dup !== false) {
            throw new RuntimeException('Migrazione v2 bloccata: username duplicati ignorando le maiuscole (' . $dup['u'] . ')');
        }
        foreach ([
            'ALTER TABLE "user" ADD COLUMN email VARCHAR',
            'ALTER TABLE "user" ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0',
            'ALTER TABLE "user" ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT 0',
            'CREATE UNIQUE INDEX IF NOT EXISTS ix_user_username_nocase ON "user" (username COLLATE NOCASE)',
            'CREATE UNIQUE INDEX IF NOT EXISTS ix_user_email_nocase ON "user" (email COLLATE NOCASE) WHERE email IS NOT NULL',
            'CREATE TABLE IF NOT EXISTS invite (
                id INTEGER PRIMARY KEY, token_hash VARCHAR NOT NULL UNIQUE, role VARCHAR NOT NULL,
                created_by_id INTEGER NOT NULL, created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL,
                used_at DATETIME, used_by_id INTEGER, revoked_at DATETIME)',
            'CREATE TABLE IF NOT EXISTS password_reset (
                id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, token_hash VARCHAR NOT NULL UNIQUE,
                created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL, used_at DATETIME,
                created_by_admin_id INTEGER)',
            'CREATE TABLE IF NOT EXISTS rate_hit (id INTEGER PRIMARY KEY, bucket VARCHAR NOT NULL, ts INTEGER NOT NULL)',
            'CREATE INDEX IF NOT EXISTS ix_rate_hit_bucket ON rate_hit (bucket, ts)',
        ] as $ddl) {
            $pdo->exec($ddl);
        }
    }

    private static function schema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS "user" (
                id INTEGER NOT NULL, username VARCHAR NOT NULL, password_hash VARCHAR NOT NULL,
                role VARCHAR NOT NULL, created_at DATETIME NOT NULL, PRIMARY KEY (id))',
            'CREATE UNIQUE INDEX IF NOT EXISTS ix_user_username ON "user" (username)',
            'CREATE TABLE IF NOT EXISTS song (
                id INTEGER NOT NULL, artist VARCHAR NOT NULL, title VARCHAR NOT NULL, category VARCHAR NOT NULL,
                validated BOOLEAN NOT NULL, validation_error VARCHAR, lyrics VARCHAR, chords_url VARCHAR,
                youtube_url VARCHAR, cover_url VARCHAR, proposed_by_id INTEGER NOT NULL,
                last_modified_by_id INTEGER NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
                chords_text TEXT, PRIMARY KEY (id),
                FOREIGN KEY(proposed_by_id) REFERENCES "user" (id),
                FOREIGN KEY(last_modified_by_id) REFERENCES "user" (id))',
            'CREATE TABLE IF NOT EXISTS appsetting ("key" VARCHAR NOT NULL, value VARCHAR NOT NULL, PRIMARY KEY ("key"))',
            'CREATE TABLE IF NOT EXISTS comment (
                id INTEGER NOT NULL, song_id INTEGER NOT NULL, user_id INTEGER NOT NULL, content VARCHAR NOT NULL,
                parent_id INTEGER, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, PRIMARY KEY (id),
                FOREIGN KEY(song_id) REFERENCES song (id), FOREIGN KEY(user_id) REFERENCES "user" (id),
                FOREIGN KEY(parent_id) REFERENCES comment (id))',
            'CREATE INDEX IF NOT EXISTS ix_comment_song_id ON comment (song_id)',
            'CREATE TABLE IF NOT EXISTS songlike (
                id INTEGER NOT NULL, song_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (id),
                FOREIGN KEY(song_id) REFERENCES song (id), FOREIGN KEY(user_id) REFERENCES "user" (id))',
            'CREATE INDEX IF NOT EXISTS ix_songlike_song_id ON songlike (song_id)',
            'CREATE UNIQUE INDEX IF NOT EXISTS uq_songlike ON songlike (song_id, user_id)',
        ];
    }

    private static function seed(PDO $pdo): void
    {
        if ($pdo->query('SELECT COUNT(*) FROM "user"')->fetchColumn() == 0) {
            $st = $pdo->prepare('INSERT INTO "user" (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)');
            $st->execute(['admin', password_hash('admin123', PASSWORD_BCRYPT), 'admin', self::now()]);
        }
        $st = $pdo->prepare('INSERT OR IGNORE INTO appsetting ("key", value) VALUES (?, ?)');
        foreach (['groq_api_key' => '', 'genius_api_key' => '', 'chords_enabled' => 'false'] as $k => $v) {
            $st->execute([$k, $v]);
        }
    }
}
