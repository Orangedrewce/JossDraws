// ============================================
// MGMT.JS — ORCHESTRATOR  (ES6 Module entry-point)
// ============================================
// Thin shell: auth → Supabase → verify → init modules
// ============================================

import {
  Trace,
  CONFIG,
  ctx,
  showAuthLockout,
  clearAuthLockout,
  setHidden,
} from './modules/utils.js';

import { initLinks }        from './modules/links.js';
import { initGallery }      from './modules/gallery.js';
import { initHero }         from './modules/hero.js';
import { initShop }         from './modules/shop.js';
import { initReviews }      from './modules/reviews.js';
import { initAbout }        from './modules/about.js';
import { initBannerEditor } from './modules/banner-editor.js';

// ============================================
// 1. AUTH PROMPT
// ============================================
Trace.log("APP_INIT");

{
  Trace.group("ACCESS_GUARD");
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const input = prompt("Enter admin code:");
    if (input === null) break;
    if (input && input.trim().length > 0) {
      ctx.adminCode = input.trim();
      break;
    }
  }

  if (!ctx.adminCode) {
    Trace.log("AUTH_NO_INPUT");
    Trace.groupEnd();
    showAuthLockout("No admin code provided.");
    throw new Error("Access denied");
  }

  Trace.log("AUTH_CODE_RECEIVED");
  Trace.groupEnd();
}

Trace.log("PAGE_LOADED");

// ============================================
// 2. SUPABASE INIT
// ============================================
try {
  ctx.db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
  Trace.log("DB_CONNECTED");
} catch (error) {
  console.error("Failed to initialize Supabase client:", error);
  Trace.log("DB_CONNECTION_FAILED", {
    message: error?.message || String(error),
  });
}

// ============================================
// 3. SERVER-SIDE VERIFY + MODULE INIT
// ============================================
if (ctx.db) {
  (async () => {
    try {
      Trace.log("AUTH_SERVER_VERIFY_START");
      const { data, error } = await ctx.db.rpc("verify_admin", {
        p_admin_code: ctx.adminCode,
      });
      if (error || !data || !data.success) {
        Trace.log("AUTH_SERVER_DENIED");
        ctx.adminCode = null;
        showAuthLockout("Invalid admin code.");
        return;
      }
      Trace.log("AUTH_SERVER_VERIFIED");
      clearAuthLockout();
    } catch (e) {
      // Network error — allow proceeding, individual RPCs will catch invalid codes
      console.warn("Admin verification network error:", e);
    }

    // ── Init all feature modules ──
    initLinks();
    initGallery();
    initHero();
    initShop();
    initReviews();
    initAbout();
    initBannerEditor();
  })();
}

// ============================================
// 4. CHANGE ADMIN CODE  (inline — mutates ctx.adminCode)
// ============================================
{
  const changeBtn    = document.getElementById("changeCodeBtn");
  const currentInput = document.getElementById("currentCodeInput");
  const newInput     = document.getElementById("newCodeInput");
  const confirmInput = document.getElementById("confirmCodeInput");
  const changeMsg    = document.getElementById("changeCodeMessage");

  function showChangeMsg(text, isError) {
    if (!changeMsg) return;
    changeMsg.textContent = text;
    changeMsg.className = "gallery-msg " + (isError ? "error" : "success");
    setHidden(changeMsg, false);
  }

  if (changeBtn) {
    changeBtn.addEventListener("click", async () => {
      setHidden(changeMsg, true);
      const currentVal = currentInput.value.trim();
      const newVal     = newInput.value.trim();
      const confirmVal = confirmInput.value.trim();

      if (!currentVal) {
        showChangeMsg("Enter your current admin code.", true);
        return;
      }
      if (newVal.length < 4) {
        showChangeMsg("New code must be at least 4 characters.", true);
        return;
      }
      if (newVal !== confirmVal) {
        showChangeMsg("New codes do not match.", true);
        return;
      }
      if (newVal === currentVal) {
        showChangeMsg("New code must be different from current code.", true);
        return;
      }

      changeBtn.disabled = true;
      changeBtn.textContent = "Changing...";

      try {
        const { data, error } = await ctx.db.rpc("admin_change_code", {
          p_current_code: currentVal,
          p_new_code: newVal,
        });

        if (error) throw new Error(error.message);
        if (!data || !data.success) {
          const errMsg = data?.error || "Change failed";
          showChangeMsg(errMsg, true);
          return;
        }

        // Update shared admin code so subsequent actions use the new one
        ctx.adminCode = newVal;
        currentInput.value  = "";
        newInput.value      = "";
        confirmInput.value  = "";
        showChangeMsg("Admin code changed successfully!", false);
        Trace.log("ADMIN_CODE_CHANGED");
      } catch (err) {
        showChangeMsg("Failed: " + err.message, true);
      } finally {
        changeBtn.disabled = false;
        changeBtn.textContent = "Change Admin Code";
      }
    });
  }
}
