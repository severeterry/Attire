(function () {
  "use strict";

  var sb = window.supabaseClient;
  var profile = null;
  var dealPosts = [];
  var filterState = { sort: "newest" };
  var responseCounts = {};

  // Uploads to the shared post-attachments bucket (public read, so the
  // resulting URL works directly in an <img src> the same way the
  // directory's logo URLs do) and returns the public URL, or null if
  // nothing was selected.
  async function uploadPostImage(file, ownerId) {
    if (!file) return null;
    var ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    var path = ownerId + "/" + Date.now() + "-" + Math.random().toString(36).slice(2) + "." + ext;
    var res = await sb.storage.from("post-attachments").upload(path, file);
    if (res.error) return null;
    return sb.storage.from("post-attachments").getPublicUrl(path).data.publicUrl;
  }

  function setupImageAttach(btnId, inputId, nameId, previewId) {
    var btn = document.getElementById(btnId);
    var input = document.getElementById(inputId);
    var nameEl = document.getElementById(nameId);
    var previewEl = document.getElementById(previewId);
    if (!btn || !input) return;

    btn.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      var file = input.files[0];
      if (!file) {
        if (nameEl) nameEl.textContent = "";
        if (previewEl) previewEl.hidden = true;
        return;
      }
      if (nameEl) nameEl.textContent = file.name;
      if (previewEl) {
        previewEl.src = URL.createObjectURL(file);
        previewEl.hidden = false;
      }
    });
  }

  function clearImageAttach(inputId, nameId, previewId) {
    var input = document.getElementById(inputId);
    var nameEl = document.getElementById(nameId);
    var previewEl = document.getElementById(previewId);
    if (input) input.value = "";
    if (nameEl) nameEl.textContent = "";
    if (previewEl) previewEl.hidden = true;
  }

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

  // ---- Active Exchange Threads (sidebar) + shared messenger-style popup —
  // replaces surfacing these threads on the Messages page; each thread now
  // lives only under the page it belongs to. ----

  function timeLeftLabel(lastMessageAt) {
    var expiresAt = new Date(lastMessageAt).getTime() + 14 * 24 * 60 * 60 * 1000;
    var msLeft = expiresAt - Date.now();
    if (msLeft <= 0) return "Expired";
    var daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    if (daysLeft >= 1) return daysLeft + "d left";
    return Math.max(1, Math.ceil(msLeft / (60 * 60 * 1000))) + "h left";
  }

  var TIME_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';

  async function fetchMyExchangeThreads() {
    var tpRes = await sb.from("thread_participants").select("thread_id, last_read_at").eq("profile_id", profile.id);
    if (tpRes.error || !tpRes.data.length) return [];
    var lastReadByThread = {};
    tpRes.data.forEach(function (r) { lastReadByThread[r.thread_id] = r.last_read_at; });
    var threadIds = tpRes.data.map(function (r) { return r.thread_id; });

    var threadsRes = await sb.from("threads").select("id, status, last_message_at")
      .in("id", threadIds).not("rfp_post_id", "is", null).eq("status", "active")
      .order("last_message_at", { ascending: false });
    if (threadsRes.error || !threadsRes.data.length) return [];

    var activeIds = threadsRes.data.map(function (t) { return t.id; });
    var otherRes = await sb.from("thread_participants").select("thread_id, profiles(org_name, contact_name, category, avatar_url)")
      .in("thread_id", activeIds).neq("profile_id", profile.id);
    var otherByThread = {};
    (otherRes.data || []).forEach(function (r) { otherByThread[r.thread_id] = r.profiles; });

    var threads = [];
    for (var i = 0; i < threadsRes.data.length; i++) {
      var t = threadsRes.data[i];
      var unreadRes = await sb.from("messages").select("id", { count: "exact", head: true })
        .eq("thread_id", t.id).neq("sender_id", profile.id).gt("created_at", lastReadByThread[t.id]);
      threads.push({ id: t.id, lastMessageAt: t.last_message_at, other: otherByThread[t.id] || null, unread: unreadRes.count || 0 });
    }
    return threads;
  }

  function activeThreadItemHtml(t) {
    var other = t.other || {};
    var name = other.org_name || other.contact_name || "Member";
    return (
      '<button type="button" class="active-thread-item" data-action="open-thread-popup" data-id="' + t.id + '">' +
      avatarHtml(name, other.category, "active-thread-avatar portal-avatar-sm", other.avatar_url) +
      '<span class="active-thread-body">' +
      '<span class="active-thread-name">' + escapeHtml(name) + "</span>" +
      '<span class="active-thread-meta">' + TIME_ICON + timeLeftLabel(t.lastMessageAt) + "</span></span>" +
      (t.unread > 0 ? '<span class="active-thread-unread" aria-hidden="true" title="Unread messages"></span>' : "") +
      "</button>"
    );
  }

  async function renderActiveExchangeThreads() {
    var listEl = document.getElementById("active-exchange-threads-list");
    if (!listEl) return;
    var threads = await fetchMyExchangeThreads();
    listEl.innerHTML = threads.length ? threads.map(activeThreadItemHtml).join("") : '<p class="settings-note">No active conversations.</p>';
  }

  var activeThreadPopupId = null;
  var threadPopupParticipants = {};

  async function openThreadPopup(threadId) {
    activeThreadPopupId = threadId;
    document.getElementById("thread-popup-backdrop").classList.add("is-open");
    document.getElementById("thread-popup-members-list").hidden = true;

    sb.from("threads").select("status").eq("id", threadId).maybeSingle().then(function (statusRes) {
      var expired = statusRes.data && statusRes.data.status === "expired";
      document.getElementById("thread-popup-compose-form").hidden = expired;
      document.getElementById("thread-popup-expired-note").hidden = !expired;
    });

    var partRes = await sb.from("thread_participants").select("profile_id, profiles(org_name, contact_name, category, avatar_url)").eq("thread_id", threadId);
    var participants = partRes.data || [];
    threadPopupParticipants = {};
    participants.forEach(function (p) { threadPopupParticipants[p.profile_id] = p.profiles || {}; });

    var membersHtml = participants.map(function (p) {
      var n = p.profiles ? (p.profiles.org_name || p.profiles.contact_name || "Member") : "Member";
      var prof = p.profiles || {};
      return '<div class="context-member-item">' + avatarHtml(n, prof.category, "portal-avatar-sm", prof.avatar_url) +
        '<span class="context-member-name" style="color:inherit;">' + escapeHtml(n) + "</span></div>";
    }).join("");
    document.getElementById("thread-popup-members-list").innerHTML =
      '<p class="details-panel-heading">Members</p>' + membersHtml +
      '<p class="details-panel-heading">Shared Photos</p><p class="settings-note">Loading&hellip;</p>';

    sb.from("messages").select("image_url").eq("thread_id", threadId).not("image_url", "is", null)
      .order("created_at", { ascending: false }).limit(9).then(function (photoRes) {
        var urls = (photoRes.data || []).map(function (m) { return m.image_url; });
        var photosEl = document.getElementById("thread-popup-members-list").lastElementChild;
        if (photosEl) photosEl.outerHTML = sharedPhotosHtml(urls);
      });

    var others = participants.filter(function (p) { return p.profile_id !== profile.id; });
    var owner = others.length === 1 ? (others[0].profiles || {}) : {};
    var title = others.length === 1
      ? (owner.org_name || owner.contact_name || "Member")
      : "Group (" + participants.length + ")";
    document.getElementById("thread-popup-title").textContent = title;

    var headEl = document.getElementById("thread-popup-head");
    var avatarEl = document.getElementById("thread-popup-avatar");
    if (others.length === 1) {
      headEl.setAttribute("data-cat", owner.category || "");
      avatarEl.outerHTML = avatarHtml(title, owner.category, "thread-popup-avatar", owner.avatar_url).replace("<span", '<span id="thread-popup-avatar"');
    } else {
      headEl.removeAttribute("data-cat");
      avatarEl.outerHTML = '<span class="portal-avatar thread-popup-avatar" id="thread-popup-avatar">' + others.length + "</span>";
    }

    sb.from("thread_participants").update({ last_read_at: new Date().toISOString() })
      .eq("thread_id", threadId).eq("profile_id", profile.id).then(function () {});

    await loadThreadPopupMessages();
  }

  async function loadThreadPopupMessages() {
    if (!activeThreadPopupId) return;
    var msgRes = await sb.from("messages").select("id, sender_id, body, image_url, created_at")
      .eq("thread_id", activeThreadPopupId).order("created_at", { ascending: true });
    var bodyEl = document.getElementById("thread-popup-body");
    var msgs = msgRes.data || [];
    bodyEl.innerHTML = msgs.length
      ? msgs.map(function (m, i) {
          var mine = m.sender_id === profile.id;
          var sender = threadPopupParticipants[m.sender_id] || {};
          var senderName = sender.org_name || sender.contact_name || "Member";
          var isLastOfRun = i === msgs.length - 1 || msgs[i + 1].sender_id !== m.sender_id;
          return '<div class="chat-bubble-row from-' + (mine ? "me" : "them") + '">' +
            (mine ? "" : isLastOfRun
              ? avatarHtml(senderName, sender.category, "chat-bubble-avatar portal-avatar-sm", sender.avatar_url)
              : '<span class="chat-bubble-avatar-spacer" aria-hidden="true"></span>') +
            '<div class="chat-bubble from-' + (mine ? "me" : "them") + '">' +
            (m.image_url ? '<img class="chat-bubble-img" src="' + escapeHtml(m.image_url) + '" alt="">' : "") +
            (m.body ? escapeHtml(m.body) : "") + "</div></div>";
        }).join("")
      : '<p class="settings-note">No messages yet.</p>';
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function closeThreadPopup() {
    activeThreadPopupId = null;
    document.getElementById("thread-popup-backdrop").classList.remove("is-open");
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

  function sharedPhotosHtml(urls) {
    if (!urls.length) return '<p class="settings-note">No photos shared yet.</p>';
    return '<div class="shared-photos-grid">' + urls.map(function (u) {
      return '<a href="' + escapeHtml(u) + '" target="_blank" rel="noopener" class="shared-photo-thumb"><img src="' + escapeHtml(u) + '" alt="" loading="lazy"></a>';
    }).join("") + "</div>";
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
      .select("id, post_type, category, scope, moq, budget_range, deadline, material_spec, certifications, body, status, created_at, author_id, image_url, profiles(org_name, contact_name, category)")
      .order("created_at", { ascending: false });
    if (res.error) {
      console.error(res.error);
      return [];
    }
    return res.data;
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

  function dealPostHtml(post) {
    var author = post.profiles || {};
    var authorName = author.org_name || author.contact_name || "Member";
    var quickDetails = [post.category ? labelForCategory(post.category) : null, post.scope, post.budget_range].filter(Boolean).join(" &middot; ");
    var authorLink = post.author_id === profile.id ? "profile.html" : "profile.html?id=" + encodeURIComponent(post.author_id);
    var isOwner = post.author_id === profile.id;

    var fullDetails = [
      post.moq ? "MOQ: " + escapeHtml(post.moq) : null,
      post.deadline ? "Deadline: " + escapeHtml(post.deadline) : null,
      post.material_spec ? "Material: " + escapeHtml(post.material_spec) : null,
      post.certifications ? "Certifications: " + escapeHtml(post.certifications) : null,
    ].filter(Boolean);

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
      (post.image_url ? '<img class="post-attachment-img" src="' + escapeHtml(post.image_url) + '" alt="" loading="lazy">' : "") +
      '<p class="post-body post-body--clamped">' + escapeHtml(post.body) + "</p>" +
      '<p class="settings-note">' + (quickDetails || "No additional details") + " &mdash; " + post.status + "</p>" +
      '<div class="post-expand-details" hidden>' +
      (fullDetails.length ? '<ul class="post-detail-list">' + fullDetails.map(function (d) { return "<li>" + d + "</li>"; }).join("") + "</ul>" : "") +
      "</div>" +
      '<div class="post-actions">' +
      '<button type="button" class="btn btn-outline btn-sm" data-action="toggle-expand">See full details</button>' +
      (isOwner
        ? (post.status === "open"
          ? '<button type="button" class="btn btn-outline btn-sm" data-action="mark-fulfilled" data-id="' + post.id + '">Mark Fulfilled</button>'
          : "") +
          '<button type="button" class="post-action-icon" data-action="delete-post" data-id="' + post.id + '" aria-label="Delete post">' +
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>' +
          "</button>"
        : post.status !== "open"
          ? '<span class="settings-note">No longer available.</span>'
          : isFreeTier()
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

  var trendingPostId = null;

  async function fetchTrending() {
    var res = await sb.from("trending_posts").select("post_id").eq("scope", "exchange").maybeSingle();
    trendingPostId = res.error || !res.data ? null : res.data.post_id;
  }

  function recentItemHtml(p, isTrending) {
    var author = p.profiles || {};
    var name = author.org_name || author.contact_name || "Member";
    var preview = p.body.length > 60 ? p.body.slice(0, 60) + "…" : p.body;
    return '<a class="app-context-recent-item' + (isTrending ? ' app-context-recent-item--trending' : '') + '" href="#" data-scroll-to="' + p.id + '">' +
      (isTrending ? '<span class="trending-flame" aria-hidden="true">🔥</span>' : '') +
      escapeHtml(preview) + "<span>" + escapeHtml(name) + "</span></a>";
  }

  function renderRecent() {
    var recentEl = document.getElementById("exchange-recent-list");
    if (!recentEl) return;
    var trendingPost = trendingPostId ? dealPosts.find(function (p) { return p.id === trendingPostId; }) : null;
    var rest = dealPosts.filter(function (p) { return !trendingPost || p.id !== trendingPost.id; }).slice(0, 8);

    var html = (trendingPost ? recentItemHtml(trendingPost, true) : "") + rest.map(function (p) { return recentItemHtml(p, false); }).join("");
    recentEl.innerHTML = html || '<p class="settings-note">No listings yet.</p>';
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
    document.getElementById("respond-quote-price").value = "";
    document.getElementById("respond-quote-moq").value = "";
    document.getElementById("respond-quote-lead-time").value = "";
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

  // Creating the thread + adding both participants + the first message all
  // happens atomically server-side — a thread has no way to satisfy its own
  // "am I a participant" read policy until a thread_participants row
  // exists, so building it up via separate client-side inserts can never
  // work for the creator reading their own just-created thread back.
  async function sendThreadResponse(body, quotePrice, quoteMoq, quoteLeadTime, submitBtn, errorEl) {
    submitBtn.disabled = true;
    var res = await sb.rpc("start_rfp_thread", {
      p_rfp_post_id: respondPostId, p_initial_message: body,
      p_quote_price: quotePrice || null, p_quote_moq: quoteMoq || null, p_quote_lead_time: quoteLeadTime || null,
    });
    submitBtn.disabled = false;
    if (res.error) {
      errorEl.textContent = res.error.message;
      errorEl.hidden = false;
      return;
    }
    closeRespondModal();
    await renderActiveExchangeThreads();
    openThreadPopup(res.data);
  }

  async function submitRespond() {
    var textarea = document.getElementById("respond-textarea");
    var errorEl = document.getElementById("respond-error");
    var body = textarea.value.trim();
    if (!body || !respondPostId) return;
    errorEl.hidden = true;
    var form = document.getElementById("respond-form");
    var submitBtn = form.querySelector('button[type="submit"]');
    await sendThreadResponse(
      body,
      document.getElementById("respond-quote-price").value.trim(),
      document.getElementById("respond-quote-moq").value.trim(),
      document.getElementById("respond-quote-lead-time").value.trim(),
      submitBtn, errorEl
    );
  }

  async function submitSampleRequest() {
    var errorEl = document.getElementById("respond-error");
    if (!respondPostId) return;
    errorEl.hidden = true;
    var sampleBtn = document.getElementById("respond-sample-btn");
    await sendThreadResponse("Requesting a sample of this material.", null, null, null, sampleBtn, errorEl);
  }

  function renderComposerAvatar() {
    var el = document.getElementById("composer-avatar");
    if (!el) return;
    el.classList.toggle("portal-avatar-img", !!profile.avatar);
    el.innerHTML = profile.avatar ? '<img src="' + profile.avatar + '" alt="">' : escapeHtml(initials(profile.name));
    if (!profile.avatar && profile.category) el.setAttribute("data-cat", profile.category);
  }

  function applyTierGates() {
    var tier = profile.tier || "individual_affiliate";
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
    return (profile.tier || "individual_affiliate") === "free";
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

    var welcomeBanner = document.getElementById("welcome-banner");
    if (welcomeBanner) {
      welcomeBanner.textContent = "Welcome, " + (profile.name || profile.orgName || "there") + ".";
      welcomeBanner.hidden = false;
    }

    renderComposerAvatar();
    applyTierGates();

    dealPosts = await fetchDealPosts();
    responseCounts = await fetchResponseCounts(dealPosts.map(function (p) { return p.id; }));
    await fetchTrending();
    renderFeed();
    renderRecent();
    renderActiveExchangeThreads();

    var jumpToId = new URLSearchParams(window.location.search).get("id");
    if (jumpToId) {
      var jumpCard = document.querySelector('.post-card[data-id="' + jumpToId + '"]');
      if (jumpCard) {
        jumpCard.scrollIntoView({ behavior: "smooth", block: "center" });
        jumpCard.classList.add("is-jump-target");
        setTimeout(function () { jumpCard.classList.remove("is-jump-target"); }, 2200);
      }
    }

    var composerForm = document.getElementById("composer-form");
    var composerError = document.getElementById("composer-error");
    setupImageAttach("composer-attach-btn", "composer-image-input", "composer-attach-name", "composer-attach-preview");

    composerForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var body = document.getElementById("composer-textarea").value.trim();
      if (!body) return;
      composerError.hidden = true;

      var submitBtn = composerForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      var imageFile = document.getElementById("composer-image-input").files[0];
      var imageUrl = await uploadPostImage(imageFile, profile.id);

      sb.from("rfp_posts").insert({
        author_id: profile.id,
        post_type: "sourcing",
        category: document.getElementById("composer-category").value.trim() || null,
        scope: document.getElementById("composer-scope").value.trim() || null,
        moq: document.getElementById("composer-moq").value.trim() || null,
        budget_range: document.getElementById("composer-budget").value.trim() || null,
        deadline: document.getElementById("composer-deadline").value || null,
        material_spec: document.getElementById("composer-material-spec").value.trim() || null,
        certifications: document.getElementById("composer-certifications").value.trim() || null,
        body: body,
        image_url: imageUrl,
      }).then(function (res) {
        submitBtn.disabled = false;
        if (res.error) {
          composerError.textContent = res.error.message;
          composerError.hidden = false;
          return;
        }
        composerForm.reset();
        clearImageAttach("composer-image-input", "composer-attach-name", "composer-attach-preview");
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
      if (respondBtn) { openRespondModal(respondBtn.dataset.id); return; }

      var fulfillBtn = e.target.closest('[data-action="mark-fulfilled"]');
      if (fulfillBtn) {
        fulfillBtn.disabled = true;
        sb.from("rfp_posts").update({ status: "fulfilled" }).eq("id", fulfillBtn.dataset.id).then(function (res) {
          if (res.error) { fulfillBtn.disabled = false; return; }
          fetchDealPosts().then(function (posts) { dealPosts = posts; renderFeed(); renderRecent(); });
        });
        return;
      }

      var deleteBtn = e.target.closest('[data-action="delete-post"]');
      if (deleteBtn) {
        if (!window.confirm("Delete this post? Any conversations it started will be kept, but the post itself can't be recovered.")) return;
        deleteBtn.disabled = true;
        sb.from("rfp_posts").delete().eq("id", deleteBtn.dataset.id).then(function (res) {
          if (res.error) { deleteBtn.disabled = false; window.alert(res.error.message); return; }
          fetchDealPosts().then(function (posts) { dealPosts = posts; renderFeed(); renderRecent(); });
        });
        return;
      }

      var toggleBtn = e.target.closest('[data-action="toggle-expand"]');
      if (toggleBtn) {
        var card = toggleBtn.closest(".post-card");
        var expanded = card.classList.toggle("is-expanded");
        card.querySelector(".post-body").classList.toggle("post-body--clamped", !expanded);
        card.querySelector(".post-expand-details").hidden = !expanded;
        toggleBtn.textContent = expanded ? "Show less" : "See full details";
        return;
      }
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
    document.getElementById("respond-sample-btn").addEventListener("click", submitSampleRequest);

    document.getElementById("active-exchange-threads-list").addEventListener("click", function (e) {
      var item = e.target.closest('[data-action="open-thread-popup"]');
      if (!item) return;
      openThreadPopup(item.dataset.id);
    });

    document.getElementById("thread-popup-close").addEventListener("click", function () {
      closeThreadPopup();
      renderActiveExchangeThreads();
    });
    document.getElementById("thread-popup-backdrop").addEventListener("click", function (e) {
      if (e.target.id === "thread-popup-backdrop") { closeThreadPopup(); renderActiveExchangeThreads(); }
    });
    document.getElementById("thread-popup-members-btn").addEventListener("click", function () {
      var list = document.getElementById("thread-popup-members-list");
      list.hidden = !list.hidden;
    });
    document.getElementById("thread-popup-attach-btn").addEventListener("click", function () {
      document.getElementById("thread-popup-image-input").click();
    });
    document.getElementById("thread-popup-compose-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!activeThreadPopupId) return;
      var input = document.getElementById("thread-popup-input");
      var body = input.value.trim();
      var imageFile = document.getElementById("thread-popup-image-input").files[0];
      if (!body && !imageFile) return;
      var submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      var imageUrl = await uploadPostImage(imageFile, profile.id);
      sb.from("messages").insert({ thread_id: activeThreadPopupId, sender_id: profile.id, body: body || "", image_url: imageUrl }).then(function (res) {
        submitBtn.disabled = false;
        if (res.error) { window.alert(res.error.message); return; }
        input.value = "";
        document.getElementById("thread-popup-image-input").value = "";
        loadThreadPopupMessages();
      });
    });

    document.getElementById("exchange-recent-list").addEventListener("click", function (e) {
      var link = e.target.closest("[data-scroll-to]");
      if (!link) return;
      e.preventDefault();
      var card = document.querySelector('.post-card[data-id="' + link.dataset.scrollTo + '"]');
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.add("is-jump-target");
      setTimeout(function () { card.classList.remove("is-jump-target"); }, 2200);
    });
  });
})();
