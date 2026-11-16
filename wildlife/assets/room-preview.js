// "See it on your wall": shows the photo as a framed print, to scale, in a
// living room or an office (photo.html).
//
// Room photos are from Unsplash (free under the Unsplash License):
//   living-room.jpg  https://unsplash.com/photos/upT3v0yLnvk
//   office.jpg       https://unsplash.com/photos/g08OBP0bxcc
//
// Each room was measured once, in the room photo's own pixels:
//   ppi     pixels per inch on the wall, from furniture of known size
//           (an 84-inch three-seat sofa; a 48-inch work table)
//   cx      horizontal center to hang the print on
//   bottom  where the print's bottom edge sits (a few inches above the
//           sofa back / the monitor)
//   crop    the part of the room photo shown: [x, y, width, height]
const ROOMS = {
  living: {
    label: "Living room",
    src: "assets/rooms/living-room.jpg",
    crop: [0, 0, 1600, 1450],
    ppi: 14.1,
    cx: 802,
    bottom: 623,
    note: "Shown to scale above a standard 84-inch sofa.",
  },
  office: {
    label: "Office",
    src: "assets/rooms/office.jpg",
    crop: [0, 320, 1600, 1900],
    ppi: 16.25,
    cx: 840,
    bottom: 1335,
    note: "Shown to scale above a standard 48-inch desk.",
  },
};

// Print sizes in inches (short side, long side).
// (40x60 left out: it outgrows both room photos.)
const ROOM_SIZES = [[8, 10], [11, 14], [16, 20], [20, 30], [24, 36], [30, 40]];
const FRAME_IN = 0; // no frame: the print hangs bare (set inches here to add one)

function initRoomPreview(section, photoSrc) {
  const stage = section.querySelector(".room-stage");
  const bg = section.querySelector(".room-bg");
  const print = section.querySelector(".room-print");
  const printImg = print.querySelector("img");
  const note = section.querySelector(".room-note");
  const tabs = section.querySelector(".room-tabs");
  const chips = section.querySelector(".room-sizes");
  const orient = section.querySelector(".room-orient");
  let room = "living", size = 2, landscape = true;

  // Size labels read width x height for the chosen orientation.
  const sizeLabel = ([a, b]) => (landscape ? `${b}×${a}` : `${a}×${b}`);
  function drawChips() {
    chips.innerHTML = ROOM_SIZES.map((sz, i) =>
      `<button type="button" data-size="${i}" aria-pressed="${i === size}">${sizeLabel(sz)}</button>`).join("");
    orient.querySelectorAll("button").forEach((o) => o.setAttribute("aria-pressed", String((o.dataset.orient === "landscape") === landscape)));
  }
  orient.innerHTML = '<button type="button" data-orient="portrait">Portrait</button><button type="button" data-orient="landscape">Landscape</button>';

  tabs.innerHTML = Object.keys(ROOMS).map((id) =>
    `<button type="button" role="tab" data-room="${id}" aria-selected="${id === room}">${ROOMS[id].label}</button>`).join("");
  drawChips();

  function layout() {
    const r = ROOMS[room];
    const [x0, y0, cw, ch] = r.crop;
    const [a, b] = ROOM_SIZES[size];
    const wIn = landscape ? b : a, hIn = landscape ? a : b;
    const w = (wIn + 2 * FRAME_IN) * r.ppi, h = (hIn + 2 * FRAME_IN) * r.ppi;
    // the room photo, scaled so the crop fills the stage
    stage.style.aspectRatio = `${cw} / ${ch}`;
    bg.style.width = (100 * bg.naturalWidth / cw) + "%";
    bg.style.left = (-100 * x0 / cw) + "%";
    bg.style.top = (-100 * y0 / ch) + "%";
    // the framed print
    print.style.width = (100 * w / cw) + "%";
    print.style.height = (100 * h / ch) + "%";
    print.style.left = (100 * (r.cx - w / 2 - x0) / cw) + "%";
    print.style.top = (100 * (r.bottom - h - y0) / ch) + "%";
    print.style.borderWidth = (FRAME_IN * r.ppi * stage.clientWidth / cw) + "px";
    const tooTall = r.bottom - h < y0;
    note.textContent = `${sizeLabel(ROOM_SIZES[size])} in ${landscape ? "landscape" : "portrait"} print. ${r.note}` + (tooTall ? " At this size it is taller than the wall shown." : "");
  }

  function setRoom(id) {
    room = id;
    tabs.querySelectorAll("button").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.room === id)));
    if (bg.getAttribute("src") !== ROOMS[id].src) bg.src = ROOMS[id].src;
    if (bg.complete && bg.naturalWidth) layout();
  }

  tabs.addEventListener("click", (e) => { const t = e.target.closest("button"); if (t) setRoom(t.dataset.room); });
  chips.addEventListener("click", (e) => {
    const c = e.target.closest("button");
    if (!c) return;
    size = Number(c.dataset.size);
    chips.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === c)));
    layout();
  });
  orient.addEventListener("click", (e) => {
    const o = e.target.closest("button");
    if (!o) return;
    landscape = o.dataset.orient === "landscape";
    drawChips();
    layout();
  });
  bg.addEventListener("load", layout);
  printImg.addEventListener("load", () => {
    landscape = printImg.naturalWidth >= printImg.naturalHeight;
    drawChips();
    layout();
  });
  new ResizeObserver(() => { if (bg.naturalWidth) layout(); }).observe(stage);

  printImg.src = photoSrc;
  setRoom(room);
  section.hidden = false;

  return {
    // e.g. "20×16 in landscape, living room": what the visitor last looked at
    describe: () => `${sizeLabel(ROOM_SIZES[size])} in ${landscape ? "landscape" : "portrait"}, ${ROOMS[room].label.toLowerCase()}`,
  };
}
