// Regenerates wildlife/data/parks.json from the actual contents of
// "Wildlife Photos/" so the site's park list, names, and galleries always
// match whatever folders/files exist in the repo -- no manual editing.
//
// Convention: each subfolder of "Wildlife Photos/" is one park/section.
// "Park Name, Location" splits into name + location; no comma just means
// no location. Image files directly inside a park folder become its
// gallery, sorted by filename. Run via `node wildlife/scripts/generate-manifest.mjs`
// (see .github/workflows/refresh-wildlife.yml for the automated trigger).

import { readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PHOTOS_DIR = path.join(REPO_ROOT, "Wildlife Photos");
const MANIFEST_PATH = path.join(REPO_ROOT, "wildlife", "data", "parks.json");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Make slugs unique in case two folder names collapse to the same slug
// (e.g. differ only in punctuation/case).
function uniqueSlug(base, used) {
  let slug = base || "park";
  let n = 2;
  while (used.has(slug)) {
    slug = `${base || "park"}-${n++}`;
  }
  used.add(slug);
  return slug;
}

function splitNameLocation(folderName) {
  const idx = folderName.lastIndexOf(",");
  if (idx === -1) return { name: folderName.trim(), location: "" };
  return {
    name: folderName.slice(0, idx).trim(),
    location: folderName.slice(idx + 1).trim(),
  };
}

function listImages(dir) {
  return readdirSync(dir)
    .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function main() {
  let entries;
  try {
    entries = readdirSync(PHOTOS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error(`Could not read "${PHOTOS_DIR}": ${err.message}`);
    process.exit(1);
  }

  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const usedSlugs = new Set();
  const parks = folders.map((folder) => {
    const { name, location } = splitNameLocation(folder);
    return {
      slug: uniqueSlug(slugify(folder), usedSlugs),
      name,
      location,
      folder,
      photos: listImages(path.join(PHOTOS_DIR, folder)),
    };
  });

  const json = JSON.stringify({ parks }, null, 2) + "\n";
  writeFileSync(MANIFEST_PATH, json);

  const photoCount = parks.reduce((sum, p) => sum + p.photos.length, 0);
  console.log(`Wrote ${parks.length} park(s), ${photoCount} photo(s) to ${MANIFEST_PATH}`);
}

main();
