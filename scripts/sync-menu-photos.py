"""Download CC0/public-domain real photographs from fixed Wikimedia sources.

No AI generation, local image editing, remote hotlinks or stock-data writes.
Source records stay in docs; the application displays no credit/license UI.
"""
import hashlib
import html
import json
from pathlib import Path
import re
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

SOURCES = [
    ("americano", "อเมริกาโน่", "Café americano 2026.jpg"),
    ("latte", "ลาเต้", "Caffe Latte at Pulse Cafe.jpg"),
    ("cappuccino", "คาปูชิโน่", "Cappucino.JPG"),
    ("espresso", "เอสเปรสโซ่", "Espresso Coffee 01.jpg"),
    ("thai-tea", "ชาไทย", "Thai Tea - Granny's Café 2024-11-22.jpg"),
    ("matcha", "มัทฉะ", "Matcha Latte in Kadıköy.jpg"),
    ("cocoa", "โกโก้", "Hot Chocolate (Unsplash).jpg"),
    ("croissant", "ครัวซองต์", "Croissant-Petr Kratochvil.jpg"),
]
OUTPUT = Path(__file__).resolve().parents[1] / "client/public/menu"


def get(url):
    request = Request(url, headers={"User-Agent": "CoffeeBackoffice/1.0 (menu photography attribution)"})
    with urlopen(request, timeout=45) as response:
        return response.read()


def plain(value):
    return html.unescape(re.sub(r"<[^>]*>", "", value)).strip()


def clean_url(value):
    parts = urlsplit(value)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def main():
    query = urlencode({"action": "query", "prop": "imageinfo", "iiprop": "url|extmetadata|size",
                       "iiurlwidth": 640, "format": "json", "titles": "|".join("File:" + title for _, _, title in SOURCES)})
    pages = json.loads(get("https://commons.wikimedia.org/w/api.php?" + query))["query"]["pages"]
    by_title = {page["title"]: page for page in pages.values()}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    photos = []
    for slug, name, title in SOURCES:
        info = by_title["File:" + title]["imageinfo"][0]
        metadata = info["extmetadata"]
        license = metadata["LicenseShortName"]["value"]
        if license not in {"CC0", "Public domain"}:
            raise ValueError("Review changed photo license before importing: " + title)
        url = clean_url(info["thumburl"])
        data = get(url)
        if data[:3] != b"\xff\xd8\xff" or len(data) > 2_000_000:
            raise ValueError("Unexpected photograph bytes/size: " + title)
        (OUTPUT / (slug + ".jpg")).write_bytes(data)
        photos.append({"name": name, "src": "/menu/" + slug + ".jpg", "title": title,
                       "author": plain(metadata["Artist"]["value"]),
                       "source": info["descriptionurl"], "download_url": url,
                       "license": license, "license_url": metadata.get("LicenseUrl", {}).get("value", info["descriptionurl"]).replace("http:", "https:"),
                       "photographed": plain(metadata.get("DateTimeOriginal", {}).get("value", "")),
                       "changes": "Wikimedia thumbnail resize; displayed with CSS framing. No AI generation or retouching.",
                       "sha256": hashlib.sha256(data).hexdigest()})
    sources_path = OUTPUT.parents[2] / "docs/menu-photo-sources.json"
    sources_path.write_text(json.dumps(photos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"photos": len(photos), "total_bytes": sum((OUTPUT / (slug + ".jpg")).stat().st_size for slug, _, _ in SOURCES)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
