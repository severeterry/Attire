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

  async function fetchPools() {
    var res = await sb
      .from("pooling_threads")
      .select("id, title, category, target_group_size, participant_cap, closes_at, status, created_at, organizer_id, profiles(org_name, contact_name, category), pooling_participants(count)")
      .order("created_at", { ascending: false });
    if (res.error) { console.error(res.error); return []; }
    return res.data;
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
    var joined = (pool.pooling_participants && pool.pooling_participants[0] && pool.pooling_participants[0].count) || 0;
    return (
      '<a href="pooling.html?id=' + encodeURIComponent(pool.id) + '" class="post-card" style="display:block;">' +
      '<p class="post-author-name">' + escapeHtml(pool.title) + "</p>" +
      '<p class="settings-note">' +
      (pool.category === "materials" ? "Materials Co-Op" : "Service Co-Op") + " &mdash; " +
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

  function renderRecent() {
    var recentEl = document.getElementById("pooling-recent-list");
    if (!recentEl) return;
    var recent = pools.slice(0, 5);
    recentEl.innerHTML = recent.length
      ? recent.map(function (p) {
          var organizer = p.profiles || {};
          var name = organizer.org_name || organizer.contact_name || "Member";
          return '<a class="app-context-recent-item" href="pooling.html?id=' + encodeURIComponent(p.id) + '">' + escapeHtml(p.title) + "<span>Organized by " + escapeHtml(name) + "</span></a>";
        }).join("")
      : '<p class="settings-note">No Co-Ops yet.</p>';
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
      .select("profile_id, profiles(org_name, contact_name)")
      .eq("pooling_thread_id", poolId);
    var participants = partRes.data || [];
    var joinedCount = participants.length;
    var alreadyJoined = participants.some(function (p) { return p.profile_id === profile.id; });
    var isOrganizer = pool.organizer_id === profile.id;

    var detailsLine = pool.category === "materials"
      ? [pool.moq && "MOQ: " + pool.moq, pool.unit_cost && "Unit cost: " + pool.unit_cost, pool.production_run_details].filter(Boolean).join(" &middot; ")
      : [pool.service_type && "Service: " + pool.service_type, pool.cost_per_member_estimate && "Est. cost: " + pool.cost_per_member_estimate].filter(Boolean).join(" &middot; ");

    var html =
      '<h1 class="section-title" style="font-size:1.6rem;">' + escapeHtml(pool.title) + "</h1>" +
      '<p class="settings-note">' + (pool.category === "materials" ? "Materials Co-Op" : "Service Co-Op") + "</p>" +
      '<p class="section-lede">' + escapeHtml(pool.description) + "</p>" +
      '<div class="form-card">' +
      (detailsLine ? '<p class="settings-note">' + detailsLine + "</p>" : "") +
      '<p style="font-weight:700; margin-top:0.75rem;">' + joinedCount + " of " + pool.target_group_size + " joined" +
      (pool.participant_cap ? " (cap " + pool.participant_cap + ")" : "") + "</p>" +
      (pool.closes_at ? '<p class="settings-note">Closes ' + new Date(pool.closes_at).toLocaleString() + "</p>" : "") +
      '<p class="settings-note">Status: ' + pool.status + "</p>" +
      "<ul style=\"margin-top:0.5rem;\">" +
      participants.map(function (p) {
        var name = p.profiles ? (p.profiles.org_name || p.profiles.contact_name || "Member") : "Member";
        return '<li class="settings-note">' + escapeHtml(name) + "</li>";
      }).join("") +
      "</ul>";

    if (pool.status === "open" && !alreadyJoined) {
      html += '<button type="button" class="btn btn-primary btn-sm" id="pool-join-btn">Join this Co-Op</button>' +
        '<p class="login-error" id="pool-join-error" hidden></p>';
    } else if (pool.status === "open" && alreadyJoined) {
      html += '<p class="settings-note">You&rsquo;re in this Co-Op.</p>';
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
    renderPoolList();
    renderRecent();

    document.getElementById("pooling-sort-select").addEventListener("change", function (e) {
      filterState.sort = e.target.value;
      renderPoolList();
    });

  });
})();
