// ============================================
// SHARED UTILITIES & CONFIGURATION
// ============================================

/**
 * Trace logger — sequential step counter for debugging.
 */
export const Trace = (() => {
  let step = 0;

  function time() {
    return new Date().toISOString().split("T")[1].replace("Z", "");
  }

  function log(event, data = null) {
    step += 1;
    const id = String(step).padStart(2, "0");
    const prefix = `[${id} | ${time()}] ${event}`;
    if (data !== null && data !== undefined) {
      console.log(prefix, data);
    } else {
      console.log(prefix);
    }
  }

  function group(label) {
    console.group(`▶ ${label}`);
  }

  function groupEnd() {
    console.groupEnd();
  }

  return { log, group, groupEnd };
})();

// ============================================
// CONFIGURATION
// ============================================
export const CONFIG = {
  SUPABASE_URL: "https://pciubbwphwpnptgawgok.supabase.co",
  SUPABASE_KEY: "sb_publishable_jz1pWpo7TDvURxQ8cqP06A_xc4ckSwv",
  SITE_URL: "https://www.jossdraws.com/Dashboard/review.html",
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
};

export const DEFAULT_SOURCE_KEY = "general";

export const SOURCES = {
  commission: { emoji: "🎨", label: "Commission" },
  etsy: { emoji: "🛍️", label: "Etsy Order" },
  print: { emoji: "🖨️", label: "Art Print" },
  sticker: { emoji: "🏷️", label: "Sticker" },
  bookmark: { emoji: "🔖", label: "Bookmark" },
  pet_portrait: { emoji: "🐾", label: "Pet Portrait" },
  faceless_portrait: { emoji: "👤", label: "Faceless Portrait" },
  coloring_book: { emoji: "🖍️", label: "Coloring Book" },
  general: { emoji: "📋", label: "General" },
};

// ============================================
// SHARED MUTABLE CONTEXT
// Set by the orchestrator, read/written by all modules.
// ============================================
export const ctx = {
  db: null,
  adminCode: null,
};

// ============================================
// AUTH LOCKOUT OVERLAY
// ============================================
export function showAuthLockout(message) {
  const existing = document.getElementById("auth-lockout");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "auth-lockout";
  overlay.className = "auth-screen auth-screen--danger auth-lockout";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Access denied");

  const title = document.createElement("h2");
  title.textContent = "Access Denied";

  const body = document.createElement("p");
  body.textContent = message || "Invalid admin code.";

  overlay.append(title, body);
  document.body.appendChild(overlay);
}

export function clearAuthLockout() {
  const existing = document.getElementById("auth-lockout");
  if (existing) existing.remove();
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function setHidden(el, hidden) {
  if (!el) return;
  el.classList.toggle("is-hidden", Boolean(hidden));
}

export function sanitizeText(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function sanitizeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function normalizeSourceKey(source) {
  const value = String(source ?? DEFAULT_SOURCE_KEY)
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_]+$/.test(value)) return DEFAULT_SOURCE_KEY;
  return Object.prototype.hasOwnProperty.call(SOURCES, value)
    ? value
    : DEFAULT_SOURCE_KEY;
}

export function getSourceMeta(source) {
  const key = normalizeSourceKey(source);
  return SOURCES[key] || SOURCES[DEFAULT_SOURCE_KEY];
}

export function formatSourceLabel(source) {
  const meta = getSourceMeta(source);
  return `${meta.emoji} ${meta.label}`;
}

/**
 * Retry wrapper for database operations
 */
export async function withRetry(operation, retries = CONFIG.MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, CONFIG.RETRY_DELAY * (i + 1)),
      );
    }
  }
}

// ============================================
// GOOGLE DRIVE URL HELPERS (shared)
// ============================================

export function extractDriveFileId(url) {
  if (!url || typeof url !== "string") return null;
  url = url.trim();
  let m = url.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{25,}$/.test(url)) return url;
  return null;
}

export function toEmbedUrl(fileId) {
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

/**
 * Escape HTML for safe insertion (used by profiles rendering).
 */
export function escHTML(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
