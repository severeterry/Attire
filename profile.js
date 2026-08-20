(function () {
  "use strict";

  var sb = window.supabaseClient;
  var profile = null;
  var viewingOther = false;
  var otherName = null;
  var otherListing = null; // static directory member (?member=) — read-only, no real account
  var otherProfile = null; // real Supabase member (?id=) — supports Request Intro

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
    var idBanner = document.getElementById("profile-id-banner");
    if (profile.category) {
      catBadge.textContent = labelForCategory(profile.category);
      catBadge.setAttribute("data-cat", profile.category);
      catBadge.hidden = false;
      if (idBanner) idBanner.setAttribute("data-cat", profile.category);
    } else {
      catBadge.hidden = true;
      if (idBanner) idBanner.removeAttribute("data-cat");
    }

    var boroughBadge = document.getElementById("profile-borough-badge");
    if (profile.borough) {
      boroughBadge.textContent = profile.borough;
      boroughBadge.hidden = false;
    } else {
      boroughBadge.hidden = true;
    }
  }

  // ---- The Exchange posts tab (Supabase-backed) ----

  async function fetchPostsBy(authorId) {
    var res = await sb
      .from("rfp_posts")
      .select("id, post_type, category, scope, budget_range, deadline, body, status, created_at")
      .eq("author_id", authorId)
      .order("created_at", { ascending: false });
    if (res.error) return [];
    return res.data;
  }

  function renderPostsTab(posts) {
    var listEl = document.getElementById("profile-posts-list");
    if (!posts.length) {
      listEl.innerHTML = '<div class="empty-state"><h3>No posts yet</h3><p>Your Exchange listings will show up here.</p></div>';
      return;
    }
    listEl.innerHTML = posts
      .map(function (post) {
        var details = [post.category, post.scope, post.budget_range, post.deadline].filter(Boolean).join(" &middot; ");
        return (
          '<article class="post-card is-exchange">' +
          '<div class="post-type-flag-slot"><span class="post-type-flag post-type-flag--exchange">The Exchange</span></div>' +
          '<div class="post-meta-row"><span>' + relativeTime(new Date(post.created_at).getTime()) + " ago</span></div>" +
          '<p class="post-body">' + escapeHtml(post.body) + "</p>" +
          (details ? '<p class="settings-note">' + details + " &mdash; " + post.status + "</p>" : "") +
          "</article>"
        );
      })
      .join("");
  }

  async function renderStats(authorId) {
    var posts = await fetchPostsBy(authorId);
    document.getElementById("stat-posts").textContent = posts.length;
    document.getElementById("stat-connections").textContent = countConnections(profile.name);
    return posts;
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
    document.getElementById("setting-allow-contact-reveal").checked = profile.allowContactReveal;
    renderPlanManagement();
  }

  function renderPlanManagement() {
    var tier = profile.tier || "individual_affiliate";
    var planNames = { free: "Free Plan", individual_affiliate: "Individual / Affiliate", organization: "Organization Membership" };
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
        : "Cancel your subscription? You'll lose Exchange access, direct messaging, and event invitations at the end of this billing period, and drop to the Free Plan.";
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

  // ---- Request Intro (only shown for a real member viewed via ?id=) ----

  function renderIntroRequestUi() {
    var wrap = document.getElementById("intro-request-wrap");
    var form = document.getElementById("intro-request-form");
    if (!wrap || !form) return;

    var eligible = otherProfile
      && profile.tier && profile.tier !== "free"
      && otherProfile.tier && otherProfile.tier !== "free"
      && otherProfile.introOptIn
      && otherProfile.id !== profile.id;

    wrap.hidden = !eligible;
    form.hidden = true;
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

    var params = new URLSearchParams(window.location.search);
    var idParam = params.get("id");
    var memberParam = params.get("member");

    if (idParam && idParam !== profile.id) {
      viewingOther = true;
      otherProfile = await window.AttireAuth.getPublicProfile(idParam);
      if (otherProfile) {
        otherName = otherProfile.orgName || otherProfile.name || "Member";
        await renderOtherRealProfile();
        sb.from("profile_views").insert({ profile_id: idParam, viewer_id: profile.id });
      } else {
        document.getElementById("topbar-title").textContent = "Member not found";
      }
    } else if (memberParam && memberParam !== profile.name) {
      viewingOther = true;
      otherName = memberParam;
      var listingRes = await sb.from("directory_listings").select("*").eq("name", memberParam).maybeSingle();
      otherListing = listingRes.data ? { category: listingRes.data.category, borough: listingRes.data.borough, description: listingRes.data.description, goodToKnow: listingRes.data.good_to_know } : null;
      renderOtherStaticListing(otherName, otherListing);
    } else {
      await renderOwnProfile();
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

      var requestIntroBtn = document.getElementById("request-intro-btn");
      var introForm = document.getElementById("intro-request-form");
      var introStatus = document.getElementById("intro-request-status");
      var introError = document.getElementById("intro-request-error");

      if (requestIntroBtn && otherProfile) {
        requestIntroBtn.addEventListener("click", function () {
          document.getElementById("intro-request-wrap").hidden = true;
          introForm.hidden = false;
          document.getElementById("intro-request-note").focus();
        });

        introForm.addEventListener("submit", function (e) {
          e.preventDefault();
          var note = document.getElementById("intro-request-note").value.trim();
          if (!note) return;
          introError.hidden = true;
          var submitBtn = introForm.querySelector('button[type="submit"]');
          submitBtn.disabled = true;

          sb.from("intro_requests").insert({
            requestor_id: profile.id,
            requestee_id: otherProfile.id,
            note: note,
          }).then(function (res) {
            submitBtn.disabled = false;
            if (res.error) {
              introError.textContent = res.error.message;
              introError.hidden = false;
              return;
            }
            introForm.hidden = true;
            introStatus.textContent = "Intro request sent.";
            introStatus.hidden = false;
          });
        });
      }

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
        window.AttireAuth.updateProfileFields(profile.id, { avatar_url: profile.avatar });
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
    aboutForm.addEventListener("submit", async function (e) {
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

      await window.AttireAuth.updateProfileFields(profile.id, {
        org_name: profile.orgName, bio: profile.bio, website: profile.website,
        borough: profile.borough, category: profile.category, practices: profile.practices,
      });
      await window.AttireAuth.updateContactFields(profile.id, { email: profile.email });

      renderHeaderInfo();
      renderBodyAvatar(profile.name, profile.category, profile.avatar);
      renderStats(profile.id);
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
    document.getElementById("cancel-confirm-yes").addEventListener("click", async function () {
      var billing = profile.billing;
      var modeInput = document.querySelector('input[name="cancel-refund-mode"]:checked');
      var creditMode = billing && billing.termMonths > 1 && modeInput && modeInput.value === "credit";
      // "refund" mode: the prepaid balance goes back to the original payment method — nothing to track locally.

      var res = await sb.rpc("cancel_membership", { p_credit_mode: !!creditMode });
      if (res.error) {
        window.alert(res.error.message);
        return;
      }

      if (creditMode) profile.accountCredit = (profile.accountCredit || 0) + billing.totalDue;
      profile.tier = "free";
      profile.billing = null;
      document.getElementById("cancel-confirm").hidden = true;
      renderPlanManagement();
    });

    // Upgrade payment modal
    var paymentBackdrop = document.getElementById("payment-modal-backdrop");
    var paymentForm = document.getElementById("payment-modal-form");
    var paymentSuccess = document.getElementById("payment-modal-success");

    document.getElementById("upgrade-plan-btn").addEventListener("click", function () {
      var suggested = (profile.tier || "individual_affiliate") === "individual_affiliate" ? "organization" : "individual_affiliate";
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
        sb.rpc("change_membership_tier", { p_new_tier: chosen, p_billing: profile.billing || null }).then(function (res) {
          if (res.error) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Confirm & Upgrade";
            window.alert(res.error.message);
            return;
          }
          profile.tier = chosen;
          paymentForm.hidden = true;
          document.getElementById("modal-plan-choice-row").hidden = true;
          paymentSuccess.hidden = false;
          renderPlanManagement();
          setTimeout(function () {
            closePaymentModal();
            submitBtn.disabled = false;
            submitBtn.textContent = "Confirm & Upgrade";
          }, 1400);
        });
      }, 800);
    });

    document.getElementById("setting-notify-messages").addEventListener("change", function (e) {
      profile.settings.notifyMessages = e.target.checked;
      window.AttireAuth.updateProfileFields(profile.id, { settings: profile.settings });
    });
    document.getElementById("setting-notify-deals").addEventListener("change", function (e) {
      profile.settings.notifyDealBoard = e.target.checked;
      window.AttireAuth.updateProfileFields(profile.id, { settings: profile.settings });
    });
    document.getElementById("setting-show-directory").addEventListener("change", function (e) {
      profile.settings.showInDirectory = e.target.checked;
      window.AttireAuth.updateProfileFields(profile.id, { settings: profile.settings });
    });
    document.getElementById("setting-dm-all").addEventListener("change", function (e) {
      profile.settings.dmFromAllMembers = e.target.checked;
      window.AttireAuth.updateProfileFields(profile.id, { settings: profile.settings });
    });
    document.getElementById("setting-allow-contact-reveal").addEventListener("change", function (e) {
      profile.allowContactReveal = e.target.checked;
      window.AttireAuth.updateProfileFields(profile.id, { allow_contact_reveal: e.target.checked });
    });
    document.getElementById("delete-account-btn").addEventListener("click", function () {
      alert("Account deletion isn't available in this preview.");
    });
  });

  async function renderOwnProfile() {
    renderBodyAvatar(profile.name, profile.category, profile.avatar);
    renderHeaderInfo();
    var myPosts = await renderStats(profile.id);
    renderPostsTab(myPosts);
    renderAboutView();
    renderSettings();
  }

  // Real Supabase member, viewed via ?id= — supports Request Intro.
  async function renderOtherRealProfile() {
    document.title = otherName + " — Attire Member";
    document.getElementById("topbar-title").textContent = otherName;
    document.getElementById("back-to-feed-link").hidden = false;
    document.getElementById("view-in-directory-btn").hidden = true;
    document.getElementById("edit-profile-btn").hidden = true;
    document.getElementById("avatar-edit-btn").hidden = true;
    document.getElementById("settings-section").hidden = true;
    document.getElementById("field-email").hidden = true;
    document.getElementById("field-website").hidden = true;
    document.getElementById("field-practices").hidden = true;

    renderBodyAvatar(otherName, otherProfile.category, otherProfile.avatar);
    document.getElementById("profile-name").textContent = otherName;
    document.getElementById("profile-org").hidden = true;

    var catBadge = document.getElementById("profile-category-badge");
    var idBanner = document.getElementById("profile-id-banner");
    if (otherProfile.category) {
      catBadge.textContent = labelForCategory(otherProfile.category);
      catBadge.setAttribute("data-cat", otherProfile.category);
      catBadge.hidden = false;
      if (idBanner) idBanner.setAttribute("data-cat", otherProfile.category);
    } else {
      catBadge.hidden = true;
      if (idBanner) idBanner.removeAttribute("data-cat");
    }
    var boroughBadge = document.getElementById("profile-borough-badge");
    if (otherProfile.borough) {
      boroughBadge.textContent = otherProfile.borough;
      boroughBadge.hidden = false;
    } else {
      boroughBadge.hidden = true;
    }

    var theirPosts = await fetchPostsBy(otherProfile.id);
    document.getElementById("stat-posts").textContent = theirPosts.length;
    document.getElementById("stat-connections").textContent = countConnections(otherName);
    renderPostsTab(theirPosts);

    document.getElementById("view-bio").textContent = otherProfile.bio || "No bio yet.";
    document.getElementById("view-borough").textContent = otherProfile.borough || "—";
    document.getElementById("view-category").textContent = labelForCategory(otherProfile.category);

    renderConnectActions(otherName);
    renderIntroRequestUi();
  }

  // Static directory mock listing, viewed via ?member= — read-only, no
  // Request Intro (not a real account).
  function renderOtherStaticListing(name, listing) {
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

    document.getElementById("stat-posts").textContent = 0;
    document.getElementById("stat-connections").textContent = countConnections(name);
    renderPostsTab([]);

    document.getElementById("view-bio").textContent = bio;
    document.getElementById("view-borough").textContent = borough || "—";
    document.getElementById("view-category").textContent = labelForCategory(category);

    renderConnectActions(name);
    var introWrap = document.getElementById("intro-request-wrap");
    if (introWrap) introWrap.hidden = true;
  }
})();
