from datetime import datetime
from typing import Optional
from sqlalchemy import text
from sqlmodel import Field, SQLModel, create_engine, Session, select

DATABASE_URL = "sqlite:///./band_manager.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str
    role: str = "member"  # "admin" | "member"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Song(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    artist: str
    title: str
    category: str = "proposta"  # "proposta" | "da_provare" | "in_scaletta"
    validated: bool = False
    validation_error: Optional[str] = None
    lyrics: Optional[str] = None
    chords_url: Optional[str] = None
    chords_text: Optional[str] = None
    youtube_url: Optional[str] = None
    cover_url: Optional[str] = None
    proposed_by_id: int = Field(foreign_key="user.id")
    last_modified_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AppSetting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str = ""


class Comment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    song_id: int = Field(foreign_key="song.id", index=True)
    user_id: int = Field(foreign_key="user.id")
    content: str
    parent_id: Optional[int] = Field(default=None, foreign_key="comment.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SongLike(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    song_id: int = Field(foreign_key="song.id", index=True)
    user_id: int = Field(foreign_key="user.id")


def init_db():
    SQLModel.metadata.create_all(engine)
    # Safe migration: add new columns/tables to existing DB without dropping data
    with engine.connect() as conn:
        for ddl in (
            "ALTER TABLE song ADD COLUMN chords_text TEXT",
            "CREATE TABLE IF NOT EXISTS comment (id INTEGER PRIMARY KEY, song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES user(id), content TEXT NOT NULL, parent_id INTEGER REFERENCES comment(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS songlike (id INTEGER PRIMARY KEY, song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES user(id))",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_songlike ON songlike (song_id, user_id)",
        ):
            try:
                conn.execute(text(ddl))
                conn.commit()
            except Exception:
                pass
    # Ensure chords_enabled setting exists (default: disabled)
    with Session(engine) as session:
        if not session.get(AppSetting, "chords_enabled"):
            session.add(AppSetting(key="chords_enabled", value="false"))
            session.commit()


def get_session():
    with Session(engine) as session:
        yield session


def seed_admin(session: Session):
    from auth import hash_password
    existing = session.exec(select(User)).first()
    if existing:
        return
    admin = User(
        username="admin",
        password_hash=hash_password("admin123"),
        role="admin",
    )
    session.add(admin)
    # Seed default empty settings
    for key in ("groq_api_key", "genius_api_key"):
        setting = AppSetting(key=key, value="")
        session.add(setting)
    session.commit()
