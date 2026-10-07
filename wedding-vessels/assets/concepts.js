function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tileHtml(c) {
  return `<figure class="tile" data-image="${esc(c.image)}">
    <div class="img"><img src="assets/images/${esc(c.image)}" alt="${esc(c.title)}" loading="lazy"></div>
    <figcaption><h3>${esc(c.title)}</h3><p>${esc(c.description)}</p></figcaption>
  </figure>`;
}

fetch("data/concepts.json").then((r) => r.json()).then((data) => {
  document.getElementById("vessel-grid").innerHTML = data.vessels.map(tileHtml).join("");
  document.getElementById("interface-grid").innerHTML = data.interfaces.map(tileHtml).join("");
  document.getElementById("color-grid").innerHTML = data.colors.map(tileHtml).join("");
  const box = document.getElementById("lightbox");
  document.addEventListener("click", (e) => {
    const tile = e.target.closest(".tile");
    if (!tile) return;
    box.querySelector("img").src = "assets/images/" + tile.dataset.image;
    box.classList.add("open");
  });
  box.addEventListener("click", () => box.classList.remove("open"));
}).catch((err) => {
  console.error("Could not load data/concepts.json:", err);
  document.getElementById("vessel-grid").textContent = "Couldn't load the renderings. Please refresh.";
});
