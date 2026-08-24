#!/usr/bin/env python3
"""Generates fast-loading web copies of the wildlife photos.

The originals in "Wildlife Photos/<park>/<file>" are straight-off-the-camera
files (several MB each, some 12+ MP) -- great for prints, way more than a
browser needs to display in a grid. This script mirrors every photo into
"wildlife/assets/web/<park>/<file>" resized to a max of WEB_MAX_DIMENSION px
on the long edge and re-encoded at WEB_JPEG_QUALITY, which is what the site
actually links to (see wildlife/assets/parks.js: webPhotoUrl). The originals
are left untouched and are still linked from each photo for anyone who wants
a print-quality file.

Re-run any time photos are added; already-up-to-date web copies (destination
newer than source) are skipped, so it's safe/cheap to run repeatedly. Pass
--force to regenerate everything regardless.

Usage: python wildlife/scripts/generate-web-images.py [--force]
Requires Pillow: pip install Pillow
"""

import sys
from pathlib import Path

from PIL import Image, ImageOps

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PHOTOS_DIR = REPO_ROOT / "Wildlife Photos"
WEB_DIR = REPO_ROOT / "wildlife" / "assets" / "web"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
# Animated/exotic formats aren't safe to re-encode with this approach --
# pages just fall back to the original file for these (see parks.js).
SKIP_EXTENSIONS = {".gif", ".webp"}

WEB_MAX_DIMENSION = 900  # px, long edge
WEB_JPEG_QUALITY = 82

# Every on-page use of this "web" tier is a grid thumbnail -- park-cover
# (minmax(280px, 1fr)) and photo-grid (minmax(240px, 1fr)) in
# wildlife/assets/style.css, both capped well under 400px CSS-wide even on a
# wide screen (the grid adds tracks rather than stretching one card full
# width). "Full resolution" on this site always means the original file
# (photoUrl(), opened in a new tab for anyone wanting a print) -- this tier
# is never displayed any larger than a small grid tile. 900px covers a
# ~360px tile at 2.5x pixel density with real headroom, at roughly a
# quarter of the decoded-memory footprint of the old 1920px cap (each
# 1920px photo was ~11.5MB decoded in the browser regardless of its ~300px
# on-screen size -- a 15-20 photo gallery could add 150MB+ of that during a
# scroll-through). If a larger in-page view (e.g. a lightbox) is ever added,
# give it its own tier rather than raising this one.


def human_size(num_bytes):
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}GB"


def resize_one(src_path, dest_path):
    with Image.open(src_path) as img:
        # Bake in the EXIF rotation now, since we're stripping metadata below.
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

    for park_dir in sorted(p for p in PHOTOS_DIR.iterdir() if p.is_dir()):
        for src_path in sorted(park_dir.iterdir()):
            if not src_path.is_file():
                continue
            ext = src_path.suffix.lower()
            if ext not in IMAGE_EXTENSIONS and ext not in SKIP_EXTENSIONS:
                continue

            dest_path = WEB_DIR / park_dir.name / src_path.name

            if not force and dest_path.exists() and dest_path.stat().st_mtime >= src_path.stat().st_mtime:
                skipped += 1
                continue

            if ext in SKIP_EXTENSIONS:
                # Can't safely shrink these -- keep the site working by
                # mirroring the original as-is rather than dropping the photo.
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
            print(f"  {park_dir.name}/{src_path.name}: {human_size(before)} -> {human_size(after)}")

    print()
    print(f"Generated {generated}, copied {copied} as-is, skipped {skipped} already up to date.")
    if generated:
        saved = bytes_before - bytes_after
        pct = (saved / bytes_before * 100) if bytes_before else 0
        print(f"Resized set: {human_size(bytes_before)} -> {human_size(bytes_after)} ({pct:.0f}% smaller)")


if __name__ == "__main__":
    main()
