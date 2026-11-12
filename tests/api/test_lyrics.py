"""Testo manuale, accordi in linea e scansione OCR (spec lyrics-teleprompter)."""
import base64

import httpx
import pytest

from conftest import API

# PNG 1x1 valido: basta a superare il controllo sul tipo dell'immagine
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
LYRICS = "[Strofa 1]\n[Am]Quando sei [G]qui\nquesta stanza non ha più pa[E]reti"


def groq_key_set(admin):
    settings = {s["key"]: s["value_masked"] for s in admin.get("/admin/settings").json()}
    return bool(settings.get("groq_api_key", ""))


def scan(api, song_id, content=PNG, name="scan.png", field="image"):
    return api.post(f"/songs/{song_id}/lyrics/ocr", files={field: (name, content, "application/octet-stream")})


# ── Testo ───────────────────────────────────────────────────────────────────

class TestLyrics:
    def test_new_song_has_no_source(self, song):
        assert song["lyrics"] is None and song["lyrics_source"] is None

    def test_save_marks_manual(self, member, member2, song):
        r = member2.put(f"/songs/{song['id']}/lyrics", json={"lyrics": LYRICS})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["lyrics"] == LYRICS and d["lyrics_source"] == "manual"
        assert d["last_modified_by_id"] == member2.user["id"]
        again = member.get(f"/songs/{song['id']}").json()
        assert again["lyrics"] == LYRICS and again["lyrics_source"] == "manual"

    def test_normalizes_line_endings_and_edges(self, member, song):
        r = member.put(f"/songs/{song['id']}/lyrics", json={"lyrics": "\r\n\r\nuno  \r\ndue\t\rtre\n\n\n"})
        assert r.status_code == 200
        assert r.json()["lyrics"] == "uno\ndue\ntre"

    @pytest.mark.parametrize("blank", ["", "   ", "\n\n \n"])
    def test_empty_clears_text_and_source(self, member, song, blank):
        sid = song["id"]
        assert member.put(f"/songs/{sid}/lyrics", json={"lyrics": LYRICS}).status_code == 200
        r = member.put(f"/songs/{sid}/lyrics", json={"lyrics": blank})
        assert r.status_code == 200
        assert r.json()["lyrics"] is None and r.json()["lyrics_source"] is None

    def test_length_limit(self, member, song):
        sid = song["id"]
        assert member.put(f"/songs/{sid}/lyrics", json={"lyrics": "x" * 30000}).status_code == 200
        r = member.put(f"/songs/{sid}/lyrics", json={"lyrics": "x" * 30001})
        assert r.status_code == 400 and "troppo lungo" in r.json()["detail"]
        assert len(member.get(f"/songs/{sid}").json()["lyrics"]) == 30000

    def test_missing_or_wrong_field_422(self, member, song):
        assert member.put(f"/songs/{song['id']}/lyrics", json={}).status_code == 422
        assert member.put(f"/songs/{song['id']}/lyrics", json={"lyrics": 5}).status_code == 422

    def test_unknown_song_404(self, member):
        assert member.put("/songs/99999999/lyrics", json={"lyrics": "x"}).status_code == 404

    def test_requires_auth(self, song):
        r = httpx.put(f"{API}/songs/{song['id']}/lyrics", json={"lyrics": "x"}, timeout=60)
        assert r.status_code == 401

    def test_manual_text_survives_enrich(self, member, song):
        sid = song["id"]
        member.put(f"/songs/{sid}/lyrics", json={"lyrics": LYRICS})
        assert member.post(f"/songs/{sid}/enrich").status_code == 200
        d = member.get(f"/songs/{sid}").json()
        assert d["lyrics"] == LYRICS and d["lyrics_source"] == "manual"

    def test_other_song_updates_keep_text(self, member, song):
        sid = song["id"]
        member.put(f"/songs/{sid}/lyrics", json={"lyrics": LYRICS})
        member.put(f"/songs/{sid}", json={"title": "Altro titolo"})
        member.put(f"/songs/{sid}/category", json={"category": "da_provare"})
        d = member.get(f"/songs/{sid}").json()
        assert d["lyrics"] == LYRICS and d["lyrics_source"] == "manual"
        assert any(s["id"] == sid and s["lyrics_source"] == "manual" for s in member.get("/songs").json())


# ── OCR ─────────────────────────────────────────────────────────────────────

class TestOcr:
    def test_config_exposes_ocr_available(self, member, admin):
        cfg = member.get("/config").json()
        assert cfg["ocr_available"] is groq_key_set(admin)

    def test_unknown_song_404(self, member):
        assert scan(member, 99999999).status_code == 404

    def test_requires_auth(self, song):
        r = httpx.post(f"{API}/songs/{song['id']}/lyrics/ocr", files={"image": ("a.png", PNG)}, timeout=60)
        assert r.status_code == 401

    def test_missing_file_422(self, member, song):
        assert scan(member, song["id"], field="altro").status_code == 422
        assert member.post(f"/songs/{song['id']}/lyrics/ocr", data={"x": "1"}).status_code == 422

    @pytest.mark.parametrize("name,content", [
        ("testo.txt", b"solo testo, nessuna immagine"),
        ("finta.jpg", b"<?php echo 1; ?>" * 10),
        ("anim.gif", b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,"
                     b"\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"),
    ])
    def test_not_a_supported_image_400(self, member, song, name, content):
        r = scan(member, song["id"], content=content, name=name)
        assert r.status_code == 400 and "Formato non supportato" in r.json()["detail"]

    def test_too_big_413(self, member, song):
        # Intestazione PNG valida seguita da riempimento: supera i 4 MB ammessi
        r = scan(member, song["id"], content=PNG + b"\x00" * (4 * 1024 * 1024))
        assert r.status_code == 413

    def test_without_groq_key_400(self, member, song, admin):
        if groq_key_set(admin):
            pytest.skip("groq_api_key configurata: il percorso senza chiave non e' testabile")
        r = scan(member, song["id"])
        assert r.status_code == 400 and "Groq API key non configurata" in r.json()["detail"]

    def test_scan_does_not_save(self, member, song, admin):
        """Qualunque sia l'esito della scansione, il brano non cambia: salva solo PUT /lyrics."""
        scan(member, song["id"])
        d = member.get(f"/songs/{song['id']}").json()
        assert d["lyrics"] is None and d["lyrics_source"] is None
