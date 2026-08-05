(function () {
  "use strict";

  var sb = window.supabaseClient;
  var profile = null;
  var pools = [];
  var filterState = { sort: "newest" };

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

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ---- Active Co-Op Threads (sidebar) + shared messenger-style popup —
  // replaces surfacing these threads on the Messages page; each thread now
  // lives only under the page it belongs to. A Co-Op thread can have more
  // than 2 participants (everyone accepted into the pool), unlike Exchange
  // threads which are always exactly 2. ----

  function timeLeftLabel(lastMessageAt) {
    var expiresAt = new Date(lastMessageAt).getTime() + 14 * 24 * 60 * 60 * 1000;
    var msLeft = expiresAt - Date.now();
    if (msLeft <= 0) return "Expired";
    var daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    if (daysLeft >= 1) return daysLeft + "d left";
    return Math.max(1, Math.ceil(msLeft / (60 * 60 * 1000))) + "h left";
  }

  var TIME_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';

  async function fetchMyCoopThreads() {
    var orgSelect = "id, title, chat_thread_id, profiles(org_name, contact_name, category, avatar_url)";
    var myPoolsRes = await sb.from("pooling_threads").select(orgSelect).eq("organizer_id", profile.id).not("chat_thread_id", "is", null);
    var partRes = await sb.from("pooling_participants").select("pooling_thread_id").eq("profile_id", profile.id).eq("status", "accepted");
    var participantPoolIds = (partRes.data || []).map(function (r) { return r.pooling_thread_id; });
    var participantPoolsRes = participantPoolIds.length
      ? await sb.from("pooling_threads").select(orgSelect).in("id", participantPoolIds).not("chat_thread_id", "is", null)
      : { data: [] };

    var poolsById = {};
    (myPoolsRes.data || []).forEach(function (p) { poolsById[p.id] = p; });
    (participantPoolsRes.data || []).forEach(function (p) { poolsById[p.id] = p; });
    var poolList = Object.keys(poolsById).map(function (k) { return poolsById[k]; });
    if (!poolList.length) return [];

    var threadIds = poolList.map(function (p) { return p.chat_thread_id; });
    var threadsRes = await sb.from("threads").select("id, status, last_message_at").in("id", threadIds).eq("status", "active");
    if (threadsRes.error || !threadsRes.data.length) return [];
    var threadById = {};
    threadsRes.data.forEach(function (t) { threadById[t.id] = t; });

    var tpRes = await sb.from("thread_participants").select("thread_id, last_read_at")
      .eq("profile_id", profile.id).in("thread_id", threadsRes.data.map(function (t) { return t.id; }));
    var lastReadByThread = {};
    (tpRes.data || []).forEach(function (r) { lastReadByThread[r.thread_id] = r.last_read_at; });

    var threads = [];
    for (var i = 0; i < poolList.length; i++) {
      var pool = poolList[i];
      var t = threadById[pool.chat_thread_id];
      if (!t) continue;
      var unreadRes = await sb.from("messages").select("id", { count: "exact", head: true })
        .eq("thread_id", t.id).neq("sender_id", profile.id).gt("created_at", lastReadByThread[t.id] || "1970-01-01");
      threads.push({ id: t.id, title: pool.title, organizer: pool.profiles || {}, lastMessageAt: t.last_message_at, unread: unreadRes.count || 0 });
    }
    return threads;
  }

  function activeThreadItemHtml(t) {
    var organizer = t.organizer || {};
    var organizerName = organizer.org_name || organizer.contact_name || "Organizer";
    return (
      '<button type="button" class="active-thread-item" data-action="open-thread-popup" data-id="' + t.id + '" data-title="' + escapeHtml(t.title) + '" data-cat="' + (organizer.category || "") + '" data-avatar="' + escapeHtml(organizer.avatar_url || "") + '">' +
      avatarHtml(organizerName, organizer.category, "active-thread-avatar", organizer.avatar_url) +
      '<span class="active-thread-body">' +
      '<span class="active-thread-name">' + escapeHtml(t.title) + "</span>" +
      '<span class="active-thread-meta">' + TIME_ICON + timeLeftLabel(t.lastMessageAt) + "</span></span>" +
      (t.unread > 0 ? '<span class="active-thread-unread" aria-hidden="true" title="Unread messages"></span>' : "") +
      "</button>"
    );
  }

  async function renderActiveCoopThreads() {
    var listEl = document.getElementById("active-coop-threads-list");
    if (!listEl) return;
    var threads = await fetchMyCoopThreads();
    listEl.innerHTML = threads.length ? threads.map(activeThreadItemHtml).join("") : '<p class="settings-note">No active conversations.</p>';
  }

  var activeThreadPopupId = null;
  var threadPopupParticipants = {};

  async function openThreadPopup(threadId, titleOverride, organizerCategory, organizerAvatarUrl) {
    activeThreadPopupId = threadId;
    document.getElementById("thread-popup-backdrop").classList.add("is-open");
    document.getElementById("thread-popup-members-list").hidden = true;
    document.getElementById("thread-popup-title").textContent = titleOverride || "Conversation";

    sb.from("threads").select("status").eq("id", threadId).maybeSingle().then(function (statusRes) {
      var expired = statusRes.data && statusRes.data.status === "expired";
      document.getElementById("thread-popup-compose-form").hidden = expired;
      document.getElementById("thread-popup-expired-note").hidden = !expired;
    });

    var headEl = document.getElementById("thread-popup-head");
    var avatarEl = document.getElementById("thread-popup-avatar");
    if (organizerCategory || organizerAvatarUrl) headEl.setAttribute("data-cat", organizerCategory || "");
    else headEl.removeAttribute("data-cat");
    avatarEl.outerHTML = avatarHtml(titleOverride || "Co-Op", organizerCategory, "thread-popup-avatar", organizerAvatarUrl).replace("<span", '<span id="thread-popup-avatar"');

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
          var isFirstOfRun = i === 0 || msgs[i - 1].sender_id !== m.sender_id;
          return '<div class="chat-bubble-row from-' + (mine ? "me" : "them") + '">' +
            (mine ? "" : isFirstOfRun
              ? avatarHtml(senderName, sender.category, "chat-bubble-avatar portal-avatar-sm", sender.avatar_url)
              : '<span class="chat-bubble-avatar-spacer" aria-hidden="true"></span>') +
            '<div class="chat-bubble from-' + (mine ? "me" : "them") + '">' +
            (mine || !isFirstOfRun ? "" : '<span class="chat-bubble-sender">' + escapeHtml(senderName) + "</span>") +
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
    return Math.round(hr / 24) + "d";
  }

  function avatarHtml(name, category, extraClass, avatarUrl) {
    var cls = "portal-avatar" + (extraClass ? " " + extraClass : "");
    if (avatarUrl) return '<span class="' + cls + ' portal-avatar-img"><img src="' + avatarUrl + '" alt=""></span>';
    return '<span class="' + cls + '"' + (category ? ' data-cat="' + category + '"' : "") + ">" + escapeHtml(initials(name)) + "</span>";
  }

  function sharedPhotosHtml(urls) {
    if (!urls.length) return '<p class="settings-note">No photos shared yet.</p>';
    return '<div class="shared-photos-grid">' + urls.map(function (u) {
      return '<a href="' + escapeHtml(u) + '" target="_blank" rel="noopener" class="shared-photo-thumb"><img src="' + escapeHtml(u) + '" alt="" loading="lazy"></a>';
    }).join("") + "</div>";
  }

  function labelForPoolCategory(cat) {
    var map = {
      materials: "Materials Co-Op",
      service: "Service Co-Op",
      equipment: "Equipment/Tooling Co-Op",
      logistics: "Logistics/Shipping Co-Op",
      workspace: "Studio/Workspace Co-Op",
      compliance: "Certification/Compliance Co-Op",
    };
    return map[cat] || "Co-Op";
  }

  // Accepted-participant counts are fetched separately (rather than an
  // embedded pooling_participants(count)) because RLS visibility of pending
  // rows differs by viewer (the organizer sees their own pool's pending
  // requests too) — filtering status here client-side keeps "X of Y joined"
  // accurate no matter who's looking.
  async function fetchAcceptedCounts(poolIds) {
    if (!poolIds.length) return {};
    var res = await sb.from("pooling_participants").select("pooling_thread_id").eq("status", "accepted").in("pooling_thread_id", poolIds);
    if (res.error) return {};
    var counts = {};
    (res.data || []).forEach(function (r) { counts[r.pooling_thread_id] = (counts[r.pooling_thread_id] || 0) + 1; });
    return counts;
  }

  async function fetchPools() {
    var res = await sb
      .from("pooling_threads")
      .select("id, title, description, category, moq, unit_cost, production_run_details, service_type, cost_per_member_estimate, logistics_notes, target_group_size, participant_cap, closes_at, status, created_at, organizer_id, image_url, profiles(org_name, contact_name, category, avatar_url)")
      .order("created_at", { ascending: false });
    if (res.error) { console.error(res.error); return []; }
    var poolList = res.data;
    var counts = await fetchAcceptedCounts(poolList.map(function (p) { return p.id; }));
    poolList.forEach(function (p) { p.acceptedCount = counts[p.id] || 0; });
    return poolList;
  }

  function visiblePools() {
    var list = pools.slice();
    if (filterState.sort === "oldest") {
      list.sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
    } else {
      list.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    }
    return list;
  }

  function progressBarHtml(joined, target, cap) {
    var pct = target > 0 ? Math.min(100, Math.round((joined / target) * 100)) : 0;
    return (
      '<div class="pool-progress" role="progressbar" aria-valuenow="' + joined + '" aria-valuemin="0" aria-valuemax="' + target + '">' +
      '<div class="pool-progress-bar" style="width:' + pct + '%;"></div>' +
      "</div>" +
      '<p class="settings-note" style="margin-top:0.3rem;">' + joined + " of " + target + " joined" +
      (cap ? " (cap " + cap + ")" : "") + "</p>"
    );
  }

  function poolCardHtml(pool) {
    var joined = pool.acceptedCount || 0;
    var organizer = pool.profiles || {};
    var name = organizer.org_name || organizer.contact_name || "Member";

    var fullDetails = pool.category === "materials"
      ? [pool.moq ? "MOQ: " + escapeHtml(pool.moq) : null, pool.unit_cost ? "Unit cost: " + escapeHtml(pool.unit_cost) : null, pool.production_run_details ? "Production: " + escapeHtml(pool.production_run_details) : null]
      : [pool.service_type ? "Service: " + escapeHtml(pool.service_type) : null, pool.cost_per_member_estimate ? "Est. cost: " + escapeHtml(pool.cost_per_member_estimate) : null];
    if (pool.closes_at) fullDetails.push("Closes: " + new Date(pool.closes_at).toLocaleString());
    if (pool.logistics_notes) fullDetails.push("Logistics: " + escapeHtml(pool.logistics_notes));
    fullDetails = fullDetails.filter(Boolean);

    return (
      '<article class="post-card is-coop" data-id="' + pool.id + '">' +
      '<div class="post-type-flag-slot"><span class="post-type-flag post-type-flag--coop">The Co-Op</span></div>' +
      '<div class="post-head">' +
      avatarHtml(name, organizer.category, null, organizer.avatar_url) +
      "<div>" +
      '<p class="post-author-name">' + escapeHtml(name) + "</p>" +
      '<div class="post-meta-row"><span>' + relativeTime(new Date(pool.created_at).getTime()) + " ago</span></div>" +
      "</div></div>" +
      (pool.image_url ? '<img class="post-attachment-img" src="' + escapeHtml(pool.image_url) + '" alt="" loading="lazy">' : "") +
      '<p class="post-author-name" style="margin-top:0.6rem;">' + escapeHtml(pool.title) + "</p>" +
      '<p class="settings-note post-body--clamped">' + escapeHtml(pool.description || "") + "</p>" +
      '<p class="settings-note">' + labelForPoolCategory(pool.category) + " &mdash; " + pool.status + "</p>" +
      progressBarHtml(joined, pool.target_group_size, pool.participant_cap) +
      '<div class="post-expand-details" hidden>' +
      (fullDetails.length ? '<ul class="post-detail-list">' + fullDetails.map(function (d) { return "<li>" + d + "</li>"; }).join("") + "</ul>" : "") +
      "</div>" +
      '<div class="post-actions">' +
      '<button type="button" class="btn btn-outline btn-sm" data-action="toggle-expand">See full details</button>' +
      '<a href="pooling.html?id=' + encodeURIComponent(pool.id) + '" class="btn btn-primary btn-sm">' + (pool.status === "open" ? "View &amp; Join" : "View") + "</a>" +
      "</div>" +
      "</article>"
    );
  }

  function renderPoolList() {
    var listEl = document.getElementById("pooling-list");
    var visible = visiblePools();
    listEl.innerHTML = visible.length
      ? visible.map(poolCardHtml).join("")
      : '<p class="settings-note">No Co-Ops match those filters.</p>';

    var countEl = document.getElementById("pooling-result-count");
    if (countEl) countEl.textContent = visible.length + (visible.length === 1 ? " Co-Op" : " Co-Ops");
  }

  var trendingPoolId = null;

  async function fetchTrending() {
    var res = await sb.from("trending_posts").select("post_id").eq("scope", "coop").maybeSingle();
    trendingPoolId = res.error || !res.data ? null : res.data.post_id;
  }

  function recentPoolHtml(p, isTrending) {
    var organizer = p.profiles || {};
    var name = organizer.org_name || organizer.contact_name || "Member";
    return '<a class="app-context-recent-item' + (isTrending ? ' app-context-recent-item--trending' : '') + '" href="pooling.html?id=' + encodeURIComponent(p.id) + '">' +
      (isTrending ? '<span class="trending-flame" aria-hidden="true">🔥</span>' : '') +
      escapeHtml(p.title) + "<span>Organized by " + escapeHtml(name) + "</span></a>";
  }

  function renderRecent() {
    var recentEl = document.getElementById("pooling-recent-list");
    if (!recentEl) return;
    var trendingPool = trendingPoolId ? pools.find(function (p) { return p.id === trendingPoolId; }) : null;
    var rest = pools.filter(function (p) { return !trendingPool || p.id !== trendingPool.id; }).slice(0, 8);

    var html = (trendingPool ? recentPoolHtml(trendingPool, true) : "") + rest.map(function (p) { return recentPoolHtml(p, false); }).join("");
    recentEl.innerHTML = html || '<p class="settings-note">No Co-Ops yet.</p>';
  }

  function setupCreateForm() {
    var categorySelect = document.getElementById("pool-category");
    var materialsFields = ["pool-field-moq", "pool-field-unit-cost", "pool-field-production"];
    var serviceFields = ["pool-field-service-type", "pool-field-cost-estimate"];

    function toggleFields() {
      var isMaterials = categorySelect.value === "materials";
      materialsFields.forEach(function (id) { document.getElementById(id).hidden = !isMaterials; });
      serviceFields.forEach(function (id) { document.getElementById(id).hidden = isMaterials; });
    }
    categorySelect.addEventListener("change", toggleFields);
    toggleFields();

    var form = document.getElementById("pool-create-form");
    var errorEl = document.getElementById("pool-create-error");
    setupImageAttach("pool-attach-btn", "pool-image-input", "pool-attach-name", "pool-attach-preview");

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      errorEl.hidden = true;

      var closesAt = document.getElementById("pool-closes").value;
      var cap = document.getElementById("pool-cap").value;
      var imageFile = document.getElementById("pool-image-input").files[0];
      var imageUrl = await uploadPostImage(imageFile, profile.id);

      var payload = {
        organizer_id: profile.id,
        category: categorySelect.value,
        title: document.getElementById("pool-title").value.trim(),
        description: document.getElementById("pool-description").value.trim(),
        target_group_size: Number(document.getElementById("pool-target").value),
        participant_cap: cap ? Number(cap) : null,
        closes_at: closesAt || null,
        image_url: imageUrl,
      };
      if (categorySelect.value === "materials") {
        payload.moq = document.getElementById("pool-moq").value.trim() || null;
        payload.unit_cost = document.getElementById("pool-unit-cost").value.trim() || null;
        payload.production_run_details = document.getElementById("pool-production").value.trim() || null;
      } else {
        payload.service_type = document.getElementById("pool-service-type").value.trim() || null;
        payload.cost_per_member_estimate = document.getElementById("pool-cost-estimate").value.trim() || null;
      }

      var submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      sb.from("pooling_threads").insert(payload).select("id").single().then(function (res) {
        submitBtn.disabled = false;
        if (res.error) {
          errorEl.textContent = res.error.message;
          errorEl.hidden = false;
          return;
        }
        window.location.href = "pooling.html?id=" + encodeURIComponent(res.data.id);
      });
    });
  }

  function manageParticipantsHtml(pending, accepted, cap) {
    var capReached = !!cap && accepted.length >= cap;
    return (
      '<div class="form-card" style="margin-top:1rem;" id="manage-participants-panel">' +
      '<div class="profile-card-head"><h3>Manage participants</h3></div>' +
      (capReached ? '<p class="settings-note">Participant cap of ' + cap + ' reached &mdash; accept a new request by removing someone first.</p>' : "") +

      '<p class="settings-note" style="font-weight:700;">Pending requests (' + pending.length + ")</p>" +
      (pending.length
        ? pending.map(function (p) {
            var name = p.profiles ? (p.profiles.org_name || p.profiles.contact_name || "Member") : "Member";
            return (
              '<div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; padding:0.5rem 0; border-bottom:1px solid var(--color-border);">' +
              '<span class="settings-note" style="margin:0;">' + escapeHtml(name) + "</span>" +
              '<span style="display:flex; gap:0.4rem;">' +
              '<button type="button" class="btn btn-primary btn-sm" data-action="accept-participant" data-id="' + p.profile_id + '"' + (capReached ? " disabled" : "") + '>Accept</button>' +
              '<button type="button" class="btn btn-outline btn-sm" data-action="decline-participant" data-id="' + p.profile_id + '">Decline</button>' +
              "</span></div>"
            );
          }).join("")
        : '<p class="settings-note">None right now.</p>') +

      '<p class="settings-note" style="font-weight:700; margin-top:1rem;">Accepted participants (' + accepted.length + ")</p>" +
      (accepted.length
        ? accepted.map(function (p) {
            var name = p.profiles ? (p.profiles.org_name || p.profiles.contact_name || "Member") : "Member";
            return (
              '<div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; padding:0.5rem 0; border-bottom:1px solid var(--color-border);">' +
              '<span class="settings-note" style="margin:0;">' + escapeHtml(name) + "</span>" +
              '<button type="button" class="btn btn-outline btn-sm" data-action="remove-participant" data-id="' + p.profile_id + '">Remove</button>' +
              "</div>"
            );
          }).join("")
        : '<p class="settings-note">No one has been accepted yet.</p>') +

      '<p class="settings-note" style="font-weight:700; margin-top:1rem;">Add a member</p>' +
      '<div style="display:flex; gap:0.5rem;">' +
      '<input type="text" id="add-participant-search" placeholder="Search by name or organization&hellip;" style="flex:1; padding:0.6rem 0.8rem; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-cream);">' +
      '<button type="button" class="btn btn-outline btn-sm" id="add-participant-search-btn">Search</button>' +
      "</div>" +
      '<div id="add-participant-results" style="margin-top:0.5rem;"></div>' +
      '<p class="login-error" id="manage-participants-error" hidden></p>' +
      "</div>"
    );
  }

  function addParticipantResultHtml(m) {
    var name = m.org_name || m.contact_name || "Member";
    return (
      '<div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; padding:0.4rem 0;">' +
      '<span class="settings-note" style="margin:0;">' + escapeHtml(name) + "</span>" +
      '<button type="button" class="btn btn-primary btn-sm" data-action="add-participant" data-id="' + m.id + '">Add</button>' +
      "</div>"
    );
  }

  async function loadDetail(poolId) {
    document.getElementById("pooling-list-view").hidden = true;
    document.getElementById("pooling-detail-view").hidden = false;
    var contentEl = document.getElementById("pooling-detail-content");

    var poolRes = await sb
      .from("pooling_threads")
      .select("id, title, description, category, moq, unit_cost, production_run_details, service_type, cost_per_member_estimate, target_group_size, participant_cap, closes_at, status, organizer_id, chat_thread_id, image_url")
      .eq("id", poolId)
      .single();

    if (poolRes.error || !poolRes.data) {
      contentEl.innerHTML = '<p class="settings-note">This Co-Op doesn\'t exist, or you don\'t have access to it.</p>';
      return;
    }
    var pool = poolRes.data;

    var partRes = await sb
      .from("pooling_participants")
      .select("profile_id, status, profiles(org_name, contact_name)")
      .eq("pooling_thread_id", poolId);
    var participants = partRes.data || [];
    var acceptedParticipants = participants.filter(function (p) { return p.status === "accepted"; });
    var pendingParticipants = participants.filter(function (p) { return p.status === "pending"; });
    var myRow = participants.find(function (p) { return p.profile_id === profile.id; });
    var isOrganizer = pool.organizer_id === profile.id;

    var detailsLine = pool.category === "materials"
      ? [pool.moq && "MOQ: " + pool.moq, pool.unit_cost && "Unit cost: " + pool.unit_cost, pool.production_run_details].filter(Boolean).join(" &middot; ")
      : [pool.service_type && "Service: " + pool.service_type, pool.cost_per_member_estimate && "Est. cost: " + pool.cost_per_member_estimate].filter(Boolean).join(" &middot; ");

    var html =
      '<h1 class="section-title" style="font-size:1.6rem;">' + escapeHtml(pool.title) + "</h1>" +
      '<p class="settings-note">' + labelForPoolCategory(pool.category) + "</p>" +
      (pool.image_url ? '<img class="post-attachment-img" style="margin:0.75rem 0;" src="' + escapeHtml(pool.image_url) + '" alt="" loading="lazy">' : "") +
      '<p class="section-lede">' + escapeHtml(pool.description) + "</p>" +
      '<div class="form-card">' +
      (detailsLine ? '<p class="settings-note">' + detailsLine + "</p>" : "") +
      (pool.logistics_notes ? '<p class="settings-note">Logistics: ' + escapeHtml(pool.logistics_notes) + "</p>" : "") +
      '<div style="margin-top:0.75rem;">' + progressBarHtml(acceptedParticipants.length, pool.target_group_size, pool.participant_cap) + "</div>" +
      (pool.closes_at ? '<p class="settings-note">Closes ' + new Date(pool.closes_at).toLocaleString() + "</p>" : "") +
      '<p class="settings-note">Status: ' + pool.status + "</p>" +
      "<ul style=\"margin-top:0.5rem;\">" +
      acceptedParticipants.map(function (p) {
        var name = p.profiles ? (p.profiles.org_name || p.profiles.contact_name || "Member") : "Member";
        return '<li class="settings-note">' + escapeHtml(name) + "</li>";
      }).join("") +
      "</ul>";

    var iAmAccepted = !!(myRow && myRow.status === "accepted");

    if (pool.status === "open" && !isOrganizer) {
      if (!myRow) {
        html += '<button type="button" class="btn btn-primary btn-sm" id="pool-join-btn">Request to Join</button>' +
          '<p class="login-error" id="pool-join-error" hidden></p>';
      } else if (myRow.status === "pending") {
        html += '<p class="settings-note">Request sent &mdash; waiting on the organizer to accept.</p>' +
          '<button type="button" class="btn btn-outline btn-sm" id="pool-cancel-request-btn">Cancel request</button>' +
          '<p class="login-error" id="pool-cancel-request-error" hidden></p>';
      } else {
        html += '<p class="settings-note">You&rsquo;re in this Co-Op.</p>' +
          '<button type="button" class="btn btn-outline btn-sm" id="pool-leave-btn">Leave Co-Op</button>' +
          '<p class="login-error" id="pool-leave-error" hidden></p>';
      }
    }
    if (pool.status === "open" && isOrganizer) {
      html += '<div style="margin-top:0.5rem;"><button type="button" class="btn btn-outline btn-sm" id="pool-close-btn">Close Co-Op now</button>' +
        '<p class="login-error" id="pool-close-error" hidden></p></div>';
    }
    if (pool.status === "closed" && (isOrganizer || iAmAccepted)) {
      html += '<a href="thread.html?id=' + encodeURIComponent(pool.chat_thread_id) + '" class="btn btn-primary btn-sm" style="margin-top:0.75rem;">Go to group chat</a>';
    } else if (pool.status === "closed" && myRow && myRow.status === "pending") {
      html += '<p class="settings-note">This Co-Op closed before the organizer got to your request &mdash; you weren&rsquo;t included in the group.</p>';
    }
    if (pool.status === "closed" && isOrganizer) {
      html += '<div class="form-field" style="margin-top:0.75rem;">' +
        '<label for="pool-logistics-input">Logistics notes <span class="hint">(pickup/shipping details for the group)</span></label>' +
        '<textarea id="pool-logistics-input">' + escapeHtml(pool.logistics_notes || "") + "</textarea>" +
        '<button type="button" class="btn btn-outline btn-sm" id="pool-logistics-save-btn" style="margin-top:0.4rem;">Save logistics notes</button>' +
        '<p class="login-error" id="pool-logistics-error" hidden></p>' +
        "</div>";
    }
    if (pool.status === "cancelled") {
      html += '<p class="settings-note">This Co-Op didn&rsquo;t reach its minimum of ' + pool.target_group_size + ' participants and was cancelled.</p>';
    }
    if (isOrganizer) {
      html += '<div style="margin-top:0.75rem;"><button type="button" class="btn btn-outline btn-sm" id="pool-delete-btn">Delete Co-Op</button>' +
        '<p class="login-error" id="pool-delete-error" hidden></p></div>';
    }
    html += "</div>";

    if (pool.status === "open" && isOrganizer) {
      html += manageParticipantsHtml(pendingParticipants, acceptedParticipants, pool.participant_cap);
    }

    contentEl.innerHTML = html;

    var logisticsSaveBtn = document.getElementById("pool-logistics-save-btn");
    if (logisticsSaveBtn) {
      logisticsSaveBtn.addEventListener("click", function () {
        logisticsSaveBtn.disabled = true;
        var notes = document.getElementById("pool-logistics-input").value.trim();
        sb.rpc("update_pooling_logistics_notes", { p_pooling_thread_id: poolId, p_notes: notes || null }).then(function (res) {
          logisticsSaveBtn.disabled = false;
          if (res.error) {
            var errEl = document.getElementById("pool-logistics-error");
            errEl.textContent = res.error.message;
            errEl.hidden = false;
            return;
          }
          pool.logistics_notes = notes || null;
        });
      });
    }

    var joinBtn = document.getElementById("pool-join-btn");
    if (joinBtn) {
      joinBtn.addEventListener("click", function () {
        joinBtn.disabled = true;
        sb.from("pooling_participants").insert({ pooling_thread_id: poolId, profile_id: profile.id }).then(function (res) {
          if (res.error) {
            var errEl = document.getElementById("pool-join-error");
            errEl.textContent = res.error.message;
            errEl.hidden = false;
            joinBtn.disabled = false;
            return;
          }
          loadDetail(poolId);
        });
      });
    }

    var cancelRequestBtn = document.getElementById("pool-cancel-request-btn");
    if (cancelRequestBtn) {
      cancelRequestBtn.addEventListener("click", function () {
        cancelRequestBtn.disabled = true;
        sb.from("pooling_participants").delete().eq("pooling_thread_id", poolId).eq("profile_id", profile.id).then(function (res) {
          if (res.error) {
            var errEl = document.getElementById("pool-cancel-request-error");
            errEl.textContent = res.error.message;
            errEl.hidden = false;
            cancelRequestBtn.disabled = false;
            return;
          }
          loadDetail(poolId);
        });
      });
    }

    var closeBtn = document.getElementById("pool-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        if (acceptedParticipants.length < pool.target_group_size) {
          var short = pool.target_group_size - acceptedParticipants.length;
          if (!window.confirm("Only " + acceptedParticipants.length + " of " + pool.target_group_size + " minimum participants accepted (" + short + " short). Closing now will cancel this Co-Op instead of finalizing it. Continue?")) return;
        }
        closeBtn.disabled = true;
        sb.rpc("close_pooling_thread", { p_pooling_thread_id: poolId }).then(function (res) {
          if (res.error) {
            var errEl = document.getElementById("pool-close-error");
            errEl.textContent = res.error.message;
            errEl.hidden = false;
            closeBtn.disabled = false;
            return;
          }
          loadDetail(poolId);
        });
      });
    }

    var leaveBtn = document.getElementById("pool-leave-btn");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", function () {
        if (!window.confirm("Leave this Co-Op? You'll need to request to join again if you change your mind.")) return;
        leaveBtn.disabled = true;
        sb.from("pooling_participants").delete().eq("pooling_thread_id", poolId).eq("profile_id", profile.id).then(function (res) {
          if (res.error) {
            var errEl = document.getElementById("pool-leave-error");
            errEl.textContent = res.error.message;
            errEl.hidden = false;
            leaveBtn.disabled = false;
            return;
          }
          loadDetail(poolId);
        });
      });
    }

    var deleteBtn = document.getElementById("pool-delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", function () {
        if (!window.confirm("Delete this Co-Op? Any group chat it already started will be kept, but the Co-Op listing itself can't be recovered.")) return;
        deleteBtn.disabled = true;
        sb.from("pooling_threads").delete().eq("id", poolId).then(function (res) {
          if (res.error) {
            var errEl = document.getElementById("pool-delete-error");
            errEl.textContent = res.error.message;
            errEl.hidden = false;
            deleteBtn.disabled = false;
            return;
          }
          window.location.href = "pooling.html";
        });
      });
    }

    var managePanel = document.getElementById("manage-participants-panel");
    if (!managePanel) return;

    function showManageError(message) {
      var errEl = document.getElementById("manage-participants-error");
      errEl.textContent = message;
      errEl.hidden = false;
    }

    managePanel.addEventListener("click", function (e) {
      var acceptBtn = e.target.closest('[data-action="accept-participant"]');
      if (acceptBtn) {
        acceptBtn.disabled = true;
        sb.from("pooling_participants").update({ status: "accepted" }).eq("pooling_thread_id", poolId).eq("profile_id", acceptBtn.dataset.id).then(function (res) {
          if (res.error) { showManageError(res.error.message); acceptBtn.disabled = false; return; }
          loadDetail(poolId);
        });
        return;
      }

      var declineBtn = e.target.closest('[data-action="decline-participant"]');
      if (declineBtn) {
        declineBtn.disabled = true;
        sb.from("pooling_participants").delete().eq("pooling_thread_id", poolId).eq("profile_id", declineBtn.dataset.id).then(function (res) {
          if (res.error) { showManageError(res.error.message); declineBtn.disabled = false; return; }
          loadDetail(poolId);
        });
        return;
      }

      var removeBtn = e.target.closest('[data-action="remove-participant"]');
      if (removeBtn) {
        removeBtn.disabled = true;
        sb.from("pooling_participants").delete().eq("pooling_thread_id", poolId).eq("profile_id", removeBtn.dataset.id).then(function (res) {
          if (res.error) { showManageError(res.error.message); removeBtn.disabled = false; return; }
          loadDetail(poolId);
        });
        return;
      }

      var addBtn = e.target.closest('[data-action="add-participant"]');
      if (addBtn) {
        addBtn.disabled = true;
        sb.from("pooling_participants").insert({ pooling_thread_id: poolId, profile_id: addBtn.dataset.id }).then(function (res) {
          if (res.error) { showManageError(res.error.message); addBtn.disabled = false; return; }
          loadDetail(poolId);
        });
      }
    });

    var existingIds = participants.map(function (p) { return p.profile_id; }).concat([profile.id]);

    function runParticipantSearch() {
      var query = document.getElementById("add-participant-search").value.trim();
      var resultsEl = document.getElementById("add-participant-results");
      if (!query) { resultsEl.innerHTML = ""; return; }

      sb.from("profiles")
        .select("id, org_name, contact_name")
        .neq("tier", "free")
        .not("id", "in", "(" + existingIds.join(",") + ")")
        .or("org_name.ilike.%" + query + "%,contact_name.ilike.%" + query + "%")
        .limit(5)
        .then(function (res) {
          if (res.error || !res.data.length) {
            resultsEl.innerHTML = '<p class="settings-note">No matching members found.</p>';
            return;
          }
          resultsEl.innerHTML = res.data.map(addParticipantResultHtml).join("");
        });
    }

    document.getElementById("add-participant-search-btn").addEventListener("click", runParticipantSearch);
    document.getElementById("add-participant-search").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); runParticipantSearch(); }
    });
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

    if (profile.tier === "free") {
      var listView = document.getElementById("pooling-list-view");
      listView.className = "app-content app-content--scroll";
      listView.innerHTML =
        '<div class="checkout-wrap" style="text-align:center;">' +
        '<h1 class="section-title">The Co-Op</h1>' +
        '<p class="section-lede">The Co-Op is a paid-member feature. Upgrade to Individual/Affiliate or Organization to join or start a Co-Op.</p>' +
        '<a href="upgrade.html" class="btn btn-primary btn-lg">Upgrade Plan</a></div>';
      return;
    }

    var poolId = new URLSearchParams(window.location.search).get("id");
    if (poolId) {
      loadDetail(poolId);
      return;
    }

    setupCreateForm();
    pools = await fetchPools();
    await fetchTrending();
    renderPoolList();
    renderRecent();
    renderActiveCoopThreads();

    document.getElementById("pooling-sort-select").addEventListener("change", function (e) {
      filterState.sort = e.target.value;
      renderPoolList();
    });

    document.getElementById("active-coop-threads-list").addEventListener("click", function (e) {
      var item = e.target.closest('[data-action="open-thread-popup"]');
      if (!item) return;
      openThreadPopup(item.dataset.id, item.dataset.title, item.dataset.cat, item.dataset.avatar);
    });

    document.getElementById("thread-popup-close").addEventListener("click", function () {
      closeThreadPopup();
      renderActiveCoopThreads();
    });
    document.getElementById("thread-popup-backdrop").addEventListener("click", function (e) {
      if (e.target.id === "thread-popup-backdrop") { closeThreadPopup(); renderActiveCoopThreads(); }
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

    document.getElementById("pooling-list").addEventListener("click", function (e) {
      var toggleBtn = e.target.closest('[data-action="toggle-expand"]');
      if (!toggleBtn) return;
      var card = toggleBtn.closest(".post-card");
      var expanded = card.classList.toggle("is-expanded");
      var descEl = card.querySelector(".post-body--clamped");
      if (descEl) descEl.classList.toggle("post-body--clamped", !expanded);
      card.querySelector(".post-expand-details").hidden = !expanded;
      toggleBtn.textContent = expanded ? "Show less" : "See full details";
    });

  });
})();
