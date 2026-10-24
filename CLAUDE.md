# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

### Backend (run from `backend/`)
```bash
pip install -r requirements.txt
cp .env.example .env          # set SECRET_KEY
uvicorn main:app --reload --port 8001
```

### Frontend (run from `frontend/`)
```bash
npm install
npm run dev      # :5173, proxies /api → :8001
npm run build    # outputs to dist/
```

Both servers must run together for local development. The Vite proxy in `vite.config.js` forwards `/api/*` to `:8001`.

## Produzione: hosting Aruba (PHP + SQLite)

L'app gira su **`https://www.motorn.it/band/`** (`band.motorn.it` è un redirect 301 creato dal pannello Aruba: un record A + host rewrite non funziona, Aruba instrada per host e il certificato non copre il sottodominio). Hosting Linux condiviso: solo PHP 8.5 (CGI/FastCGI), nessun RDBMS, accesso solo FTP. Il backend FastAPI (`backend/`) è la versione originale (RPi), **legacy e non più mantenuta**; quello in produzione è la riscrittura PHP in **`php-api/`**, con le stesse API, lo stesso schema SQLite e gli stessi hash bcrypt.

- **Struttura sul server** (`/www.motorn.it/band/` via FTP): `index.html`+`assets/` (build), `.htaccess` (da `frontend/public/.htaccess`), `api/` (da `php-api/`), `api/config.php` (SECRET_KEY, creato dal deploy, mai sovrascritto), `api/data/` (DB `band_manager.db` e `error.log`, protetti da `Require all denied`). Nella radice di `www.motorn.it` non c'è nulla del progetto: ogni servizio ha la sua sottocartella.
- **Credenziali FTP:** `deploy/.ftp.env` (non versionato; modello `deploy/.ftp.env.example`).
- **Router PHP:** `php-api/index.php` → `src/Routes.php` (tabella metodo/regex/handler); `Db.php` crea/migra lo schema al primo request (`PRAGMA user_version`); `Auth.php` JWT HS256 a mano; `Services.php` client curl (Groq, Genius, lyrics.ovh, Songsterr); `Enrich.php` pipeline. `allow_url_fopen` è Off: solo curl. Modello Groq: costante `Groq::MODEL` (`openai/gpt-oss-120b`, con ragionamento: usare `max_completion_tokens` larghi e `reasoning_effort: low`; con `max_tokens` bassi la risposta esce vuota).
- **Arricchimento:** non ci sono task in background. `POST /api/songs` crea il brano; il frontend poi chiama `POST /api/songs/{id}/enrich` (esegue tutta la pipeline, `ignore_user_abort`) e fa polling su `GET /api/songs/{id}`.
- **Authorization:** sotto CGI/FastCGI Apache può scartarla: il `.htaccess` la reinoltra e il frontend invia anche `X-Auth-Token`. Senza header il valore è stringa vuota, trattata come assente.
- **`Options -MultiViews`** nel `.htaccess` è necessario (altrimenti `/api/config` si risolve in `config.php`).

```bash
# Dalla cartella band-manager/ (Git Bash)
bash deploy/deploy_aruba.sh band                  # API + frontend (build con base /band/)
bash deploy/deploy_aruba.sh band --api            # solo API (+ .htaccess radice)
bash deploy/deploy_aruba.sh band --frontend       # solo frontend
bash deploy/backup_db_aruba.sh band               # scarica il DB in backups/ (farlo prima di ogni deploy API)

# Ambiente di prova (DB e config propri, www.motorn.it/band-test/)
bash deploy/deploy_aruba.sh band-test --api
```

Il deploy non tocca mai `api/config.php` né `api/data/*` (tranne `data/.htaccess`). Build con base diversa: `export MSYS2_ENV_CONV_EXCL=VITE_BASE; VITE_BASE=/ npm run build` (Git Bash converte altrimenti `/` in un percorso Windows).

### Test

```bash
# API (pytest + httpx) contro l'ambiente di prova; non lanciarli sul DB di produzione
pip install pytest httpx
cd tests/api && API_BASE_URL=https://www.motorn.it/band-test/api pytest -q    # ADMIN_USER/ADMIN_PASSWORD se diversi da admin/admin123
# Frontend: controlla base path in index.html, manifest, service worker
bash tests/frontend/check_base.sh /band/
```

L'ambiente `band-test` ha un DB vuoto (seed `admin`/`admin123`). Per i test sul PHP non c'è PHP in locale: si deploya su `band-test` e si lancia pytest da lì.

## Deploy to RPi4 (LEGACY — non più mantenuto)

> Dal 2026-10-24 si mantiene solo la produzione su Aruba. `backend/` (FastAPI) e questo deploy non vanno aggiornati né usati, salvo richiesta esplicita; restano come riferimento storico.

- **SSH key:** `~/.ssh/rpi_strava` | **Host:** `szz@192.168.1.20` | **Path:** `/home/szz/Documents/progetti/band/`
- **Public URL:** `https://homeszz.ddns.net/band/`
- **Service:** `band-backend` (systemd, runs uvicorn on `127.0.0.1:8001` from `backend/`)
- Nginx on `:82` serves `frontend/dist/` and proxies `/band/api/` → `:8001`
- Strava's nginx on `:443` proxies `/band/` → `http://127.0.0.1:82/band/`

```bash
# Transfer files (always run from repo root, not band-manager/)
tar -czf - --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='node_modules' --exclude='dist' \
  --exclude='.env' --exclude='*.db' \
  -C band-manager . | \
  ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 \
  "cd ~/Documents/progetti/band && tar -xzf -"

# After Python changes
ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 "sudo systemctl restart band-backend"

# After frontend changes (run npm install first if dependencies changed)
ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 \
  "cd ~/Documents/progetti/band/frontend && npm run build"

# Logs
ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 "sudo journalctl -u band-backend -f"

# DB backup before deploy
ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 \
  "cp ~/Documents/progetti/band/backend/band_manager.db ~/Documents/progetti/band/backend/band_manager.db.bak"
```

## Architecture

**Request flow:** Browser → Strava nginx :443 (`/band/` prefix) → nginx :82 → static `dist/` or FastAPI :8001

All Python imports use relative names (`from database import ...`), so the backend **must** be started from `backend/`.

### Backend (`backend/`)

- **`main.py`** — all routes + `enrich_song_bg` background task
- **`database.py`** — SQLModel models + safe migrations in `init_db()` (ALTER TABLE / CREATE IF NOT EXISTS, never drops data)
- **`auth.py`** — JWT via `python-jose`; bcrypt used directly (not passlib, incompatible with bcrypt ≥4); JWT `sub` is a string, cast to `int` on decode
- **`modules/validation.py`** — Groq `llama-3.3-70b-versatile` (non più disponibile su Groq; la produzione PHP usa `openai/gpt-oss-120b`, vedi `php-api/src/Services.php`) validates and normalizes artist/title
- **`modules/lyrics.py`** — Genius API for `cover_url` only; **lyrics.ovh** for lyrics text (Genius blocks server-side scraping with 403)
- **`modules/chords.py`** — Songsterr JSON API for tab URL; falls back to search URL on 404
- **`modules/chords_text.py`** — Groq `llama-3.3-70b-versatile` (idem, obsoleto) generates chord-over-lyrics schema (only called when `chords_enabled` setting is `"true"`)

#### DB models

| Model | Key fields |
|---|---|
| `User` | `username`, `password_hash`, `role` (`admin`\|`member`) |
| `Song` | `artist`, `title`, `category`, `validated`, `lyrics`, `cover_url`, `chords_url`, `chords_text`, `youtube_url` |
| `AppSetting` | `key` (PK), `value` — stores `groq_api_key`, `genius_api_key`, `chords_enabled` |
| `Comment` | `song_id`, `user_id`, `content`, `parent_id` (nullable, for threads) |
| `SongLike` | `song_id`, `user_id` (unique together) |

#### API surface

```
GET  /api/config                        → { chords_enabled: bool }
POST /api/auth/login                    → { token, user }
GET  /api/auth/me
PUT  /api/auth/password                 → requires current_password + new_password (min 6)

GET  /api/songs                         → list, optional ?category=
POST /api/songs                         → creates + triggers enrich_song_bg
GET  /api/songs/{id}
PUT  /api/songs/{id}
DELETE /api/songs/{id}
PUT  /api/songs/{id}/category
POST /api/songs/{id}/enrich             → re-triggers enrichment manually

GET  /api/songs/{id}/comments
POST /api/songs/{id}/comments           → body: { content, parent_id? }
PUT  /api/songs/{id}/comments/{cid}
DELETE /api/songs/{id}/comments/{cid}

GET  /api/songs/{id}/likes              → { count, liked: bool }
POST /api/songs/{id}/likes              → toggles like

GET  /api/admin/users
POST /api/admin/users
PUT  /api/admin/users/{id}/password     → admin resets any user's password
DELETE /api/admin/users/{id}
GET  /api/admin/settings
PUT  /api/admin/settings
```

#### API key storage

`groq_api_key` and `genius_api_key` are **not** in `.env` — they live in `AppSetting` and are set via the Admin UI. Read at runtime with `get_setting(session, key)`. `.env` holds only `SECRET_KEY`.

#### Song enrichment flow

`POST /api/songs` triggers `enrich_song_bg` as a `BackgroundTask`:
1. Groq validates and normalizes artist/title
2. Genius → `cover_url`; lyrics.ovh → `lyrics`
3. Songsterr → `chords_url`; YouTube Music URL auto-generated
4. If `chords_enabled`: Groq → `chords_text` (chord-over-lyrics format)
5. `validated = True`

Frontend polls `GET /api/songs/{id}` every 2 s until `validated = True`.

### Frontend (`frontend/src/`)

- **`api/client.js`** — axios instance; `baseURL = BASE_URL + 'api'` → `/band/api` in prod, `/api` in dev. 401 interceptor clears localStorage and redirects to login.
- **`context/AuthContext.jsx`** — JWT in `localStorage` as `band_token`; user object as `band_user`. `isAdmin()` checks `role === 'admin'`.
- **`version.js`** — exports `VERSION = __APP_VERSION__` (injected by Vite from `package.json` at build time — bump only `package.json`)

#### Routes

| Path | Component | Access |
|---|---|---|
| `/` | `Songs.jsx` | all |
| `/songs/:id` | `SongDetail.jsx` | all |
| `/add` | `AddEditSong.jsx` | all |
| `/songs/:id/edit` | `AddEditSong.jsx` | all |
| `/admin` | `Admin.jsx` | admin only |
| `/profile` | `Profile.jsx` | all |

#### PWA

Configured via `vite-plugin-pwa` in `vite.config.js` with `registerType: 'autoUpdate'`. Icons in `public/`: `icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`, `apple-touch-icon.png`. Manifest has `scope: "/band/"` and `id: "/band/"` to avoid conflict with the Strava PWA on the same domain (scope `/`). If Strava PWA is installed first, the user must uninstall and reinstall it for Chrome to recognize Band Manager as a separate app.
