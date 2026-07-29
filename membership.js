(function () {
  "use strict";

  var FREE_MONTHS = 6;
  var PLAN_RATES = {
    individual: { 1: 15, 6: 14, 12: 12, 18: 11, 24: 10 },
    organization: { 1: 18, 6: 16, 12: 14, 18: 13, 24: 12 },
  };
  var PLAN_LABELS = { individual: "Individual / Affiliate", organization: "Organization Membership" };

  var form = document.getElementById("membership-form");
  var success = document.getElementById("form-success");
  var planSetup = document.getElementById("plan-setup");
  var accountSetup = document.getElementById("account-setup");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    form.hidden = true;
    success.classList.add("is-visible");
    success.setAttribute("tabindex", "-1");
    success.focus();

    if (planSetup) {
      setTimeout(function () {
        success.classList.remove("is-visible");
        planSetup.classList.add("is-visible");
        planSetup.setAttribute("tabindex", "-1");
        planSetup.focus();
      }, 1400);
    }
  });

  // ---- Plan + billing-term selection ----
  var pendingBilling = null;

  if (planSetup) {
    var planInputs = planSetup.querySelectorAll('input[name="signup-plan"]');
    var termInputs = planSetup.querySelectorAll('input[name="signup-term"]');
    var summaryBox = document.getElementById("plan-summary-box");

    function selectedPlan() {
      var checked = planSetup.querySelector('input[name="signup-plan"]:checked');
      return checked ? checked.value : "individual";
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

  credentialsForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var username = document.getElementById("new-username").value.trim();
    var password = document.getElementById("new-password").value;
    var confirm = document.getElementById("confirm-password").value;

    if (password !== confirm) {
      errorEl.textContent = "Passwords don't match.";
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;

    if (window.AttireAuth) {
      window.AttireAuth.setCredentials(username, password);
      window.AttireAuth.createApplicantProfile(
        {
          orgName: (document.getElementById("org-name") || {}).value || "",
          contactName: (document.getElementById("contact-name") || {}).value || "",
          category: (document.getElementById("category") || {}).value || null,
          borough: (document.getElementById("borough") || {}).value || "",
          email: (document.getElementById("email") || {}).value || "",
          website: (document.getElementById("website") || {}).value || "",
          pitch: (document.getElementById("pitch") || {}).value || "",
        },
        pendingBilling || { tier: "individual", tierLabel: PLAN_LABELS.individual, termMonths: 1, monthlyRate: PLAN_RATES.individual[1], totalDue: PLAN_RATES.individual[1], freeMonths: FREE_MONTHS, status: "trial" }
      );
      window.AttireAuth.setAuth(username);
    }
    window.location.href = "member-portal.html";
  });
})();
