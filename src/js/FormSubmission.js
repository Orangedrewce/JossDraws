// =============================================================================
// FORM SUBMISSION — Contact form handling via Formspree
// =============================================================================
// Self-initialising module: validates name / email / message fields with
// inline error display, submits to Formspree endpoint, and shows
// success / error feedback with auto-clear timeout.
//
//   FormManager    — form init, field validation (length + pattern),
//                    async fetch POST, aria-invalid toggling, and
//                    character counter for the message textarea.
//
//   Logger         — conditional console logging (disabled by default).
//
//   PerformanceMonitor — optional navigation-timing metrics on load.
//
// Also installs global error / unhandledrejection listeners for logging.
//
// Boot: initializeApp() → DOMContentLoaded → FormManager.init().
// =============================================================================

// =============================================================================
// CONSTANTS & CONFIGURATION
// =============================================================================
const FORM_CONFIG = {
  formspreeEndpoint: 'https://formspree.io/f/mqaglzrb',
  messageTimeout: 5000,
  maxNameLength: 60,
  maxMessageLength: 280,
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
    if (!FORM_CONFIG.logging.enabled) return;
    
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
    if (FORM_CONFIG.logging.verbose) {
      console.error('Full Error:', error);
    }
  }
};

const DOM = {
  getElement(selector) {
    const element = document.querySelector(selector);
    if (!element && FORM_CONFIG.logging.verbose) {
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
// FORM HANDLING
// =============================================================================
const FormManager = {
  form: null,
  messageDiv: null,
  messageTimeoutId: null,
  nameInput: null,
  emailInput: null,
  messageInput: null,
  nameError: null,
  emailError: null,
  messageError: null,
  messageCounter: null,
  
  init() {
    this.form = DOM.getElement('#contact-form');
    this.messageDiv = DOM.getElement('#form-message');
    this.nameInput = DOM.getElement('#name');
    this.emailInput = DOM.getElement('#email');
    this.messageInput = DOM.getElement('#message');
    this.nameError = DOM.getElement('#name-error');
    this.emailError = DOM.getElement('#email-error');
    this.messageError = DOM.getElement('#message-error');
    this.messageCounter = DOM.getElement('#message-counter');
    
    if (!this.form) {
      Logger.log('Form Manager', 'Contact form not found on page');
      return;
    }

    if (this.nameInput) {
      this.nameInput.setAttribute('maxlength', FORM_CONFIG.maxNameLength);
    }

    if (this.messageInput) {
      this.messageInput.setAttribute('maxlength', FORM_CONFIG.maxMessageLength);
      this.messageInput.addEventListener('input', () => this.updateMessageCounter());
      this.updateMessageCounter();
    }
    
    this.attachListeners();
    this.attachInputLoggers();
  },

  updateMessageCounter() {
    if (!this.messageInput || !this.messageCounter) return;
    const remaining = FORM_CONFIG.maxMessageLength - this.messageInput.value.length;
    this.messageCounter.textContent = `${remaining} remaining`;
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

    if (!this.validateForm()) {
      return;
    }

    if (this.nameInput) this.nameInput.value = this.nameInput.value.trim();
    if (this.emailInput) this.emailInput.value = this.emailInput.value.trim();
    if (this.messageInput) this.messageInput.value = this.messageInput.value.trim();
    
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
    return fetch(FORM_CONFIG.formspreeEndpoint, {
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
    this.clearFieldErrors();
    
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

  setFieldError(field, errorEl, message) {
    if (field) {
      field.setAttribute('aria-invalid', 'true');
    }
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  },

  clearFieldError(field, errorEl) {
    if (field) {
      field.removeAttribute('aria-invalid');
    }
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
  },

  clearFieldErrors() {
    this.clearFieldError(this.nameInput, this.nameError);
    this.clearFieldError(this.emailInput, this.emailError);
    this.clearFieldError(this.messageInput, this.messageError);
  },

  validateForm() {
    this.clearFieldErrors();

    let isValid = true;
    let firstInvalid = null;

    if (this.nameInput) {
      const nameValue = this.nameInput.value.trim();
      if (!nameValue) {
        this.setFieldError(this.nameInput, this.nameError, 'Name is required.');
        isValid = false;
        firstInvalid = firstInvalid || this.nameInput;
      } else if (nameValue.length > FORM_CONFIG.maxNameLength) {
        this.setFieldError(
          this.nameInput,
          this.nameError,
          `Name must be ${FORM_CONFIG.maxNameLength} characters or less.`
        );
        isValid = false;
        firstInvalid = firstInvalid || this.nameInput;
      }
    }

    if (this.emailInput) {
      const emailValue = this.emailInput.value.trim();
      if (!emailValue) {
        this.setFieldError(this.emailInput, this.emailError, 'Email is required.');
        isValid = false;
        firstInvalid = firstInvalid || this.emailInput;
      } else if (!this.emailInput.checkValidity()) {
        this.setFieldError(this.emailInput, this.emailError, 'Please enter a valid email address.');
        isValid = false;
        firstInvalid = firstInvalid || this.emailInput;
      }
    }

    if (this.messageInput) {
      const messageValue = this.messageInput.value.trim();
      if (!messageValue) {
        this.setFieldError(this.messageInput, this.messageError, 'Message is required.');
        isValid = false;
        firstInvalid = firstInvalid || this.messageInput;
      } else if (messageValue.length > FORM_CONFIG.maxMessageLength) {
        this.setFieldError(
          this.messageInput,
          this.messageError,
          `Message must be ${FORM_CONFIG.maxMessageLength} characters or less.`
        );
        isValid = false;
        firstInvalid = firstInvalid || this.messageInput;
      }
    }

    if (!isValid) {
      this.showMessage('Please fix the highlighted fields and try again.', 'error');
      if (firstInvalid) {
        firstInvalid.focus();
      }
    }

    return isValid;
  },
  
  showMessage(text, type) {
    if (!this.messageDiv) return;
    
    const colors = {
      info: { border: '#666', text: '#666' },
      success: { border: '#28a745', text: '#28a745' },
      error: { border: '#dc3545', text: '#dc3545' }
    };
    
    const color = colors[type] || colors.info;
    
    this.messageDiv.textContent = '';
    const p = document.createElement('p');
    p.className = 'form-message';
    p.style.borderColor = color.border;
    p.style.color = color.text;
    p.textContent = text;
    this.messageDiv.appendChild(p);
  },
  
  clearMessageAfterDelay() {
    if (this.messageTimeoutId) {
      clearTimeout(this.messageTimeoutId);
    }
    this.messageTimeoutId = setTimeout(() => {
      if (this.messageDiv) {
        this.messageDiv.textContent = '';
        Logger.log('Form Message', 'Message cleared after timeout');
      }
    }, FORM_CONFIG.messageTimeout);
  }
};

// =============================================================================
// PERFORMANCE MONITORING (Optional)
// =============================================================================
const PerformanceMonitor = {
  init() {
    if (!FORM_CONFIG.logging.enabled || !window.performance) return;
    
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
  
  // Initialize contact form
  FormManager.init();
  
  Logger.log('Application Initialized', {
    'Status': '✅ Form handler loaded',
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