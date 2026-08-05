(function () {
  "use strict";

  var PRICES = { individual_affiliate: 15, organization: 18 };

  document.addEventListener("DOMContentLoaded", async function () {
    if (!window.AttireAuth) return;
    var session = await window.AttireAuth.getSession();
    if (!session) {
      window.location.href = "index.html";
      return;
    }

    var profile = await window.AttireAuth.getCurrentProfile();
    if (!profile) {
      window.location.href = "index.html";
      return;
    }

    var params = new URLSearchParams(window.location.search);
    var requestedPlan = params.get("plan");

    var planInputs = document.querySelectorAll('input[name="plan"]');
    var amountEl = document.getElementById("pay-amount");

    function selectedPlan() {
      var checked = document.querySelector('input[name="plan"]:checked');
      return checked ? checked.value : "individual_affiliate";
    }

    function updateAmount() {
      amountEl.textContent = "$" + PRICES[selectedPlan()];
    }

    if (requestedPlan === "organization" || requestedPlan === "individual_affiliate") {
      planInputs.forEach(function (input) { input.checked = input.value === requestedPlan; });
    }
    updateAmount();

    planInputs.forEach(function (input) {
      input.addEventListener("change", updateAmount);
    });

    document.getElementById("card-expiry").addEventListener("input", function (e) {
      var v = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
      if (v.length > 2) v = v.slice(0, 2) + "/" + v.slice(2);
      e.target.value = v;
    });
    document.getElementById("card-number").addEventListener("input", function (e) {
      var v = e.target.value.replace(/[^\d]/g, "").slice(0, 16);
      e.target.value = v.replace(/(.{4})/g, "$1 ").trim();
    });

    var form = document.getElementById("payment-form");
    var successPanel = document.getElementById("payment-success");
    var submitBtn = document.getElementById("pay-submit-btn");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var plan = selectedPlan();
      submitBtn.disabled = true;
      submitBtn.textContent = "Processing…";

      setTimeout(function () {
        window.supabaseClient.rpc("change_membership_tier", { p_new_tier: plan, p_billing: profile.billing || null }).then(function (res) {
          if (res.error) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Confirm & Upgrade";
            window.alert(res.error.message);
            return;
          }
          form.hidden = true;
          document.getElementById("plan-choice-card").hidden = true;
          document.getElementById("payment-success-note").textContent =
            "You're now on the " + (plan === "organization" ? "Organization Membership" : "Individual / Affiliate") + " plan. Redirecting to your profile…";
          successPanel.hidden = false;
          setTimeout(function () { window.location.href = "profile.html"; }, 1600);
        });
      }, 900);
    });
  });
})();
