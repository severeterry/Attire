(function () {
  "use strict";

  var CATEGORY_LABELS = {};
  CATEGORIES.forEach(function (c) { CATEGORY_LABELS[c.id] = c.label; });

  var LISTINGS = [];

  var grid = document.getElementById("directory-grid");
  var emptyState = document.getElementById("empty-state");
  var resultsCount = document.getElementById("results-count");
  var searchInput = document.getElementById("search-input");
  var boroughSelect = document.getElementById("borough-select");
  var verifiedOnly = document.getElementById("verified-only");
  var pillRow = document.getElementById("category-pills");
  var clearBtn = document.getElementById("clear-filters");
  var emptyClearBtn = document.getElementById("empty-clear");

  var modalBackdrop = document.getElementById("modal-backdrop");
  var modalPanel = document.getElementById("modal-panel");
  var modalClose = document.getElementById("modal-close");

  var state = { search: "", category: "all", borough: "all", verified: false };

  function vBadge(isVerified) {
    if (isVerified) {
      return (
        '<span class="v-badge v-badge--verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Verified</span>'
      );
    }
    return '<span class="v-badge v-badge--unverified">Unverified &mdash; pending outreach</span>';
  }

  function catBadge(catId) {
    return '<span class="cat-badge" data-cat="' + catId + '">' + CATEGORY_LABELS[catId] + "</span>";
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function matchesFilters(item) {
    if (state.category !== "all" && item.category !== state.category) return false;
    if (state.borough !== "all" && item.borough !== state.borough) return false;
    if (state.verified && !item.verified) return false;
    if (state.search) {
      var haystack = (item.name + " " + item.subcategory + " " + item.description).toLowerCase();
      if (haystack.indexOf(state.search.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function renderCard(item) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = "listing-card";
    card.setAttribute("data-id", item.id);
    card.innerHTML =
      '<div class="listing-top">' +
        catBadge(item.category) +
        vBadge(item.verified) +
      "</div>" +
      "<h3>" + escapeHtml(item.name) + "</h3>" +
      '<p class="listing-sub">' + escapeHtml(item.subcategory) + " &middot; " + escapeHtml(item.borough) + "</p>" +
      '<p class="listing-desc">' + escapeHtml(item.description) + "</p>" +
      '<div class="listing-footer">' +
        '<span class="listing-meta">' + (item.tag ? escapeHtml(item.tag) : "NYC-based") + "</span>" +
        '<span class="listing-view">View Profile &rarr;</span>' +
      "</div>";
    card.addEventListener("click", function () { openModal(item); });
    return card;
  }

  function render() {
    var filtered = LISTINGS.filter(matchesFilters);
    grid.innerHTML = "";
    filtered.forEach(function (item) { grid.appendChild(renderCard(item)); });

    resultsCount.innerHTML = "Showing <strong>" + filtered.length + "</strong> of " + LISTINGS.length + " organizations";
    emptyState.hidden = filtered.length !== 0;
    grid.hidden = filtered.length === 0;
  }

  function setCategoryPill(catId) {
    state.category = catId;
    pillRow.querySelectorAll(".cat-pill").forEach(function (pill) {
      pill.setAttribute("aria-pressed", String(pill.getAttribute("data-cat") === catId));
    });
    render();
  }

  pillRow.addEventListener("click", function (e) {
    var pill = e.target.closest(".cat-pill");
    if (!pill) return;
    setCategoryPill(pill.getAttribute("data-cat"));
  });

  searchInput.addEventListener("input", function () {
    state.search = searchInput.value.trim();
    render();
  });

  boroughSelect.addEventListener("change", function () {
    state.borough = boroughSelect.value;
    render();
  });

  verifiedOnly.addEventListener("change", function () {
    state.verified = verifiedOnly.checked;
    render();
  });

  function clearFilters() {
    state = { search: "", category: "all", borough: "all", verified: false };
    searchInput.value = "";
    boroughSelect.value = "all";
    verifiedOnly.checked = false;
    setCategoryPill("all");
  }

  clearBtn.addEventListener("click", clearFilters);
  emptyClearBtn.addEventListener("click", clearFilters);

  // Modal
  var lastFocused = null;

  function openModal(item) {
    document.getElementById("modal-badges").innerHTML = catBadge(item.category) + vBadge(item.verified);
    document.getElementById("modal-title").textContent = item.name;
    document.getElementById("modal-sub").textContent =
      item.subcategory + " · " + item.borough + (item.yearsNote ? " · " + item.yearsNote : "");
    document.getElementById("modal-desc").textContent = item.description;

    var noteEl = document.getElementById("modal-note");
    if (item.goodToKnow) {
      noteEl.hidden = false;
      noteEl.textContent = "Good to know: " + item.goodToKnow;
    } else {
      noteEl.hidden = true;
    }

    lastFocused = document.activeElement;
    modalBackdrop.classList.add("is-open");
    modalClose.focus();
    document.addEventListener("keydown", onModalKeydown);
  }

  function closeModal() {
    modalBackdrop.classList.remove("is-open");
    document.removeEventListener("keydown", onModalKeydown);
    if (lastFocused) lastFocused.focus();
  }

  function onModalKeydown(e) {
    if (e.key === "Escape") closeModal();
  }

  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", function (e) {
    if (e.target === modalBackdrop) closeModal();
  });

  async function fetchListings() {
    var res = await window.supabaseClient.from("directory_listings").select("*").order("name", { ascending: true });
    if (res.error) { console.error(res.error); return []; }
    return res.data.map(function (row) {
      return {
        id: row.id, name: row.name, category: row.category, subcategory: row.subcategory,
        borough: row.borough, verified: row.verified, tag: row.tag, yearsNote: row.years_note,
        description: row.description, goodToKnow: row.good_to_know,
      };
    });
  }

  fetchListings().then(function (data) {
    LISTINGS = data;

    // Preselect category from ?category= query param (linked from home page)
    var params = new URLSearchParams(window.location.search);
    var initialCategory = params.get("category");
    if (initialCategory && CATEGORY_LABELS[initialCategory]) {
      setCategoryPill(initialCategory);
    } else {
      render();
    }
  });
})();
