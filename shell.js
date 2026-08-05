/**
 * Shared app-shell chrome for every app-shell page: sidebar account
 * switcher + topbar messages/notifications dropdowns. Relies on
 * profile-data.js, portal-data.js, supabase-client.js and auth.js
 * already being loaded.
 */
(function () {
  "use strict";

  var sb = window.supabaseClient;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function initials(name) {
    var parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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

  function avatarHtml(name, category, avatarUrl) {
    if (avatarUrl) return '<span class="portal-avatar portal-avatar-img"><img src="' + escapeHtml(avatarUrl) + '" alt=""></span>';
    return '<span class="portal-avatar"' + (category ? ' data-cat="' + category + '"' : "") + ">" + escapeHtml(initials(name)) + "</span>";
  }

  // Real notification types, mirrored from notifications.js's NOTIFICATION_META
  // (kept as its own copy here rather than a shared import, matching this
  // codebase's established no-shared-modules convention).
  var NOTIFICATION_META = {
    thread_expiring_soon: function (p) { return { label: "A conversation is about to expire from inactivity", href: "thread.html?id=" + p.thread_id }; },
    intro_request_reminder: function () { return { label: "You have a pending introduction request waiting on you", href: "intros.html" }; },
    new_rfp_match: function () { return { label: "A new post matching your category was posted to The Exchange", href: "member-portal.html?view=deal" }; },
    rfp_cap_warning: function (p) { return { label: "You have " + p.posts_remaining + " Exchange posts left this month", href: "member-portal.html?view=deal" }; },
    pool_new_participant: function (p) { return { label: "Someone joined a Co-Op you organized", href: "pooling.html?id=" + p.pooling_thread_id }; },
    pool_ready: function (p) { return { label: "Your Co-Op reached its minimum — the group chat is ready", href: "thread.html?id=" + p.thread_id }; },
    pool_closing_soon: function (p) { return { label: "A Co-Op you joined is closing soon", href: "pooling.html?id=" + p.pooling_thread_id }; },
    weekly_digest: function () { return { label: "Your weekly Exchange digest is ready", href: "member-portal.html?view=deal" }; },
  };

  // Aggregates every real, active thread the caller is in — plain DMs,
  // Exchange (rfp_post_id set), and Co-Op (referenced by a pooling_threads
  // row) — into one list for the topbar preview. Mirrors the per-type fetch
  // functions already proven in messages.js/portal.js/pooling.js.
  async function fetchThreadsSummary(profile) {
    var tpRes = await sb.from("thread_participants").select("thread_id, last_read_at").eq("profile_id", profile.id);
    var rows = tpRes.data || [];
    if (!rows.length) return [];
    var lastReadByThread = {};
    rows.forEach(function (r) { lastReadByThread[r.thread_id] = r.last_read_at; });
    var threadIds = rows.map(function (r) { return r.thread_id; });

    var threadsRes = await sb.from("threads").select("id, rfp_post_id, status, last_message_at").in("id", threadIds).eq("status", "active");
    var threads = threadsRes.data || [];
    if (!threads.length) return [];
    var allIds = threads.map(function (t) { return t.id; });

    var poolRes = await sb.from("pooling_threads").select("chat_thread_id, title, profiles(org_name, contact_name, category, avatar_url)").in("chat_thread_id", allIds);
    var poolByThread = {};
    (poolRes.data || []).forEach(function (p) { poolByThread[p.chat_thread_id] = p; });

    var introRes = await sb.from("intro_requests").select("chat_thread_id").in("chat_thread_id", allIds);
    var introThreadIds = new Set((introRes.data || []).map(function (r) { return r.chat_thread_id; }));

    var otherRes = await sb.from("thread_participants").select("thread_id, profiles(org_name, contact_name, category, avatar_url)")
      .in("thread_id", allIds).neq("profile_id", profile.id);
    var otherByThread = {};
    (otherRes.data || []).forEach(function (r) { if (!otherByThread[r.thread_id]) otherByThread[r.thread_id] = r.profiles; });

    var lastMsgRes = await sb.from("messages").select("thread_id, body, image_url, created_at").in("thread_id", allIds).order("created_at", { ascending: false });
    var lastMsgByThread = {};
    (lastMsgRes.data || []).forEach(function (m) { if (!lastMsgByThread[m.thread_id]) lastMsgByThread[m.thread_id] = m; });

    var result = [];
    for (var i = 0; i < threads.length; i++) {
      var t = threads[i];
      var pool = poolByThread[t.id];
      var other = otherByThread[t.id] || {};
      var isCoop = !!pool;
      var isIntro = !isCoop && introThreadIds.has(t.id);
      var label = isCoop ? pool.title : (other.org_name || other.contact_name || "Member");
      var avatarSource = isCoop ? (pool.profiles || {}) : other;
      var href = isCoop ? "pooling.html" : isIntro ? "intros.html" : (t.rfp_post_id ? "thread.html?id=" + encodeURIComponent(t.id) : "messages.html?thread=" + encodeURIComponent(t.id));
      var lastMsg = lastMsgByThread[t.id];
      var unreadRes = await sb.from("messages").select("id", { count: "exact", head: true })
        .eq("thread_id", t.id).neq("sender_id", profile.id).gt("created_at", lastReadByThread[t.id] || "1970-01-01");
      result.push({
        id: t.id, label: label,
        avatarName: isCoop ? (avatarSource.org_name || avatarSource.contact_name || label) : label,
        avatarCategory: avatarSource.category, avatarUrl: avatarSource.avatar_url,
        preview: lastMsg ? (lastMsg.body || (lastMsg.image_url ? "Sent a photo" : "")) : "",
        unread: unreadRes.count || 0, lastMessageAt: t.last_message_at, href: href,
      });
    }
    result.sort(function (a, b) { return new Date(b.lastMessageAt) - new Date(a.lastMessageAt); });
    return result;
  }

  async function fetchRecentNotifications(profile) {
    var res = await sb.from("notifications").select("id, type, payload, read_at, created_at")
      .eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(8);
    return res.data || [];
  }

  document.addEventListener("DOMContentLoaded", async function () {
    if (!window.AttireAuth) return;
    var session = await window.AttireAuth.getSession();
    if (!session) return; // page-level guards handle the redirect

    var profile = await window.AttireAuth.getCurrentProfile();
    if (!profile) return;
    seedConnectionsIfEmpty(profile.name);

    // Sidebar account switcher
    var acctAvatar = document.getElementById("sidebar-account-avatar");
    var acctName = document.getElementById("sidebar-account-name");
    var acctSub = document.getElementById("sidebar-account-sub");
    if (acctAvatar) {
      acctAvatar.classList.toggle("portal-avatar-img", !!profile.avatar);
      acctAvatar.innerHTML = profile.avatar ? '<img src="' + profile.avatar + '" alt="">' : escapeHtml(initials(profile.name));
      if (!profile.avatar && profile.category) acctAvatar.setAttribute("data-cat", profile.category);
    }
    if (acctName) acctName.textContent = profile.name;
    if (acctSub) acctSub.textContent = profile.orgName || (profile.tier ? profile.tier.charAt(0).toUpperCase() + profile.tier.slice(1) + " Plan" : "Member");

    // Logout is already wired globally in auth.js.

    // ---- Messages dropdown ----
    var msgBtn = document.getElementById("topbar-messages-btn");
    var msgDropdown = document.getElementById("messages-dropdown");
    var notifBtn = document.getElementById("topbar-notif-btn");
    var notifDropdown = document.getElementById("notifications-dropdown");

    function closeDropdowns() {
      if (msgDropdown) msgDropdown.hidden = true;
      if (notifDropdown) notifDropdown.hidden = true;
    }

    async function renderMessagesDropdown() {
      if (!msgDropdown) return;
      var threads = await fetchThreadsSummary(profile);
      var unreadCount = threads.filter(function (t) { return t.unread > 0; }).length;
      var badge = document.getElementById("topbar-messages-badge");
      if (badge) { badge.textContent = String(unreadCount); badge.hidden = unreadCount === 0; }
      var list = document.getElementById("messages-dropdown-list");
      if (!list) return;
      list.innerHTML = threads.length
        ? threads.slice(0, 8).map(function (t) {
            return (
              '<a class="app-list-item" href="' + t.href + '">' +
              avatarHtml(t.avatarName, t.avatarCategory, t.avatarUrl) +
              '<span class="app-list-item-body"><span class="app-list-item-name">' + escapeHtml(t.label) + "</span>" +
              '<span class="app-list-item-preview">' + escapeHtml(t.preview) + "</span></span>" +
              (t.unread > 0 ? '<span class="app-list-item-unread"></span>' : "") +
              "</a>"
            );
          }).join("")
        : '<div class="app-dropdown-empty">No conversations yet.</div>';
    }

    async function renderNotifDropdown() {
      if (!notifDropdown) return;
      var notifs = await fetchRecentNotifications(profile);
      var unreadCount = notifs.filter(function (n) { return !n.read_at; }).length;
      var badge = document.getElementById("topbar-notif-badge");
      if (badge) { badge.textContent = String(unreadCount); badge.hidden = unreadCount === 0; }
      var list = document.getElementById("notifications-dropdown-list");
      if (!list) return;
      list.innerHTML = notifs.length
        ? notifs.map(function (n) {
            var metaFn = NOTIFICATION_META[n.type];
            var meta = metaFn ? metaFn(n.payload || {}) : { label: n.type, href: "notifications.html" };
            return (
              '<a class="app-list-item" href="' + meta.href + '">' +
              '<span class="app-list-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>' +
              '<span class="app-list-item-body"><span class="app-list-item-name" style="font-weight:400;">' + escapeHtml(meta.label) + "</span>" +
              '<span class="app-list-item-preview">' + relativeTime(new Date(n.created_at).getTime()) + " ago</span></span>" +
              (n.read_at ? "" : '<span class="app-list-item-unread"></span>') +
              "</a>"
            );
          }).join("")
        : '<div class="app-dropdown-empty">No notifications yet.</div>';
    }

    if (msgBtn && msgDropdown) {
      msgBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var willOpen = msgDropdown.hidden;
        closeDropdowns();
        if (willOpen) { renderMessagesDropdown(); msgDropdown.hidden = false; }
      });
    }
    if (notifBtn && notifDropdown) {
      notifBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var willOpen = notifDropdown.hidden;
        closeDropdowns();
        if (willOpen) { renderNotifDropdown(); notifDropdown.hidden = false; }
      });
    }
    document.addEventListener("click", closeDropdowns);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDropdowns(); });

    if (msgBtn && msgDropdown) renderMessagesDropdown();
    if (notifBtn && notifDropdown) renderNotifDropdown();

    // Sidebar nav active state (data-view links vs current page/query)
    var params = new URLSearchParams(window.location.search);
    var currentView = params.get("view") || (window.location.pathname.indexOf("member-portal") !== -1 ? "feed" : "");
    document.querySelectorAll(".app-sidebar-link[data-view]").forEach(function (link) {
      link.classList.toggle("is-active", link.dataset.view === currentView);
    });

  });
})();
