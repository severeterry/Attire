(function () {
  "use strict";

  var sb = window.supabaseClient;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

    var threadStatus = "active";

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
        .select("id, sender_id, body, created_at, profiles(org_name, contact_name)")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });

      if (msgRes.error) {
        messagesEl.innerHTML = '<p class="settings-note">' + escapeHtml(msgRes.error.message) + "</p>";
        return;
      }

      messagesEl.innerHTML = msgRes.data.length
        ? msgRes.data.map(function (m) {
            var mine = m.sender_id === profile.id;
            return '<div class="chat-bubble from-' + (mine ? "me" : "them") + '">' + escapeHtml(m.body) + "</div>";
          }).join("")
        : '<p class="settings-note">No messages yet.</p>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    composeForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = composeInput.value.trim();
      if (!body) return;

      var submitBtn = composeForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      sb.from("messages").insert({ thread_id: threadId, sender_id: profile.id, body: body }).then(function (res) {
        submitBtn.disabled = false;
        if (res.error) {
          window.alert(res.error.message);
          return;
        }
        composeInput.value = "";
        loadThread();
      });
    });

    loadThread();
  });
})();
