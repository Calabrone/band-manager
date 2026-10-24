"""Video e audio delle prove nella scheda brano (spec rehearsal-media)."""
import os
from datetime import date, timedelta

import httpx
import pytest

TODAY = date.today().isoformat()
AUDIO = b"\x00\x00\x00\x18ftypM4A " + bytes(range(256)) * 8   # contenuto fittizio ma non vuoto


def video_body(**over):
    body = {"url": "https://gopro.com/v/abc123", "title": "Prova generale", "recorded_on": TODAY, "note": "Versione lenta"}
    body.update(over)
    return body


def upload(api, song_id, name="prova.m4a", content=AUDIO, **fields):
    data = {"title": "Take 1", "recorded_on": TODAY, "note": "ok"}
    data.update(fields)
    return api.post(f"/songs/{song_id}/audios", data=data, files={"file": (name, content, "application/octet-stream")})


# ── Video ───────────────────────────────────────────────────────────────────

class TestVideos:
    def test_create_list_order(self, member, song):
        sid = song["id"]
        old = member.post(f"/songs/{sid}/videos", json=video_body(title="Vecchio", recorded_on="2024-01-10"))
        new = member.post(f"/songs/{sid}/videos", json=video_body(title="Nuovo", recorded_on="2024-03-05"))
        assert old.status_code == 201 and new.status_code == 201, old.text + new.text
        v = new.json()
        assert v["user_id"] == member.user["id"] and v["username"] == member.user["username"]
        assert v["note"] == "Versione lenta" and v["thumb_url"] is None
        titles = [x["title"] for x in member.get(f"/songs/{sid}/videos").json()]
        assert titles == ["Nuovo", "Vecchio"]

    def test_thumb_only_https(self, member, song):
        ok = member.post(f"/songs/{song['id']}/videos", json=video_body(thumb_url="https://cdn.example.com/a.jpg"))
        bad = member.post(f"/songs/{song['id']}/videos", json=video_body(thumb_url="http://cdn.example.com/a.jpg"))
        assert ok.json()["thumb_url"] == "https://cdn.example.com/a.jpg"
        assert bad.status_code == 201 and bad.json()["thumb_url"] is None

    @pytest.mark.parametrize("over", [
        {"url": "ftp://example.com/x"},
        {"url": "javascript:alert(1)"},
        {"url": "non un link"},
        {"title": "   "},
        {"title": "x" * 151},
        {"recorded_on": "2024-13-45"},
        {"recorded_on": "10/01/2024"},
        {"recorded_on": (date.today() + timedelta(days=5)).isoformat()},
        {"note": "x" * 1001},
    ])
    def test_validation(self, member, song, over):
        assert member.post(f"/songs/{song['id']}/videos", json=video_body(**over)).status_code == 400

    def test_missing_fields_422(self, member, song):
        assert member.post(f"/songs/{song['id']}/videos", json={"url": "https://x.it"}).status_code == 422

    def test_unknown_song_404(self, member):
        assert member.get("/songs/999999/videos").status_code == 404
        assert member.post("/songs/999999/videos", json=video_body()).status_code == 404

    def test_owner_can_edit_and_delete(self, member, song):
        sid = song["id"]
        vid = member.post(f"/songs/{sid}/videos", json=video_body()).json()["id"]
        r = member.put(f"/songs/{sid}/videos/{vid}", json={"title": "Rinominato", "note": ""})
        assert r.status_code == 200
        assert r.json()["title"] == "Rinominato" and r.json()["note"] is None
        assert r.json()["url"] == "https://gopro.com/v/abc123"
        assert member.delete(f"/songs/{sid}/videos/{vid}").status_code == 204
        assert member.get(f"/songs/{sid}/videos").json() == []

    def test_others_and_admin_cannot_touch(self, member, member2, admin, song):
        sid = song["id"]
        vid = member.post(f"/songs/{sid}/videos", json=video_body()).json()["id"]
        for other in (member2, admin):
            assert other.put(f"/songs/{sid}/videos/{vid}", json={"title": "Hack"}).status_code == 403
            assert other.delete(f"/songs/{sid}/videos/{vid}").status_code == 403
        assert member.get(f"/songs/{sid}/videos").json()[0]["title"] == "Prova generale"
        # ma tutti li vedono
        assert len(member2.get(f"/songs/{sid}/videos").json()) == 1

    def test_requires_auth(self, anon, song):
        assert anon.get(f"/songs/{song['id']}/videos").status_code == 401


class TestPreview:
    def test_invalid_link_400(self, member):
        assert member.post("/media/preview", json={"url": "ftp://example.com"}).status_code == 400

    @pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://localhost/", "http://10.0.0.1/", "http://[::1]/",
                                     "http://169.254.169.254/latest/meta-data/", "https://example.com:8080/"])
    def test_internal_hosts_not_fetched(self, member, url):
        r = member.post("/media/preview", json={"url": url})
        assert r.status_code == 200
        assert r.json() == {"title": None, "image": None}

    def test_requires_auth(self, anon):
        assert anon.post("/media/preview", json={"url": "https://example.com"}).status_code == 401


# ── Audio ───────────────────────────────────────────────────────────────────

class TestAudios:
    def test_config_exposes_max_upload(self, member):
        assert member.get("/config").json()["max_upload_bytes"] > 0

    def test_upload_list_and_download(self, member, song):
        sid = song["id"]
        r = upload(member, sid)
        assert r.status_code == 201, r.text
        a = r.json()
        assert a["title"] == "Take 1" and a["mime"] == "audio/mp4" and a["size"] == len(AUDIO)
        assert a["original_name"] == "prova.m4a" and a["username"] == member.user["username"]
        assert "stored_name" not in a
        listed = member.get(f"/songs/{sid}/audios").json()
        assert [x["id"] for x in listed] == [a["id"]]

        # il file si scarica col solo link firmato (niente Authorization: e' ciò che fa <audio>)
        f = httpx.get(listed[0]["file_url"], timeout=60)
        assert f.status_code == 200
        assert f.content == AUDIO
        assert f.headers["content-type"].startswith("audio/mp4")
        assert f.headers["accept-ranges"] == "bytes"
        assert f.headers["content-disposition"].startswith("inline")
        assert f.headers["x-content-type-options"] == "nosniff"

    @pytest.mark.parametrize("name,mime", [
        ("a.mp3", "audio/mpeg"), ("a.WAV", "audio/wav"), ("a.ogg", "audio/ogg"), ("a.opus", "audio/ogg; codecs=opus"),
        ("a.aac", "audio/aac"), ("a.flac", "audio/flac"), ("a.amr", "audio/amr"), ("a.3gp", "audio/3gpp"),
        ("a.caf", "audio/x-caf"),
    ])
    def test_accepted_formats(self, member, song, name, mime):
        r = upload(member, song["id"], name=name)
        assert r.status_code == 201, r.text
        assert r.json()["mime"] == mime

    @pytest.mark.parametrize("name", ["virus.exe", "shell.php", "nota.txt", "noext", "a.m4a.php"])
    def test_rejected_formats(self, member, song, name):
        r = upload(member, song["id"], name=name)
        assert r.status_code == 400
        assert "Formato non supportato" in r.json()["detail"]
        assert member.get(f"/songs/{song['id']}/audios").json() == []

    def test_empty_file_400(self, member, song):
        assert upload(member, song["id"], content=b"").status_code == 400

    def test_missing_file_and_fields(self, member, song):
        sid = song["id"]
        assert member.post(f"/songs/{sid}/audios", data={"title": "x", "recorded_on": TODAY}).status_code == 422
        assert upload(member, sid, title="  ").status_code == 400
        assert upload(member, sid, recorded_on="ieri").status_code == 400
        assert member.get(f"/songs/{sid}/audios").json() == []

    @pytest.mark.skipif(not os.environ.get("RUN_BIG_UPLOAD"), reason="invia >128 MB: RUN_BIG_UPLOAD=1 per abilitare")
    def test_over_limit_413(self, member, song):
        limit = member.get("/config").json()["max_upload_bytes"]
        r = upload(member, song["id"], content=b"0" * (limit + 1024))
        assert r.status_code == 413

    def test_range_requests(self, member, song):
        a = upload(member, song["id"]).json()
        url = a["file_url"]
        part = httpx.get(url, headers={"Range": "bytes=0-9"}, timeout=60)
        assert part.status_code == 206
        assert part.content == AUDIO[:10]
        assert part.headers["content-range"] == f"bytes 0-9/{len(AUDIO)}"
        tail = httpx.get(url, headers={"Range": "bytes=-5"}, timeout=60)
        assert tail.status_code == 206 and tail.content == AUDIO[-5:]
        rest = httpx.get(url, headers={"Range": f"bytes={len(AUDIO) - 3}-"}, timeout=60)
        assert rest.status_code == 206 and rest.content == AUDIO[-3:]
        bad = httpx.get(url, headers={"Range": f"bytes={len(AUDIO) + 50}-"}, timeout=60)
        assert bad.status_code == 416

    def test_download_attachment(self, member, song):
        a = upload(member, song["id"], name="Prova città.m4a").json()
        f = httpx.get(a["file_url"] + "&dl=1", timeout=60)
        assert f.status_code == 200
        disp = f.headers["content-disposition"]
        assert disp.startswith("attachment")
        assert "filename*=UTF-8''Prova%20citt%C3%A0.m4a" in disp

    def test_signed_link_required(self, member, song):
        a = upload(member, song["id"]).json()
        base = a["file_url"].split("?")[0]
        assert httpx.get(base, timeout=60).status_code == 403
        assert httpx.get(a["file_url"][:-2] + "xx", timeout=60).status_code == 403          # firma alterata
        e, s = [p.split("=")[1] for p in a["file_url"].split("?")[1].split("&")]
        assert httpx.get(f"{base}?e={int(e) - 10 ** 6}&s={s}", timeout=60).status_code == 403   # scadenza modificata

    def test_link_not_valid_for_other_audio(self, member, song):
        a1 = upload(member, song["id"]).json()
        a2 = upload(member, song["id"]).json()
        qs = a1["file_url"].split("?")[1]
        base2 = a2["file_url"].split("?")[0]
        assert httpx.get(f"{base2}?{qs}", timeout=60).status_code == 403

    def test_owner_edit_and_delete(self, member, song):
        sid = song["id"]
        a = upload(member, sid).json()
        r = member.put(f"/songs/{sid}/audios/{a['id']}", json={"title": "Nuovo titolo", "note": ""})
        assert r.status_code == 200 and r.json()["title"] == "Nuovo titolo" and r.json()["note"] is None
        assert member.delete(f"/songs/{sid}/audios/{a['id']}").status_code == 204
        assert httpx.get(a["file_url"], timeout=60).status_code == 404   # file rimosso
        assert member.get(f"/songs/{sid}/audios").json() == []

    def test_others_and_admin_cannot_touch(self, member, member2, admin, song):
        sid = song["id"]
        a = upload(member, sid).json()
        for other in (member2, admin):
            assert other.put(f"/songs/{sid}/audios/{a['id']}", json={"title": "Hack"}).status_code == 403
            assert other.delete(f"/songs/{sid}/audios/{a['id']}").status_code == 403
        assert httpx.get(a["file_url"], timeout=60).status_code == 200
        # ma chiunque li ascolta
        assert len(member2.get(f"/songs/{sid}/audios").json()) == 1

    def test_requires_auth(self, anon, member, song):
        assert anon.get(f"/songs/{song['id']}/audios").status_code == 401
        r = anon.post(f"/songs/{song['id']}/audios", data={"title": "x", "recorded_on": TODAY},
                      files={"file": ("a.m4a", AUDIO)})
        assert r.status_code == 401

    def test_data_dir_not_directly_reachable(self, member, song, site_url):
        a = upload(member, song["id"]).json()
        assert httpx.get(f"{site_url}/api/data/audio/", timeout=60).status_code in (403, 404)


# ── Cascata ─────────────────────────────────────────────────────────────────

def test_delete_song_removes_media_and_files(member, admin, made):
    sid = member.post("/songs", json={"artist": "Cascata", "title": "Test"}).json()["id"]
    made["songs"].append(sid)
    member.post(f"/songs/{sid}/videos", json=video_body())
    a = upload(member, sid).json()
    assert httpx.get(a["file_url"], timeout=60).status_code == 200
    assert member.delete(f"/songs/{sid}").status_code == 204
    assert httpx.get(a["file_url"], timeout=60).status_code == 404
    assert member.get(f"/songs/{sid}/audios").status_code == 404
    assert member.get(f"/songs/{sid}/videos").status_code == 404
