# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

### Backend (run from `backend/`)
```bash
# Install dependencies
pip install -r requirements.txt

# Create .env from example
cp .env.example .env  # then set SECRET_KEY

# Run dev server
uvicorn main:app --reload --port 8001
```

### Frontend (run from `frontend/`)
```bash
npm install
npm run dev      # dev server on :5173, proxies /api → :8001
npm run build    # outputs to dist/
```

The Vite dev proxy (`vite.config.js`) forwards `/api/*` to `http://localhost:8001`, so both servers must be running for local development.

## Architecture

**Request flow:** Browser → Nginx :82 (`/band/` prefix) → static files or proxy to FastAPI :8001

All Python runs from the `backend/` directory. The FastAPI app (`main.py`) imports modules using relative names (`from database import ...`, `from modules.validation import ...`), so it must be started from `backend/`.

### Backend

- **`main.py`** — all routes and the song enrichment background task (`enrich_song_bg`)
  - Auth: `POST /api/auth/login`, `GET /api/auth/me`, `PUT /api/auth/password` (change own password, requires current_password + new_password, min 6 chars)
  - Admin users: `GET/POST /api/admin/users`, `DELETE /api/admin/users/{id}`, `PUT /api/admin/users/{id}/password` (reset any user's password)
  - Admin settings: `GET/PUT /api/admin/settings`
- **`database.py`** — SQLModel models (`User`, `Song`, `AppSetting`) and `seed_admin` which creates `admin/admin123` only when the DB is empty
- **`auth.py`** — JWT utilities; uses `bcrypt` directly (not `passlib`, which is incompatible with bcrypt ≥4); JWT `sub` is stored as a string, cast to `int` on decode
- **`modules/validation.py`** — Groq (`llama-3.3-70b-versatile`) validates that a song exists and normalizes artist/title
- **`modules/lyrics.py`** — Genius authenticated API for cover art only; **lyrics.ovh** (`https://api.lyrics.ovh/v1/{artist}/{title}`) for lyrics text. Do not use lyricsgenius for scraping lyrics — Genius blocks server-side requests with 403.
- **`modules/chords.py`** — Songsterr JSON API for tab link; falls back to search URL on 404

### Song enrichment flow

Adding a song triggers `enrich_song_bg` as a FastAPI `BackgroundTask`:
1. Groq validates artist/title and returns normalized names
2. Genius API search for `cover_url`; lyrics.ovh for lyrics text
3. Songsterr for `chords_url`; YouTube Music URL auto-generated
4. Song set to `validated=True`

Frontend polls `GET /api/songs/{id}` every 2 seconds until `validated=True`.

### Frontend

- **`api/client.js`** — axios instance; `baseURL` uses `import.meta.env.BASE_URL + 'api'` (resolves to `/band/api` in prod, `/api` in dev). The 401 interceptor clears localStorage and redirects to `BASE_URL + 'login'`.
- **`context/AuthContext.jsx`** — JWT stored in `localStorage` as `band_token` (raw token) and `band_user` (JSON user object). `isAdmin()` checks `role === 'admin'`.
- Routes: `/` (Songs list), `/songs/:id` (detail), `/add`, `/songs/:id/edit`, `/admin` (admin-only), `/profile` (all users — change password + logout)
- **`pages/Profile.jsx`** — change-password form (requires current password) and logout button, accessible to all logged-in users

### API key storage

Groq and LyricsGenius/Genius keys are **not** in `.env`. They are saved in the `AppSetting` DB table via the Admin UI and read at enrichment time with `get_setting(session, key)`. `.env` holds only `SECRET_KEY`.

## Deploy to RPi4

- **SSH key:** `~/.ssh/rpi_strava` | **Host:** `szz@192.168.1.20` | **Path:** `/home/szz/Documents/progetti/band/`
- **Public URL:** `https://homeszz.ddns.net/band/`
- Nginx on :82 serves static `dist/` and proxies `/band/api/` → :8001 (strips `/band` prefix)
- Strava nginx on :443 proxies `/band/` → `http://127.0.0.1:82/band/`

```bash
# Transfer updated files
tar -czf - --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='node_modules' --exclude='dist' \
  --exclude='.env' --exclude='*.db' \
  -C band-manager . | \
  ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 \
  "cd ~/Documents/progetti/band && tar -xzf -"

# After Python changes
ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 "sudo systemctl restart band-backend"

# After frontend changes
ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 \
  "cd ~/Documents/progetti/band/frontend && npm run build"

# Check logs
ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 "sudo journalctl -u band-backend -f"
```
