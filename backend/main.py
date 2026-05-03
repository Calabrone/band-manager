from contextlib import asynccontextmanager
from datetime import datetime
from urllib.parse import quote
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import Session, select

from auth import (
    create_access_token,
    get_current_user,
    hash_password,
    require_admin,
    verify_password,
)
from database import AppSetting, Song, User, get_session, init_db, seed_admin, engine
from modules.validation import validate_song
from modules.lyrics import fetch_lyrics_and_cover
from modules.chords import fetch_chords_url


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with Session(engine) as s:
        seed_admin(s)
    yield


app = FastAPI(title="Band Manager", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_setting(session: Session, key: str) -> str:
    s = session.get(AppSetting, key)
    return s.value if s else ""


def song_to_dict(song: Song, session: Session) -> dict:
    proposed = session.get(User, song.proposed_by_id)
    modified = session.get(User, song.last_modified_by_id)
    return {
        **song.model_dump(),
        "proposed_by_username": proposed.username if proposed else "",
        "last_modified_by_username": modified.username if modified else "",
    }


# ── Background enrichment ─────────────────────────────────────────────────────

def enrich_song_bg(song_id: int):
    with Session(engine) as session:
        song = session.get(Song, song_id)
        if not song:
            return

        groq_key = get_setting(session, "groq_api_key")
        genius_key = get_setting(session, "genius_api_key")

        result = validate_song(song.artist, song.title, groq_key)
        if not result["valid"]:
            song.validation_error = result["message"]
            song.validated = False
            session.add(song)
            session.commit()
            return

        song.artist = result["artist_normalized"]
        song.title = result["title_normalized"]

        lyrics_data = fetch_lyrics_and_cover(song.artist, song.title, genius_key)
        song.lyrics = lyrics_data.get("lyrics")
        song.cover_url = lyrics_data.get("cover_url")

        song.chords_url = fetch_chords_url(song.artist, song.title)
        song.youtube_url = f"https://music.youtube.com/search?q={quote(song.artist + ' ' + song.title)}"

        song.validated = True
        song.validation_error = None
        song.updated_at = datetime.utcnow()
        session.add(song)
        session.commit()


# ── Auth endpoints ────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def login(body: LoginRequest, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.username == body.username)).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenziali errate")
    token = create_access_token({"sub": user.id})
    return {"token": token, "user": {"id": user.id, "username": user.username, "role": user.role}}


@app.get("/api/auth/me")
def me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "username": current_user.username, "role": current_user.role}


# ── Songs endpoints ───────────────────────────────────────────────────────────

class CreateSongRequest(BaseModel):
    artist: str
    title: str


class UpdateSongRequest(BaseModel):
    artist: Optional[str] = None
    title: Optional[str] = None
    category: Optional[str] = None


class ChangeCategoryRequest(BaseModel):
    category: str


VALID_CATEGORIES = {"proposta", "da_provare", "in_scaletta"}


@app.get("/api/songs")
def list_songs(
    category: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    query = select(Song)
    if category and category in VALID_CATEGORIES:
        query = query.where(Song.category == category)
    songs = session.exec(query.order_by(Song.updated_at.desc())).all()
    return [song_to_dict(s, session) for s in songs]


@app.post("/api/songs", status_code=201)
def create_song(
    body: CreateSongRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    song = Song(
        artist=body.artist.strip(),
        title=body.title.strip(),
        proposed_by_id=current_user.id,
        last_modified_by_id=current_user.id,
    )
    session.add(song)
    session.commit()
    session.refresh(song)
    background_tasks.add_task(enrich_song_bg, song.id)
    return song_to_dict(song, session)


@app.get("/api/songs/{song_id}")
def get_song(
    song_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    song = session.get(Song, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Brano non trovato")
    return song_to_dict(song, session)


@app.put("/api/songs/{song_id}")
def update_song(
    song_id: int,
    body: UpdateSongRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    song = session.get(Song, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Brano non trovato")
    if body.artist is not None:
        song.artist = body.artist.strip()
    if body.title is not None:
        song.title = body.title.strip()
    if body.category is not None:
        if body.category not in VALID_CATEGORIES:
            raise HTTPException(status_code=400, detail="Categoria non valida")
        song.category = body.category
    song.last_modified_by_id = current_user.id
    song.updated_at = datetime.utcnow()
    session.add(song)
    session.commit()
    session.refresh(song)
    return song_to_dict(song, session)


@app.delete("/api/songs/{song_id}", status_code=204)
def delete_song(
    song_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    song = session.get(Song, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Brano non trovato")
    session.delete(song)
    session.commit()


@app.put("/api/songs/{song_id}/category")
def change_category(
    song_id: int,
    body: ChangeCategoryRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if body.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoria non valida")
    song = session.get(Song, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Brano non trovato")
    song.category = body.category
    song.last_modified_by_id = current_user.id
    song.updated_at = datetime.utcnow()
    session.add(song)
    session.commit()
    session.refresh(song)
    return song_to_dict(song, session)


@app.post("/api/songs/{song_id}/enrich")
def re_enrich(
    song_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    song = session.get(Song, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Brano non trovato")
    song.validated = False
    song.validation_error = None
    session.add(song)
    session.commit()
    background_tasks.add_task(enrich_song_bg, song.id)
    return {"detail": "Enrichment avviato"}


# ── Admin endpoints ───────────────────────────────────────────────────────────

class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "member"


class UpdateSettingRequest(BaseModel):
    key: str
    value: str


def mask_value(value: str) -> str:
    if len(value) <= 4:
        return "*" * len(value)
    return "*" * (len(value) - 4) + value[-4:]


@app.get("/api/admin/users")
def admin_list_users(
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    users = session.exec(select(User)).all()
    return [{"id": u.id, "username": u.username, "role": u.role, "created_at": u.created_at} for u in users]


@app.post("/api/admin/users", status_code=201)
def admin_create_user(
    body: CreateUserRequest,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    if session.exec(select(User).where(User.username == body.username)).first():
        raise HTTPException(status_code=400, detail="Username già esistente")
    if body.role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="Ruolo non valido")
    user = User(username=body.username, password_hash=hash_password(body.password), role=body.role)
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"id": user.id, "username": user.username, "role": user.role}


@app.delete("/api/admin/users/{user_id}", status_code=204)
def admin_delete_user(
    user_id: int,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Non puoi eliminare te stesso")
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    session.delete(user)
    session.commit()


@app.get("/api/admin/settings")
def admin_get_settings(
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    settings = session.exec(select(AppSetting)).all()
    return [{"key": s.key, "value_masked": mask_value(s.value)} for s in settings]


@app.put("/api/admin/settings")
def admin_update_setting(
    body: UpdateSettingRequest,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    setting = session.get(AppSetting, body.key)
    if not setting:
        setting = AppSetting(key=body.key)
        session.add(setting)
    setting.value = body.value.strip()
    session.add(setting)
    session.commit()
    return {"key": setting.key, "value_masked": mask_value(setting.value)}
