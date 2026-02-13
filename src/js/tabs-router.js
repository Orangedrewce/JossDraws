// =============================================================================
// TABS ROUTER — Single-page tab navigation via hidden radio inputs
// =============================================================================
// Phase 1 of the app lifecycle. Runs at DOMContentLoaded, selects the
// initial tab from the URL hash (with fuzzy matching), wires nav labels
// and [data-tab-target] links, and manages browser history (pushState /
// hashchange). Updates ARIA selected state on every switch.
//
// After the initial tab is stable, broadcasts `tabs:ready` on window so
// downstream modules (carousel, decorative loaders, shop) can safely
// attach radio-change listeners without missing the first activation.
//
// Guard: double-init protected via window.__tabsRouterActive.
// =============================================================================

(function () {
  if (window.__tabsRouterActive) return;
  window.__tabsRouterActive = true;
  window.__tabsRouterPreferred = true;

  const TAB_NAMES = ["home", "gallery", "about", "shop", "contact", "reviews"];
  const idFor = (name) => `tab-${name}`;

  function pickTabFromHash() {
    const raw = (location.hash || "").replace(/^#/, "").toLowerCase();
    if (!raw) return "home";
    // direct match: #gallery, #about, etc
    if (TAB_NAMES.includes(raw)) return raw;
    // allow #tab-gallery
    if (raw.startsWith("tab-")) {
      const n = raw.slice(4);
      if (TAB_NAMES.includes(n)) return n;
    }
    // fuzzy: #gallery-heading, #go-to-gallery, etc
    for (const n of TAB_NAMES) {
      if (raw.includes(n)) return n;
    }
    return "home";
  }

  function setChecked(id) {
    const input = document.getElementById(id);
    if (!input) return false;
    if (!input.checked) {
      input.checked = true;
      // inform listeners (e.g., gallery initializer)
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }

  function updateAriaSelected(activeTabName) {
    TAB_NAMES.forEach((name) => {
      const label = document.querySelector(`label[for="${idFor(name)}"]`);
      if (label) {
        label.setAttribute('aria-selected', name === activeTabName ? 'true' : 'false');
      }
    });
  }

  function selectTab(name, opts = {}) {
    const { replace = false, scroll = false } = opts;
    const ok = setChecked(idFor(name));
    if (!ok) return;

    // Update ARIA selected state
    updateAriaSelected(name);

    const newHash = `#${name}`;
    try {
      if (replace) {
        history.replaceState(null, "", newHash);
      } else if (location.hash !== newHash) {
        history.pushState(null, "", newHash);
      }
    } catch (_) {
      // ignore history errors (e.g., file://)
      location.hash = newHash;
    }

    if (scroll) {
      // focus section heading when available
      const heading = document.getElementById(`${name}-heading`);
      if (heading && typeof heading.focus === "function") heading.focus();
      const section = document.querySelector(`.tab-${name}`);
      if (section && typeof section.scrollIntoView === "function") {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  function wireNavLabels() {
    TAB_NAMES.forEach((name) => {
      const label = document.querySelector(`label[for="${idFor(name)}"]`);
      if (!label) return;
      label.addEventListener("click", () => {
        // Let the radio toggle first, then sync the hash
        setTimeout(() => selectTab(name), 0);
      });
      label.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          setTimeout(() => selectTab(name), 0);
        }
      });
    });
  }

  function wireDataTabLinks() {
    document.querySelectorAll("[data-tab-target]").forEach((el) => {
      el.addEventListener("click", (e) => {
        const target = (el.getAttribute("data-tab-target") || "").toLowerCase();
        if (TAB_NAMES.includes(target)) {
          e.preventDefault();
          selectTab(target, { scroll: true });
        }
      });
    });
  }

  function init() {
    const ua = navigator.userAgent || '';
    const isEdge = /Edg\//.test(ua);
    const isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua);
    const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua);

    // Scroll restoration handling for Chrome, Edge, and Safari
    if (isChrome || isEdge || isSafari) {
      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }
      // Use double RAF to ensure scroll happens after layout
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        });
      });
    }

    // Initial selection (support deep links)
    const initial = pickTabFromHash();
    selectTab(initial, { replace: true, scroll: false });

    wireNavLabels();
    wireDataTabLinks();

    // Back/forward support
    window.addEventListener("hashchange", () => {
      const next = pickTabFromHash();
      selectTab(next, { replace: true, scroll: false });
    });

    // Signal to other modules that tab state is stable
    window.__tabsReady = true;
    window.dispatchEvent(new Event("tabs:ready"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();