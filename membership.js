(function () {
  "use strict";

  var FREE_MONTHS = 6;
  var FOUNDING_COHORT_YEARS = 2;
  var PLAN_RATES = {
    individual_affiliate: { 1: 15, 6: 14, 12: 12, 18: 11, 24: 10 },
    organization: { 1: 18, 6: 16, 12: 14, 18: 13, 24: 12 },
  };
  var PLAN_LABELS = { individual_affiliate: "Individual / Affiliate", organization: "Organization Membership" };

  var form = document.getElementById("membership-form");
  var success = document.getElementById("form-success");
  var planSetup = document.getElementById("plan-setup");
  var accountSetup = document.getElementById("account-setup");
  if (!form) return;

  var sb = window.supabaseClient;
  var approvedApplication = null; // populated once a "check status" lookup finds an approved application

  var formError = document.getElementById("membership-form-error");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (formError) formError.hidden = true;

    var payload = {
      org_name: document.getElementById("org-name").value.trim(),
      contact_name: document.getElementById("contact-name").value.trim(),
      email: document.getElementById("email").value.trim(),
      website: document.getElementById("website").value.trim() || null,
      category: document.getElementById("category").value,
      borough: document.getElementById("borough").value || null,
      pitch: document.getElementById("pitch").value.trim(),
    };

    var submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    sb.from("membership_applications").insert(payload).then(function (res) {
      submitBtn.disabled = false;
      if (res.error) {
        if (formError) {
          formError.textContent = res.error.message;
          formError.hidden = false;
        }
        return;
      }
      form.hidden = true;
      success.classList.add("is-visible");
      success.setAttribute("tabindex", "-1");
      success.focus();
    });
  });

  // ---- Plan + billing-term selection ----
  var pendingBilling = null;

  if (planSetup) {
    var planInputs = planSetup.querySelectorAll('input[name="signup-plan"]');
    var termInputs = planSetup.querySelectorAll('input[name="signup-term"]');
    var summaryBox = document.getElementById("plan-summary-box");

    function selectedPlan() {
      var checked = planSetup.querySelector('input[name="signup-plan"]:checked');
      return checked ? checked.value : "individual_affiliate";
    }
    function selectedTerm() {
      var checked = planSetup.querySelector('input[name="signup-term"]:checked');
      return checked ? parseInt(checked.value, 10) : 1;
    }

    function updatePlanUI() {
      var plan = selectedPlan();
      var term = selectedTerm();
      var rates = PLAN_RATES[plan];
      var rate = rates[term];
      var total = rate * term;
      var monthToMonth = rates[1];

      termInputs.forEach(function (input) {
        var t = parseInt(input.value, 10);
        var rateEl = input.closest(".term-choice").querySelector(".term-choice-rate");
        rateEl.innerHTML = "$" + rates[t] + "<small>/mo</small>";
      });

      if (summaryBox) {
        var afterFree = term === 1
          ? "then $" + rate + "/month, billed monthly."
          : "then $" + rate + "/month for " + term + " months ($" + total + " total).";
        var savePct = Math.round((1 - rate / monthToMonth) * 100);
        var saveNote = savePct > 0
          ? "That's " + savePct + "% off the month-to-month rate."
          : "Cancel anytime after your free period.";
        summaryBox.innerHTML =
          "Free for your first " + FREE_MONTHS + " months &mdash; " + afterFree +
          '<span class="plan-summary-sub">' + saveNote + "</span>";
      }
    }

    planInputs.forEach(function (input) { input.addEventListener("change", updatePlanUI); });
    termInputs.forEach(function (input) { input.addEventListener("change", updatePlanUI); });
    updatePlanUI();

    var paymentForm = document.getElementById("signup-payment-form");
    if (paymentForm) {
      paymentForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var plan = selectedPlan();
        var term = selectedTerm();
        var rate = PLAN_RATES[plan][term];
        pendingBilling = {
          tier: plan, tierLabel: PLAN_LABELS[plan], termMonths: term,
          monthlyRate: rate, totalDue: rate * term,
          freeMonths: FREE_MONTHS, status: "trial",
        };

        planSetup.classList.remove("is-visible");
        if (accountSetup) {
          accountSetup.classList.add("is-visible");
          accountSetup.setAttribute("tabindex", "-1");
          accountSetup.focus();
        }
      });
    }
  }

  // ---- Account credentials ----
  var credentialsForm = document.getElementById("credentials-form");
  if (!credentialsForm) return;
  var errorEl = document.getElementById("credentials-error");
  var checkEmailPanel = document.getElementById("check-email");

  credentialsForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var password = document.getElementById("new-password").value;
    var confirm = document.getElementById("confirm-password").value;

    if (password !== confirm) {
      errorEl.textContent = "Passwords don't match.";
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;

    if (!approvedApplication) return; // shouldn't be reachable — this step only shows after an approved lookup
    var fields = {
      orgName: approvedApplication.org_name || "",
      contactName: approvedApplication.contact_name || "",
      category: approvedApplication.category || null,
      borough: approvedApplication.borough || "",
      email: approvedApplication.email || "",
      website: approvedApplication.website || "",
      pitch: approvedApplication.pitch || "",
    };
    var billing = pendingBilling || {
      tier: "individual_affiliate", tierLabel: PLAN_LABELS.individual_affiliate, termMonths: 1,
      monthlyRate: PLAN_RATES.individual_affiliate[1], totalDue: PLAN_RATES.individual_affiliate[1],
      freeMonths: FREE_MONTHS, status: "trial",
    };

    var isFoundingCohort = !!(approvedApplication && approvedApplication.is_founding_cohort);
    var freeUntilDate = new Date();
    if (isFoundingCohort) {
      freeUntilDate.setFullYear(freeUntilDate.getFullYear() + FOUNDING_COHORT_YEARS);
      billing.freeMonths = FOUNDING_COHORT_YEARS * 12;
    } else {
      freeUntilDate.setMonth(freeUntilDate.getMonth() + FREE_MONTHS);
    }
    var freeUntil = freeUntilDate.toISOString();

    if (!window.AttireAuth || !window.supabaseClient) return;

    var submitBtn = credentialsForm.querySelector('button[type="submit"]');
    var labelEl = submitBtn.querySelector(".signup-submit-label");
    submitBtn.disabled = true;
    if (labelEl) labelEl.textContent = "Creating account…";

    function resetButton() {
      submitBtn.disabled = false;
      if (labelEl) labelEl.textContent = "Create Account & Enter Portal";
    }

    window.supabaseClient.auth.signUp({ email: fields.email, password: password }).then(function (res) {
      if (res.error) {
        resetButton();
        errorEl.textContent = res.error.message;
        errorEl.hidden = false;
        return;
      }

      var userId = res.data.user.id;
      var session = res.data.session;

      window.AttireAuth.completeSignup(userId, session, fields, billing, freeUntil, isFoundingCohort).then(function (profileErr) {
        resetButton();

        if (profileErr) {
          errorEl.textContent = profileErr;
          errorEl.hidden = false;
          return;
        }

        if (approvedApplication) {
          sb.rpc("mark_application_converted", { p_application_id: approvedApplication.id });
        }

        if (session) {
          window.location.href = "member-portal.html";
          return;
        }

        accountSetup.classList.remove("is-visible");
        if (checkEmailPanel) {
          checkEmailPanel.classList.add("is-visible");
          checkEmailPanel.setAttribute("tabindex", "-1");
          checkEmailPanel.focus();
        }
      });
    });
  });

  // ---- Check application status (resumes an approved application) ----
  var statusForm = document.getElementById("status-check-form");
  if (statusForm) {
    var statusResult = document.getElementById("status-check-result");

    statusForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("status-check-email").value.trim();
      if (!email) return;
      statusResult.hidden = true;

      var submitBtn = statusForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      sb.rpc("check_application_status", { p_email: email }).then(function (res) {
        submitBtn.disabled = false;

        if (res.error || !res.data || !res.data.length) {
          statusResult.textContent = "We couldn't find an application for that email.";
          statusResult.hidden = false;
          return;
        }
        var status = res.data[0].status;

        if (status === "pending") {
          statusResult.textContent = "Still under review — we'll follow up by email as soon as there's an update.";
          statusResult.hidden = false;
          return;
        }
        if (status === "rejected") {
          statusResult.textContent = "Thanks for your interest — we don't have a place for this application right now.";
          statusResult.hidden = false;
          return;
        }

        // approved — fetch the saved fields and resume straight into plan setup
        sb.rpc("get_approved_application", { p_email: email }).then(function (appRes) {
          if (appRes.error || !appRes.data || !appRes.data.length) {
            statusResult.textContent = "This application was approved but couldn't be loaded — contact us directly.";
            statusResult.hidden = false;
            return;
          }
          approvedApplication = appRes.data[0];
          statusForm.closest(".form-card").hidden = true;
          if (form) form.hidden = true;
          success.classList.remove("is-visible");
          if (planSetup) {
            planSetup.classList.add("is-visible");
            planSetup.setAttribute("tabindex", "-1");
            planSetup.focus();
          }
        });
      });
    });
  }
})();
