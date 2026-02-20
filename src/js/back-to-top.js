// =============================================================================
// BACK TO TOP — Floating action button, scroll-position driven
// =============================================================================
// Self-contained IIFE. No external CSS required.
//
//   • Injects a #backToTop button + scoped <style> block into the DOM.
//   • Tracks scroll position via requestAnimationFrame (no scroll listener
//     thrash; reads scrollY at most once per animation frame while visible).
//   • Shows the button when window.scrollY > THRESHOLD (1000 px).
//   • Smooth-scrolls to top on click.
//   • Respects prefers-reduced-motion: skips smooth scroll when active.
// =============================================================================

(function () {
  "use strict";

  var THRESHOLD = 1000; // px — show button after scrolling this far
  var BTN_ID    = "backToTop";

  // ---------------------------------------------------------------------------
  // 1. Inject scoped styles — uses site CSS custom properties where available
  // ---------------------------------------------------------------------------
  var style = document.createElement("style");
  style.textContent = [
    "#" + BTN_ID + " {",
    "  position: fixed;",
    "  bottom: 2rem;",
    "  right: 2rem;",
    "  z-index: 900;",
    "  width: 2.75rem;",
    "  height: 2.75rem;",
    "  border-radius: 50%;",
    "  border: none;",
    "  cursor: pointer;",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: center;",
    "  background-color: var(--color-text, #000);",
    "  color: var(--color-bg, #fff);",
    "  box-shadow: 0 4px 12px var(--color-shadow, rgba(0,0,0,0.18));",
    "  opacity: 0;",
    "  transform: translateY(0.75rem);",
    "  transition: opacity 0.25s ease, transform 0.25s ease;",
    "  pointer-events: none;",
    "  -webkit-tap-highlight-color: transparent;",
    "}",
    "#" + BTN_ID + ".btt-visible {",
    "  opacity: 0.82;",
    "  transform: translateY(0);",
    "  pointer-events: auto;",
    "}",
    "#" + BTN_ID + ":hover,",
    "#" + BTN_ID + ":focus-visible {",
    "  opacity: 1;",
    "  outline: 2px solid var(--color-text, #000);",
    "  outline-offset: 3px;",
    "}",
    "#" + BTN_ID + " svg {",
    "  display: block;",
    "  width: 1.1rem;",
    "  height: 1.1rem;",
    "  stroke: currentColor;",
    "  fill: none;",
    "  stroke-width: 2.5;",
    "  stroke-linecap: round;",
    "  stroke-linejoin: round;",
    "}",
  ].join("\n");
  document.head.appendChild(style);

  // ---------------------------------------------------------------------------
  // 2. Build the button element
  // ---------------------------------------------------------------------------
  var btn = document.createElement("button");
  btn.id            = BTN_ID;
  btn.type          = "button";
  btn.setAttribute("aria-label", "Back to top");
  btn.setAttribute("title", "Back to top");
  // Chevron-up SVG (inline — zero external requests)
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<polyline points="18 15 12 9 6 15"></polyline>' +
    "</svg>";

  // Append to body as late as possible to avoid layout thrash during parsing
  function attachBtn() {
    document.body.appendChild(btn);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachBtn);
  } else {
    attachBtn();
  }

  // ---------------------------------------------------------------------------
  // 3. Scroll tracking — rAF-throttled, runs only while page is alive
  // ---------------------------------------------------------------------------
  var visible    = false;
  var rafPending = false;

  function checkScroll() {
    rafPending = false;
    var past = window.scrollY > THRESHOLD;
    if (past !== visible) {
      visible = past;
      if (visible) {
        btn.classList.add("btt-visible");
      } else {
        btn.classList.remove("btt-visible");
      }
    }
    // Re-queue only if the page can still scroll (avoids idle rAF cost)
    if (document.documentElement.scrollHeight > window.innerHeight) {
      rafPending = true;
      requestAnimationFrame(checkScroll);
    }
  }

  // Kick off the loop once the layout is ready
  function startLoop() {
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(checkScroll);
    }
  }

  // Resume loop on scroll (handles the case where the loop idled out)
  window.addEventListener("scroll", startLoop, { passive: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startLoop);
  } else {
    startLoop();
  }

  // ---------------------------------------------------------------------------
  // 4. Click — smooth scroll to top (respects prefers-reduced-motion)
  // ---------------------------------------------------------------------------
  btn.addEventListener("click", function () {
    var reducedMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    window.scrollTo({
      top: 0,
      behavior: reducedMotion ? "instant" : "smooth",
    });

    // Return focus to the top of the page for keyboard / screen-reader users
    var firstFocusable = document.querySelector(
      'a[href], button, input, [tabindex]:not([tabindex="-1"])'
    );
    if (firstFocusable) {
      firstFocusable.focus({ preventScroll: true });
    }
  });
})();
