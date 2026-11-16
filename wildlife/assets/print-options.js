// Paper & mounting -> size & price dropdowns, shared by order.html and
// photo.html. Prices come from data/print-prices.json, which
// scripts/build-print-prices.py builds from the WHCC cost spreadsheet
// (selling prices, margin already added). Pick a paper & mounting first; the
// size list then shows only the sizes offered for that mounting, each with
// its price.
//
// The form needs: <select name="mounting">, <select name="size">, and two
// <p> elements for the price line and the custom-order note.

const PRINT_CUSTOM = "custom";

function printMoney(n) {
  return "$" + n.toFixed(2);
}

function initPrintOptions(form, priceEl, noteEl) {
  const mountingEl = form.elements.mounting, sizeEl = form.elements.size;
  let priceList = null;

  function mountingLabel() {
    const m = priceList && priceList.mountings.find((x) => x.id === mountingEl.value);
    return m ? m.label : "Custom order";
  }
  function selectedPrice() {
    const s = priceList && priceList.sizes.find((x) => x.size === sizeEl.value);
    return s ? s.prices[mountingEl.value] : null;
  }
  function fillSizes() {
    const mid = mountingEl.value;
    priceEl.hidden = true;
    noteEl.hidden = mid !== PRINT_CUSTOM;
    noteEl.textContent = "I'll contact you to talk through a custom order (other sizes, acrylic, framing...). Add the details in the notes below.";
    if (mid === PRINT_CUSTOM) {
      sizeEl.innerHTML = '<option value="custom" selected>Custom size (quoted)</option>';
      sizeEl.disabled = false;
      return;
    }
    const sizes = priceList.sizes.filter((s) => s.prices[mid] != null);
    sizeEl.innerHTML = '<option value="" selected disabled>Choose a size</option>' +
      sizes.map((s) => `<option value="${escapeHtml(s.size)}">${escapeHtml(s.size)} in — ${printMoney(s.prices[mid])}</option>`).join("");
    sizeEl.disabled = false;
  }
  function showPrice() {
    const p = selectedPrice();
    priceEl.hidden = p == null;
    if (p != null) priceEl.innerHTML = `Print price: <strong>${printMoney(p)}</strong> <span class="opt">(shipping confirmed by email)</span>`;
  }
  function reset() {
    sizeEl.innerHTML = '<option value="" selected disabled>Choose a mounting first</option>';
    sizeEl.disabled = true;
    priceEl.hidden = true;
    noteEl.hidden = true;
  }
  mountingEl.addEventListener("change", fillSizes);
  sizeEl.addEventListener("change", showPrice);

  fetch("data/print-prices.json?v=" + Date.now().toString().slice(0, -5))
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((data) => {
      priceList = data;
      const groups = {};
      data.mountings.forEach((m) => { (groups[m.group] = groups[m.group] || []).push(m); });
      mountingEl.innerHTML = '<option value="" selected disabled>Choose paper &amp; mounting</option>' +
        Object.keys(groups).map((g) => `<optgroup label="${escapeHtml(g)}">` +
          groups[g].map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join("") + "</optgroup>").join("") +
        `<option value="${PRINT_CUSTOM}">Something else — contact me for a quote</option>`;
    })
    .catch((err) => {
      console.error("Failed to load print prices:", err);
      mountingEl.innerHTML = `<option value="${PRINT_CUSTOM}" selected>Contact me for a quote</option>`;
      fillSizes();
    });

  return {
    isCustom: () => mountingEl.value === PRINT_CUSTOM,
    mountingLabel,
    selectedPrice,
    reset,
  };
}
