import re

import httpx
import pytest

from conftest import API, ISO_RE, Api, login


# ── Auth ────────────────────────────────────────────────────────────────────

class TestAuth:
    def test_login_ok(self, admin):
        assert admin.token
        assert set(admin.user) == {"id", "username", "role"}
        assert admin.user["role"] == "admin"

    def test_login_wrong_password(self, anon):
        r = anon.post("/auth/login", json={"username": "admin", "password": "sbagliata-xyz"})
        assert r.status_code == 401
        assert r.json() == {"detail": "Credenziali errate"}

    def test_login_unknown_user(self, anon):
        r = anon.post("/auth/login", json={"username": "nessuno-xyz", "password": "x"})
        assert r.status_code == 401

    def test_login_missing_field_is_422(self, anon):
        r = anon.post("/auth/login", json={"username": "admin"})
        assert r.status_code == 422
        assert "detail" in r.json()

    def test_me(self, admin):
        r = admin.get("/auth/me")
        assert r.status_code == 200
        assert r.json() == admin.user

    def test_no_token_is_401(self, anon):
        for path in ("/auth/me", "/songs", "/config", "/admin/users"):
            assert anon.get(path).status_code == 401, path

    def test_invalid_token_is_401(self, anon):
        r = anon.get("/auth/me", headers={"Authorization": "Bearer abc.def.ghi"})
        assert r.status_code == 401
        assert r.json() == {"detail": "Token non valido"}

    def test_tampered_token_is_401(self, admin, anon):
        head, payload, sig = admin.token.split(".")
        bad = f"{head}.{payload}.{sig[:-2]}xx"
        assert anon.get("/auth/me", headers={"Authorization": f"Bearer {bad}"}).status_code == 401

    def test_alg_none_token_rejected(self, anon):
        import base64, json
        b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
        token = f"{b({'alg': 'none', 'typ': 'JWT'})}.{b({'sub': '1', 'exp': 9999999999})}."
        assert anon.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401

    def test_x_auth_token_fallback(self, admin):
        fallback = Api(admin.token, admin.user, via_x_token=True)
        r = fallback.get("/auth/me")
        assert r.status_code == 200 and r.json() == admin.user

    def test_config(self, admin):
        r = admin.get("/config")
        assert r.status_code == 200
        assert isinstance(r.json()["chords_enabled"], bool)

    def test_change_password(self, member):
        assert member.put("/auth/password", json={"current_password": "no", "new_password": "abcdef"}).status_code == 400
        r = member.put("/auth/password", json={"current_password": member.password, "new_password": "abc"})
        assert r.status_code == 400
        assert r.json() == {"detail": "La nuova password deve essere di almeno 6 caratteri"}
        r = member.put("/auth/password", json={"current_password": member.password, "new_password": "nuova-pw-1"})
        assert r.status_code == 200 and r.json() == {"ok": True}
        login(member.user["username"], "nuova-pw-1")


# ── Brani ───────────────────────────────────────────────────────────────────

class TestSongs:
    def test_create_shape(self, song, member):
        assert song["artist"] == "Test Artist" and song["title"] == "Test Title"
        assert song["category"] == "proposta"
        assert song["validated"] is False
        assert song["proposed_by_id"] == member.user["id"]
        assert song["proposed_by_username"] == member.user["username"]
        assert song["last_modified_by_username"] == member.user["username"]
        assert ISO_RE.match(song["created_at"]) and ISO_RE.match(song["updated_at"])
        for k in ("lyrics", "chords_url", "chords_text", "youtube_url", "cover_url", "validation_error"):
            assert song[k] is None

    def test_create_missing_field_422(self, member):
        assert member.post("/songs", json={"artist": "solo"}).status_code == 422

    def test_get_and_list(self, song, member):
        assert member.get(f"/songs/{song['id']}").json() == song
        ids = [s["id"] for s in member.get("/songs").json()]
        assert song["id"] in ids

    def test_get_404(self, member):
        r = member.get("/songs/99999999")
        assert r.status_code == 404 and r.json() == {"detail": "Brano non trovato"}

    def test_list_filter_category(self, song, member):
        in_cat = [s["id"] for s in member.get("/songs", params={"category": "proposta"}).json()]
        other = [s["id"] for s in member.get("/songs", params={"category": "in_scaletta"}).json()]
        assert song["id"] in in_cat and song["id"] not in other
        # categoria non valida: nessun filtro
        assert song["id"] in [s["id"] for s in member.get("/songs", params={"category": "boh"}).json()]

    def test_list_ordered_by_updated_desc(self, song, member):
        dates = [s["updated_at"] for s in member.get("/songs").json()]
        assert dates == sorted(dates, reverse=True)

    def test_update(self, song, member2):
        r = member2.put(f"/songs/{song['id']}", json={"artist": " Nuovo ", "title": "Titolo", "category": "da_provare"})
        assert r.status_code == 200
        d = r.json()
        assert (d["artist"], d["title"], d["category"]) == ("Nuovo", "Titolo", "da_provare")
        assert d["last_modified_by_id"] == member2.user["id"]
        assert d["proposed_by_id"] == song["proposed_by_id"]
        assert d["updated_at"] >= song["updated_at"]

    def test_update_partial_and_invalid_category(self, song, member):
        r = member.put(f"/songs/{song['id']}", json={"title": "Solo titolo"})
        assert r.status_code == 200 and r.json()["artist"] == "Test Artist"
        r = member.put(f"/songs/{song['id']}", json={"category": "boh"})
        assert r.status_code == 400 and r.json() == {"detail": "Categoria non valida"}

    def test_change_category(self, song, member):
        r = member.put(f"/songs/{song['id']}/category", json={"category": "in_scaletta"})
        assert r.status_code == 200 and r.json()["category"] == "in_scaletta"
        assert member.put(f"/songs/{song['id']}/category", json={"category": "x"}).status_code == 400
        assert member.put("/songs/99999999/category", json={"category": "proposta"}).status_code == 404

    def test_delete_cascades(self, song, member, member2):
        sid = song["id"]
        member.post(f"/songs/{sid}/comments", json={"content": "ciao"})
        member2.post(f"/songs/{sid}/likes")
        r = member.delete(f"/songs/{sid}")
        assert r.status_code == 204 and r.content == b""
        assert member.get(f"/songs/{sid}").status_code == 404
        assert member.get(f"/songs/{sid}/comments").status_code == 404
        assert member.get(f"/songs/{sid}/likes").status_code == 404
        assert member.delete(f"/songs/{sid}").status_code == 404

    def test_enrich_without_groq_key(self, song, member, admin):
        settings = {s["key"]: s["value_masked"] for s in admin.get("/admin/settings").json()}
        if settings.get("groq_api_key", ""):
            pytest.skip("groq_api_key configurata: il percorso deterministico senza chiave non e' testabile")
        r = member.post(f"/songs/{song['id']}/enrich")
        assert r.status_code == 200 and "detail" in r.json()
        d = member.get(f"/songs/{song['id']}").json()
        assert d["validated"] is False
        assert "Groq API key non configurata" in d["validation_error"]

    def test_enrich_404(self, member):
        assert member.post("/songs/99999999/enrich").status_code == 404


# ── Commenti ────────────────────────────────────────────────────────────────

class TestComments:
    def test_create_list_shape(self, song, member):
        r = member.post(f"/songs/{song['id']}/comments", json={"content": "  Bel pezzo  "})
        assert r.status_code == 201
        c = r.json()
        assert c["content"] == "Bel pezzo" and c["parent_id"] is None
        assert c["username"] == member.user["username"] and c["song_id"] == song["id"]
        assert ISO_RE.match(c["created_at"])
        assert member.get(f"/songs/{song['id']}/comments").json() == [c]

    def test_empty_comment_400(self, song, member):
        r = member.post(f"/songs/{song['id']}/comments", json={"content": "   "})
        assert r.status_code == 400

    def test_comment_on_missing_song_404(self, member):
        assert member.post("/songs/99999999/comments", json={"content": "x"}).status_code == 404

    def test_thread_rules(self, song, member, member2):
        sid = song["id"]
        parent = member.post(f"/songs/{sid}/comments", json={"content": "padre"}).json()
        reply = member2.post(f"/songs/{sid}/comments", json={"content": "risposta", "parent_id": parent["id"]})
        assert reply.status_code == 201 and reply.json()["parent_id"] == parent["id"]
        nested = member.post(f"/songs/{sid}/comments", json={"content": "x", "parent_id": reply.json()["id"]})
        assert nested.status_code == 400 and nested.json() == {"detail": "Nidificazione massima raggiunta"}
        bad = member.post(f"/songs/{sid}/comments", json={"content": "x", "parent_id": 99999999})
        assert bad.status_code == 400 and bad.json() == {"detail": "Commento padre non valido"}

    def test_parent_from_other_song_400(self, song, member, made):
        other = member.post("/songs", json={"artist": "A", "title": "B"}).json()
        made["songs"].append(other["id"])
        p = member.post(f"/songs/{other['id']}/comments", json={"content": "p"}).json()
        r = member.post(f"/songs/{song['id']}/comments", json={"content": "x", "parent_id": p["id"]})
        assert r.status_code == 400

    def test_update_permissions(self, song, member, member2):
        c = member.post(f"/songs/{song['id']}/comments", json={"content": "mio"}).json()
        url = f"/songs/{song['id']}/comments/{c['id']}"
        r = member.put(url, json={"content": "modificato"})
        assert r.status_code == 200 and r.json()["content"] == "modificato"
        r = member2.put(url, json={"content": "hack"})
        assert r.status_code == 403 and r.json() == {"detail": "Non puoi modificare questo commento"}
        assert member.put(url, json={"content": " "}).status_code == 400
        assert member.put(f"/songs/{song['id']}/comments/99999999", json={"content": "x"}).status_code == 404

    def test_delete_permissions_and_cascade(self, song, member, member2, admin):
        sid = song["id"]
        parent = member.post(f"/songs/{sid}/comments", json={"content": "p"}).json()
        member2.post(f"/songs/{sid}/comments", json={"content": "r", "parent_id": parent["id"]})
        url = f"/songs/{sid}/comments/{parent['id']}"
        r = member2.delete(url)
        assert r.status_code == 403 and r.json() == {"detail": "Non puoi eliminare questo commento"}
        r = admin.delete(url)  # l'admin puo' eliminare i commenti altrui
        assert r.status_code == 204
        assert member.get(f"/songs/{sid}/comments").json() == []  # le risposte seguono il padre

    def test_author_can_delete_own(self, song, member):
        c = member.post(f"/songs/{song['id']}/comments", json={"content": "x"}).json()
        assert member.delete(f"/songs/{song['id']}/comments/{c['id']}").status_code == 204


# ── Like ────────────────────────────────────────────────────────────────────

class TestLikes:
    def test_toggle_and_count(self, song, member, member2):
        sid = song["id"]
        assert member.get(f"/songs/{sid}/likes").json() == {"count": 0, "liked": False}
        assert member.post(f"/songs/{sid}/likes").json() == {"count": 1, "liked": True}
        assert member2.post(f"/songs/{sid}/likes").json() == {"count": 2, "liked": True}
        assert member.get(f"/songs/{sid}/likes").json() == {"count": 2, "liked": True}
        assert member.post(f"/songs/{sid}/likes").json() == {"count": 1, "liked": False}
        assert member2.get(f"/songs/{sid}/likes").json() == {"count": 1, "liked": True}

    def test_missing_song_404(self, member):
        assert member.get("/songs/99999999/likes").status_code == 404
        assert member.post("/songs/99999999/likes").status_code == 404


# ── Admin ───────────────────────────────────────────────────────────────────

class TestAdmin:
    def test_member_forbidden(self, member):
        for method, path in (("GET", "/admin/users"), ("GET", "/admin/settings")):
            r = member.request(method, path)
            assert r.status_code == 403, path
            assert r.json() == {"detail": "Accesso riservato all'admin"}
        assert member.post("/admin/users", json={"username": "z", "password": "z"}).status_code == 403
        assert member.put("/admin/settings", json={"key": "k", "value": "v"}).status_code == 403

    def test_list_users(self, admin, member):
        users = admin.get("/admin/users").json()
        assert any(u["username"] == member.user["username"] for u in users)
        assert all(set(u) == {"id", "username", "role", "created_at"} for u in users)
        assert all("password_hash" not in u for u in users)
        assert all(ISO_RE.match(u["created_at"]) for u in users)

    def test_create_user_rules(self, admin, member):
        dup = admin.post("/admin/users", json={"username": member.user["username"], "password": "abcdef"})
        assert dup.status_code == 400 and dup.json() == {"detail": "Username già esistente"}
        bad = admin.post("/admin/users", json={"username": "t_x_role", "password": "abcdef", "role": "boss"})
        assert bad.status_code == 400 and bad.json() == {"detail": "Ruolo non valido"}

    def test_reset_password(self, admin, member):
        uid = member.user["id"]
        short = admin.put(f"/admin/users/{uid}/password", json={"new_password": "abc"})
        assert short.status_code == 400
        assert admin.put("/admin/users/99999999/password", json={"new_password": "abcdef"}).status_code == 404
        assert admin.put(f"/admin/users/{uid}/password", json={"new_password": "reset-pw-1"}).json() == {"ok": True}
        login(member.user["username"], "reset-pw-1")
        r = httpx.post(f"{API}/auth/login", json={"username": member.user["username"], "password": member.password}, timeout=60)
        assert r.status_code == 401

    def test_delete_user(self, admin):
        r = admin.post("/admin/users", json={"username": "t_del_user_x", "password": "abcdef"})
        if r.status_code == 400:  # residuo di una run interrotta
            uid = next(u["id"] for u in admin.get("/admin/users").json() if u["username"] == "t_del_user_x")
        else:
            uid = r.json()["id"]
        assert admin.delete(f"/admin/users/{uid}").status_code == 204
        assert admin.delete(f"/admin/users/{uid}").status_code == 404

    def test_cannot_delete_self(self, admin):
        r = admin.delete(f"/admin/users/{admin.user['id']}")
        assert r.status_code == 400 and r.json() == {"detail": "Non puoi eliminare te stesso"}

    def test_settings_masked_roundtrip(self, admin):
        key = "t_test_setting"
        r = admin.put("/admin/settings", json={"key": key, "value": "  abcdefgh12  "})
        assert r.status_code == 200 and r.json() == {"key": key, "value_masked": "******gh12"}
        listed = {s["key"]: s["value_masked"] for s in admin.get("/admin/settings").json()}
        assert listed[key] == "******gh12"
        short = admin.put("/admin/settings", json={"key": key, "value": "abc"}).json()
        assert short["value_masked"] == "***"
        # nessun valore in chiaro nelle risposte
        assert "abcdefgh12" not in admin.get("/admin/settings").text

    def test_default_settings_present(self, admin):
        keys = {s["key"] for s in admin.get("/admin/settings").json()}
        assert {"groq_api_key", "genius_api_key", "chords_enabled"} <= keys


# ── Sicurezza ───────────────────────────────────────────────────────────────

class TestSecurity:
    @pytest.mark.parametrize("path", [
        "api/data/band_manager.db",
        "api/data/error.log",
        "api/config.php",
        "api/config.example.php",
        "api/src/Db.php",
        "api/src/Auth.php",
    ])
    def test_private_files_not_served(self, site_url, path):
        r = httpx.get(f"{site_url}/{path}", timeout=30)
        assert r.status_code in (403, 404), f"{path}: {r.status_code}"

    def test_unknown_route_404_json(self, admin):
        r = admin.get("/non-esiste")
        assert r.status_code == 404 and "detail" in r.json()

    def test_wrong_method_405(self, admin):
        assert admin.request("PATCH", "/songs").status_code == 405

    def test_sql_injection_in_params_is_harmless(self, admin):
        r = admin.get("/songs", params={"category": "' OR 1=1 --"})
        assert r.status_code == 200
        r = admin.post("/songs", json={"artist": "x'); DROP TABLE song;--", "title": "t"})
        assert r.status_code == 201
        sid = r.json()["id"]
        assert admin.get("/songs").status_code == 200  # la tabella esiste ancora
        admin.delete(f"/songs/{sid}")

    def test_unicode_roundtrip(self, member, made):
        r = member.post("/songs", json={"artist": "Måneskin", "title": "Zitti e buoni — è così ♥"})
        assert r.status_code == 201
        made["songs"].append(r.json()["id"])
        assert r.json()["title"] == "Zitti e buoni — è così ♥"
