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

  function avatarHtml(name, category, avatarUrl) {
    if (avatarUrl) return '<span class="portal-avatar portal-avatar-lg portal-avatar-img"><img src="' + avatarUrl + '" alt=""></span>';
    return '<span class="portal-avatar portal-avatar-lg"' + (category ? ' data-cat="' + category + '"' : "") + ">" + escapeHtml(initials(name)) + "</span>";
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
      avatarHtml(name, m.category, m.avatar_url) +
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
    if (upgradeNote) upgradeNote.hidden = eligible || filtered.length === 0;
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

    if (intro.status === "accepted" && isRequestor) {
      pieces.push('<div id="contact-' + intro.id + '"><button type="button" class="btn btn-outline btn-sm" data-action="reveal" data-id="' + intro.id + '">Show contact info</button></div>');
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
      .select("id, note, created_at, requestor:requestor_id(id, org_name, contact_name, category, borough)")
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
    var bodyEl = document.getElementById("intro-popup-body");
    bodyEl.innerHTML =
      '<div class="post-head" style="margin-bottom:0.75rem;">' +
      avatarHtml(name, intro.requestor.category) +
      "<div><p class=\"post-author-name\">" + escapeHtml(name) + "</p>" +
      '<p class="settings-note" style="margin:0;">Requesting an introduction to you</p></div></div>' +
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

  async function loadResolved() {
    var res = await sb
      .from("intro_requests")
      .select(
        "id, status, requestor_id, requestee_id, requestor_good_match, requestee_good_match, " +
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
      });
    });

    function resolveIntroRequest(introId, decision, errorEl) {
      return sb.from("intro_requests")
        .update({ status: decision, resolved_at: new Date().toISOString() })
        .eq("id", introId)
        .eq("status", "pending")
        .then(function (res) {
          if (res.error) {
            if (errorEl) { errorEl.textContent = res.error.message; errorEl.hidden = false; }
            return;
          }
          closeIntroPopup();
          loadIncoming();
          loadResolved();
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

    document.getElementById("intros-resolved").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]");
      if (!btn) return;
      var introId = btn.dataset.id;

      if (btn.dataset.action === "reveal") {
        sb.rpc("get_accepted_intro_contact", { p_intro_id: introId }).maybeSingle().then(function (res) {
          var el = document.getElementById("contact-" + introId);
          if (!el) return;
          if (res.error || !res.data) {
            el.innerHTML = '<p class="login-error" style="display:block;">Contact info isn\'t available for this request.</p>';
            return;
          }
          el.innerHTML = '<p class="settings-note">' + escapeHtml(res.data.email || "") +
            (res.data.phone ? " &middot; " + escapeHtml(res.data.phone) : "") + "</p>";
        });
        return;
      }

      if (btn.dataset.action === "feedback-yes" || btn.dataset.action === "feedback-no") {
        var goodMatch = btn.dataset.action === "feedback-yes";
        sb.from("intro_requests").select("requestor_id, requestee_id").eq("id", introId).single().then(function (introRes) {
          if (introRes.error || !introRes.data) return;
          var field = introRes.data.requestor_id === profile.id ? "requestor_good_match" : "requestee_good_match";
          var patch = {};
          patch[field] = goodMatch;
          sb.from("intro_requests").update(patch).eq("id", introId).then(function () { loadResolved(); });
        });
      }
    });
  });
})();
