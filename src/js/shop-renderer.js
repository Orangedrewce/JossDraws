// =============================================================================
// SHOP RENDERER — Dynamic shop items from Supabase
// =============================================================================
// Self-contained IIFE: fetches active shop items, renders product cards with
// image carousels, section labels, and pagination. Lazy-loads on first visit
// to the shop tab. Follows the same architecture as masonry-gallery.js.
// =============================================================================

(function () {
  'use strict';

  const SUPABASE_URL = 'https://pciubbwphwpnptgawgok.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_jz1pWpo7TDvURxQ8cqP06A_xc4ckSwv';

  const ITEMS_PER_PAGE = 3;

  // State
  let shopItems = [];
  let currentPage = 1;
  let totalPages = 1;
  let initialized = false;
  let loading = false;

  // DOM refs (resolved lazily)
  let grid = null;
  let paginationContainer = null;
  let sectionLabelsContainer = null;

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

  // -------------------------------------------------------------------------
  // Card Builder
  // -------------------------------------------------------------------------

  function buildCardHtml(item) {
    const mediaArr = Array.isArray(item.media) ? item.media : [];
    const firstUrl = mediaArr[0] || '';
    const isVid = isVideo(firstUrl);
    const safeTitle = escapeHtml(item.title || '');
    const safePrice = escapeHtml(item.price_display || '');
    const safeSection = escapeHtml(item.section_label || '');
    const safeEtsyUrl = escapeHtml(item.etsy_url || '#');
    const mediaJson = JSON.stringify(mediaArr).replace(/'/g, '&#39;');

    let mediaHtml;
    if (isVid) {
      mediaHtml = `<video src="${firstUrl}" muted autoplay loop playsinline
                          style="width:100%;height:auto;display:block"
                          data-media='${mediaJson}'></video>`;
    } else {
      mediaHtml = `<img src="${firstUrl}"
                        loading="lazy" decoding="async"
                        width="800" height="800"
                        alt="${safeTitle}"
                        data-media='${mediaJson}'>`;
    }

    return `
      <article class="card" data-section="${safeSection}" data-shop-item-id="${item.id}">
        <div class="image-carousel" role="region" aria-label="Product images for ${safeTitle}">
          <button class="arrow left" aria-label="Previous image">\u2039</button>
          <div class="media-container">
            ${mediaHtml}
          </div>
          <button class="arrow right" aria-label="Next image">\u203A</button>
        </div>
        <div class="card-content">
          <h3>${safeTitle}</h3>
          <p><strong>${safePrice}</strong></p>
          <a href="${safeEtsyUrl}" class="btn" target="_blank" rel="noopener noreferrer">View on Etsy</a>
        </div>
      </article>`;
  }

  // -------------------------------------------------------------------------
  // Carousel Logic (self-contained per card)
  // -------------------------------------------------------------------------

  function initCarouselsInContainer(container) {
    const carousels = container.querySelectorAll('.image-carousel');
    carousels.forEach(function (el) {
      const mediaContainer = el.querySelector('.media-container');
      if (!mediaContainer) return;

      // Read media array from the first img/video data-media attribute
      const mediaEl = mediaContainer.querySelector('[data-media]');
      if (!mediaEl) return;

      let mediaItems;
      try {
        mediaItems = JSON.parse(mediaEl.getAttribute('data-media'));
      } catch (_) {
        return;
      }
      if (!Array.isArray(mediaItems) || mediaItems.length === 0) return;

      let currentIndex = 0;

      function showMedia(index) {
        const url = mediaItems[index];
        const vid = isVideo(url);
        mediaContainer.innerHTML = '';

        if (vid) {
          const video = document.createElement('video');
          video.src = url;
          video.controls = true;
          video.autoplay = true;
          video.loop = true;
          video.muted = true;
          video.playsInline = true;
          video.style.cssText = 'width:100%;height:auto;display:block';
          mediaContainer.appendChild(video);
        } else {
          const img = document.createElement('img');
          img.src = url;
          img.alt = 'Product image';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.setAttribute('data-media', JSON.stringify(mediaItems));
          mediaContainer.appendChild(img);
        }
      }

      const leftArrow = el.querySelector('.arrow.left');
      const rightArrow = el.querySelector('.arrow.right');

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

    if (totalPages <= 1) {
      paginationContainer.closest('.shop-pagination-nav').style.display = 'none';
      return;
    }
    paginationContainer.closest('.shop-pagination-nav').style.display = '';

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

  function updateSectionLabels() {
    if (!sectionLabelsContainer) return;
    var start = (currentPage - 1) * ITEMS_PER_PAGE;
    var end = start + ITEMS_PER_PAGE;
    var pageItems = shopItems.slice(start, end);
    var sections = [];
    pageItems.forEach(function (item) {
      var label = (item.section_label || '').trim();
      if (label && sections.indexOf(label) === -1) sections.push(label);
    });
    sectionLabelsContainer.innerHTML = sections.map(function (s) {
      return '<h3>' + escapeHtml(s) + '</h3>';
    }).join('');
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

    renderPagination();
    updateSectionLabels();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function renderShop() {
    if (!grid) return;

    if (shopItems.length === 0) {
      grid.innerHTML = '<p class="muted-center" style="grid-column:1/-1">Shop coming soon!</p>';
      if (paginationContainer) {
        paginationContainer.closest('.shop-pagination-nav').style.display = 'none';
      }
      return;
    }

    // Build all cards
    var html = shopItems.map(buildCardHtml).join('');
    grid.innerHTML = html;

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

    // Show loading state
    if (grid) {
      grid.innerHTML = '<p class="muted-center" style="grid-column:1/-1">Loading shop\u2026</p>';
    }

    // Wait for Supabase SDK to be available
    if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
      setTimeout(function () {
        loading = false;
        fetchShopItems();
      }, 200);
      return;
    }

    var db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
        initialized = true;
        renderShop();
        console.log('\uD83D\uDED2 Loaded ' + shopItems.length + ' shop items from database');
      })
      .catch(function (err) {
        loading = false;
        console.error('Shop fetch failed:', err);
        fallbackToEmpty();
      });
  }

  function fallbackToEmpty() {
    shopItems = [];
    initialized = true;
    renderShop();
  }

  // -------------------------------------------------------------------------
  // Lazy-load on tab activation
  // -------------------------------------------------------------------------

  function tryInit() {
    grid = document.getElementById('shop-grid');
    paginationContainer = document.querySelector('.shop-pagination-nav .pagination');
    sectionLabelsContainer = document.getElementById('shop-section-labels');

    if (!grid) return;

    var shopTab = document.getElementById('tab-shop');
    if (!shopTab) return;

    // If shop tab is already active on load, fetch immediately
    if (shopTab.checked) {
      fetchShopItems();
      return;
    }

    // Listen for tab change
    shopTab.addEventListener('change', function onShopTab() {
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
