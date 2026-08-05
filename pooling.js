(function () {
  "use strict";

  var sb = window.supabaseClient;
  var profile = null;
  var pools = [];
  var filterState = { sort: "newest" };

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
      .select("id, title, category, target_group_size, participant_cap, closes_at, status, created_at, organizer_id, profiles(org_name, contact_name, category, avatar_url)")
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

  function poolCardHtml(pool) {
    var joined = pool.acceptedCount || 0;
    var organizer = pool.profiles || {};
    var name = organizer.org_name || organizer.contact_name || "Member";

    return (
      '<a href="pooling.html?id=' + encodeURIComponent(pool.id) + '" class="post-card is-coop" style="display:block;">' +
      '<div class="post-type-flag-slot"><span class="post-type-flag post-type-flag--coop">The Co-Op</span></div>' +
      '<div class="post-head">' +
      avatarHtml(name, organizer.category, organizer.avatar_url) +
      "<div>" +
      '<p class="post-author-name">' + escapeHtml(name) + "</p>" +
      '<div class="post-meta-row"><span>' + relativeTime(new Date(pool.created_at).getTime()) + " ago</span></div>" +
      "</div></div>" +
      '<p class="post-author-name" style="margin-top:0.6rem;">' + escapeHtml(pool.title) + "</p>" +
      '<p class="settings-note">' +
      labelForPoolCategory(pool.category) + " &mdash; " +
      joined + " of " + pool.target_group_size + " joined" +
      (pool.participant_cap ? " (cap " + pool.participant_cap + ")" : "") + " &mdash; " + pool.status +
      "</p></a>"
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

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errorEl.hidden = true;

      var closesAt = document.getElementById("pool-closes").value;
      var cap = document.getElementById("pool-cap").value;

      var payload = {
        organizer_id: profile.id,
        category: categorySelect.value,
        title: document.getElementById("pool-title").value.trim(),
        description: document.getElementById("pool-description").value.trim(),
        target_group_size: Number(document.getElementById("pool-target").value),
        participant_cap: cap ? Number(cap) : null,
        closes_at: closesAt || null,
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

  function manageParticipantsHtml(pending, accepted) {
    return (
      '<div class="form-card" style="margin-top:1rem;" id="manage-participants-panel">' +
      '<div class="profile-card-head"><h3>Manage participants</h3></div>' +

      '<p class="settings-note" style="font-weight:700;">Pending requests (' + pending.length + ")</p>" +
      (pending.length
        ? pending.map(function (p) {
            var name = p.profiles ? (p.profiles.org_name || p.profiles.contact_name || "Member") : "Member";
            return (
              '<div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; padding:0.5rem 0; border-bottom:1px solid var(--color-border);">' +
              '<span class="settings-note" style="margin:0;">' + escapeHtml(name) + "</span>" +
              '<span style="display:flex; gap:0.4rem;">' +
              '<button type="button" class="btn btn-primary btn-sm" data-action="accept-participant" data-id="' + p.profile_id + '">Accept</button>' +
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
      .select("id, title, description, category, moq, unit_cost, production_run_details, service_type, cost_per_member_estimate, target_group_size, participant_cap, closes_at, status, organizer_id, chat_thread_id")
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
      '<p class="section-lede">' + escapeHtml(pool.description) + "</p>" +
      '<div class="form-card">' +
      (detailsLine ? '<p class="settings-note">' + detailsLine + "</p>" : "") +
      '<p style="font-weight:700; margin-top:0.75rem;">' + acceptedParticipants.length + " of " + pool.target_group_size + " joined" +
      (pool.participant_cap ? " (cap " + pool.participant_cap + ")" : "") + "</p>" +
      (pool.closes_at ? '<p class="settings-note">Closes ' + new Date(pool.closes_at).toLocaleString() + "</p>" : "") +
      '<p class="settings-note">Status: ' + pool.status + "</p>" +
      "<ul style=\"margin-top:0.5rem;\">" +
      acceptedParticipants.map(function (p) {
        var name = p.profiles ? (p.profiles.org_name || p.profiles.contact_name || "Member") : "Member";
        return '<li class="settings-note">' + escapeHtml(name) + "</li>";
      }).join("") +
      "</ul>";

    if (pool.status === "open" && !isOrganizer) {
      if (!myRow) {
        html += '<button type="button" class="btn btn-primary btn-sm" id="pool-join-btn">Request to Join</button>' +
          '<p class="login-error" id="pool-join-error" hidden></p>';
      } else if (myRow.status === "pending") {
        html += '<p class="settings-note">Request sent &mdash; waiting on the organizer to accept.</p>' +
          '<button type="button" class="btn btn-outline btn-sm" id="pool-cancel-request-btn">Cancel request</button>' +
          '<p class="login-error" id="pool-cancel-request-error" hidden></p>';
      } else {
        html += '<p class="settings-note">You&rsquo;re in this Co-Op.</p>';
      }
    }
    if (pool.status === "open" && isOrganizer) {
      html += '<div style="margin-top:0.5rem;"><button type="button" class="btn btn-outline btn-sm" id="pool-close-btn">Close Co-Op now</button>' +
        '<p class="login-error" id="pool-close-error" hidden></p></div>';
    }
    if (pool.status === "closed" && pool.chat_thread_id) {
      html += '<a href="thread.html?id=' + encodeURIComponent(pool.chat_thread_id) + '" class="btn btn-primary btn-sm" style="margin-top:0.75rem;">Go to group chat</a>';
    }
    if (pool.status === "cancelled") {
      html += '<p class="settings-note">This Co-Op didn&rsquo;t reach the minimum of 2 participants and was cancelled.</p>';
    }
    html += "</div>";

    if (pool.status === "open" && isOrganizer) {
      html += manageParticipantsHtml(pendingParticipants, acceptedParticipants);
    }

    contentEl.innerHTML = html;

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

    document.getElementById("pooling-sort-select").addEventListener("change", function (e) {
      filterState.sort = e.target.value;
      renderPoolList();
    });

  });
})();
