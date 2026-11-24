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
// A product can override it with "shippingNote" in data/products.json (e.g. free-shipping items).
const SHIPPING_NOTE = "$9 flat shipping &middot; contiguous U.S. only (Alaska and Hawaii: email us) &middot; returns accepted except custom engravings";

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
  const images = product.images || [];
  const gallery = images.length ? carouselHtml(product, images) : `<div class="product-cover placeholder">Photos coming soon</div>`;

  return `
    <div class="product-card">
      ${gallery}
      <div class="product-body">
        <h2>${escapeHtml(product.name)}</h2>
        ${priceHtml(product)}
        <p class="product-tagline">${escapeHtml(product.tagline)}</p>
        <details class="product-more">
          <summary>Details</summary>
          <p class="product-description">${escapeHtml(product.description)}</p>
        </details>
        <p class="product-note">${escapeHtml(product.note)}</p>
        ${actionsHtml(product)}
      </div>
    </div>`;
}

// Photo carousel: one slide per photo, whole photo shown (never cropped) over
// a blurred copy of itself. Swipe on phones; arrows and dots elsewhere.
// Wired up by initCarousels() after the cards are on the page.
function carouselHtml(product, images) {
  const name = escapeHtml(product.name);
  const slides = images.map((filename, i) => {
    const src = webPhotoUrl(product, filename);
    return `
        <div class="carousel-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${images.length}">
          <img class="carousel-backdrop" src="${src}" alt="" aria-hidden="true" loading="lazy">
          <img class="carousel-photo" src="${src}" alt="${name}, photo ${i + 1}" loading="${i === 0 ? "eager" : "lazy"}">
        </div>`;
  }).join("");
  const controls = images.length > 1 ? `
      <button type="button" class="carousel-btn prev" aria-label="Previous photo" disabled>&#8249;</button>
      <button type="button" class="carousel-btn next" aria-label="Next photo">&#8250;</button>
      <div class="carousel-dots">${images.map((_, i) => `<button type="button" class="carousel-dot" aria-label="Photo ${i + 1}"${i === 0 ? ' aria-current="true"' : ""}></button>`).join("")}</div>
      <span class="carousel-count">1 / ${images.length}</span>` : "";
  return `
    <div class="carousel" aria-roledescription="carousel" aria-label="${name} photos">
      <div class="carousel-track" tabindex="0">${slides}
      </div>${controls}
    </div>`;
}

function initCarousels(root = document) {
  root.querySelectorAll(".carousel").forEach((car) => {
    const track = car.querySelector(".carousel-track");
    const slides = car.querySelectorAll(".carousel-slide");
    const dots = car.querySelectorAll(".carousel-dot");
    const prev = car.querySelector(".prev"), next = car.querySelector(".next");
    const count = car.querySelector(".carousel-count");
    if (slides.length < 2) return;
    const go = (i) => track.scrollTo({ left: Math.max(0, Math.min(i, slides.length - 1)) * track.clientWidth, behavior: "smooth" });
    const current = () => Math.round(track.scrollLeft / track.clientWidth);
    function update() {
      const i = current();
      dots.forEach((d, j) => (j === i ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current")));
      prev.disabled = i === 0;
      next.disabled = i === slides.length - 1;
      count.textContent = `${i + 1} / ${slides.length}`;
    }
    let t;
    track.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(update, 60); }, { passive: true });
    prev.addEventListener("click", () => go(current() - 1));
    next.addEventListener("click", () => go(current() + 1));
    dots.forEach((d, j) => d.addEventListener("click", () => go(j)));
    track.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); go(current() - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(current() + 1); }
    });
  });
}

// "$12.00", or "From $19.75" when options are priced differently. Products
// without checkout options get no price line (they're email-to-buy).
function priceHtml(product) {
  const prices = (product.options || []).map((opt) => opt.price);
  if (prices.length === 0) {
    // Email-to-buy items can still list a price ("price" in products.json),
    // with an optional unit ("each") and their own shipping charge.
    if (typeof product.price !== "number") return "";
    const unit = product.priceUnit ? ` <span class="price-unit">${escapeHtml(product.priceUnit)}</span>` : "";
    const ship = typeof product.shipping === "number" ? `<span class="price-ship">+ ${formatPrice(product.shipping)} shipping</span>` : "";
    return `<p class="product-price">${formatPrice(product.price)}${unit}${ship}</p>`;
  }
  const low = Math.min(...prices);
  const label = prices.some((p) => p !== low) ? `From ${formatPrice(low)}` : formatPrice(low);
  return `<p class="product-price">${label}</p>`;
}

// schema.org ItemList of Products for store/index.html's JSON-LD block.
function productsJsonLd(products) {
  const base = "https://4aholdingscompany.com/store/";
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: products.map((p, i) => {
      const prices = (p.options || []).map((opt) => opt.price);
      const item = {
        "@type": "Product",
        name: p.name,
        description: p.description,
        brand: { "@type": "Brand", name: "4A Holdings Company" },
        image: p.images.map((f) => base + webPhotoUrl(p, f)),
      };
      if (!prices.length && typeof p.price === "number") prices.push(p.price);
      if (prices.length) {
        item.offers = {
          "@type": "AggregateOffer",
          priceCurrency: "USD",
          lowPrice: Math.min(...prices).toFixed(2),
          highPrice: Math.max(...prices).toFixed(2),
          offerCount: prices.length,
          availability: "https://schema.org/InStock",
        };
      }
      return { "@type": "ListItem", position: i + 1, item };
    }),
  };
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
        <p class="shipping-note">${product.shippingNote || SHIPPING_NOTE}</p>`;
}
