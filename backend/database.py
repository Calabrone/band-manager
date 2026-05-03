from datetime import datetime
from typing import Optional
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
    youtube_url: Optional[str] = None
    cover_url: Optional[str] = None
    proposed_by_id: int = Field(foreign_key="user.id")
    last_modified_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AppSetting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str = ""


def init_db():
    SQLModel.metadata.create_all(engine)


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
