// =============================================================================
// MASONRY GALLERY
// =============================================================================

class MasonryGallery {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      ease: options.ease || 'power3.out',
      duration: options.duration || 0.6,
      stagger: options.stagger || 0.05,
      animateFrom: options.animateFrom || 'bottom',
      scaleOnHover: options.scaleOnHover !== false,
      hoverScale: options.hoverScale || 0.95,
      blurToFocus: options.blurToFocus !== false,
      colorShiftOnHover: options.colorShiftOnHover || false
    };
    
    this.items = [];
    this.grid = [];
    this.columns = 1;
    this.width = 0;
    this.hasMounted = false;
    this._relayoutTimer = null;
    this.resizeTimeout = null;
    // Track focused item for reflowing the grid
    this.focusedItemId = null;
    // Store natural media dimensions keyed by src
    this.imageMeta = {};
    // Scroll position saved before focus (restored on unfocus)
    this.savedScrollY = null;
    // Track where we auto-scrolled to when focusing (used to detect user-driven scroll drift)
    this.focusScrollTargetY = null;
    this.lastFocusWasMobile = false;

    // Reduced motion support
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.boundHandleMotionChange = (e) => {
      this.reduceMotion = e.matches;
    };
    try {
      this.motionMedia.addEventListener('change', this.boundHandleMotionChange);
    } catch (_) {
      // Older Safari fallback
      try { this.motionMedia.addListener(this.boundHandleMotionChange); } catch (_) {}
    }

    // Grid memoization — skip recalc when inputs haven't changed
    this._gridHash = '';
    this._cachedMaxHeight = 0;

    // DOM reconciliation — cache element references for O(1) lookups
    this.nodeMap = new Map();   // item.id → wrapper DOM element
    this.gridIndex = new Map(); // item.id → grid layout entry

    // Pre-computed transition strings (avoid rebuilding per-item)
    const d = this.options.duration;
    this._transitionMove = `transform ${d}s cubic-bezier(0.22, 1, 0.36, 1), width ${d}s, height ${d}s, filter ${d}s, z-index 0s`;
    this._transitionNone = 'none';

    // Cancellation / teardown safety for rapid filter changes
    this.isDestroyed = false;
    this.initRunId = 0;
    // Bound event handler for cleanup
    this.boundHandleResize = () => this.handleResize();
    // Bound click-outside handler (set in initClickOutside)
    this.boundHandleDocClick = null;
    // Bound ESC key handler
    this.boundHandleKeyDown = null;
    // Video metadata loader tracking for cleanup
    this._videoMetaLoaders = [];
    // Animation timeout IDs for cleanup on destroy
    this._animateTimeouts = [];
  }
  
  async init(items) {
    this.isDestroyed = false;
    const runId = ++this.initRunId;
    this.items = items;
    
    // Show loading state
    this.showLoading();

    // Fire-and-forget video metadata loading — doesn't block initial render.
    // Layout updates progressively as each video's dimensions arrive.
    const videoItems = items.filter(i => i.type === 'video' || i.video);
    if (videoItems.length > 0) {
      this.startVideoMetaLoading(videoItems);
    }

    // Assign initial aspect ratios — videos get real dimensions from metadata,
    // images get a sensible default (updated progressively via <img> onload).
    this.items = this.items.map(i => {
      const src = i.video || i.img;
      const meta = this.imageMeta[src];
      if (meta) {
        // Video with known dimensions
        const ratio = meta.naturalHeight / meta.naturalWidth;
        return { ...i, naturalWidth: meta.naturalWidth, naturalHeight: meta.naturalHeight, ratio };
      }
      // Image — use 1:1 default; real ratio arrives via <img> onload
      const naturalWidth = i.width || 1000;
      const naturalHeight = i.height || 1000;
      const ratio = naturalHeight / naturalWidth;
      return { ...i, naturalWidth, naturalHeight, ratio };
    });
    
    // Calculate responsive columns
    this.updateColumns();
    
    // Set up resize observer
    this.setupResizeObserver();
    
    // Initial layout — renders immediately with placeholder ratios.
    // Each card shows its own spinner; photos appear as they load.
    this.calculateGrid();
    if (this.isDestroyed || runId !== this.initRunId) return;
    this.render();

    // Remove main gallery spinner now that cards are in the grid
    this.hideLoading();

    if (this.reduceMotion) {
      this.hasMounted = true;
      this.updateLayout();
    } else {
      this.animateIn();
    }
    
    // Set up window resize
    window.addEventListener('resize', this.boundHandleResize);
  }
  
  // Non-blocking video metadata — each video updates layout independently as it arrives
  startVideoMetaLoading(videoItems) {
    videoItems.forEach(item => {
      const src = item.video || item.img;
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = src;
      
      const onLoadedMetadata = () => {
        if (this.isDestroyed) return;
        const w = video.videoWidth || 1000;
        const h = video.videoHeight || 1000;
        this.imageMeta[src] = { naturalWidth: w, naturalHeight: h, isVideo: true };
        // Update the item's ratio and trigger relayout (same path as image onload)
        const i = this.items.find(x => (x.video || x.img) === src);
        if (i) {
          const newRatio = h / w;
          if (Math.abs((i.ratio || 1) - newRatio) >= 0.03) {
            i.ratio = newRatio;
            i.naturalWidth = w;
            i.naturalHeight = h;
            this.debouncedRelayout();
          }
        }
      };
      
      const onError = () => {};
      
      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('error', onError);
      
      // Store for cleanup on destroy
      this._videoMetaLoaders.push({ video, onLoadedMetadata, onError });
    });
  }

  // Called by <img> onload — updates ratio and triggers a batched relayout
  handleImageLoaded(itemId, naturalWidth, naturalHeight) {
    if (this.isDestroyed) return;
    const item = this.items.find(i => i.id === itemId);
    if (!item) return;
    const newRatio = naturalHeight / naturalWidth;
    // Only relayout if the ratio changed meaningfully
    if (Math.abs((item.ratio || 1) - newRatio) < 0.03) return;
    item.ratio = newRatio;
    item.naturalWidth = naturalWidth;
    item.naturalHeight = naturalHeight;
    this.debouncedRelayout();
  }

  // Batches multiple image-load relayouts into a single frame
  debouncedRelayout() {
    if (this._relayoutTimer) return;
    this._relayoutTimer = requestAnimationFrame(() => {
      this._relayoutTimer = null;
      if (this.isDestroyed) return;
      this.calculateGrid();
      // Only update layout if we've finished mounting (prevents fighting entry animation)
      if (this.hasMounted) {
        this.updateLayout();
      }
    });
  }
  
  updateColumns() {
    const width = window.innerWidth;
    if (width >= 1500) this.columns = 5;
    else if (width >= 1000) this.columns = 4;
    else if (width >= 600) this.columns = 3;
    else if (width >= 400) this.columns = 2;
    else this.columns = 1;
  }
  
  setupResizeObserver() {
    this._lastObservedWidth = this.container.offsetWidth;
    this._lastObservedHeight = this.container.offsetHeight;
    const ro = new ResizeObserver(() => {
      const w = this.container.offsetWidth;
      const h = this.container.offsetHeight;
      // Guard: skip if dimensions didn't change (avoids feedback loop from
      // setting container height which re-triggers the observer).
      if (w === this._lastObservedWidth && h === this._lastObservedHeight) return;
      this._lastObservedWidth = w;
      this._lastObservedHeight = h;
      this.width = w;
      this.calculateGrid();
      // Only update layout if we've finished mounting
      if (this.hasMounted) {
        this.updateLayout();
      }
    });
    ro.observe(this.container);
    this.resizeObserver = ro;
  }
  
  calculateGrid() {
    this.width = this.container.offsetWidth;
    if (!this.width) return;

    // Hash check: skip full recalc if inputs haven't changed
    // Include item IDs to ensure different items aren't skipped if count/ratios match
    const idKey = this.items.map(i => i.id).join(',');
    const ratioKey = this.items.map(i => (i.ratio || 1).toFixed(3)).join(',');
    const hash = `${this.columns}|${this.width}|${this.focusedItemId || ''}|${idKey}|${ratioKey}`;
    if (hash === this._gridHash) return;
    this._gridHash = hash;

    const colHeights = new Array(this.columns).fill(0);
    const columnWidth = this.width / this.columns;

    // Lay out focused first so it pushes others down
    const focusedItem = this.items.find(i => i.id === this.focusedItemId);
    const orderedItems = focusedItem
      ? [focusedItem, ...this.items.filter(i => i.id !== this.focusedItemId)]
      : this.items;

    const layoutMap = new Map();
    orderedItems.forEach(child => {
      const isFocused = this.focusedItemId === child.id;
      if (isFocused) {
        const y = Math.min(...colHeights);
        const w = this.width;
        // Use actual ratio to compute focused height; cap at 90% of viewport
        const ratio = child.ratio || (child.naturalHeight && child.naturalWidth
          ? child.naturalHeight / child.naturalWidth
          : 1);
        const hFromRatio = Math.max(80, Math.round(w * ratio));
        const h = Math.max(300, Math.min(hFromRatio, Math.floor(window.innerHeight * 0.9)));
        for (let i = 0; i < colHeights.length; i++) {
          colHeights[i] = y + h;
        }
        layoutMap.set(child.id, { ...child, x: 0, y, w, h, focused: true });
        return;
      }
      const col = colHeights.indexOf(Math.min(...colHeights));
      const x = columnWidth * col;
      // Use natural aspect ratio to compute precise height for dense layout
      const ratio = child.ratio || (child.naturalHeight && child.naturalWidth
        ? child.naturalHeight / child.naturalWidth
        : 1);
      const height = Math.max(80, Math.round(columnWidth * ratio));
      const y = colHeights[col];
      colHeights[col] += height;
      layoutMap.set(child.id, { ...child, x, y, w: columnWidth, h: height, focused: false });
    });

    this.grid = this.items
      .map(child => layoutMap.get(child.id))
      .filter(Boolean);

    // Cache max height and build O(1) lookup index
    this._cachedMaxHeight = this.grid.length
      ? Math.max(...this.grid.map(g => g.y + g.h))
      : 0;
    this.gridIndex = new Map(this.grid.map(g => [g.id, g]));
  }
  
  getInitialPosition(item, index) {
    const containerRect = this.container.getBoundingClientRect();
    let direction = this.options.animateFrom;
    
    if (direction === 'random') {
      const directions = ['top', 'bottom', 'left', 'right'];
      direction = directions[Math.floor(Math.random() * directions.length)];
    }
    
    switch (direction) {
      case 'top':
        return { x: item.x, y: -200 };
      case 'bottom':
        return { x: item.x, y: window.innerHeight + 200 };
      case 'left':
        return { x: -200, y: item.y };
      case 'right':
        return { x: window.innerWidth + 200, y: item.y };
      case 'center':
        return {
          x: containerRect.width / 2 - item.w / 2,
          y: containerRect.height / 2 - item.h / 2
        };
      default:
        return { x: item.x, y: item.y + 100 };
    }
  }
  
  render() {
    this.container.style.position = 'relative';
    this.container.style.width = '100%';
    this.focusedCard = null;

    // Occlusion: viewport items get eager loading, rest stay lazy
    const containerTop = this.container.getBoundingClientRect().top + window.scrollY;
    const viewportBottom = window.scrollY + window.innerHeight;
    const visibleDepth = Math.max(0, viewportBottom - containerTop) + window.innerHeight;

    // DOM reconciliation: remove nodes for items that left the grid (filter change)
    // Collect IDs to remove first to avoid mutating map during iteration
    const activeIds = new Set(this.grid.map(i => i.id));
    const toRemove = [];
    for (const [id] of this.nodeMap) {
      if (!activeIds.has(id)) toRemove.push(id);
    }
    toRemove.forEach(id => {
      const el = this.nodeMap.get(id);
      if (!el) return;
      // Run stored cleanup to remove all wrapper-level listeners
      if (el._mvcCleanup) el._mvcCleanup();
      el.remove();
      this.nodeMap.delete(id);
    });

    this.grid.forEach(item => {
      let wrapper = this.nodeMap.get(item.id);

      if (!wrapper) {
        // First time seeing this item — create full DOM (expensive, runs once per item)
        wrapper = this._createItemElement(item, visibleDepth);
        this.container.appendChild(wrapper);
        this.nodeMap.set(item.id, wrapper);
      }

      // Mutable state update (runs for both new and cached nodes)
      wrapper.setAttribute('aria-pressed', item.focused ? 'true' : 'false');
      if (item.focused) {
        wrapper.classList.add('card-focused');
        wrapper.style.zIndex = '20';
        this.focusedCard = wrapper;
      } else {
        wrapper.classList.remove('card-focused');
        wrapper.style.zIndex = '1';
      }

      // Set initial absolute positions immediately to prevent stacking on mobile
      // This ensures images have position/dimensions before they start loading
      wrapper.style.position = 'absolute';
      wrapper.style.transform = `translate(${item.x}px, ${item.y}px)`;
      wrapper.style.width = `${item.w}px`;
      wrapper.style.height = `${item.h}px`;
      
      // Control opacity: hide ONLY if we're about to animate in (prevents flash)
      // Once mounted, always show (fixes small photos bug on filter/sort)
      if (!this.hasMounted && !this.reduceMotion) {
        wrapper.style.opacity = '0'; // Will be revealed by animateIn()
      } else {
        wrapper.style.opacity = '1'; // Mounted: show immediately
      }
    });

    this.container.style.height = `${this._cachedMaxHeight}px`;
  }

  // Extracted element factory — called once per item, then cached in nodeMap
  _createItemElement(item, visibleDepth) {
    const wrapper = document.createElement('div');
    wrapper.className = 'masonry-item-wrapper';
    wrapper.dataset.key = item.id;
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('role', 'button');
    wrapper.style.cssText = `
      position: absolute;
      cursor: pointer;
      overflow: hidden;
      border-radius: 8px;
      left: 0;
      top: 0;
      width: ${item.w}px;
      height: ${item.h}px;
      transform: translate(${item.x}px, ${item.y}px);
      transition: ${this.reduceMotion ? 'none' : 'transform 0.3s ease, z-index 0s'};
    `;

    // Media rendering (image or video)
    let mediaContainer;
    if (item.type === 'video' || item.video) {
      mediaContainer = document.createElement('div');
      mediaContainer.className = 'masonry-item-video';
      const videoEl = document.createElement('video');
      videoEl.src = item.video || item.img;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.setAttribute('playsinline', '');
      videoEl.loop = item.loop !== false;
      videoEl.preload = 'metadata';
      mediaContainer.appendChild(videoEl);

      // Pseudo controls (play/pause and mute) overlay
      const controls = document.createElement('div');
      controls.className = 'masonry-video-controls';
      controls.innerHTML = `
        <button class="mvc-btn mvc-play" aria-label="Pause video" title="Pause">❚❚</button>
        <button class="mvc-btn mvc-mute" aria-label="Unmute video" title="Unmute">🔇</button>
      `;
      mediaContainer.appendChild(controls);

      const playBtn = controls.querySelector('.mvc-play');
      const muteBtn = controls.querySelector('.mvc-mute');

      const syncControls = () => {
        if (videoEl.paused) {
          playBtn.textContent = '▶';
          playBtn.setAttribute('aria-label', 'Play video');
          playBtn.title = 'Play';
        } else {
          playBtn.textContent = '❚❚';
          playBtn.setAttribute('aria-label', 'Pause video');
          playBtn.title = 'Pause';
        }
        if (videoEl.muted) {
          muteBtn.textContent = '🔇';
          muteBtn.setAttribute('aria-label', 'Unmute video');
          muteBtn.title = 'Unmute';
        } else {
          muteBtn.textContent = '🔊';
          muteBtn.setAttribute('aria-label', 'Mute video');
          muteBtn.title = 'Mute';
        }
      };

      // Define handlers with named references for cleanup
      const playClickHandler = (e) => {
        e.stopPropagation();
        if (videoEl.paused) {
          videoEl.play().catch(() => {});
        } else {
          videoEl.pause();
        }
        syncControls();
      };

      const muteClickHandler = (e) => {
        e.stopPropagation();
        videoEl.muted = !videoEl.muted;
        syncControls();
      };

      // NOW add listeners with the defined handlers
      playBtn.addEventListener('click', playClickHandler);
      muteBtn.addEventListener('click', muteClickHandler);

      videoEl.addEventListener('play', syncControls);
      videoEl.addEventListener('pause', syncControls);
      videoEl.addEventListener('volumechange', syncControls);
      syncControls();

      // Store ACTUAL handler references for cleanup (all of them)
      videoEl._mvcHandlers = {
        syncControls,
        playClickHandler,
        muteClickHandler
      };
    } else {
      const imgDiv = document.createElement('div');
      imgDiv.className = 'masonry-item-img';

      // Per-card loading spinner (visible until image loads)
      const itemSpinner = document.createElement('div');
      itemSpinner.className = 'masonry-item-spinner';
      itemSpinner.innerHTML = '<div class="loader-spinner loader-spinner--small"></div>';
      imgDiv.appendChild(itemSpinner);

      const img = document.createElement('img');
      img.alt = item.caption || '';
      img.style.opacity = '0';
      img.style.transition = 'opacity 0.3s ease';

      // Set loading strategy BEFORE src so the browser knows intent
      const inViewport = item.y < visibleDepth;
      img.loading = inViewport ? 'eager' : 'lazy';
      img.decoding = 'async';
      if (inViewport) img.fetchPriority = 'high';
      img.src = item.img;

      img.addEventListener('load', () => {
        // Reveal the image and remove the spinner
        img.style.opacity = '1';
        if (itemSpinner.parentNode) itemSpinner.remove();
        this.handleImageLoaded(item.id, img.naturalWidth, img.naturalHeight);
      });
      img.addEventListener('error', () => {
        // Remove spinner on error too — don't leave it spinning forever
        if (itemSpinner.parentNode) itemSpinner.remove();
        img.style.opacity = '1';
      });
      imgDiv.appendChild(img);
      mediaContainer = imgDiv;
    }

    // Append media FIRST so it's under caption overlay in DOM
    wrapper.appendChild(mediaContainer);

    // Add color shift overlay if enabled
    if (this.options.colorShiftOnHover) {
      const overlay = document.createElement('div');
      overlay.className = 'color-overlay';
      overlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(45deg, rgba(255,0,150,0.5), rgba(0,150,255,0.5));
        opacity: 0;
        pointer-events: none;
        border-radius: 8px;
        transition: opacity 0.3s ease;
      `;
      wrapper.appendChild(overlay);
    }

    // Optional caption overlay — append AFTER media+overlay for correct stacking
    if (item.caption) {
      const caption = document.createElement('div');
      caption.className = 'masonry-caption';
      caption.textContent = item.caption;
      wrapper.appendChild(caption);
    }

    // Event listeners (bound once per item, survive across filter changes)
    // Use named references so we can remove them deterministically
    const onClick = (e) => {
      if (this.focusedCard === wrapper && item.url) {
        window.open(item.url, '_blank', 'noopener');
      } else {
        this.toggleFocus(wrapper, item);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleFocus(wrapper, item);
      }
    };
    const onMouseEnter = () => this.handleMouseEnter(wrapper, item);
    const onMouseLeave = () => this.handleMouseLeave(wrapper, item);

    wrapper.addEventListener('click', onClick);
    wrapper.addEventListener('keydown', onKeyDown);
    wrapper.addEventListener('mouseenter', onMouseEnter, { passive: true });
    wrapper.addEventListener('mouseleave', onMouseLeave, { passive: true });

    // Store a single cleanup function for deterministic listener removal
    wrapper._mvcCleanup = () => {
      wrapper.removeEventListener('click', onClick);
      wrapper.removeEventListener('keydown', onKeyDown);
      wrapper.removeEventListener('mouseenter', onMouseEnter);
      wrapper.removeEventListener('mouseleave', onMouseLeave);
      // Also clean up video handlers if present
      const v = wrapper.querySelector('video');
      if (v && v._mvcHandlers) {
        try {
          v.removeEventListener('play', v._mvcHandlers.syncControls);
          v.removeEventListener('pause', v._mvcHandlers.syncControls);
          v.removeEventListener('volumechange', v._mvcHandlers.syncControls);
          const btnPlay = wrapper.querySelector('.mvc-play');
          const btnMute = wrapper.querySelector('.mvc-mute');
          if (btnPlay) btnPlay.removeEventListener('click', v._mvcHandlers.playClickHandler);
          if (btnMute) btnMute.removeEventListener('click', v._mvcHandlers.muteClickHandler);
        } catch (_) {}
      }
    };

    return wrapper;
  }
  
  animateIn() {
    if (this.reduceMotion) {
      this.grid.forEach((item) => {
        const element = this.nodeMap.get(item.id);
        if (!element) return;
        element.style.transition = 'none';
        element.style.opacity = '1';
        element.style.transform = `translate(${item.x}px, ${item.y}px)`;
        element.style.width = `${item.w}px`;
        element.style.height = `${item.h}px`;
        element.style.filter = 'none';
      });
      this.hasMounted = true;
      return;
    }

    // Set transition and initial state before animation
    this.grid.forEach((item, index) => {
      const element = this.nodeMap.get(item.id);
      if (!element) return;
      
      const initialPos = this.getInitialPosition(item, index);
      
      // Enable transitions for animation
      element.style.transition = `all 0.8s cubic-bezier(0.22, 1, 0.36, 1)`;
      
      // Set initial state (off-screen)
      element.style.opacity = '0';
      element.style.transform = `translate(${initialPos.x}px, ${initialPos.y}px)`;
      element.style.width = `${item.w}px`;
      element.style.height = `${item.h}px`;
      if (this.options.blurToFocus) {
        element.style.filter = 'blur(10px)';
      }
    });

    // Force reflow to ensure initial positions are applied before animation
    // This prevents images from stacking at (0,0) during load
    void this.container.offsetHeight;

    // Animate items in with stagger
    this.grid.forEach((item, index) => {
      const element = this.nodeMap.get(item.id);
      if (!element) return;
      
      // Slight delay before animating to ensure initial state is applied on mobile
      const tid = setTimeout(() => {
        if (this.isDestroyed || !this.nodeMap.has(item.id)) return;
        // Animate to final position
        element.style.opacity = '1';
        element.style.transform = `translate(${item.x}px, ${item.y}px)`;
        if (this.options.blurToFocus) {
          element.style.filter = 'blur(0px)';
        }
      }, index * this.options.stagger * 1000 + 16);
      this._animateTimeouts.push(tid);
    });
    
    // Set hasMounted after the last staggered animation fires,
    // so relayouts don't interfere with the entry animation
    const totalDelay = this.grid.length * this.options.stagger * 1000 + 16;
    const mountTid = setTimeout(() => {
      if (!this.isDestroyed) this.hasMounted = true;
    }, totalDelay);
    this._animateTimeouts.push(mountTid);
  }
  
  updateLayout() {
    if (!this.hasMounted) return;

    const transition = this.reduceMotion ? this._transitionNone : this._transitionMove;
    
    this.grid.forEach(item => {
      const element = this.nodeMap.get(item.id);
      if (!element) return;

      element.style.transition = transition;
      element.style.transform = `translate(${item.x}px, ${item.y}px)`;
      element.style.width = `${item.w}px`;
      element.style.height = `${item.h}px`;
      element.style.opacity = '1'; // ensure items are always visible after mount
      element.style.zIndex = item.focused ? '20' : '1';
    });

    this.container.style.height = `${this._cachedMaxHeight}px`;
  }
  
  toggleFocus(element, item) {
    const wasFocused = this.focusedCard === element;
    
    // Remove focus from previously focused card
    if (this.focusedCard && this.focusedCard !== element) {
      // Update baseline when switching cards so unfocus restores to current position
      this.savedScrollY = window.scrollY;
      // Direct handoff: don't collapse layout or restore scroll between A -> B.
      this.unfocusCard(this.focusedCard, { restoreScroll: false, skipLayout: true });
    }
    
    // Toggle the clicked card
    if (wasFocused) {
      this.unfocusCard(element, { restoreScroll: true, skipLayout: false });
      this.focusedCard = null;
    } else {
      // Save scroll position once per focus session (preserve original position when switching cards)
      if (this.savedScrollY === null) {
        this.savedScrollY = window.scrollY;
      }
      
      this.focusCard(element, item);
      this.focusedCard = element;

      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      const scrollBehavior = this.reduceMotion ? 'auto' : 'smooth';

      this.lastFocusWasMobile = isMobile;
      this.focusScrollTargetY = null;

      const getStickyHeaderOffset = () => {
        const header = document.querySelector('header, .navbar, [data-header]');
        if (!header) return 0;
        const pos = window.getComputedStyle(header).position;
        if (pos !== 'sticky' && pos !== 'fixed') return 0;
        const rect = header.getBoundingClientRect();
        return rect.height || header.offsetHeight || 0;
      };

      // Wait for CSS transition to settle before scrolling.
      // Mobile needs more time — layout transitions are 0.6s (600ms),
      // so we wait long enough for the element to reach its final position.
      const scrollDelay = isMobile ? 350 : 80;
      const isChrome = /Chrome/i.test(navigator.userAgent) && !/Edg/i.test(navigator.userAgent);
      
      // Helper: force-scroll to the focused element's current position
      const forceScrollToElement = (smooth) => {
        if (this.focusedCard !== element) return;
        const headerOffset = getStickyHeaderOffset();
        const align = this.options.focusScrollAlign || 'top';
        const topBuffer = isMobile ? 24 : 32;
        const gridItem = this.gridIndex.get(item.id);
        const containerRect = this.container.getBoundingClientRect();
        const containerAbsoluteTop = containerRect.top + window.pageYOffset;
        const gridY = gridItem ? gridItem.y : 0;
        const gridH = gridItem ? gridItem.h : 0;
        const absoluteTargetTop = gridItem
          ? containerAbsoluteTop + gridY
          : null;
        
        // Chrome-specific fix: Use calculated grid coordinates instead of DOM queries
        // during animations. Chrome reads mid-animation positions, causing misalignment.
        if (isChrome) {
          if (!gridItem) return; // Safety check

          let targetY;
          if (align === 'center' && !isMobile) {
            const screenCenter = window.innerHeight / 2;
            const cardCenter = gridH / 2;
            targetY = Math.max(0, Math.round(absoluteTargetTop - (screenCenter - cardCenter)));
          } else {
            targetY = Math.max(0, Math.round(absoluteTargetTop - headerOffset - topBuffer));
          }

          window.scrollTo({ top: targetY, behavior: smooth ? scrollBehavior : 'auto' });
          this.focusScrollTargetY = targetY;
        } else {
          // Firefox and other browsers: Use DOM queries (they handle animation state better)
          const rect = element.getBoundingClientRect();
          const absoluteTop = rect.top + window.pageYOffset;
          const finalTop = (absoluteTargetTop !== null) ? absoluteTargetTop : absoluteTop;
          const finalHeight = gridH || rect.height;

          let targetY;
          if (align === 'center' && !isMobile) {
            targetY = Math.max(0, Math.round(finalTop - (window.innerHeight / 2 - finalHeight / 2)));
          } else {
            targetY = Math.max(0, Math.round(finalTop - headerOffset - topBuffer));
          }
          window.scrollTo({ top: targetY, behavior: smooth ? scrollBehavior : 'auto' });
          this.focusScrollTargetY = targetY;
        }
      };

      setTimeout(() => {
        // Double-check element is still focused (user might have clicked elsewhere)
        if (this.focusedCard !== element) return;
        
        // Primary scroll attempt
        forceScrollToElement(true);
        
        // Chrome: redundant forced scroll after transition fully completes.
        // Chrome sometimes swallows or miscalculates scrollTo during CSS transforms,
        // so we fire again with instant snap (behavior: auto) to ensure final position.
        if (isChrome) {
          setTimeout(() => {
            if (this.focusedCard !== element) return;
            forceScrollToElement(false); // false = instant snap (auto behavior)
          }, isMobile ? 350 : 400); // Mobile: 700ms total, Desktop: 480ms total
        }
      }, scrollDelay);
    }
  }
  
  focusCard(element, item) {
    // Set focused id and reflow grid to push others away
    this.focusedItemId = item.id;
    element.classList.add('card-focused');
    element.setAttribute('aria-pressed', 'true');
    this.calculateGrid();
    this.updateLayout();
    // Play videos when focused (muted, inline)
    if (item.type === 'video' || item.video) {
      const v = element.querySelector('video');
      if (v) {
        try { v.play().catch(() => {}); } catch (_) {}
      }
    }
  }
  
  unfocusCard(element, { restoreScroll = true, skipLayout = false } = {}) {
    element.classList.remove('card-focused');
    element.setAttribute('aria-pressed', 'false');
    const v = element.querySelector('video');
    if (v) {
      v.pause();
    }
    if (!skipLayout) {
      this.focusedItemId = null;
      this.calculateGrid();
      this.updateLayout();
    }
    
    // Restore scroll position to where user was before focusing
    if (restoreScroll && this.savedScrollY !== null) {
      const currentScroll = window.scrollY;
      const restoreToY = this.savedScrollY;
      const scrollBehavior = this.reduceMotion ? 'auto' : 'smooth';

      // More lenient drift detection for mobile — user might have scroll during focus
      // Desktop threshold is larger since smooth scroll might overshoot
      const threshold = this.lastFocusWasMobile 
        ? window.innerHeight * 0.5  // 50% of viewport on mobile
        : window.innerHeight * 0.8; // 80% of viewport on desktop
      
      const anchorY = (typeof this.focusScrollTargetY === 'number') ? this.focusScrollTargetY : currentScroll;

      // Only restore if user hasn't scrolled much since we scrolled them
      if (Math.abs(currentScroll - anchorY) < threshold) {
        // Wait for layout to stabilize before scrolling to ensure correct position
        // Use longer delay on mobile
        const scrollDelay = this.lastFocusWasMobile ? 100 : 0;
        setTimeout(() => {
          // Check that focus hasn't changed since we started unfocusing
          if (this.focusedItemId === null) {
            window.scrollTo({ top: restoreToY, behavior: scrollBehavior });
          }
        }, scrollDelay);
      }

      this.savedScrollY = null;
      this.focusScrollTargetY = null;
      this.lastFocusWasMobile = false;
    } else if (!restoreScroll) {
      // Switching focus: do not restore, preserve savedScrollY baseline.
      this.focusScrollTargetY = null;
      this.lastFocusWasMobile = false;
    }
  }

  initEscapeToClose() {
    if (this.boundHandleKeyDown) return;
    this.boundHandleKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      // Don't steal ESC from form controls
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (this.focusedCard) {
        this.unfocusCard(this.focusedCard, { restoreScroll: true, skipLayout: false });
        this.focusedCard = null;
      }
    };
    document.addEventListener('keydown', this.boundHandleKeyDown);
  }
  
  handleMouseEnter(element, item) {
    // Don't apply hover effects if card is focused
    if (this.focusedCard === element) return;
    
    const latest = this.gridIndex.get(item.id) || item;
    if (this.options.scaleOnHover && this.focusedItemId !== item.id) {
      element.style.transform = `translate(${latest.x}px, ${latest.y}px) scale(${this.options.hoverScale})`;
    }
    
    if (this.options.colorShiftOnHover) {
      const overlay = element.querySelector('.color-overlay');
      if (overlay) {
        overlay.style.opacity = '0.3';
      }
    }
  }
  
  handleMouseLeave(element, item) {
    // Don't remove hover effects if card is focused
    if (this.focusedCard === element) return;
    
    const latest = this.gridIndex.get(item.id) || item;
    if (this.options.scaleOnHover && this.focusedItemId !== item.id) {
      element.style.transform = `translate(${latest.x}px, ${latest.y}px) scale(1)`;
    }
    
    if (this.options.colorShiftOnHover) {
      const overlay = element.querySelector('.color-overlay');
      if (overlay) {
        overlay.style.opacity = '0';
      }
    }
  }
  
  handleResize() {
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => {
      this.updateColumns();
      // Always recalculate and update layout on window resize, not just on column change
      // This ensures fluid responsiveness within breakpoints (e.g., 1100px → 1300px while staying 4 cols)
      this.calculateGrid();
      // Only call render if we haven't mounted yet; otherwise use updateLayout for animation
      if (!this.hasMounted) {
        this.render();
      } else {
        this.updateLayout();
      }
    }, 200);
  }
  
  initClickOutside() {
    if (this.boundHandleDocClick) return;
    this.boundHandleDocClick = (e) => {
      if (!e.target || typeof e.target.closest !== 'function') return;
      const insideCard = e.target.closest('.masonry-item-wrapper');
      if (this.focusedCard && !insideCard) {
        this.unfocusCard(this.focusedCard, { restoreScroll: true });
        this.focusedCard = null;
      }
    };
    document.addEventListener('click', this.boundHandleDocClick);
  }

  setItems(items) {
    if (!items || items.length === 0) return;
    
    // Clear stale focus references if focused item was filtered out
    if (this.focusedItemId && !items.some(i => i.id === this.focusedItemId)) {
      this.focusedItemId = null;
      this.focusedCard = null;
      this.savedScrollY = null;
    }
    
    // Load metadata for any videos we haven't seen yet
    const videoItems = items.filter(
      i => (i.type === 'video' || i.video) && !this.imageMeta[i.video || i.img]
    );
    if (videoItems.length > 0) {
      this.startVideoMetaLoading(videoItems);
    }

    // Normalize items with cached dimensions or defaults
    const normalizedItems = items.map(i => {
      const src = i.video || i.img;
      const meta = this.imageMeta[src];
      if (meta) {
        const ratio = meta.naturalHeight / meta.naturalWidth;
        return { ...i, naturalWidth: meta.naturalWidth, naturalHeight: meta.naturalHeight, ratio };
      }
      // Apply defaults if not in cache
      const naturalWidth = i.width || 1000;
      const naturalHeight = i.height || 1000;
      const ratio = naturalHeight / naturalWidth;
      return { ...i, naturalWidth, naturalHeight, ratio };
    });

    this.items = normalizedItems;
    this._gridHash = ''; // Invalidate cache
    this.calculateGrid();
    this.render();
    this.updateLayout();
  }

  showLoading() {
    if (this.container) {
      this.container.setAttribute('aria-busy', 'true');
      // Ensure container has minimum height so the spinner is visible
      if (!this.container.style.minHeight) {
        this.container.style.minHeight = '300px';
      }
    }
    // Prevent stacking multiple loaders
    if (this.container.querySelector('.masonry-loader')) return;
    
    const loader = document.createElement('div');
    loader.className = 'masonry-loader';
    loader.innerHTML = '<div class="loader-spinner"></div><p>Loading gallery\u2026</p>';
    this.container.appendChild(loader);
  }

  hideLoading() {
    const loader = this.container.querySelector('.masonry-loader');
    if (loader) {
      loader.remove();
    }
    if (this.container) {
      this.container.setAttribute('aria-busy', 'false');
      this.container.style.minHeight = '';
    }
  }

  destroy() {
    this.isDestroyed = true;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    window.removeEventListener('resize', this.boundHandleResize);
    if (this.boundHandleDocClick) {
      document.removeEventListener('click', this.boundHandleDocClick);
      this.boundHandleDocClick = null;
    }
    if (this.boundHandleKeyDown) {
      document.removeEventListener('keydown', this.boundHandleKeyDown);
      this.boundHandleKeyDown = null;
    }
    if (this.motionMedia) {
      try {
        this.motionMedia.removeEventListener('change', this.boundHandleMotionChange);
      } catch (_) {
        try { this.motionMedia.removeListener(this.boundHandleMotionChange); } catch (_) {}
      }
    }
    if (this._relayoutTimer) {
      cancelAnimationFrame(this._relayoutTimer);
      this._relayoutTimer = null;
    }
    // Clear any in-flight animation stagger timeouts
    if (this._animateTimeouts && this._animateTimeouts.length > 0) {
      this._animateTimeouts.forEach(clearTimeout);
      this._animateTimeouts = [];
    }
    // Clean up video metadata loaders
    if (this._videoMetaLoaders && this._videoMetaLoaders.length > 0) {
      this._videoMetaLoaders.forEach(({ video, onLoadedMetadata, onError }) => {
        try {
          video.removeEventListener('loadedmetadata', onLoadedMetadata);
          video.removeEventListener('error', onError);
          video.src = '';
        } catch (_) {}
      });
      this._videoMetaLoaders = [];
    }
    this.nodeMap.clear();
    this.gridIndex.clear();
    this.container.innerHTML = '';
    this.focusedCard = null;
    this.focusedItemId = null;
    this.savedScrollY = null;
    this.focusScrollTargetY = null;
    this.lastFocusWasMobile = false;
  }
}

// =============================================================================
// GALLERY MANAGER
// =============================================================================

// Supabase config (anon key is safe to expose)
const GALLERY_SUPABASE_URL = 'https://pciubbwphwpnptgawgok.supabase.co';
const GALLERY_SUPABASE_KEY = 'sb_publishable_jz1pWpo7TDvURxQ8cqP06A_xc4ckSwv';

const GalleryManager = {
  gallery: null,
  initialized: false,
  initializing: false,
  allRows: [],       // raw DB rows (unfiltered)
  container: null,
  galleryOptions: {
    ease: 'power3.out',
    duration: 0.6,
    stagger: 0.05,
    animateFrom: 'bottom',
    scaleOnHover: true,
    hoverScale: 0.98,
    blurToFocus: true,
    colorShiftOnHover: false
  },

  buildCaption(title, medium, year) {
    let c = title || '';
    const meta = [medium, year].filter(Boolean).join(' ');
    if (meta) {
      c = c ? `${c} - ${meta}` : meta;
    }
    return c;
  },

  rowToItem(row) {
    return {
      id: row.id,
      img: row.img_url,
      height: 500,
      caption: this.buildCaption(row.title, row.medium, row.year_created),
      url: null,
      // keep metadata for filtering
      _medium: row.medium || null,
      _year: row.year_created || null,
      _sortOrder: row.sort_order,
      _createdAt: row.created_at
    };
  },

  // ---- Filter / Sort helpers ----
  populateFilterDropdowns() {
    const mediumSelect = document.getElementById('filterMedium');
    const yearSelect   = document.getElementById('filterYear');
    const filtersBar   = document.getElementById('gallery-filters');
    if (!mediumSelect || !yearSelect || !filtersBar) return;

    // Unique non-null mediums
    const mediums = [...new Set(this.allRows.map(r => r.medium).filter(Boolean))].sort();
    mediumSelect.innerHTML = '<option value="">All Mediums</option>' +
      mediums.map(m => `<option value="${m}">${m}</option>`).join('');

    // Unique non-null years, descending
    const years = [...new Set(this.allRows.map(r => r.year_created).filter(Boolean))].sort((a,b) => b - a);
    yearSelect.innerHTML = '<option value="">All Years</option>' +
      years.map(y => `<option value="${y}">${y}</option>`).join('');

    filtersBar.hidden = false;
  },

  getFilteredItems() {
    const mediumVal = (document.getElementById('filterMedium') || {}).value || '';
    const yearVal   = (document.getElementById('filterYear') || {}).value || '';
    const sortVal   = (document.getElementById('sortDate') || {}).value || 'default';

    let rows = this.allRows;

    if (mediumVal) rows = rows.filter(r => r.medium === mediumVal);
    if (yearVal)   rows = rows.filter(r => String(r.year_created) === yearVal);

    // Only create a mutable copy when we need to sort (filter returns new array already)
    if (sortVal === 'newest') {
      rows = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sortVal === 'oldest') {
      rows = [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    // 'default' keeps DB order (sort_order ASC, created_at DESC)

    return rows.map(r => this.rowToItem(r));
  },

  applyFilters() {
    if (!this.container) return;
    const items = this.getFilteredItems();
    if (items.length === 0) {
      if (this.gallery) {
        this.gallery.destroy();
        this.gallery = null;
      }
      this.container.innerHTML = '<p class="muted-center">No artwork matches your filters.</p>';
      this.container.style.height = '';
      return;
    }

    if (this.gallery && !this.gallery.isDestroyed) {
      // Reuse the existing gallery instance — use setItems to properly handle video metadata
      this.gallery.setItems(items);
      return;
    }

    // First time or after empty state — create fresh
    // SAFETY: Ensure we don't have a lingering instance
    if (this.gallery) this.gallery.destroy();
    
    this.gallery = new MasonryGallery(this.container, this.galleryOptions);
    this.gallery.init(items);
    this.gallery.initClickOutside();
    this.gallery.initEscapeToClose();
  },

  bindFilterEvents() {
    ['filterMedium', 'filterYear', 'sortDate'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => this.applyFilters());
    });
  },

  async init() {
    this.container = document.querySelector('#masonry-gallery');
    if (!this.container) {
      console.log('Gallery Manager: Container not found');
      return;
    }

    if (this.initialized || this.initializing) return;
    this.initializing = true;

    // Show spinner immediately so it's visible during Supabase fetch
    this._showManagerSpinner();

    try {
      // Fetch gallery items from Supabase
      if (typeof supabase === 'undefined') {
        // Supabase script may be loading async, retry with backoff
        // CRITICAL: Reset flag BEFORE early return so retry can execute
        this.initializing = false;
        
        if (!this._supabaseRetryTimer) {
          this._supabaseRetryTimer = setTimeout(() => {
            this._supabaseRetryTimer = null;
            this.init();
          }, 200);
        }
        return;
      }

      const db = supabase.createClient(GALLERY_SUPABASE_URL, GALLERY_SUPABASE_KEY);
      const { data, error } = await db
        .from('gallery_items')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;

      this.allRows = data || [];
      console.log(`🎨 Loaded ${this.allRows.length} gallery items from database`);

      if (this.allRows.length === 0) {
        this._hideManagerSpinner();
        this.container.innerHTML = '<p class="muted-center">No artwork to display yet.</p>';
        return;
      }

      // Populate filter dropdowns
      this.populateFilterDropdowns();
      this.bindFilterEvents();

      const items = this.getFilteredItems();

      // Remove manager-level spinner — MasonryGallery.init() manages its own
      // showLoading/hideLoading lifecycle, but it will reuse the existing 
      // .masonry-loader DOM node if still present (prevents flicker).
      this.gallery = new MasonryGallery(this.container, this.galleryOptions);
      this.gallery.init(items);
      this.gallery.initClickOutside();
      this.gallery.initEscapeToClose();
      this.initialized = true;

      console.log('🎨 Masonry Gallery Initialized');
    } catch (err) {
      console.error('Failed to load gallery from database:', err);
      this._hideManagerSpinner();
      this.container.innerHTML = '<p class="muted-center">Gallery temporarily unavailable. Please try refreshing.</p>';
    } finally {
      this.initializing = false;
    }
  },
  
  checkAndInit() {
    // Check if gallery tab is active
    const galleryTab = document.getElementById('tab-gallery');
    if (galleryTab && galleryTab.checked && !this.initialized) {
      this.init();
    }
  },
  
  destroy() {
    if (this.gallery) {
      this.gallery.destroy();
    }
    this._hideManagerSpinner();
    if (this._supabaseRetryTimer) {
      clearTimeout(this._supabaseRetryTimer);
      this._supabaseRetryTimer = null;
    }
  },

  // Show spinner directly in the container (before MasonryGallery exists)
  _showManagerSpinner() {
    if (!this.container) return;
    if (this.container.querySelector('.masonry-loader')) return;
    this.container.setAttribute('aria-busy', 'true');
    this.container.style.minHeight = '300px';
    const loader = document.createElement('div');
    loader.className = 'masonry-loader';
    loader.innerHTML = '<div class="loader-spinner"></div><p>Loading gallery\u2026</p>';
    this.container.appendChild(loader);
  },

  _hideManagerSpinner() {
    if (!this.container) return;
    const loader = this.container.querySelector('.masonry-loader');
    if (loader) loader.remove();
    this.container.setAttribute('aria-busy', 'false');
    this.container.style.minHeight = '';
  }
};

// Initialize when DOM is ready or when gallery tab is clicked
const setupGalleryTabListener = () => {
  const galleryTab = document.getElementById('tab-gallery');
  if (galleryTab) {
    galleryTab.addEventListener('change', () => {
      if (galleryTab.checked) {
        GalleryManager.init();
      }
    });
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    GalleryManager.checkAndInit();
    setupGalleryTabListener();
  });
} else {
  GalleryManager.checkAndInit();
  setupGalleryTabListener();
}


