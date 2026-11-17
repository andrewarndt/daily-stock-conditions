#!/usr/bin/env python3
"""Generates the web copies of the store product photos.

The originals live in "store-photos/<slug>/" on this PC only. That folder is
git-ignored and never published. Only the photos listed in
store/data/products.json ("images" on each product) get a web copy, written
to "store/assets/web/<slug>/<name>": resized to WEB_MAX_DIMENSION px on the
long edge and saved as JPEG. Anything in store-photos/ that is not listed
stays private.

To add a photo:
  1. Put the original in store-photos/<slug>/.
  2. Add "<filename-without-extension>.jpg" to that product's "images" list
     in products.json, in the order it should appear in the carousel.
     (A name with the original's own .jpg/.JPG extension also works.)
  3. Run this script, then commit store/data/products.json and
     store/assets/web/.

Web copies that are no longer listed are deleted. Up-to-date copies are
skipped; pass --force to regenerate everything.

Usage: python store/scripts/generate-web-images.py [--force]
Requires Pillow: pip install Pillow
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PHOTOS_DIR = REPO_ROOT / "store-photos"
WEB_DIR = REPO_ROOT / "store" / "assets" / "web"
PRODUCTS_JSON = REPO_ROOT / "store" / "data" / "products.json"

SOURCE_EXTENSIONS = {".jpg", ".jpeg", ".jfif", ".png", ".webp"}

WEB_MAX_DIMENSION = 1000  # px, long edge
WEB_JPEG_QUALITY = 85


def find_original(folder, listed_name):
    """The original whose name (ignoring extension and case) matches."""
    stem = Path(listed_name).stem.lower()
    if not folder.is_dir():
        return None
    matches = [p for p in sorted(folder.iterdir())
               if p.is_file() and p.suffix.lower() in SOURCE_EXTENSIONS and p.stem.lower() == stem]
    return matches[0] if matches else None


def resize_one(src_path, dest_path):
    with Image.open(src_path) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((WEB_MAX_DIMENSION, WEB_MAX_DIMENSION), Image.LANCZOS)
        if img.mode in ("RGBA", "LA", "P"):
            rgba = img.convert("RGBA")
            flat = Image.new("RGB", rgba.size, "white")
            flat.paste(rgba, mask=rgba.split()[3])
            img = flat
        elif img.mode != "RGB":
            img = img.convert("RGB")
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        # No exif= argument: camera details in the original are not carried over.
        img.save(dest_path, format="JPEG", quality=WEB_JPEG_QUALITY, optimize=True)


def main():
    force = "--force" in sys.argv
    products = json.loads(PRODUCTS_JSON.read_text(encoding="utf-8"))["products"]

    wanted = set()
    generated = skipped = 0
    problems = []

    for product in products:
        slug = product["slug"]
        for name in product.get("images", []):
            if Path(name).suffix.lower() != ".jpg":
                problems.append(f'{slug}: "{name}" must end in .jpg (web copies are always JPEG)')
                continue
            dest_path = WEB_DIR / slug / name
            wanted.add(dest_path.resolve())
            src_path = find_original(PHOTOS_DIR / slug, name)
            if src_path is None:
                if not dest_path.exists():
                    problems.append(f'{slug}: "{name}" has no original in store-photos/{slug}/ and no web copy')
                continue  # web copy exists, original has been archived: keep it
            if not force and dest_path.exists() and dest_path.stat().st_mtime >= src_path.stat().st_mtime:
                skipped += 1
                continue
            resize_one(src_path, dest_path)
            generated += 1
            print(f"  {slug}/{name}: {src_path.stat().st_size // 1024} KB -> {dest_path.stat().st_size // 1024} KB")

    removed = 0
    if WEB_DIR.is_dir():
        for path in sorted(WEB_DIR.rglob("*")):
            if path.is_file() and path.resolve() not in wanted:
                path.unlink()
                removed += 1
                print(f"  removed unlisted web copy: {path.relative_to(WEB_DIR)}")

    print()
    print(f"Generated {generated}, skipped {skipped} up to date, removed {removed} unlisted.")
    for line in problems:
        print("PROBLEM:", line, file=sys.stderr)
    if problems:
        sys.exit(1)


if __name__ == "__main__":
    main()
