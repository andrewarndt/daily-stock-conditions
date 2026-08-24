// Shared helpers for loading the park manifest and building photo URLs.
// Photos live one level up, in "Wildlife Photos/<folder>/<file>", outside
// the wildlife/ web section itself. Path segments are percent-encoded
// individually so spaces/commas in folder and file names resolve correctly.

async function loadParks() {
  const res = await fetch("data/parks.json");
  const data = await res.json();
  return data.parks;
}

function photoUrl(park, filename) {
  return "../Wildlife Photos/" + encodeURIComponent(park.folder) + "/" + encodeURIComponent(filename);
}

// Resized/compressed copy used for on-page display (see
// wildlife/scripts/generate-web-images.py). photoUrl() above still points at
// the full-resolution original -- that's what print/photo-request links use.
function webPhotoUrl(park, filename) {
  return "assets/web/" + encodeURIComponent(park.folder) + "/" + encodeURIComponent(filename);
}

function parkBySlug(parks, slug) {
  return parks.find((p) => p.slug === slug);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Renders the location line, or nothing if the folder had no ", Location" suffix.
function locationHtml(park) {
  return park.location ? `<p class="park-location">${escapeHtml(park.location)}</p>` : "";
}

// Contact address shown on every page in this section — edit here, not per-page.
const CONTACT_EMAIL = "vasudeshanjala@gmail.com";

function contactFooterHtml() {
  return `
    <footer class="site-footer">
      <div class="contact-card">
        <div>
          <h2>Interested in a print?</h2>
          <p>Every photo here is from a real trip. If one catches your eye or you'd like to license or order a print, get in touch.</p>
        </div>
        <a class="contact-button" href="mailto:${CONTACT_EMAIL}">✉ ${CONTACT_EMAIL}</a>
      </div>
    </footer>`;
}

// Picks one photo at random across all parks that have any, for use as a
// hero background. Returns null if no park has photos yet.
function randomCoverPhoto(parks) {
  const candidates = parks.flatMap((park) => park.photos.map((filename) => webPhotoUrl(park, filename)));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Small print note shown on every wildlife page -- see webPhotoUrl() above.
function photoQualityNoteHtml() {
  return `<div class="notice-banner">📷 Photos on this site are shown at reduced resolution for faster loading. Full high-resolution files are available for prints — get in touch.</div>`;
}

// Updates <meta name="description">, the canonical link, and Open
// Graph/Twitter tags for one park's gallery page -- progressive enhancement
// over the generic fallback tags already in gallery.html's <head>. Search
// crawlers that execute JS (Google's does) pick up these per-park values,
// including a canonical URL that matches this park's actual sitemap.xml
// entry; anything that doesn't run JS still gets the sensible fallback.
function updateGallerySeo(park) {
  const count = park.photos.length;
  const where = park.location ? `${park.name}, ${park.location}` : park.name;
  const desc = count
    ? `${count} wildlife photo${count === 1 ? "" : "s"} from ${where} — full-resolution prints available.`
    : `Wildlife photography from ${where}. Full-resolution prints available.`;
  const url = `https://4aholdingscompany.com/wildlife/gallery.html?park=${encodeURIComponent(park.slug)}`;
  const title = `${park.name} — Wildlife Photography`;
  const image = count ? `https://4aholdingscompany.com/wildlife/${webPhotoUrl(park, park.photos[0])}` : null;

  const setMeta = (selector, attr, value) => {
    const el = document.querySelector(selector);
    if (el && value) el.setAttribute(attr, value);
  };
  setMeta('meta[name="description"]', "content", desc);
  setMeta('link[rel="canonical"]', "href", url);
  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[property="og:description"]', "content", desc);
  setMeta('meta[property="og:url"]', "content", url);
  if (image) setMeta('meta[property="og:image"]', "content", image);
}
