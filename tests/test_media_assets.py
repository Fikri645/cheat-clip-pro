import base64

from fastapi.testclient import TestClient


def test_internal_audio_is_binary_and_not_a_download(tmp_path,monkeypatch):
    monkeypatch.setenv("JOB_DATABASE_PATH",str(tmp_path/"jobs.sqlite3"))
    from backend.main import app
    from backend.routers import media
    from backend.utils.media_assets import render_asset_url
    monkeypatch.setattr(media,"UPLOADS_DIR",tmp_path)
    content=b"RIFF"+b"\0"*128
    (tmp_path/"music.wav").write_bytes(content)
    with TestClient(app,raise_server_exceptions=True) as client:
        response=client.get(render_asset_url("music.wav"))
        assert response.status_code==200
        assert response.content==content
        assert response.headers["content-type"]=="application/octet-stream"
        assert "content-disposition" not in response.headers
        traversal=base64.urlsafe_b64encode(b"../cookies.txt").decode().rstrip("=")
        assert client.get("/api/render-asset/"+traversal).status_code==404
