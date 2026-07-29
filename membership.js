(function () {
  "use strict";

  var form = document.getElementById("membership-form");
  var success = document.getElementById("form-success");
  var accountSetup = document.getElementById("account-setup");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    form.hidden = true;
    success.classList.add("is-visible");
    success.setAttribute("tabindex", "-1");
    success.focus();

    if (accountSetup) {
      setTimeout(function () {
        success.classList.remove("is-visible");
        accountSetup.classList.add("is-visible");
        accountSetup.setAttribute("tabindex", "-1");
        accountSetup.focus();
      }, 1400);
    }
  });

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
      window.AttireAuth.setAuth(username);
    }
    window.location.href = "member-portal.html";
  });
})();
