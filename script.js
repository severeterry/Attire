(function () {
  "use strict";

  // Mobile nav toggle
  var header = document.getElementById("site-header");
  var toggle = header.querySelector(".nav-toggle");
  var mobileNav = document.getElementById("mobile-nav");

  toggle.addEventListener("click", function () {
    var isOpen = header.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  });

  mobileNav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      header.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
    });
  });

  // Scroll reveal
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealEls = document.querySelectorAll(".reveal");

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { observer.observe(el); });
  }

  // Section fade in/out (home page)
  var fadeSections = document.querySelectorAll(".fade-section");
  if (fadeSections.length && !reduceMotion && "IntersectionObserver" in window) {
    var fadeObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          entry.target.classList.toggle("is-faded", !entry.isIntersecting);
        });
      },
      { threshold: 0.12 }
    );
    fadeSections.forEach(function (el) { fadeObserver.observe(el); });
  }

  // Generic newsletter-style form (kept for any page that includes one)
  var form = document.querySelector(".newsletter-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = form.querySelector("input[type='email']");
      var button = form.querySelector("button");
      var originalLabel = button.textContent;
      button.textContent = "Subscribed!";
      button.disabled = true;
      setTimeout(function () {
        button.textContent = originalLabel;
        button.disabled = false;
        if (input) input.value = "";
      }, 2200);
    });
  }
})();
