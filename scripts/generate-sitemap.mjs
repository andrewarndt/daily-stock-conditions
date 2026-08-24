#!/usr/bin/env node
// Regenerates /sitemap.xml from the site's actual pages, so search engines
// always have a current, complete list of URLs to crawl and index.
//
// The static pages below are fixed (this site's structure doesn't add/remove
// top-level pages often); the wildlife gallery URLs are generated from
// wildlife/data/parks.json so a new park picked up by generate-manifest.mjs
// automatically gets a sitemap entry too, with no manual edit here. Run via
// `node scripts/generate-sitemap.mjs` (see .github/workflows/refresh-wildlife.yml
// for the automated trigger -- it runs generate-manifest.mjs first, so this
// always sees the current park list).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PARKS_PATH = path.join(REPO_ROOT, "wildlife", "data", "parks.json");
const OUT_PATH = path.join(REPO_ROOT, "sitemap.xml");

const SITE = "https://4aholdingscompany.com";

// path, changefreq, priority -- priority is just a same-site hint (highest
// for the two section landing pages), not a promise search engines follow.
const STATIC_PAGES = [
  ["/", "weekly", "1.0"],
  ["/market_report/index.html", "hourly", "0.9"],
  ["/market_report/sentiment.html", "daily", "0.7"],
  ["/market_report/sector-ratios.html", "daily", "0.7"],
  ["/market_report/fed-economic.html", "daily", "0.7"],
  ["/market_report/fed-dashboard.html", "daily", "0.7"],
  ["/wildlife/index.html", "weekly", "0.9"],
];

function loadParkSlugs() {
  try {
    const json = JSON.parse(readFileSync(PARKS_PATH, "utf8"));
    return (json.parks || []).map((p) => p.slug);
  } catch (err) {
    console.warn(`Could not read ${PARKS_PATH}: ${err.message}. Sitemap will skip park galleries.`);
    return [];
  }
}

function urlEntry(loc, changefreq, priority) {
  return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

function main() {
  const entries = STATIC_PAGES.map(([p, freq, pri]) => urlEntry(SITE + p, freq, pri));

  for (const slug of loadParkSlugs()) {
    entries.push(urlEntry(`${SITE}/wildlife/gallery.html?park=${slug}`, "monthly", "0.6"));
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.join("\n") +
    `\n</urlset>\n`;

  writeFileSync(OUT_PATH, xml);
  console.log(`Wrote ${entries.length} URL(s) to ${OUT_PATH}`);
}

main();
