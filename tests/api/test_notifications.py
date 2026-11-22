"""Notifiche: storico, raggruppamento, preferenze, sottoscrizioni Web Push (spec push-notifications).

Il DB di prova è condiviso con gli altri test: ogni verifica guarda solo le notifiche del contenuto creato
dal test stesso (url/titolo univoci). Le parti sulle push richiedono la modalità cattura del server
(`'push_capture' => true` in config.php: band-test e Docker locale); altrimenti vengono saltate.
"""
import base64
import json
import os
import time
import uuid

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from conftest import register_user, uniq

M4A = b"\x00\x00\x00\x18ftypM4A " + bytes(range(256)) * 8
TODAY = time.strftime("%Y-%m-%d")


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# ── Helper ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def member3(admin, made):
    return register_user(admin, made)


@pytest.fixture()
def projects(admin):
    created = []
    yield created
    for pid in created:
        pr = admin.get(f"/studio/projects/{pid}")
        if pr.status_code != 200:
            continue
        if pr.json()["song_id"]:
            admin.delete(f"/songs/{pr.json()['song_id']}")
        admin.delete(f"/studio/projects/{pid}")


def notifs(api):
    r = api.get("/notifications", params={"limit": 50})
    assert r.status_code == 200, r.text
    return r.json()["items"]


def about(api, prefix, kind=None):
    """Notifiche dell'utente il cui url inizia con prefix (es. /songs/12)."""
    return [n for n in notifs(api) if (n["url"] == prefix or n["url"].startswith(prefix + "?") or n["url"].startswith(prefix + "/"))
            and (kind is None or n["kind"] == kind)]


def new_song(api, made):
    r = api.post("/songs", json={"artist": "Notify Artist", "title": uniq("Notifica")})
    assert r.status_code == 201, r.text
    made["songs"].append(r.json()["id"])
    return r.json()


def new_project(api, projects):
    r = api.post("/studio/projects", json={"title": uniq("Idea notifica")})
    assert r.status_code == 201, r.text
    projects.append(r.json()["id"])
    return r.json()


def new_take(api, pid):
    r = api.post(f"/studio/projects/{pid}/takes", data={"kind": "audio", "title": "Take notifica"},
                 files={"file": ("riff.m4a", M4A, "application/octet-stream")})
    assert r.status_code == 201, r.text
    return r.json()


def comment(api, sid, text="Bel pezzo", parent_id=None):
    body = {"content": text}
    if parent_id:
        body["parent_id"] = parent_id
    r = api.post(f"/songs/{sid}/comments", json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ── Preferenze ──────────────────────────────────────────────────────────────

class TestPrefs:
    def test_defaults_and_update(self, member):
        assert member.get("/auth/me").json()["notify_prefs"] == {"song": "all", "like": "all", "comment": "all", "media": "all"}
        r = member.put("/auth/notify-prefs", json={"like": "mine", "media": "off"})
        assert r.status_code == 200, r.text
        assert r.json()["notify_prefs"] == {"song": "all", "like": "mine", "comment": "all", "media": "off"}
        assert member.get("/auth/me").json()["notify_prefs"]["like"] == "mine"

    @pytest.mark.parametrize("body", [{"song": "mine"}, {"like": "tutti"}, {"altro": "all"}, {}, [], {"comment": 1}])
    def test_invalid(self, member, body):
        assert member.put("/auth/notify-prefs", json=body).status_code == 422

    def test_needs_auth(self, anon):
        assert anon.get("/notifications").status_code == 401
        assert anon.put("/auth/notify-prefs", json={"like": "off"}).status_code == 401


# ── Eventi e destinatari ────────────────────────────────────────────────────

class TestEvents:
    def test_new_song_to_others_not_actor(self, member, member2, admin, made):
        s = new_song(member, made)
        mine = about(member, f"/songs/{s['id']}")
        assert mine == []
        n = about(member2, f"/songs/{s['id']}", "song_new")
        assert len(n) == 1
        assert n[0]["text"] == f"{member.user['username']} ha aggiunto «{s['title']}»"
        assert n[0]["read"] is False and n[0]["actors"][0]["username"] == member.user["username"]
        assert len(about(admin, f"/songs/{s['id']}", "song_new")) == 1

    def test_new_songs_grouped_by_author(self, member, member2, made):
        a = new_song(member, made)
        b = new_song(member, made)
        group = [n for n in notifs(member2) if n["kind"] == "song_new" and n["actors"][0]["id"] == member.user["id"]]
        assert len(group) == 1 and group[0]["count"] == 2
        assert group[0]["text"] == f"{member.user['username']} ha aggiunto 2 brani"
        assert group[0]["url"] == "/" and group[0]["title"] == b["title"] != a["title"]

    def test_like_group_and_retract(self, member, member2, member3, made):
        s = new_song(member, made)
        assert member2.post(f"/songs/{s['id']}/likes").json()["liked"] is True
        assert member3.post(f"/songs/{s['id']}/likes").json()["liked"] is True
        n = about(member, f"/songs/{s['id']}", "like")
        assert len(n) == 1 and n[0]["count"] == 2
        u2, u3 = member2.user["username"], member3.user["username"]
        assert n[0]["text"] == f"{u3} e {u2} hanno messo mi piace a «{s['title']}»"
        # Chi mette like riceve quello dell'altro, non il proprio
        n2 = about(member2, f"/songs/{s['id']}", "like")
        assert len(n2) == 1 and n2[0]["count"] == 1 and n2[0]["actors"][0]["id"] == member3.user["id"]
        # Rimozione: esce dal gruppo; gruppo vuoto → notifica sparita
        member3.post(f"/songs/{s['id']}/likes")
        n = about(member, f"/songs/{s['id']}", "like")
        assert n[0]["count"] == 1 and n[0]["text"] == f"{u2} ha messo mi piace a «{s['title']}»"
        member2.post(f"/songs/{s['id']}/likes")
        assert about(member, f"/songs/{s['id']}", "like") == []

    def test_comments_group_then_new_after_read(self, member, member2, member3, made):
        s = new_song(member, made)
        c1 = comment(member2, s["id"], "Primo   commento\ncon a capo")
        n = about(member, f"/songs/{s['id']}", "comment")
        assert len(n) == 1
        assert n[0]["text"] == f"{member2.user['username']} ha commentato «{s['title']}»"
        assert n[0]["excerpt"] == "Primo commento con a capo"
        assert n[0]["url"] == f"/songs/{s['id']}?focus=comment-{c1['id']}"
        c2 = comment(member2, s["id"], "Secondo")
        n = about(member, f"/songs/{s['id']}", "comment")
        assert len(n) == 1 and n[0]["count"] == 2
        assert n[0]["text"] == f"{member2.user['username']} ha scritto 2 commenti su «{s['title']}»"
        assert n[0]["excerpt"] == "Secondo" and n[0]["url"].endswith(f"comment-{c2['id']}")
        comment(member3, s["id"], "Terzo")
        n = about(member, f"/songs/{s['id']}", "comment")
        assert n[0]["count"] == 3 and n[0]["text"] == f"3 nuovi commenti su «{s['title']}»"
        # Dopo la lettura il gruppo non si riapre
        assert member.post("/notifications/read", json={"ids": [n[0]["id"]]}).status_code == 200
        comment(member2, s["id"], "Quarto")
        n = about(member, f"/songs/{s['id']}", "comment")
        assert len(n) == 2 and [x["read"] for x in n] == [False, True] and n[0]["count"] == 1

    def test_long_excerpt_truncated(self, member, member2, made):
        s = new_song(member, made)
        comment(member2, s["id"], "x" * 500)
        ex = about(member, f"/songs/{s['id']}", "comment")[0]["excerpt"]
        assert len(ex) == 140 and ex.endswith("…")

    def test_media_video_audio(self, member, member2, made):
        s = new_song(member, made)
        v = member2.post(f"/songs/{s['id']}/videos", json={"url": "https://youtu.be/dQw4w9WgXcQ", "title": "GoPro", "recorded_on": TODAY})
        assert v.status_code == 201, v.text
        n = about(member, f"/songs/{s['id']}", "media")
        assert n[0]["text"] == f"{member2.user['username']} ha aggiunto un video a «{s['title']}»"
        a = member2.post(f"/songs/{s['id']}/audios", data={"title": "Audio", "recorded_on": TODAY},
                         files={"file": ("p.m4a", M4A, "application/octet-stream")})
        assert a.status_code == 201, a.text
        n = about(member, f"/songs/{s['id']}", "media")
        assert len(n) == 1 and n[0]["count"] == 2
        assert n[0]["text"] == f"{member2.user['username']} ha aggiunto 2 contenuti a «{s['title']}»"
        assert n[0]["url"] == f"/songs/{s['id']}?focus=audio-{a.json()['id']}"

    def test_audio_alone(self, member, member2, made):
        s = new_song(member, made)
        member2.post(f"/songs/{s['id']}/audios", data={"title": "Audio", "recorded_on": TODAY},
                     files={"file": ("p.m4a", M4A, "application/octet-stream")})
        assert "ha aggiunto un audio a" in about(member, f"/songs/{s['id']}", "media")[0]["text"]

    def test_studio_events(self, member, member2, projects, made):
        p = new_project(member, projects)
        pid = p["id"]
        n = about(member2, f"/studio/{pid}", "project_new")
        assert len(n) == 1 and n[0]["text"] == f"{member.user['username']} ha creato il brano di prova «{p['title']}»"
        t = new_take(member2, pid)
        n = about(member, f"/studio/{pid}", "media")
        assert n[0]["text"] == f"{member2.user['username']} ha aggiunto un contenuto a «{p['title']}»"
        assert n[0]["url"] == f"/studio/{pid}?focus=take-{t['id']}"
        pv = member2.post(f"/studio/projects/{pid}/videos", json={"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Sala", "recorded_on": TODAY})
        assert pv.status_code == 201, pv.text
        assert about(member, f"/studio/{pid}", "media")[0]["count"] == 2
        pc = member2.post(f"/studio/projects/{pid}/comments", json={"content": "Ottima idea"})
        assert pc.status_code == 201
        n = [x for x in about(member, f"/studio/{pid}", "comment") if x["url"].startswith(f"/studio/{pid}?")]
        assert n[0]["text"] == f"{member2.user['username']} ha commentato «{p['title']}»" and n[0]["excerpt"] == "Ottima idea"
        # Commento su un take: lo riceve anche l'autore del take (member2) se commenta member
        tc = member.post(f"/studio/takes/{t['id']}/comments", json={"content": "Al [[t:3400]] entra la batteria"})
        assert tc.status_code == 201
        n = about(member2, f"/studio/{pid}/takes/{t['id']}", "comment")
        assert n[0]["text"] == f"{member.user['username']} ha commentato «{p['title']} – Take notifica»"
        assert n[0]["excerpt"] == "Al entra la batteria"
        # Eventi esclusi: marker e cambio di stato non generano notifiche
        before = len(notifs(member2))
        assert member.post(f"/studio/takes/{t['id']}/markers", json={"time_ms": 1000, "label": "Strofa"}).status_code == 201
        assert member.put(f"/studio/projects/{pid}/status", json={"status": "pronto"}).status_code == 200
        assert len(notifs(member2)) == before
        # Promozione: notificata
        r = member.post(f"/studio/projects/{pid}/promote", json={"title": uniq("Promosso"), "artist": "Band", "category": "proposta"})
        assert r.status_code == 201, r.text
        sid = r.json()["song_id"]
        made["songs"].append(sid)
        n = about(member2, f"/songs/{sid}", "promoted")
        assert len(n) == 1 and n[0]["text"].startswith(f"{member.user['username']} ha promosso «Promosso ")
        assert n[0]["text"].endswith("» in repertorio")


class TestPrefFilters:
    def test_off_and_mine(self, member, member2, member3, made):
        assert member3.put("/auth/notify-prefs", json={"like": "off", "comment": "mine"}).status_code == 200
        s = new_song(member, made)
        member2.post(f"/songs/{s['id']}/likes")
        assert about(member3, f"/songs/{s['id']}", "like") == []
        assert len(about(member, f"/songs/{s['id']}", "like")) == 1
        c = comment(member2, s["id"], "Commento generico")
        assert about(member3, f"/songs/{s['id']}", "comment") == []
        # Risposta a un commento di member3: per lui è "suo"
        mine = comment(member3, s["id"], "Il mio commento")
        comment(member2, s["id"], "Risposta", parent_id=mine["id"])
        assert len(about(member3, f"/songs/{s['id']}", "comment")) == 1
        assert c["id"]

    def test_mine_own_song(self, member, member2, made):
        assert member.put("/auth/notify-prefs", json={"like": "mine"}).status_code == 200
        s = new_song(member, made)
        member2.post(f"/songs/{s['id']}/likes")
        assert len(about(member, f"/songs/{s['id']}", "like")) == 1

    def test_song_off(self, member, member2, made):
        assert member2.put("/auth/notify-prefs", json={"song": "off"}).status_code == 200
        s = new_song(member, made)
        assert about(member2, f"/songs/{s['id']}") == []


# ── Letto / non letto, isolamento, pulizia ──────────────────────────────────

class TestReadState:
    def test_unread_mark_ids_and_all(self, member, member2, made):
        base = member.get("/notifications/unread").json()["unread"]
        s1, s2 = new_song(member2, made), new_song(member2, made)
        member2.post(f"/songs/{s1['id']}/likes")
        comment(member2, s2["id"])
        un = member.get("/notifications/unread").json()["unread"]
        assert un >= base + 1
        nid = about(member, f"/songs/{s2['id']}", "comment")[0]["id"]
        r = member.post("/notifications/read", json={"ids": [nid]})
        assert r.status_code == 200 and r.json()["unread"] == un - 1
        assert about(member, f"/songs/{s2['id']}", "comment")[0]["read"] is True
        r = member.post("/notifications/read", json={"all": True})
        assert r.json()["unread"] == 0
        assert member.get("/notifications").json()["unread"] == 0

    def test_isolation(self, member, member2, made):
        s = new_song(member2, made)
        mine = about(member, f"/songs/{s['id']}")
        assert len(mine) == 1
        # member2 non vede né può segnare come lette le notifiche di member
        assert all(n["id"] != mine[0]["id"] for n in notifs(member2))
        member2.post("/notifications/read", json={"ids": [mine[0]["id"]]})
        assert about(member, f"/songs/{s['id']}")[0]["read"] is False

    @pytest.mark.parametrize("body", [{}, {"ids": ["1"]}, {"ids": "1"}, {"all": "yes"}])
    def test_read_invalid(self, member, body):
        assert member.post("/notifications/read", json=body).status_code == 422

    def test_pagination(self, member):
        r = member.get("/notifications", params={"limit": 1})
        assert r.status_code == 200 and len(r.json()["items"]) <= 1 and "has_more" in r.json()

    def test_forget_on_delete(self, member, member2, made, projects):
        s = new_song(member, made)
        comment(member2, s["id"])
        assert about(member, f"/songs/{s['id']}") != []
        assert member.delete(f"/songs/{s['id']}").status_code == 204
        assert about(member, f"/songs/{s['id']}") == []
        assert about(member2, f"/songs/{s['id']}") == []
        p = new_project(member, projects)
        t = new_take(member, p["id"])
        member2.post(f"/studio/takes/{t['id']}/comments", json={"content": "ok"})
        assert about(member, f"/studio/{p['id']}/takes/{t['id']}") != []
        assert member.delete(f"/studio/takes/{t['id']}").status_code == 204
        assert about(member, f"/studio/{p['id']}/takes/{t['id']}") == []
        assert member.delete(f"/studio/projects/{p['id']}").status_code == 204
        assert about(member2, f"/studio/{p['id']}") == []

    def test_forget_on_move_to_studio(self, member, member2, made, projects):
        s = new_song(member, made)
        comment(member2, s["id"])
        r = member.post(f"/songs/{s['id']}/to-studio")
        assert r.status_code == 200, r.text
        projects.append(r.json()["project_id"])
        assert about(member, f"/songs/{s['id']}") == []

    def test_internal_settings_hidden(self, admin, member):
        member.get("/push/key")      # genera le chiavi VAPID se mancano
        keys = {s["key"] for s in admin.get("/admin/settings").json()}
        assert not keys & {"vapid_public", "vapid_private", "notify_last_purge"}
        assert admin.put("/admin/settings", json={"key": "vapid_private", "value": "x"}).status_code == 400


# ── Sottoscrizioni e push ───────────────────────────────────────────────────

class Device:
    """Browser finto: coppia P-256 + segreto auth, endpoint sull'host di test."""

    def __init__(self, path=""):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.pub = self.key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.auth = os.urandom(16)
        self.endpoint = f"https://push.test.invalid/{path}{uuid.uuid4().hex}"

    def body(self):
        return {"endpoint": self.endpoint, "keys": {"p256dh": b64u(self.pub), "auth": b64u(self.auth)}}

    def decrypt(self, body):
        salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
        assert rs == 4096 and idlen == 65
        as_pub = body[21:86]
        secret = self.key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub))
        ikm = HKDF(hashes.SHA256(), 32, self.auth, b"WebPush: info\x00" + self.pub + as_pub).derive(secret)
        cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(ikm)
        nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
        plain = AESGCM(cek).decrypt(nonce, body[86:], None).rstrip(b"\x00")
        assert plain.endswith(b"\x02")
        return json.loads(plain[:-1])


_captured = []


def capture(admin, endpoint, n=1, wait=8.0):
    """Push catturate per endpoint; le push partono dopo la risposta, quindi si riprova per qualche secondo."""
    deadline = time.time() + wait
    while True:
        r = admin.get("/admin/push/capture")
        assert r.status_code == 200, r.text
        _captured.extend(r.json())
        got = [c for c in _captured if c["endpoint"] == endpoint]
        if len(got) >= n or time.time() > deadline:
            return got
        time.sleep(0.5)


def consume(endpoint):
    _captured[:] = [c for c in _captured if c["endpoint"] != endpoint]


@pytest.fixture(scope="module")
def capture_mode(admin):
    if admin.get("/admin/push/capture").status_code == 404:
        pytest.skip("Modalità push_capture non attiva su questo server")


class TestSubscriptions:
    def test_key(self, member):
        k = member.get("/push/key").json()["public_key"]
        assert len(unb64u(k)) == 65 and unb64u(k)[0] == 4
        assert member.get("/push/key").json()["public_key"] == k

    @pytest.mark.parametrize("endpoint", [
        "https://evil.example.com/push", "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.com/x",
        "https://127.0.0.1/x", "file:///etc/passwd", "https://fcm.googleapis.com:444/x", "https://fcm.googleapis.com/" + "a" * 1100,
    ])
    def test_endpoint_rejected(self, member, endpoint):
        d = Device().body()
        d["endpoint"] = endpoint
        assert member.post("/push/subscriptions", json=d).status_code == 422

    def test_keys_rejected(self, member):
        d = Device()
        for keys in [{"p256dh": b64u(d.pub[1:]), "auth": b64u(d.auth)}, {"p256dh": b64u(d.pub), "auth": b64u(d.auth[:8])},
                     {"p256dh": "!!", "auth": b64u(d.auth)}, {"p256dh": b64u(b"\x05" + d.pub[1:]), "auth": b64u(d.auth)}, {}]:
            body = {"endpoint": "https://fcm.googleapis.com/fcm/send/" + uuid.uuid4().hex, "keys": keys}
            assert member.post("/push/subscriptions", json=body).status_code == 422, keys

    def test_real_service_accepted(self, member):
        d = Device()
        body = d.body()
        body["endpoint"] = "https://fcm.googleapis.com/fcm/send/" + uuid.uuid4().hex
        assert member.post("/push/subscriptions", json=body).status_code == 200
        assert member.delete("/push/subscriptions", json={"endpoint": body["endpoint"]}).status_code == 204

    def test_test_push_needs_device(self, member):
        assert member.post("/push/test").status_code == 409


@pytest.mark.usefixtures("capture_mode")
class TestPush:
    def test_encrypted_payload_and_vapid(self, admin, member, member2, made):
        dev = Device()
        assert member.post("/push/subscriptions", json=dev.body()).status_code == 200
        s = new_song(member, made)
        comment(member2, s["id"], "Si sente benissimo")
        got = capture(admin, dev.endpoint)
        assert len(got) == 1
        c = got[0]
        assert c["user_id"] == member.user["id"]
        msg = dev.decrypt(base64.b64decode(c["body"]))
        assert msg["body"] == f"{member2.user['username']} ha commentato «{s['title']}»\nSi sente benissimo"
        assert msg["url"].startswith(f"/songs/{s['id']}?focus=comment-")
        assert msg["tag"] == f"comment:song:{s['id']}" and msg["renotify"] is True
        assert isinstance(msg["nid"], int) and msg["unread"] >= 1 and msg["title"]
        headers = dict(h.split(": ", 1) for h in c["headers"])
        assert headers["Content-Encoding"] == "aes128gcm" and headers["TTL"] == "86400" and len(headers["Topic"]) <= 32
        # VAPID: JWT ES256 firmato con la chiave pubblica esposta da /push/key
        auth = headers["Authorization"]
        assert auth.startswith("vapid t=")
        jwt, k = auth[len("vapid t="):].split(", k=")
        assert k == member.get("/push/key").json()["public_key"]
        h64, c64, s64 = jwt.split(".")
        claims = json.loads(unb64u(c64))
        assert json.loads(unb64u(h64)) == {"typ": "JWT", "alg": "ES256"}
        assert claims["aud"] == "https://push.test.invalid" and claims["sub"].startswith("mailto:")
        assert time.time() < claims["exp"] <= time.time() + 24 * 3600
        raw = unb64u(s64)
        sig = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
        pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64u(k))
        pub.verify(sig, f"{h64}.{c64}".encode(), ec.ECDSA(hashes.SHA256()))
        consume(dev.endpoint)
        # Secondo commento entro 3 minuti: storico aggiornato, nessuna nuova push
        comment(member2, s["id"], "E anche il ritornello")
        assert about(member, f"/songs/{s['id']}", "comment")[0]["count"] == 2
        assert capture(admin, dev.endpoint, wait=3) == []
        member.delete("/push/subscriptions", json={"endpoint": dev.endpoint})

    def test_actor_gets_no_push_and_unsubscribe(self, admin, member, member2, made):
        dev = Device()
        member.post("/push/subscriptions", json=dev.body())
        new_song(member, made)                                     # azione propria: niente push
        assert capture(admin, dev.endpoint, wait=3) == []
        assert member.delete("/push/subscriptions", json={"endpoint": dev.endpoint}).status_code == 204
        new_song(member2, made)                                    # sottoscrizione tolta: niente push
        assert capture(admin, dev.endpoint, wait=3) == []

    def test_shared_device_moves_to_new_user(self, admin, member, member2, member3, made):
        dev = Device()
        member.post("/push/subscriptions", json=dev.body())
        member2.post("/push/subscriptions", json=dev.body())       # stesso browser, altro utente
        # Il vecchio utente non può più toglierla
        assert member.delete("/push/subscriptions", json={"endpoint": dev.endpoint}).status_code == 204
        s = new_song(member3, made)
        got = capture(admin, dev.endpoint)
        assert [c["user_id"] for c in got] == [member2.user["id"]]
        assert dev.decrypt(base64.b64decode(got[0]["body"]))["url"] == f"/songs/{s['id']}"
        consume(dev.endpoint)
        member2.delete("/push/subscriptions", json={"endpoint": dev.endpoint})

    def test_gone_subscription_removed(self, admin, member, member2, made):
        dev = Device(path="gone/")                                  # in cattura risponde 410
        member.post("/push/subscriptions", json=dev.body())
        s1 = new_song(member, made)
        member2.post(f"/songs/{s1['id']}/likes")
        assert len(capture(admin, dev.endpoint)) == 1
        consume(dev.endpoint)
        s2 = new_song(member, made)
        member2.post(f"/songs/{s2['id']}/likes")
        assert capture(admin, dev.endpoint, wait=3) == []

    def test_test_push_and_rate_limit(self, admin, member):
        dev = Device()
        member.post("/push/subscriptions", json=dev.body())
        r = member.post("/push/test")
        assert r.status_code == 200 and r.json()["devices"] == 1
        got = capture(admin, dev.endpoint)
        assert dev.decrypt(base64.b64decode(got[0]["body"]))["tag"] == "test"
        consume(dev.endpoint)
        assert member.post("/push/test").status_code == 429
        member.delete("/push/subscriptions", json={"endpoint": dev.endpoint})

    def test_subscriptions_removed_with_user(self, admin, made, member2):
        u = register_user(admin, made)
        dev = Device()
        u.post("/push/subscriptions", json=dev.body())
        assert admin.delete(f"/admin/users/{u.user['id']}").status_code == 204
        new_song(member2, made)
        assert capture(admin, dev.endpoint, wait=3) == []
