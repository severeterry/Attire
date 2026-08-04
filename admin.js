(function () {
  "use strict";

  var sb = window.supabaseClient;
  var applications = [];
  var filterState = "pending";
  var candidates = [];
  var candidatesFilterState = "pending";

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function labelForCategory(cat) {
    var map = {
      materials: "Materials & Making",
      circularity: "Circularity & Disposal",
      strategy: "Strategy & Expertise",
      advocacy: "Advocacy & Community",
      retail: "Retail & Creators",
    };
    return map[cat] || cat;
  }

  function relativeTime(ts) {
    var diff = Math.max(0, Date.now() - ts);
    var min = Math.round(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + "m";
    var hr = Math.round(min / 60);
    if (hr < 24) return hr + "h";
    return Math.round(hr / 24) + "d";
  }

  async function fetchApplications() {
    var query = sb.from("membership_applications").select("*").order("created_at", { ascending: false });
    if (filterState !== "all") query = query.eq("status", filterState);
    var res = await query;
    if (res.error) { console.error(res.error); return []; }
    return res.data;
  }

  function applicationCardHtml(app) {
    var actions = "";
    if (app.status === "pending") {
      actions =
        '<div style="display:flex; gap:0.5rem; margin-top:0.75rem;">' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="approve" data-id="' + app.id + '">Approve</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-action="reject" data-id="' + app.id + '">Reject</button>' +
        "</div>" +
        '<p class="login-error" data-error-for="' + app.id + '" hidden></p>';
    } else {
      var statusLabel = app.status === "approved" ? "Approved" : "Rejected";
      actions = '<p class="settings-note" style="font-weight:700; margin-top:0.5rem;">' + statusLabel +
        (app.reviewed_at ? " " + relativeTime(new Date(app.reviewed_at).getTime()) + " ago" : "") + "</p>";
    }

    return (
      '<div class="post-card">' +
      '<div class="post-head" style="justify-content:space-between;">' +
      '<div><p class="post-author-name">' + escapeHtml(app.org_name) + "</p>" +
      '<div class="post-meta-row"><span>' + escapeHtml(app.contact_name) + "</span><span>&middot;</span><span>" + escapeHtml(app.email) + "</span></div>" +
      "</div>" +
      '<span class="cat-badge" data-cat="' + app.category + '">' + escapeHtml(labelForCategory(app.category)) + "</span>" +
      "</div>" +
      '<p class="post-body">' + escapeHtml(app.pitch) + "</p>" +
      '<p class="settings-note">' +
      [app.borough, app.website ? '<a href="' + escapeHtml(app.website) + '" target="_blank" rel="noopener">' + escapeHtml(app.website) + "</a>" : null]
        .filter(Boolean).join(" &middot; ") +
      " &mdash; submitted " + relativeTime(new Date(app.created_at).getTime()) + " ago</p>" +
      actions +
      "</div>"
    );
  }

  function renderList() {
    var listEl = document.getElementById("applications-list");
    var emptyEl = document.getElementById("applications-empty");
    listEl.innerHTML = applications.length ? applications.map(applicationCardHtml).join("") : "";
    emptyEl.hidden = applications.length !== 0;

    var countEl = document.getElementById("pending-count");
    if (filterState === "pending") {
      countEl.textContent = applications.length + (applications.length === 1 ? " pending application" : " pending applications");
    } else {
      countEl.textContent = applications.length + (applications.length === 1 ? " application" : " applications");
    }
  }

  async function reload() {
    applications = await fetchApplications();
    renderList();
  }

  // ---- Directory candidates (automated-sweep review queue) ----

  function slugify(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  function dataJsSnippet(c) {
    var lines = [
      "  {",
      '    id: "' + slugify(c.name) + '",',
      '    name: "' + c.name.replace(/"/g, '\\"') + '",',
      '    category: "' + c.category + '",',
    ];
    if (c.subcategory) lines.push('    subcategory: "' + c.subcategory.replace(/"/g, '\\"') + '",');
    lines.push('    borough: "' + (c.borough || "NYC Presence").replace(/"/g, '\\"') + '",');
    lines.push("    verified: false,");
    lines.push('    description: "' + c.description.replace(/"/g, '\\"') + '",');
    if (c.good_to_know) lines.push('    goodToKnow: "' + c.good_to_know.replace(/"/g, '\\"') + '",');
    lines.push("  },");
    return lines.join("\n");
  }

  async function fetchCandidates() {
    var query = sb.from("directory_candidates").select("*").order("discovered_at", { ascending: false });
    if (candidatesFilterState !== "all") query = query.eq("status", candidatesFilterState);
    var res = await query;
    if (res.error) { console.error(res.error); return []; }
    return res.data;
  }

  function candidateCardHtml(c) {
    var actions = "";
    if (c.status === "pending") {
      actions =
        '<div style="display:flex; gap:0.5rem; margin-top:0.75rem;">' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="approve-candidate" data-id="' + c.id + '">Approve</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-action="reject-candidate" data-id="' + c.id + '">Reject</button>' +
        "</div>" +
        '<p class="login-error" data-cand-error-for="' + c.id + '" hidden></p>';
    } else {
      var statusLabel = c.status === "approved" ? "Approved" : "Rejected";
      actions = '<p class="settings-note" style="font-weight:700; margin-top:0.5rem;">' + statusLabel +
        (c.reviewed_at ? " " + relativeTime(new Date(c.reviewed_at).getTime()) + " ago" : "") + "</p>";
      if (c.status === "approved") {
        actions += '<pre style="white-space:pre-wrap; font-size:0.78rem; background:var(--color-cream); border:1px solid var(--color-border); border-radius:var(--radius-sm); padding:0.6rem; margin-top:0.5rem;">' +
          escapeHtml(dataJsSnippet(c)) + "</pre>" +
          '<p class="settings-note">Paste this into <code>data.js</code>\'s <code>LISTINGS</code> array to actually publish it.</p>';
      }
    }

    return (
      '<div class="post-card">' +
      '<div class="post-head" style="justify-content:space-between;">' +
      '<div><p class="post-author-name">' + escapeHtml(c.name) + "</p>" +
      '<div class="post-meta-row"><span>' + escapeHtml(c.borough || "Borough unknown") + "</span>" +
      (c.source_url ? '<span>&middot;</span><a href="' + escapeHtml(c.source_url) + '" target="_blank" rel="noopener">source</a>' : "") +
      "</div></div>" +
      '<span class="cat-badge" data-cat="' + c.category + '">' + escapeHtml(labelForCategory(c.category)) + "</span>" +
      "</div>" +
      '<p class="post-body">' + escapeHtml(c.description) + "</p>" +
      (c.good_to_know ? '<p class="settings-note">' + escapeHtml(c.good_to_know) + "</p>" : "") +
      '<p class="settings-note">Discovered ' + relativeTime(new Date(c.discovered_at).getTime()) + " ago</p>" +
      actions +
      "</div>"
    );
  }

  function renderCandidatesList() {
    var listEl = document.getElementById("candidates-list");
    var emptyEl = document.getElementById("candidates-empty");
    listEl.innerHTML = candidates.length ? candidates.map(candidateCardHtml).join("") : "";
    emptyEl.hidden = candidates.length !== 0;

    var countEl = document.getElementById("candidates-count");
    countEl.textContent = candidates.length + (candidates.length === 1 ? " candidate" : " candidates");
  }

  async function reloadCandidates() {
    candidates = await fetchCandidates();
    renderCandidatesList();
  }

  document.addEventListener("DOMContentLoaded", async function () {
    if (!window.AttireAuth) return;
    var session = await window.AttireAuth.getSession();
    if (!session) {
      window.location.href = "index.html";
      return;
    }
    var profile = await window.AttireAuth.getCurrentProfile();
    if (!profile || !profile.isAdmin) {
      document.getElementById("admin-denied").hidden = false;
      return;
    }

    document.getElementById("admin-content").hidden = false;
    await reload();

    document.getElementById("status-filter").addEventListener("change", function (e) {
      filterState = e.target.value;
      reload();
    });

    document.getElementById("applications-list").addEventListener("click", function (e) {
      var approveBtn = e.target.closest('[data-action="approve"]');
      var rejectBtn = e.target.closest('[data-action="reject"]');
      var btn = approveBtn || rejectBtn;
      if (!btn) return;

      btn.disabled = true;
      var newStatus = approveBtn ? "approved" : "rejected";
      sb.from("membership_applications")
        .update({ status: newStatus, reviewed_at: new Date().toISOString() })
        .eq("id", btn.dataset.id)
        .then(function (res) {
          if (res.error) {
            var errEl = document.querySelector('[data-error-for="' + btn.dataset.id + '"]');
            if (errEl) { errEl.textContent = res.error.message; errEl.hidden = false; }
            btn.disabled = false;
            return;
          }
          reload();
        });
    });

    // ---- Tab switching ----
    var tabButtons = document.querySelectorAll("[data-tab-btn]");
    tabButtons.forEach(function (tabBtn) {
      tabBtn.addEventListener("click", function () {
        tabButtons.forEach(function (b) { b.setAttribute("aria-pressed", b === tabBtn ? "true" : "false"); });
        document.getElementById("tab-applications").hidden = tabBtn.dataset.tabBtn !== "applications";
        document.getElementById("tab-candidates").hidden = tabBtn.dataset.tabBtn !== "candidates";
        if (tabBtn.dataset.tabBtn === "candidates" && !candidates.length) reloadCandidates();
      });
    });

    document.getElementById("candidates-status-filter").addEventListener("change", function (e) {
      candidatesFilterState = e.target.value;
      reloadCandidates();
    });

    document.getElementById("candidates-list").addEventListener("click", function (e) {
      var approveBtn = e.target.closest('[data-action="approve-candidate"]');
      var rejectBtn = e.target.closest('[data-action="reject-candidate"]');
      var btn = approveBtn || rejectBtn;
      if (!btn) return;

      btn.disabled = true;
      var newStatus = approveBtn ? "approved" : "rejected";
      sb.from("directory_candidates")
        .update({ status: newStatus, reviewed_at: new Date().toISOString() })
        .eq("id", btn.dataset.id)
        .then(function (res) {
          if (res.error) {
            var errEl = document.querySelector('[data-cand-error-for="' + btn.dataset.id + '"]');
            if (errEl) { errEl.textContent = res.error.message; errEl.hidden = false; }
            btn.disabled = false;
            return;
          }
          reloadCandidates();
        });
    });
  });
})();
