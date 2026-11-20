"""Sala prove: brani di prova, contenuti, marker, commenti, promozione (spec rehearsal-studio)."""
import json
import os
import time

import httpx
import pytest

from conftest import uniq

MP4 = b"\x00\x00\x00\x18ftypisom" + bytes(range(256)) * 8     # contenuto fittizio ma non vuoto
M4A = b"\x00\x00\x00\x18ftypM4A " + bytes(range(256)) * 8
TODAY = time.strftime("%Y-%m-%d")


@pytest.fixture()
def studio(admin, made):
    """Registro dei brani di prova creati dal test, eliminati a fine test (anche se promossi)."""
    created = []
    yield created
    for owner, pid in created:
        pr = admin.get(f"/studio/projects/{pid}")
        if pr.status_code != 200:
            continue
        sid = pr.json()["song_id"]
        if sid:
            admin.delete(f"/songs/{sid}")
        admin.delete(f"/studio/projects/{pid}")


def new_project(api, studio, **over):
    body = {"title": uniq("Idea"), "description": "Riff in Mi"}
    body.update(over)
    r = api.post("/studio/projects", json=body)
    assert r.status_code == 201, r.text
    studio.append((api, r.json()["id"]))
    return r.json()


def upload_take(api, pid, name="riff.m4a", content=M4A, kind="audio", **fields):
    data = {"kind": kind, "title": "Take 1"}
    data.update(fields)
    return api.post(f"/studio/projects/{pid}/takes", data=data, files={"file": (name, content, "application/octet-stream")})


def new_take(api, pid, **kw):
    r = upload_take(api, pid, **kw)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture()
def project(member, studio):
    return new_project(member, studio)


# ── Brani di prova ──────────────────────────────────────────────────────────

class TestProjects:
    def test_requires_auth(self, anon):
        assert anon.get("/studio/projects").status_code == 401
        assert anon.post("/studio/projects", json={"title": "x"}).status_code == 401

    def test_create_get_list(self, member, member2, studio):
        p = new_project(member, studio, bpm=96, music_key="Em")
        assert p["status"] == "idea" and p["bpm"] == 96 and p["music_key"] == "Em"
        assert p["created_by"] == member.user["username"] and p["take_count"] == 0 and p["song_id"] is None
        got = member2.get(f"/studio/projects/{p['id']}").json()      # tutti vedono tutto
        assert got["title"] == p["title"] and got["takes"] == []
        assert p["id"] in [x["id"] for x in member2.get("/studio/projects").json()]

    @pytest.mark.parametrize("over", [
        {"title": "   "}, {"title": "x" * 151}, {"bpm": 10}, {"bpm": 400},
        {"description": "x" * 2001}, {"music_key": "x" * 21},
    ])
    def test_validation_400(self, member, over):
        body = {"title": uniq("Idea")}
        body.update(over)
        assert member.post("/studio/projects", json=body).status_code == 400

    def test_validation_types_and_missing(self, member):
        assert member.post("/studio/projects", json={"description": "senza titolo"}).status_code == 400
        assert member.post("/studio/projects", json={"title": "x", "bpm": "veloce"}).status_code == 422

    def test_unknown_404(self, member):
        assert member.get("/studio/projects/999999").status_code == 404
        assert member.get("/studio/takes/999999").status_code == 404

    def test_list_hides_archived_and_filters(self, member, studio):
        p = new_project(member, studio)
        assert member.put(f"/studio/projects/{p['id']}/status", json={"status": "archiviato"}).status_code == 200
        assert p["id"] not in [x["id"] for x in member.get("/studio/projects").json()]
        arch = member.get("/studio/projects?status=archiviato").json()
        assert p["id"] in [x["id"] for x in arch] and all(x["status"] == "archiviato" for x in arch)
        both = member.get("/studio/projects?status=idea,archiviato").json()
        assert p["id"] in [x["id"] for x in both]

    def test_update_permissions(self, member, member2, admin, project):
        url = f"/studio/projects/{project['id']}"
        assert member2.put(url, json={"title": "Rubato"}).status_code == 403
        r = member.put(url, json={"title": "Nuovo titolo", "bpm": 120, "music_key": "A"})
        assert r.status_code == 200 and r.json()["title"] == "Nuovo titolo" and r.json()["bpm"] == 120
        assert admin.put(url, json={"description": "Dall'admin"}).json()["description"] == "Dall'admin"
        cleared = member.put(url, json={"bpm": None, "music_key": None, "description": None}).json()
        assert cleared["bpm"] is None and cleared["music_key"] is None and cleared["description"] is None
        assert cleared["title"] == "Nuovo titolo"
        assert member.put(url, json={"title": ""}).status_code == 400

    def test_status_rules(self, member, member2, admin, project):
        url = f"/studio/projects/{project['id']}/status"
        for st in ("lavorazione", "pronto", "archiviato", "idea"):
            assert member.put(url, json={"status": st}).json()["status"] == st
        assert member.put(url, json={"status": "inventato"}).status_code == 400
        assert member.put(url, json={"status": "promosso"}).status_code == 400    # solo con la promozione
        assert member2.put(url, json={"status": "pronto"}).status_code == 403
        assert admin.put(url, json={"status": "pronto"}).json()["status"] == "pronto"

    def test_usage(self, member, project):
        before = member.get("/studio/usage").json()
        new_take(member, project["id"])
        after = member.get("/studio/usage").json()
        assert after["count"] == before["count"] + 1 and after["bytes"] == before["bytes"] + len(M4A)


# ── Contenuti ───────────────────────────────────────────────────────────────

class TestTakes:
    def test_upload_audio_and_video(self, member, project):
        a = new_take(member, project["id"], title="Chitarra", description="Riff base")
        assert a["kind"] == "audio" and a["mime"] == "audio/mp4" and a["size"] == len(M4A)
        assert a["username"] == member.user["username"] and a["description"] == "Riff base"
        assert a["trim_start_ms"] is None and a["base_take_id"] is None and a["recorded_in_app"] is False
        v = new_take(member, project["id"], name="clip.mp4", content=MP4, kind="video", title="Video")
        assert v["kind"] == "video" and v["mime"] == "video/mp4"
        pr = member.get(f"/studio/projects/{project['id']}").json()
        assert [t["title"] for t in pr["takes"]] == ["Chitarra", "Video"] and pr["take_count"] == 2
        assert all("peaks" not in t for t in pr["takes"])

    def test_recorded_in_app_flag(self, member, project):
        t = new_take(member, project["id"], name="rec.webm", kind="audio", recorded_in_app="1")
        assert t["recorded_in_app"] is True and t["mime"] == "audio/webm"
        v = new_take(member, project["id"], name="rec.webm", kind="video")
        assert v["mime"] == "video/webm"

    @pytest.mark.parametrize("name,kind", [
        ("virus.exe", "audio"), ("shell.php", "audio"), ("noext", "audio"),
        ("canzone.mp3", "video"), ("film.mov", "audio"), ("film.avi", "video"), ("x.m4a", "altro"),
    ])
    def test_format_rejected(self, member, project, name, kind):
        assert upload_take(member, project["id"], name=name, kind=kind).status_code == 400

    def test_missing_and_invalid_fields(self, member, project):
        pid = project["id"]
        assert member.post(f"/studio/projects/{pid}/takes", data={"kind": "audio", "title": "x"}).status_code == 422
        assert upload_take(member, pid, title="  ").status_code == 400
        assert upload_take(member, pid, content=b"").status_code == 400
        assert upload_take(member, pid, title="x" * 151).status_code == 400
        assert upload_take(member, pid, duration_ms="abc").status_code == 422
        assert member.get(f"/studio/projects/{pid}").json()["takes"] == []

    @pytest.mark.skipif(not os.environ.get("RUN_BIG_UPLOAD"), reason="invia >128 MB: RUN_BIG_UPLOAD=1 per abilitare")
    def test_over_limit_413(self, member, project):
        limit = member.get("/config").json()["max_upload_bytes"]
        assert upload_take(member, project["id"], content=b"0" * (limit + 1024)).status_code == 413

    def test_file_stream_and_range(self, member, project):
        t = new_take(member, project["id"])
        f = httpx.get(t["file_url"], timeout=60)                      # senza Authorization: vale la firma
        assert f.status_code == 200 and f.content == M4A and f.headers["content-type"].startswith("audio/mp4")
        part = httpx.get(t["file_url"], headers={"Range": "bytes=0-9"}, timeout=60)
        assert part.status_code == 206 and part.content == M4A[:10]
        assert part.headers["content-range"] == f"bytes 0-9/{len(M4A)}"
        assert httpx.get(t["file_url"], headers={"Range": f"bytes={len(M4A) + 50}-"}, timeout=60).status_code == 416
        dl = httpx.get(t["file_url"] + "&dl=1", timeout=60)
        assert dl.headers["content-disposition"].startswith("attachment")

    def test_video_served_as_video(self, member, project):
        v = new_take(member, project["id"], name="clip.mp4", content=MP4, kind="video")
        f = httpx.get(v["file_url"], timeout=60)
        assert f.status_code == 200 and f.content == MP4 and f.headers["content-type"] == "video/mp4"

    def test_signature_checks(self, member, song, project):
        t = new_take(member, project["id"])
        base, qs = t["file_url"].split("?")
        assert httpx.get(base, timeout=60).status_code == 403
        assert httpx.get(t["file_url"][:-2] + "xx", timeout=60).status_code == 403
        e, s = [p.split("=")[1] for p in qs.split("&")[:2]]
        assert httpx.get(f"{base}?e={int(e) - 10 ** 6}&s={s}", timeout=60).status_code == 403
        # il token di un altro contenuto non vale
        t2 = new_take(member, project["id"], title="Take 2")
        assert httpx.get(f"{t2['file_url'].split('?')[0]}?{qs}", timeout=60).status_code == 403
        # il token di un audio delle prove (rehearsal-media) non apre un contenuto della Sala prove
        a = member.post(f"/songs/{song['id']}/audios", data={"title": "a", "recorded_on": TODAY},
                        files={"file": ("a.m4a", M4A, "application/octet-stream")}).json()
        aq = a["file_url"].split("?")[1]
        assert httpx.get(f"{base}?{aq}", timeout=60).status_code == 403

    def test_peaks(self, member, project):
        good = new_take(member, project["id"], peaks=json.dumps([0, 10, 255, 128]))
        assert good["has_peaks"] is True
        assert member.get(f"/studio/takes/{good['id']}").json()["peaks"] == [0, 10, 255, 128]
        for bad in ("[1,2,999]", "non json", '{"a":1}', "[]", json.dumps([1] * 16001), '["x"]'):
            t = new_take(member, project["id"], peaks=bad)            # forma d'onda scartata, upload riuscito
            assert t["has_peaks"] is False
            assert member.get(f"/studio/takes/{t['id']}").json()["peaks"] is None

    def test_trim_on_upload(self, member, project):
        t = new_take(member, project["id"], duration_ms="30000", trim_start_ms="4000", trim_end_ms="21500")
        assert (t["duration_ms"], t["trim_start_ms"], t["trim_end_ms"]) == (30000, 4000, 21500)
        pid = project["id"]
        assert upload_take(member, pid, trim_start_ms="1000").status_code == 422             # ne manca uno
        assert upload_take(member, pid, trim_start_ms="1000", trim_end_ms="1100").status_code == 422   # < 200 ms
        assert upload_take(member, pid, duration_ms="5000", trim_start_ms="0", trim_end_ms="9000").status_code == 422

    def test_update_and_trim(self, member, member2, admin, project):
        t = new_take(member, project["id"], duration_ms="30000")
        url = f"/studio/takes/{t['id']}"
        r = member.put(url, json={"title": "Rinominato", "description": "Nota", "trim_start_ms": 2000, "trim_end_ms": 25000})
        assert r.status_code == 200
        d = r.json()
        assert (d["title"], d["description"], d["trim_start_ms"], d["trim_end_ms"]) == ("Rinominato", "Nota", 2000, 25000)
        assert member.put(url, json={"trim_start_ms": 1000}).status_code == 422
        assert member.put(url, json={"trim_start_ms": 5000, "trim_end_ms": 5100}).status_code == 422
        assert member.put(url, json={"trim_start_ms": 0, "trim_end_ms": 99000}).status_code == 422
        assert member.put(url, json={"trim_start_ms": -5, "trim_end_ms": 9000}).status_code == 422
        assert member.put(url, json={"title": "  "}).status_code == 400
        cleared = member.put(url, json={"trim_start_ms": None, "trim_end_ms": None}).json()
        assert cleared["trim_start_ms"] is None and cleared["trim_end_ms"] is None and cleared["title"] == "Rinominato"
        assert member.put(url, json={"offset_ms": 10}).status_code == 422                    # non e' una sovraincisione
        assert member2.put(url, json={"title": "Rubato"}).status_code == 403
        assert admin.put(url, json={"title": "Admin"}).status_code == 403                    # nemmeno l'admin
        assert member2.delete(url).status_code == 403 and admin.delete(url).status_code == 403
        assert member.get(url).json()["title"] == "Rinominato"

    def test_delete_removes_file(self, member, project):
        t = new_take(member, project["id"])
        assert member.delete(f"/studio/takes/{t['id']}").status_code == 204
        assert member.get(f"/studio/takes/{t['id']}").status_code == 404
        assert httpx.get(t["file_url"], timeout=60).status_code == 404

    def test_overdub(self, member, member2, studio, project):
        pid = project["id"]
        base = new_take(member, pid, title="Base")
        other = new_project(member, studio)
        foreign = new_take(member, other["id"], title="Altrove")
        sync = {"sync_ms": "850", "base_start_ms": "4000", "base_loop_start_ms": "4000", "base_loop_end_ms": "9000"}
        assert upload_take(member2, pid, base_take_id=str(foreign["id"]), **sync).status_code == 422   # altro progetto
        assert upload_take(member2, pid, base_take_id="999999").status_code == 422
        assert upload_take(member2, pid, offset_ms="40").status_code == 422                            # senza base
        assert upload_take(member2, pid, sync_ms="100").status_code == 422
        assert upload_take(member2, pid, base_take_id=str(base["id"]), offset_ms="5000").status_code == 422
        assert upload_take(member2, pid, base_take_id=str(base["id"]), base_loop_start_ms="1000").status_code == 422
        over = new_take(member2, pid, title="Basso", base_take_id=str(base["id"]), offset_ms="40", **sync)
        assert over["base_take_id"] == base["id"] and over["offset_ms"] == 40
        assert (over["sync_ms"], over["base_start_ms"]) == (850, 4000)
        assert (over["base_loop_start_ms"], over["base_loop_end_ms"]) == (4000, 9000)
        full = member.get(f"/studio/takes/{over['id']}").json()
        assert full["base"]["id"] == base["id"] and full["base"]["file_url"] and full["base"]["title"] == "Base"
        assert member2.put(f"/studio/takes/{over['id']}", json={"offset_ms": -120}).json()["offset_ms"] == -120
        assert member2.put(f"/studio/takes/{over['id']}", json={"offset_ms": 2500}).status_code == 422
        # eliminando la base la sovraincisione resta, come contenuto normale
        assert member.delete(f"/studio/takes/{base['id']}").status_code == 204
        left = member.get(f"/studio/takes/{over['id']}").json()
        assert left["base_take_id"] is None and left["offset_ms"] is None and left["sync_ms"] is None and left["base"] is None


# ── Marker ──────────────────────────────────────────────────────────────────

class TestMarkers:
    def test_crud_and_order(self, member, member2, project):
        t = new_take(member, project["id"], duration_ms="60000")
        url = f"/studio/takes/{t['id']}/markers"
        late = member2.post(url, json={"time_ms": 45200, "label": "Nota errata"})
        early = member.post(url, json={"time_ms": 1500, "label": "Entra il basso"})
        assert late.status_code == 201 and early.status_code == 201, late.text + early.text
        assert late.json()["username"] == member2.user["username"]
        listed = member.get(url).json()
        assert [m["time_ms"] for m in listed] == [1500, 45200]
        assert member.get(f"/studio/takes/{t['id']}").json()["marker_count"] == 2
        mid = late.json()["id"]
        r = member2.put(f"{url}/{mid}", json={"label": "Fa# invece di Fa", "time_ms": 45000})
        assert r.status_code == 200 and r.json()["label"] == "Fa# invece di Fa" and r.json()["time_ms"] == 45000
        assert member2.delete(f"{url}/{mid}").status_code == 204
        assert len(member.get(url).json()) == 1

    @pytest.mark.parametrize("body", [
        {"time_ms": -1, "label": "x"}, {"time_ms": 70000, "label": "oltre la durata"},
        {"time_ms": 1000, "label": "  "}, {"time_ms": 1000, "label": "x" * 81},
        {"time_ms": 1000}, {"label": "senza tempo"}, {"time_ms": "1000", "label": "tipo"},
    ])
    def test_validation(self, member, project, body):
        t = new_take(member, project["id"], duration_ms="60000")
        assert member.post(f"/studio/takes/{t['id']}/markers", json=body).status_code in (400, 422)
        assert member.get(f"/studio/takes/{t['id']}/markers").json() == []

    def test_only_author_edits(self, member, member2, admin, project):
        t = new_take(member, project["id"])
        url = f"/studio/takes/{t['id']}/markers"
        mid = member.post(url, json={"time_ms": 100, "label": "mio"}).json()["id"]
        for other in (member2, admin):
            assert other.put(f"{url}/{mid}", json={"label": "rubato"}).status_code == 403
            assert other.delete(f"{url}/{mid}").status_code == 403
        assert member.get(url).json()[0]["label"] == "mio"
        assert member.put(f"{url}/999999", json={"label": "x"}).status_code == 404

    def test_marker_of_other_take_not_reachable(self, member, project):
        a = new_take(member, project["id"])
        b = new_take(member, project["id"], title="Altro")
        mid = member.post(f"/studio/takes/{a['id']}/markers", json={"time_ms": 100, "label": "x"}).json()["id"]
        assert member.delete(f"/studio/takes/{b['id']}/markers/{mid}").status_code == 404


# ── Commenti ────────────────────────────────────────────────────────────────

class TestComments:
    def test_crud_and_refs_kept(self, member, member2, project):
        t = new_take(member, project["id"])
        mid = member2.post(f"/studio/takes/{t['id']}/markers", json={"time_ms": 700, "label": "nota"}).json()["id"]
        url = f"/studio/takes/{t['id']}/comments"
        text = f"Guarda [[m:{mid}]] e anche [[t:45200]]"
        c1 = member.post(url, json={"content": text})
        c2 = member2.post(url, json={"content": "Ok, corretto"})
        assert c1.status_code == 201 and c2.status_code == 201
        listed = member.get(url).json()
        assert [c["content"] for c in listed] == [text, "Ok, corretto"]           # citazioni invariate, ordine cronologico
        assert listed[0]["username"] == member.user["username"]
        assert member.get(f"/studio/takes/{t['id']}").json()["comment_count"] == 2
        cid = c1.json()["id"]
        assert member.put(f"{url}/{cid}", json={"content": "Modificato"}).json()["content"] == "Modificato"
        assert member.delete(f"{url}/{cid}").status_code == 204
        assert len(member.get(url).json()) == 1

    @pytest.mark.parametrize("content", ["   ", "x" * 2001])
    def test_validation(self, member, project, content):
        t = new_take(member, project["id"])
        assert member.post(f"/studio/takes/{t['id']}/comments", json={"content": content}).status_code == 400
        assert member.post(f"/studio/takes/{t['id']}/comments", json={}).status_code == 422

    def test_only_author_edits(self, member, member2, admin, project):
        t = new_take(member, project["id"])
        url = f"/studio/takes/{t['id']}/comments"
        cid = member.post(url, json={"content": "mio"}).json()["id"]
        for other in (member2, admin):
            assert other.put(f"{url}/{cid}", json={"content": "rubato"}).status_code == 403
            assert other.delete(f"{url}/{cid}").status_code == 403
        assert member.get(url).json()[0]["content"] == "mio"


# ── Promozione ──────────────────────────────────────────────────────────────

class TestPromotion:
    def promote(self, api, pid, **over):
        body = {"title": uniq("Definitivo"), "artist": "La Mia Band", "category": "da_provare"}
        body.update(over)
        return api.post(f"/studio/projects/{pid}/promote", json=body)

    def test_full_cycle(self, member, member2, admin, made, project):
        pid = project["id"]
        new_take(member, pid)
        assert self.promote(member, pid).status_code == 409                       # non e' "Pronto"
        member.put(f"/studio/projects/{pid}/status", json={"status": "pronto"})
        assert self.promote(member2, pid).status_code == 403                      # non e' il creatore
        assert self.promote(member, pid, category="boh").status_code == 400
        assert self.promote(member, pid, title="  ").status_code == 400
        assert self.promote(member, pid, artist="").status_code == 400

        title = uniq("Definitivo")
        r = self.promote(member, pid, title=title, category="in_scaletta")
        assert r.status_code == 201, r.text
        sid = r.json()["song_id"]
        made["songs"].append(sid)

        s = member2.get(f"/songs/{sid}").json()
        assert s["title"] == title and s["artist"] == "La Mia Band" and s["category"] == "in_scaletta"
        assert s["unverified"] is True and s["studio_project_id"] == pid and s["validation_error"] is None
        assert sid in [x["id"] for x in member.get("/songs?category=in_scaletta").json()]
        pr = member.get(f"/studio/projects/{pid}").json()
        assert pr["status"] == "promosso" and pr["song_id"] == sid and pr["take_count"] == 1   # i contenuti restano

        assert self.promote(member, pid).status_code == 409                       # gia' promosso
        assert member.put(f"/studio/projects/{pid}/status", json={"status": "idea"}).status_code == 409
        assert member.delete(f"/studio/projects/{pid}").status_code == 409        # il brano esiste ancora

        # eliminando il brano dalla lista il progetto torna "Pronto"
        assert admin.delete(f"/songs/{sid}").status_code == 204
        back = member.get(f"/studio/projects/{pid}").json()
        assert back["status"] == "pronto" and back["song_id"] is None and back["take_count"] == 1
        assert member.delete(f"/studio/projects/{pid}").status_code == 204

    def test_duplicate_blocked(self, member, made, studio):
        a = new_project(member, studio)
        b = new_project(member, studio)
        for p in (a, b):
            member.put(f"/studio/projects/{p['id']}/status", json={"status": "pronto"})
        title = uniq("Doppione")
        first = self.promote(member, a["id"], title=title)
        assert first.status_code == 201
        made["songs"].append(first.json()["song_id"])
        dup = self.promote(member, b["id"], title=f"  {title.upper()} ", artist=" la mia  band ")
        assert dup.status_code == 409 and "esiste già" in dup.json()["detail"]
        assert member.get(f"/studio/projects/{b['id']}").json()["status"] == "pronto"   # nessuna modifica

    def test_admin_can_promote(self, member, admin, made, project):
        member.put(f"/studio/projects/{project['id']}/status", json={"status": "pronto"})
        r = self.promote(admin, project["id"])
        assert r.status_code == 201
        made["songs"].append(r.json()["song_id"])

    def test_normal_song_has_no_project(self, song):
        assert song.get("studio_project_id") is None


# ── Cancellazione a cascata, attività, impostazioni ─────────────────────────

class TestCascadeAndSettings:
    def test_delete_project_cascade(self, member, member2, admin, studio):
        p = new_project(member, studio)
        pid = p["id"]
        t = new_take(member, pid)
        member2.post(f"/studio/takes/{t['id']}/markers", json={"time_ms": 100, "label": "m"})
        member2.post(f"/studio/takes/{t['id']}/comments", json={"content": "c"})
        assert member2.delete(f"/studio/projects/{pid}").status_code == 403        # solo creatore o admin
        assert admin.delete(f"/studio/projects/{pid}").status_code == 204          # l'admin puo'
        assert member.get(f"/studio/projects/{pid}").status_code == 404
        assert member.get(f"/studio/takes/{t['id']}").status_code == 404
        assert member.get(f"/studio/takes/{t['id']}/markers").status_code == 404
        assert httpx.get(t["file_url"], timeout=60).status_code == 404

    def test_activity_updates_order(self, member, member2, studio):
        a = new_project(member, studio)
        b = new_project(member, studio)
        ids = [x["id"] for x in member.get("/studio/projects").json()]
        assert ids.index(b["id"]) < ids.index(a["id"])                              # b e' piu' recente
        t = new_take(member, a["id"])
        member2.post(f"/studio/takes/{t['id']}/comments", json={"content": "ciao"})
        ids = [x["id"] for x in member.get("/studio/projects").json()]
        assert ids.index(a["id"]) < ids.index(b["id"])                              # l'attivita' porta a in cima

    def test_band_name_setting(self, member, admin):
        try:
            assert admin.put("/admin/settings", json={"key": "band_name", "value": "  I Test  "}).status_code == 200
            assert member.get("/config").json()["band_name"] == "I Test"
            row = [s for s in admin.get("/admin/settings").json() if s["key"] == "band_name"][0]
            assert row["value"] == "I Test"                                         # non segreta: in chiaro
            secret = [s for s in admin.get("/admin/settings").json() if s["key"] == "groq_api_key"]
            assert all("value" not in s for s in secret)                            # le chiavi restano mascherate
        finally:
            admin.put("/admin/settings", json={"key": "band_name", "value": ""})
