(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Preselect tab from URL hash during parse to avoid flash of wrong tab
  // ---------------------------------------------------------------------------
  (function preselectTabFromHash() {
    try {
      var raw = (location.hash || "").toLowerCase().replace(/^#/, "");
      var names = ["home", "gallery", "about", "shop", "contact", "reviews"];

      function pick(n) {
        if (!n) return "home";
        if (names.indexOf(n) !== -1) return n;
        if (n.indexOf("tab-") === 0) {
          var p = n.slice(4);
          if (names.indexOf(p) !== -1) return p;
        }
        for (var i = 0; i < names.length; i++) {
          if (n.indexOf(names[i]) !== -1) return names[i];
        }
        return "home";
      }

      var tab = pick(raw);
      var id = "tab-" + tab;
      var el = document.getElementById(id);
      if (el) el.checked = true;
    } catch (_) {
      // ignore
    }
  })();

  // ---------------------------------------------------------------------------
  // Reviews carousel (Supabase)
  // ---------------------------------------------------------------------------
  function initCarousel() {
    var track = document.getElementById("track");
    if (!track) return;

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      // Supabase library not loaded or blocked
      return;
    }

    var SUPABASE_URL = "https://pciubbwphwpnptgawgok.supabase.co";
    // ensure RLS is configured.
    var SUPABASE_KEY =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjaXViYndwaHdwbnB0Z2F3Z29rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjA0OTQsImV4cCI6MjA4NTc5NjQ5NH0.3JhpTJREmfxZUYIYWtuAiTl91KFDzh38jkTKXnO5wSI";

    var db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    (async function run() {
      try {
        // Debug 1: See exactly what happened in the Console (F12)
        console.log("Attempting to fetch reviews...");

        var result = await db
          .from("reviews")
          .select("client_name, review_text, rating, created_at")
          .eq("is_approved", true)
          .order("created_at", { ascending: false })
          .limit(10);

        var data = result && result.data;
        var error = result && result.error;

        // Debug 2: See exactly what happened in the Console (F12)
        if (error) console.error("Supabase Error:", error);
        if (data) console.log("Data received:", data);

        if (error || !data || data.length === 0) {
          console.warn("No approved reviews found. Showing fallback.");
          track.textContent = "";
          var fallbackCard = document.createElement("div");
          fallbackCard.className = "review-card active";
          var fallbackText = document.createElement("p");
          fallbackText.className = "review-text";
          fallbackText.textContent = '"I make art."';
          var fallbackAuthor = document.createElement("div");
          fallbackAuthor.className = "review-author";
          fallbackAuthor.textContent = "- Joss";
          fallbackCard.appendChild(fallbackText);
          fallbackCard.appendChild(fallbackAuthor);
          track.appendChild(fallbackCard);
          return;
        }

        track.textContent = "";
        data.forEach(function (review, index) {
          var card = document.createElement("div");
          card.className = index === 0 ? "review-card active" : "review-card";

          var rating = Number(review && review.rating);
          var safeRating = Number.isFinite(rating)
            ? Math.max(1, Math.min(5, Math.floor(rating)))
            : 5;
          var stars = "★".repeat(safeRating);

          var starsEl = document.createElement("div");
          starsEl.className = "review-stars";
          starsEl.textContent = stars;

          var textEl = document.createElement("p");
          textEl.className = "review-text";
          textEl.textContent =
            '"' + ((review && review.review_text) ? String(review.review_text) : "") + '"';

          var authorEl = document.createElement("div");
          authorEl.className = "review-author";
          authorEl.textContent =
            "- " + ((review && review.client_name) ? String(review.client_name) : "Anonymous");

          card.appendChild(starsEl);
          card.appendChild(textEl);
          card.appendChild(authorEl);
          track.appendChild(card);
        });

        if (data.length > 1) {
          var currentIndex = 0;
          var cards = document.querySelectorAll(".review-card");
          setInterval(function () {
            cards[currentIndex].classList.remove("active");
            currentIndex = (currentIndex + 1) % cards.length;
            cards[currentIndex].classList.add("active");
          }, 6000);
        }
      } catch (e) {
        console.error("Review carousel initialization failed:", e);
      }
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCarousel);
  } else {
    initCarousel();
  }
})();
