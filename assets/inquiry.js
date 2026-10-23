// Shared sender for the inquiry forms (vending, event centerpieces,
// wildlife). The site is static, so submissions go through FormSubmit,
// which emails them to INQUIRY_TO. Each form carries a hidden "_honey"
// field: people never see it, bots fill it in, and FormSubmit drops those.
(function () {
  var INQUIRY_TO = "4aholdingscompany@gmail.com";

  // fields: plain { label: value } pairs, shown in the email in this order.
  // Resolves on success, rejects with an Error otherwise.
  window.sendInquiry = function (subject, fields, honey) {
    var payload = {};
    Object.keys(fields).forEach(function (k) { payload[k] = fields[k] || "-"; });
    payload._subject = subject;
    payload._template = "table";
    payload._honey = honey || "";
    return fetch("https://formsubmit.co/ajax/" + INQUIRY_TO, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok || String(j.success) !== "true") throw new Error(j.message || "HTTP " + res.status);
      });
    });
  };

  window.sendInquiry.email = INQUIRY_TO;
})();
