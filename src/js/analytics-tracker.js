// =============================================================================
// ANALYTICS TRACKER — Privacy-focused event collection for JossDraws.com
// =============================================================================
// Lightweight, non-blocking tracker that captures:
//   1. Page views & tab navigation (via tabs-router change events)
//   2. Gallery engagement (dwell time per artwork via IntersectionObserver)
//   3. Shop impressions & Etsy click-throughs
//   4. User journey funnel steps (landing → gallery → shop → etsy_click)
//
// Privacy: No cookies, no fingerprinting, no PII. Session IDs are random
//          UUIDs regenerated per visit. Referrer is stripped to domain only.
//          All data auto-purges after 90 days server-side.
//
// Boot: Self-initialising IIFE. Waits for Supabase client, then attaches
//       listeners. Uses requestIdleCallback / setTimeout for zero-impact
//       event batching.
// =============================================================================

(function () {
  "use strict";

  // ---- Config ----
  var SUPABASE_URL = "https://pciubbwphwpnptgawgok.supabase.co";
  var SUPABASE_KEY = "sb_publishable_jz1pWpo7TDvURxQ8cqP06A_xc4ckSwv";
  var BATCH_INTERVAL = 5000; // flush event queue every 5s
  var DWELL_THRESHOLD = 1000; // minimum ms to count as meaningful dwell
  var DEBUG = false;

  // ---- State ----
  var sessionId = generateSessionId();
  var db = null;
  var currentTab = "home";
  var tabEnteredAt = Date.now();
  var journeyStep = 0;
  var eventQueue = [];
  var flushTimer = null;

  // Gallery dwell tracking — cumulative across scroll-in/out cycles
  var galleryDwellTimers = {}; // itemId → { startTime, totalMs, visible, lastSentMs }
  var galleryObserver = null;
  var galleryMutObs = null;
  var DWELL_REPORT_INTERVAL = 5000; // re-report dwell every 5s of new accumulated time

  // Shop impression tracking
  var shopObservedIds = {};
  var shopObserver = null;
  var shopMutObs = null;

  // ---- Helpers ----

  function generateSessionId() {
    // Crypto-random UUID (no fingerprinting)
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    // Fallback
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        var r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      },
    );
  }

  function getDeviceType() {
    var w = window.innerWidth;
    if (w <= 768) return "mobile";
    if (w <= 1024) return "tablet";
    return "desktop";
  }

  function getReferrerDomain() {
    try {
      if (!document.referrer) return "";
      var url = new URL(document.referrer);
      // Same-site referrer → treat as direct
      if (url.hostname === location.hostname) return "";
      // Strip to top-level domain
      var host = url.hostname.replace(/^www\./, "");
      // Simplify known sources
      if (host.includes("instagram")) return "instagram.com";
      if (host.includes("facebook") || host.includes("fb.com"))
        return "facebook.com";
      if (host.includes("google")) return "google.com";
      if (host.includes("pinterest")) return "pinterest.com";
      if (host.includes("tiktok")) return "tiktok.com";
      if (host.includes("twitter") || host.includes("x.com")) return "x.com";
      if (host.includes("etsy")) return "etsy.com";
      return host;
    } catch (_) {
      return "";
    }
  }

  function log() {
    if (DEBUG) {
      var args = ["[Analytics]"].concat(Array.prototype.slice.call(arguments));
      console.log.apply(console, args);
    }
  }

  // ---- Event Queue & Batching ----

  function enqueue(rpcName, params) {
    eventQueue.push({ rpc: rpcName, params: params });
    if (!flushTimer) {
      flushTimer = setTimeout(flush, BATCH_INTERVAL);
    }
  }

  function flush(useKeepAlive) {
    flushTimer = null;
    if (!db || eventQueue.length === 0) return;

    var batch = eventQueue.splice(0, eventQueue.length);
    log("Flushing", batch.length, "events", useKeepAlive ? "(keepalive)" : "");

    if (useKeepAlive) {
      // Use fetch + keepalive for unload paths — survives page close
      var headers = {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
      };
      batch.forEach(function (evt) {
        var url = SUPABASE_URL + "/rest/v1/rpc/" + evt.rpc;
        try {
          fetch(url, {
            method: "POST",
            keepalive: true,
            headers: headers,
            body: JSON.stringify(evt.params),
          });
        } catch (_) {
          // Fallback: sendBeacon if fetch throws (e.g. keepalive budget exceeded)
          if (navigator.sendBeacon) {
            var blob = new Blob([JSON.stringify(evt.params)], {
              type: "application/json",
            });
            navigator.sendBeacon(
              url + "?apikey=" + encodeURIComponent(SUPABASE_KEY),
              blob,
            );
          }
        }
      });
      return;
    }

    batch.forEach(function (evt) {
      db.rpc(evt.rpc, evt.params)
        .then(function (response) {
          // Supabase resolves even on DB errors — check response.error
          if (response && response.error) {
            log("RPC error:", evt.rpc, response.error);
          }
        })
        .catch(function (err) {
          log("Network error:", evt.rpc, err);
        });
    });
  }

  // ---- 1. Page View Tracking ----

  function recordPageView(pageName, duration) {
    enqueue("record_page_view", {
      p_session_id: sessionId,
      p_page_name: pageName,
      p_referrer: getReferrerDomain(),
      p_device_type: getDeviceType(),
      p_duration_s: Math.round(((duration || 0) / 1000) * 10) / 10,
    });
  }

  function recordTabSwitch(newTab) {
    // Record duration on the previous tab
    var now = Date.now();
    var duration = now - tabEnteredAt;
    if (duration > 500) {
      // Only record if they spent > 500ms
      recordPageView(currentTab, duration);
    }

    currentTab = newTab;
    tabEnteredAt = now;

    // Record journey step
    recordJourneyStep(newTab);
  }

  // ---- 2. Journey Funnel Tracking ----

  function recordJourneyStep(stepName) {
    // Normalise step names
    var step = stepName;
    if (step === "home") step = "landing";

    // Record every visit (including return visits) for accurate Sankey flow
    journeyStep++;

    enqueue("record_journey_step", {
      p_session_id: sessionId,
      p_step_name: step,
      p_step_order: journeyStep,
    });
    log("Journey step:", step, "#" + journeyStep);
  }

  // ---- 3. Gallery Dwell Time Tracking ----

  function initGalleryTracking() {
    var container = document.getElementById("masonry-gallery");
    if (!container) {
      log("Gallery grid not found, retrying...");
      return;
    }

    if (!window.IntersectionObserver) return;

    // Disconnect previous observers to prevent duplicate counting on re-entry
    if (galleryObserver) {
      galleryObserver.disconnect();
      galleryObserver = null;
    }
    if (galleryMutObs) {
      galleryMutObs.disconnect();
      galleryMutObs = null;
    }
    // Reset flags so items get re-observed by the fresh observer
    var stale = container.querySelectorAll("[data-key]");
    stale.forEach(function (el) { el._analyticsObserved = false; });

    galleryObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var el = entry.target;
          var itemId = el.dataset.key || el.dataset.galleryItemId;
          if (!itemId) return;

          if (entry.isIntersecting) {
            // Item became visible (or re-entered viewport)
            if (!galleryDwellTimers[itemId]) {
              galleryDwellTimers[itemId] = {
                startTime: Date.now(),
                totalMs: 0,
                visible: true,
                lastSentMs: 0,
              };
            } else {
              galleryDwellTimers[itemId].startTime = Date.now();
              galleryDwellTimers[itemId].visible = true;
            }
          } else {
            // Item left viewport — accumulate dwell and maybe report
            var timer = galleryDwellTimers[itemId];
            if (timer && timer.visible) {
              timer.totalMs += Date.now() - timer.startTime;
              timer.visible = false;
              maybeSendDwell(itemId, timer);
            }
          }
        });
      },
      {
        threshold: [0.3], // 30% visible counts as "viewing"
      },
    );

    // Helper: send a dwell event when enough NEW time has accumulated
    function maybeSendDwell(itemId, timer) {
      var newMs = timer.totalMs - timer.lastSentMs;
      if (timer.totalMs >= DWELL_THRESHOLD && newMs >= DWELL_THRESHOLD) {
        timer.lastSentMs = timer.totalMs;
        enqueue("record_gallery_event", {
          p_session_id: sessionId,
          p_gallery_item_id: safeId(itemId),
          p_event_type: "dwell",
          p_dwell_ms: Math.round(timer.totalMs),
        });
        log("Gallery dwell:", itemId, timer.totalMs + "ms");
      }
    }

    // Observe existing items
    observeGalleryItems(container);

    // Watch for new items added dynamically (MasonryGallery adds items on scroll)
    galleryMutObs = new MutationObserver(function () {
      observeGalleryItems(container);
    });
    galleryMutObs.observe(container, { childList: true, subtree: true });
  }

  function observeGalleryItems(container) {
    var items = container.querySelectorAll("[data-key]");
    items.forEach(function (el) {
      if (!el._analyticsObserved) {
        el._analyticsObserved = true;
        galleryObserver.observe(el);
      }

      // Attach click listener once (separate flag — survives observer resets)
      if (!el._clickObserved) {
        el._clickObserved = true;
        el.addEventListener("click", function onGalleryClick() {
          var itemId = el.dataset.key;
          if (!itemId) return;
          enqueue("record_gallery_event", {
            p_session_id: sessionId,
            p_gallery_item_id: safeId(itemId),
            p_event_type: "focus",
            p_dwell_ms: 0,
          });
        });
      }
    });
  }

  // Safe ID — pass through as string; Supabase handles coercion to BIGINT.
  // Avoids parseInt precision loss on large PostgreSQL BIGINT values.
  function safeId(id) {
    return id ? String(id) : null;
  }

  // Flush gallery dwell on page unload — sends any unsent accumulated time
  function flushGalleryDwell() {
    var now = Date.now();
    Object.keys(galleryDwellTimers).forEach(function (itemId) {
      var timer = galleryDwellTimers[itemId];
      if (timer.visible) {
        timer.totalMs += now - timer.startTime;
        timer.visible = false;
      }
      var newMs = timer.totalMs - timer.lastSentMs;
      if (timer.totalMs >= DWELL_THRESHOLD && newMs >= DWELL_THRESHOLD) {
        timer.lastSentMs = timer.totalMs;
        enqueue("record_gallery_event", {
          p_session_id: sessionId,
          p_gallery_item_id: safeId(itemId),
          p_event_type: "dwell",
          p_dwell_ms: Math.round(timer.totalMs),
        });
      }
    });
  }

  // ---- 4. Shop Impression & Click Tracking ----

  function initShopTracking() {
    var grid = document.getElementById("shop-grid");
    if (!grid) {
      log("Shop grid not found, retrying...");
      return;
    }

    if (!window.IntersectionObserver) return;

    // Disconnect previous observers to prevent duplicate counting on re-entry
    if (shopObserver) {
      shopObserver.disconnect();
      shopObserver = null;
    }
    if (shopMutObs) {
      shopMutObs.disconnect();
      shopMutObs = null;
    }
    // Reset flags + impression tracking for fresh observation
    shopObservedIds = {};
    var stale = grid.querySelectorAll("[data-shop-item-id]");
    stale.forEach(function (card) { card._analyticsObserved = false; });

    shopObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var card = entry.target;
          var itemId = card.dataset.shopItemId;
          if (!itemId || shopObservedIds[itemId]) return;

          shopObservedIds[itemId] = true;
          enqueue("record_shop_event", {
            p_session_id: sessionId,
            p_shop_item_id: safeId(itemId),
            p_event_type: "impression",
          });
          log("Shop impression:", itemId);
        });
      },
      {
        threshold: [0.5],
      },
    );

    observeShopItems(grid);

    shopMutObs = new MutationObserver(function () {
      observeShopItems(grid);
    });
    shopMutObs.observe(grid, { childList: true, subtree: true });

    // Re-observe visible cards after shop-renderer paginates (attach once)
    if (!grid._shopPageListenerAttached) {
      grid._shopPageListenerAttached = true;
      grid.addEventListener("shop-page-change", function () {
        if (!shopObserver) return;
        var cards = grid.querySelectorAll("[data-shop-item-id]");
        cards.forEach(function (card) {
          if (card.style.display !== "none") {
            shopObserver.unobserve(card);
            shopObserver.observe(card);
          }
        });
      });
    }
  }

  function observeShopItems(grid) {
    var cards = grid.querySelectorAll("[data-shop-item-id]");
    cards.forEach(function (card) {
      if (!card._analyticsObserved) {
        card._analyticsObserved = true;
        shopObserver.observe(card);
      }

      // Attach click listeners once (separate flag — survives observer resets)
      if (!card._clickObserved) {
        card._clickObserved = true;
        var etsyLinks = card.querySelectorAll('a.btn[target="_blank"]');
        etsyLinks.forEach(function (link) {
          link.addEventListener("click", function () {
            var itemId = card.dataset.shopItemId;
            if (!itemId) return;
            enqueue("record_shop_event", {
              p_session_id: sessionId,
              p_shop_item_id: safeId(itemId),
              p_event_type: "etsy_click",
            });
            recordJourneyStep("etsy_click");
            log("Etsy click:", itemId);
            flush(true); // keepalive flush — user is navigating away
          });
        });
      }
    });
  }

  // ---- Tab Change Listener ----

  function listenForTabChanges() {
    // Listen for radio input changes (the tab system uses hidden radio inputs)
    document.addEventListener("change", function (e) {
      var target = e.target;
      if (!target || target.type !== "radio" || !target.id) return;
      var match = target.id.match(/^tab-(.+)$/);
      if (!match) return;
      var tabName = match[1];
      recordTabSwitch(tabName);

      // Lazy-init tracking for specific tabs
      if (tabName === "gallery") {
        setTimeout(initGalleryTracking, 500);
      } else if (tabName === "shop") {
        setTimeout(initShopTracking, 500);
      }
    });

    // Also intercept nav-label clicks so re-clicking the current tab
    // still records a page-view duration and resets the dwell clock.
    document.addEventListener("click", function (e) {
      var label = e.target.closest('label[for^="tab-"]');
      if (!label) return;
      var forId = label.getAttribute("for") || "";
      var match = forId.match(/^tab-(.+)$/);
      if (!match) return;
      var tabName = match[1];
      // If we are ALREADY on this tab, the radio won't fire 'change',
      // so we handle the re-entry explicitly here.
      if (tabName === currentTab) {
        var now = Date.now();
        var duration = now - tabEnteredAt;
        if (duration > 500) recordPageView(currentTab, duration);
        tabEnteredAt = now;
        log("Tab re-entry:", tabName);
      }
    });
  }

  // ---- Page Visibility & Unload ----

  function listenForUnload() {
    // Use visibilitychange + pagehide for reliable tracking.
    // Both paths use fetch+keepalive to survive page close / tab switch.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        flushGalleryDwell();
        // Record final page view duration
        var duration = Date.now() - tabEnteredAt;
        if (duration > 500) {
          recordPageView(currentTab, duration);
        }
        flush(true);
      } else if (document.visibilityState === "visible") {
        // User returned — resume dwell timers for items that were visible
        // before the page was hidden. The IntersectionObserver won't re-fire
        // unless elements cross the threshold again (scroll), so we restart
        // the clock manually.
        var now = Date.now();
        Object.keys(galleryDwellTimers).forEach(function (itemId) {
          var timer = galleryDwellTimers[itemId];
          if (!timer.visible) {
            timer.startTime = now;
            timer.visible = true;
          }
        });
        tabEnteredAt = now;
      }
    });

    // Fallback for older browsers
    window.addEventListener("pagehide", function () {
      flushGalleryDwell();
      flush(true);
    });
  }

  // ---- Init ----

  function waitForSupabase(attempt) {
    attempt = attempt || 0;
    if (attempt > 50) {
      log("Supabase not available, analytics disabled");
      return;
    }

    if (
      !window.supabase ||
      typeof window.supabase.createClient !== "function"
    ) {
      setTimeout(function () {
        waitForSupabase(attempt + 1);
      }, 200);
      return;
    }

    // Reuse shared client if available, or create a lightweight one
    if (window.__supabaseClient) {
      db = window.__supabaseClient;
    } else {
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      window.__supabaseClient = db;
    }

    log("Analytics tracker initialised, session:", sessionId);

    // Record initial page view
    var tab = "home";
    try {
      var hash = (location.hash || "").replace("#", "").toLowerCase();
      if (hash && hash !== "home") tab = hash;
    } catch (_) {}
    currentTab = tab;
    tabEnteredAt = Date.now();
    recordJourneyStep(tab);

    // Don't record the initial view immediately — wait for some dwell
    // The visibilitychange handler will capture it on tab-away/close

    // Set up listeners
    listenForTabChanges();
    listenForUnload();

    // If gallery or shop tab is already active, init tracking
    if (tab === "gallery") setTimeout(initGalleryTracking, 1000);
    if (tab === "shop") setTimeout(initShopTracking, 1000);
  }

  // Boot: use requestIdleCallback to not block anything
  if (window.requestIdleCallback) {
    window.requestIdleCallback(function () {
      waitForSupabase(0);
    });
  } else {
    setTimeout(function () {
      waitForSupabase(0);
    }, 1000);
  }
})();
