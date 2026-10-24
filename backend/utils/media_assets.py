"""Internal media URLs use opaque identifiers rather than download-like filenames."""
import base64
from pathlib import Path


def render_asset_url(filename: str) -> str:
    name = Path(filename).name
    token = base64.urlsafe_b64encode(name.encode()).decode().rstrip("=")
    return f"/api/render-asset/{token}"
