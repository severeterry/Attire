(function () {
  "use strict";

  var sb = window.supabaseClient;
  var profile = null;
  var posts = [];
  var likedPostIds = new Set();
  var openComments = new Set();

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
      .select("id, body, created_at, author_id, profiles(org_name, contact_name, category, avatar_url), post_likes(count), post_comments(count)")
      .order("created_at", { ascending: false });
    if (res.error) { console.error(res.error); return []; }
    return res.data;
  }

  async function fetchMyLikes() {
    var res = await sb.from("post_likes").select("post_id").eq("profile_id", profile.id);
    likedPostIds = new Set((res.data || []).map(function (r) { return r.post_id; }));
  }

  async function loadComments(postId) {
    var res = await sb
      .from("post_comments")
      .select("id, body, created_at, profiles(org_name, contact_name)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    var listEl = document.getElementById("comments-list-" + postId);
    if (!listEl) return;
    var comments = res.data || [];
    listEl.innerHTML = comments.length
      ? comments.map(function (c) {
          var author = c.profiles || {};
          var name = author.org_name || author.contact_name || "Member";
          return '<p class="settings-note"><strong>' + escapeHtml(name) + ":</strong> " + escapeHtml(c.body) + "</p>";
        }).join("")
      : '<p class="settings-note">No comments yet.</p>';
  }

  function postCardHtml(post) {
    var author = post.profiles || {};
    var name = author.org_name || author.contact_name || "Member";
    var authorLink = post.author_id === profile.id ? "profile.html" : "profile.html?id=" + encodeURIComponent(post.author_id);
    var likeCount = (post.post_likes && post.post_likes[0] && post.post_likes[0].count) || 0;
    var commentCount = (post.post_comments && post.post_comments[0] && post.post_comments[0].count) || 0;
    var liked = likedPostIds.has(post.id);
    var isOpen = openComments.has(post.id);

    return (
      '<article class="post-card" data-id="' + post.id + '">' +
      '<div class="post-head">' +
      '<a href="' + authorLink + '">' + avatarHtml(name, author.category, author.avatar_url) + "</a>" +
      "<div>" +
      '<a class="post-author-name" href="' + authorLink + '">' + escapeHtml(name) + "</a>" +
      '<div class="post-meta-row"><span>' + relativeTime(new Date(post.created_at).getTime()) + " ago</span></div>" +
      "</div></div>" +
      '<p class="post-body">' + escapeHtml(post.body) + "</p>" +
      '<div class="post-actions">' +
      '<button type="button" class="btn btn-outline btn-sm" data-action="like" data-id="' + post.id + '" aria-pressed="' + liked + '">' +
      (liked ? "&#9829;" : "&#9825;") + " " + likeCount +
      "</button>" +
      '<button type="button" class="btn btn-outline btn-sm" data-action="toggle-comments" data-id="' + post.id + '">Comments (' + commentCount + ")</button>" +
      "</div>" +
      '<div class="feed-comments" data-comments-for="' + post.id + '"' + (isOpen ? "" : " hidden") + ' style="margin-top:0.6rem;">' +
      '<div class="feed-comments-list" id="comments-list-' + post.id + '" style="display:flex; flex-direction:column; gap:0.3rem; margin-bottom:0.5rem;"></div>' +
      '<form class="chat-compose" data-post-id="' + post.id + '">' +
      '<input type="text" placeholder="Write a comment&hellip;" required>' +
      '<button type="submit" class="icon-btn" aria-label="Send comment"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg></button>' +
      "</form>" +
      "</div>" +
      "</article>"
    );
  }

  function renderFeed() {
    var listEl = document.getElementById("feed-list");
    listEl.innerHTML = posts.length
      ? posts.map(postCardHtml).join("")
      : '<div class="empty-state"><h3>Nothing here yet</h3><p>Be the first to share an update with the network.</p></div>';
    openComments.forEach(function (postId) { loadComments(postId); });
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
    posts = await fetchPosts();
    renderFeed();

    var composerForm = document.getElementById("feed-composer-form");
    var composerError = document.getElementById("feed-composer-error");
    var composerTextarea = document.getElementById("feed-composer-textarea");

    composerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = composerTextarea.value.trim();
      if (!body) return;
      composerError.hidden = true;
      var submitBtn = composerForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      sb.from("posts").insert({ author_id: profile.id, body: body }).then(function (res) {
        submitBtn.disabled = false;
        if (res.error) {
          composerError.textContent = res.error.message;
          composerError.hidden = false;
          return;
        }
        composerTextarea.value = "";
        fetchPosts().then(function (p) { posts = p; renderFeed(); });
      });
    });

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
          fetchPosts().then(function (p) { posts = p; renderFeed(); });
        });
        return;
      }

      var toggleBtn = e.target.closest('[data-action="toggle-comments"]');
      if (toggleBtn) {
        var pid = toggleBtn.dataset.id;
        if (openComments.has(pid)) openComments.delete(pid);
        else openComments.add(pid);
        renderFeed();
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
        fetchPosts().then(function (p) { posts = p; renderFeed(); });
      });
    });
  });
})();
