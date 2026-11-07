"""Read YouTube cookies from a registered local Zen profile, without exports."""
import configparser
import hashlib
import os
import sys
import time
from pathlib import Path


def zen_root():
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "zen"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "zen"
    return Path.home() / ".zen"


def discover_profiles():
    root = zen_root()
    config = configparser.ConfigParser(interpolation=None)
    config.read(root / "profiles.ini", encoding="utf-8-sig")
    installed = {config.get(section, "Default", fallback="") for section in config.sections() if section.startswith("Install")}
    profiles = []
    for section in config.sections():
        if not section.startswith("Profile") or not config.has_option(section, "Path"):
            continue
        location = config.get(section, "Path")
        path = (root / location if config.getboolean(section, "IsRelative", fallback=True) else Path(location)).resolve()
        if not (path / "cookies.sqlite").is_file():
            continue
        profiles.append({"id": hashlib.sha256(str(path).encode()).hexdigest()[:20],
                         "name": config.get(section, "Name", fallback=section), "path": path,
                         "default": location in installed or config.getboolean(section, "Default", fallback=False)})
    return sorted(profiles, key=lambda profile: (not profile["default"], -(profile["path"] / "cookies.sqlite").stat().st_mtime))


class QuietCookieLogger:
    def debug(self, *args, **kwargs):
        pass
    info = warning = error = debug


def import_youtube_cookies(profile_id):
    from yt_dlp.cookies import extract_cookies_from_browser
    profiles = discover_profiles()
    profile = next((profile for profile in profiles if profile["id"] == profile_id), None)
    if profile is None:
        raise LookupError("Zen profile not found. Open Zen, sign in to YouTube, and refresh the profile list.")
    jar = extract_cookies_from_browser("firefox", str(profile["path"]), logger=QuietCookieLogger())
    lines = ["# Netscape HTTP Cookie File", "# YouTube cookies from Zen"]
    now, count = time.time(), 0
    for cookie in jar:
        domain = cookie.domain.lstrip(".").lower()
        if domain != "youtube.com" and not domain.endswith(".youtube.com"):
            continue
        if cookie.expires and cookie.expires < now:
            continue
        fields = [cookie.domain, "TRUE" if cookie.domain_initial_dot else "FALSE", cookie.path or "/",
                  "TRUE" if cookie.secure else "FALSE", str(int(cookie.expires or 0)), cookie.name, cookie.value]
        if not all(isinstance(field, str) and not any(char in field for char in "\t\r\n") for field in fields):
            continue
        lines.append("\t".join(fields))
        count += 1
    if not count:
        raise LookupError("No YouTube cookies in this Zen profile. Open YouTube in Zen and sign in, then try again.")
    return {"cookies_content": "\n".join(lines) + "\n", "cookie_count": count, "profile_name": profile["name"]}
