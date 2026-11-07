import sqlite3
import time
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.services import zen_cookies


@pytest.fixture
def profile(tmp_path, monkeypatch):
    root = tmp_path / "zen"
    path = root / "Profiles" / "test.default"
    path.mkdir(parents=True)
    (root / "profiles.ini").write_text("[Profile0]\nName=Test profile\nIsRelative=1\nPath=Profiles/test.default\nDefault=1\n")
    with sqlite3.connect(path / "cookies.sqlite") as db:
        db.execute("PRAGMA user_version=17")
        db.execute("CREATE TABLE moz_cookies(host TEXT,name TEXT,value TEXT,path TEXT,expiry INTEGER,isSecure INTEGER)")
        expiry = int((time.time() + 3600) * 1000)
        db.executemany("INSERT INTO moz_cookies VALUES(?,?,?,?,?,?)", [
            (".youtube.com", "SID", "fake-youtube-session", "/", expiry, 1),
            ("www.youtube.com", "PREF", "fake-pref", "/", expiry, 1),
            (".notyoutube.com", "SID", "unrelated-session", "/", expiry, 1),
            (".youtube.com.attacker.test", "SID", "unrelated-session", "/", expiry, 1),
            (".youtube.com", "OLD", "expired-session", "/", int((time.time()-100)*1000), 1)])
    monkeypatch.setattr(zen_cookies, "zen_root", lambda: root)
    return zen_cookies.discover_profiles()[0]


def test_zen_import_only_returns_current_youtube_cookies(profile):
    result = zen_cookies.import_youtube_cookies(profile["id"])
    assert result["cookie_count"] == 2
    assert "fake-youtube-session" in result["cookies_content"]
    assert "unrelated-session" not in result["cookies_content"]
    assert "expired-session" not in result["cookies_content"]
    with pytest.raises(LookupError):
        zen_cookies.import_youtube_cookies("a"*20)


def test_zen_route_blocks_remote_sites_and_hides_profile_paths(profile):
    from backend.routers.cookies import router
    app = FastAPI()
    app.include_router(router)
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        listing = client.get("/api/cookies/zen/profiles")
        assert listing.status_code == 200
        assert "path" not in listing.json()["profiles"][0]
        response = client.post("/api/cookies/zen/import", json={"profile_id": profile["id"]}, headers={"Origin":"http://localhost:5173"})
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert client.post("/api/cookies/zen/import", json={"profile_id":profile["id"]}, headers={"Origin":"https://unrelated.example"}).status_code == 403
        assert client.post("/api/cookies/zen/import", json={"profile_id":"../../cookies.sqlite"}).status_code == 422
    with TestClient(app, client=("192.168.1.50", 50000)) as client:
        assert client.get("/api/cookies/zen/profiles").status_code == 403
