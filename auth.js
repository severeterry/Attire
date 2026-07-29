/**
 * Client-side auth simulation for the member portal prototype.
 * There is no real backend — credentials are stored in localStorage
 * purely to demo the log in / apply-then-create-account flow.
 */
(function () {
  "use strict";

  var AUTH_KEY = "attire-auth-v1";
  var CREDENTIALS_KEY = "attire-credentials-v1";
  var PROFILE_KEY = "attire-profile-v1";

  var DEFAULT_SETTINGS = { notifyMessages: true, notifyDealBoard: true, showInDirectory: true, dmFromAllMembers: true };

  var DEMO_ACCOUNTS = {
    free_demo: {
      password: "free123",
      profile: {
        name: "Jordan Lee", orgName: "", category: null, borough: "Queens", tier: "free",
        bio: "Just getting started — browsing the directory before applying for full membership.",
        email: "jordan.lee@example.com", website: "", practices: [], avatar: null, memberSince: "2026",
      },
    },
    member_demo: {
      password: "member123",
      profile: {
        name: "Alex Rivera", orgName: "Rivera Studio", category: "strategy", borough: "Brooklyn", tier: "individual",
        bio: "Independent production consultant helping small NYC labels navigate sourcing and compliance.",
        email: "alex@riverastudio.co", website: "riverastudio.co",
        practices: ["Locally made in NYC", "Deadstock / recycled materials"], avatar: null, memberSince: "2026",
      },
    },
    org_demo: {
      password: "org123",
      profile: {
        name: "Sana Torres", orgName: "Torres Textile Co.", category: "materials", borough: "Manhattan", tier: "organization",
        bio: "Small-batch cut-and-sew manufacturer in the Garment District, working mostly with deadstock and organic fibers.",
        email: "sana@torrestextile.co", website: "torrestextile.co",
        practices: ["Locally made in NYC", "Zero-waste pattern cutting", "Deadstock / recycled materials"], avatar: null, memberSince: "2026",
      },
    },
  };

  function getAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { return null; }
  }
  function setAuth(username) {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify({ username: username, loggedIn: true })); } catch (e) {}
  }
  function clearAuth() {
    try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
  }
  function getCredentials() {
    try {
      var raw = localStorage.getItem(CREDENTIALS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }
  function setCredentials(username, password) {
    try { localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ username: username, password: password })); } catch (e) {}
  }
  function saveProfile(full) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(full)); } catch (e) {}
  }

  function applyProfilePreset(preset) {
    saveProfile({
      name: preset.name, orgName: preset.orgName, category: preset.category, borough: preset.borough,
      bio: preset.bio, email: preset.email, website: preset.website, practices: preset.practices,
      avatar: preset.avatar, memberSince: preset.memberSince, tier: preset.tier,
      settings: DEFAULT_SETTINGS,
    });
  }

  // Called once a new applicant has been accepted, chosen a plan/term, and
  // created their login — builds their real profile from the application
  // form plus the billing they just confirmed.
  function createApplicantProfile(fields, billing) {
    billing.startedAt = Date.now();
    saveProfile({
      name: fields.contactName, orgName: fields.orgName, category: fields.category, borough: fields.borough,
      bio: fields.pitch, email: fields.email, website: fields.website, practices: [],
      avatar: null, memberSince: String(new Date().getFullYear()), tier: billing.tier,
      billing: billing,
      settings: DEFAULT_SETTINGS,
    });
  }

  window.AttireAuth = {
    getAuth: getAuth,
    setAuth: setAuth,
    clearAuth: clearAuth,
    getCredentials: getCredentials,
    setCredentials: setCredentials,
    createApplicantProfile: createApplicantProfile,
  };

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll('[data-action="logout"]').forEach(function (link) {
      link.addEventListener("click", function () { clearAuth(); });
    });

    var loginLinks = document.querySelectorAll('[data-action="member-login"]');
    if (!loginLinks.length) return;
    var modalBackdrop = document.getElementById("login-modal-backdrop");

    loginLinks.forEach(function (link) {
      link.addEventListener("click", function (e) {
        var auth = getAuth();
        if (auth && auth.loggedIn) return;
        if (!modalBackdrop) return;
        e.preventDefault();
        openModal();
      });
    });

    if (!modalBackdrop) return;
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
      var username = document.getElementById("login-username").value.trim();
      var password = document.getElementById("login-password").value;

      var demo = DEMO_ACCOUNTS[username];
      if (demo && demo.password === password) {
        applyProfilePreset(demo.profile);
        setAuth(username);
        window.location.href = "member-portal.html";
        return;
      }

      var creds = getCredentials();
      if (creds && username === creds.username && password === creds.password) {
        setAuth(username);
        window.location.href = "member-portal.html";
        return;
      }

      errorEl.hidden = false;
    });
  });
})();
