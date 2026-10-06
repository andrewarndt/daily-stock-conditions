#!/usr/bin/env python3
"""Generates fast-loading web copies of the store product photos.

Mirrors wildlife/scripts/generate-web-images.py -- see that file for the
full rationale. Originals in "store-photos/<category>/<file>"
are straight-off-the-camera files (several MB, 6960x4640 on most of these)
-- way more than a product-grid thumbnail needs. This script mirrors every
photo into "store/assets/web/<category>/<file>" resized to a max of
WEB_MAX_DIMENSION px on the long edge, re-encoded at WEB_JPEG_QUALITY. The
originals are left untouched and are still linked from each photo for
anyone who wants a full-resolution file (e.g. to use on an Etsy listing).

Re-run any time photos are added; already-up-to-date web copies are
skipped. Pass --force to regenerate everything regardless.

Usage: python store/scripts/generate-web-images.py [--force]
Requires Pillow: pip install Pillow
"""

import sys
from pathlib import Path

from PIL import Image, ImageOps

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PHOTOS_DIR = REPO_ROOT / "store-photos"
WEB_DIR = REPO_ROOT / "store" / "assets" / "web"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
SKIP_EXTENSIONS = {".gif", ".webp"}

WEB_MAX_DIMENSION = 1000  # px, long edge -- product cards read a bit larger than wildlife's grid tiles
WEB_JPEG_QUALITY = 85


def human_size(num_bytes):
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}GB"


def resize_one(src_path, dest_path):
    with Image.open(src_path) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((WEB_MAX_DIMENSION, WEB_MAX_DIMENSION), Image.LANCZOS)

        dest_path.parent.mkdir(parents=True, exist_ok=True)
        if dest_path.suffix.lower() == ".png":
            img.save(dest_path, format="PNG", optimize=True)
        else:
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            img.save(dest_path, format="JPEG", quality=WEB_JPEG_QUALITY, optimize=True)


def main():
    force = "--force" in sys.argv

    if not PHOTOS_DIR.is_dir():
        print(f'Could not find "{PHOTOS_DIR}"', file=sys.stderr)
        sys.exit(1)

    generated = skipped = copied = 0
    bytes_before = bytes_after = 0

    for category_dir in sorted(p for p in PHOTOS_DIR.iterdir() if p.is_dir()):
        for src_path in sorted(category_dir.iterdir()):
            if not src_path.is_file():
                continue
            ext = src_path.suffix.lower()
            if ext not in IMAGE_EXTENSIONS and ext not in SKIP_EXTENSIONS:
                continue

            # Web copies are always .jpg (re-encoded), except PNGs which stay PNG.
            dest_name = src_path.name if ext != ".jpeg" else src_path.stem + ".jpg"
            dest_path = WEB_DIR / category_dir.name / dest_name

            if not force and dest_path.exists() and dest_path.stat().st_mtime >= src_path.stat().st_mtime:
                skipped += 1
                continue

            if ext in SKIP_EXTENSIONS:
                dest_path.parent.mkdir(parents=True, exist_ok=True)
                dest_path.write_bytes(src_path.read_bytes())
                copied += 1
                continue

            resize_one(src_path, dest_path)
            before = src_path.stat().st_size
            after = dest_path.stat().st_size
            bytes_before += before
            bytes_after += after
            generated += 1
            print(f"  {category_dir.name}/{src_path.name}: {human_size(before)} -> {human_size(after)}")

    print()
    print(f"Generated {generated}, copied {copied} as-is, skipped {skipped} already up to date.")
    if generated:
        saved = bytes_before - bytes_after
        pct = (saved / bytes_before * 100) if bytes_before else 0
        print(f"Resized set: {human_size(bytes_before)} -> {human_size(bytes_after)} ({pct:.0f}% smaller)")


if __name__ == "__main__":
    main()
