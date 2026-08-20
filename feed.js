/**
 * Feed aggregates three real Supabase tables into one chronological list:
 * regular posts (own table, own like/comment engagement), Exchange listings
 * (rfp_posts), and Co-Op pools (pooling_threads). Only regular posts carry
 * the vote-column like/comment UI — Exchange/Co-Op items are read-only
 * previews here, tagged with a type badge, linking through to their real
 * page for the actual Respond/Join action.
 */
(function () {
  "use strict";

  var sb = window.supabaseClient;
  var profile = null;
  var posts = [];
  var feedItems = [];
  var likedPostIds = new Set();
  var openComments = new Set();
  var filterState = { sort: "newest", type: "all" };
  var exchangeResponseCounts = {};

  // Public response counts — the count is visible to everyone, the thread
  // content behind it stays exactly as private as before.
  async function fetchResponseCounts(postIds) {
    if (!postIds.length) return {};
    var res = await sb.rpc("get_rfp_response_counts", { p_rfp_post_ids: postIds });
    if (res.error) return {};
    var map = {};
    (res.data || []).forEach(function (r) { map[r.rfp_post_id] = r.response_count; });
    return map;
  }

  function responseCountLabel(postId) {
    var count = exchangeResponseCounts[postId] || 0;
    return count + (count === 1 ? " response" : " responses");
  }

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

  async function fetchPosts() {
    var res = await sb
      .from("posts")
      .select("id, body, created_at, author_id, post_kind, event_at, collab_skills_needed, collab_timeline, profiles!posts_author_id_fkey(org_name, contact_name, category, avatar_url, tier), post_likes(count), post_comments(count)")
      .order("created_at", { ascending: false });
    if (res.error) { console.error(res.error); return []; }
    return res.data;
  }

  async function fetchExchangeItems() {
    var res = await sb
      .from("rfp_posts")
      .select("id, body, created_at, author_id, image_url, profiles(org_name, contact_name, category, avatar_url, tier)")
      .order("created_at", { ascending: false })
      .limit(15);
    if (res.error) { console.error(res.error); return []; }
    return res.data;
  }

  async function fetchCoopItems() {
    var res = await sb
      .from("pooling_threads")
      .select("id, title, description, created_at, organizer_id, image_url, profiles!pooling_threads_organizer_id_fkey(org_name, contact_name, category, avatar_url, tier)")
      .order("created_at", { ascending: false })
      .limit(15);
    if (res.error) { console.error(res.error); return []; }
    return res.data;
  }

  async function fetchMyLikes() {
    var res = await sb.from("post_likes").select("post_id").eq("profile_id", profile.id);
    likedPostIds = new Set((res.data || []).map(function (r) { return r.post_id; }));
  }

  var likedCommentIds = new Set();

  function commentLikeCountOf(c) {
    return (c.comment_likes && c.comment_likes[0] && c.comment_likes[0].count) || 0;
  }

  function commentHtml(c) {
    var author = c.profiles || {};
    var name = author.org_name || author.contact_name || "Member";
    var liked = likedCommentIds.has(c.id);
    var isOwn = c.author_id === profile.id;
    return (
      '<div class="feed-comment-row" style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">' +
      '<p class="settings-note" style="margin:0;"><strong>' + escapeHtml(name) + ":</strong> " + escapeHtml(c.body) + "</p>" +
      '<span style="display:flex; align-items:center; gap:0.2rem; flex-shrink:0;">' +
      '<button type="button" class="post-action-icon post-action-icon--sm" data-action="like-comment" data-id="' + c.id + '" aria-pressed="' + liked + '" aria-label="Like comment">' +
      (liked
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><path d="M12 21s-6.7-4.35-9.33-8.6C.86 9.4 2 5.5 5.6 4.6c2.06-.5 3.9.4 5 2.05a.5.5 0 0 0 .8 0c1.1-1.65 2.94-2.55 5-2.05 3.6.9 4.74 4.8 2.93 7.8C18.7 16.65 12 21 12 21z"/></svg>'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.7-4.35-9.33-8.6C.86 9.4 2 5.5 5.6 4.6c2.06-.5 3.9.4 5 2.05a.5.5 0 0 0 .8 0c1.1-1.65 2.94-2.55 5-2.05 3.6.9 4.74 4.8 2.93 7.8C18.7 16.65 12 21 12 21z"/></svg>') +
      "<span>" + commentLikeCountOf(c) + "</span></button>" +
      (isOwn
        ? '<button type="button" class="post-action-icon post-action-icon--sm" data-action="delete-comment" data-id="' + c.id + '" aria-label="Delete comment">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>' +
          "</button>"
        : "") +
      "</span>" +
      "</div>"
    );
  }

  async function loadComments(postId) {
    var res = await sb
      .from("post_comments")
      .select("id, body, created_at, author_id, profiles!post_comments_author_id_fkey(org_name, contact_name), comment_likes(count)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    var listEl = document.getElementById("comments-list-" + postId);
    if (!listEl) return;
    var comments = res.data || [];

    if (comments.length) {
      var commentIds = comments.map(function (c) { return c.id; });
      var myLikesRes = await sb.from("comment_likes").select("comment_id").eq("profile_id", profile.id).in("comment_id", commentIds);
      (myLikesRes.data || []).forEach(function (r) { likedCommentIds.add(r.comment_id); });
    }

    listEl.innerHTML = comments.length
      ? comments.map(commentHtml).join("")
      : '<p class="settings-note">No comments yet.</p>';
  }

  function likeCountOf(post) {
    return (post.post_likes && post.post_likes[0] && post.post_likes[0].count) || 0;
  }
  function commentCountOf(post) {
    return (post.post_comments && post.post_comments[0] && post.post_comments[0].count) || 0;
  }

  async function loadFeedItems() {
    var results = await Promise.all([fetchPosts(), fetchExchangeItems(), fetchCoopItems()]);
    posts = results[0];
    var exchangeItems = results[1];
    var coopItems = results[2];
    exchangeResponseCounts = await fetchResponseCounts(exchangeItems.map(function (p) { return p.id; }));

    var normalizedPosts = posts.map(function (p) {
      return { source: "post", id: p.id, raw: p, authorId: p.author_id, profiles: p.profiles, body: p.body, createdAt: p.created_at };
    });
    var normalizedExchange = exchangeItems.map(function (p) {
      return { source: "exchange", id: p.id, raw: p, authorId: p.author_id, profiles: p.profiles, body: p.body, createdAt: p.created_at, imageUrl: p.image_url };
    });
    var normalizedCoop = coopItems.map(function (p) {
      return { source: "coop", id: p.id, raw: p, authorId: p.organizer_id, profiles: p.profiles, body: p.title + " — " + p.description, createdAt: p.created_at, imageUrl: p.image_url };
    });

    feedItems = normalizedPosts.concat(normalizedExchange, normalizedCoop);
  }

  // "Most relevant" surfaces content from Organization ($18/mo) members
  // first — they're the highest membership tier, so their posts, Exchange
  // listings, and Co-Op pools get priority placement — then falls back to
  // newest-first within each group.
  function isOrgTierAuthor(item) {
    return !!(item.profiles && item.profiles.tier === "organization");
  }

  function visibleItems() {
    var list = feedItems.slice();
    var searchEl = document.getElementById("feed-search");
    var query = (searchEl && searchEl.value || "").trim().toLowerCase();
    if (query) {
      list = list.filter(function (item) {
        var author = item.profiles || {};
        var name = (author.org_name || author.contact_name || "").toLowerCase();
        return item.body.toLowerCase().indexOf(query) !== -1 || name.indexOf(query) !== -1;
      });
    }
    if (filterState.type && filterState.type !== "all") {
      list = list.filter(function (item) {
        if (item.source === "exchange") return filterState.type === "exchange";
        if (item.source === "coop") return filterState.type === "coop";
        return (item.raw.post_kind || "update") === filterState.type;
      });
    }
    if (filterState.sort === "oldest") {
      list.sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
    } else if (filterState.sort === "most-relevant") {
      list.sort(function (a, b) {
        var orgA = isOrgTierAuthor(a) ? 1 : 0;
        var orgB = isOrgTierAuthor(b) ? 1 : 0;
        if (orgA !== orgB) return orgB - orgA;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    } else {
      list.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    }
    return list;
  }

  function typeBadgeHtml(source) {
    if (source === "exchange") return '<span class="post-type-flag post-type-flag--exchange">The Exchange</span>';
    if (source === "coop") return '<span class="post-type-flag post-type-flag--coop">The Co-Op</span>';
    return "";
  }

  function linkHrefFor(item) {
    if (item.source === "exchange") return "member-portal.html?view=deal&id=" + encodeURIComponent(item.id);
    if (item.source === "coop") return "pooling.html?id=" + encodeURIComponent(item.id);
    return null;
  }

  function itemCardHtml(item) {
    var author = item.profiles || {};
    var name = author.org_name || author.contact_name || "Member";
    var authorLink = item.authorId === profile.id ? "profile.html" : "profile.html?id=" + encodeURIComponent(item.authorId);
    var badge = typeBadgeHtml(item.source);
    var cardClass = "post-card" + (item.source === "exchange" ? " is-exchange" : item.source === "coop" ? " is-coop" : "");

    if (item.source !== "post") {
      // Exchange/Co-Op items surfaced in Feed are read-only previews — the
      // real Respond/Join action lives on their own page, not duplicated here.
      return (
        '<article class="' + cardClass + '" data-id="' + item.id + '">' +
        (badge ? '<div class="post-type-flag-slot">' + badge + "</div>" : "") +
        '<div class="post-head">' +
        '<a href="' + authorLink + '">' + avatarHtml(name, author.category, author.avatar_url) + "</a>" +
        "<div>" +
        '<a class="post-author-name" href="' + authorLink + '">' + escapeHtml(name) + "</a>" +
        (item.source === "coop" ? ' <span class="role-badge">Organizer</span>' : "") +
        '<div class="post-meta-row"><span>' + relativeTime(new Date(item.createdAt).getTime()) + " ago</span>" +
        (item.source === "exchange" ? "<span>&middot;</span><span>" + responseCountLabel(item.id) + "</span>" : "") +
        "</div>" +
        "</div></div>" +
        (item.imageUrl ? '<img class="post-attachment-img" src="' + escapeHtml(item.imageUrl) + '" alt="" loading="lazy">' : "") +
        '<p class="post-body">' + escapeHtml(item.body) + "</p>" +
        '<div class="post-actions">' +
        '<a href="' + linkHrefFor(item) + '" class="btn btn-outline btn-sm">' + (item.source === "exchange" ? "View on The Exchange" : "View in The Co-Op") + "</a>" +
        "</div>" +
        "</article>"
      );
    }

    var post = item.raw;
    var likeCount = likeCountOf(post);
    var commentCount = commentCountOf(post);
    var liked = likedPostIds.has(post.id);
    var isOpen = openComments.has(post.id);
    var kind = post.post_kind || "update";
    var kindBadge = kind === "event"
      ? '<span class="post-type-flag post-type-flag--exchange">Event</span>'
      : kind === "collab"
        ? '<span class="post-type-flag post-type-flag--coop">Looking to collab</span>'
        : "";
    var structuredHtml = "";
    if (kind === "event" && post.event_at) {
      structuredHtml = '<p class="settings-note" style="margin:0.3rem 0 0;"><strong>When:</strong> ' + escapeHtml(new Date(post.event_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })) + "</p>";
    } else if (kind === "collab" && (post.collab_skills_needed || post.collab_timeline)) {
      structuredHtml =
        (post.collab_skills_needed ? '<p class="settings-note" style="margin:0.3rem 0 0;"><strong>Needed:</strong> ' + escapeHtml(post.collab_skills_needed) + "</p>" : "") +
        (post.collab_timeline ? '<p class="settings-note" style="margin:0.15rem 0 0;"><strong>Timeline:</strong> ' + escapeHtml(post.collab_timeline) + "</p>" : "");
    }
    var likeLabel = kind === "event" ? "Interested" : "Like";

    return (
      '<article class="post-card" data-id="' + post.id + '">' +
      (kindBadge ? '<div class="post-type-flag-slot">' + kindBadge + "</div>" : "") +
      '<div class="post-head">' +
      '<a href="' + authorLink + '">' + avatarHtml(name, author.category, author.avatar_url) + "</a>" +
      "<div>" +
      '<a class="post-author-name" href="' + authorLink + '">' + escapeHtml(name) + "</a>" +
      '<div class="post-meta-row"><span>' + relativeTime(new Date(post.created_at).getTime()) + " ago</span></div>" +
      "</div></div>" +
      '<p class="post-body">' + escapeHtml(post.body) + "</p>" +
      structuredHtml +
      '<div class="post-actions">' +
      '<button type="button" class="post-action-icon" data-action="like" data-id="' + post.id + '" aria-pressed="' + liked + '" aria-label="' + likeLabel + '">' +
      (kind === "event"
        ? (liked
          ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>'
          : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>')
        : (liked
          ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><path d="M12 21s-6.7-4.35-9.33-8.6C.86 9.4 2 5.5 5.6 4.6c2.06-.5 3.9.4 5 2.05a.5.5 0 0 0 .8 0c1.1-1.65 2.94-2.55 5-2.05 3.6.9 4.74 4.8 2.93 7.8C18.7 16.65 12 21 12 21z"/></svg>'
          : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.7-4.35-9.33-8.6C.86 9.4 2 5.5 5.6 4.6c2.06-.5 3.9.4 5 2.05a.5.5 0 0 0 .8 0c1.1-1.65 2.94-2.55 5-2.05 3.6.9 4.74 4.8 2.93 7.8C18.7 16.65 12 21 12 21z"/></svg>')) +
      "<span>" + likeCount + "</span></button>" +
      '<button type="button" class="post-action-icon" data-action="toggle-comments" data-id="' + post.id + '" aria-label="Toggle comments">' +
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
      "<span>" + commentCount + "</span></button>" +
      (post.author_id === profile.id
        ? '<button type="button" class="post-action-icon" data-action="delete-post" data-id="' + post.id + '" aria-label="Delete post">' +
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>' +
          "</button>"
        : "") +
      "</div>" +
      '<div class="feed-comments" data-comments-for="' + post.id + '"' + (isOpen ? "" : " hidden") + ' style="margin-top:0.6rem;">' +
      '<div class="feed-comments-list" id="comments-list-' + post.id + '" style="display:flex; flex-direction:column; gap:0.3rem; margin-bottom:0.5rem;"></div>' +
      '<form class="chat-compose chat-compose--light" data-post-id="' + post.id + '">' +
      '<input type="text" placeholder="Write a comment&hellip;" required>' +
      '<button type="submit" class="icon-btn" aria-label="Send comment"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg></button>' +
      "</form>" +
      "</div>" +
      "</article>"
    );
  }

  function renderFeed() {
    var listEl = document.getElementById("feed-list");
    var visible = visibleItems();
    listEl.innerHTML = visible.length
      ? visible.map(itemCardHtml).join("")
      : '<div class="empty-state"><h3>Nothing here yet</h3><p>Be the first to share an update with the network.</p></div>';
    openComments.forEach(function (postId) { loadComments(postId); });

    var countEl = document.getElementById("feed-result-count");
    if (countEl) countEl.textContent = visible.length + (visible.length === 1 ? " post" : " posts");
  }

  var trendingItemId = null;

  async function fetchTrending() {
    var res = await sb.from("trending_posts").select("post_id").eq("scope", "feed").maybeSingle();
    trendingItemId = res.error || !res.data ? null : res.data.post_id;
  }

  function recentItemHtml(item, isTrending) {
    var author = item.profiles || {};
    var name = author.org_name || author.contact_name || "Member";
    var preview = item.body.length > 60 ? item.body.slice(0, 60) + "…" : item.body;
    var tag = item.source === "exchange" ? " · The Exchange" : item.source === "coop" ? " · The Co-Op" : "";
    return '<a class="app-context-recent-item' + (isTrending ? ' app-context-recent-item--trending' : '') + '" href="#" data-scroll-to="' + item.id + '">' +
      (isTrending ? '<span class="trending-flame" aria-hidden="true">🔥</span>' : '') +
      escapeHtml(preview) + "<span>" + escapeHtml(name) + tag + "</span></a>";
  }

  function renderRecent() {
    var recentEl = document.getElementById("feed-recent-list");
    if (!recentEl) return;
    var sorted = feedItems.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    var trendingItem = trendingItemId ? sorted.find(function (i) { return i.id === trendingItemId; }) : null;
    var rest = sorted.filter(function (i) { return !trendingItem || i.id !== trendingItem.id; }).slice(0, 8);

    var html = (trendingItem ? recentItemHtml(trendingItem, true) : "") + rest.map(function (i) { return recentItemHtml(i, false); }).join("");
    recentEl.innerHTML = html || '<p class="settings-note">No activity yet.</p>';
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

    var composerAvatar = document.getElementById("composer-avatar");
    composerAvatar.classList.toggle("portal-avatar-img", !!profile.avatar);
    composerAvatar.innerHTML = profile.avatar ? '<img src="' + profile.avatar + '" alt="">' : escapeHtml(initials(profile.name));
    if (!profile.avatar && profile.category) composerAvatar.setAttribute("data-cat", profile.category);

    await fetchMyLikes();
    await loadFeedItems();
    await fetchTrending();
    renderFeed();
    renderRecent();

    var composerForm = document.getElementById("feed-composer-form");
    var composerError = document.getElementById("feed-composer-error");
    var composerTextarea = document.getElementById("feed-composer-textarea");
    var composerKindPills = document.getElementById("composer-kind-pills");
    var composerEventFields = document.getElementById("composer-event-fields");
    var composerCollabFields = document.getElementById("composer-collab-fields");
    var composerEventAt = document.getElementById("composer-event-at");
    var composerCollabSkills = document.getElementById("composer-collab-skills");
    var composerCollabTimeline = document.getElementById("composer-collab-timeline");
    var composerKind = "update";

    composerKindPills.addEventListener("click", function (e) {
      var pill = e.target.closest(".cat-pill");
      if (!pill) return;
      composerKind = pill.getAttribute("data-kind");
      composerKindPills.querySelectorAll(".cat-pill").forEach(function (p) {
        p.setAttribute("aria-pressed", String(p === pill));
      });
      composerEventFields.hidden = composerKind !== "event";
      composerCollabFields.hidden = composerKind !== "collab";
    });

    composerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = composerTextarea.value.trim();
      if (!body) return;
      composerError.hidden = true;
      var submitBtn = composerForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      var payload = { author_id: profile.id, body: body, post_kind: composerKind };
      if (composerKind === "event" && composerEventAt.value) {
        payload.event_at = new Date(composerEventAt.value).toISOString();
      }
      if (composerKind === "collab") {
        if (composerCollabSkills.value.trim()) payload.collab_skills_needed = composerCollabSkills.value.trim();
        if (composerCollabTimeline.value.trim()) payload.collab_timeline = composerCollabTimeline.value.trim();
      }

      sb.from("posts").insert(payload).then(function (res) {
        submitBtn.disabled = false;
        if (res.error) {
          composerError.textContent = res.error.message;
          composerError.hidden = false;
          return;
        }
        composerTextarea.value = "";
        composerEventAt.value = "";
        composerCollabSkills.value = "";
        composerCollabTimeline.value = "";
        composerKind = "update";
        composerKindPills.querySelectorAll(".cat-pill").forEach(function (p) {
          p.setAttribute("aria-pressed", String(p.getAttribute("data-kind") === "update"));
        });
        composerEventFields.hidden = true;
        composerCollabFields.hidden = true;
        loadFeedItems().then(function () { renderFeed(); renderRecent(); });
      });
    });

    var feedTypePills = document.getElementById("feed-type-pills");
    feedTypePills.addEventListener("click", function (e) {
      var pill = e.target.closest(".cat-pill");
      if (!pill) return;
      filterState.type = pill.getAttribute("data-type");
      feedTypePills.querySelectorAll(".cat-pill").forEach(function (p) {
        p.setAttribute("aria-pressed", String(p === pill));
      });
      renderFeed();
    });

    document.getElementById("feed-sort-select").addEventListener("change", function (e) {
      filterState.sort = e.target.value;
      renderFeed();
    });

    document.getElementById("feed-search").addEventListener("input", renderFeed);

    var listEl = document.getElementById("feed-list");

    listEl.addEventListener("click", function (e) {
      var likeBtn = e.target.closest('[data-action="like"]');
      if (likeBtn) {
        var postId = likeBtn.dataset.id;
        var alreadyLiked = likedPostIds.has(postId);
        likeBtn.disabled = true;
        var op = alreadyLiked
          ? sb.from("post_likes").delete().eq("post_id", postId).eq("profile_id", profile.id)
          : sb.from("post_likes").insert({ post_id: postId, profile_id: profile.id });
        op.then(function (res) {
          likeBtn.disabled = false;
          if (res.error) return;
          if (alreadyLiked) likedPostIds.delete(postId);
          else likedPostIds.add(postId);
          loadFeedItems().then(renderFeed);
        });
        return;
      }

      var toggleBtn = e.target.closest('[data-action="toggle-comments"]');
      if (toggleBtn) {
        var pid = toggleBtn.dataset.id;
        if (openComments.has(pid)) openComments.delete(pid);
        else openComments.add(pid);
        renderFeed();
        return;
      }

      var likeCommentBtn = e.target.closest('[data-action="like-comment"]');
      if (likeCommentBtn) {
        var commentId = likeCommentBtn.dataset.id;
        var commentAlreadyLiked = likedCommentIds.has(commentId);
        var commentPostId = likeCommentBtn.closest(".feed-comments").dataset.commentsFor;
        likeCommentBtn.disabled = true;
        var commentOp = commentAlreadyLiked
          ? sb.from("comment_likes").delete().eq("comment_id", commentId).eq("profile_id", profile.id)
          : sb.from("comment_likes").insert({ comment_id: commentId, profile_id: profile.id });
        commentOp.then(function (res) {
          likeCommentBtn.disabled = false;
          if (res.error) return;
          if (commentAlreadyLiked) likedCommentIds.delete(commentId);
          else likedCommentIds.add(commentId);
          loadComments(commentPostId);
        });
        return;
      }

      var deleteCommentBtn = e.target.closest('[data-action="delete-comment"]');
      if (deleteCommentBtn) {
        if (!window.confirm("Delete this comment?")) return;
        var delCommentId = deleteCommentBtn.dataset.id;
        var delCommentPostId = deleteCommentBtn.closest(".feed-comments").dataset.commentsFor;
        deleteCommentBtn.disabled = true;
        // .eq("author_id", profile.id) mirrors the post_comments_owner_delete
        // RLS policy that already enforces this server-side — belt and
        // suspenders, not the only thing standing between you and someone
        // else's comment.
        sb.from("post_comments").delete().eq("id", delCommentId).eq("author_id", profile.id).then(function (res) {
          deleteCommentBtn.disabled = false;
          if (res.error) { window.alert(res.error.message); return; }
          loadComments(delCommentPostId);
          loadFeedItems().then(renderFeed);
        });
        return;
      }

      var deletePostBtn = e.target.closest('[data-action="delete-post"]');
      if (deletePostBtn) {
        if (!window.confirm("Delete this post? This can't be undone.")) return;
        var delPostId = deletePostBtn.dataset.id;
        deletePostBtn.disabled = true;
        sb.from("posts").delete().eq("id", delPostId).eq("author_id", profile.id).then(function (res) {
          deletePostBtn.disabled = false;
          if (res.error) { window.alert(res.error.message); return; }
          loadFeedItems().then(renderFeed);
        });
      }
    });

    listEl.addEventListener("submit", function (e) {
      var form = e.target.closest(".chat-compose");
      if (!form) return;
      e.preventDefault();
      var input = form.querySelector("input");
      var body = input.value.trim();
      if (!body) return;
      var postId = form.dataset.postId;

      sb.from("post_comments").insert({ post_id: postId, author_id: profile.id, body: body }).then(function (res) {
        if (res.error) return;
        input.value = "";
        loadFeedItems().then(renderFeed);
      });
    });

    document.getElementById("feed-recent-list").addEventListener("click", function (e) {
      var link = e.target.closest("[data-scroll-to]");
      if (!link) return;
      e.preventDefault();
      var card = document.querySelector('.post-card[data-id="' + link.dataset.scrollTo + '"]');
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
})();
