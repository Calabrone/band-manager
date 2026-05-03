# Band Manager — Architettura e Deploy

## Stack

| Layer | Tecnologia | Porta/Percorso |
|-------|-----------|----------------|
| Frontend | React 18 + Vite + Tailwind | `/band/` (Nginx porta 82) |
| Backend | Python FastAPI + SQLModel | `127.0.0.1:8001` |
| Database | SQLite | `backend/band_manager.db` |
| Reverse proxy | Nginx | porta 82 |
| Auth | JWT (HS256, 7 giorni) | header `Authorization: Bearer` |

## Struttura progetto

```
band-manager/
├── backend/
│   ├── main.py          # FastAPI app (tutti gli endpoint)
│   ├── database.py      # SQLModel models: User, Song, AppSetting
│   ├── auth.py          # JWT utilities + dipendenze FastAPI
│   ├── requirements.txt
│   ├── .env             # SECRET_KEY (non committare)
│   └── modules/
│       ├── validation.py  # Groq: valida esistenza brano
│       ├── lyrics.py      # LyricsGenius: testi + copertina
│       └── chords.py      # Songsterr: link tab
├── frontend/
│   ├── src/
│   │   ├── pages/       # Login, Songs, SongDetail, AddEditSong, Admin
│   │   ├── components/  # SongCard, CategoryTabs, BottomNav, ConfirmDialog
│   │   ├── context/     # AuthContext (JWT in localStorage)
│   │   └── api/         # axios client con interceptor JWT
│   └── dist/            # build produzione (gitignored)
└── deploy/
    ├── nginx.conf           # porta 82, prefix /band/
    ├── band-backend.service # systemd uvicorn 8001
    └── setup.sh             # setup iniziale RPi
```

## RPi — Info deploy

- **IP:** 192.168.1.20
- **User:** szz
- **SSH key:** `~/.ssh/rpi_strava`
- **Percorso:** `/home/szz/Documents/progetti/band/`
- **Nginx URL:** `https://homeszz.ddns.net/band/`

## Comandi deploy

### Primo setup (una volta sola)

```bash
# Trasferisci progetto
tar -czf - --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='node_modules' --exclude='dist' \
  --exclude='.env' --exclude='*.db' \
  -C band-manager . | \
  ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 \
  "mkdir -p ~/Documents/progetti/band && cd ~/Documents/progetti/band && tar -xzf -"

# Esegui setup
ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 \
  "chmod +x ~/Documents/progetti/band/deploy/setup.sh && \
   ~/Documents/progetti/band/deploy/setup.sh"
```

### Deploy aggiornamenti

```bash
# Trasferisci file aggiornati
tar -czf - --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='node_modules' --exclude='dist' \
  --exclude='.env' --exclude='*.db' \
  -C band-manager . | \
  ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 \
  "cd ~/Documents/progetti/band && tar -xzf -"

# Riavvia backend (se modificato Python)
ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 \
  "sudo systemctl restart band-backend"

# Rebuild frontend (se modificato JS/CSS)
ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 \
  "cd ~/Documents/progetti/band/frontend && npm install && npm run build"
```

### Verifica stato

```bash
ssh -i ~/.ssh/rpi_strava szz@192.168.1.20 \
  "sudo systemctl status band-backend"
```

## Flusso aggiunta brano

1. Utente inserisce artista + titolo
2. Record creato con `validated=false`
3. Background task: Groq valida → LyricsGenius (testi + cover) → Songsterr (link)
4. Frontend fa polling ogni 2s su `GET /api/songs/{id}`
5. Quando `validated=true` → redirect a SongDetail

## API Key

Le API key (Groq e LyricsGenius) **non** vanno nel `.env` — si configurano dalla pagina Admin dell'app (accessibile solo all'utente con ruolo `admin`). Vengono salvate nel DB (`AppSetting`).

Il `.env` contiene solo `SECRET_KEY` per firmare i JWT.

## Credenziali default al primo avvio

- username: `admin`
- password: `admin123`

**Cambiare subito** dalla pagina Admin → Utenti.
