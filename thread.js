(function () {
  "use strict";

  var sb = window.supabaseClient;

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

  function avatarHtml(name, category, extraClass, avatarUrl) {
    var cls = "portal-avatar" + (extraClass ? " " + extraClass : "");
    if (avatarUrl) return '<span class="' + cls + ' portal-avatar-img"><img src="' + escapeHtml(avatarUrl) + '" alt=""></span>';
    return '<span class="' + cls + '"' + (category ? ' data-cat="' + category + '"' : "") + ">" + escapeHtml(initials(name)) + "</span>";
  }

  document.addEventListener("DOMContentLoaded", async function () {
    if (!window.AttireAuth) return;
    var session = await window.AttireAuth.getSession();
    if (!session) {
      window.location.href = "index.html";
      return;
    }

    var profile = await window.AttireAuth.getCurrentProfile();
    if (!profile) {
      window.location.href = "index.html";
      return;
    }

    var threadId = new URLSearchParams(window.location.search).get("id");
    if (!threadId) {
      window.location.href = "member-portal.html?view=deal";
      return;
    }

    var messagesEl = document.getElementById("thread-messages");
    var statusCard = document.getElementById("thread-status-card");
    var statusNote = document.getElementById("thread-status-note");
    var composeForm = document.getElementById("thread-compose-form");
    var composeInput = document.getElementById("thread-compose-input");
    var imageInput = document.getElementById("thread-image-input");

    var threadStatus = "active";
    var threadParticipants = {};

    async function uploadThreadImage(file) {
      if (!file) return null;
      var ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      var path = profile.id + "/" + Date.now() + "-" + Math.random().toString(36).slice(2) + "." + ext;
      var res = await sb.storage.from("post-attachments").upload(path, file);
      if (res.error) return null;
      return sb.storage.from("post-attachments").getPublicUrl(path).data.publicUrl;
    }

    async function loadMembers() {
      var partRes = await sb.from("thread_participants").select("profile_id, profiles(org_name, contact_name, category, avatar_url)").eq("thread_id", threadId);
      var participants = partRes.data || [];
      threadParticipants = {};
      participants.forEach(function (p) { threadParticipants[p.profile_id] = p.profiles || {}; });

      var listEl = document.getElementById("thread-members-list");
      listEl.innerHTML = participants.map(function (p) {
        var n = p.profiles ? (p.profiles.org_name || p.profiles.contact_name || "Member") : "Member";
        var prof = p.profiles || {};
        return '<div class="context-member-item">' + avatarHtml(n, prof.category, "portal-avatar-sm", prof.avatar_url) +
          '<span class="context-member-name" style="color:inherit;">' + escapeHtml(n) + "</span></div>";
      }).join("");
    }

    async function loadIdentity() {
      var res = await sb.from("pooling_threads").select("title, profiles(org_name, contact_name, category, avatar_url)").eq("chat_thread_id", threadId).maybeSingle();
      var headEl = document.getElementById("thread-popup-head");
      var avatarEl = document.getElementById("thread-popup-avatar");
      var titleEl = document.getElementById("thread-identity-title");
      var pool = res.data;
      if (!pool) {
        titleEl.textContent = "Group Chat";
        return;
      }
      var organizer = pool.profiles || {};
      var organizerName = organizer.org_name || organizer.contact_name || "Organizer";
      titleEl.textContent = pool.title;
      if (organizer.category) headEl.setAttribute("data-cat", organizer.category);
      avatarEl.outerHTML = avatarHtml(organizerName, organizer.category, "thread-popup-avatar", organizer.avatar_url).replace("<span", '<span id="thread-popup-avatar"');
    }

    function markRead() {
      sb.from("thread_participants").update({ last_read_at: new Date().toISOString() })
        .eq("thread_id", threadId).eq("profile_id", profile.id).then(function () {});
    }

    async function loadThread() {
      var threadRes = await sb.from("threads").select("id, status").eq("id", threadId).maybeSingle();
      if (threadRes.error || !threadRes.data) {
        messagesEl.innerHTML = '<p class="settings-note">This thread doesn\'t exist, or you don\'t have access to it.</p>';
        composeForm.hidden = true;
        return;
      }
      threadStatus = threadRes.data.status;

      if (threadStatus === "expired") {
        statusCard.hidden = false;
        statusNote.textContent = "This thread expired after 14 days of inactivity and is now read-only.";
        composeForm.hidden = true;
      } else {
        statusCard.hidden = true;
        composeForm.hidden = false;
      }

      var msgRes = await sb
        .from("messages")
        .select("id, sender_id, body, image_url, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });

      if (msgRes.error) {
        messagesEl.innerHTML = '<p class="settings-note">' + escapeHtml(msgRes.error.message) + "</p>";
        return;
      }

      messagesEl.innerHTML = msgRes.data.length
        ? msgRes.data.map(function (m) {
            var mine = m.sender_id === profile.id;
            var sender = threadParticipants[m.sender_id] || {};
            var senderName = sender.org_name || sender.contact_name || "Member";
            return '<div class="chat-bubble-row from-' + (mine ? "me" : "them") + '">' +
              (mine ? "" : avatarHtml(senderName, sender.category, "chat-bubble-avatar portal-avatar-sm", sender.avatar_url)) +
              '<div class="chat-bubble from-' + (mine ? "me" : "them") + '">' +
              (mine ? "" : '<span class="chat-bubble-sender">' + escapeHtml(senderName) + "</span>") +
              (m.image_url ? '<img class="chat-bubble-img" src="' + escapeHtml(m.image_url) + '" alt="">' : "") +
              (m.body ? escapeHtml(m.body) : "") + "</div></div>";
          }).join("")
        : '<p class="settings-note">No messages yet.</p>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
      markRead();
    }

    document.getElementById("thread-members-btn").addEventListener("click", function () {
      var list = document.getElementById("thread-members-list");
      list.hidden = !list.hidden;
    });
    document.getElementById("thread-attach-btn").addEventListener("click", function () {
      imageInput.click();
    });

    composeForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var body = composeInput.value.trim();
      var imageFile = imageInput.files[0];
      if (!body && !imageFile) return;

      var submitBtn = composeForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      var imageUrl = await uploadThreadImage(imageFile);

      sb.from("messages").insert({ thread_id: threadId, sender_id: profile.id, body: body || "", image_url: imageUrl }).then(function (res) {
        submitBtn.disabled = false;
        if (res.error) {
          window.alert(res.error.message);
          return;
        }
        composeInput.value = "";
        imageInput.value = "";
        loadThread();
      });
    });

    loadIdentity();
    loadMembers().then(loadThread);
  });
})();
