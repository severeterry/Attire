(function () {
  "use strict";

  var sb = window.supabaseClient;

  // General 1:1 direct-message threads — a pre-existing feature, left on
  // localStorage untouched. Deal Board posts/responses (below) are the only
  // part of this file backed by real Supabase data.
  var DM_STORAGE_KEY = "attire-portal-dm-v1";

  var dmState = null;
  var profile = null;
  var dealPosts = [];
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

  function authorAvatarHtml(name, category, extraClass) {
    if (isMe(name)) return avatarHtml(name, profile.category, extraClass, profile.avatar);
    return avatarHtml(name, category, extraClass);
  }

  function profileLink(name) {
    return isMe(name) ? "profile.html" : "profile.html?member=" + encodeURIComponent(name);
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

  // ---- Deal Board (Supabase-backed) ----

  function typeBadgeHtml(postType) {
    if (postType === "deal_board_rfp")
      return '<span class="post-type-flag post-type-flag--deal"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v14M7 17l-4-4M7 17l4-4M17 21V7M17 7l4 4M17 7l-4 4"/></svg>Deal Board RFP</span>';
    return '<span class="post-type-flag post-type-flag--sourcing"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>Sourcing</span>';
  }

  async function fetchDealPosts() {
    var res = await sb
      .from("rfp_posts")
      .select("id, post_type, category, scope, budget_range, deadline, body, status, created_at, author_id, profiles(org_name, contact_name, category)")
      .order("created_at", { ascending: false });
    if (res.error) {
      console.error(res.error);
      return [];
    }
    return res.data;
  }

  function dealPostHtml(post) {
    var author = post.profiles || {};
    var authorName = author.org_name || author.contact_name || "Member";
    var details = [post.category, post.scope, post.budget_range, post.deadline].filter(Boolean).join(" &middot; ");
    var authorLink = post.author_id === profile.id ? "profile.html" : "profile.html?id=" + encodeURIComponent(post.author_id);

    return (
      '<article class="post-card is-' + (post.post_type === "deal_board_rfp" ? "deal" : "sourcing") + '" data-id="' + post.id + '">' +
      '<div class="post-type-flag-slot">' + typeBadgeHtml(post.post_type) + "</div>" +
      '<div class="post-head">' +
      '<a href="' + authorLink + '">' + authorAvatarHtml(authorName, author.category) + "</a>" +
      "<div>" +
      '<a class="post-author-name" href="' + authorLink + '">' + escapeHtml(authorName) + "</a>" +
      '<div class="post-meta-row"><span>' + relativeTime(new Date(post.created_at).getTime()) + " ago</span></div>" +
      "</div></div>" +
      '<p class="post-body">' + escapeHtml(post.body) + "</p>" +
      '<p class="settings-note">' + (details || "No additional details") + " &mdash; " + post.status + "</p>" +
      '<div class="post-actions">' +
      (isFreeTier()
        ? '<span class="settings-note">Upgrade to a paid plan to respond.</span>'
        : '<button type="button" class="btn btn-outline btn-sm" data-action="respond" data-id="' + post.id + '">Respond</button>') +
      "</div>" +
      "</article>"
    );
  }

  function renderFeed() {
    var feedEl = document.getElementById("portal-feed-list");
    if (!feedEl) return;
    var posts = dealPosts.slice();
    if (activeFilter === "deal") posts = posts.filter(function (p) { return p.post_type === "deal_board_rfp"; });
    else if (activeFilter === "sourcing") posts = posts.filter(function (p) { return p.post_type === "sourcing"; });

    var searchEl = document.getElementById("feed-search");
    var query = (searchEl && searchEl.value || "").trim().toLowerCase();
    if (query) {
      posts = posts.filter(function (p) { return p.body.toLowerCase().indexOf(query) !== -1; });
    }

    feedEl.innerHTML = posts.length
      ? posts.map(dealPostHtml).join("")
      : '<div class="empty-state"><h3>Nothing here yet</h3><p>Deal Board RFPs and sourcing posts from members will show up in this view.</p></div>';
  }

  async function respondToPost(postId) {
    var body = window.prompt("Write your response to this post:");
    if (!body || !body.trim()) return;

    // Creating the thread + adding both participants + the first message all
    // happens atomically server-side — a thread has no way to satisfy its own
    // "am I a participant" read policy until a thread_participants row
    // exists, so building it up via separate client-side inserts can never
    // work for the creator reading their own just-created thread back.
    var res = await sb.rpc("start_rfp_thread", { p_rfp_post_id: postId, p_initial_message: body.trim() });
    if (res.error) { window.alert(res.error.message); return; }

    window.location.href = "thread.html?id=" + encodeURIComponent(res.data);
  }

  // ---- General DM thread list / chat view (localStorage, unchanged) ----

  function renderThreadList() {
    var listEl = document.getElementById("chat-thread-list");
    if (!listEl) return;
    listEl.innerHTML = dmState.threads
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
    var thread = dmState.threads.find(function (t) { return t.id === activeThreadId; });

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
      if (appList) appList.innerHTML = '<div class="notif-empty" style="padding:var(--space-4);color:var(--color-dark-text-faint);">Messaging is available on paid plans.</div>';
    } else {
      if (composerCard) composerCard.hidden = false;
      if (composerLocked) composerLocked.hidden = true;
    }

    // Free tier can browse the Deal Board/Sourcing filters same as anyone —
    // only posting (composer, above) and responding (per-post, in
    // dealPostHtml) are paid-plan-only.
  }

  function isFreeTier() {
    return (profile.tier || "individual") === "free";
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
    renderComposerAvatar();
    applyTierGates();

    dealPosts = await fetchDealPosts();

    var params = new URLSearchParams(window.location.search);
    var threadParam = params.get("thread");
    if (threadParam && !isFreeTier()) {
      activeThreadId = threadParam;
      var openedThread = dmState.threads.find(function (t) { return t.id === threadParam; });
      if (openedThread) { openedThread.unread = false; saveDmState(dmState); }
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
    var composerError = document.getElementById("composer-error");

    composerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var postType = document.getElementById("composer-post-type").value;
      var body = document.getElementById("composer-textarea").value.trim();
      if (!postType) {
        composerError.textContent = "Choose whether this is a Deal Board RFP or a Sourcing post.";
        composerError.hidden = false;
        return;
      }
      if (!body) return;
      composerError.hidden = true;

      var submitBtn = composerForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      sb.from("rfp_posts").insert({
        author_id: profile.id,
        post_type: postType,
        category: document.getElementById("composer-category").value.trim() || null,
        scope: document.getElementById("composer-scope").value.trim() || null,
        budget_range: document.getElementById("composer-budget").value.trim() || null,
        deadline: document.getElementById("composer-deadline").value || null,
        body: body,
      }).then(function (res) {
        submitBtn.disabled = false;
        if (res.error) {
          composerError.textContent = res.error.message;
          composerError.hidden = false;
          return;
        }
        composerForm.reset();
        fetchDealPosts().then(function (posts) {
          dealPosts = posts;
          renderFeed();
        });
      });
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
      var respondBtn = e.target.closest('[data-action="respond"]');
      if (!respondBtn) return;
      respondToPost(respondBtn.dataset.id);
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
    }

    renderFeed();
    if (!isFreeTier()) renderThreadList();
    renderChatView();
  });
})();
