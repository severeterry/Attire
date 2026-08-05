(function () {
  "use strict";

  // General 1:1 direct-message threads — localStorage, unchanged from the
  // prototype. Extracted out of member-portal.html/portal.js into its own
  // page so Messages is a first-class nav destination instead of a panel
  // bolted onto The Exchange.
  var DM_STORAGE_KEY = "attire-portal-dm-v1";

  var dmState = null;
  var profile = null;
  var activeThreadId = null;

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

  function buildInitialDmState() {
    var now = Date.now();
    var threads = PORTAL_SEED_THREADS.map(function (t) {
      return {
        id: t.id,
        name: t.name,
        category: t.category,
        unread: t.unread,
        messages: t.messages.map(function (m) {
          return { from: m.from, text: m.text, createdAt: now - m.ageMs };
        }),
      };
    });
    return { threads: threads };
  }

  function loadDmState() {
    try {
      var raw = localStorage.getItem(DM_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    var fresh = buildInitialDmState();
    saveDmState(fresh);
    return fresh;
  }

  function saveDmState(s) {
    try { localStorage.setItem(DM_STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function avatarHtml(name, category, extraClass, avatarUrl) {
    var cls = "portal-avatar" + (extraClass ? " " + extraClass : "");
    if (avatarUrl) {
      return '<span class="' + cls + ' portal-avatar-img"><img src="' + avatarUrl + '" alt=""></span>';
    }
    return (
      '<span class="' + cls + '"' +
      (category ? ' data-cat="' + category + '"' : "") +
      ">" + escapeHtml(initials(name)) + "</span>"
    );
  }

  function isMe(authorName) {
    return authorName === profile.name;
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

  function profileLink(name) {
    return isMe(name) ? "profile.html" : "profile.html?member=" + encodeURIComponent(name);
  }

  // Exchange/Co-Op threads no longer surface here — each now has its own
  // popup on its own page (see portal.js/pooling.js), listed under that
  // page's "Active Threads" sidebar widget instead of duplicated here.

  var sb = window.supabaseClient;

  function renderThreadList() {
    var listEl = document.getElementById("chat-thread-list");
    if (!listEl) return;
    listEl.innerHTML = dmState.threads
      .map(function (t) {
        var last = t.messages[t.messages.length - 1];
        return (
          '<button type="button" class="app-list-item' + (t.id === activeThreadId ? " is-active" : "") + '" data-id="' + t.id + '">' +
          avatarHtml(t.name, t.category) +
          '<span class="app-list-item-body"><span class="app-list-item-name">' + escapeHtml(t.name) + "</span>" +
          '<span class="app-list-item-preview">' + escapeHtml(last ? last.text : "") + "</span></span>" +
          (t.unread ? '<span class="app-list-item-unread" aria-hidden="true"></span>' : "") +
          "</button>"
        );
      })
      .join("");
  }

  function renderChatView() {
    var emptyState = document.getElementById("messages-empty-state");
    var viewChat = document.getElementById("view-chat");
    var thread = dmState.threads.find(function (t) { return t.id === activeThreadId; });

    if (!thread) {
      emptyState.hidden = false;
      viewChat.hidden = true;
      renderContextFeed();
      return;
    }
    emptyState.hidden = true;
    viewChat.hidden = false;
    document.getElementById("chat-view-name").textContent = thread.name;
    var avatarEl = document.getElementById("chat-view-avatar");
    avatarEl.textContent = initials(thread.name);
    if (thread.category) avatarEl.setAttribute("data-cat", thread.category);
    else avatarEl.removeAttribute("data-cat");
    var messagesEl = document.getElementById("chat-messages");
    messagesEl.innerHTML = thread.messages
      .map(function (m) {
        return '<div class="chat-bubble from-' + (m.from === "me" ? "me" : "them") + '">' + escapeHtml(m.text) + "</div>";
      })
      .join("");
    messagesEl.scrollTop = messagesEl.scrollHeight;
    renderContextChat(thread);
  }

  function renderContextFeed() {
    var contextFeed = document.getElementById("context-feed");
    var contextChat = document.getElementById("context-chat");
    contextFeed.hidden = false;
    contextChat.hidden = true;

    var listEl = document.getElementById("context-members-list");
    var connected = acceptedConnectionsFor(profile.name);
    sb.from("directory_listings").select("name, category").order("name", { ascending: true }).then(function (res) {
      var suggestions = (res.data || [])
        .filter(function (l) { return l.name !== profile.name && connected.indexOf(l.name) === -1; })
        .slice(0, 6);
      listEl.innerHTML = suggestions
        .map(function (l) {
          return (
            '<a class="context-member-item" href="' + profileLink(l.name) + '">' +
            avatarHtml(l.name, l.category) +
            '<span><span class="context-member-name">' + escapeHtml(l.name) + "</span>" +
            '<span class="context-member-sub">' + escapeHtml(labelForCategory(l.category)) + "</span></span>" +
            "</a>"
          );
        })
        .join("");
    });
  }

  function renderContextChat(thread) {
    var contextFeed = document.getElementById("context-feed");
    var contextChat = document.getElementById("context-chat");
    contextFeed.hidden = true;
    contextChat.hidden = false;

    var rel = getRelationship(profile.name, thread.name);
    var connectBtnHtml;
    if (!rel) {
      connectBtnHtml = '<button type="button" class="btn btn-primary btn-sm" data-action="connect">Connect</button>';
    } else if (rel.status === "accepted") {
      connectBtnHtml = '<button type="button" class="btn btn-outline btn-sm" data-action="remove">Remove Connection</button>';
    } else if (rel.direction === "outgoing") {
      connectBtnHtml = '<button type="button" class="btn btn-outline btn-sm" disabled>Request Sent</button>';
    } else {
      connectBtnHtml = '<button type="button" class="btn btn-primary btn-sm" data-action="accept">Accept Request</button>';
    }

    contextChat.innerHTML =
      '<div class="context-card">' +
      avatarHtml(thread.name, thread.category, "portal-avatar-lg") +
      "<h4>" + escapeHtml(thread.name) + "</h4>" +
      (thread.category ? '<p>' + escapeHtml(labelForCategory(thread.category)) + "</p>" : "") +
      connectBtnHtml +
      '<a href="' + profileLink(thread.name) + '" class="btn btn-outline btn-sm">View Full Profile</a>' +
      "</div>";

    var actionBtn = contextChat.querySelector("[data-action]");
    if (actionBtn) {
      actionBtn.addEventListener("click", function () {
        var action = actionBtn.dataset.action;
        if (action === "connect") sendConnectionRequest(profile.name, thread.name);
        else if (action === "accept") respondToConnectionRequest(profile.name, thread.name, true);
        else if (action === "remove") removeConnection(profile.name, thread.name);
        renderContextChat(thread);
      });
    }
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

    seedConnectionsIfEmpty(profile.name);
    dmState = loadDmState();

    var params = new URLSearchParams(window.location.search);
    var threadParam = params.get("thread");
    if (threadParam) {
      activeThreadId = threadParam;
      var openedThread = dmState.threads.find(function (t) { return t.id === threadParam; });
      if (openedThread) { openedThread.unread = false; saveDmState(dmState); }
    }

    renderThreadList();
    renderChatView();

    document.getElementById("chat-back").addEventListener("click", function () {
      activeThreadId = null;
      renderThreadList();
      renderChatView();
    });

    document.getElementById("chat-thread-list").addEventListener("click", function (e) {
      var item = e.target.closest(".app-list-item");
      if (!item) return;
      activeThreadId = item.dataset.id;
      var thread = dmState.threads.find(function (t) { return t.id === activeThreadId; });
      if (thread) thread.unread = false;
      saveDmState(dmState);
      renderThreadList();
      renderChatView();
    });

    document.getElementById("chat-compose-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var chatInput = document.getElementById("chat-input");
      var text = chatInput.value.trim();
      if (!text || !activeThreadId) return;
      var thread = dmState.threads.find(function (t) { return t.id === activeThreadId; });
      if (!thread) return;
      thread.messages.push({ from: "me", text: text, createdAt: Date.now() });
      chatInput.value = "";
      saveDmState(dmState);
      renderChatView();
    });
  });
})();
