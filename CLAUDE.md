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

### Prova locale con Docker (obbligatoria prima di commit, push e deploy)

Non c'è PHP installato: si prova in `deploy/local/` (php:8.3-apache, stessa logica `.htaccess` di Aruba, senza redirect HTTPS). Sito su `http://localhost:8080/band/`; il DB sta in un volume Docker (`down -v` lo azzera, poi servono di nuovo le chiavi Groq/Genius da Admin → Impostazioni).

```bash
# Dalla cartella band-manager/
(cd frontend && npm run build)                                   # base /band/
docker build -t band-local-web deploy/local                      # solo la prima volta o se cambia il Dockerfile
docker compose -f deploy/local/docker-compose.yml up -d --no-build
docker compose -f deploy/local/docker-compose.yml down           # stop (il DB resta)
```

`docker compose up --build` fallisce qui (`failed to execute bake`): costruire l'immagine con `docker build`. Il PHP si ricarica a ogni richiesta; il frontend richiede un nuovo `npm run build`. Flusso: modifica → prova su Docker → commit/push → backup DB → deploy Aruba.

### Test

```bash
# API (pytest + httpx) contro l'ambiente di prova; non lanciarli sul DB di produzione
pip install pytest httpx
cd tests/api && API_BASE_URL=https://www.motorn.it/band-test/api ADMIN_PASSWORD=... pytest -q    # ADMIN_USER se diverso da admin
# Frontend: test unitari (accordi, Sala prove, swipe, guida, temi; nessuna dipendenza, Node >= 20)
node --test tests/frontend/*.test.mjs
# End-to-end della Sala prove (Chrome headless, microfono/fotocamera finti; Node >= 22) su un sito locale o di prova, mai sulla produzione
ADMIN_PASSWORD=... E2E_SITE=http://localhost:8080/band node tests/e2e/studio.e2e.mjs
# End-to-end dei temi (360×780; E2E_SHOTS=<cartella> salva le schermate di tutte le pagine in tre temi)
ADMIN_PASSWORD=... E2E_SITE=http://localhost:8080/band node tests/e2e/theme.e2e.mjs
# End-to-end dei link condivisi (login con ritorno, focus, istante/loop, schede, appunti)
ADMIN_PASSWORD=... E2E_SITE=http://localhost:8080/band node tests/e2e/share.e2e.mjs
# Frontend: controlla base path in index.html, manifest, service worker
bash tests/frontend/check_base.sh /band/
```

L'ambiente `band-test` parte con un DB vuoto (seed `admin`/`admin123`), ma l'API obbliga l'admin con la password di default a cambiarla (`must_change_password`): al primo setup cambiarla da Profilo o con `PUT /api/auth/password`, poi passarla in `ADMIN_PASSWORD`. Per i test sul PHP non c'è PHP in locale: si deploya su `band-test` e si lancia pytest da lì.

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
PUT  /api/auth/password                 → requires current_password + new_password (min 6); returns { ok, token, user } (token_version++ invalida i JWT precedenti)
PUT  /api/auth/profile                  → { username?, email? } (username unico case-insensitive 3-30 [A-Za-z0-9._-]; email unica, "" la cancella)
PUT  /api/auth/theme                    → { theme: {...}|null } tema dell'aspetto dell'utente (Theme::validate, 422 se non valido); risponde userOut (con `theme`)
GET  /api/auth/invite/{token}           → { valid, role?, expires_at? } (pubblico)
POST /api/auth/register                 → { token, username, email, password } → crea l'utente col ruolo dell'invito (pubblico, solo con invito valido)
POST /api/auth/forgot                   → { email } → sempre { ok: true }; manda mail(), link valido 1 h (pubblico, rate limit)
GET  /api/auth/reset/{token}            → { valid } (pubblico)
POST /api/auth/reset                    → { token, new_password } (pubblico, monouso)

GET  /api/songs                         → list, optional ?category=
POST /api/songs/validate                → { artist, title } → esito Groq + `suggestion: {artist,title,reason}|null`, NON scrive nel DB. Se non valido, `Groq::suggestCorrection` fa tool calling (`search_music` → `MusicBrainz::search`, max 3 giri, ≤40 s) e propone la correzione; il frontend mostra «Intendevi…?» + "Usa suggerimento"
POST /api/songs                         → { artist, title, category?, force?, message? } crea il record (il frontend lo chiama solo dopo validate ok, oppure con force=true per "Inserisci comunque"); enrich poi via POST /songs/{id}/enrich
GET  /api/songs/{id}
PUT  /api/songs/{id}
DELETE /api/songs/{id}
PUT  /api/songs/{id}/category
PUT  /api/songs/{id}/cover              → { video_id|null } video di prova da cui prendere la copertina (solo brani senza cover Genius)
POST /api/songs/{id}/enrich             → re-triggers enrichment manually
PUT  /api/songs/{id}/lyrics             → { lyrics } testo a mano con accordi in linea (max 30000); "" lo svuota; lyrics_source = manual
POST /api/songs/{id}/lyrics/ocr         → multipart image (JPEG/PNG/WebP, max 4 MB) → { text, has_chords }; non salva

GET  /api/songs/{id}/comments
POST /api/songs/{id}/comments           → body: { content, parent_id? }
PUT  /api/songs/{id}/comments/{cid}
DELETE /api/songs/{id}/comments/{cid}

GET  /api/songs/{id}/likes              → { count, liked: bool }
POST /api/songs/{id}/likes              → toggles like

GET/POST /api/songs/{id}/videos         → link video prove (GoPro): { url, title, recorded_on, note?, thumb_url? }
PUT/DELETE /api/songs/{id}/videos/{vid} → solo chi l'ha inserito (nemmeno l'admin)
POST /api/media/preview                 → { url } → { title, image } (Open Graph, best effort; mai verso IP interni)
GET  /api/songs/{id}/audios             → audio prove, con file_url firmato (HMAC, 6 h)
POST /api/songs/{id}/audios             → multipart: file, title, recorded_on, note? (mp3 m4a aac wav ogg oga opus flac amr 3gp 3gpp caf webm mp4)
PUT/DELETE /api/songs/{id}/audios/{aid} → solo chi l'ha caricato
GET  /api/songs/{id}/audios/{aid}/file?e=&s=[&dl=1] → stream con Range (206/416); firma in query perché <audio> non manda Authorization

GET/POST /api/studio/projects           → Sala prove: brani di prova { title, description?, bpm?, music_key? }; GET ?status=a,b (default: tutti tranne archiviato)
GET/PUT/DELETE /api/studio/projects/{pid} → solo creatore o admin per PUT/DELETE; DELETE 409 se promosso con brano esistente
PUT  /api/studio/projects/{pid}/status  → { status } idea|lavorazione|pronto|archiviato (promosso solo con promote)
POST /api/studio/projects/{pid}/promote → { title, artist, category } crea il brano (inedito) e porta il progetto a "promosso"; solo se "pronto"
POST /api/studio/projects/{pid}/takes   → multipart: file, kind (audio|video), title, description?, duration_ms?, trim_start_ms/trim_end_ms?, peaks?, recorded_in_app?, base_take_id? + offset_ms/sync_ms/base_start_ms/base_loop_start_ms/base_loop_end_ms
GET/PUT/DELETE /api/studio/takes/{tid}  → GET con peaks, file_url firmato e base; PUT { title?, description?, trim_start_ms+trim_end_ms (null = intero), offset_ms? } e DELETE solo all'autore (nemmeno l'admin)
GET  /api/studio/takes/{tid}/file?e=&s=[&dl=1] → stream con Range; firma con scope "take" (non vale per gli audio di rehearsal-media)
GET/POST /api/studio/takes/{tid}/markers, PUT/DELETE …/markers/{mid}   → { time_ms, label ≤80 }, modifica solo l'autore
GET/POST /api/studio/takes/{tid}/comments, PUT/DELETE …/comments/{cid} → { content ≤2000 }, commenti semplici, citazioni nel testo [[m:id]] / [[t:ms]]
GET  /api/studio/usage                  → { bytes, count } spazio occupato dalle prove
PUT  /api/studio/projects/{pid}/lyrics  → { lyrics } testo del brano di prova (tutti gli utenti; max 30000; "" lo svuota) → progetto completo
POST /api/studio/projects/{pid}/lyrics/ocr → multipart image → { text, has_chords }; non salva
GET/POST /api/studio/projects/{pid}/comments → commenti del brano di prova { content, parent_id? } (come le cover: un livello di risposte)
PUT/DELETE /api/studio/projects/{pid}/comments/{cid} → PUT solo l'autore, DELETE autore o admin
GET/POST /api/studio/projects/{pid}/videos → link video del brano di prova (come le cover)
PUT/DELETE /api/studio/projects/{pid}/videos/{vid} → solo chi l'ha inserito
PUT  /api/studio/takes/{tid}/analysis    → { peaks:[0-255], duration_ms } salva la forma d'onda calcolata dal browser; una tantum (non sovrascrive), chiunque; lo fa `usePlayback` alla prima apertura di un contenuto senza picchi (es. audio spostato da una cover)
POST /api/songs/{id}/to-studio          → { project_id } sposta una cover nelle Prove (solo chi l'ha proposta o admin)

GET  /api/admin/users
PUT  /api/admin/users/{id}/password     → admin resets any user's password
POST /api/admin/users/{id}/reset-link   → { url, expires_at } link di reset (1 h) da mandare in chat
GET  /api/admin/invites                 → inviti pendenti
POST /api/admin/invites                 → { role? } → { id, token, url, expires_at } (7 giorni, monouso; token in chiaro solo qui)
DELETE /api/admin/invites/{id}          → revoca
DELETE /api/admin/users/{id}
GET  /api/admin/settings
PUT  /api/admin/settings
```

#### Accesso su invito (solo PHP/Aruba)

Non c'è registrazione libera né creazione utenti con password dell'admin: l'admin genera un link `/invite/<token>` (QR incluso) da Admin → Utenti, il membro sceglie username, email e password. Token (invito e reset) = 256 bit casuali, a DB solo lo SHA-256 (`invite`, `password_reset`); scadenza, monouso, revocabili. `user.token_version` finisce nel claim `tv` del JWT: cambio/reset password invalida le sessioni precedenti. `user.must_change_password` blocca ogni route tranne `/auth/me` e `/auth/password` finché l'admin con password `admin123` non la cambia. Rate limit per IP su login e forgot (tabella `rate_hit`). Email: su Aruba `mail()` restituisce false e non consegna, quindi in produzione si usa SMTP autenticato (`Mailer::viaSmtp`, curl `smtps://smtps.aruba.it:465`) con la casella `noreply@motorn.it`: chiavi `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `mail_from` in `config.php` (mai sovrascritto dal deploy; le credenziali locali stanno in `deploy/.smtp.env`, non versionato). Senza `smtp_host` ripiega su `mail()`. `app_url` opzionale, altrimenti dedotto dalla richiesta. Se la mail non arriva resta il link di reset generato dall'admin. Schema v2 (`PRAGMA user_version=2`).

#### Duplicati, brani non verificati, copertina (solo PHP/Aruba)

Schema v5 (`PRAGMA user_version=5`): `song.unverified` e `song.cover_video_id`. **Duplicati:** `Routes::assertNotDuplicate` risponde 409 `Il brano esiste già: «titolo» di artista (sezione X)` se esiste un brano con stesso artista+titolo (senza badare a maiuscole/spazi); controllato in `POST /songs/validate` (sui nomi digitati e su quelli normalizzati da Groq), `POST /songs` (anche con `force`) e `PUT /songs/{id}`. **Non verificato:** `force=true` imposta `unverified=1` (resta `validation_error` col messaggio); il frontend mostra "Non verificato" (ambra) invece di "Errore" (rosso); `Enrich::run` riuscito azzera il flag, un arricchimento fallito lo lascia. I brani forzati prima della v5 restano "Errore" finché si ricarica il testo. **Copertina:** senza `cover_url` (Genius) la copertina arriva dalla miniatura di un video di prova; `PUT /songs/{id}/cover` `{video_id}` sceglie quale (`null` = il più recente), `songOut` espone `cover_from_video`, `cover_video_id`, e `videoOut` espone `cover_thumb`. Frontend: `components/CoverPicker.jsx`. Test: `TestDuplicates`, `TestCoverChoice` in `tests/api/test_access.py` (i brani di test usano nomi univoci con `uniq()` di `conftest.py`).

#### Video e audio delle prove (solo PHP/Aruba)

Schema v3 (`PRAGMA user_version=3`): tabelle `song_video` e `song_audio`. I file audio stanno in `api/data/audio/` con nome casuale senza estensione (protetta da `data/.htaccess`, servita solo da `Media::stream`); il tipo si decide dall'estensione (whitelist in `Media::AUDIO_TYPES`), nessuna conversione. Limiti upload su Aruba misurati: 128 MB (`GET /config` → `max_upload_bytes`). `LinkPreview` (in `Media.php`) risolve l'host, rifiuta IP privati/riservati e porte diverse da 80/443, segue max 3 redirect a mano. Frontend: `components/SongMedia.jsx`. Spec: `.kiro/specs/rehearsal-media/`. Test: `tests/api/test_media.py`.

#### Sala prove (solo PHP/Aruba)

Sezione **Prove** (voce nella barra in basso), separata dalle cover: brani di prova con titolo provvisorio, contenuti audio/video caricati o registrati nell'app, player con loop A-B, marker e commenti. Schema v6 (`PRAGMA user_version=6`): `studio_project` (stato `idea`→`lavorazione`→`pronto`→`promosso`, `archiviato`; `song_id` dopo la promozione), `studio_take` (file in `api/data/studio/`, nome casuale senza estensione; `kind` audio/video, `trim_*` = taglio predefinito dell'autore, `peaks` JSON della forma d'onda calcolata dal client, campi della sovraincisione), `studio_marker`, `studio_comment`; chiave `band_name` in `appsetting` (Admin → Impostazioni, in chiaro) precompila l'artista nella promozione ed è esposta da `GET /config`. Backend: `php-api/src/Studio.php` (le route stanno nella tabella di `Routes.php` come `Studio::metodo`); `Media.php` ha `VIDEO_TYPES`, `studioMime(ext, kind)`, firme con scope (`audio`/`take`) e `stream()` con cartella e MIME parametrici. **Promozione:** crea il brano con `unverified=1`, `lyrics_source='manual'`, senza passare da Groq/Genius; eliminarlo dalla lista riporta il progetto a "pronto" (`deleteSong`); `songOut` espone `studio_project_id` (frontend: badge "Inedito" e link "Materiale delle prove").

**Sovraincisione:** il contenuto registrato sopra una base salva `base_take_id` e il modello di allineamento `b(t) = t − sync_ms − offset_ms + base_start_ms` (con ripiego nel loop `base_loop_*`), in `frontend/src/lib/sync.js` (unica fonte, testata). `offset_ms` è la latenza e si regola nel player (±2000 ms).

Frontend: pagine `Studio`, `StudioProject`, `StudioProjectEdit`, `StudioTake`, `StudioRecord` (route `/studio…`); `components/studio/` (`LoopPlayer`, `Timeline` su canvas, `usePlayback`, `MarkerList`, `StudioComments`, `TakeUpload`, `PromoteDialog`, `ui.jsx`); `lib/` pure e testate con `node --test`: `loop.js` (loop, zoom), `refs.js` (citazioni nei commenti), `peaks.js`, `sync.js`, `countin.js`, `recorder.js`, `probe.js`; `lib/engines.js` ha i due motori (Web Audio per l'audio ≤ 60 MB con loop senza stacchi, elemento media per video e file grandi). Registrazione con `MediaRecorder`: mp4 dove supportato, webm di ripiego; si ferma da sola al 95% del limite di upload. Il service worker lascia fuori gli stream `…/file` (regex in `vite.config.js`: il Range di Safari non passa bene dal SW).

**Metronomo, BPM, testo, spostamento** (schema v7, `PRAGMA user_version=7`; spec `.kiro/specs/studio-extras/`): `studio_project.lyrics` (stesso formato ChordPro delle cover, nessuna ricerca online), tabelle `studio_project_comment` (con `parent_id`) e `studio_project_video` (stesse colonne di `comment`/`song_video`, separate perché lì `song_id` è `NOT NULL`). Il testo del progetto si copia nel brano alla promozione. `Routes::cleanLyrics`, `ocrUpload`, `videoCreateFields`, `videoEditFields`, `videoThumb` sono pubblici e condivisi con `Studio.php`. **`Studio::moveSong`** (`POST /songs/{id}/to-studio`, solo `proposed_by_id` o admin) in una transazione `BEGIN IMMEDIATE`: crea il progetto in stato `idea` (creatore = chi aveva proposto il brano) oppure, se il brano era stato promosso, riporta in `idea` il progetto originale (`song_id=NULL`; il testo del brano sostituisce quello del progetto se non è vuoto); copia commenti (con mappa dei `parent_id`, autore e date), link video e testo; gli audio diventano `studio_take` audio con `rename` del file da `data/audio/` a `data/studio/` (descrizione «Registrato il gg/mm/aaaa» + nota; forma d'onda calcolata dal client alla prima apertura); elimina il brano con like e copertina. Se qualcosa fallisce i file tornano indietro e la transazione si annulla. Frontend: `lib/metronome.js` (`clampBpm`, `beatTimesInWindow`, `tapTempo`, `createMetronome` con scheduler a lookahead di 25 ms; `scheduleClick` sta in `countin.js`), `components/studio/BpmControl.jsx` (−/+ con ripetizione, campo, slider 40–300, Tap; usato in `StudioRecord` e `StudioProjectEdit`). In `StudioRecord` il pannello **Tempo** vale anche senza base: conteggio, metronomo continuo in fase con il conteggio, battiti per battuta (2–7), volume; preferenze in `localStorage` `studio_record_tempo`; il click esce solo dalle cuffie (non entra nel file); nella registrazione semplice il taglio iniziale proposto è la fine del conteggio; un cambio di BPM si salva nel progetto (creatore/admin, debounce 800 ms). **Avvio rapido del player:** per un audio `usePlayback` apre prima un `<audio>` con `preload=metadata` (pronto in meno di un secondo), poi avvia il download+decodifica per il motore Web Audio; quando il buffer è pronto passa ai motori preciso (loop senza stacchi) senza interrompere l'ascolto (se sta suonando aspetta la pausa). Se i metadati non arrivano entro 8 s si aspetta il download completo come prima; la forma d'onda mancante si salva con `PUT /studio/takes/{tid}/analysis`. Le preferenze del tempo in registrazione stanno in `localStorage` `studio_record_tempo`, distinte da quelle del conteggio del player (`studio_countin`). `LyricsEdit`, `Teleprompter` (`storageId`), `CommentSection` e `VideoSection` (`basePath`) servono sia le cover sia i progetti (route `/studio/:pid/lyrics`). Azione «Sposta in Prove» in `SongDetail`. Test: `tests/api/test_studio_extras.py`, `tests/frontend/metronome.test.mjs`.

Spec: `.kiro/specs/rehearsal-studio/`. Test: `tests/api/test_studio.py`, `node --test tests/frontend/studio.test.mjs tests/frontend/engines.test.mjs`, end-to-end in browser reale `tests/e2e/studio.e2e.mjs` (upload, loop, marker, commenti, registrazione audio/video, sovraincisione). Nota: in `deploy/local` (Docker) il volume del DB nasconde `data/.htaccess`, quindi due test di `test_api.py::TestSecurity` falliscono solo lì (su Aruba lo copia il deploy).

#### Testo a scorrimento, accordi sul testo, OCR (solo PHP/Aruba)

Schema v4 (`PRAGMA user_version=4`): `song.lyrics_source` (`NULL` = automatico da lyrics.ovh, `manual` = scritto a mano o da OCR). Gli accordi manuali stanno **dentro `song.lyrics`** in formato ChordPro in linea (`[Am]Quando sei [G]qui`, sezioni su riga propria `[Ritornello]`), sempre in notazione anglosassone; si vedono a prescindere da `chords_enabled`, che governa solo `chords_text` (AI) e la tablatura. `Enrich::run` non tocca un testo `manual` e non cancella un testo esistente se lyrics.ovh non risponde. OCR: `Groq::ocrLyrics` con modello di visione `Groq::VISION_MODEL` (`qwen/qwen3.8-27b`), sostituibile da Admin con l'impostazione `groq_vision_model`; l'immagine non viene conservata, rate limit `ocr`. `GET /config` espone `ocr_available`. Frontend: `lib/chordpro.js` (unica fonte del formato: parse, `setChord`, conversione dall'italiano, `fromChordSheet` per accordi scritti sulla riga sopra), `components/LyricsView.jsx` (accordi sopra le parole), `components/Teleprompter.jsx` (tutto schermo, velocità in righe/min per brano e caratteri in `localStorage`), `components/ChordPicker.jsx`, `pages/LyricsEdit.jsx` (route `/songs/:id/lyrics`). Spec: `.kiro/specs/lyrics-teleprompter/`. Test: `tests/api/test_lyrics.py`, `node --test tests/frontend/chordpro.test.mjs`.

#### UX mobile, swipe, guida e nome del gruppo (solo frontend; spec `.kiro/specs/mobile-ux/`)

Pensata per schermi da 360 px (nessuno scorrimento orizzontale: lo verifica l'e2e). **Componenti** in `components/ui/`: `Tabs` (schede con conteggio e indicatore che segue il dito), `Segmented`, `Collapsible` (stato in `localStorage`, riepilogo a pannello chiuso), `Menu` (⋮: bottom sheet sotto 640 px), `ActionBar` (barra fissa in basso con safe area), `Fab`, `AppHeader`, `SwipeTabs`; `components/studio/StatusStepper`. **Layout:** Prove = 3 segmenti (In corso/Promossi/Archivio) con una sola chiamata `GET /studio/projects?status=<tutti>` e sezioni per stato (`lib/studioGroups.js`); brano di prova a schede Contenuti/Testo/Video/Commenti (scheda ricordata in `sessionStorage`, conteggi da `onCount` di `VideoSection`/`CommentSection`); player a livelli (loop A‑B in una riga + «Marker qui», pannelli «Regola loop» e «Ascolto»); registrazione con `ActionBar` (Registra/Ferma sempre visibili) e pannelli Tempo/Info richiudibili; `StudioTake` e `StudioRecord` senza `BottomNav`; la versione sta in Profilo e nella guida. **Swipe:** `SwipeTabs` + `lib/swipe.js` (logica pura testata: dito a sinistra = sezione successiva, asse bloccato dopo 10 px, soglia 60 px o gesto rapido, zona morta di 20 px ai bordi, nessun giro circolare; ignora input/canvas/`[data-no-swipe]`/aree con scorrimento orizzontale); l'indicatore si muove con la variabile CSS `--swipe-progress` su `<html>` (niente re-render). Usato in Repertorio, Prove e brano di prova. **Nome del gruppo:** `context/ConfigContext.jsx` legge `GET /config` dopo il login (`bandName`, `refreshConfig`; Admin lo richiama dopo aver salvato `band_name`), `AppHeader` lo mostra sopra il titolo e imposta `document.title`; l'ultimo nome noto sta in `localStorage` `band_name_cache` e serve alla pagina di login (il server non lo espone senza accesso). **Guida «Primi passi»:** `lib/onboarding.js` (12 passi in due gruppi Repertorio/Sala prove, stato puro: `markDone`, `progress`, `resolveTarget`, `load`/`serialize`), `context/OnboardingContext.jsx` (stato per utente in `localStorage` `band_onboarding_<id>`, ultimo sid/pid/tid in `band_onboarding_ctx_<id>`, nessun dato sul server), `components/onboarding/` (`WelcomeCard`, `GuidePanel`, `HelpButton` con pallino, `Spotlight` che evidenzia `[data-tour="…"]`). I passi si spuntano da soli con `trackStep(id)` (evento `band:onboarding`) lanciato dopo l'azione riuscita; saltare o completare toglie il pallino, «Ricomincia» azzera. Test: `tests/frontend/{swipe,studioGroups,onboarding}.test.mjs`; l'e2e emula 360×780 con touch (swipe, guida, nome del gruppo, nessuno scorrimento orizzontale).

#### Temi e aspetto (spec `.kiro/specs/themes/`)

Ogni utente sceglie un tema (Profilo → Aspetto) e lo personalizza; vale per tutta l'app. **Meccanismo:** in `tailwind.config.js` le palette `gray`, `brand` (`purple` = alias di `brand`), `red`, `green`, `amber`, `yellow`, `blue`, `sky` sono variabili CSS `rgb(var(--<famiglia>-<gradino>) / <alpha-value>)`; `white` = `--ink` (testo più forte: bianco nei temi scuri, quasi nero nei chiari), `black` = `--scrim` (sempre nero), `on-accent` (testo sui pulsanti `bg-brand-*`), `on-solid`/`on-scrim` (sempre bianco: pieni di stato, sopra immagini/video, QR); `borderRadius` e `fontFamily.sans` sono variabili. Le classi esistenti non cambiano. **Motore:** `lib/theme.js` (puro, unica fonte; OKLCH) genera le variabili dalla config `{ v, preset, accent, tint{hue,amount}, contrast, font, scale, radius }`; i gradini hanno luminosità per **ruolo** (50–200 testo forte, 300–500 testo secondario, 600–700 pulsanti/bordi, 800–950 superfici/sfondo), così nei temi chiari `gray-950` è lo sfondo chiaro e `text-red-400` un rosso scuro. `contrastFailures` + correzione dell'accento (`resolveAccent`: testo bianco, oppure accento scurito, oppure testo scuro per accenti chiari) garantiscono AA. Preset in `lib/themePresets.js`: `sala` (predefinito = palette Tailwind letterale, pixel identici a prima), `palco`, `valvole`, `mezzanotte`, `spartito` e `giorno` (chiari), `auto` (`sala`/`giorno` secondo `prefers-color-scheme`). I valori di partenza in `index.css` (`:root`) devono coincidere con `buildVars(DEFAULT_THEME)` (lo verifica il test). **Runtime:** `lib/themeRuntime.js` (`applyTheme`: `setProperty` su `<html>` — non `cssText`, lì vive anche `--swipe-progress` —, `data-mode`/`data-theme`, `color-scheme`, `meta theme-color`, evento `band:theme`, caratteri `@fontsource` caricati a richiesta e in precache `woff2`); cache del dispositivo `band_theme` (config) e `band_theme_css` (variabili serializzate, con entrambe le varianti per `auto`) letta dallo **script inline in `index.html`** prima del bundle (niente lampi, anche al login). `context/ThemeContext.jsx`: anteprima immediata, salvataggio con debounce 800 ms su `PUT /auth/theme` (`saveState`, `retry`, salvataggio forzato su `visibilitychange`), rilettura di `/auth/me` all'avvio; utente senza tema sul server → `sala` (non il tema rimasto da un altro utente). Il canvas della `Timeline` legge le variabili e ridisegna su `band:theme`; `userColor` usa `--user-l`. Il manifest PWA resta statico. Backend: schema v8 (`user.theme` JSON), `php-api/src/Theme.php`, `userOut` espone `theme`. **Regola per il nuovo codice:** niente esadecimali né `text-white` su pulsanti pieni: palette + `text-on-accent` (accento) / `text-on-solid` (stati). Test: `tests/frontend/theme.test.mjs`, `tests/api/test_theme.py`, `tests/e2e/theme.e2e.mjs`.

#### Condivisione con link diretti (solo frontend; spec `.kiro/specs/share-links/`)

Ogni contenuto ha un'azione «Condividi» (icona `Share2`): pannello nativo (`navigator.share`) → appunti con toast «Link copiato» → dialog con il link da copiare a mano. I link valgono solo per i membri (nessun accesso pubblico, nessuna modifica al backend). **Formato** (URL assoluto da `location.origin + BASE_URL`): `/?cat=<categoria>`, `/studio?seg=inCorso|promossi|archivio`, `/songs/:id[?focus=lyrics|media|comments|audio-<id>|video-<id>|comment-<id>]`, `/studio/:pid[?tab=contenuti|testo|video|commenti | ?focus=take-<id>|video-<id>|comment-<id>]`, `/studio/:pid/takes/:tid[?t=<ms> | ?a=<ms>&b=<ms> | ?focus=marker-<id>|comment-<id>]`. **Moduli:** `lib/share.js` (puro e testato: `buildSharePath`, `shareUrl`, `parseFocus`, `parseTime`, `parseLoop`, `pickKey`, `safeNext`, `shareText`), `lib/useShare.js`, `lib/useDeepLink.js` (`useDeepLink` legge i parametri una volta al montaggio; `consume()` toglie `focus/t/a/b` con `replace`; `useViewParam` toglie `cat/seg/tab` dopo l'apertura, perché da lì vale la scelta in `sessionStorage`; `useFocusTarget` scorre fino a `[data-share-id="<kind>-<id>"]`, aggiunge la classe `share-flash` per 2 s, oppure mostra «Elemento non più disponibile»), `context/ToastContext.jsx` (`showToast`, `showLink`), `components/ShareButton.jsx` (`ShareButton` icona, `ShareAction` voce testuale). Nuovi elementi condivisibili: aggiungere `data-share-id` e attendere che i dati siano caricati prima di `useFocusTarget` (`onCount` di `VideoSection`/`CommentSection`, `onLoaded` di `SongMedia`). **Player:** `LoopPlayer` accetta `initial={ time | loop }` (applicato quando il motore è pronto, limitato alla durata; un istante fuori dal taglio dell'autore disattiva il loop), espone `getLoop()` e `onLoopChange`; attributi `data-status`, `data-loop`, `data-testid=player-time` per i test. **Login con ritorno:** `ProtectedRoute` e l'interceptor 401 mandano a `/login?next=<percorso>`; `Login` accetta solo `safeNext` (percorso interno, niente `//`, schemi o `/login`). Test: `node --test tests/frontend/share.test.mjs`, `ADMIN_PASSWORD=... E2E_SITE=http://localhost:8080/band node tests/e2e/share.e2e.mjs`.

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
| `/` | `Songs.jsx` (schede con swipe) | all |
| `/songs/:id` | `SongDetail.jsx` | all |
| `/add` | `AddEditSong.jsx` | all |
| `/songs/:id/edit` | `AddEditSong.jsx` | all |
| `/songs/:id/lyrics` | `LyricsEdit.jsx` | all |
| `/studio` | `Studio.jsx` | all |
| `/studio/new`, `/studio/:pid/edit` | `StudioProjectEdit.jsx` | all (modifica: creatore o admin) |
| `/studio/:pid` | `StudioProject.jsx` | all |
| `/studio/:pid/lyrics` | `LyricsEdit.jsx` | all (testo del brano di prova) |
| `/studio/:pid/takes/:tid` | `StudioTake.jsx` | all |
| `/studio/:pid/record` (`?over=<tid>`) | `StudioRecord.jsx` | all |
| `/admin` | `Admin.jsx` | admin only |
| `/profile` | `Profile.jsx` | all |
| `/profile/appearance` | `Appearance.jsx` (temi) | all |

#### PWA

Configured via `vite-plugin-pwa` in `vite.config.js` with `registerType: 'autoUpdate'`. Icons in `public/`: `icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`, `apple-touch-icon.png`. Manifest has `scope: "/band/"` and `id: "/band/"` to avoid conflict with the Strava PWA on the same domain (scope `/`). If Strava PWA is installed first, the user must uninstall and reinstall it for Chrome to recognize Band Manager as a separate app.
