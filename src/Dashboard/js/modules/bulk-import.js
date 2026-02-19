// ============================================
// BULK IMPORT MODULE — Paste JSON → DB
// ============================================
import { Trace, ctx, setHidden } from "./utils.js";

export function initBulkImport() {
  Trace.log("BULK_IMPORT_INIT");

  const form     = document.getElementById("bulkImportForm");
  const textarea = document.getElementById("bulkImportJson");
  const sourceEl = document.getElementById("bulkImportSource");
  const importBtn = document.getElementById("bulkImportBtn");
  const clearBtn  = document.getElementById("bulkImportClearBtn");
  const msgEl     = document.getElementById("bulkImportMessage");

  if (!form || !textarea || !importBtn) {
    console.warn("[BulkImport] Missing DOM elements — skipping init");
    return;
  }

  // ── Show message (auto-hides after 10 s) ──
  function showMsg(text, isError) {
    msgEl.textContent = text;
    msgEl.className = "gallery-msg " + (isError ? "error" : "success");
    setHidden(msgEl, false);
    if (isError) {
      console.error("[BulkImport]", text);
    } else {
      console.log("[BulkImport]", text);
    }
    setTimeout(() => setHidden(msgEl, true), 10000);
  }

  // ── Clear button ──
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      textarea.value = "";
      setHidden(msgEl, true);
      Trace.log("BULK_IMPORT_CLEARED");
    });
  }

  // ── Import handler ──
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setHidden(msgEl, true);

    const raw = textarea.value.trim();
    if (!raw) {
      showMsg("Paste a JSON array first.", true);
      return;
    }

    // ── Parse JSON ──
    let reviews;
    try {
      reviews = JSON.parse(raw);
    } catch (err) {
      showMsg("Invalid JSON: " + err.message, true);
      return;
    }

    if (!Array.isArray(reviews)) {
      showMsg("JSON must be an array (starts with '[').", true);
      return;
    }
    if (reviews.length === 0) {
      showMsg("JSON array is empty — nothing to import.", true);
      return;
    }

    const source = sourceEl ? sourceEl.value : "etsy";
    Trace.log("BULK_IMPORT_START", { count: reviews.length, source });

    importBtn.disabled = true;
    importBtn.textContent = "Importing…";

    try {
      if (!ctx.db) throw new Error("Database not connected");
      if (!ctx.adminCode) throw new Error("Not authenticated");

      const { data, error } = await ctx.db.rpc("admin_bulk_import_reviews", {
        p_admin_code: ctx.adminCode,
        p_source:     source,
        p_json:       reviews,
      });

      Trace.log("BULK_IMPORT_RESPONSE", { data, error: error?.message });

      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        const errMsg = data?.error || "Import failed (no success flag)";
        showMsg(errMsg, true);
        return;
      }

      const msg = `✅ Imported ${data.inserted} reviews (${data.skipped_dup} duplicates skipped, ${data.total} total in JSON).`;
      showMsg(msg, false);
      Trace.log("BULK_IMPORT_DONE", {
        inserted: data.inserted,
        skipped: data.skipped_dup,
        total: data.total,
      });
      textarea.value = "";
    } catch (err) {
      console.error("[BulkImport] RPC error:", err);
      showMsg("Import failed: " + err.message, true);
      Trace.log("BULK_IMPORT_ERROR", { message: err.message });
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = "Import Reviews";
    }
  });

  Trace.log("BULK_IMPORT_READY");
}
