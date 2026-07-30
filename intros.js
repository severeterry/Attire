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

  async function fetchIntroMembers() {
    var res = await sb
      .from("profiles")
      .select("id, org_name, contact_name, category, borough")
      .eq("intro_opt_in", true)
      .neq("tier", "free")
      .neq("id", profile.id)
      .order("org_name", { ascending: true });
    if (res.error) { console.error(res.error); return []; }
    return res.data;
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

  function memberCardHtml(m) {
    var name = m.org_name || m.contact_name || "Member";
    var meta = [m.category ? labelForCategory(m.category) : null, m.borough].filter(Boolean).join(" &middot; ");
    return (
      '<a href="profile.html?id=' + encodeURIComponent(m.id) + '" class="post-card" style="display:block;">' +
      '<p class="post-author-name">' + escapeHtml(name) + "</p>" +
      (meta ? '<p class="settings-note">' + meta + "</p>" : "") +
      "</a>"
    );
  }

  function renderIntroMembers() {
    var grid = document.getElementById("intro-members-grid");
    var empty = document.getElementById("intro-members-empty");
    var filtered = introMembers.filter(memberMatchesFilters);
    grid.innerHTML = filtered.map(memberCardHtml).join("");
    grid.hidden = filtered.length === 0;
    empty.hidden = filtered.length !== 0;
  }

  function setupIntroMemberFilters() {
    var searchInput = document.getElementById("intro-search-input");
    var boroughSelect = document.getElementById("intro-borough-select");
    var sidebarFilters = document.getElementById("sidebar-category-filters");

    searchInput.addEventListener("input", function () {
      introFilterState.search = searchInput.value.trim();
      renderIntroMembers();
    });
    boroughSelect.addEventListener("change", function () {
      introFilterState.borough = boroughSelect.value;
      renderIntroMembers();
    });
    sidebarFilters.addEventListener("click", function (e) {
      var link = e.target.closest(".app-sidebar-category-link");
      if (!link) return;
      introFilterState.category = link.dataset.cat;
      sidebarFilters.querySelectorAll(".app-sidebar-category-link").forEach(function (l) {
        l.classList.toggle("is-active", l === link);
      });
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

  async function loadIncoming() {
    var res = await sb
      .from("intro_requests")
      .select("id, note, created_at, requestor:requestor_id(id, org_name, contact_name, category, borough)")
      .eq("requestee_id", profile.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    var container = document.getElementById("intros-incoming");
    if (res.error || !res.data.length) {
      container.innerHTML = '<p class="settings-note">Nothing pending.</p>';
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
    renderIntroMembers();

    await loadIncoming();
    await loadResolved();

    document.getElementById("intros-incoming").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]");
      if (!btn) return;
      var introId = btn.dataset.id;
      var decision = btn.dataset.action === "accept" ? "accepted" : "declined";
      var errorEl = document.querySelector('[data-error-for="' + introId + '"]');

      sb.from("intro_requests")
        .update({ status: decision, resolved_at: new Date().toISOString() })
        .eq("id", introId)
        .eq("status", "pending")
        .then(function (res) {
          if (res.error) {
            if (errorEl) { errorEl.textContent = res.error.message; errorEl.hidden = false; }
            return;
          }
          loadIncoming();
          loadResolved();
        });
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
