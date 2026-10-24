"""Test di inviti, registrazione, recupero password, profilo e nuove regole sui brani."""
import re
import uuid
from datetime import datetime, timedelta

import httpx
import pytest

from conftest import API, Api, login, register_user, token_of


def new_invite(admin, role="member"):
    r = admin.post("/admin/invites", json={"role": role})
    assert r.status_code == 201, r.text
    return r.json()


def register(token, username=None, email=None, password="pw-123456"):
    username = username or f"t_reg_{uuid.uuid4().hex[:8]}"
    email = email or f"{username}@example.com"
    return httpx.post(
        f"{API}/auth/register",
        json={"token": token, "username": username, "email": email, "password": password},
        timeout=60,
    )


def utc_in(iso):
    return datetime.fromisoformat(iso) - datetime.utcnow()


# ── Inviti ──────────────────────────────────────────────────────────────────

class TestInvites:
    def test_create_shape_and_expiry(self, admin):
        inv = new_invite(admin)
        assert re.fullmatch(r"[0-9a-f]{64}", inv["token"])
        assert inv["url"].endswith(f"/invite/{inv['token']}")
        assert inv["role"] == "member"
        left = utc_in(inv["expires_at"])
        assert timedelta(days=6, hours=23) < left <= timedelta(days=7, minutes=1)
        admin.delete(f"/admin/invites/{inv['id']}")

    def test_invalid_role_400(self, admin):
        assert admin.post("/admin/invites", json={"role": "boss"}).status_code == 400

    def test_check_valid_and_unknown(self, admin, anon):
        inv = new_invite(admin, "admin")
        r = anon.get(f"/auth/invite/{inv['token']}")
        assert r.status_code == 200 and r.json()["valid"] is True and r.json()["role"] == "admin"
        assert anon.get(f"/auth/invite/{'0' * 64}").json() == {"valid": False}
        admin.delete(f"/admin/invites/{inv['id']}")

    def test_token_not_stored_or_listed(self, admin):
        inv = new_invite(admin)
        listed = admin.get("/admin/invites")
        assert inv["token"] not in listed.text
        assert any(i["id"] == inv["id"] for i in listed.json())
        assert all(set(i) == {"id", "role", "created_at", "expires_at"} for i in listed.json())
        admin.delete(f"/admin/invites/{inv['id']}")

    def test_register_creates_user_with_invite_role(self, admin, made):
        inv = new_invite(admin, "admin")
        r = register(inv["token"])
        assert r.status_code == 201, r.text
        made["users"].append(r.json()["user"]["id"])
        assert r.json()["user"]["role"] == "admin"
        api = Api(r.json()["token"], r.json()["user"])
        assert api.get("/auth/me").status_code == 200

    def test_invite_is_single_use(self, admin, made):
        inv = new_invite(admin)
        first = register(inv["token"])
        assert first.status_code == 201
        made["users"].append(first.json()["user"]["id"])
        second = register(inv["token"])
        assert second.status_code == 400 and second.json() == {"detail": "Invito non valido o scaduto"}
        assert httpx.get(f"{API}/auth/invite/{inv['token']}", timeout=60).json() == {"valid": False}
        assert all(i["id"] != inv["id"] for i in admin.get("/admin/invites").json())

    def test_revoked_invite_unusable(self, admin):
        inv = new_invite(admin)
        assert admin.delete(f"/admin/invites/{inv['id']}").status_code == 204
        assert register(inv["token"]).status_code == 400
        assert admin.delete(f"/admin/invites/{inv['id']}").status_code == 404

    def test_register_without_valid_token(self):
        assert register("0" * 64).status_code == 400
        assert register("non-esadecimale").status_code == 400

    def test_register_rules(self, admin, member, made):
        inv = new_invite(admin)
        t = inv["token"]
        assert register(t, username="ab").status_code == 400                       # troppo corto
        assert register(t, username="spazio non ammesso").status_code == 400
        assert register(t, username="x" * 31).status_code == 400
        assert register(t, email="non-una-email").status_code == 400
        assert register(t, password="abc").status_code == 400
        dup = register(t, username=member.user["username"].upper())              # maiuscole diverse
        assert dup.status_code == 400 and dup.json() == {"detail": "Username già esistente"}
        dup_mail = register(t, email=member.email.upper())
        assert dup_mail.status_code == 400 and dup_mail.json() == {"detail": "Email già in uso"}
        # nessun tentativo fallito ha consumato l'invito
        ok = register(t)
        assert ok.status_code == 201
        made["users"].append(ok.json()["user"]["id"])

    def test_member_cannot_manage_invites(self, member, anon):
        assert anon.post("/admin/invites", json={}).status_code == 401
        assert member.post("/admin/invites", json={}).status_code == 403
        assert member.delete("/admin/invites/1").status_code == 403


# ── Login e profilo ─────────────────────────────────────────────────────────

class TestProfile:
    def test_login_case_insensitive(self, member):
        api = login(member.user["username"].upper(), member.password)
        assert api.user["id"] == member.user["id"]

    def test_update_username_and_email(self, member, song):
        new = f"t_ren_{uuid.uuid4().hex[:8]}"
        r = member.put("/auth/profile", json={"username": new, "email": "Nuova@Example.com"})
        assert r.status_code == 200
        assert r.json()["username"] == new and r.json()["email"] == "Nuova@Example.com"
        login(new, member.password)
        # i nomi mostrati seguono il rinomina (legati per id)
        assert member.get(f"/songs/{song['id']}").json()["proposed_by_username"] == new

    def test_update_username_rules(self, member, member2):
        for bad in ("ab", "con spazi", "x" * 31, "è@"):
            assert member.put("/auth/profile", json={"username": bad}).status_code == 400, bad
        r = member.put("/auth/profile", json={"username": member2.user["username"].upper()})
        assert r.status_code == 400 and r.json() == {"detail": "Username già esistente"}
        # il proprio username (anche con altre maiuscole) e' consentito
        assert member.put("/auth/profile", json={"username": member.user["username"].upper()}).status_code == 200

    def test_update_email_rules(self, member, member2):
        assert member.put("/auth/profile", json={"email": "boh"}).status_code == 400
        r = member.put("/auth/profile", json={"email": member2.email})
        assert r.status_code == 400 and r.json() == {"detail": "Email già in uso"}
        cleared = member.put("/auth/profile", json={"email": ""})
        assert cleared.status_code == 200 and cleared.json()["email"] is None

    def test_old_token_invalid_after_password_change(self, member):
        old = member.token
        r = member.put("/auth/password", json={"current_password": member.password, "new_password": "altra-pw-1"})
        assert r.status_code == 200
        assert Api(old, member.user).get("/auth/me").status_code == 401
        assert Api(r.json()["token"], r.json()["user"]).get("/auth/me").status_code == 200

    def test_default_admin_password_rejected(self, member):
        r = member.put("/auth/password", json={"current_password": member.password, "new_password": "admin123"})
        assert r.status_code == 400

    def test_admin_does_not_need_password_change(self, admin):
        assert admin.user["must_change_password"] is False


# ── Recupero password ───────────────────────────────────────────────────────

class TestPasswordReset:
    def test_forgot_same_answer_for_unknown_email(self, member, anon):
        known = anon.post("/auth/forgot", json={"email": member.email})
        unknown = anon.post("/auth/forgot", json={"email": f"nessuno-{uuid.uuid4().hex}@example.com"})
        assert known.status_code == unknown.status_code == 200
        assert known.json() == unknown.json() == {"ok": True}

    def test_admin_reset_link_flow(self, admin, member, anon):
        r = admin.post(f"/admin/users/{member.user['id']}/reset-link")
        assert r.status_code == 201
        url = r.json()["url"]
        assert "/reset/" in url
        left = utc_in(r.json()["expires_at"])
        assert timedelta(minutes=58) < left <= timedelta(hours=1, minutes=1)
        token = token_of(url)
        assert anon.get(f"/auth/reset/{token}").json() == {"valid": True}

        assert anon.post("/auth/reset", json={"token": token, "new_password": "abc"}).status_code == 400
        ok = anon.post("/auth/reset", json={"token": token, "new_password": "dopo-reset-1"})
        assert ok.status_code == 200 and ok.json() == {"ok": True}

        login(member.user["username"], "dopo-reset-1")
        bad = anon.post("/auth/login", json={"username": member.user["username"], "password": member.password})
        assert bad.status_code == 401
        # JWT precedente invalidato
        assert member.get("/auth/me").status_code == 401
        # monouso
        assert anon.get(f"/auth/reset/{token}").json() == {"valid": False}
        again = anon.post("/auth/reset", json={"token": token, "new_password": "ancora-1234"})
        assert again.status_code == 400 and again.json() == {"detail": "Link non valido o scaduto"}

    def test_new_link_replaces_old_on_use(self, admin, member, anon):
        t1 = token_of(admin.post(f"/admin/users/{member.user['id']}/reset-link").json()["url"])
        t2 = token_of(admin.post(f"/admin/users/{member.user['id']}/reset-link").json()["url"])
        assert anon.post("/auth/reset", json={"token": t2, "new_password": "primo-reset"}).status_code == 200
        assert anon.get(f"/auth/reset/{t1}").json() == {"valid": False}

    def test_unknown_reset_token(self, anon):
        assert anon.get(f"/auth/reset/{'f' * 64}").json() == {"valid": False}
        assert anon.post("/auth/reset", json={"token": "f" * 64, "new_password": "abcdef"}).status_code == 400

    def test_reset_link_admin_only(self, member, anon):
        assert anon.post(f"/admin/users/{member.user['id']}/reset-link").status_code == 401
        assert member.post(f"/admin/users/{member.user['id']}/reset-link").status_code == 403

    def test_reset_link_unknown_user(self, admin):
        assert admin.post("/admin/users/99999999/reset-link").status_code == 404


# ── Ultimo admin ────────────────────────────────────────────────────────────

class TestLastAdmin:
    def test_second_admin_can_be_deleted_but_not_self(self, admin, made):
        other = register_user(admin, made, role="admin")
        assert admin.delete(f"/admin/users/{other.user['id']}").status_code == 204
        assert admin.delete(f"/admin/users/{admin.user['id']}").status_code == 400


# ── Brani: validazione, sezione, spostamenti ────────────────────────────────

class TestSongSections:
    def test_validate_does_not_write(self, member):
        before = len(member.get("/songs").json())
        r = member.post("/songs/validate", json={"artist": "Zzxx Qqww", "title": "Nonesiste Yyuu"})
        assert r.status_code == 200
        assert set(r.json()) == {"valid", "artist_normalized", "title_normalized", "message"}
        assert len(member.get("/songs").json()) == before

    def test_validate_requires_fields_and_auth(self, member, anon):
        assert member.post("/songs/validate", json={"artist": "solo"}).status_code == 422
        assert member.post("/songs/validate", json={"artist": " ", "title": "x"}).status_code == 400
        assert anon.post("/songs/validate", json={"artist": "a", "title": "b"}).status_code == 401

    @pytest.mark.parametrize("cat", ["proposta", "da_provare", "in_scaletta"])
    def test_create_in_chosen_category(self, member, made, cat):
        r = member.post("/songs", json={"artist": "A", "title": "B", "category": cat})
        assert r.status_code == 201
        made["songs"].append(r.json()["id"])
        assert r.json()["category"] == cat and r.json()["validation_error"] is None

    def test_create_default_and_invalid_category(self, member, made):
        r = member.post("/songs", json={"artist": "A", "title": "B"})
        made["songs"].append(r.json()["id"])
        assert r.json()["category"] == "proposta"
        assert member.post("/songs", json={"artist": "A", "title": "B", "category": "boh"}).status_code == 400

    def test_force_insert_keeps_message(self, member, made):
        r = member.post("/songs", json={
            "artist": "A", "title": "B", "category": "da_provare", "force": True, "message": "Brano non trovato",
        })
        assert r.status_code == 201
        made["songs"].append(r.json()["id"])
        d = r.json()
        assert d["validated"] is False and d["validation_error"] == "Brano non trovato"
        assert d["category"] == "da_provare"

    def test_force_without_message_has_default_error(self, member, made):
        r = member.post("/songs", json={"artist": "A", "title": "B", "force": True})
        made["songs"].append(r.json()["id"])
        assert r.json()["validation_error"]

    def test_move_to_any_section_both_directions(self, song, member):
        for cat in ("in_scaletta", "proposta", "da_provare", "proposta", "in_scaletta", "da_provare"):
            r = member.put(f"/songs/{song['id']}/category", json={"category": cat})
            assert r.status_code == 200 and r.json()["category"] == cat
