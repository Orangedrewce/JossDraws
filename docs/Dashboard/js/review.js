// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  SUPABASE_URL: 'https://pciubbwphwpnptgawgok.supabase.co',
  SUPABASE_KEY: 'sb_publishable_jz1pWpo7TDvURxQ8cqP06A_xc4ckSwv',
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  MAX_NAME_LENGTH: 60,
  MAX_REVIEW_LENGTH: 280
};

const VALID_SOURCES = [
  'commission', 'etsy', 'print', 'sticker',
  'bookmark', 'pet_portrait', 'faceless_portrait',
  'coloring_book', 'general'
];

// ============================================
// INITIALIZATION
// ============================================
let db;
try {
  db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
} catch (error) {
  console.error('Failed to initialize Supabase client:', error);
}

// DOM Elements
const elements = {
  loader: document.getElementById('loadingState'),
  invalidScreen: document.getElementById('invalidState'),
  formScreen: document.getElementById('formState'),
  successScreen: document.getElementById('successState'),
  form: document.getElementById('reviewForm'),
  formError: document.getElementById('formError'),
  clientName: document.getElementById('clientName'),
  reviewText: document.getElementById('reviewText'),
  ratingScore: document.getElementById('ratingScore'),
  charCounter: document.getElementById('charCounter'),
  submitBtn: document.getElementById('submitBtn'),
  toast: document.getElementById('toast')
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Sanitizes text for safe display (prevents XSS)
 */
function sanitizeText(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Shows inline error message (replaces alert())
 */
function showFormError(message) {
  elements.formError.textContent = message;
  elements.formError.style.display = 'block';

  // Auto-hide after 5 seconds
  setTimeout(() => {
    elements.formError.style.display = 'none';
  }, 5000);
}

/**
 * Hides inline error message
 */
function hideFormError() {
  elements.formError.style.display = 'none';
}

/**
 * Shows toast notification
 */
let _toastTimer = null;
function showToast(message, duration = 2000) {
  if (_toastTimer) clearTimeout(_toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('show');

  _toastTimer = setTimeout(() => {
    elements.toast.classList.remove('show');
    _toastTimer = null;
  }, duration);
}

/**
 * Updates button state consistently
 */
function setButtonState(isLoading) {
  const LOADING_LABEL = '⏳ Processing...';
  const DEFAULT_LABEL = 'Submit Review';
  if (isLoading) {
    elements.submitBtn.disabled = true;
    elements.submitBtn.textContent = LOADING_LABEL;
  } else {
    elements.submitBtn.disabled = false;
    if (elements.submitBtn.textContent === LOADING_LABEL) {
      elements.submitBtn.textContent = DEFAULT_LABEL;
    }
  }
}

/**
 * Validates that a source value matches the known allowlist
 */
function validateSource(source) {
  if (!source || typeof source !== 'string') return 'general';
  const trimmed = source.trim();
  return VALID_SOURCES.includes(trimmed) ? trimmed : 'general';
}

/**
 * Retry wrapper for database operations
 */
async function withRetry(operation, retries = CONFIG.MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (i + 1)));
    }
  }
}

// ============================================
// CHARACTER COUNTER
// ============================================
if (elements.reviewText) {
  elements.reviewText.addEventListener('input', () => {
    const currentLength = elements.reviewText.value.length;
    const remaining = CONFIG.MAX_REVIEW_LENGTH - currentLength;
    elements.charCounter.textContent = `${remaining} remaining`;
  });
}

// ============================================
// STATE
// ============================================
let globalSource = null;

const urlParams = new URLSearchParams(window.location.search);
const tokenID = urlParams.get('token');

// ============================================
// TOKEN VALIDATION
// ============================================
async function validateToken() {
  if (!db) {
    showInvalidScreen();
    console.error('Database not initialized');
    return;
  }

  if (!tokenID) {
    showInvalidScreen();
    return;
  }

  try {
    const { data, error } = await withRetry(async () => {
      return await db
        .from('tokens')
        .select('id, is_used, expires_at, source, used_at')
        .eq('id', tokenID)
        .single();
    });

    if (error || !data) {
      showInvalidScreen();
      return;
    }

    // Check if already used
    if (data.is_used) {
      showInvalidScreen();
      return;
    }

    // Check if expired
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      showInvalidScreen();
      return;
    }

    // Token is valid — capture source with validation
    globalSource = data.source ? validateSource(data.source) : null;

    elements.loader.classList.add('hidden');
    elements.formScreen.classList.remove('hidden');

  } catch (error) {
    console.error('Token validation failed:', error);
    showInvalidScreen();
  }
}

function showInvalidScreen() {
  elements.loader.classList.add('hidden');
  elements.invalidScreen.classList.remove('hidden');
}

// ============================================
// FORM SUBMISSION
// ============================================
elements.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideFormError();

  // Check honeypot field (bot prevention)
  const honeypot = elements.form.querySelector('[name="website"]');
  if (honeypot && honeypot.value) {
    // Silent fail — likely a bot
    return;
  }

  if (!db) {
    showFormError('Unable to connect to the database. Please try again later.');
    return;
  }

  setButtonState(true);

  // Sanitize inputs
  const name = sanitizeText(elements.clientName.value.trim().substring(0, CONFIG.MAX_NAME_LENGTH));
  const text = sanitizeText(elements.reviewText.value.trim().substring(0, CONFIG.MAX_REVIEW_LENGTH));
  const rating = parseInt(elements.ratingScore.value, 10);

  // Validate inputs aren't empty after trimming
  if (!name || !text) {
    showFormError('Please fill in all required fields.');
    setButtonState(false);
    return;
  }

  // Validate rating is in range
  if (isNaN(rating) || rating < 1 || rating > 5) {
    showFormError('Please select a valid rating.');
    setButtonState(false);
    return;
  }

  try {
    // Submit review via atomic RPC function (prevents race conditions)
    const { data: result, error: rpcError } = await withRetry(async () => {
      return await db.rpc('submit_review', {
        p_token_id: tokenID,
        p_client_name: name,
        p_review_text: text,
        p_rating: rating
      });
    });

    if (rpcError) {
      throw new Error(rpcError.message || 'Failed to submit review');
    }

    if (result && !result.success) {
      throw new Error(result.error || 'Review submission was rejected');
    }

    elements.formScreen.classList.add('hidden');
    elements.successScreen.classList.remove('hidden');
    showToast('✅ Review submitted!');

  } catch (error) {
    console.error('Review submission failed:', error);
    showFormError(`Something went wrong: ${error.message}. Please try again.`);
  } finally {
    setButtonState(false);
  }
});

// ============================================
// LAUNCH
// ============================================
validateToken();
