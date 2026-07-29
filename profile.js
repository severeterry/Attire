(function () {
  "use strict";

  var PORTAL_STORAGE_KEY = "attire-portal-v1";
  var profile = null;
  var viewingOther = false;
  var otherName = null;
  var otherListing = null;

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

  function relativeTime(ts) {
    var diff = Math.max(0, Date.now() - ts);
    var min = Math.round(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + "m";
    var hr = Math.round(min / 60);
    if (hr < 24) return hr + "h";
    return Math.round(hr / 24) + "d";
  }

  function buildInitialPortalState() {
    var now = Date.now();
    var posts = PORTAL_SEED_POSTS.map(function (p) {
      return {
        id: p.id, authorName: p.authorName, category: p.category, type: p.type, body: p.body,
        createdAt: now - p.ageMs, likes: p.likes, liked: p.liked, reposted: p.reposted, repostCount: p.repostCount,
        comments: p.comments.map(function (c) {
          return { author: c.author, category: c.category, body: c.body, createdAt: now - c.ageMs };
        }),
        commentsOpen: false,
      };
    });
    var threads = PORTAL_SEED_THREADS.map(function (t) {
      return {
        id: t.id, name: t.name, category: t.category, unread: t.unread,
        messages: t.messages.map(function (m) { return { from: m.from, text: m.text, createdAt: now - m.ageMs }; }),
      };
    });
    return { posts: posts, threads: threads };
  }

  function loadPortalState() {
    try {
      var raw = localStorage.getItem(PORTAL_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    var fresh = buildInitialPortalState();
    try { localStorage.setItem(PORTAL_STORAGE_KEY, JSON.stringify(fresh)); } catch (e) {}
    return fresh;
  }

  function renderBodyAvatar(name, category, avatarUrl) {
    var el = document.getElementById("profile-avatar");
    var img = avatarUrl ? '<img src="' + avatarUrl + '" alt="">' : escapeHtml(initials(name));
    el.classList.toggle("portal-avatar-img", !!avatarUrl);
    el.innerHTML = img;
    if (!avatarUrl && category) el.setAttribute("data-cat", category);
    else el.removeAttribute("data-cat");
  }

  function renderHeaderInfo() {
    document.getElementById("topbar-title").textContent = "Profile";
    document.getElementById("profile-name").textContent = profile.name;
    document.getElementById("profile-org").textContent = profile.orgName ? profile.orgName : "Member since " + profile.memberSince;

    var catBadge = document.getElementById("profile-category-badge");
    if (profile.category) {
      catBadge.textContent = labelForCategory(profile.category);
      catBadge.setAttribute("data-cat", profile.category);
      catBadge.hidden = false;
    } else {
      catBadge.hidden = true;
    }

    var boroughBadge = document.getElementById("profile-borough-badge");
    if (profile.borough) {
      boroughBadge.textContent = profile.borough;
      boroughBadge.hidden = false;
    } else {
      boroughBadge.hidden = true;
    }
  }

  function renderStats() {
    var portalState = loadPortalState();
    var myPosts = portalState.posts.filter(function (p) { return p.authorName === profile.name; });
    document.getElementById("stat-posts").textContent = myPosts.length;
    document.getElementById("stat-connections").textContent = countConnections(profile.name);
    return myPosts;
  }

  function renderPostsTab(posts) {
    var listEl = document.getElementById("profile-posts-list");
    posts = posts.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (!posts.length) {
      listEl.innerHTML = '<div class="empty-state"><h3>No posts yet</h3><p>Anything shared to the feed will show up here.</p></div>';
      return;
    }
    listEl.innerHTML = posts
      .map(function (post) {
        var typeLabel = post.type === "deal" ? "Deal Board RFP" : post.type === "sourcing" ? "Sourcing" : "Update";
        return (
          '<article class="post-card">' +
          '<div class="post-meta-row"><span class="cat-badge">' + typeLabel + '</span>' +
          "<span>&middot;</span><span>" + relativeTime(post.createdAt) + " ago</span></div>" +
          '<p class="post-body">' + escapeHtml(post.body) + "</p>" +
          '<div class="post-meta-row" style="margin-top:0.6rem;">' +
          "<span>" + post.likes + " likes</span><span>&middot;</span>" +
          "<span>" + post.comments.length + " comments</span><span>&middot;</span>" +
          "<span>" + post.repostCount + " reposts</span>" +
          "</div></article>"
        );
      })
      .join("");
  }

  function renderAboutView() {
    document.getElementById("view-bio").textContent = profile.bio || "No bio yet.";
    document.getElementById("view-email").textContent = profile.email || "—";
    document.getElementById("view-website").textContent = profile.website || "—";
    document.getElementById("view-borough").textContent = profile.borough || "—";
    document.getElementById("view-category").textContent = labelForCategory(profile.category);
    var practicesEl = document.getElementById("view-practices");
    practicesEl.innerHTML = (profile.practices || []).length
      ? profile.practices.map(function (p) { return '<span class="cat-pill" style="cursor:default;">' + escapeHtml(p) + "</span>"; }).join("")
      : '<span class="profile-about-empty">No practices selected yet.</span>';
  }

  function renderPracticeChips(containerId, selected, editable) {
    var container = document.getElementById(containerId);
    container.innerHTML = PROFILE_PRACTICE_OPTIONS.map(function (opt) {
      var isOn = selected.indexOf(opt) !== -1;
      return (
        '<button type="button" class="cat-pill" data-practice="' + escapeHtml(opt) + '" aria-pressed="' + isOn + '">' +
        escapeHtml(opt) + "</button>"
      );
    }).join("");
    if (editable) {
      container.querySelectorAll(".cat-pill").forEach(function (chip) {
        chip.addEventListener("click", function () {
          chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") !== "true");
        });
      });
    }
  }

  function fillAboutForm() {
    document.getElementById("edit-org-name").value = profile.orgName || "";
    document.getElementById("edit-bio").value = profile.bio || "";
    document.getElementById("edit-email").value = profile.email || "";
    document.getElementById("edit-website").value = profile.website || "";
    document.getElementById("edit-borough").value = profile.borough || "Manhattan";
    document.getElementById("edit-category").value = profile.category || "materials";
    renderPracticeChips("edit-practices", profile.practices || [], true);
  }

  function renderSettings() {
    document.getElementById("setting-notify-messages").checked = !!profile.settings.notifyMessages;
    document.getElementById("setting-notify-deals").checked = !!profile.settings.notifyDealBoard;
    document.getElementById("setting-show-directory").checked = !!profile.settings.showInDirectory;
    document.getElementById("setting-dm-all").checked = !!profile.settings.dmFromAllMembers;
    renderPlanManagement();
  }

  function renderPlanManagement() {
    var tier = profile.tier || "individual";
    var planNames = { free: "Free Plan", individual: "Individual / Affiliate", organization: "Organization Membership" };
    var billing = profile.billing;
    var hasPrepay = !!(billing && billing.termMonths > 1);

    var line = "You're on the <strong>" + planNames[tier] + "</strong>.";
    if (billing && billing.termMonths) {
      if (billing.status === "trial") {
        line += " Your first " + billing.freeMonths + " months are free, then $" + billing.monthlyRate + "/mo" +
          (hasPrepay ? " for " + billing.termMonths + " months ($" + billing.totalDue + " total)" : ", billed monthly") + ".";
      } else if (hasPrepay) {
        line += " Billed $" + billing.monthlyRate + "/mo on your " + billing.termMonths + "-month plan.";
      }
    }
    if (profile.accountCredit) {
      line += ' <span class="manage-plan-credit">You have $' + profile.accountCredit + " in account credit.</span>";
    }
    document.getElementById("manage-plan-current").innerHTML = line;

    var upgradeBtn = document.getElementById("upgrade-plan-btn");
    var cancelBtn = document.getElementById("cancel-subscription-btn");
    document.getElementById("cancel-confirm").hidden = true;

    var refundChoice = document.getElementById("cancel-refund-choice");
    var confirmCopy = document.getElementById("cancel-confirm-copy");
    if (refundChoice && confirmCopy) {
      refundChoice.hidden = !hasPrepay;
      confirmCopy.textContent = hasPrepay
        ? "Cancel your subscription? You've prepaid $" + billing.totalDue + " for " + billing.termMonths +
          " months at $" + billing.monthlyRate + "/mo. Choose how you'd like to handle the unused balance below."
        : "Cancel your subscription? You'll lose deal board access, direct messaging, and event invitations at the end of this billing period, and drop to the Free Plan.";
    }

    if (tier === "organization") {
      upgradeBtn.hidden = true;
      cancelBtn.hidden = false;
    } else {
      upgradeBtn.hidden = false;
      upgradeBtn.textContent = tier === "free" ? "Upgrade Plan" : "Upgrade to Organization";
      cancelBtn.hidden = tier === "free";
    }
  }

  function renderConnectActions(name) {
    var wrap = document.getElementById("connect-actions");
    var connectBtn = document.getElementById("connect-btn");
    var cancelBtn = document.getElementById("cancel-request-btn");
    var acceptBtn = document.getElementById("accept-request-btn");
    var declineBtn = document.getElementById("decline-request-btn");
    var connectedLabel = document.getElementById("connected-label");
    var removeBtn = document.getElementById("remove-connection-btn");

    wrap.hidden = false;
    [connectBtn, cancelBtn, acceptBtn, declineBtn, connectedLabel, removeBtn].forEach(function (el) { el.hidden = true; });

    var rel = getRelationship(profile.name, name);
    if (!rel) {
      connectBtn.hidden = false;
    } else if (rel.status === "accepted") {
      connectedLabel.hidden = false;
      removeBtn.hidden = false;
    } else if (rel.direction === "outgoing") {
      cancelBtn.hidden = false;
    } else {
      acceptBtn.hidden = false;
      declineBtn.hidden = false;
    }
  }

  function renderOwnProfile() {
    renderBodyAvatar(profile.name, profile.category, profile.avatar);
    renderHeaderInfo();
    var myPosts = renderStats();
    renderPostsTab(myPosts);
    renderAboutView();
    renderSettings();
  }

  function renderOtherProfile(name, listing) {
    document.title = name + " — Attire Member";
    document.getElementById("topbar-title").textContent = name;
    document.getElementById("back-to-feed-link").hidden = false;
    document.getElementById("view-in-directory-btn").hidden = false;
    document.getElementById("edit-profile-btn").hidden = true;
    document.getElementById("avatar-edit-btn").hidden = true;
    document.getElementById("settings-section").hidden = true;
    document.getElementById("field-email").hidden = true;
    document.getElementById("field-website").hidden = true;
    document.getElementById("field-practices").hidden = true;

    var category = listing ? listing.category : null;
    var borough = listing ? listing.borough : null;
    var bio = listing
      ? listing.description + (listing.goodToKnow ? " " + listing.goodToKnow : "")
      : "No profile information available for this member yet.";

    var directoryLink = document.getElementById("view-in-directory-btn");
    directoryLink.href = category ? "directory.html?category=" + category : "directory.html";

    renderBodyAvatar(name, category, null);
    document.getElementById("profile-name").textContent = name;
    document.getElementById("profile-org").hidden = true;

    var catBadge = document.getElementById("profile-category-badge");
    if (category) {
      catBadge.textContent = labelForCategory(category);
      catBadge.setAttribute("data-cat", category);
      catBadge.hidden = false;
    } else {
      catBadge.hidden = true;
    }
    var boroughBadge = document.getElementById("profile-borough-badge");
    if (borough) {
      boroughBadge.textContent = borough;
      boroughBadge.hidden = false;
    } else {
      boroughBadge.hidden = true;
    }

    var portalState = loadPortalState();
    var theirPosts = portalState.posts.filter(function (p) { return p.authorName === name; });
    document.getElementById("stat-posts").textContent = theirPosts.length;
    document.getElementById("stat-connections").textContent = countConnections(name);
    renderPostsTab(theirPosts);

    document.getElementById("view-bio").textContent = bio;
    document.getElementById("view-borough").textContent = borough || "—";
    document.getElementById("view-category").textContent = labelForCategory(category);

    renderConnectActions(name);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var auth = window.AttireAuth ? window.AttireAuth.getAuth() : null;
    if (!auth || !auth.loggedIn) {
      window.location.href = "index.html";
      return;
    }

    profile = loadPortalProfile();

    var params = new URLSearchParams(window.location.search);
    var memberParam = params.get("member");
    if (memberParam && memberParam !== profile.name) {
      viewingOther = true;
      otherName = memberParam;
      otherListing = (typeof LISTINGS !== "undefined" ? LISTINGS.find(function (l) { return l.name === memberParam; }) : null) || null;
      renderOtherProfile(otherName, otherListing);
    } else {
      renderOwnProfile();
    }

    if (viewingOther) {
      document.getElementById("connect-btn").addEventListener("click", function () {
        sendConnectionRequest(profile.name, otherName);
        renderConnectActions(otherName);
      });
      document.getElementById("cancel-request-btn").addEventListener("click", function () {
        removeConnection(profile.name, otherName);
        renderConnectActions(otherName);
      });
      document.getElementById("accept-request-btn").addEventListener("click", function () {
        respondToConnectionRequest(profile.name, otherName, true);
        renderConnectActions(otherName);
        document.getElementById("stat-connections").textContent = countConnections(otherName);
      });
      document.getElementById("decline-request-btn").addEventListener("click", function () {
        respondToConnectionRequest(profile.name, otherName, false);
        renderConnectActions(otherName);
      });
      document.getElementById("remove-connection-btn").addEventListener("click", function () {
        removeConnection(profile.name, otherName);
        renderConnectActions(otherName);
        document.getElementById("stat-connections").textContent = countConnections(otherName);
      });
      return; // nothing below applies when viewing someone else's read-only profile
    }

    // Avatar upload
    var avatarEditBtn = document.getElementById("avatar-edit-btn");
    var avatarInput = document.getElementById("avatar-input");
    avatarEditBtn.addEventListener("click", function () { avatarInput.click(); });
    avatarInput.addEventListener("change", function () {
      var file = avatarInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        profile.avatar = reader.result;
        savePortalProfile(profile);
        renderBodyAvatar(profile.name, profile.category, profile.avatar);
      };
      reader.readAsDataURL(file);
    });

    // About edit toggle
    var editBtn = document.getElementById("edit-profile-btn");
    var aboutView = document.getElementById("about-view");
    var practicesCard = document.getElementById("field-practices");
    var aboutForm = document.getElementById("about-form");

    editBtn.addEventListener("click", function () {
      fillAboutForm();
      aboutView.hidden = true;
      practicesCard.hidden = true;
      aboutForm.hidden = false;
    });
    document.getElementById("cancel-edit-btn").addEventListener("click", function () {
      aboutView.hidden = false;
      practicesCard.hidden = false;
      aboutForm.hidden = true;
    });
    aboutForm.addEventListener("submit", function (e) {
      e.preventDefault();
      profile.orgName = document.getElementById("edit-org-name").value.trim();
      profile.bio = document.getElementById("edit-bio").value.trim();
      profile.email = document.getElementById("edit-email").value.trim();
      profile.website = document.getElementById("edit-website").value.trim();
      profile.borough = document.getElementById("edit-borough").value;
      profile.category = document.getElementById("edit-category").value;
      profile.practices = Array.from(document.querySelectorAll('#edit-practices .cat-pill[aria-pressed="true"]')).map(function (chip) {
        return chip.dataset.practice;
      });
      savePortalProfile(profile);
      renderHeaderInfo();
      renderBodyAvatar(profile.name, profile.category, profile.avatar);
      renderStats();
      renderAboutView();
      aboutView.hidden = false;
      practicesCard.hidden = false;
      aboutForm.hidden = true;
    });

    // Settings
    document.getElementById("cancel-subscription-btn").addEventListener("click", function () {
      document.getElementById("cancel-confirm").hidden = false;
    });
    document.getElementById("cancel-confirm-no").addEventListener("click", function () {
      document.getElementById("cancel-confirm").hidden = true;
    });
    document.getElementById("cancel-confirm-yes").addEventListener("click", function () {
      var billing = profile.billing;
      if (billing && billing.termMonths > 1) {
        var modeInput = document.querySelector('input[name="cancel-refund-mode"]:checked');
        var mode = modeInput ? modeInput.value : "refund";
        if (mode === "credit") {
          profile.accountCredit = (profile.accountCredit || 0) + billing.totalDue;
        }
        // "refund" mode: the prepaid balance goes back to the original payment method — nothing to track locally.
      }
      profile.tier = "free";
      profile.billing = null;
      savePortalProfile(profile);
      document.getElementById("cancel-confirm").hidden = true;
      renderPlanManagement();
    });

    // Upgrade payment modal
    var paymentBackdrop = document.getElementById("payment-modal-backdrop");
    var paymentForm = document.getElementById("payment-modal-form");
    var paymentSuccess = document.getElementById("payment-modal-success");

    document.getElementById("upgrade-plan-btn").addEventListener("click", function () {
      var suggested = (profile.tier || "individual") === "individual" ? "organization" : "individual";
      document.querySelectorAll('input[name="modal-plan"]').forEach(function (input) {
        input.checked = input.value === suggested;
      });
      paymentForm.hidden = false;
      paymentForm.reset();
      document.getElementById("modal-plan-choice-row").hidden = false;
      paymentSuccess.hidden = true;
      paymentBackdrop.classList.add("is-open");
    });

    function closePaymentModal() { paymentBackdrop.classList.remove("is-open"); }
    document.getElementById("payment-modal-close").addEventListener("click", closePaymentModal);
    paymentBackdrop.addEventListener("click", function (e) { if (e.target === paymentBackdrop) closePaymentModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePaymentModal(); });

    paymentForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var chosen = document.querySelector('input[name="modal-plan"]:checked').value;
      var submitBtn = document.getElementById("payment-modal-submit");
      submitBtn.disabled = true;
      submitBtn.textContent = "Processing…";
      setTimeout(function () {
        profile.tier = chosen;
        savePortalProfile(profile);
        paymentForm.hidden = true;
        document.getElementById("modal-plan-choice-row").hidden = true;
        paymentSuccess.hidden = false;
        renderPlanManagement();
        setTimeout(function () {
          closePaymentModal();
          submitBtn.disabled = false;
          submitBtn.textContent = "Confirm & Upgrade";
        }, 1400);
      }, 800);
    });
    document.getElementById("setting-notify-messages").addEventListener("change", function (e) {
      profile.settings.notifyMessages = e.target.checked;
      savePortalProfile(profile);
    });
    document.getElementById("setting-notify-deals").addEventListener("change", function (e) {
      profile.settings.notifyDealBoard = e.target.checked;
      savePortalProfile(profile);
    });
    document.getElementById("setting-show-directory").addEventListener("change", function (e) {
      profile.settings.showInDirectory = e.target.checked;
      savePortalProfile(profile);
    });
    document.getElementById("setting-dm-all").addEventListener("change", function (e) {
      profile.settings.dmFromAllMembers = e.target.checked;
      savePortalProfile(profile);
    });
    document.getElementById("delete-account-btn").addEventListener("click", function () {
      alert("Account deletion isn't available in this preview.");
    });
  });
})();
