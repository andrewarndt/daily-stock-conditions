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
