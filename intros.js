(function () {
  "use strict";

  var sb = window.supabaseClient;
  var profile = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function labelForCategory(cat) {
    var map = {
      materials: "Materials & Making",
      circularity: "Circularity & Disposal",
      strategy: "Strategy & Expertise",
      advocacy: "Advocacy & Community",
      retail: "Retail & Creators",
    };
    return map[cat] || "No category set";
  }

  // ---- Browsable list of members open to introductions ----

  var introMembers = [];
  var introFilterState = { search: "", category: "all", borough: "all" };
  var myOutgoingRequests = {};

  async function fetchMyOutgoingIntros() {
    var res = await sb
      .from("intro_requests")
      .select("requestee_id, status")
      .eq("requestor_id", profile.id)
      .order("created_at", { ascending: false });
    if (res.error) return;
    myOutgoingRequests = {};
    (res.data || []).forEach(function (r) {
      // Ordered newest-first, so the first row seen per requestee is their latest status.
      if (!(r.requestee_id in myOutgoingRequests)) myOutgoingRequests[r.requestee_id] = r.status;
    });
  }

  async function fetchIntroMembers() {
    var res = await sb
      .from("profiles")
      .select("id, org_name, contact_name, category, borough, bio, avatar_url, practices")
      .eq("intro_opt_in", true)
      .neq("tier", "free")
      .neq("id", profile.id)
      .order("org_name", { ascending: true });
    if (res.error) { console.error(res.error); return []; }
    return res.data;
  }

  function initials(name) {
    var parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function avatarHtml(name, category, extraClass, avatarUrl) {
    var cls = "portal-avatar portal-avatar-lg" + (extraClass ? " " + extraClass : "");
    if (avatarUrl) return '<span class="' + cls + ' portal-avatar-img"><img src="' + avatarUrl + '" alt=""></span>';
    return '<span class="' + cls + '"' + (category ? ' data-cat="' + category + '"' : "") + ">" + escapeHtml(initials(name)) + "</span>";
  }

  // Default (40px) size, unlike avatarHtml above which is locked to
  // portal-avatar-lg for the browsable member directory cards — used for
  // the compact Active Intros sidebar/popup, matching the sizing convention
  // already established in portal.js/pooling.js/thread.js/messages.js.
  function smallAvatarHtml(name, category, extraClass, avatarUrl) {
    var cls = "portal-avatar" + (extraClass ? " " + extraClass : "");
    if (avatarUrl) return '<span class="' + cls + ' portal-avatar-img"><img src="' + escapeHtml(avatarUrl) + '" alt=""></span>';
    return '<span class="' + cls + '"' + (category ? ' data-cat="' + category + '"' : "") + ">" + escapeHtml(initials(name)) + "</span>";
  }

  function sharedPhotosHtml(urls) {
    if (!urls.length) return '<p class="settings-note">No photos shared yet.</p>';
    return '<div class="shared-photos-grid">' + urls.map(function (u) {
      return '<a href="' + escapeHtml(u) + '" target="_blank" rel="noopener" class="shared-photo-thumb"><img src="' + escapeHtml(u) + '" alt="" loading="lazy"></a>';
    }).join("") + "</div>";
  }

  async function uploadThreadImage(file) {
    if (!file) return null;
    var ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    var path = profile.id + "/" + Date.now() + "-" + Math.random().toString(36).slice(2) + "." + ext;
    var res = await sb.storage.from("post-attachments").upload(path, file);
    if (res.error) return null;
    return sb.storage.from("post-attachments").getPublicUrl(path).data.publicUrl;
  }

  function memberMatchesFilters(m) {
    if (introFilterState.category !== "all" && m.category !== introFilterState.category) return false;
    if (introFilterState.borough !== "all" && m.borough !== introFilterState.borough) return false;
    if (introFilterState.search) {
      var name = (m.org_name || m.contact_name || "").toLowerCase();
      if (name.indexOf(introFilterState.search.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function introActionHtml(memberId, eligible, requestState) {
    if (!eligible) return "";

    if (requestState === "pending") {
      return '<p class="settings-note" style="margin:0;">Request sent</p>';
    }
    if (requestState === "accepted") {
      return '<p class="settings-note" style="margin:0;">Introduced</p>';
    }

    return (
      '<div data-wrap-for="' + memberId + '">' +
      '<button type="button" class="btn btn-outline btn-sm" data-action="request-intro" data-id="' + memberId + '">Request Intro</button>' +
      "</div>" +
      '<form class="intro-request-form" data-id="' + memberId + '" hidden>' +
      '<div class="form-field" style="margin:0.5rem 0;">' +
      '<label for="intro-note-' + memberId + '">Why are you requesting this intro?</label>' +
      '<textarea id="intro-note-' + memberId + '" required></textarea>' +
      "</div>" +
      '<p class="login-error" data-error-for="' + memberId + '" hidden></p>' +
      '<div style="display:flex; gap:0.5rem;">' +
      '<button type="submit" class="btn btn-primary btn-sm">Send Request</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-action="cancel-intro-form" data-id="' + memberId + '">Cancel</button>' +
      "</div>" +
      "</form>"
    );
  }

  function memberCardHtml(m, eligible, requestState) {
    var name = m.org_name || m.contact_name || "Member";
    var practices = (m.practices || []).slice(0, 4);
    var action = introActionHtml(m.id, eligible, requestState);

    return (
      '<div class="post-card">' +
      '<a href="profile.html?id=' + encodeURIComponent(m.id) + '" style="display:block; color:inherit; text-decoration:none;">' +
      '<div class="post-head">' +
      avatarHtml(name, m.category, null, m.avatar_url) +
      "<div>" +
      '<p class="post-author-name">' + escapeHtml(name) + "</p>" +
      '<div class="post-meta-row">' +
      (m.category ? '<span class="cat-badge" data-cat="' + m.category + '">' + escapeHtml(labelForCategory(m.category)) + "</span>" : "") +
      (m.borough ? "<span>" + escapeHtml(m.borough) + "</span>" : "") +
      "</div></div></div>" +
      '<p class="post-body">' + escapeHtml(m.bio || "No bio yet.") + "</p>" +
      (practices.length
        ? '<div style="display:flex; flex-wrap:wrap; gap:0.4rem; margin-top:0.6rem;">' +
          practices.map(function (p) { return '<span class="cat-pill" style="cursor:default;">' + escapeHtml(p) + "</span>"; }).join("") +
          "</div>"
        : "") +
      "</a>" +
      (action ? '<div style="margin-top:0.75rem; padding-top:0.6rem; border-top:1px solid var(--color-border);">' + action + "</div>" : "") +
      "</div>"
    );
  }

  function renderIntroMembers() {
    var grid = document.getElementById("intro-members-grid");
    var empty = document.getElementById("intro-members-empty");
    var upgradeNote = document.getElementById("intro-upgrade-note");
    var filtered = introMembers.filter(memberMatchesFilters);
    var eligible = !!(profile.tier && profile.tier !== "free");

    grid.innerHTML = filtered.map(function (m) {
      return memberCardHtml(m, eligible, myOutgoingRequests[m.id] || null);
    }).join("");
    grid.hidden = filtered.length === 0;
    empty.hidden = filtered.length !== 0;
    if (upgradeNote) upgradeNote.hidden = eligible;
  }

  function setupIntroMemberFilters() {
    var searchInput = document.getElementById("intro-search-input");
    var boroughSelect = document.getElementById("intro-borough-select");
    var categorySelect = document.getElementById("intro-category-select");

    searchInput.addEventListener("input", function () {
      introFilterState.search = searchInput.value.trim();
      renderIntroMembers();
    });
    boroughSelect.addEventListener("change", function () {
      introFilterState.borough = boroughSelect.value;
      renderIntroMembers();
    });
    categorySelect.addEventListener("change", function () {
      introFilterState.category = categorySelect.value;
      renderIntroMembers();
    });
  }

  async function sharedThreadCount(aId, bId) {
    var aRes = await sb.from("thread_participants").select("thread_id").eq("profile_id", aId);
    var bRes = await sb.from("thread_participants").select("thread_id").eq("profile_id", bId);
    var bSet = new Set((bRes.data || []).map(function (t) { return t.thread_id; }));
    return (aRes.data || []).filter(function (t) { return bSet.has(t.thread_id); }).length;
  }

  function incomingCardHtml(intro, sharedCategory, sharedBorough, threadCount) {
    var requestorName = intro.requestor.org_name || intro.requestor.contact_name || "Member";
    var context = [
      sharedCategory && "Same category",
      sharedBorough && "Same borough",
      threadCount > 0 && (threadCount + " shared thread" + (threadCount > 1 ? "s" : "")),
    ].filter(Boolean).join(" &middot; ") || "No shared context yet";

    return (
      '<article class="post-card" data-id="' + intro.id + '">' +
      '<p class="post-author-name">' + escapeHtml(requestorName) + "</p>" +
      '<p class="post-body">' + escapeHtml(intro.note) + "</p>" +
      '<p class="settings-note">' + context + "</p>" +
      '<div style="display:flex; gap:0.5rem; margin-top:0.5rem;">' +
      '<button type="button" class="btn btn-primary btn-sm" data-action="accept" data-id="' + intro.id + '">Accept</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-action="decline" data-id="' + intro.id + '">Decline</button>' +
      "</div>" +
      '<p class="login-error" data-error-for="' + intro.id + '" hidden></p>' +
      "</article>"
    );
  }

  function resolvedCardHtml(intro, isRequestor, otherName, myFeedback) {
    var pieces = [
      '<article class="post-card" data-id="' + intro.id + '">',
      '<p class="post-author-name">' + escapeHtml(otherName || "Member") + "</p>",
      '<p class="settings-note">' + (isRequestor ? "You requested" : "They requested") + " &mdash; " + intro.status + "</p>",
    ];
    if (intro.status === "expired") {
      pieces.push('<p class="settings-note">' + (isRequestor ? "They" : "You") + " didn&rsquo;t respond within 14 days, so this request lapsed.</p>");
    }

    if (intro.status === "accepted" && intro.chat_thread_id) {
      pieces.push('<button type="button" class="btn btn-primary btn-sm" data-action="open-thread" data-thread-id="' + intro.chat_thread_id + '">Message</button>');
    }
    if (intro.status === "accepted" && isRequestor) {
      pieces.push(
        '<div id="contact-' + intro.id + '" style="margin-top:0.5rem;">' +
        '<button type="button" class="btn btn-outline btn-sm" data-action="reveal" data-id="' + intro.id + '">Prefer email or phone? Show contact info</button>' +
        "</div>"
      );
    }
    if (intro.status === "accepted") {
      if (myFeedback !== null) {
        pieces.push('<p class="settings-note">Thanks for the feedback.</p>');
      } else {
        pieces.push(
          '<div style="display:flex; gap:0.5rem; align-items:center; margin-top:0.5rem;">' +
          '<span class="settings-note">Was this a good match?</span>' +
          '<button type="button" class="btn btn-outline btn-sm" data-action="feedback-yes" data-id="' + intro.id + '">Yes</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-action="feedback-no" data-id="' + intro.id + '">No</button>' +
          "</div>"
        );
      }
    }
    pieces.push("</article>");
    return pieces.join("");
  }

  var incomingRequests = [];

  async function loadIncoming() {
    var res = await sb
      .from("intro_requests")
      .select("id, note, created_at, requestor:requestor_id(id, org_name, contact_name, category, borough, avatar_url)")
      .eq("requestee_id", profile.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    var container = document.getElementById("intros-incoming");
    incomingRequests = res.error ? [] : res.data;

    if (res.error || !res.data.length) {
      container.innerHTML = '<p class="settings-note">Nothing pending.</p>';
      renderActiveIntroRequests();
      return;
    }

    var cards = [];
    for (var i = 0; i < res.data.length; i++) {
      var intro = res.data[i];
      var sharedCategory = profile.category && intro.requestor.category === profile.category;
      var sharedBorough = profile.borough && intro.requestor.borough === profile.borough;
      var count = await sharedThreadCount(profile.id, intro.requestor.id);
      cards.push(incomingCardHtml(intro, sharedCategory, sharedBorough, count));
    }
    container.innerHTML = cards.join("");
    renderActiveIntroRequests();
  }

  // Requests I've sent that are still waiting on the other person — the
  // only place these were ever visible before was the "Request sent" text
  // buried on that member's card in the browse grid above, with no way to
  // withdraw one if you changed your mind.
  async function loadOutgoing() {
    var res = await sb
      .from("intro_requests")
      .select("id, note, created_at, requestee:requestee_id(id, org_name, contact_name)")
      .eq("requestor_id", profile.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    var container = document.getElementById("intros-outgoing");
    if (res.error || !res.data.length) {
      container.innerHTML = '<p class="settings-note">Nothing sent and waiting.</p>';
      return;
    }

    container.innerHTML = res.data.map(function (intro) {
      var name = intro.requestee ? (intro.requestee.org_name || intro.requestee.contact_name || "Member") : "Member";
      return (
        '<article class="post-card" data-id="' + intro.id + '">' +
        '<p class="post-author-name">' + escapeHtml(name) + "</p>" +
        (intro.note ? '<p class="post-body">' + escapeHtml(intro.note) + "</p>" : "") +
        '<p class="settings-note">Sent ' + relativeTime(new Date(intro.created_at).getTime()) + " ago &mdash; awaiting reply.</p>" +
        '<button type="button" class="btn btn-outline btn-sm" data-action="withdraw" data-id="' + intro.id + '">Withdraw request</button>' +
        '<p class="login-error" data-error-for="' + intro.id + '" hidden></p>' +
        "</article>"
      );
    }).join("");
  }

  // ---- Sidebar "Active Requests" widget + popup — a compact, always-visible
  // way to see/act on pending incoming requests without scrolling to the
  // inline list below. Reuses the same incomingRequests data.

  function renderActiveIntroRequests() {
    var listEl = document.getElementById("active-intro-requests-list");
    if (!listEl) return;
    listEl.innerHTML = incomingRequests.length
      ? incomingRequests.map(function (intro) {
          var name = intro.requestor.org_name || intro.requestor.contact_name || "Member";
          return (
            '<button type="button" class="active-thread-item" data-action="open-intro-popup" data-id="' + intro.id + '">' +
            '<span class="active-thread-body">' +
            '<span class="active-thread-name">' + escapeHtml(name) + "</span>" +
            '<span class="active-thread-meta">Pending &mdash; ' + relativeTime(new Date(intro.created_at).getTime()) + " ago</span>" +
            "</span>" +
            "</button>"
          );
        }).join("")
      : '<p class="settings-note">No pending requests.</p>';
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

  function openIntroPopup(introId) {
    var intro = incomingRequests.find(function (r) { return r.id === introId; });
    if (!intro) return;
    var name = intro.requestor.org_name || intro.requestor.contact_name || "Member";

    document.getElementById("intro-popup-title").textContent = name;
    var headEl = document.getElementById("intro-popup-head");
    var avatarEl = document.getElementById("intro-popup-avatar");
    if (intro.requestor.category) headEl.setAttribute("data-cat", intro.requestor.category);
    else headEl.removeAttribute("data-cat");
    avatarEl.outerHTML = avatarHtml(name, intro.requestor.category, "thread-popup-avatar", intro.requestor.avatar_url).replace("<span", '<span id="intro-popup-avatar"');

    var bodyEl = document.getElementById("intro-popup-body");
    bodyEl.innerHTML =
      (intro.note ? '<p class="post-body">' + escapeHtml(intro.note) + "</p>" : '<p class="settings-note">No reason given.</p>') +
      '<div style="display:flex; gap:0.5rem; margin-top:1rem;">' +
      '<button type="button" class="btn btn-primary btn-sm" data-action="accept" data-id="' + intro.id + '">Accept</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-action="decline" data-id="' + intro.id + '">Decline</button>' +
      "</div>" +
      '<p class="login-error" data-error-for="' + intro.id + '" hidden></p>';
    document.getElementById("intro-popup-backdrop").classList.add("is-open");
  }

  function closeIntroPopup() {
    document.getElementById("intro-popup-backdrop").classList.remove("is-open");
  }

  // ---- "Active Intros" — real message threads created when an intro
  // request is accepted (see the accept_intro_request RPC), with their own
  // popup mirroring the Active Threads pattern already built for The
  // Exchange/The Co-Op. Always exactly 2 people, like Exchange threads. ----

  var TIME_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';

  function timeLeftLabel(lastMessageAt) {
    var expiresAt = new Date(lastMessageAt).getTime() + 14 * 24 * 60 * 60 * 1000;
    var msLeft = expiresAt - Date.now();
    if (msLeft <= 0) return "Expired";
    var daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    if (daysLeft >= 1) return daysLeft + "d left";
    return Math.max(1, Math.ceil(msLeft / (60 * 60 * 1000))) + "h left";
  }

  async function fetchMyIntroThreads() {
    var res = await sb.from("intro_requests")
      .select("id, chat_thread_id, requestor:requestor_id(id, org_name, contact_name, category, avatar_url), requestee:requestee_id(id, org_name, contact_name, category, avatar_url)")
      .or("requestor_id.eq." + profile.id + ",requestee_id.eq." + profile.id)
      .eq("status", "accepted")
      .not("chat_thread_id", "is", null);
    var intros = res.data || [];
    if (!intros.length) return [];

    var threadIds = intros.map(function (i) { return i.chat_thread_id; });
    var threadsRes = await sb.from("threads").select("id, status, last_message_at").in("id", threadIds).eq("status", "active");
    var threadById = {};
    (threadsRes.data || []).forEach(function (t) { threadById[t.id] = t; });

    var tpRes = await sb.from("thread_participants").select("thread_id, last_read_at").eq("profile_id", profile.id).in("thread_id", threadIds);
    var lastReadByThread = {};
    (tpRes.data || []).forEach(function (r) { lastReadByThread[r.thread_id] = r.last_read_at; });

    var threads = [];
    for (var i = 0; i < intros.length; i++) {
      var intro = intros[i];
      var t = threadById[intro.chat_thread_id];
      if (!t) continue;
      var other = intro.requestor.id === profile.id ? intro.requestee : intro.requestor;
      var unreadRes = await sb.from("messages").select("id", { count: "exact", head: true })
        .eq("thread_id", t.id).neq("sender_id", profile.id).gt("created_at", lastReadByThread[t.id] || "1970-01-01");
      threads.push({ id: t.id, other: other, lastMessageAt: t.last_message_at, unread: unreadRes.count || 0 });
    }
    threads.sort(function (a, b) { return new Date(b.lastMessageAt) - new Date(a.lastMessageAt); });
    return threads;
  }

  function activeIntroThreadItemHtml(t) {
    var other = t.other || {};
    var name = other.org_name || other.contact_name || "Member";
    return (
      '<button type="button" class="active-thread-item" data-action="open-thread-popup" data-id="' + t.id + '">' +
      smallAvatarHtml(name, other.category, "active-thread-avatar", other.avatar_url) +
      '<span class="active-thread-body">' +
      '<span class="active-thread-name">' + escapeHtml(name) + "</span>" +
      '<span class="active-thread-meta">' + TIME_ICON + timeLeftLabel(t.lastMessageAt) + "</span></span>" +
      (t.unread > 0 ? '<span class="active-thread-unread" aria-hidden="true" title="Unread messages"></span>' : "") +
      "</button>"
    );
  }

  async function renderActiveIntroThreads() {
    var listEl = document.getElementById("active-intro-threads-list");
    if (!listEl) return;
    var threads = await fetchMyIntroThreads();
    listEl.innerHTML = threads.length ? threads.map(activeIntroThreadItemHtml).join("") : '<p class="settings-note">No active intros yet.</p>';
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
      return '<div class="context-member-item">' + smallAvatarHtml(n, prof.category, "portal-avatar-sm", prof.avatar_url) +
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
    var title = others.length === 1 ? (owner.org_name || owner.contact_name || "Member") : "Group (" + participants.length + ")";
    document.getElementById("thread-popup-title").textContent = title;

    var headEl = document.getElementById("thread-popup-head");
    var avatarEl = document.getElementById("thread-popup-avatar");
    if (others.length === 1) {
      headEl.setAttribute("data-cat", owner.category || "");
      avatarEl.outerHTML = smallAvatarHtml(title, owner.category, "thread-popup-avatar", owner.avatar_url).replace("<span", '<span id="thread-popup-avatar"');
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
              ? smallAvatarHtml(senderName, sender.category, "chat-bubble-avatar portal-avatar-sm", sender.avatar_url)
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

  async function loadResolved() {
    var res = await sb
      .from("intro_requests")
      .select(
        "id, status, chat_thread_id, requestor_id, requestee_id, requestor_good_match, requestee_good_match, " +
        "requestor:requestor_id(org_name, contact_name), requestee:requestee_id(org_name, contact_name)"
      )
      .or("requestor_id.eq." + profile.id + ",requestee_id.eq." + profile.id)
      .neq("status", "pending")
      .order("resolved_at", { ascending: false });

    var container = document.getElementById("intros-resolved");
    if (res.error || !res.data.length) {
      container.innerHTML = '<p class="settings-note">No resolved requests yet.</p>';
      return;
    }

    container.innerHTML = res.data.map(function (intro) {
      var isRequestor = intro.requestor_id === profile.id;
      var other = isRequestor ? intro.requestee : intro.requestor;
      var otherName = other ? (other.org_name || other.contact_name) : "Member";
      var myFeedback = isRequestor ? intro.requestor_good_match : intro.requestee_good_match;
      return resolvedCardHtml(intro, isRequestor, otherName, myFeedback === undefined ? null : myFeedback);
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

    setupIntroMemberFilters();
    introMembers = await fetchIntroMembers();
    await fetchMyOutgoingIntros();
    renderIntroMembers();

    await loadIncoming();
    await loadOutgoing();
    await loadResolved();

    var membersGrid = document.getElementById("intro-members-grid");

    membersGrid.addEventListener("click", function (e) {
      var requestBtn = e.target.closest('[data-action="request-intro"]');
      if (requestBtn) {
        var id = requestBtn.dataset.id;
        var wrap = membersGrid.querySelector('[data-wrap-for="' + id + '"]');
        var form = membersGrid.querySelector('form.intro-request-form[data-id="' + id + '"]');
        if (wrap) wrap.hidden = true;
        if (form) {
          form.hidden = false;
          var textarea = form.querySelector("textarea");
          if (textarea) textarea.focus();
        }
        return;
      }

      var cancelBtn = e.target.closest('[data-action="cancel-intro-form"]');
      if (cancelBtn) {
        var cid = cancelBtn.dataset.id;
        var cwrap = membersGrid.querySelector('[data-wrap-for="' + cid + '"]');
        var cform = membersGrid.querySelector('form.intro-request-form[data-id="' + cid + '"]');
        if (cform) cform.hidden = true;
        if (cwrap) cwrap.hidden = false;
      }
    });

    membersGrid.addEventListener("submit", function (e) {
      var form = e.target.closest("form.intro-request-form");
      if (!form) return;
      e.preventDefault();

      var id = form.dataset.id;
      var textarea = form.querySelector("textarea");
      var note = textarea.value.trim();
      if (!note) return;

      var errorEl = form.querySelector('[data-error-for="' + id + '"]');
      errorEl.hidden = true;
      var submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      sb.from("intro_requests").insert({
        requestor_id: profile.id,
        requestee_id: id,
        note: note,
      }).then(function (res) {
        submitBtn.disabled = false;
        if (res.error) {
          errorEl.textContent = res.error.message;
          errorEl.hidden = false;
          return;
        }
        myOutgoingRequests[id] = "pending";
        renderIntroMembers();
        loadOutgoing();
      });
    });

    function resolveIntroRequest(introId, decision, errorEl) {
      // Accepting creates a real message thread (accept_intro_request RPC),
      // matching how Exchange/Co-Op turn an accepted match into a real
      // conversation. Both accept and decline go through narrow RPCs, not a
      // raw client update — intro_requests has no general UPDATE policy
      // (closes a real hole where either party could otherwise self-accept
      // their own request or overwrite the other party's feedback field).
      var op = decision === "accepted"
        ? sb.rpc("accept_intro_request", { p_intro_id: introId })
        : sb.rpc("decline_intro_request", { p_intro_id: introId });
      return op.then(function (res) {
        if (res.error) {
          if (errorEl) { errorEl.textContent = res.error.message; errorEl.hidden = false; }
          return;
        }
        closeIntroPopup();
        loadIncoming();
        loadResolved();
        renderActiveIntroThreads();
      });
    }

    document.getElementById("intros-incoming").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]");
      if (!btn) return;
      var introId = btn.dataset.id;
      var decision = btn.dataset.action === "accept" ? "accepted" : "declined";
      var errorEl = document.querySelector('[data-error-for="' + introId + '"]');
      resolveIntroRequest(introId, decision, errorEl);
    });

    document.getElementById("active-intro-requests-list").addEventListener("click", function (e) {
      var item = e.target.closest('[data-action="open-intro-popup"]');
      if (!item) return;
      openIntroPopup(item.dataset.id);
    });

    document.getElementById("intro-popup-body").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]");
      if (!btn) return;
      var introId = btn.dataset.id;
      var decision = btn.dataset.action === "accept" ? "accepted" : "declined";
      var errorEl = document.querySelector('#intro-popup-body [data-error-for="' + introId + '"]');
      resolveIntroRequest(introId, decision, errorEl);
    });

    document.getElementById("intro-popup-close").addEventListener("click", closeIntroPopup);
    document.getElementById("intro-popup-backdrop").addEventListener("click", function (e) {
      if (e.target.id === "intro-popup-backdrop") closeIntroPopup();
    });

    await renderActiveIntroThreads();

    document.getElementById("active-intro-threads-list").addEventListener("click", function (e) {
      var item = e.target.closest('[data-action="open-thread-popup"]');
      if (!item) return;
      openThreadPopup(item.dataset.id);
    });

    document.getElementById("thread-popup-close").addEventListener("click", closeThreadPopup);
    document.getElementById("thread-popup-backdrop").addEventListener("click", function (e) {
      if (e.target.id === "thread-popup-backdrop") closeThreadPopup();
    });

    document.getElementById("thread-popup-members-btn").addEventListener("click", function () {
      var list = document.getElementById("thread-popup-members-list");
      list.hidden = !list.hidden;
    });

    var threadPopupImageInput = document.getElementById("thread-popup-image-input");
    document.getElementById("thread-popup-attach-btn").addEventListener("click", function () {
      threadPopupImageInput.click();
    });

    document.getElementById("thread-popup-compose-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!activeThreadPopupId) return;
      var input = document.getElementById("thread-popup-input");
      var text = input.value.trim();
      var imageFile = threadPopupImageInput.files[0];
      if (!text && !imageFile) return;

      var submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      var imageUrl = await uploadThreadImage(imageFile);
      var res = await sb.from("messages").insert({ thread_id: activeThreadPopupId, sender_id: profile.id, body: text || "", image_url: imageUrl });
      submitBtn.disabled = false;
      if (res.error) {
        window.alert(res.error.message);
        return;
      }
      input.value = "";
      threadPopupImageInput.value = "";
      await loadThreadPopupMessages();
      renderActiveIntroThreads();
    });

    document.getElementById("intros-outgoing").addEventListener("click", function (e) {
      var btn = e.target.closest('[data-action="withdraw"]');
      if (!btn) return;
      var introId = btn.dataset.id;
      btn.disabled = true;
      sb.from("intro_requests").delete().eq("id", introId).eq("status", "pending").then(async function (res) {
        if (res.error) {
          var errEl = document.querySelector('#intros-outgoing [data-error-for="' + introId + '"]');
          if (errEl) { errEl.textContent = res.error.message; errEl.hidden = false; }
          btn.disabled = false;
          return;
        }
        await fetchMyOutgoingIntros();
        loadOutgoing();
        renderIntroMembers();
      });
    });

    document.getElementById("intros-resolved").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]");
      if (!btn) return;
      var introId = btn.dataset.id;

      if (btn.dataset.action === "open-thread") {
        openThreadPopup(btn.dataset.threadId);
        return;
      }

      if (btn.dataset.action === "reveal") {
        sb.rpc("get_accepted_intro_contact", { p_intro_id: introId }).maybeSingle().then(function (res) {
          var el = document.getElementById("contact-" + introId);
          if (!el) return;
          if (res.error || !res.data) {
            el.innerHTML = '<p class="settings-note">This member prefers to keep conversations in Attire messaging &mdash; use the Message button above.</p>';
            return;
          }
          el.innerHTML = '<p class="settings-note">' + escapeHtml(res.data.email || "") +
            (res.data.phone ? " &middot; " + escapeHtml(res.data.phone) : "") + "</p>";
        });
        return;
      }

      if (btn.dataset.action === "feedback-yes" || btn.dataset.action === "feedback-no") {
        var goodMatch = btn.dataset.action === "feedback-yes";
        sb.rpc("submit_intro_feedback", { p_intro_id: introId, p_good_match: goodMatch }).then(function () { loadResolved(); });
      }
    });
  });
})();
