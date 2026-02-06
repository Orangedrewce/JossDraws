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
const GalleryManager = {
  gallery: null,
  initialized: false,
  
  init() {
    const container = document.querySelector('#masonry-gallery');
    if (!container) {
      console.log('Gallery Manager: Container not found');
      return;
    }
    
    if (this.initialized) {
      return;
    }
    
    // Gallery items - add your artwork here
    const items = [
        {
        id: 5,
        img: 'https://lh3.googleusercontent.com/d/1I6LVmJ8YaZGMHRvMBfr5z4m1t7xebRep',
        height: 700,
        caption: 'Rolling Smoke BBQ Logo - 2024',
        url: null
      },
      {
        id: 2,
        img: 'https://lh3.googleusercontent.com/d/1wHHv0MmFO2hlyp3-ZH0IfmzPMLs-9z-A',
        height: 1000,
        caption: 'Rough Waters - Digital 2025',
        url: null
      },
            {
        id: 3,
        img: 'Sluggish Video.gif',
        height: 500,
        caption: 'Sluggish',
        url: null
      },
        {
        id: 4,
        img: 'https://lh3.googleusercontent.com/d/1UowtMnKTaGaAewvtskt0Th7NwyE30m2w',
        height: 500,
        caption: 'Frogs & Water Lillies',
        url: null
      },
      
      {
        id: 1,
        img: 'https://lh3.googleusercontent.com/d/1-hBSz08nhnlQgDTa42kC6VmVRu6V0FF2',
        height: 1000,
        caption: 'Moab - Digital 2025',
        url: null
      },
      {
        id: 6,
        img: 'https://lh3.googleusercontent.com/d/1Mzq-4TbJLSUnPplMJjGYItda_-mP9Gvf',
        height: 800,
        caption: 'La Soldadera Tortillería Logo - Digital 2024',
        url: null
      },
      {
        id: 7,
        img: 'https://lh3.googleusercontent.com/d/1knGdm-AS_SbJWyun2RFBuMdrdpbrZbrc',
        height: 500,
        caption: 'Adventures',
        url: null
      },
            {
        id: 8,
        img: 'Duck Video.gif',
        height: 500,
        caption: 'Ducky - Canvas 2022',
        url: null
      },

      {
        id: 9,
        img: 'https://lh3.googleusercontent.com/d/1aua1ENqaboyxTNhwwbi0HCgDAKC9DM-G',
        height: 850,
        caption: 'The Last Breath - Canvas 2023',
        url: null
      },
      {
        id: 10,
        img: 'https://lh3.googleusercontent.com/d/147bGQWKbD8xN-VWBItgqD7zgfBpVBXcU',
        height: 750,
        caption: 'Team Work - Digital 2025',
        url: null
      },
      {
        id: 11,
        img: 'https://lh3.googleusercontent.com/d/1T5oH7rm4XEsqwIwOO8dMQVWi-hJ3Wny6',
        height: 900,
        caption: 'Boo - Canvas 2021',
        url: null
      },
      {
        id: 12,
        img: 'https://lh3.googleusercontent.com/d/120-vRBrePRfIH7WEZd_zW71BbomUuDiA',
        height: 750,
        caption: 'Cherry Blossoms - Canvas 2021',
        url: null
      },
      {
        id: 13,
        img: 'Flower Eyes Video.gif',
        height: 500,
        caption: 'Flower eyes',
        url: null
      },
      {
        id: 14,
        img: 'https://lh3.googleusercontent.com/d/15vMGTleAkU0_NtW13JmKOuJYwzvT-xVp',
        height: 850,
        caption: 'Daisy - digital 2021',
        url: null
      },
      {
        id: 15,
        img: 'https://lh3.googleusercontent.com/d/1ca10dQkjCibal18uVaTvcg4BVK0EkRLU',
        height: 500,
        caption: 'Scooby Doo',
        url: null
      },
      {
        id: 16,
        img: 'https://lh3.googleusercontent.com/d/19XP5PbC2tJ0TJBAQicng2F3gnhKaYTd1',
        height: 500,
        caption: 'Maternity',
        url: null
      },
      {
        id: 17,
        img: 'https://lh3.googleusercontent.com/d/1g_8pbLKU4glncvY0Uo4DchpAM72yu6Uo',
        height: 500,
        caption: 'Ghostface',
        url: null
      },
      {
        id: 18,
        img: 'https://lh3.googleusercontent.com/d/11JNj9fAQN3q2-ZK7uFDG8UorkDl_po6s',
        height: 900,
        caption: 'Colby Trice Logo - Digital 2023',
        url: null
      },
      {
        id: 20,
        img: 'https://lh3.googleusercontent.com/d/1RNaGFfGE3oWrdYMfJ58r7jIof2aWqdJi',
        height: 500,
        caption: 'Painted Skull',
        url: null
      },
      {
        id: 21,
        img: 'https://lh3.googleusercontent.com/d/13DUuv_-UpCmu4c7RMz0oSOlJmiaDrEgk',
        height: 500,
        caption: 'Cat Skull Wine Label',
        url: null
      },
      {
        id: 22,
        img: 'https://lh3.googleusercontent.com/d/17zjnl-v5zkcGjrO3Hz8GZQMHEMg858vr',
        height: 500,
        caption: 'Eyeball sucker wine label',
        url: null
      },
      {
        id: 23,
        img: 'Sewing Machine Case Video.gif',
        height: 500,
        caption: 'Sewing Machine Case',
        url: null
      },

      {
        id: 24,
        img: 'https://lh3.googleusercontent.com/d/1KckyqJjziJbk4bW2uh_oD6Zi8AsQ6Jiq',
        height: 500,
        caption: 'Mushroom Commission',
        url: null
      },
      {
        id: 25,
        img: 'https://lh3.googleusercontent.com/d/1afXRiq9Jvpwcxc286gIxw4Y3sUYaWfjB',
        height: 500,
        caption: 'Car Portrait',
        url: null
      },


      {
        id: 27,
        img: 'https://lh3.googleusercontent.com/d/1kRxcexcr3p9uXEoNx0nSXPTV7MTPfwFd',
        height: 500,
        caption: 'Bison',
        url: null
      },
      {id: 28,
        img: 'https://lh3.googleusercontent.com/d/1Qm9YemFG8iOG1gXuYWOucpBIPw6f7rrK',
        height: 500,
        caption: 'Heart walk 2021',
        url: null
      },
            {
        id: 29,
        img: 'https://lh3.googleusercontent.com/d/1ZmKrnDAOcAog7mpJXdUx9aa0TQfmValf',
        height: 750,
        caption: 'VLOSH Logo - Digital 2024',
        url: null
      },

    ];
    
    const options = {
      ease: 'power3.out',
      duration: 0.6,
      stagger: 0.05,
      animateFrom: 'bottom',
      scaleOnHover: true,
      hoverScale: 0.98,
      blurToFocus: true,
      colorShiftOnHover: false
    };
    
    this.gallery = new MasonryGallery(container, options);
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



