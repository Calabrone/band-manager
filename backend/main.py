import logging
from contextlib import asynccontextmanager
from datetime import datetime
from urllib.parse import quote
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
from database import AppSetting, Comment, Song, SongLike, User, get_session, init_db, seed_admin, engine
from modules.validation import validate_song
from modules.lyrics import fetch_lyrics_and_cover
from modules.chords import fetch_chords_url
from modules.chords_text import fetch_chords_text


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


def comment_to_dict(comment: Comment, session: Session) -> dict:
    author = session.get(User, comment.user_id)
    return {
        "id": comment.id,
        "song_id": comment.song_id,
        "user_id": comment.user_id,
        "username": author.username if author else "",
        "content": comment.content,
        "parent_id": comment.parent_id,
        "created_at": comment.created_at.isoformat(),
        "updated_at": comment.updated_at.isoformat(),
    }


# ── Background enrichment ─────────────────────────────────────────────────────

def enrich_song_bg(song_id: int):
    logger.info("Enrichment avviato per song_id=%d", song_id)
    with Session(engine) as session:
        song = session.get(Song, song_id)
        if not song:
            return

        groq_key = get_setting(session, "groq_api_key")
        genius_key = get_setting(session, "genius_api_key")

        logger.info("Validazione Groq: %s - %s", song.artist, song.title)
        result = validate_song(song.artist, song.title, groq_key)
        if not result["valid"]:
            logger.warning("Groq: brano non valido: %s", result["message"])
            song.validation_error = result["message"]
            song.validated = False
            session.add(song)
            session.commit()
            return

        song.artist = result["artist_normalized"]
        song.title = result["title_normalized"]
        logger.info("Groq OK: %s - %s", song.artist, song.title)

        logger.info("Fetching lyrics/cover da Genius...")
        lyrics_data = fetch_lyrics_and_cover(song.artist, song.title, genius_key)
        song.lyrics = lyrics_data.get("lyrics")
        song.cover_url = lyrics_data.get("cover_url")
        logger.info("Genius: lyrics=%s cover=%s", bool(song.lyrics), bool(song.cover_url))

        chords_enabled = get_setting(session, "chords_enabled") == "true"
        if chords_enabled:
            logger.info("Fetching chords text via Groq...")
            song.chords_text = fetch_chords_text(song.artist, song.title, groq_key)
            logger.info("Chords text: %s", bool(song.chords_text))
            song.chords_url = fetch_chords_url(song.artist, song.title)

        song.youtube_url = f"https://music.youtube.com/search?q={quote(song.artist + ' ' + song.title)}"

        song.validated = True
        song.validation_error = None
        song.updated_at = datetime.utcnow()
        session.add(song)
        session.commit()


# ── Public config ─────────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return {"chords_enabled": get_setting(session, "chords_enabled") == "true"}


# ── Auth endpoints ────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def login(body: LoginRequest, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.username == body.username)).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenziali errate")
    token = create_access_token({"sub": str(user.id)})
    return {"token": token, "user": {"id": user.id, "username": user.username, "role": user.role}}


@app.get("/api/auth/me")
def me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "username": current_user.username, "role": current_user.role}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@app.put("/api/auth/password")
def change_password(
    body: ChangePasswordRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Password attuale errata")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="La nuova password deve essere di almeno 6 caratteri")
    user = session.get(User, current_user.id)
    user.password_hash = hash_password(body.new_password)
    session.add(user)
    session.commit()
    return {"ok": True}


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


# ── Comments endpoints ────────────────────────────────────────────────────────

class CreateCommentRequest(BaseModel):
    content: str
    parent_id: Optional[int] = None


class UpdateCommentRequest(BaseModel):
    content: str


@app.get("/api/songs/{song_id}/comments")
def list_comments(
    song_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if not session.get(Song, song_id):
        raise HTTPException(status_code=404, detail="Brano non trovato")
    comments = session.exec(
        select(Comment).where(Comment.song_id == song_id).order_by(Comment.created_at)
    ).all()
    return [comment_to_dict(c, session) for c in comments]


@app.post("/api/songs/{song_id}/comments", status_code=201)
def create_comment(
    song_id: int,
    body: CreateCommentRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Il commento non può essere vuoto")
    if not session.get(Song, song_id):
        raise HTTPException(status_code=404, detail="Brano non trovato")
    if body.parent_id is not None:
        parent = session.get(Comment, body.parent_id)
        if not parent or parent.song_id != song_id:
            raise HTTPException(status_code=400, detail="Commento padre non valido")
        if parent.parent_id is not None:
            raise HTTPException(status_code=400, detail="Nidificazione massima raggiunta")
    comment = Comment(
        song_id=song_id,
        user_id=current_user.id,
        content=content,
        parent_id=body.parent_id,
    )
    session.add(comment)
    session.commit()
    session.refresh(comment)
    return comment_to_dict(comment, session)


@app.put("/api/songs/{song_id}/comments/{comment_id}")
def update_comment(
    song_id: int,
    comment_id: int,
    body: UpdateCommentRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    comment = session.get(Comment, comment_id)
    if not comment or comment.song_id != song_id:
        raise HTTPException(status_code=404, detail="Commento non trovato")
    if comment.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Non puoi modificare questo commento")
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Il commento non può essere vuoto")
    comment.content = content
    comment.updated_at = datetime.utcnow()
    session.add(comment)
    session.commit()
    session.refresh(comment)
    return comment_to_dict(comment, session)


@app.delete("/api/songs/{song_id}/comments/{comment_id}", status_code=204)
def delete_comment(
    song_id: int,
    comment_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    comment = session.get(Comment, comment_id)
    if not comment or comment.song_id != song_id:
        raise HTTPException(status_code=404, detail="Commento non trovato")
    if comment.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Non puoi eliminare questo commento")
    if comment.parent_id is None:
        for reply in session.exec(select(Comment).where(Comment.parent_id == comment_id)).all():
            session.delete(reply)
    session.delete(comment)
    session.commit()


# ── Likes endpoints ───────────────────────────────────────────────────────────

@app.get("/api/songs/{song_id}/likes")
def get_likes(
    song_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if not session.get(Song, song_id):
        raise HTTPException(status_code=404, detail="Brano non trovato")
    all_likes = session.exec(select(SongLike).where(SongLike.song_id == song_id)).all()
    return {"count": len(all_likes), "liked": any(l.user_id == current_user.id for l in all_likes)}


@app.post("/api/songs/{song_id}/likes")
def toggle_like(
    song_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if not session.get(Song, song_id):
        raise HTTPException(status_code=404, detail="Brano non trovato")
    existing = session.exec(
        select(SongLike).where(SongLike.song_id == song_id, SongLike.user_id == current_user.id)
    ).first()
    if existing:
        session.delete(existing)
        session.commit()
    else:
        session.add(SongLike(song_id=song_id, user_id=current_user.id))
        session.commit()
    all_likes = session.exec(select(SongLike).where(SongLike.song_id == song_id)).all()
    return {"count": len(all_likes), "liked": not bool(existing)}


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


class AdminResetPasswordRequest(BaseModel):
    new_password: str


@app.put("/api/admin/users/{user_id}/password")
def admin_reset_password(
    user_id: int,
    body: AdminResetPasswordRequest,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="La password deve essere di almeno 6 caratteri")
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    user.password_hash = hash_password(body.new_password)
    session.add(user)
    session.commit()
    return {"ok": True}


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
