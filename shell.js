/**
 * Shared app-shell chrome for member-portal.html and profile.html:
 * sidebar account switcher + topbar messages/notifications dropdowns.
 * Relies on profile-data.js, portal-data.js and auth.js already being loaded.
 */
(function () {
  "use strict";

  // Must match portal.js's DM_STORAGE_KEY — both read/write the same
  // general-DM-threads blob (Deal Board posts now live in Supabase instead).
  var PORTAL_STORAGE_KEY = "attire-portal-dm-v1";

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
    if (avatarUrl) return '<span class="portal-avatar portal-avatar-img"><img src="' + avatarUrl + '" alt=""></span>';
    return '<span class="portal-avatar"' + (category ? ' data-cat="' + category + '"' : "") + ">" + escapeHtml(initials(name)) + "</span>";
  }

  function profileLink(myName, name) {
    return name === myName ? "profile.html" : "profile.html?member=" + encodeURIComponent(name);
  }

  function buildInitialPortalState() {
    var now = Date.now();
    var threads = PORTAL_SEED_THREADS.map(function (t) {
      return {
        id: t.id, name: t.name, category: t.category, unread: t.unread,
        messages: t.messages.map(function (m) { return { from: m.from, text: m.text, createdAt: now - m.ageMs }; }),
      };
    });
    return { threads: threads };
  }

  function loadPortalState() {
    try {
      var raw = localStorage.getItem(PORTAL_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    var fresh = buildInitialPortalState();
    try { localStorage.setItem(PORTAL_STORAGE_KEY, JSON.stringify(fresh)); } catch (e) {}
    return fresh;
  }

  function notifText(n) {
    if (n.type === "like") return "liked your post";
    if (n.type === "comment") return "commented on your post" + (n.body ? ": “" + escapeHtml(n.body) + "”" : "");
    if (n.type === "connect_request") return "wants to connect";
    return "";
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

    function renderMessagesDropdown() {
      if (!msgDropdown) return;
      var state = loadPortalState();
      var list = document.getElementById("messages-dropdown-list");
      var unread = state.threads.filter(function (t) { return t.unread; }).length;
      var badge = document.getElementById("topbar-messages-badge");
      if (badge) { badge.textContent = String(unread); badge.hidden = unread === 0; }
      if (!list) return;
      list.innerHTML = state.threads.length
        ? state.threads.map(function (t) {
            var last = t.messages[t.messages.length - 1];
            return (
              '<a class="app-list-item" href="member-portal.html?thread=' + encodeURIComponent(t.id) + '">' +
              avatarHtml(t.name, t.category) +
              '<span class="app-list-item-body"><span class="app-list-item-name">' + escapeHtml(t.name) + "</span>" +
              '<span class="app-list-item-preview">' + escapeHtml(last ? last.text : "") + "</span></span>" +
              (t.unread ? '<span class="app-list-item-unread"></span>' : "") +
              "</a>"
            );
          }).join("")
        : '<div class="app-dropdown-empty">No messages yet.</div>';
    }

    function renderNotifDropdown() {
      if (!notifDropdown) return;
      var feed = getNotificationFeed(profile.name);
      var pending = incomingRequestsFor(profile.name).length;
      var badge = document.getElementById("topbar-notif-badge");
      if (badge) { badge.textContent = String(pending); badge.hidden = pending === 0; }
      var list = document.getElementById("notifications-dropdown-list");
      if (!list) return;
      list.innerHTML = feed.length
        ? feed.map(function (n) {
            return (
              '<div class="notif-item" data-actor="' + escapeHtml(n.actor) + '">' +
              '<a href="' + profileLink(profile.name, n.actor) + '">' + avatarHtml(n.actor, n.category) + "</a>" +
              '<div class="notif-body"><p><strong>' + escapeHtml(n.actor) + "</strong> " + notifText(n) + "</p>" +
              '<p class="notif-time">' + relativeTime(n.createdAt) + " ago</p>" +
              (n.type === "connect_request"
                ? '<div class="notif-actions"><button type="button" data-action="accept">Connect back</button><button type="button" data-action="decline">Remove</button></div>'
                : "") +
              "</div></div>"
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
      var notifList = document.getElementById("notifications-dropdown-list");
      if (notifList) {
        notifList.addEventListener("click", function (e) {
          var btn = e.target.closest("button[data-action]");
          if (!btn) return;
          var actor = e.target.closest(".notif-item").dataset.actor;
          respondToConnectionRequest(profile.name, actor, btn.dataset.action === "accept");
          renderNotifDropdown();
        });
      }
    }
    document.addEventListener("click", closeDropdowns);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDropdowns(); });

    renderMessagesDropdown();
    renderNotifDropdown();

    // Sidebar nav active state (data-view links vs current page/query)
    var params = new URLSearchParams(window.location.search);
    var currentView = params.get("view") || (window.location.pathname.indexOf("member-portal") !== -1 ? "feed" : "");
    document.querySelectorAll(".app-sidebar-link[data-view]").forEach(function (link) {
      link.classList.toggle("is-active", link.dataset.view === currentView);
    });

    // Free-tier gates on sidebar deal/sourcing links
    var isFree = (profile.tier || "individual") === "free";
    document.querySelectorAll('.app-sidebar-link[data-view="deal"], .app-sidebar-link[data-view="sourcing"]').forEach(function (link) {
      if (isFree) {
        link.setAttribute("aria-disabled", "true");
        link.classList.add("is-locked");
        link.title = "Available on paid plans";
      }
    });
  });
})();
