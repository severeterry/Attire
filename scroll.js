/**
 * Homepage-only scroll polish: inertia/momentum smooth scrolling (Lenis)
 * plus a lightweight scroll-linked parallax on [data-parallax] elements.
 * Fully skipped under prefers-reduced-motion — this is pure feel, nothing
 * here should ever be load-bearing for content or navigation.
 */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  var parallaxEls = Array.prototype.slice.call(document.querySelectorAll("[data-parallax]"));

  function updateParallax() {
    var viewportCenter = window.innerHeight / 2;
    parallaxEls.forEach(function (el) {
      var speed = parseFloat(el.getAttribute("data-parallax")) || 0.06;
      var rect = el.getBoundingClientRect();
      var elCenter = rect.top + rect.height / 2;
      var offset = (viewportCenter - elCenter) * speed;
      el.style.transform = "translate3d(0, " + offset.toFixed(1) + "px, 0)";
    });
  }

  if (typeof Lenis === "undefined") {
    // Smooth-scroll library failed to load (offline, blocked CDN, etc.) —
    // fall back to native scroll, but keep the parallax loop since it only
    // needs scroll position, not Lenis itself.
    if (parallaxEls.length) {
      window.addEventListener("scroll", updateParallax, { passive: true });
      updateParallax();
    }
    return;
  }

  var lenis = new Lenis({
    duration: 1.1,
    easing: function (t) { return 1 - Math.pow(1 - t, 3); },
    smoothWheel: true,
  });

  function raf(time) {
    lenis.raf(time);
    if (parallaxEls.length) updateParallax();
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
})();
