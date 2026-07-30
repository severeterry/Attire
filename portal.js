(function () {
  "use strict";

  var sb = window.supabaseClient;
  var profile = null;
  var dealPosts = [];
  var filterState = { sort: "newest" };
  var responseCounts = {};

  // Response counts are public (visible to any viewer of the listing) even
  // though the thread content behind them stays private to its participants
  // — get_rfp_response_counts only ever returns a count, never thread rows.
  async function fetchResponseCounts(postIds) {
    if (!postIds.length) return {};
    var res = await sb.rpc("get_rfp_response_counts", { p_rfp_post_ids: postIds });
    if (res.error) return {};
    var map = {};
    (res.data || []).forEach(function (r) { map[r.rfp_post_id] = r.response_count; });
    return map;
  }

  function responseCountLabel(postId) {
    var count = responseCounts[postId] || 0;
    return count + (count === 1 ? " response" : " responses");
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
    var day = Math.round(hr / 24);
    return day + "d";
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

  // ---- The Exchange (Supabase-backed) ----

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
      '<article class="post-card is-exchange" data-id="' + post.id + '">' +
      '<div class="post-type-flag-slot"><span class="post-type-flag post-type-flag--exchange">The Exchange</span></div>' +
      '<div class="post-head">' +
      '<a href="' + authorLink + '">' + authorAvatarHtml(authorName, author.category) + "</a>" +
      "<div>" +
      '<a class="post-author-name" href="' + authorLink + '">' + escapeHtml(authorName) + "</a>" +
      '<div class="post-meta-row"><span>' + relativeTime(new Date(post.created_at).getTime()) + " ago</span>" +
      "<span>&middot;</span><span>" + responseCountLabel(post.id) + "</span></div>" +
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

  function visiblePosts() {
    var posts = dealPosts.slice();
    var searchEl = document.getElementById("feed-search");
    var query = (searchEl && searchEl.value || "").trim().toLowerCase();
    if (query) {
      posts = posts.filter(function (p) { return p.body.toLowerCase().indexOf(query) !== -1; });
    }
    if (filterState.sort === "oldest") {
      posts.sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
    } else {
      posts.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    }
    return posts;
  }

  function renderFeed() {
    var feedEl = document.getElementById("portal-feed-list");
    if (!feedEl) return;
    var posts = visiblePosts();

    feedEl.innerHTML = posts.length
      ? posts.map(dealPostHtml).join("")
      : '<div class="empty-state"><h3>Nothing here yet</h3><p>Exchange listings from members will show up in this view.</p></div>';

    var countEl = document.getElementById("exchange-result-count");
    if (countEl) countEl.textContent = posts.length + (posts.length === 1 ? " listing" : " listings");
  }

  function renderRecent() {
    var recentEl = document.getElementById("exchange-recent-list");
    if (!recentEl) return;
    var recent = dealPosts.slice(0, 5);
    recentEl.innerHTML = recent.length
      ? recent.map(function (p) {
          var author = p.profiles || {};
          var name = author.org_name || author.contact_name || "Member";
          var preview = p.body.length > 60 ? p.body.slice(0, 60) + "…" : p.body;
          return '<a class="app-context-recent-item" href="#" data-scroll-to="' + p.id + '">' + escapeHtml(preview) + "<span>" + escapeHtml(name) + "</span></a>";
        }).join("")
      : '<p class="settings-note">No listings yet.</p>';
  }

  var respondPostId = null;

  function onRespondModalKeydown(e) {
    if (e.key === "Escape") closeRespondModal();
  }

  function openRespondModal(postId) {
    respondPostId = postId;
    var textarea = document.getElementById("respond-textarea");
    var errorEl = document.getElementById("respond-error");
    textarea.value = "";
    errorEl.hidden = true;
    document.getElementById("respond-modal-backdrop").classList.add("is-open");
    document.addEventListener("keydown", onRespondModalKeydown);
    textarea.focus();
  }

  function closeRespondModal() {
    respondPostId = null;
    document.getElementById("respond-modal-backdrop").classList.remove("is-open");
    document.removeEventListener("keydown", onRespondModalKeydown);
  }

  async function submitRespond() {
    var textarea = document.getElementById("respond-textarea");
    var errorEl = document.getElementById("respond-error");
    var body = textarea.value.trim();
    if (!body || !respondPostId) return;
    errorEl.hidden = true;

    var form = document.getElementById("respond-form");
    var submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    // Creating the thread + adding both participants + the first message all
    // happens atomically server-side — a thread has no way to satisfy its own
    // "am I a participant" read policy until a thread_participants row
    // exists, so building it up via separate client-side inserts can never
    // work for the creator reading their own just-created thread back.
    var res = await sb.rpc("start_rfp_thread", { p_rfp_post_id: respondPostId, p_initial_message: body });
    submitBtn.disabled = false;
    if (res.error) {
      errorEl.textContent = res.error.message;
      errorEl.hidden = false;
      return;
    }

    window.location.href = "thread.html?id=" + encodeURIComponent(res.data);
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

    if (isFree) {
      if (composerCard) composerCard.hidden = true;
      if (composerLocked) composerLocked.hidden = false;
    } else {
      if (composerCard) composerCard.hidden = false;
      if (composerLocked) composerLocked.hidden = true;
    }

    // Free tier can browse The Exchange's filters same as anyone —
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

    renderComposerAvatar();
    applyTierGates();

    dealPosts = await fetchDealPosts();
    responseCounts = await fetchResponseCounts(dealPosts.map(function (p) { return p.id; }));
    renderFeed();
    renderRecent();

    var composerForm = document.getElementById("composer-form");
    var composerError = document.getElementById("composer-error");

    composerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = document.getElementById("composer-textarea").value.trim();
      if (!body) return;
      composerError.hidden = true;

      var submitBtn = composerForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      sb.from("rfp_posts").insert({
        author_id: profile.id,
        post_type: "sourcing",
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
          renderRecent();
        });
      });
    });

    document.getElementById("feed-search").addEventListener("input", renderFeed);

    document.getElementById("exchange-sort-select").addEventListener("change", function (e) {
      filterState.sort = e.target.value;
      renderFeed();
    });


    var feedEl = document.getElementById("portal-feed-list");
    feedEl.addEventListener("click", function (e) {
      var respondBtn = e.target.closest('[data-action="respond"]');
      if (!respondBtn) return;
      openRespondModal(respondBtn.dataset.id);
    });

    document.getElementById("respond-modal-close").addEventListener("click", closeRespondModal);
    document.getElementById("respond-cancel-btn").addEventListener("click", closeRespondModal);
    document.getElementById("respond-modal-backdrop").addEventListener("click", function (e) {
      if (e.target.id === "respond-modal-backdrop") closeRespondModal();
    });
    document.getElementById("respond-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submitRespond();
    });

    document.getElementById("exchange-recent-list").addEventListener("click", function (e) {
      var link = e.target.closest("[data-scroll-to]");
      if (!link) return;
      e.preventDefault();
      var card = document.querySelector('.post-card[data-id="' + link.dataset.scrollTo + '"]');
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
})();
