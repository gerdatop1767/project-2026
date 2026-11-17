#!/usr/bin/env python3
"""Legally reusable images from the internet for backgrounds/cutaways, with credits recorded.

Sources: Wikimedia Commons (API) and Openverse (API, thumbnails). Only licences that allow commercial reuse
and modification: CC0, Public Domain, CC BY, CC BY-SA. No NC/ND, no "fair use", no random sites.
Every download is appended to <video_dir>/source/assets/CREDITS.json; CC BY/BY-SA need the credit line
in the TikTok description (send it in storyboard.telegram.caption too).

python3 fetch_asset.py <video_dir> "search query in English" [--n 3] [--name bg_city] [--source openverse|commons]  (openverse default; commons is rate-limited)
python3 fetch_asset.py <video_dir> --credits    # print credit lines for the description
"""
import argparse, json, re, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

UA = {"User-Agent": "zybrilka-content-studio/1.0 (educational video assets)"}
OK_LIC = re.compile(r"^(cc0|pdm|public domain|cc[- ]?by(-sa)?([ -]\d\.\d)?)$", re.I)


def get(url, tries=4):
    import time
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or k == tries - 1: raise
            time.sleep(min(30, int(e.headers.get("Retry-After") or 0) or 3 * 2 ** k))  # polite back-off


def commons(q, n):
    api = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "search", "gsrsearch": f"filetype:bitmap {q}", "gsrnamespace": 6,
        "gsrlimit": 30, "prop": "imageinfo", "iiprop": "url|extmetadata|size", "iiurlwidth": 1280})
    pages = json.loads(get(api)).get("query", {}).get("pages", {}).values()
    out = []
    for p in sorted(pages, key=lambda p: p.get("index", 0)):
        ii = (p.get("imageinfo") or [{}])[0]; md = ii.get("extmetadata", {})
        lic = (md.get("LicenseShortName", {}).get("value") or "").strip()
        if not OK_LIC.match(lic.lower().replace("public domain mark", "pdm")) or ii.get("width", 0) < 900: continue
        author = re.sub("<[^>]+>", "", md.get("Artist", {}).get("value", "unknown")).strip()
        out.append(dict(url=(ii.get("thumburl") or ii["url"]).replace("//thumb.wikimedia.org/", "//upload.wikimedia.org/"), page=ii.get("descriptionurl"), license=lic, author=author,
                        title=p["title"].replace("File:", ""), source="Wikimedia Commons"))
        if len(out) >= n: break
    return out


def openverse(q, n):
    api = "https://api.openverse.org/v1/images/?" + urllib.parse.urlencode({
        "q": q, "license": "cc0,pdm,by,by-sa", "license_type": "commercial,modification", "page_size": 20})
    out = []
    for r in json.loads(get(api)).get("results", []):
        if (r.get("width") or 0) < 900: continue
        out.append(dict(url=f"https://api.openverse.org/v1/images/{r['id']}/thumb/?full_size=true", page=r.get("foreign_landing_url"),
                        license=f"{r['license']} {r.get('license_version') or ''}".strip(), author=r.get("creator") or "unknown",
                        title=r.get("title") or r["id"], source=f"Openverse / {r.get('provider')}"))
        if len(out) >= n: break
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("video_dir"); ap.add_argument("query", nargs="?")
    ap.add_argument("--n", type=int, default=3); ap.add_argument("--name", default="asset")
    ap.add_argument("--source", default="openverse"); ap.add_argument("--credits", action="store_true")
    a = ap.parse_args()
    d = Path(a.video_dir) / "source/assets"; d.mkdir(parents=True, exist_ok=True)
    cf = d / "CREDITS.json"; credits = json.loads(cf.read_text()) if cf.exists() else []
    if a.credits:
        for c in credits:
            if not c["license"].lower().startswith(("cc0", "pdm", "public")):
                print(f"Фото: {c['author']}, {c['license']} ({c['source']})")
        return
    found = (commons if a.source == "commons" else openverse)(a.query, a.n)
    if not found: found = (openverse if a.source == "commons" else commons)(a.query, a.n)
    for i, f in enumerate(found):
        data = get(f["url"]); ext = ".png" if data[:4] == b"\x89PNG" else ".jpg"
        name = f"{a.name}_{i + 1}{ext}"; (d / name).write_bytes(data)
        f["file"] = f"source/assets/{name}"; credits = [c for c in credits if c.get("file") != f["file"]] + [f]
        print(f"{f['file']}  [{f['license']}] {f['author']} — {f['title']}")
    cf.write_text(json.dumps(credits, ensure_ascii=False, indent=1))
    if not found: print("nothing with a reusable licence found; try another English query")


if __name__ == "__main__":
    main()
