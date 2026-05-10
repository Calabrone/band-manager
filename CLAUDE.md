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

## Deploy to RPi4

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
- **`modules/validation.py`** — Groq `llama-3.3-70b-versatile` validates and normalizes artist/title
- **`modules/lyrics.py`** — Genius API for `cover_url` only; **lyrics.ovh** for lyrics text (Genius blocks server-side scraping with 403)
- **`modules/chords.py`** — Songsterr JSON API for tab URL; falls back to search URL on 404
- **`modules/chords_text.py`** — Groq `llama-3.3-70b-versatile` generates chord-over-lyrics schema (only called when `chords_enabled` setting is `"true"`)

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
