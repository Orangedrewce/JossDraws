// =============================================================================
// SHOP RENDERER — Dynamic shop items from Supabase
// =============================================================================
// Self-contained IIFE: fetches active shop items + page titles, renders
// product cards with image carousels and paginated pages (3 per page).
// Each page gets a single title heading from the admin-managed page_titles
// array. Lazy-loads on first visit to the shop tab.
// =============================================================================

(function () {
  'use strict';

  const SUPABASE_URL = 'https://pciubbwphwpnptgawgok.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_jz1pWpo7TDvURxQ8cqP06A_xc4ckSwv';

  const ITEMS_PER_PAGE = 3;
  const MAX_RETRIES = 50; // 50 retries * 200ms = 10 seconds max

  // State
  let shopItems = [];
  let pageTitles = [];   // ["Best Sellers", "More Products", ...]
  let currentPage = 1;
  let totalPages = 1;
  let initialized = false;
  let loading = false;
  let retryCount = 0;

  // DOM refs (resolved lazily)
  let grid = null;
  let paginationContainer = null;
  let pageTitleEl = null;  // single <h3> above the grid

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function isVideo(url) {
    return /\.(mp4|webm|ogg)$/i.test(url) || url.includes('video');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function sanitizeUrl(url) {
    if (!url || url === '#') return '#';
    // Reject javascript:, data:, and vbscript: protocols
    const dangerous = /^\s*(javascript|data|vbscript):/i;
    if (dangerous.test(url)) return '#';
    // Only allow http, https, and relative URLs
    if (!/^(https?:\/\/|\/)/.test(url) && url !== '#') return '#';
    return url;
  }

  // -------------------------------------------------------------------------
  // Card Builder
  // -------------------------------------------------------------------------

  function buildCardHtml(item) {
    const mediaArr = Array.isArray(item.media) ? item.media : [];
    const firstUrl = sanitizeUrl(mediaArr[0] || '');
    const isVid = isVideo(firstUrl);
    const safeTitle = escapeHtml(item.title || '');
    const safePrice = escapeHtml(item.price_display || '');
    const safeEtsyUrl = escapeHtml(sanitizeUrl(item.etsy_url || '#'));
    const mediaJson = JSON.stringify(mediaArr).replace(/'/g, '&#39;');

    var mediaHtml;
    if (isVid) {
      mediaHtml = '<video src="' + firstUrl + '" muted autoplay loop playsinline ' +
                  'style="width:100%;height:auto;display:block" ' +
                  "data-media='" + mediaJson + "'></video>";
    } else {
      mediaHtml = '<div class="img-loading-wrapper shop-img-wrapper">' +
                  '<img src="' + firstUrl + '" loading="lazy" decoding="async" ' +
                  'width="800" height="800" alt="' + safeTitle + '" ' +
                  "data-media='" + mediaJson + "'>" +
                  '</div>';
    }

    return '<article class="card" data-shop-item-id="' + item.id + '">' +
      '<div class="image-carousel" role="region" aria-label="Product images for ' + safeTitle + '">' +
        '<button class="arrow left" aria-label="Previous image">\u2039</button>' +
        '<div class="media-container">' + mediaHtml + '</div>' +
        '<button class="arrow right" aria-label="Next image">\u203A</button>' +
      '</div>' +
      '<div class="card-content">' +
        '<h3>' + safeTitle + '</h3>' +
        '<p><strong>' + safePrice + '</strong></p>' +
        '<a href="' + safeEtsyUrl + '" class="btn" target="_blank" rel="noopener noreferrer">View on Etsy</a>' +
      '</div>' +
    '</article>';
  }

  // -------------------------------------------------------------------------
  // Carousel Logic (self-contained per card)
  // -------------------------------------------------------------------------

  function initShopImageLoading(container) {
    var wrappers = container.querySelectorAll('.img-loading-wrapper');
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

  function initCarouselsInContainer(container) {
    var carousels = container.querySelectorAll('.image-carousel');
    carousels.forEach(function (el) {
      var mediaContainer = el.querySelector('.media-container');
      if (!mediaContainer) return;

      var mediaEl = mediaContainer.querySelector('[data-media]');
      if (!mediaEl) return;

      var mediaItems;
      try {
        mediaItems = JSON.parse(mediaEl.getAttribute('data-media'));
      } catch (_) {
        return;
      }
      if (!Array.isArray(mediaItems) || mediaItems.length === 0) return;

      var currentIndex = 0;

      function showMedia(index) {
        var url = mediaItems[index];
        var vid = isVideo(url);
        mediaContainer.innerHTML = '';

        if (vid) {
          var video = document.createElement('video');
          video.src = url;
          video.controls = true;
          video.autoplay = true;
          video.loop = true;
          video.muted = true;
          video.playsInline = true;
          video.style.cssText = 'width:100%;height:auto;display:block';
          mediaContainer.appendChild(video);
        } else {
          var wrapper = document.createElement('div');
          wrapper.className = 'img-loading-wrapper shop-img-wrapper';
          
          var img = document.createElement('img');
          img.src = url;
          img.alt = 'Product image';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.setAttribute('data-media', JSON.stringify(mediaItems));
          
          // Handle image load
          img.addEventListener('load', function() {
            wrapper.classList.add('loaded');
          });
          img.addEventListener('error', function() {
            wrapper.classList.add('loaded');
          });
          
          // Check if already cached
          if (img.complete && img.naturalWidth > 0) {
            wrapper.classList.add('loaded');
          }
          
          wrapper.appendChild(img);
          mediaContainer.appendChild(wrapper);
        }
      }

      var leftArrow = el.querySelector('.arrow.left');
      var rightArrow = el.querySelector('.arrow.right');

      if (leftArrow) {
        leftArrow.addEventListener('click', function (e) {
          e.stopPropagation();
          currentIndex = (currentIndex - 1 + mediaItems.length) % mediaItems.length;
          showMedia(currentIndex);
        });
      }
      if (rightArrow) {
        rightArrow.addEventListener('click', function (e) {
          e.stopPropagation();
          currentIndex = (currentIndex + 1) % mediaItems.length;
          showMedia(currentIndex);
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------

  function renderPagination() {
    if (!paginationContainer) return;
    paginationContainer.innerHTML = '';

    var navEl = paginationContainer.closest('.shop-pagination-nav');
    if (totalPages <= 1) {
      if (navEl) navEl.style.display = 'none';
      return;
    }
    if (navEl) navEl.style.display = '';

    // Prev
    var liPrev = document.createElement('li');
    var prevBtn = document.createElement('button');
    prevBtn.classList.add('pagination-btn', 'pagination-prev');
    prevBtn.setAttribute('aria-label', 'Previous page');
    prevBtn.textContent = '\u2039';
    if (currentPage === 1) {
      prevBtn.classList.add('disabled');
      prevBtn.setAttribute('aria-disabled', 'true');
      prevBtn.disabled = true;
    }
    prevBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (currentPage > 1) displayPage(currentPage - 1);
    });
    liPrev.appendChild(prevBtn);
    paginationContainer.appendChild(liPrev);

    // Page numbers
    for (var i = 1; i <= totalPages; i++) {
      (function (pageNum) {
        var li = document.createElement('li');
        var btn = document.createElement('button');
        btn.classList.add('pagination-btn');
        btn.textContent = String(pageNum);
        btn.setAttribute('aria-label', 'Go to page ' + pageNum);
        if (pageNum === currentPage) {
          btn.classList.add('active');
          btn.setAttribute('aria-current', 'page');
        }
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          displayPage(pageNum);
        });
        li.appendChild(btn);
        paginationContainer.appendChild(li);
      })(i);
    }

    // Next
    var liNext = document.createElement('li');
    var nextBtn = document.createElement('button');
    nextBtn.classList.add('pagination-btn', 'pagination-next');
    nextBtn.setAttribute('aria-label', 'Next page');
    nextBtn.textContent = '\u203A';
    if (currentPage === totalPages) {
      nextBtn.classList.add('disabled');
      nextBtn.setAttribute('aria-disabled', 'true');
      nextBtn.disabled = true;
    }
    nextBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (currentPage < totalPages) displayPage(currentPage + 1);
    });
    liNext.appendChild(nextBtn);
    paginationContainer.appendChild(liNext);
  }

  // Show the page title for the current page (from pageTitles array)
  function updatePageTitle() {
    if (!pageTitleEl) return;
    var title = (pageTitles[currentPage - 1] || '').trim();
    if (title) {
      pageTitleEl.textContent = title;
      pageTitleEl.style.display = '';
    } else {
      pageTitleEl.textContent = '';
      pageTitleEl.style.display = 'none';
    }
  }

  function displayPage(pageNum) {
    if (pageNum < 1 || pageNum > totalPages) return;
    currentPage = pageNum;

    var cards = grid.querySelectorAll('.card');
    var start = (currentPage - 1) * ITEMS_PER_PAGE;
    var end = start + ITEMS_PER_PAGE;

    cards.forEach(function (card, idx) {
      card.style.display = (idx >= start && idx < end) ? 'flex' : 'none';
    });

    grid.setAttribute('aria-busy', 'false');
    renderPagination();
    updatePageTitle();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function renderShop() {
    if (!grid) return;

    if (shopItems.length === 0) {
      grid.innerHTML = '<p class="muted-center" style="grid-column:1/-1">Shop coming soon!</p>';
      var navEl = paginationContainer && paginationContainer.closest('.shop-pagination-nav');
      if (navEl) navEl.style.display = 'none';
      if (pageTitleEl) pageTitleEl.style.display = 'none';
      return;
    }

    // Build all cards
    grid.innerHTML = shopItems.map(buildCardHtml).join('');

    // Initialize image loading indicators
    initShopImageLoading(grid);

    // Initialize carousels on new cards
    initCarouselsInContainer(grid);

    // Pagination
    totalPages = Math.ceil(shopItems.length / ITEMS_PER_PAGE);
    currentPage = 1;
    displayPage(1);
  }

  // -------------------------------------------------------------------------
  // Fetch from Supabase
  // -------------------------------------------------------------------------

  function fetchShopItems() {
    if (loading) return;
    loading = true;

    if (grid) {
      grid.setAttribute('aria-busy', 'true');
      grid.innerHTML = '<div class="tab-loader"><div class="loader-spinner loader-spinner--shop" role="status" aria-label="Loading shop"></div></div>';
    }

    if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
      if (retryCount >= MAX_RETRIES) {
        console.error('Shop: Supabase CDN failed to load after', MAX_RETRIES, 'retries');
        loading = false;
        fallbackToEmpty();
        return;
      }
      retryCount++;
      setTimeout(function () {
        loading = false;
        fetchShopItems();
      }, 200);
      return;
    }

    // Reset retry count on successful CDN load
    retryCount = 0;

    var db = window.__supabaseClient || supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    db.rpc('get_active_shop_items')
      .then(function (result) {
        loading = false;
        if (result.error) {
          console.error('Shop fetch error:', result.error);
          fallbackToEmpty();
          return;
        }

        var data = result.data;
        if (!data || !data.success) {
          console.error('Shop RPC error:', data && data.error);
          fallbackToEmpty();
          return;
        }

        shopItems = data.items || [];
        pageTitles = data.page_titles || [];
        initialized = true;
        renderShop();
        console.log('Loaded ' + shopItems.length + ' shop items from supabase');
      })
      .catch(function (err) {
        loading = false;
        console.error('Shop fetch failed:', err);
        fallbackToEmpty();
      });
  }

  function fallbackToEmpty() {
    shopItems = [];
    pageTitles = [];
    initialized = true;
    renderShop();
  }

  // -------------------------------------------------------------------------
  // Lazy-load on tab activation
  // -------------------------------------------------------------------------

  function tryInit() {
    grid = document.getElementById('shop-grid');
    paginationContainer = document.querySelector('.shop-pagination-nav .pagination');
    pageTitleEl = document.getElementById('shop-page-title');

    if (!grid) return;

    var shopTab = document.getElementById('tab-shop');
    if (!shopTab) return;

    if (shopTab.checked) {
      fetchShopItems();
      return;
    }

    shopTab.addEventListener('change', function () {
      if (shopTab.checked && !initialized) {
        fetchShopItems();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();
