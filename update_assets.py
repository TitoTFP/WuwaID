"""
Script to update Web/assets.json:
- Calculate SHA256 for bgm.mp3 and bg-video.mp4 from local files
- Get SHA256 and URLs of 3 release files from GitHub API
"""

import hashlib
import json
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
ASSETS_JSON = SCRIPT_DIR / "Web" / "assets.json"

REPO_API = "https://api.github.com/repos/CallMeDangDev/WuwaVH/releases/latest"

RAW_BASE = "https://raw.githubusercontent.com/CallMeDangDev/WuwaVH/refs/heads/main"

LOCAL_FILES = [
    {
        "name": "bgm.mp3",
        "path": SCRIPT_DIR / "Web" / "Audio" / "bgm.mp3",
        "url": f"{RAW_BASE}/Web/Audio/bgm.mp3",
    },
    {
        "name": "bg-video.mp4",
        "path": SCRIPT_DIR / "Web" / "Video" / "bg-video.mp4",
        "url": f"{RAW_BASE}/Web/Video/bg-video.mp4",
    },
]

RELEASE_FILES = {"UTMAlexander_100_P.pak", "version.dll", "WuWaVH_99_P.pak"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_release_assets() -> list[dict]:
    req = urllib.request.Request(REPO_API, headers={"User-Agent": "update_assets.py"})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())

    assets = []
    for asset in data.get("assets", []):
        name = asset["name"]
        if name not in RELEASE_FILES:
            continue
        digest: str = asset.get("digest", "")
        # digest format: "sha256:<hex>"
        sha256 = digest.removeprefix("sha256:")
        assets.append(
            {
                "name": name,
                "url": asset["browser_download_url"],
                "sha256": sha256,
            }
        )

    # Keep fixed order according to RELEASE_FILES
    order = list(RELEASE_FILES)
    assets.sort(key=lambda a: order.index(a["name"]) if a["name"] in order else 999)
    return assets


def main():
    print("Calculating SHA256 for local files...")
    local_entries = []
    for item in LOCAL_FILES:
        if not item["path"].exists():
            print(f"  [SKIP] Not found: {item['path']}")
            continue
        sha = sha256_file(item["path"])
        print(f"  {item['name']}: {sha}")
        local_entries.append({"name": item["name"], "url": item["url"], "sha256": sha})

    print(f"\nCalling GitHub API: {REPO_API}")
    release_entries = fetch_release_assets()
    for e in release_entries:
        print(f"  {e['name']}: {e['sha256']}")

    all_entries = local_entries + release_entries
    output = {"assets": all_entries}

    ASSETS_JSON.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nSaved to {ASSETS_JSON}")


if __name__ == "__main__":
    main()
