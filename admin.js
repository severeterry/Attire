(function () {
  "use strict";

  var sb = window.supabaseClient;
  var applications = [];
  var filterState = "pending";

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
  });
})();
