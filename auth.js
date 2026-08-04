/**
 * Real Supabase-backed auth for the member portal.
 *
 * Email confirmation is enabled on the Supabase project, so a brand-new
 * signup doesn't come back with an active session — the profile row can't
 * be created yet (RLS requires auth.uid() = id, and there's no auth.uid()
 * until the user actually confirms and logs in). completeSignup() stashes
 * the submitted application fields in sessionStorage in that case, and
 * resolvePendingProfile() finishes creating the profile on the first
 * successful login afterward, in this same browser.
 */
(function () {
  "use strict";

  var sb = window.supabaseClient;
  var PENDING_PROFILE_KEY = "attire-pending-profile-v1";

  async function getSession() {
    var res = await sb.auth.getSession();
    return res.data.session;
  }

  // Normalizes the DB row (snake_case columns, joined profile_contacts) into
  // the shape the rest of the site already expects (camelCase, flat email/
  // phone) so shell.js/portal.js/profile.js need minimal changes.
  async function getCurrentProfile() {
    var session = await getSession();
    if (!session) return null;
    var res = await sb
      .from("profiles")
      .select("*, profile_contacts(email, phone)")
      .eq("id", session.user.id)
      .maybeSingle();
    if (res.error || !res.data) return null;

    var row = res.data;
    var contact = Array.isArray(row.profile_contacts) ? row.profile_contacts[0] : row.profile_contacts;

    return {
      id: row.id,
      name: row.contact_name,
      orgName: row.org_name,
      category: row.category,
      borough: row.borough,
      bio: row.bio,
      website: row.website,
      tier: row.tier,
      avatar: row.avatar_url,
      memberSince: row.created_at ? String(new Date(row.created_at).getFullYear()) : "",
      billing: row.billing,
      introOptIn: row.intro_opt_in,
      practices: row.practices || [],
      settings: row.settings || {},
      accountCredit: row.account_credit || 0,
      isAdmin: row.is_admin || false,
      email: contact ? contact.email : "",
      phone: contact ? contact.phone : "",
    };
  }

  // Fetches another member's PUBLIC profile fields (no contact info — that's
  // only ever readable via get_accepted_intro_contact()). Used by profile.html
  // when viewing a real member via ?id=.
  async function getPublicProfile(profileId) {
    var res = await sb
      .from("profiles")
      .select("id, org_name, contact_name, category, borough, bio, avatar_url, tier, intro_opt_in")
      .eq("id", profileId)
      .maybeSingle();
    if (res.error || !res.data) return null;
    var row = res.data;
    return {
      id: row.id,
      name: row.contact_name,
      orgName: row.org_name,
      category: row.category,
      borough: row.borough,
      bio: row.bio,
      avatar: row.avatar_url,
      tier: row.tier,
      introOptIn: row.intro_opt_in,
    };
  }

  async function updateProfileFields(userId, patch) {
    var res = await sb.from("profiles").update(patch).eq("id", userId);
    return res.error ? res.error.message : null;
  }

  async function updateContactFields(userId, patch) {
    var res = await sb.from("profile_contacts").update(patch).eq("profile_id", userId);
    return res.error ? res.error.message : null;
  }

  function stashPendingProfile(fields, billing) {
    try { sessionStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify({ fields: fields, billing: billing })); } catch (e) {}
  }

  async function createProfileRow(userId, fields, billing) {
    billing.startedAt = billing.startedAt || Date.now();
    var profileRes = await sb.from("profiles").insert({
      id: userId,
      org_name: fields.orgName,
      contact_name: fields.contactName,
      category: fields.category || null,
      borough: fields.borough,
      bio: fields.pitch,
      website: fields.website,
      tier: billing.tier,
      billing: billing,
      intro_opt_in: !!fields.introOptIn,
    });
    if (profileRes.error) return profileRes.error.message;

    var contactRes = await sb.from("profile_contacts").insert({
      profile_id: userId, email: fields.email, phone: fields.phone || null,
    });
    if (contactRes.error) return contactRes.error.message;
    return null;
  }

  // Call right after supabase.auth.signUp() succeeds.
  async function completeSignup(userId, session, fields, billing) {
    if (session) return await createProfileRow(userId, fields, billing);
    stashPendingProfile(fields, billing);
    return null;
  }

  async function resolvePendingProfile(userId) {
    var raw;
    try { raw = sessionStorage.getItem(PENDING_PROFILE_KEY); } catch (e) { raw = null; }
    if (!raw) return;

    var existing = await sb.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (existing.data) {
      try { sessionStorage.removeItem(PENDING_PROFILE_KEY); } catch (e) {}
      return;
    }

    var pending = JSON.parse(raw);
    await createProfileRow(userId, pending.fields, pending.billing);
    try { sessionStorage.removeItem(PENDING_PROFILE_KEY); } catch (e) {}
  }

  async function signIn(email, password) {
    var res = await sb.auth.signInWithPassword({ email: email, password: password });
    if (res.error) return res.error.message;
    await resolvePendingProfile(res.data.user.id);
    return null;
  }

  async function signOut() {
    await sb.auth.signOut();
  }

  window.AttireAuth = {
    getSession: getSession,
    getCurrentProfile: getCurrentProfile,
    getPublicProfile: getPublicProfile,
    updateProfileFields: updateProfileFields,
    updateContactFields: updateContactFields,
    completeSignup: completeSignup,
    signIn: signIn,
    signOut: signOut,
  };

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll('[data-action="logout"]').forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        var href = link.getAttribute("href") || "index.html";
        signOut().then(function () { window.location.href = href; });
      });
    });

    var loginLinks = document.querySelectorAll('[data-action="member-login"]');
    if (!loginLinks.length) return;
    var modalBackdrop = document.getElementById("login-modal-backdrop");
    if (!modalBackdrop) return;

    loginLinks.forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        getSession().then(function (session) {
          if (session) {
            window.location.href = link.getAttribute("href") || "member-portal.html";
            return;
          }
          openModal();
        });
      });
    });

    var closeBtn = document.getElementById("login-modal-close");
    var form = document.getElementById("login-form");
    var errorEl = document.getElementById("login-error");

    function openModal() {
      modalBackdrop.classList.add("is-open");
      errorEl.hidden = true;
      form.reset();
      document.getElementById("login-username").focus();
    }
    function closeModal() {
      modalBackdrop.classList.remove("is-open");
    }

    closeBtn.addEventListener("click", closeModal);
    modalBackdrop.addEventListener("click", function (e) {
      if (e.target === modalBackdrop) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modalBackdrop.classList.contains("is-open")) closeModal();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("login-username").value.trim();
      var password = document.getElementById("login-password").value;
      var submitBtn = form.querySelector('button[type="submit"]');
      var labelEl = submitBtn.querySelector(".login-submit-label");

      submitBtn.disabled = true;
      if (labelEl) labelEl.textContent = "Logging in…";

      signIn(email, password).then(function (errMsg) {
        submitBtn.disabled = false;
        if (labelEl) labelEl.textContent = "Log In";
        if (errMsg) {
          errorEl.textContent = errMsg;
          errorEl.hidden = false;
          return;
        }
        window.location.href = "member-portal.html";
      });
    });
  });
})();
