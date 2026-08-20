(function () {
  "use strict";

  var trustBadgeEl = document.getElementById("trust-badge-count");
  var statStripEl = document.getElementById("stat-strip-count");
  if ((!trustBadgeEl && !statStripEl) || !window.supabaseClient) return;

  window.supabaseClient
    .from("directory_listings")
    .select("id", { count: "exact", head: true })
    .then(function (res) {
      if (res.error || typeof res.count !== "number") return;
      if (trustBadgeEl) trustBadgeEl.textContent = res.count;
      if (statStripEl) statStripEl.textContent = res.count;
    });
})();
