// Shared helpers for loading the product catalog and building photo/contact
// links. Mirrors the pattern in wildlife/assets/parks.js. Full-resolution
// photos live one level up, in "store-photos/<slug>/<file>",
// outside the store/ web section itself; store/assets/web/<slug>/<file> is
// the resized copy actually used on-page (see store/scripts/generate-web-images.py).

async function loadProducts() {
  const res = await fetch("data/products.json");
  const data = await res.json();
  return data.products;
}

function photoUrl(product, filename) {
  return "../store-photos/" + encodeURIComponent(product.slug) + "/" + encodeURIComponent(filename);
}

function webPhotoUrl(product, filename) {
  return "assets/web/" + encodeURIComponent(product.slug) + "/" + encodeURIComponent(filename);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Contact address shown on every product -- edit here, not per-product.
// Products with "options" in data/products.json check out through Stripe
// Payment Links; the email address is for questions, custom requests, and
// anything that doesn't have a checkout link yet.
const CONTACT_EMAIL = "4aholdingscompany@gmail.com";

// Flat shipping charged by every Stripe link (set on the Stripe shipping rate).
// Stripe can't block Alaska/Hawaii, so this notice is the only warning.
const SHIPPING_NOTE = "$9 flat shipping &middot; contiguous U.S. only (Alaska and Hawaii: email us)";

function formatPrice(amount) {
  return "$" + amount.toFixed(2);
}

function contactFooterHtml() {
  return `
    <footer class="site-footer">
      <div class="contact-card">
        <div>
          <h2>Don't see what you're after?</h2>
          <p>This store is just getting started -- more pieces get added as they're ready. If you want something specific, or want to ask about a piece before buying, just reach out.</p>
        </div>
        <a class="contact-button" href="mailto:${CONTACT_EMAIL}">&#9993; ${CONTACT_EMAIL}</a>
      </div>
    </footer>`;
}

function mailtoForProduct(product, prefix = "Interested in: ") {
  const subject = encodeURIComponent(prefix + product.name);
  return `mailto:${CONTACT_EMAIL}?subject=${subject}`;
}

// Picks one photo at random across every product that has any, for use as
// a hero background. Returns null if nothing has photos yet.
function randomCoverPhoto(products) {
  const candidates = products.flatMap((p) => p.images.map((filename) => webPhotoUrl(p, filename)));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function productCardHtml(product) {
  const hasPhotos = product.images.length > 0;
  const cover = hasPhotos
    ? `<div class="product-cover"><img src="${webPhotoUrl(product, product.images[0])}" alt="${escapeHtml(product.name)}" loading="lazy"></div>`
    : `<div class="product-cover placeholder">Photos coming soon</div>`;

  const extraThumbs = hasPhotos ? product.images.slice(1) : [];
  const thumbs = extraThumbs.length
    ? `<div class="product-thumbs">${extraThumbs.map((filename) => `
        <a href="${photoUrl(product, filename)}" target="_blank" rel="noopener">
          <img src="${webPhotoUrl(product, filename)}" alt="${escapeHtml(product.name)} detail" loading="lazy">
        </a>`).join("")}</div>`
    : "";

  return `
    <div class="product-card">
      ${cover}
      ${thumbs}
      <div class="product-body">
        <h2>${escapeHtml(product.name)}</h2>
        <p class="product-tagline">${escapeHtml(product.tagline)}</p>
        <p class="product-description">${escapeHtml(product.description)}</p>
        <p class="product-note">${escapeHtml(product.note)}</p>
        ${actionsHtml(product)}
      </div>
    </div>`;
}

// Stripe checkout buttons (one per option) when the product has them,
// otherwise the original email-to-buy button.
function actionsHtml(product) {
  const options = product.options || [];
  if (options.length === 0) {
    return `
        <div class="product-actions">
          <a class="buy-button" href="${mailtoForProduct(product, "Want to buy: ")}">&#9993; Email to buy &rarr;</a>
          <a class="inquire-button" href="${mailtoForProduct(product)}">&#9993; Ask about this</a>
        </div>`;
  }
  const buyButtons = options.map((opt) => `
          <a class="buy-button" href="${opt.url}" rel="noopener">${escapeHtml(opt.label)} &middot; ${formatPrice(opt.price)} &rarr;</a>`).join("");
  return `
        <div class="product-actions">${buyButtons}
          <a class="inquire-button" href="${mailtoForProduct(product)}">&#9993; Ask about this</a>
        </div>
        <p class="shipping-note">${SHIPPING_NOTE}</p>`;
}
