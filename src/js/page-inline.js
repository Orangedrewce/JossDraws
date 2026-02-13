(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 1. Tab Logic (Keep tabs working)
  // ---------------------------------------------------------------------------
  // Tabs are managed by tabs-router.js to avoid double-init races.
  window.__tabsRouterPreferred = true;

  // ---------------------------------------------------------------------------
  // 2. Reviews Carousel (The Fix)
  // ---------------------------------------------------------------------------
  function initCarousel() {
    var track = document.getElementById("track");
    if (!track) return;

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      return;
    }

    var SUPABASE_URL = "https://pciubbwphwpnptgawgok.supabase.co";
    var SUPABASE_KEY = "sb_publishable_jz1pWpo7TDvURxQ8cqP06A_xc4ckSwv";
    // Use shared client instance to avoid multiple HTTP connection pools
    if (!window.__supabaseClient) {
      window.__supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    var db = window.__supabaseClient;

    // --- MAPPING: The text that shows up on the badge ---
    var sourceMap = {
      commission: "🎨 Commission",
      etsy: "🛍️ Etsy Order",
      print: "🖨️ Art Print",
      sticker: "🏷️ Sticker",
      bookmark: "🔖 Bookmark",
      pet_portrait: "🐾 Pet Portrait",
      faceless_portrait: "👤 Faceless Portrait",
      coloring_book: "🖍️ Coloring Book",
      general: "Verified Review"
    };

    function normalizeSourceKey(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/-+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
    }

    (async function run() {
      try {
        // Use RPC to get only approved, non-deleted reviews (server-filtered)
        var result = await db.rpc("get_approved_reviews");

        var rpcData = result && result.data;
        var error = result && result.error;
        var data = (rpcData && rpcData.success) ? rpcData.reviews : null;

        if (error || !data || data.length === 0) {
            // Fallback content if empty
            track.textContent = "";
            var fallback = document.createElement("div");
            fallback.className = "review-card active";
            fallback.innerHTML = `
              <span class="review-source-badge">Verified Review</span>
              <div class="review-stars">⭐⭐⭐⭐⭐</div>
              <p class="review-text">"I make art."</p>
              <div class="review-author">Joss</div>
            `;
            track.appendChild(fallback);
            return;
        }

        track.textContent = "";
        
        data.forEach(function (review, index) {
          var card = document.createElement("div");
          card.className = index === 0 ? "review-card active" : "review-card";

          // --- 1. BADGE (Product Name) ---
          var rawSource = review.source;
          var badgeKey = normalizeSourceKey(rawSource);
          var badgeLabel = sourceMap[badgeKey];
          if (!badgeLabel) {
            var fallbackLabel = String(rawSource || "").trim();
            badgeLabel = fallbackLabel || sourceMap["general"];
          }
          
          var badgeEl = document.createElement("span");
          badgeEl.className = "review-source-badge";
          badgeEl.textContent = badgeLabel;
          badgeEl.style.marginBottom = "0.5rem"; 
          badgeEl.style.display = "inline-block";

          // --- 2. STARS ---
          var rating = Number(review.rating) || 5;
          var safeRating = Math.max(1, Math.min(5, Math.floor(rating)));
          var starsEl = document.createElement("div");
          starsEl.className = "review-stars";
          starsEl.textContent = "⭐".repeat(safeRating);

          // --- 4. REVIEW TEXT ---
          var textEl = document.createElement("p");
          textEl.className = "review-text";
          textEl.textContent = '"' + (review.review_text || "") + '"';

          // --- 5. NAME ---
          var authorEl = document.createElement("div");
          authorEl.className = "review-author";
          authorEl.textContent = "- " + (review.client_name || "Anonymous");

          // --- BUILD CARD ---
          card.appendChild(badgeEl);  // Top
          card.appendChild(starsEl);
          card.appendChild(textEl);
          card.appendChild(authorEl); // Bottom

          track.appendChild(card);
        });

        // Start Animation
        if (data.length > 1) {
          var currentIndex = 0;
          var cards = document.querySelectorAll(".review-card");
          var intervalId = null;

          function startCarousel() {
            if (intervalId) return;
            intervalId = setInterval(function () {
              cards[currentIndex].classList.remove("active");
              currentIndex = (currentIndex + 1) % cards.length;
              cards[currentIndex].classList.add("active");
            }, 6000);
          }

          function stopCarousel() {
            if (intervalId) { clearInterval(intervalId); intervalId = null; }
          }

          // Pause carousel when page is hidden (guarded against duplicate listeners)
          if (!window.__carouselVisListenerAdded) {
            window.__carouselVisListenerAdded = true;
            document.addEventListener("visibilitychange", function () {
              if (document.hidden) { stopCarousel(); } else { startCarousel(); }
            });
          }

          // Stop carousel when switching away from reviews tab
          var reviewsTab = document.getElementById("tab-reviews");
          if (reviewsTab) {
            var allTabs = document.querySelectorAll('input[name="tabs"]');
            allTabs.forEach(function(tab) {
              tab.addEventListener("change", function() {
                if (this.checked && this.id === "tab-reviews") {
                  startCarousel();
                } else if (this.checked && this.id !== "tab-reviews") {
                  stopCarousel();
                }
              });
            });
          }

          // Only start if reviews tab is currently active
          var isReviewsActive = reviewsTab && reviewsTab.checked;
          if (isReviewsActive) {
            startCarousel();
          }
        }

      } catch (e) {
        console.error("Carousel Error:", e);
      }
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCarousel);
  } else {
    initCarousel();
  }

  // ---------------------------------------------------------------------------
  // 2b. Dynamic About Content (loaded from Supabase)
  // ---------------------------------------------------------------------------
  function initAboutContent() {
    var photoEl = document.getElementById("about-photo");
    var textEl = document.getElementById("about-text");
    if (!photoEl || !textEl) return;
    if (!window.supabase || typeof window.supabase.createClient !== "function") return;

    var SUPABASE_URL = "https://pciubbwphwpnptgawgok.supabase.co";
    var SUPABASE_KEY = "sb_publishable_jz1pWpo7TDvURxQ8cqP06A_xc4ckSwv";
    // Use shared client instance to avoid multiple HTTP connection pools
    if (!window.__supabaseClient) {
      window.__supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    var db = window.__supabaseClient;

    (async function () {
      try {
        var result = await db.rpc("get_about_content");
        var data = result && result.data;
        if (!data || !data.success) return; // keep hardcoded fallback

        if (data.photo_url) {
          photoEl.src = data.photo_url;
        }
        if (data.bio_text) {
          // Use textContent to prevent XSS from compromised admin data
          textEl.textContent = data.bio_text;
        }
      } catch (e) {
        // Silently fail — hardcoded fallback remains visible
      }
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAboutContent);
  } else {
    initAboutContent();
  }

  // ---------------------------------------------------------------------------
  // 3. Image Loading Indicators
  // ---------------------------------------------------------------------------
  function initImageLoading() {
    var wrappers = document.querySelectorAll('.img-loading-wrapper');
    wrappers.forEach(function(wrapper) {
      var img = wrapper.querySelector('img');
      if (!img) return;
      
      // If image is already cached/loaded
      if (img.complete && img.naturalWidth > 0) {
        wrapper.classList.add('loaded');
        return;
      }
      
      img.addEventListener('load', function() {
        wrapper.classList.add('loaded');
      });
      
      img.addEventListener('error', function() {
        wrapper.classList.add('loaded');
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initImageLoading);
  } else {
    initImageLoading();
  }

  // ---------------------------------------------------------------------------
  // 4. Decorative Tab Loading (First Visit Only)
  // ---------------------------------------------------------------------------
  var visitedTabs = {};
  
  function showDecorativeLoading(tabName, container, spinnerClass) {
    // Skip if already visited (except home tab which reloads images)
    if (visitedTabs[tabName] && tabName !== 'tab-home') return;
    
    // Mark as visited
    visitedTabs[tabName] = true;
    
    // For home tab, the hero-slideshow.js handles the spinner via img-loading-wrapper
    // So we skip the decorative overlay for home
    if (tabName === 'tab-home') return;
    
    // Create decorative overlay for other tabs
    var overlay = document.createElement('div');
    overlay.className = 'decorative-loading-overlay';
    overlay.innerHTML = '<div class="loader-spinner ' + spinnerClass + '"></div>';
    container.appendChild(overlay);
    
    // Remove after brief moment
    setTimeout(function() {
      overlay.style.opacity = '0';
      setTimeout(function() {
        if (overlay.parentNode) overlay.remove();
      }, 300);
    }, 400);
  }
  
  // Monitor tab changes
  var tabRadios = document.querySelectorAll('input[name="tabs"]');
  tabRadios.forEach(function(radio) {
    radio.addEventListener('change', function() {
      if (!this.checked) return;
      
      var tabId = this.id;
      var tabSection = document.querySelector('.tab-' + tabId.replace('tab-', ''));
      if (!tabSection) return;
      
      var spinnerClass = 'loader-spinner--' + tabId.replace('tab-', '');
      showDecorativeLoading(tabId, tabSection, spinnerClass);
    });
  });
})();