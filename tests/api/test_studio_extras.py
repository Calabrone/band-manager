"""Sala prove: testo, commenti e video del brano di prova, spostamento di un brano in Prove (spec studio-extras)."""
import time

import httpx
import pytest

from conftest import uniq

M4A = b"\x00\x00\x00\x18ftypM4A " + bytes(range(256)) * 8
TODAY = time.strftime("%Y-%m-%d")
LYRICS = "[Intro]\n[Am]Quando sei [G]qui\nsulla strada"


@pytest.fixture()
def projects(admin):
    """Registro dei brani di prova creati dal test, eliminati a fine test (anche se promossi)."""
    created = []
    yield created
    for pid in created:
        pr = admin.get(f"/studio/projects/{pid}")
        if pr.status_code != 200:
            continue
        if pr.json()["song_id"]:
            admin.delete(f"/songs/{pr.json()['song_id']}")
        admin.delete(f"/studio/projects/{pid}")


def new_project(api, projects, **over):
    body = {"title": uniq("Idea")}
    body.update(over)
    r = api.post("/studio/projects", json=body)
    assert r.status_code == 201, r.text
    projects.append(r.json()["id"])
    return r.json()


def song_audio(api, sid, title="Take cover", note="dal telefono"):
    r = api.post(
        f"/songs/{sid}/audios",
        data={"title": title, "recorded_on": "2026-03-07", "note": note},
        files={"file": ("prova.m4a", M4A, "application/octet-stream")},
    )
    assert r.status_code == 201, r.text
    return r.json()


def song_video(api, sid, title="GoPro sala"):
    r = api.post(f"/songs/{sid}/videos", json={"url": "https://youtu.be/dQw4w9WgXcQ", "title": title, "recorded_on": TODAY})
    assert r.status_code == 201, r.text
    return r.json()


def move(api, sid, projects):
    r = api.post(f"/songs/{sid}/to-studio")
    if r.status_code == 200:
        projects.append(r.json()["project_id"])
    return r


# ── Testo ───────────────────────────────────────────────────────────────────

class TestProjectLyrics:
    def test_requires_auth(self, anon):
        assert anon.put("/studio/projects/1/lyrics", json={"lyrics": "x"}).status_code == 401

    def test_save_show_clear_by_any_member(self, member, member2, projects):
        p = new_project(member, projects)
        assert p["has_lyrics"] is False
        # chiunque puo' scriverlo (come per le cover), non solo il creatore
        r = member2.put(f"/studio/projects/{p['id']}/lyrics", json={"lyrics": LYRICS + "  \r\n"})
        assert r.status_code == 200, r.text
        assert r.json()["lyrics"] == LYRICS
        assert member.get(f"/studio/projects/{p['id']}").json()["lyrics"] == LYRICS
        listed = [x for x in member.get("/studio/projects").json() if x["id"] == p["id"]][0]
        assert listed["has_lyrics"] is True and "lyrics" not in listed
        r = member.put(f"/studio/projects/{p['id']}/lyrics", json={"lyrics": "   "})
        assert r.status_code == 200 and r.json()["lyrics"] is None
        assert member.get(f"/studio/projects/{p['id']}").json()["has_lyrics"] is False

    def test_too_long_and_missing_field(self, member, projects):
        p = new_project(member, projects)
        assert member.put(f"/studio/projects/{p['id']}/lyrics", json={"lyrics": "a" * 30001}).status_code == 400
        assert member.put(f"/studio/projects/{p['id']}/lyrics", json={}).status_code == 422
        assert member.put("/studio/projects/99999999/lyrics", json={"lyrics": "x"}).status_code == 404

    def test_ocr_validates_upload(self, member, projects):
        p = new_project(member, projects)
        assert member.post(f"/studio/projects/{p['id']}/lyrics/ocr").status_code == 422
        r = member.post(f"/studio/projects/{p['id']}/lyrics/ocr", files={"image": ("a.txt", b"non e' un'immagine", "text/plain")})
        assert r.status_code == 400
        assert member.post("/studio/projects/99999999/lyrics/ocr").status_code == 404


# ── Commenti ────────────────────────────────────────────────────────────────

class TestProjectComments:
    def test_crud_replies_permissions(self, member, member2, admin, projects):
        p = new_project(member, projects)
        base = f"/studio/projects/{p['id']}/comments"
        c = member.post(base, json={"content": "Bel riff"})
        assert c.status_code == 201, c.text
        c = c.json()
        assert c["project_id"] == p["id"] and c["parent_id"] is None and c["username"] == member.user["username"]
        rep = member2.post(base, json={"content": "Concordo", "parent_id": c["id"]})
        assert rep.status_code == 201 and rep.json()["parent_id"] == c["id"]
        # una sola nidificazione; padre inesistente
        assert member.post(base, json={"content": "x", "parent_id": rep.json()["id"]}).status_code == 400
        assert member.post(base, json={"content": "x", "parent_id": 99999999}).status_code == 400
        assert member.post(base, json={"content": "   "}).status_code == 400
        assert len(member2.get(base).json()) == 2
        # modifica solo dell'autore
        assert member2.put(f"{base}/{c['id']}", json={"content": "Hack"}).status_code == 403
        assert member.put(f"{base}/{c['id']}", json={"content": "Bel riff!"}).json()["content"] == "Bel riff!"
        # eliminazione: autore o admin; il principale porta via le risposte
        assert member2.delete(f"{base}/{c['id']}").status_code == 403
        assert admin.delete(f"{base}/{c['id']}").status_code == 204
        assert member.get(base).json() == []

    def test_comment_of_other_project_is_404(self, member, projects):
        a, b = new_project(member, projects), new_project(member, projects)
        c = member.post(f"/studio/projects/{a['id']}/comments", json={"content": "x"}).json()
        assert member.put(f"/studio/projects/{b['id']}/comments/{c['id']}", json={"content": "y"}).status_code == 404


# ── Video ───────────────────────────────────────────────────────────────────

class TestProjectVideos:
    def test_crud_permissions(self, member, member2, admin, projects):
        p = new_project(member, projects)
        base = f"/studio/projects/{p['id']}/videos"
        r = member.post(base, json={"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Sala", "recorded_on": TODAY, "note": "n"})
        assert r.status_code == 201, r.text
        v = r.json()
        assert v["project_id"] == p["id"] and v["cover_thumb"].startswith("https://img.youtube.com/")
        assert [x["id"] for x in member2.get(base).json()] == [v["id"]]
        assert member.post(base, json={"url": "ftp://x", "title": "x", "recorded_on": TODAY}).status_code == 400
        # modifica ed eliminazione solo di chi l'ha inserito (nemmeno l'admin)
        assert member.put(f"{base}/{v['id']}", json={"title": "Nuovo"}).json()["title"] == "Nuovo"
        for other in (member2, admin):
            assert other.put(f"{base}/{v['id']}", json={"title": "Hack"}).status_code == 403
            assert other.delete(f"{base}/{v['id']}").status_code == 403
        assert member.delete(f"{base}/{v['id']}").status_code == 204
        assert member.get(base).json() == []


# ── Promozione e eliminazione ───────────────────────────────────────────────

class TestProjectLifecycle:
    def test_promote_copies_lyrics(self, member, projects, made):
        p = new_project(member, projects)
        member.put(f"/studio/projects/{p['id']}/lyrics", json={"lyrics": LYRICS})
        assert member.put(f"/studio/projects/{p['id']}/status", json={"status": "pronto"}).status_code == 200
        r = member.post(f"/studio/projects/{p['id']}/promote", json={"title": uniq("Inedito"), "artist": "La Band", "category": "proposta"})
        assert r.status_code == 201, r.text
        made["songs"].append(r.json()["song_id"])
        s = member.get(f"/songs/{r.json()['song_id']}").json()
        assert s["lyrics"] == LYRICS and s["lyrics_source"] == "manual"

    def test_promote_without_lyrics_leaves_song_without(self, member, projects, made):
        p = new_project(member, projects)
        member.put(f"/studio/projects/{p['id']}/status", json={"status": "pronto"})
        r = member.post(f"/studio/projects/{p['id']}/promote", json={"title": uniq("Inedito"), "artist": "La Band", "category": "proposta"})
        made["songs"].append(r.json()["song_id"])
        s = member.get(f"/songs/{r.json()['song_id']}").json()
        assert not s["lyrics"] and s["lyrics_source"] is None

    def test_delete_project_removes_comments_and_videos(self, member, admin, projects):
        p = new_project(member, projects)
        member.post(f"/studio/projects/{p['id']}/comments", json={"content": "c"})
        member.post(f"/studio/projects/{p['id']}/videos", json={"url": "https://youtu.be/dQw4w9WgXcQ", "title": "v", "recorded_on": TODAY})
        assert member.delete(f"/studio/projects/{p['id']}").status_code == 204
        assert member.get(f"/studio/projects/{p['id']}").status_code == 404
        assert member.get(f"/studio/projects/{p['id']}/comments").status_code == 404
        assert member.get(f"/studio/projects/{p['id']}/videos").status_code == 404


# ── Spostamento di un brano in Prove ────────────────────────────────────────

class TestMoveSong:
    def test_requires_auth_and_exists(self, anon, member):
        assert anon.post("/songs/1/to-studio").status_code == 401
        assert member.post("/songs/99999999/to-studio").status_code == 404

    def test_only_proposer_or_admin(self, member, member2, song, projects):
        sid = song["id"]
        assert member2.post(f"/songs/{sid}/to-studio").status_code == 403
        assert member.get(f"/songs/{sid}").status_code == 200       # nulla e' cambiato

    def test_moves_everything(self, member, member2, song, projects):
        sid = song["id"]
        member.put(f"/songs/{sid}/lyrics", json={"lyrics": LYRICS})
        c1 = member.post(f"/songs/{sid}/comments", json={"content": "Da rifare il ritornello"}).json()
        member2.post(f"/songs/{sid}/comments", json={"content": "Io lo farei piu' lento", "parent_id": c1["id"]})
        member2.post(f"/songs/{sid}/comments", json={"content": "Bel pezzo"})
        song_video(member2, sid)
        song_audio(member2, sid)
        member.post(f"/songs/{sid}/likes")

        r = move(member, sid, projects)
        assert r.status_code == 200, r.text
        pid = r.json()["project_id"]

        # il brano non c'e' piu', con i suoi like e il suo materiale
        assert member.get(f"/songs/{sid}").status_code == 404
        assert member.get(f"/songs/{sid}/comments").status_code == 404

        p = member.get(f"/studio/projects/{pid}").json()
        assert p["title"] == song["title"] and p["status"] == "idea" and p["song_id"] is None
        assert p["created_by_id"] == member.user["id"] and p["lyrics"] == LYRICS

        comments = member.get(f"/studio/projects/{pid}/comments").json()
        assert len(comments) == 3
        top = [c for c in comments if c["parent_id"] is None]
        reply = [c for c in comments if c["parent_id"] is not None]
        assert {c["content"] for c in top} == {"Da rifare il ritornello", "Bel pezzo"}
        assert len(reply) == 1 and reply[0]["username"] == member2.user["username"]
        assert reply[0]["parent_id"] == [c for c in top if c["content"] == "Da rifare il ritornello"][0]["id"]

        videos = member.get(f"/studio/projects/{pid}/videos").json()
        assert len(videos) == 1 and videos[0]["title"] == "GoPro sala" and videos[0]["user_id"] == member2.user["id"]

        assert len(p["takes"]) == 1
        t = p["takes"][0]
        assert t["kind"] == "audio" and t["title"] == "Take cover" and t["user_id"] == member2.user["id"]
        assert t["description"] == "Registrato il 07/03/2026\ndal telefono"
        # il file e' lo stesso e si ascolta dal link della take
        full = member.get(f"/studio/takes/{t['id']}").json()
        f = httpx.get(full["file_url"], timeout=60)
        assert f.status_code == 200 and f.content == M4A

    def test_analysis_is_saved_once_by_anyone(self, member, member2, song, projects):
        song_audio(member, song["id"])
        pid = move(member, song["id"], projects).json()["project_id"]
        tid = member.get(f"/studio/projects/{pid}").json()["takes"][0]["id"]
        assert member.get(f"/studio/takes/{tid}").json()["has_peaks"] is False
        peaks = [0, 10, 255, 40]
        r = member2.put(f"/studio/takes/{tid}/analysis", json={"peaks": peaks, "duration_ms": 4000})
        assert r.status_code == 200, r.text
        got = member.get(f"/studio/takes/{tid}").json()
        assert got["has_peaks"] is True and got["peaks"] == peaks and got["duration_ms"] == 4000
        # una tantum: un secondo invio non sovrascrive
        member.put(f"/studio/takes/{tid}/analysis", json={"peaks": [1, 2, 3], "duration_ms": 9})
        again = member.get(f"/studio/takes/{tid}").json()
        assert again["peaks"] == peaks and again["duration_ms"] == 4000

    def test_analysis_validation(self, member, song, projects):
        song_audio(member, song["id"])
        pid = move(member, song["id"], projects).json()["project_id"]
        tid = member.get(f"/studio/projects/{pid}").json()["takes"][0]["id"]
        assert member.put(f"/studio/takes/{tid}/analysis", json={"peaks": [999]}).status_code == 400
        assert member.put(f"/studio/takes/{tid}/analysis", json={"peaks": "x"}).status_code == 400
        assert member.put(f"/studio/takes/{tid}/analysis", json={"duration_ms": 0}).status_code == 400
        assert member.put("/studio/takes/99999999/analysis", json={"peaks": [1]}).status_code == 404

    def test_admin_moves_and_proposer_keeps_ownership(self, admin, member, song, projects):
        r = move(admin, song["id"], projects)
        assert r.status_code == 200, r.text
        p = member.get(f"/studio/projects/{r.json()['project_id']}").json()
        assert p["created_by_id"] == member.user["id"]
        # il proposer puo' gestire il suo brano di prova
        assert member.put(f"/studio/projects/{p['id']}", json={"title": uniq("Rinominato")}).status_code == 200

    def test_song_without_extras(self, member, song, projects):
        r = move(member, song["id"], projects)
        assert r.status_code == 200
        p = member.get(f"/studio/projects/{r.json()['project_id']}").json()
        assert p["lyrics"] is None and p["takes"] == []
        assert member.get(f"/studio/projects/{p['id']}/comments").json() == []

    def test_moving_twice_is_404(self, member, song, projects):
        assert move(member, song["id"], projects).status_code == 200
        assert member.post(f"/songs/{song['id']}/to-studio").status_code == 404


class TestMovePromoted:
    def test_goes_back_to_original_project(self, member, member2, projects, made):
        p = new_project(member, projects)
        old_take = None
        r = member.post(
            f"/studio/projects/{p['id']}/takes", data={"kind": "audio", "title": "Riff"},
            files={"file": ("riff.m4a", M4A, "application/octet-stream")},
        )
        assert r.status_code == 201, r.text
        old_take = r.json()["id"]
        member.put(f"/studio/projects/{p['id']}/lyrics", json={"lyrics": "vecchio testo"})
        member.put(f"/studio/projects/{p['id']}/status", json={"status": "pronto"})
        pr = member.post(f"/studio/projects/{p['id']}/promote", json={"title": uniq("Inedito"), "artist": "La Band", "category": "da_provare"})
        assert pr.status_code == 201, pr.text
        sid = pr.json()["song_id"]
        made["songs"].append(sid)
        member.put(f"/songs/{sid}/lyrics", json={"lyrics": LYRICS})
        member2.post(f"/songs/{sid}/comments", json={"content": "Dopo la promozione"})
        song_audio(member2, sid)

        r = move(member, sid, projects)
        assert r.status_code == 200, r.text
        assert r.json()["project_id"] == p["id"]               # nessun progetto nuovo
        got = member.get(f"/studio/projects/{p['id']}").json()
        assert got["status"] == "idea" and got["song_id"] is None and got["lyrics"] == LYRICS
        assert old_take in [t["id"] for t in got["takes"]] and len(got["takes"]) == 2
        assert [c["content"] for c in member.get(f"/studio/projects/{p['id']}/comments").json()] == ["Dopo la promozione"]
        assert member.get(f"/songs/{sid}").status_code == 404

    def test_empty_song_lyrics_keep_project_lyrics(self, member, projects, made):
        p = new_project(member, projects)
        member.put(f"/studio/projects/{p['id']}/lyrics", json={"lyrics": "testo del progetto"})
        member.put(f"/studio/projects/{p['id']}/status", json={"status": "pronto"})
        sid = member.post(f"/studio/projects/{p['id']}/promote", json={"title": uniq("Inedito"), "artist": "B", "category": "proposta"}).json()["song_id"]
        made["songs"].append(sid)
        member.put(f"/songs/{sid}/lyrics", json={"lyrics": ""})
        assert move(member, sid, projects).status_code == 200
        assert member.get(f"/studio/projects/{p['id']}").json()["lyrics"] == "testo del progetto"
