(function () {
  "use strict";

  var STORAGE_KEY = "attire-portal-v1";
  var state = null;
  var profile = null;
  var activeFilter = "all";
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
    var day = Math.round(hr / 24);
    return day + "d";
  }

  function buildInitialState() {
    var now = Date.now();
    var posts = PORTAL_SEED_POSTS.map(function (p) {
      return {
        id: p.id,
        authorName: p.authorName,
        category: p.category,
        type: p.type,
        body: p.body,
        createdAt: now - p.ageMs,
        likes: p.likes,
        liked: p.liked,
        reposted: p.reposted,
        repostCount: p.repostCount,
        comments: p.comments.map(function (c) {
          return { author: c.author, category: c.category, body: c.body, createdAt: now - c.ageMs };
        }),
        commentsOpen: false,
      };
    });
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
    return { posts: posts, threads: threads };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    var fresh = buildInitialState();
    save(fresh);
    return fresh;
  }

  function save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
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

  function authorAvatarHtml(name, category, extraClass) {
    if (isMe(name)) return avatarHtml(name, profile.category, extraClass, profile.avatar);
    return avatarHtml(name, category, extraClass);
  }

  function profileLink(name) {
    return isMe(name) ? "profile.html" : "profile.html?member=" + encodeURIComponent(name);
  }

  function typeBadge(type) {
    if (type === "deal")
      return '<span class="post-type-flag post-type-flag--deal"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v14M7 17l-4-4M7 17l4-4M17 21V7M17 7l4 4M17 7l-4 4"/></svg>Deal Board RFP</span>';
    if (type === "sourcing")
      return '<span class="post-type-flag post-type-flag--sourcing"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>Sourcing</span>';
    return "";
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

  function postHtml(post) {
    var isSpecial = post.type === "deal" || post.type === "sourcing";
    var commentsHtml = post.comments
      .map(function (c) {
        var link = profileLink(c.author);
        return (
          '<div class="comment">' +
          '<a href="' + link + '">' + authorAvatarHtml(c.author, c.category, "portal-avatar-sm") + "</a>" +
          '<div><a class="comment-author" href="' + link + '">' + escapeHtml(c.author) + "</a>" +
          '<div class="comment-body">' + escapeHtml(c.body) + "</div></div></div>"
        );
      })
      .join("");

    return (
      '<article class="post-card' + (isSpecial ? " is-" + post.type : "") + '" data-id="' + post.id + '">' +
      (isSpecial ? '<div class="post-type-flag-slot">' + typeBadge(post.type) + "</div>" : "") +
      (post.reposted
        ? '<div class="post-repost-flag"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> You reposted</div>'
        : "") +
      '<div class="post-head">' +
      '<a href="' + profileLink(post.authorName) + '">' + authorAvatarHtml(post.authorName, post.category) + "</a>" +
      '<div>' +
      '<a class="post-author-name" href="' + profileLink(post.authorName) + '">' + escapeHtml(post.authorName) + "</a>" +
      '<div class="post-meta-row">' +
      (post.category ? '<span class="cat-badge" data-cat="' + post.category + '">' + escapeHtml(labelForCategory(post.category)) + "</span>" : "") +
      '<span>&middot;</span><span>' + relativeTime(post.createdAt) + " ago</span>" +
      "</div></div></div>" +
      '<p class="post-body">' + escapeHtml(post.body) + "</p>" +
      (post.media ? '<div class="post-media"><img src="' + post.media + '" alt=""></div>' : "") +
      '<div class="post-actions">' +
      '<button type="button" class="post-action' + (post.liked ? " is-active" : "") + '" data-action="like">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="' + (post.liked ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>' +
      "<span>" + post.likes + "</span></button>" +
      '<button type="button" class="post-action" data-action="comment">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
      "<span>" + post.comments.length + "</span></button>" +
      '<button type="button" class="post-action' + (post.reposted ? " is-active" : "") + '" data-action="repost">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>' +
      "<span>" + post.repostCount + "</span></button>" +
      "</div>" +
      (post.commentsOpen
        ? '<div class="post-comments">' + commentsHtml +
          '<form class="comment-compose" data-id="' + post.id + '">' +
          '<input type="text" placeholder="Write a comment&hellip;" aria-label="Write a comment" required>' +
          '<button type="submit" class="btn btn-primary btn-sm">Reply</button>' +
          "</form></div>"
        : "") +
      "</article>"
    );
  }

  function renderFeed() {
    var feedEl = document.getElementById("portal-feed-list");
    if (!feedEl) return;
    var posts = state.posts.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (activeFilter === "deal" || activeFilter === "sourcing") posts = posts.filter(function (p) { return p.type === activeFilter; });
    var query = (document.getElementById("feed-search").value || "").trim().toLowerCase();
    if (query) {
      posts = posts.filter(function (p) {
        return p.body.toLowerCase().indexOf(query) !== -1 || p.authorName.toLowerCase().indexOf(query) !== -1;
      });
    }
    feedEl.innerHTML = posts.length
      ? posts.map(postHtml).join("")
      : '<div class="empty-state"><h3>Nothing here yet</h3><p>Sourcing RFPs from members will show up in this view.</p></div>';
  }

  function renderThreadList() {
    var listEl = document.getElementById("chat-thread-list");
    if (!listEl) return;
    listEl.innerHTML = state.threads
      .map(function (t) {
        var last = t.messages[t.messages.length - 1];
        return (
          '<button type="button" class="app-list-item' + (t.id === activeThreadId ? " is-active" : "") + '" data-id="' + t.id + '">' +
          avatarHtml(t.name, t.category) +
          '<span class="app-list-item-body"><span class="app-list-item-name">' + escapeHtml(t.name) + '</span>' +
          '<span class="app-list-item-preview">' + escapeHtml(last ? last.text : "") + "</span></span>" +
          (t.unread ? '<span class="app-list-item-unread" aria-hidden="true"></span>' : "") +
          "</button>"
        );
      })
      .join("");
  }

  function renderChatView() {
    var viewFeed = document.getElementById("view-feed");
    var viewChat = document.getElementById("view-chat");
    var thread = state.threads.find(function (t) { return t.id === activeThreadId; });

    if (!thread) {
      viewFeed.hidden = false;
      viewChat.hidden = true;
      renderContextFeed();
      return;
    }
    viewFeed.hidden = true;
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
    var suggestions = (typeof LISTINGS !== "undefined" ? LISTINGS : [])
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

  function renderComposerAvatar() {
    var el = document.getElementById("composer-avatar");
    if (!el) return;
    el.classList.toggle("portal-avatar-img", !!profile.avatar);
    el.innerHTML = profile.avatar ? '<img src="' + profile.avatar + '" alt="">' : escapeHtml(initials(profile.name));
    if (!profile.avatar && profile.category) el.setAttribute("data-cat", profile.category);
  }

  function applyTierGates() {
    var tier = profile.tier || "individual";
    var isFree = tier === "free";
    var composerCard = document.getElementById("composer-form");
    var composerLocked = document.getElementById("composer-locked");
    var appList = document.querySelector(".app-list");

    if (isFree) {
      if (composerCard) composerCard.hidden = true;
      if (composerLocked) composerLocked.hidden = false;
      if (appList) appList.innerHTML = '<div class="notif-empty" style="padding:var(--space-4);color:#9FB89F;">Messaging is available on paid plans.</div>';
    } else {
      if (composerCard) composerCard.hidden = false;
      if (composerLocked) composerLocked.hidden = true;
    }

    document.querySelectorAll('.app-sidebar-link[data-filter="deal"], .app-sidebar-link[data-filter="sourcing"]').forEach(function (btn) {
      btn.disabled = isFree;
      btn.classList.toggle("is-locked", isFree);
      btn.title = isFree ? "Available on paid plans" : "";
    });
  }

  function render() {
    renderFeed();
    if (!isFreeTier()) renderThreadList();
    renderChatView();
  }

  function isFreeTier() {
    return (profile.tier || "individual") === "free";
  }

  document.addEventListener("DOMContentLoaded", function () {
    var auth = window.AttireAuth ? window.AttireAuth.getAuth() : null;
    if (!auth || !auth.loggedIn) {
      window.location.href = "index.html";
      return;
    }

    profile = loadPortalProfile();
    seedConnectionsIfEmpty(profile.name);
    state = load();
    renderComposerAvatar();
    applyTierGates();

    var params = new URLSearchParams(window.location.search);
    var threadParam = params.get("thread");
    if (threadParam && !isFreeTier()) {
      activeThreadId = threadParam;
      var openedThread = state.threads.find(function (t) { return t.id === threadParam; });
      if (openedThread) { openedThread.unread = false; save(state); }
    }

    var viewParam = params.get("view");
    if (viewParam === "deal" || viewParam === "sourcing") {
      var targetBtn = document.querySelector('.app-sidebar-link[data-filter="' + viewParam + '"]');
      if (targetBtn && !targetBtn.disabled) {
        activeFilter = viewParam;
        document.querySelectorAll(".app-sidebar-link[data-filter]").forEach(function (b) { b.classList.toggle("is-active", b === targetBtn); });
      }
    }

    var composerForm = document.getElementById("composer-form");
    var composerTextarea = document.getElementById("composer-textarea");
    var pendingMedia = null;

    var mediaBtn = document.getElementById("composer-media-btn");
    var mediaInput = document.getElementById("composer-media-input");
    var mediaPreview = document.getElementById("composer-media-preview");
    var mediaImg = document.getElementById("composer-media-img");
    var mediaRemove = document.getElementById("composer-media-remove");

    mediaBtn.addEventListener("click", function () { mediaInput.click(); });
    mediaInput.addEventListener("change", function () {
      var file = mediaInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        pendingMedia = reader.result;
        mediaImg.src = pendingMedia;
        mediaPreview.hidden = false;
      };
      reader.readAsDataURL(file);
    });
    mediaRemove.addEventListener("click", function () {
      pendingMedia = null;
      mediaInput.value = "";
      mediaPreview.hidden = true;
    });

    composerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = composerTextarea.value.trim();
      if (!text) return;
      state.posts.unshift({
        id: "post-" + Date.now(),
        authorName: profile.name,
        category: profile.category,
        type: "update",
        body: text,
        media: pendingMedia,
        createdAt: Date.now(),
        likes: 0,
        liked: false,
        reposted: false,
        repostCount: 0,
        comments: [],
        commentsOpen: false,
      });
      composerTextarea.value = "";
      pendingMedia = null;
      mediaInput.value = "";
      mediaPreview.hidden = true;
      save(state);
      renderFeed();
    });

    document.getElementById("feed-search").addEventListener("input", renderFeed);

    var navButtons = document.querySelectorAll(".app-sidebar-link[data-filter]");
    navButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        activeFilter = btn.dataset.filter;
        navButtons.forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        activeThreadId = null;
        renderFeed();
        renderChatView();
      });
    });

    var feedEl = document.getElementById("portal-feed-list");
    feedEl.addEventListener("click", function (e) {
      var actionBtn = e.target.closest(".post-action");
      if (!actionBtn) return;
      var card = e.target.closest(".post-card");
      var id = card.dataset.id;
      var post = state.posts.find(function (p) { return p.id === id; });
      if (!post) return;
      var action = actionBtn.dataset.action;
      if (action === "like") {
        post.liked = !post.liked;
        post.likes += post.liked ? 1 : -1;
      } else if (action === "repost") {
        post.reposted = !post.reposted;
        post.repostCount += post.reposted ? 1 : -1;
      } else if (action === "comment") {
        post.commentsOpen = !post.commentsOpen;
      }
      save(state);
      renderFeed();
    });

    feedEl.addEventListener("submit", function (e) {
      var form = e.target.closest(".comment-compose");
      if (!form) return;
      e.preventDefault();
      var input = form.querySelector("input");
      var text = input.value.trim();
      if (!text) return;
      var post = state.posts.find(function (p) { return p.id === form.dataset.id; });
      if (!post) return;
      post.comments.push({ author: profile.name, category: profile.category, body: text, createdAt: Date.now() });
      save(state);
      renderFeed();
    });

    if (!isFreeTier()) {
      document.getElementById("chat-back").addEventListener("click", function () {
        activeThreadId = null;
        renderChatView();
      });

      document.getElementById("chat-thread-list").addEventListener("click", function (e) {
        var item = e.target.closest(".app-list-item");
        if (!item) return;
        activeThreadId = item.dataset.id;
        var thread = state.threads.find(function (t) { return t.id === activeThreadId; });
        if (thread) thread.unread = false;
        save(state);
        renderThreadList();
        renderChatView();
      });

      document.getElementById("chat-compose-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var chatInput = document.getElementById("chat-input");
        var text = chatInput.value.trim();
        if (!text || !activeThreadId) return;
        var thread = state.threads.find(function (t) { return t.id === activeThreadId; });
        if (!thread) return;
        thread.messages.push({ from: "me", text: text, createdAt: Date.now() });
        chatInput.value = "";
        save(state);
        renderChatView();
      });
    }

    render();
  });
})();
