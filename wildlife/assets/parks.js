// Shared helpers for loading the park manifest and building photo URLs.
// Only watermarked, reduced-resolution copies are published (see
// wildlife/assets/web/). The full-resolution originals in "Wildlife Photos/"
// are gitignored and never served. Path segments are percent-encoded
// individually so spaces/commas in folder and file names resolve correctly.

async function loadParks() {
  const res = await fetch("data/parks.json");
  const data = await res.json();
  return data.parks;
}

// Resized, watermarked copy used for on-page display (see
// wildlife/scripts/generate-web-images.py).
function webPhotoUrl(park, filename) {
  return "assets/web/" + encodeURIComponent(park.folder) + "/" + encodeURIComponent(filename);
}

// Old slugs from before the park folders were renamed (spelling fixes), so
// links shared or indexed under the old URLs still open the right gallery.
const LEGACY_SLUGS = {
  "kumuna-national-park-sri-lanka": "kumana-national-park-sri-lanka",
  "smokey-mountains-tenessee": "great-smoky-mountains-national-park-tennessee",
};

function parkBySlug(parks, slug) {
  const current = LEGACY_SLUGS[slug] || slug;
  return parks.find((p) => p.slug === current);
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
const CONTACT_EMAIL = "4aholdingscompany@gmail.com";

// parkName (optional) pre-fills the "which photo" field on a gallery page.
// The form is sent by the submit handler below through /assets/inquiry.js.
function contactFooterHtml(parkName) {
  const photo = parkName ? escapeHtml(parkName) + " — " : "";
  return `
    <footer class="site-footer">
      <div class="contact-card">
        <div>
          <h2>Interested in a print?</h2>
          <p>Every photo here is from a real trip. Prints come in small, medium and large, on foam core, acrylic or HD acrylic. If one catches your eye or you'd like to license a photo, send a note below.</p>
        </div>
        <form class="inquiry-form" novalidate>
          <label>Your name<input name="name" type="text" autocomplete="name" required></label>
          <label>Email<input name="email" type="email" autocomplete="email" required></label>
          <label>I'm interested in
            <select name="interest">
              <option>A print</option>
              <option>Licensing a photo</option>
              <option>Something else</option>
            </select>
          </label>
          <label><span>Which photo? <span class="opt">park and a short description</span></span><input name="photo" type="text" value="${photo}" placeholder="e.g. Everglades — heron at sunrise"></label>
          <label class="full"><span>Message <span class="opt">optional</span></span><textarea name="message" rows="3" placeholder="Size, framing, timing, questions..."></textarea></label>
          <input type="text" name="_honey" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
          <div class="full actions">
            <button type="submit" class="contact-button">Send inquiry</button>
            <p class="inquiry-status" role="status" aria-live="polite"></p>
          </div>
        </form>
        <p class="contact-direct">Prefer email? <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
      </div>
    </footer>`;
}

document.addEventListener("submit", (e) => {
  // order.html's form has its own handler.
  const form = e.target.closest(".inquiry-form:not(.order-form)");
  if (!form) return;
  e.preventDefault();
  const f = form.elements;
  const status = form.querySelector(".inquiry-status");
  const send = form.querySelector('button[type="submit"]');
  const missing = [f.name, f.email].filter((el) => !el.value.trim());
  if (missing.length) {
    status.textContent = "Please add your name and email.";
    missing[0].focus();
    return;
  }
  if (!f.email.checkValidity()) {
    status.textContent = "That email doesn't look right.";
    f.email.focus();
    return;
  }
  status.textContent = "Sending…";
  send.disabled = true;
  sendInquiry("Print inquiry: " + f.interest.value, {
    "Name": f.name.value.trim(),
    "Email": f.email.value.trim(),
    "Interested in": f.interest.value,
    "Photo": f.photo.value.trim(),
    "Message": f.message.value.trim(),
    "Sent from": location.href,
  }, f._honey.value)
    .then(() => {
      form.reset();
      status.textContent = "Thanks, your inquiry was sent. I'll be in touch soon.";
    })
    .catch((err) => {
      console.warn("Print inquiry: send failed", err);
      status.textContent = `That didn't go through. Please email ${CONTACT_EMAIL} instead.`;
    })
    .finally(() => { send.disabled = false; });
});

// Small print note shown on every wildlife page -- see webPhotoUrl() above.
function photoQualityNoteHtml() {
  return `<div class="notice-banner">📷 Photos on this site are watermarked and shown at reduced resolution. Prints are made from the full high-resolution files. Get in touch to order.</div>`;
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
