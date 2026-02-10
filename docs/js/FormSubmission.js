// =============================================================================
// CONSTANTS & CONFIGURATION
// =============================================================================
const CONFIG = {
  formspreeEndpoint: 'https://formspree.io/f/mqaglzrb',
  messageTimeout: 5000,
  pagination: {
    // If true, the grid will auto-scroll into view when changing pages
    scrollOnChange: false,
    scrollBehavior: 'smooth',
    scrollBlock: 'start'
  },
  logging: {
    enabled: false,
    verbose: false
  }
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================
const Logger = {
  log(category, data) {
    if (!CONFIG.logging.enabled) return;
    
    console.log(`=== ${category.toUpperCase()} ===`);
    if (typeof data === 'object') {
      Object.entries(data).forEach(([key, value]) => {
        console.log(`${key}:`, value);
      });
    } else {
      console.log(data);
    }
  },
  
  error(category, error) {
    console.error(`=== ${category.toUpperCase()} ERROR ===`);
    console.error('Message:', error.message);
    if (CONFIG.logging.verbose) {
      console.error('Full Error:', error);
    }
  }
};

const DOM = {
  getElement(selector) {
    const element = document.querySelector(selector);
    if (!element && CONFIG.logging.verbose) {
      console.warn(`Element not found: ${selector}`);
    }
    return element;
  },
  
  getElements(selector) {
    return document.querySelectorAll(selector);
  }
};

// =============================================================================
// PAGE INITIALIZATION
// =============================================================================
function initPageLogging() {
  Logger.log('Page Loaded', {
    'Timestamp': new Date().toLocaleString(),
    'User Agent': navigator.userAgent,
    'Window Size': `${window.innerWidth}x${window.innerHeight}`,
    'Screen Size': `${screen.width}x${screen.height}`,
    'Language': navigator.language
  });
}

// =============================================================================
// HERO LINK HANDLER (Replaces inline onclick)
// =============================================================================
const HeroLinkManager = {
  init() {
    const heroLink = DOM.getElement('.hero-image-link[data-tab-target]');
    if (!heroLink) return;
    
    heroLink.addEventListener('click', (e) => {
      e.preventDefault();
      const targetTab = heroLink.getAttribute('data-tab-target');
      const tabInput = DOM.getElement(`#tab-${targetTab}`);
      
      if (tabInput) {
        tabInput.click();
        
        Logger.log('Hero Link Clicked', {
          'Target Tab': targetTab,
          'Timestamp': new Date().toLocaleTimeString()
        });
      }
    });
  }
};

// =============================================================================
// TAB NAVIGATION
// =============================================================================
const TabManager = {
  init() {
    this.attachListeners();
    this.makeLabelsAccessible();
    this.handleInitialLoad();
    window.addEventListener('hashchange', () => this.syncToHash());
  },
  
  getTabName(tabId) {
    return tabId.replace('tab-', '');
  },
  
  getTabId(tabName) {
    return `tab-${tabName}`;
  },
  
  attachListeners() {
    DOM.getElements('input[type="radio"][name="tabs"]').forEach(tab => {
      tab.addEventListener('change', (e) => this.handleTabChange(e));
    });
  },
  
  handleTabChange(event) {
    if (!event.target.checked) return;
    
    const tabId = event.target.id;
    const tabName = this.getTabName(tabId);
    
    // Update the URL hash
    window.location.hash = tabName;
    
    Logger.log('Tab Changed', {
      'Tab ID': tabId,
      'Tab Name': tabName.toUpperCase(),
      'Timestamp': new Date().toLocaleTimeString()
    });
  },
  
  handleInitialLoad() {
    if (!this.syncToHash()) {
      const initialTabId = 'tab-home';
      const tabToLoad = DOM.getElement(`#${initialTabId}`);
      if (tabToLoad) {
        tabToLoad.checked = true;
      }
      Logger.log('Initial Tab', {
        'Tab ID': initialTabId,
        'Tab Name': this.getTabName(initialTabId).toUpperCase()
      });
    }
  },

  // Sync tab selection to current URL hash.
  // Supports direct tab names (e.g., #contact) and anchors within sections (e.g., #contact-heading).
  syncToHash() {
    const rawHash = window.location.hash.replace('#', '');
    if (!rawHash) return false;

    // Direct match to tab name
    const directTab = DOM.getElement(`#tab-${rawHash}`);
    if (directTab) {
      directTab.checked = true;
      return true;
    }

    // Anchor inside a tab section
    const target = DOM.getElement(`#${rawHash}`);
    if (target) {
      const section = target.closest('section');
      if (section && section.classList) {
        const tabClass = Array.from(section.classList).find(c => c.startsWith('tab-'));
        if (tabClass) {
          const input = DOM.getElement(`#${tabClass}`);
          if (input) {
            input.checked = true;
            return true;
          }
        }
      }
    }
    return false;
  },
  
  makeLabelsAccessible() {
    DOM.getElements('label[for^="tab-"]').forEach(label => {
      label.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const targetInput = DOM.getElement(`#${label.getAttribute('for')}`);
          if (targetInput) {
            targetInput.click();
            targetInput.checked = true; // Ensure state is set
          }
        }
      });
    });
  }
};

// =============================================================================
// FORM HANDLING
// =============================================================================
const FormManager = {
  form: null,
  messageDiv: null,
  messageTimeoutId: null,
  
  init() {
    this.form = DOM.getElement('#contact-form');
    this.messageDiv = DOM.getElement('#form-message');
    
    if (!this.form) {
      Logger.log('Form Manager', 'Contact form not found on page');
      return;
    }
    
    this.attachListeners();
    this.attachInputLoggers();
  },
  
  attachListeners() {
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));
  },
  
  attachInputLoggers() {
    const inputs = this.form.querySelectorAll('input, textarea');
    
    inputs.forEach(input => {
      input.addEventListener('focus', () => {
        Logger.log('User Input', {
          'Field Focused': input.id || input.name,
          'Field Type': input.type || 'textarea'
        });
      });
      
      input.addEventListener('blur', () => {
        Logger.log('Field Completed', {
          'Field': input.id || input.name,
          'Value Length': `${input.value.length} characters`,
          'Is Valid': input.checkValidity()
        });
      });
    });
  },
  
  async handleSubmit(event) {
    event.preventDefault();
    
    const formData = new FormData(this.form);
    
    this.logSubmissionStart(formData);
    this.showMessage('Sending your message...', 'info');
    
    try {
      const response = await this.submitForm(formData);
      await this.handleResponse(response);
    } catch (error) {
      this.handleError(error);
    }
  },
  
  logSubmissionStart(formData) {
    Logger.log('Form Submission Started', {
      'Name': formData.get('name'),
      'Email': formData.get('email'),
      'Message Length': `${formData.get('message').length} characters`,
      'Timestamp': new Date().toLocaleString()
    });
  },
  
  async submitForm(formData) {
    return fetch(CONFIG.formspreeEndpoint, {
      method: 'POST',
      body: formData,
      headers: {
        'Accept': 'application/json'
      }
    });
  },
  
  async handleResponse(response) {
    Logger.log('Form Response Received', {
      'Status Code': response.status,
      'Status Text': response.statusText,
      'Response Time': new Date().toLocaleTimeString()
    });
    
    if (response.ok) {
      this.handleSuccess();
      return;
    }

    // Graceful fallback: try JSON, then text, then generic
    let message = 'Form submission failed';
    try {
      const data = await response.json();
      message = data.error || data.message || message;
    } catch (_) {
      try {
        const text = await response.text();
        if (text) message = text;
      } catch (_) { /* ignore */ }
    }
    throw new Error(message);
  },
  
  handleSuccess() {
    this.showMessage('Thank you! Your message has been sent successfully.', 'success');
    this.form.reset();
    
    Logger.log('Form Submission Successful', {
      'Status': '✅ Success',
      'Form Cleared': true
    });
    
    this.clearMessageAfterDelay();
  },
  
  handleError(error) {
    this.showMessage('Oops! There was a problem sending your message. Please try again.', 'error');
    Logger.error('Form Submission', error);
  },
  
  showMessage(text, type) {
    if (!this.messageDiv) return;
    
    const colors = {
      info: { border: '#666', text: '#666' },
      success: { border: '#28a745', text: '#28a745' },
      error: { border: '#dc3545', text: '#dc3545' }
    };
    
    const color = colors[type] || colors.info;
    
    this.messageDiv.innerHTML = `
      <p class="form-message" style="border-color: ${color.border}; color: ${color.text};">
        ${text}
      </p>
    `;
  },
  
  clearMessageAfterDelay() {
    if (this.messageTimeoutId) {
      clearTimeout(this.messageTimeoutId);
    }
    this.messageTimeoutId = setTimeout(() => {
      if (this.messageDiv) {
        this.messageDiv.innerHTML = '';
        Logger.log('Form Message', 'Message cleared after timeout');
      }
    }, CONFIG.messageTimeout);
  }
};

// =============================================================================
// CAROUSEL MANAGEMENT
// =============================================================================
const CarouselManager = {
  carousels: [],
  
  init() {
    const carouselElements = DOM.getElements('.image-carousel');
    
    if (carouselElements.length === 0) {
      Logger.log('Carousel Manager', 'No carousels found on page');
      return;
    }
    
    Logger.log('Initializing Carousels', {
      'Count': carouselElements.length
    });
    
    carouselElements.forEach((element, index) => {
      const carousel = new Carousel(element, index);
      if (carousel.isValid()) {
        this.carousels.push(carousel);
      }
    });
    
    Logger.log('All Carousels Initialized', {
      'Total': this.carousels.length,
      'Status': '✅ Ready'
    });
  }
};

class Carousel {
  constructor(element, index) {
    this.element = element;
    this.index = index;
    this.mediaContainer = element.querySelector('.media-container');
    this.currentIndex = 0;
    this.mediaItems = this.parseMediaData();
    
    if (this.isValid()) {
      this.init();
    }
  }
  
  parseMediaData() {
    const img = this.mediaContainer?.querySelector('img');
    if (!img) return [];
    
    const mediaDataAttr = img.getAttribute('data-media');
    if (!mediaDataAttr) return [];
    
    try {
      return JSON.parse(mediaDataAttr);
    } catch (error) {
      Logger.error(`Carousel ${this.index + 1}`, new Error('Invalid JSON in data-media attribute'));
      return [];
    }
  }
  
  isValid() {
    if (!this.mediaContainer) {
      Logger.log(`Carousel ${this.index + 1}`, 'Media container not found');
      return false;
    }
    
    if (this.mediaItems.length === 0) {
      Logger.log(`Carousel ${this.index + 1}`, 'No media items found');
      return false;
    }
    
    Logger.log(`Carousel ${this.index + 1}`, {
      'Status': 'Initialized',
      'Media Items': this.mediaItems.length
    });
    
    return true;
  }
  
  init() {
    this.attachEventListeners();
  }
  
  attachEventListeners() {
    const leftArrow = this.element.querySelector('.arrow.left');
    const rightArrow = this.element.querySelector('.arrow.right');
    
    if (leftArrow) {
      leftArrow.textContent = '<';
      leftArrow.addEventListener('click', () => this.navigate(-1));
    }
    
    if (rightArrow) {
      rightArrow.textContent = '>';
      rightArrow.addEventListener('click', () => this.navigate(1));
    }
  }
  
  navigate(direction) {
    this.currentIndex = (this.currentIndex + direction + this.mediaItems.length) % this.mediaItems.length;
    this.showMedia();
    
    Logger.log('Carousel Navigation', {
      'Carousel': this.index + 1,
      'Direction': direction > 0 ? '➡️ Next' : '⬅️ Previous',
      'Media Index': `${this.currentIndex + 1} of ${this.mediaItems.length}`,
      'Media Type': this.isVideo(this.mediaItems[this.currentIndex]) ? 'VIDEO' : 'IMAGE'
    });
  }
  
  showMedia() {
    const url = this.mediaItems[this.currentIndex];
    const isVideo = this.isVideo(url);
    
    // Clear container
    this.mediaContainer.innerHTML = '';
    
    if (isVideo) {
      this.createVideoElement(url);
    } else {
      this.createImageElement(url);
    }
  }
  
  createVideoElement(url) {
    const video = document.createElement('video');
    Object.assign(video, {
      src: url,
      controls: true,
      autoplay: true,
      loop: true,
      muted: true
    });
    
    Object.assign(video.style, {
      width: '100%',
      height: 'auto',
      display: 'block'
    });
    
    this.mediaContainer.appendChild(video);
  }
  
  createImageElement(url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Product image';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.setAttribute('data-media', JSON.stringify(this.mediaItems));
    
    this.mediaContainer.appendChild(img);
  }
  
  isVideo(url) {
    return /\.(mp4|webm|ogg)$/i.test(url) || url.includes('video');
  }
}

// =============================================================================
// PERFORMANCE MONITORING (Optional)
// =============================================================================
const PerformanceMonitor = {
  init() {
    if (!CONFIG.logging.enabled || !window.performance) return;
    
    window.addEventListener('load', () => {
      setTimeout(() => {
        const perfData = performance.getEntriesByType('navigation')[0];
        
        if (perfData) {
          Logger.log('Performance Metrics', {
            'DOM Content Loaded': `${Math.round(perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart)}ms`,
            'Page Load Time': `${Math.round(perfData.loadEventEnd - perfData.loadEventStart)}ms`,
            'DNS Lookup': `${Math.round(perfData.domainLookupEnd - perfData.domainLookupStart)}ms`,
            'Total Load Time': `${Math.round(perfData.loadEventEnd - perfData.fetchStart)}ms`
          });
        }
      }, 0);
    });
  }
};

// =============================================================================
// CARD FOCUS MANAGER
// =============================================================================

const CardFocusManager = {
  focusedCard: null,
  init() {
    // Lightweight stub to keep initialization chain healthy
    Logger.log('Card Focus Manager', 'Initialized');
  },
  initClickOutside() {
    // Optional enhancement: close on outside click
  }
};



// =============================================================================
// PAGINATION MANAGER
// =============================================================================
const PaginationManager = {
  grid: null,
  cards: [],
  paginationContainer: null,
  itemsPerPage: 4, // number of cards per page
  currentPage: 1,
  
  init() {
    this.grid = DOM.getElement('.tab-gallery .grid-3');
    // Scope to gallery pagination container to avoid clashing with shop pagination
    this.paginationContainer = DOM.getElement('.gallery-pagination-nav .pagination');
    
    if (!this.grid || !this.paginationContainer) {
      Logger.log('Pagination Manager', 'Required elements (grid or container) not found');
      return;
    }
    
    this.cards = Array.from(this.grid.querySelectorAll('.card'));
    
    if (this.cards.length === 0) {
      Logger.log('Pagination Manager', 'No cards found in grid');
      return;
    }
    
    this.totalPages = Math.ceil(this.cards.length / this.itemsPerPage);
    
    if (this.totalPages <= 1) {
      Logger.log('Pagination Manager', 'Only one page, no pagination needed');
      this.paginationContainer.style.display = 'none'; // Hide pagination if not needed
      return;
    }
    
    this.createPaginationButtons();
    this.displayPage(1);
    
    Logger.log('Pagination Manager', {
      'Status': 'Initialized',
      'Total Cards': this.cards.length,
      'Total Pages': this.totalPages,
      'Items Per Page': this.itemsPerPage
    });
  },
  
  createPaginationButtons() {
    this.paginationContainer.innerHTML = ''; // Clear any existing content

    // Prev arrow
    const liPrev = document.createElement('li');
    const prevBtn = document.createElement('button');
    prevBtn.classList.add('pagination-btn', 'pagination-prev');
    prevBtn.setAttribute('aria-label', 'Previous page');
    prevBtn.textContent = '‹';
    prevBtn.addEventListener('click', () => {
      if (this.currentPage > 1) this.displayPage(this.currentPage - 1);
    });
    liPrev.appendChild(prevBtn);
    this.paginationContainer.appendChild(liPrev);

    // Page number buttons
    for (let i = 1; i <= this.totalPages; i++) {
      const li = document.createElement('li');
      const button = document.createElement('button');

      button.classList.add('pagination-btn');
      button.textContent = i;
      button.setAttribute('aria-label', `Go to page ${i}`);

      if (i === 1) {
        button.classList.add('active');
        button.setAttribute('aria-current', 'page');
      }

      button.addEventListener('click', () => {
        this.displayPage(i);
      });

      li.appendChild(button);
      this.paginationContainer.appendChild(li);
    }

    // Next arrow
    const liNext = document.createElement('li');
    const nextBtn = document.createElement('button');
    nextBtn.classList.add('pagination-btn', 'pagination-next');
    nextBtn.setAttribute('aria-label', 'Next page');
    nextBtn.textContent = '›';
    nextBtn.addEventListener('click', () => {
      if (this.currentPage < this.totalPages) this.displayPage(this.currentPage + 1);
    });
    liNext.appendChild(nextBtn);
    this.paginationContainer.appendChild(liNext);
  },
  
  displayPage(pageNumber) {
    if (pageNumber < 1 || pageNumber > this.totalPages) return;
    
    this.currentPage = pageNumber;
    
    const startIndex = (pageNumber - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    
    // Hide all cards
    this.cards.forEach(card => {
      card.style.display = 'none';
    });
    
    // Show cards for the current page
    const pageCards = this.cards.slice(startIndex, endIndex);
    pageCards.forEach(card => {
      card.style.display = 'flex'; // Use 'flex' since .card uses flex-direction
    });
    
    // Update active button state
    this.updateActiveButton();
    
    // Optional: Scroll to the top of the grid
    if (CONFIG.pagination?.scrollOnChange && this.grid?.scrollIntoView) {
      this.grid.scrollIntoView({ behavior: CONFIG.pagination.scrollBehavior, block: CONFIG.pagination.scrollBlock });
    }
    
    Logger.log('Pagination', {
      'Action': 'Page Change',
      'Current Page': this.currentPage,
      'Cards Shown': `${startIndex + 1} - ${Math.min(endIndex, this.cards.length)}`
    });
  },
  
  updateActiveButton() {
    // Numbered buttons exclude prev/next by selecting those without the arrow classes
    const numberButtons = Array.from(this.paginationContainer.querySelectorAll('.pagination-btn'))
      .filter(btn => !btn.classList.contains('pagination-prev') && !btn.classList.contains('pagination-next'));

    numberButtons.forEach((button, index) => {
      if ((index + 1) === this.currentPage) {
        button.classList.add('active');
        button.setAttribute('aria-current', 'page');
      } else {
        button.classList.remove('active');
        button.removeAttribute('aria-current');
      }
    });

    // Prev/Next disabled state
    const prevBtn = this.paginationContainer.querySelector('.pagination-prev');
    const nextBtn = this.paginationContainer.querySelector('.pagination-next');
    if (prevBtn) {
      if (this.currentPage === 1) {
        prevBtn.classList.add('disabled');
        prevBtn.setAttribute('aria-disabled', 'true');
        prevBtn.disabled = true;
      } else {
        prevBtn.classList.remove('disabled');
        prevBtn.setAttribute('aria-disabled', 'false');
        prevBtn.disabled = false;
      }
    }
    if (nextBtn) {
      if (this.currentPage === this.totalPages) {
        nextBtn.classList.add('disabled');
        nextBtn.setAttribute('aria-disabled', 'true');
        nextBtn.disabled = true;
      } else {
        nextBtn.classList.remove('disabled');
        nextBtn.setAttribute('aria-disabled', 'false');
        nextBtn.disabled = false;
      }
    }
  }
};

// =============================================================================
// SHOP PAGINATION MANAGER
// =============================================================================
const ShopPaginationManager = {
  grid: null,
  cards: [],
  paginationContainer: null,
  sectionLabelsContainer: null,
  itemsPerPage: 3, // 3 cards per page
  currentPage: 1,
  totalPages: 1,
  sections: ['Best sellers', 'Extra 1', 'Extra 2'],
  
  init() {
    this.grid = DOM.getElement('.tab-shop #shop-grid');
    this.paginationContainer = DOM.getElement('.shop-pagination-nav .pagination');
    this.sectionLabelsContainer = DOM.getElement('#shop-section-labels');
    
    if (!this.grid || !this.paginationContainer) {
      Logger.log('Shop Pagination Manager', 'Required elements (grid or container) not found');
      return;
    }
    
    this.cards = Array.from(this.grid.querySelectorAll('.card'));
    
    if (this.cards.length === 0) {
      Logger.log('Shop Pagination Manager', 'No cards found in grid');
      return;
    }
    
    this.totalPages = Math.ceil(this.cards.length / this.itemsPerPage);
    
    if (this.totalPages <= 1) {
      Logger.log('Shop Pagination Manager', 'Only one page, no pagination needed');
      this.paginationContainer.parentElement.style.display = 'none';
      return;
    }
    
  this.createPaginationButtons();
    this.displayPage(1);
    
    Logger.log('Shop Pagination Manager', {
      'Status': 'Initialized',
      'Total Cards': this.cards.length,
      'Total Pages': this.totalPages,
      'Items Per Page': this.itemsPerPage
    });
  },
  
  createPaginationButtons() {
    // Build unified pagination: Prev, 1..N, Next using .pagination-btn
    if (!this.paginationContainer) return;
    this.paginationContainer.innerHTML = '';

    // Prev
    const liPrev = document.createElement('li');
    const prevBtn = document.createElement('button');
    prevBtn.classList.add('pagination-btn', 'pagination-prev');
    prevBtn.setAttribute('aria-label', 'Previous page');
    prevBtn.textContent = '‹';
    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.currentPage > 1) this.displayPage(this.currentPage - 1);
    });
    liPrev.appendChild(prevBtn);
    this.paginationContainer.appendChild(liPrev);

    // Numbered
    for (let i = 1; i <= this.totalPages; i++) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.classList.add('pagination-btn');
      btn.textContent = String(i);
      btn.setAttribute('aria-label', `Go to page ${i}`);
      if (i === 1) {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
      }
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.displayPage(i);
      });
      li.appendChild(btn);
      this.paginationContainer.appendChild(li);
    }

    // Next
    const liNext = document.createElement('li');
    const nextBtn = document.createElement('button');
    nextBtn.classList.add('pagination-btn', 'pagination-next');
    nextBtn.setAttribute('aria-label', 'Next page');
    nextBtn.textContent = '›';
    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.currentPage < this.totalPages) this.displayPage(this.currentPage + 1);
    });
    liNext.appendChild(nextBtn);
    this.paginationContainer.appendChild(liNext);
  },
  
  displayPage(pageNumber) {
    // Validate page number
    if (pageNumber < 1 || pageNumber > this.totalPages) {
      return;
    }
    
    this.currentPage = pageNumber;
    const startIndex = (pageNumber - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const currentCards = this.cards.slice(startIndex, endIndex);
    
    // Hide all cards, show only current page cards
    this.cards.forEach((card, index) => {
      card.style.display = index >= startIndex && index < endIndex ? 'flex' : 'none';
    });
    
    // Update section labels based on what's on this page
    this.updateSectionLabels(currentCards);
    
    // Update pagination buttons
    this.updateActiveButton();
    
    // Optional: Scroll to grid
    if (CONFIG.pagination?.scrollOnChange && this.grid?.scrollIntoView) {
      this.grid.scrollIntoView({ behavior: CONFIG.pagination.scrollBehavior, block: CONFIG.pagination.scrollBlock });
    }
  },
  
  updateSectionLabels(cardsOnPage) {
    if (!this.sectionLabelsContainer) return;
    
    // Get unique sections represented on this page
    const sectionsOnPage = [...new Set(cardsOnPage.map(card => card.getAttribute('data-section')))];
    
    // Build labels HTML
    const labelsHTML = sectionsOnPage.map(section => `<h3>${section}</h3>`).join('');
    this.sectionLabelsContainer.innerHTML = labelsHTML;
  },
  
  updateActiveButton() {
    if (!this.paginationContainer) return;
    // Prev/Next
    const prevBtn = this.paginationContainer.querySelector('.pagination-prev');
    const nextBtn = this.paginationContainer.querySelector('.pagination-next');
    if (prevBtn) {
      if (this.currentPage === 1) {
        prevBtn.classList.add('disabled');
        prevBtn.setAttribute('aria-disabled', 'true');
        prevBtn.disabled = true;
      } else {
        prevBtn.classList.remove('disabled');
        prevBtn.setAttribute('aria-disabled', 'false');
        prevBtn.disabled = false;
      }
    }
    if (nextBtn) {
      if (this.currentPage === this.totalPages) {
        nextBtn.classList.add('disabled');
        nextBtn.setAttribute('aria-disabled', 'true');
        nextBtn.disabled = true;
      } else {
        nextBtn.classList.remove('disabled');
        nextBtn.setAttribute('aria-disabled', 'false');
        nextBtn.disabled = false;
      }
    }
    // Numbers
    const numberButtons = Array.from(this.paginationContainer.querySelectorAll('.pagination-btn'))
      .filter(btn => !btn.classList.contains('pagination-prev') && !btn.classList.contains('pagination-next'));
    numberButtons.forEach((btn, idx) => {
      const pageNum = idx + 1;
      if (pageNum === this.currentPage) {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.classList.remove('active');
        btn.removeAttribute('aria-current');
      }
    });
  }
};

// =============================================================================
// APPLICATION INITIALIZATION
// =============================================================================
function initializeApp() {
  // Initialize logging
  initPageLogging();
  
  // Initialize performance monitoring
  PerformanceMonitor.init();
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeComponents);
  } else {
    initializeComponents();
  }
}

function initializeComponents() {
  Logger.log('DOM Ready', {
    'Ready State': document.readyState,
    'Timestamp': new Date().toLocaleTimeString()
  });
  
  // Initialize all components
  TabManager.init();
  FormManager.init();
  CarouselManager.init();
  CardFocusManager.init();
  PaginationManager.init();
  ShopPaginationManager.init();
  HeroLinkManager.init();
  
  // Optional: Enable click-outside to close
  CardFocusManager.initClickOutside();
  
  Logger.log('Application Initialized', {
    'Status': '✅ All components loaded',
    'Timestamp': new Date().toLocaleTimeString()
  });
}

// =============================================================================
// ERROR HANDLING
// =============================================================================
window.addEventListener('error', (event) => {
  Logger.error('Global Error', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
  Logger.error('Unhandled Promise Rejection', err);
});

// =============================================================================
// START APPLICATION
// =============================================================================
initializeApp();