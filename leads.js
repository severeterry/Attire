(function () {
  "use strict";

  var form = document.getElementById("lead-form");
  if (!form) return;

  var sb = window.supabaseClient;
  var errorEl = document.getElementById("lead-error");
  var successEl = document.getElementById("lead-success");
  var submitBtn = document.getElementById("lead-submit-btn");

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    var name = document.getElementById("lead-name").value.trim();
    var email = document.getElementById("lead-email").value.trim();
    var organization = document.getElementById("lead-organization").value.trim();
    var message = document.getElementById("lead-message").value.trim();

    if (!name || !email) {
      errorEl.textContent = "Name and email are required.";
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    var res = await sb.from("leads").insert({
      name: name,
      email: email,
      organization: organization || null,
      message: message || null,
      source: "homepage"
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Send";

    if (res.error) {
      errorEl.textContent = "Something went wrong. Please try again.";
      errorEl.hidden = false;
      return;
    }

    form.reset();
    successEl.hidden = false;
  });
})();
