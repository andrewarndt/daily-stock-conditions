// Shared cross-section links, appended to the bottom of every page so a
// visitor can move between sections (store -> wildlife, etc.) without going
// back through the homepage. Edit the list here, not per-page. Paths are
// root-relative, so this works from any section folder.
(function () {
  var LINKS = [
    ["/", "Home"],
    ["/vending/", "Vending"],
    ["/store/", "Store"],
    ["/wedding-vessels/", "Event Centerpieces"],
    ["/wildlife/", "Wildlife"],
    ["/market_report/", "Market Report"],
  ];
  var EMAIL = "4aholdingscompany@gmail.com";

  var css =
    ".site-links{--sl-bg:#f6f3ec;--sl-fg:#1b1b1a;--sl-muted:#77756f;--sl-rule:#e4e1da;--sl-gold:#b08040;" +
    "background:var(--sl-bg);border-top:1px solid var(--sl-rule);color:var(--sl-fg);" +
    "font:0.875rem/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}" +
    "@media (prefers-color-scheme:dark){.site-links{--sl-bg:#121211;--sl-fg:#eeece7;--sl-muted:#8f8c85;--sl-rule:#2b2a28;--sl-gold:#c79a58;}}" +
    ".site-links-inner{max-width:62rem;margin:0 auto;padding:1.5rem 1rem;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem 1.5rem;}" +
    ".site-links-brand{display:flex;align-items:center;gap:.6rem;color:inherit;text-decoration:none;font-family:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;font-size:1.05rem;}" +
    ".site-links-brand img{width:1.9rem;height:auto;}" +
    ".site-links ul{display:flex;flex-wrap:wrap;gap:.35rem 1.1rem;margin:0;padding:0;list-style:none;}" +
    ".site-links ul a{color:var(--sl-muted);text-decoration:none;}" +
    ".site-links ul a:hover,.site-links ul a:focus-visible,.site-links ul a[aria-current]{color:var(--sl-gold);}" +
    ".site-links-contact{flex-basis:100%;margin:0;color:var(--sl-muted);font-size:0.78rem;}" +
    ".site-links-contact a{color:var(--sl-gold);text-decoration:none;}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var here = location.pathname.replace(/index\.html$/, "");
  var items = LINKS.map(function (l) {
    var current = l[0] === "/" ? here === "/" : here.indexOf(l[0]) === 0;
    return '<li><a href="' + l[0] + '"' + (current ? ' aria-current="page"' : "") + ">" + l[1] + "</a></li>";
  }).join("");

  var nav = document.createElement("nav");
  nav.className = "site-links";
  nav.setAttribute("aria-label", "4A Holdings sections");
  nav.innerHTML =
    '<div class="site-links-inner">' +
    '<a class="site-links-brand" href="/"><img src="/images/logo-mark.png" alt="" width="608" height="493">4A Holdings Company</a>' +
    "<ul>" + items + "</ul>" +
    '<p class="site-links-contact">&copy; ' + new Date().getFullYear() +
    ' 4A Holdings Company &middot; <a href="mailto:' + EMAIL + '">' + EMAIL + "</a></p>" +
    "</div>";
  document.body.appendChild(nav);
})();
