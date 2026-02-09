// =============================================================================
// MASONRY GALLERY - Infinite Scroll Layout
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
    this.imagesReady = false;
    this.hasMounted = false;
    this.resizeTimeout = null;
    // Track focused item for reflowing the grid
    this.focusedItemId = null;
    // Store natural media dimensions keyed by src
    this.imageMeta = {};
    // Bound event handler for cleanup
    this.boundHandleResize = () => this.handleResize();
  }
  
  async init(items) {
    this.items = items;
    
  // Preload images/videos and capture natural dimensions
  await this.preloadMedia(items);
    this.imagesReady = true;

    // Merge natural dimensions onto items and compute aspect ratios
    this.items = this.items.map(i => {
      const src = i.video || i.img;
      const meta = this.imageMeta[src] || {};
      const naturalWidth = meta.naturalWidth || i.width || 1000;
      const naturalHeight = meta.naturalHeight || i.height || 1000;
      const ratio = naturalHeight / naturalWidth; // h/w
      return { ...i, naturalWidth, naturalHeight, ratio };
    });
    
    // Calculate responsive columns
    this.updateColumns();
    
    // Set up resize observer
    this.setupResizeObserver();
    
    // Initial layout
    this.calculateGrid();
    this.render();
    this.animateIn();
    
    // Set up window resize
    window.addEventListener('resize', this.boundHandleResize);
  }
  
  async preloadMedia(items) {
    const meta = {};
    await Promise.all(
      items.map(item => new Promise(resolve => {
        const src = item.video || item.img;
        if (item.type === 'video' || item.video) {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.src = src;
          video.addEventListener('loadedmetadata', () => {
            meta[src] = {
              naturalWidth: video.videoWidth || 1000,
              naturalHeight: video.videoHeight || 1000,
              isVideo: true
            };
            resolve();
          });
          video.onerror = () => resolve();
        } else {
          const img = new Image();
          img.src = src;
          img.onload = () => {
            meta[src] = {
              naturalWidth: img.naturalWidth || img.width,
              naturalHeight: img.naturalHeight || img.height,
              isVideo: false
            };
            resolve();
          };
          img.onerror = () => resolve();
        }
      }))
    );
    this.imageMeta = meta;
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
    const ro = new ResizeObserver(() => {
      this.width = this.container.offsetWidth;
      this.calculateGrid();
      this.updateLayout();
    });
    ro.observe(this.container);
    this.resizeObserver = ro;
  }
  
  calculateGrid() {
    this.width = this.container.offsetWidth;
    if (!this.width) return;
    
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
        const h = Math.max(child.height / 2, Math.floor(window.innerHeight * 0.9));
        for (let i = 0; i < colHeights.length; i++) {
          colHeights[i] = y + h;
        }
        layoutMap.set(child.id, { ...child, x: 0, y, w, h, focused: true });
        return;
      }
      const col = colHeights.indexOf(Math.min(...colHeights));
      const x = columnWidth * col;
      // Use natural aspect ratio to compute precise height for dense layout
      const ratio = child.ratio || (child.height && child.width ? child.height / child.width : 1);
      const height = Math.max(80, Math.round(columnWidth * ratio));
      const y = colHeights[col];
      colHeights[col] += height;
      layoutMap.set(child.id, { ...child, x, y, w: columnWidth, h: height, focused: false });
    });

    this.grid = this.items
      .map(child => layoutMap.get(child.id))
      .filter(Boolean);
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
    this.container.innerHTML = '';
    this.container.style.position = 'relative';
    this.container.style.width = '100%';
    this.focusedCard = null;
    
    this.grid.forEach(item => {
      const wrapper = document.createElement('div');
      wrapper.className = 'masonry-item-wrapper';
      wrapper.dataset.key = item.id;
      wrapper.setAttribute('tabindex', '0');
      wrapper.setAttribute('role', 'button');
      wrapper.setAttribute('aria-pressed', 'false');
      wrapper.style.cssText = `
        position: absolute;
        cursor: pointer;
        overflow: hidden;
        border-radius: 8px;
        transition: transform 0.3s ease, z-index 0s;
        z-index: 1;
      `;
      
      // Media rendering (image or video)
      let mediaContainer;
      if (item.type === 'video' || item.video) {
        mediaContainer = document.createElement('div');
        mediaContainer.className = 'masonry-item-video';
        const videoEl = document.createElement('video');
        videoEl.src = item.video || item.img;
        // No poster by default (keeps layout simple)
  // if (item.poster) videoEl.poster = item.poster;
  videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.setAttribute('playsinline', '');
        // Loop by default unless explicitly disabled on the item
        videoEl.loop = item.loop !== false;
  // Keep network use light until focus
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

        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (videoEl.paused) {
            videoEl.play().catch(() => {});
          } else {
            videoEl.pause();
          }
          syncControls();
        });

        muteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          videoEl.muted = !videoEl.muted;
          syncControls();
        });

        videoEl.addEventListener('play', syncControls);
        videoEl.addEventListener('pause', syncControls);
        videoEl.addEventListener('volumechange', syncControls);
        // Initialize control state
        syncControls();
      } else {
        const imgDiv = document.createElement('div');
        imgDiv.className = 'masonry-item-img';
        imgDiv.style.cssText = `
          background-image: url('${item.img}');
        `;
        mediaContainer = imgDiv;
      }

      // Optional caption overlay that fades on hover/focus
      if (item.caption) {
        const caption = document.createElement('div');
        caption.className = 'masonry-caption';
        caption.textContent = item.caption;
        wrapper.appendChild(caption);
      }
      
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
        // Append overlay to media container if it's the image div; for video, overlay on wrapper is ok too
        mediaContainer.appendChild(overlay);
      }
      
      wrapper.appendChild(mediaContainer);
      
      // Event listeners
      wrapper.addEventListener('click', (e) => {
        // Check if we're clicking an already focused card with a URL
        if (this.focusedCard === wrapper && item.url) {
          window.open(item.url, '_blank', 'noopener');
        } else {
          this.toggleFocus(wrapper, item);
        }
      });
      
      wrapper.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggleFocus(wrapper, item);
        }
      });
      
      wrapper.addEventListener('mouseenter', () => this.handleMouseEnter(wrapper, item));
      wrapper.addEventListener('mouseleave', () => this.handleMouseLeave(wrapper, item));
      
      this.container.appendChild(wrapper);
    });
    
    // Set container height
    const maxHeight = Math.max(...this.grid.map(item => item.y + item.h));
    this.container.style.height = `${maxHeight}px`;
  }
  
  animateIn() {
    this.grid.forEach((item, index) => {
      const element = this.container.querySelector(`[data-key="${item.id}"]`);
      if (!element) return;
      
      const initialPos = this.getInitialPosition(item, index);
      
      // Set initial state
      element.style.opacity = '0';
      element.style.transform = `translate(${initialPos.x}px, ${initialPos.y}px)`;
      element.style.width = `${item.w}px`;
      element.style.height = `${item.h}px`;
      if (this.options.blurToFocus) {
        element.style.filter = 'blur(10px)';
      }
      
      // Animate to final position
      setTimeout(() => {
        element.style.transition = `all 0.8s cubic-bezier(0.22, 1, 0.36, 1)`;
        element.style.opacity = '1';
        element.style.transform = `translate(${item.x}px, ${item.y}px)`;
        if (this.options.blurToFocus) {
          element.style.filter = 'blur(0px)';
        }
      }, index * this.options.stagger * 1000);
    });
    
    this.hasMounted = true;
  }
  
  updateLayout() {
    if (!this.hasMounted) return;
    
    this.grid.forEach(item => {
      const element = this.container.querySelector(`[data-key="${item.id}"]`);
      if (!element) return;
      
      element.style.transition = `all ${this.options.duration}s cubic-bezier(0.22, 1, 0.36, 1)`;
      element.style.transform = `translate(${item.x}px, ${item.y}px)`;
      element.style.width = `${item.w}px`;
      element.style.height = `${item.h}px`;
      const imgDiv = element.querySelector('.masonry-item-img');
      if (imgDiv) {
        imgDiv.style.backgroundImage = `url('${item.img}')`;
      }
    });
    
    const maxHeight = Math.max(...this.grid.map(item => item.y + item.h));
    this.container.style.height = `${maxHeight}px`;
  }
  
  toggleFocus(element, item) {
    const wasFocused = this.focusedCard === element;
    
    // Remove focus from previously focused card
    if (this.focusedCard && this.focusedCard !== element) {
      this.unfocusCard(this.focusedCard);
    }
    
    // Toggle the clicked card
    if (wasFocused) {
      this.unfocusCard(element);
      this.focusedCard = null;
    } else {
      this.focusCard(element, item);
      this.focusedCard = element;
      
      // Smooth scroll to focused card
      setTimeout(() => {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
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
  
  unfocusCard(element) {
    element.classList.remove('card-focused');
    element.setAttribute('aria-pressed', 'false');
    const v = element.querySelector('video');
    if (v) {
      v.pause();
    }
    this.focusedItemId = null;
    this.calculateGrid();
    this.updateLayout();
  }
  
  handleMouseEnter(element, item) {
    // Don't apply hover effects if card is focused
    if (this.focusedCard === element) return;
    
    const latest = this.grid.find(i => i.id === item.id) || item;
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
    
    const latest = this.grid.find(i => i.id === item.id) || item;
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
      const oldColumns = this.columns;
      this.updateColumns();
      
      if (oldColumns !== this.columns) {
        this.calculateGrid();
        this.render();
        this.updateLayout();
      }
    }, 200);
  }
  
  initClickOutside() {
    document.addEventListener('click', (e) => {
      const insideCard = e.target.closest('.masonry-item-wrapper');
      if (this.focusedCard && !insideCard) {
        this.unfocusCard(this.focusedCard);
        this.focusedCard = null;
      }
    });
  }
  
  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    window.removeEventListener('resize', this.boundHandleResize);
    this.container.innerHTML = '';
    this.focusedCard = null;
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
    if (medium || year) {
      c += ' - ';
      if (medium) c += medium;
      if (medium && year) c += ' ';
      if (year) c += year;
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

    let rows = [...this.allRows];

    if (mediumVal) rows = rows.filter(r => r.medium === mediumVal);
    if (yearVal)   rows = rows.filter(r => String(r.year_created) === yearVal);

    if (sortVal === 'newest') {
      rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sortVal === 'oldest') {
      rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    // 'default' keeps DB order (sort_order ASC, created_at DESC)

    return rows.map(r => this.rowToItem(r));
  },

  applyFilters() {
    if (!this.gallery || !this.container) return;
    const items = this.getFilteredItems();
    if (items.length === 0) {
      this.container.innerHTML = '<p class="muted-center">No artwork matches your filters.</p>';
      this.container.style.height = '';
      return;
    }
    this.gallery.destroy();
    this.gallery = new MasonryGallery(this.container, this.galleryOptions);
    this.gallery.init(items);
    this.gallery.initClickOutside();
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

    if (this.initialized) return;

    // Fetch gallery items from Supabase
    try {
      if (typeof supabase === 'undefined') {
        throw new Error('Supabase SDK not loaded');
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
    } catch (err) {
      console.error('Failed to load gallery from database:', err);
      this.container.innerHTML = '<p class="muted-center">Gallery temporarily unavailable. Please try refreshing.</p>';
      return;
    }

    if (this.allRows.length === 0) {
      this.container.innerHTML = '<p class="muted-center">No artwork to display yet.</p>';
      return;
    }

    // Populate filter dropdowns
    this.populateFilterDropdowns();
    this.bindFilterEvents();

    const items = this.getFilteredItems();

    this.gallery = new MasonryGallery(this.container, this.galleryOptions);
    this.gallery.init(items);
    this.gallery.initClickOutside();
    this.initialized = true;

    console.log('🎨 Masonry Gallery Initialized');
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
  }
};

// Initialize when DOM is ready or when gallery tab is clicked
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    GalleryManager.checkAndInit();
    
    // Listen for tab changes
    const galleryTab = document.getElementById('tab-gallery');
    if (galleryTab) {
      galleryTab.addEventListener('change', () => {
        if (galleryTab.checked) {
          GalleryManager.init();
        }
      });
    }
  });
} else {
  GalleryManager.checkAndInit();
  
  // Listen for tab changes
  const galleryTab = document.getElementById('tab-gallery');
  if (galleryTab) {
    galleryTab.addEventListener('change', () => {
      if (galleryTab.checked) {
        GalleryManager.init();
      }
    });
  }
}


