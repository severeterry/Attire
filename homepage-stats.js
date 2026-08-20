(function () {
  "use strict";

  var countEl = document.getElementById("trust-badge-count");
  if (!countEl || !window.supabaseClient) return;

  window.supabaseClient
    .from("directory_listings")
    .select("id", { count: "exact", head: true })
    .then(function (res) {
      if (res.error || typeof res.count !== "number") return;
      countEl.textContent = res.count;
    });
})();
