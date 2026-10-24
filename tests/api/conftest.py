"""Test di contratto dell'API Band Manager.

Si eseguono contro un'istanza reale, indicata da variabili d'ambiente:
  API_BASE_URL   es. https://www.motorn.it/band-test/api   (obbligatoria)
  ADMIN_USER     default "admin"
  ADMIN_PASSWORD password dell'admin dell'istanza (default "admin123": su un DB nuovo l'admin
                 deve prima cambiarla, l'API la rifiuta finche' resta quella di default)
I test creano i propri utenti/brani e li eliminano a fine sessione.
"""
import os
import re
import uuid

import httpx
import pytest

API = os.environ.get("API_BASE_URL", "").rstrip("/")
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$")


def pytest_configure(config):
    if not API:
        raise pytest.UsageError("Imposta API_BASE_URL (es. https://www.motorn.it/band-test/api)")


@pytest.fixture(scope="session")
def site_url():
    return API[: -len("/api")] if API.endswith("/api") else API


@pytest.fixture(scope="session")
def anon():
    with httpx.Client(base_url=API, timeout=60) as c:
        yield c


class Api:
    """Client con token; il fallback X-Auth-Token si attiva con via_x_token=True."""

    def __init__(self, token, user, via_x_token=False):
        self.token = token
        self.user = user
        self.client = httpx.Client(base_url=API, timeout=60)
        self.via_x_token = via_x_token

    def _h(self):
        return {"X-Auth-Token": self.token} if self.via_x_token else {"Authorization": f"Bearer {self.token}"}

    def request(self, method, path, **kw):
        return self.client.request(method, path, headers=self._h(), **kw)

    def get(self, p, **kw): return self.request("GET", p, **kw)
    def post(self, p, **kw): return self.request("POST", p, **kw)
    def put(self, p, **kw): return self.request("PUT", p, **kw)
    def delete(self, p, **kw): return self.request("DELETE", p, **kw)


def login(username, password):
    r = httpx.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=60)
    assert r.status_code == 200, f"login {username}: {r.status_code} {r.text}"
    d = r.json()
    return Api(d["token"], d["user"])


def token_of(url):
    """Token in chiaro dall'ultimo segmento dell'URL di un invito o di un reset."""
    return url.rstrip("/").rsplit("/", 1)[-1]


@pytest.fixture(scope="session")
def admin():
    api = login(ADMIN_USER, ADMIN_PASSWORD)
    assert not api.user["must_change_password"], (
        "L'admin usa la password di default: cambiala (Profilo) e passa la nuova in ADMIN_PASSWORD"
    )
    return api


@pytest.fixture(scope="session")
def made(admin):
    """Registro di utenti e brani creati dai test, ripuliti a fine sessione."""
    reg = {"users": [], "songs": []}
    yield reg
    for sid in reg["songs"]:
        admin.delete(f"/songs/{sid}")
    for uid in reg["users"]:
        admin.delete(f"/admin/users/{uid}")


def register_user(admin, made, role="member", email=None):
    """Crea un utente col flusso reale: invito dell'admin + registrazione."""
    inv = admin.post("/admin/invites", json={"role": role})
    assert inv.status_code == 201, inv.text
    name = f"t_{role}_{uuid.uuid4().hex[:8]}"
    pw = "pw-" + uuid.uuid4().hex[:8]
    email = email or f"{name}@example.com"
    r = httpx.post(
        f"{API}/auth/register",
        json={"token": inv.json()["token"], "username": name, "email": email, "password": pw},
        timeout=60,
    )
    assert r.status_code == 201, r.text
    d = r.json()
    made["users"].append(d["user"]["id"])
    api = Api(d["token"], d["user"])
    api.password = pw
    api.email = email
    return api


@pytest.fixture()
def member(admin, made):
    return register_user(admin, made)


@pytest.fixture()
def member2(admin, made):
    return register_user(admin, made)


@pytest.fixture()
def song(member, made):
    r = member.post("/songs", json={"artist": "  Test Artist ", "title": " Test Title  "})
    assert r.status_code == 201, r.text
    made["songs"].append(r.json()["id"])
    return r.json()
