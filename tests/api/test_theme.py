"""Tema dell'aspetto per utente (PUT /auth/theme, schema v8)."""
import pytest

from conftest import login

FULL = {
    "v": 1, "preset": "spartito", "accent": "#1D4ED8", "tint": {"hue": 100, "amount": 8},
    "contrast": "high", "font": "atkinson", "scale": 112, "radius": "round",
}


class TestTheme:
    def test_new_user_has_no_theme(self, member):
        r = member.get("/auth/me")
        assert r.status_code == 200
        assert r.json()["theme"] is None

    def test_save_returns_normalized_theme(self, member):
        r = member.put("/auth/theme", json={"theme": FULL})
        assert r.status_code == 200, r.text
        t = r.json()["theme"]
        assert t["preset"] == "spartito"
        assert t["accent"] == "#1d4ed8"  # minuscolo
        assert t["tint"] == {"hue": 100, "amount": 8}
        assert t["scale"] == 112

    def test_me_and_login_return_theme(self, member):
        member.put("/auth/theme", json={"theme": {"preset": "valvole", "font": "barlow"}})
        assert member.get("/auth/me").json()["theme"]["preset"] == "valvole"
        fresh = login(member.user["username"], member.password)
        assert fresh.user["theme"]["preset"] == "valvole"
        assert fresh.user["theme"]["font"] == "barlow"

    def test_defaults_filled_and_extra_keys_dropped(self, member):
        r = member.put("/auth/theme", json={"theme": {"preset": "palco", "evil": "<script>"}})
        assert r.status_code == 200
        t = r.json()["theme"]
        assert "evil" not in t
        assert t == {"v": 1, "preset": "palco", "accent": None, "tint": None,
                     "contrast": "normal", "font": "system", "scale": 100, "radius": "soft"}

    def test_null_clears(self, member):
        member.put("/auth/theme", json={"theme": FULL})
        r = member.put("/auth/theme", json={"theme": None})
        assert r.status_code == 200
        assert r.json()["theme"] is None
        assert member.get("/auth/me").json()["theme"] is None

    @pytest.mark.parametrize("bad,field", [
        ({"preset": "disco"}, "preset"),
        ({"accent": "red"}, "accent"),
        ({"accent": "#12345"}, "accent"),
        ({"tint": {"hue": 400, "amount": 10}}, "tint"),
        ({"tint": {"hue": 10}}, "tint"),
        ({"tint": {"hue": 10.5, "amount": 10}}, "tint"),
        ({"scale": 95}, "scale"),
        ({"scale": "100"}, "scale"),
        ({"font": "comic"}, "font"),
        ({"radius": "tondo"}, "radius"),
        ({"contrast": "max"}, "contrast"),
        ({"v": 2}, "v"),
    ])
    def test_invalid_values_422(self, member, bad, field):
        r = member.put("/auth/theme", json={"theme": bad})
        assert r.status_code == 422
        assert field in r.json()["detail"]

    def test_theme_must_be_object(self, member):
        assert member.put("/auth/theme", json={"theme": "sala"}).status_code == 422

    def test_isolated_between_users(self, member, member2):
        member.put("/auth/theme", json={"theme": {"preset": "mezzanotte"}})
        member2.put("/auth/theme", json={"theme": {"preset": "giorno"}})
        assert member.get("/auth/me").json()["theme"]["preset"] == "mezzanotte"
        assert member2.get("/auth/me").json()["theme"]["preset"] == "giorno"

    def test_requires_login(self, anon):
        assert anon.put("/auth/theme", json={"theme": None}).status_code == 401
