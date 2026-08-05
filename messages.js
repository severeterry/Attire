(function () {
  "use strict";

  // Real 1:1 direct-message threads — Supabase-backed (threads/messages/
  // thread_participants), same tables Exchange/Co-Op/thread.html use. A
  // plain DM thread is just a threads row with no rfp_post_id and no
  // pooling_threads row pointing at it as a chat_thread_id.
  var profile = null;
  var activeThreadId = null;
  var dmThreads = [];

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

  // Exchange/Co-Op/Intro threads no longer surface here — each now has its
  // own popup on its own page (see portal.js/pooling.js/intros.js), listed
  // under that page's own "Active" sidebar widget instead of duplicated here.

  var sb = window.supabaseClient;

  // Fetches every plain DM thread the caller is in — no rfp_post_id, and
  // not referenced by any pooling_threads.chat_thread_id or
  // intro_requests.chat_thread_id (those live only on their own pages now,
  // see portal.js/pooling.js/intros.js's Active-thread widgets).
  async function fetchDmThreads() {
    var tpRes = await sb.from("thread_participants").select("thread_id, last_read_at").eq("profile_id", profile.id);
    if (tpRes.error || !tpRes.data.length) return [];
    var lastReadByThread = {};
    tpRes.data.forEach(function (r) { lastReadByThread[r.thread_id] = r.last_read_at; });
    var threadIds = tpRes.data.map(function (r) { return r.thread_id; });

    var threadsRes = await sb.from("threads").select("id, status, last_message_at")
      .in("id", threadIds).is("rfp_post_id", null).order("last_message_at", { ascending: false });
    if (threadsRes.error || !threadsRes.data.length) return [];

    var allIds = threadsRes.data.map(function (t) { return t.id; });
    var poolRes = await sb.from("pooling_threads").select("chat_thread_id").in("chat_thread_id", allIds);
    var introRes = await sb.from("intro_requests").select("chat_thread_id").in("chat_thread_id", allIds);
    var excludedThreadIds = new Set(
      (poolRes.data || []).map(function (p) { return p.chat_thread_id; })
        .concat((introRes.data || []).map(function (i) { return i.chat_thread_id; }))
    );
    var plainThreads = threadsRes.data.filter(function (t) { return !excludedThreadIds.has(t.id); });
    if (!plainThreads.length) return [];

    var otherRes = await sb.from("thread_participants").select("thread_id, profiles(id, org_name, contact_name, category, avatar_url)")
      .in("thread_id", plainThreads.map(function (t) { return t.id; })).neq("profile_id", profile.id);
    var otherByThread = {};
    (otherRes.data || []).forEach(function (r) { otherByThread[r.thread_id] = r.profiles; });

    var lastMsgRes = await sb.from("messages").select("thread_id, body, image_url, created_at")
      .in("thread_id", plainThreads.map(function (t) { return t.id; })).order("created_at", { ascending: false });
    var lastMsgByThread = {};
    (lastMsgRes.data || []).forEach(function (m) { if (!lastMsgByThread[m.thread_id]) lastMsgByThread[m.thread_id] = m; });

    var threads = [];
    for (var i = 0; i < plainThreads.length; i++) {
      var t = plainThreads[i];
      var unreadRes = await sb.from("messages").select("id", { count: "exact", head: true })
        .eq("thread_id", t.id).neq("sender_id", profile.id).gt("created_at", lastReadByThread[t.id] || "1970-01-01");
      var lastMsg = lastMsgByThread[t.id];
      threads.push({
        id: t.id, status: t.status, other: otherByThread[t.id] || null,
        preview: lastMsg ? (lastMsg.body || (lastMsg.image_url ? "Sent a photo" : "")) : "",
        unread: unreadRes.count || 0,
      });
    }
    return threads;
  }

  function renderThreadList() {
    var listEl = document.getElementById("chat-thread-list");
    if (!listEl) return;
    listEl.innerHTML = dmThreads.length
      ? dmThreads.map(function (t) {
          var other = t.other || {};
          var name = other.org_name || other.contact_name || "Member";
          return (
            '<button type="button" class="app-list-item' + (t.id === activeThreadId ? " is-active" : "") + '" data-id="' + t.id + '">' +
            avatarHtml(name, other.category, null, other.avatar_url) +
            '<span class="app-list-item-body"><span class="app-list-item-name">' + escapeHtml(name) + "</span>" +
            '<span class="app-list-item-preview">' + escapeHtml(t.preview || "") + "</span></span>" +
            (t.unread > 0 ? '<span class="app-list-item-unread" aria-hidden="true"></span>' : "") +
            "</button>"
          );
        }).join("")
      : '<p class="settings-note" style="padding:0 var(--space-3);">No conversations yet — start one with the + button above.</p>';
  }

  async function renderChatView() {
    var emptyState = document.getElementById("messages-empty-state");
    var viewChat = document.getElementById("view-chat");
    var thread = dmThreads.find(function (t) { return t.id === activeThreadId; });

    if (!thread) {
      emptyState.hidden = false;
      viewChat.hidden = true;
      renderContextFeed();
      return;
    }
    emptyState.hidden = true;
    viewChat.hidden = false;
    var other = thread.other || {};
    var name = other.org_name || other.contact_name || "Member";
    document.getElementById("chat-view-name").textContent = name;
    var avatarEl = document.getElementById("chat-view-avatar");
    if (other.avatar_url) {
      avatarEl.innerHTML = '<img src="' + escapeHtml(other.avatar_url) + '" alt="">';
      avatarEl.classList.add("portal-avatar-img");
    } else {
      avatarEl.classList.remove("portal-avatar-img");
      avatarEl.textContent = initials(name);
    }
    if (other.category) avatarEl.setAttribute("data-cat", other.category);
    else avatarEl.removeAttribute("data-cat");

    var messagesEl = document.getElementById("chat-messages");
    var msgRes = await sb.from("messages").select("id, sender_id, body, image_url, created_at").eq("thread_id", activeThreadId).order("created_at", { ascending: true });
    var msgs = msgRes.data || [];
    messagesEl.innerHTML = msgs.length
      ? msgs.map(function (m, i) {
          var mine = m.sender_id === profile.id;
          var isLastOfRun = i === msgs.length - 1 || msgs[i + 1].sender_id !== m.sender_id;
          return '<div class="chat-bubble-row from-' + (mine ? "me" : "them") + '">' +
            (mine ? "" : isLastOfRun
              ? avatarHtml(name, other.category, "chat-bubble-avatar portal-avatar-sm", other.avatar_url)
              : '<span class="chat-bubble-avatar-spacer" aria-hidden="true"></span>') +
            '<div class="chat-bubble from-' + (mine ? "me" : "them") + '">' +
            (m.image_url ? '<img class="chat-bubble-img" src="' + escapeHtml(m.image_url) + '" alt="">' : "") +
            (m.body ? escapeHtml(m.body) : "") + "</div></div>";
        }).join("")
      : '<p class="settings-note">No messages yet.</p>';
    messagesEl.scrollTop = messagesEl.scrollHeight;

    sb.from("thread_participants").update({ last_read_at: new Date().toISOString() })
      .eq("thread_id", activeThreadId).eq("profile_id", profile.id).then(function () {});

    renderContextChat({ id: other.id, name: name, category: other.category });
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

  async function uploadChatImage(file) {
    if (!file) return null;
    var ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    var path = profile.id + "/" + Date.now() + "-" + Math.random().toString(36).slice(2) + "." + ext;
    var res = await sb.storage.from("post-attachments").upload(path, file);
    if (res.error) return null;
    return sb.storage.from("post-attachments").getPublicUrl(path).data.publicUrl;
  }

  async function reloadThreads() {
    dmThreads = await fetchDmThreads();
  }

  function openNewMessageModal() {
    document.getElementById("new-message-backdrop").classList.add("is-open");
    document.getElementById("new-message-search").value = "";
    document.getElementById("new-message-results").innerHTML = "";
    document.getElementById("new-message-form").hidden = true;
    document.getElementById("new-message-search").hidden = false;
    document.getElementById("new-message-search").focus();
  }

  function closeNewMessageModal() {
    document.getElementById("new-message-backdrop").classList.remove("is-open");
  }

  async function searchMembers(query) {
    var resultsEl = document.getElementById("new-message-results");
    if (!query || query.trim().length < 2) {
      resultsEl.innerHTML = "";
      return;
    }
    var safeQuery = query.replace(/[,()%]/g, "").trim();
    if (!safeQuery) {
      resultsEl.innerHTML = "";
      return;
    }
    var res = await sb.from("profiles").select("id, org_name, contact_name, category, avatar_url")
      .neq("id", profile.id)
      .or("org_name.ilike.%" + safeQuery + "%,contact_name.ilike.%" + safeQuery + "%")
      .limit(10);
    var rows = res.data || [];
    resultsEl.innerHTML = rows.length
      ? rows.map(function (m) {
          var name = m.org_name || m.contact_name || "Member";
          return (
            '<button type="button" class="app-list-item" data-member-id="' + m.id + '" data-member-name="' + escapeHtml(name) + '" style="width:100%;">' +
            avatarHtml(name, m.category, null, m.avatar_url) +
            '<span class="app-list-item-body"><span class="app-list-item-name">' + escapeHtml(name) + "</span></span>" +
            "</button>"
          );
        }).join("")
      : '<p class="settings-note">No members found.</p>';
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
    await reloadThreads();

    var params = new URLSearchParams(window.location.search);
    var threadParam = params.get("thread");
    if (threadParam) activeThreadId = threadParam;

    renderThreadList();
    await renderChatView();

    document.getElementById("chat-back").addEventListener("click", function () {
      activeThreadId = null;
      renderThreadList();
      renderChatView();
    });

    document.getElementById("chat-thread-list").addEventListener("click", function (e) {
      var item = e.target.closest(".app-list-item");
      if (!item) return;
      activeThreadId = item.dataset.id;
      renderThreadList();
      renderChatView();
    });

    var chatImageInput = document.getElementById("chat-image-input");
    document.getElementById("chat-attach-btn").addEventListener("click", function () {
      chatImageInput.click();
    });

    document.getElementById("chat-compose-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var chatInput = document.getElementById("chat-input");
      var text = chatInput.value.trim();
      var imageFile = chatImageInput.files[0];
      if ((!text && !imageFile) || !activeThreadId) return;

      var submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      var imageUrl = await uploadChatImage(imageFile);
      var res = await sb.from("messages").insert({ thread_id: activeThreadId, sender_id: profile.id, body: text || "", image_url: imageUrl });
      submitBtn.disabled = false;
      if (res.error) {
        window.alert(res.error.message);
        return;
      }
      chatInput.value = "";
      chatImageInput.value = "";
      await reloadThreads();
      renderThreadList();
      renderChatView();
    });

    // New Message modal
    var newMessageSelectedId = null;
    document.getElementById("new-message-btn").addEventListener("click", openNewMessageModal);
    document.getElementById("new-message-close").addEventListener("click", closeNewMessageModal);
    document.getElementById("new-message-backdrop").addEventListener("click", function (e) {
      if (e.target.id === "new-message-backdrop") closeNewMessageModal();
    });

    var searchDebounce;
    document.getElementById("new-message-search").addEventListener("input", function (e) {
      clearTimeout(searchDebounce);
      var val = e.target.value;
      searchDebounce = setTimeout(function () { searchMembers(val); }, 250);
    });

    document.getElementById("new-message-results").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-member-id]");
      if (!btn) return;
      newMessageSelectedId = btn.dataset.memberId;
      document.getElementById("new-message-search").hidden = true;
      document.getElementById("new-message-results").hidden = true;
      document.getElementById("new-message-recipient").textContent = "To: " + btn.dataset.memberName;
      document.getElementById("new-message-form").hidden = false;
      document.getElementById("new-message-error").hidden = true;
      document.getElementById("new-message-textarea").value = "";
      document.getElementById("new-message-textarea").focus();
    });

    document.getElementById("new-message-cancel-btn").addEventListener("click", function () {
      newMessageSelectedId = null;
      document.getElementById("new-message-form").hidden = true;
      document.getElementById("new-message-search").hidden = false;
      document.getElementById("new-message-results").hidden = false;
    });

    document.getElementById("new-message-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!newMessageSelectedId) return;
      var textarea = document.getElementById("new-message-textarea");
      var text = textarea.value.trim();
      if (!text) return;
      var errorEl = document.getElementById("new-message-error");
      errorEl.hidden = true;
      var submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      var res = await sb.rpc("start_direct_thread", { p_other_profile_id: newMessageSelectedId, p_initial_message: text });
      submitBtn.disabled = false;
      if (res.error) {
        errorEl.textContent = res.error.message;
        errorEl.hidden = false;
        return;
      }
      closeNewMessageModal();
      activeThreadId = res.data;
      await reloadThreads();
      renderThreadList();
      renderChatView();
    });
  });
})();
