(function () {
  "use strict";

  var sb = window.supabaseClient;
  var profile = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var NOTIFICATION_META = {
    thread_expiring_soon: function (p) { return { label: "A conversation is about to expire from inactivity", href: "thread.html?id=" + p.thread_id }; },
    intro_request_reminder: function () { return { label: "You have a pending introduction request waiting on you", href: "intros.html" }; },
    intro_request_received: function () { return { label: "Someone requested an introduction to you", href: "intros.html" }; },
    intro_request_accepted: function (p) { return { label: "Your introduction request was accepted", href: "thread.html?id=" + p.thread_id }; },
    new_rfp_match: function () { return { label: "A new post matching your category was posted to The Exchange", href: "member-portal.html?view=deal" }; },
    rfp_cap_warning: function (p) { return { label: "You have " + p.posts_remaining + " Exchange posts left this month", href: "member-portal.html?view=deal" }; },
    pool_new_participant: function (p) { return { label: "Someone requested to join a Co-Op you organized", href: "pooling.html?id=" + p.pooling_thread_id }; },
    pool_added_by_organizer: function (p) { return { label: "You were added to a Co-Op", href: "pooling.html?id=" + p.pooling_thread_id }; },
    pool_ready: function (p) { return { label: "Your Co-Op reached its minimum — the group chat is ready", href: "thread.html?id=" + p.thread_id }; },
    pool_closing_soon: function (p) { return { label: "A Co-Op you joined is closing soon", href: "pooling.html?id=" + p.pooling_thread_id }; },
    weekly_digest: function () { return { label: "Your weekly Exchange digest is ready", href: "member-portal.html?view=deal" }; },
  };

  async function loadNotifications() {
    var res = await sb
      .from("notifications")
      .select("id, type, payload, read_at, created_at")
      .eq("profile_id", profile.id)
      .order("created_at", { ascending: false });

    var listEl = document.getElementById("notifications-list");
    if (res.error) {
      listEl.innerHTML = '<p class="settings-note">' + escapeHtml(res.error.message) + "</p>";
      return;
    }
    if (!res.data.length) {
      listEl.innerHTML = '<p class="settings-note">Nothing yet.</p>';
      return;
    }

    listEl.innerHTML = res.data.map(function (n) {
      var metaFn = NOTIFICATION_META[n.type];
      var meta = metaFn ? metaFn(n.payload || {}) : { label: n.type, href: "member-portal.html" };
      var isRead = !!n.read_at;
      return (
        '<article class="post-card" style="opacity:' + (isRead ? "0.75" : "1") + ';" data-id="' + n.id + '">' +
        '<a href="' + meta.href + '" class="post-body" style="display:flex; align-items:flex-start; gap:0.5rem;">' +
        (isRead ? "" : '<span class="active-thread-unread" aria-hidden="true" title="Unread" style="margin-top:0.4rem;"></span>') +
        "<span>" + escapeHtml(meta.label) + "</span></a>" +
        '<p class="settings-note">' + new Date(n.created_at).toLocaleString() + "</p>" +
        (isRead ? "" : '<button type="button" class="btn btn-outline btn-sm" data-action="mark-read" data-id="' + n.id + '">Mark as read</button>') +
        "</article>"
      );
    }).join("");
  }

  document.addEventListener("DOMContentLoaded", async function () {
    if (!window.AttireAuth) return;
    var session = await window.AttireAuth.getSession();
    if (!session) {
      window.location.href = "index.html";
      return;
    }
    profile = await window.AttireAuth.getCurrentProfile();
    if (!profile) {
      window.location.href = "index.html";
      return;
    }

    var prefsRes = await sb.from("notification_preferences").select("email_digest_enabled").eq("profile_id", profile.id).maybeSingle();
    var digestEnabled = prefsRes.data ? prefsRes.data.email_digest_enabled : true;

    var digestStatus = document.getElementById("digest-status");
    var digestBtn = document.getElementById("digest-toggle-btn");
    function renderDigestUi() {
      digestStatus.textContent = "Weekly digest notifications: " + (digestEnabled ? "on" : "off");
      digestBtn.textContent = digestEnabled ? "Turn off" : "Turn on";
    }
    renderDigestUi();

    digestBtn.addEventListener("click", function () {
      digestBtn.disabled = true;
      sb.from("notification_preferences").update({ email_digest_enabled: !digestEnabled }).eq("profile_id", profile.id).then(function (res) {
        digestBtn.disabled = false;
        if (!res.error) {
          digestEnabled = !digestEnabled;
          renderDigestUi();
        }
      });
    });

    await loadNotifications();

    document.getElementById("notifications-list").addEventListener("click", function (e) {
      var btn = e.target.closest('[data-action="mark-read"]');
      if (!btn) return;
      e.preventDefault();
      sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", btn.dataset.id).then(function () {
        loadNotifications();
      });
    });

    document.getElementById("mark-all-read-btn").addEventListener("click", function () {
      sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("profile_id", profile.id).is("read_at", null).then(function () {
        loadNotifications();
      });
    });
  });
})();
