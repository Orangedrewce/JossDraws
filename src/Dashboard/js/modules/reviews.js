// ============================================
// REVIEW MANAGER MODULE
// ============================================
import { ctx, setHidden, showAuthLockout, getSourceMeta, extractDriveFileId, toEmbedUrl } from "./utils.js";

export function initReviews() {
  const rEl = {
    section: document.getElementById("reviewSection"),
    tabs: document.getElementById("reviewTabs"),
    list: document.getElementById("reviewList"),
    message: document.getElementById("reviewMessage"),
    pendingCount: document.getElementById("reviewPendingCount"),
    approvedCount: document.getElementById("reviewApprovedCount"),
    deletedCount: document.getElementById("reviewDeletedCount"),
  };

  let reviewLoaded = false;
  let reviewData = { pending: [], approved: [], deleted: [] };
  let activeReviewTab = "pending";
  const reviewDeletePending = new Map();
  const REVIEW_DELETE_MS = 3000;
  const selectedReviewIds = new Set();

  // ----- Show Review Message -----
  function showReviewMsg(text, isError) {
    rEl.message.textContent = text;
    rEl.message.classList.add("gallery-msg");
    rEl.message.classList.toggle("error", isError);
    rEl.message.classList.toggle("success", !isError);
    setHidden(rEl.message, false);
    setTimeout(() => setHidden(rEl.message, true), 5000);
  }

  // ----- Tab Switching -----
  function setReviewTab(tab) {
    activeReviewTab = tab;
    rEl.tabs.querySelectorAll(".review-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    renderReviews();
  }

  rEl.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".review-tab");
    if (!btn) return;
    setReviewTab(btn.dataset.tab);
  });

  // ----- Load Reviews -----
  async function loadReviews() {
    if (!ctx.db || !ctx.adminCode) return;
    rEl.list.textContent = "";
    const loader = document.createElement("p");
    loader.className = "text-muted-2 text-xs";
    loader.textContent = "Loading reviews...";
    rEl.list.appendChild(loader);

    try {
      const { data, error } = await ctx.db.rpc("admin_list_reviews", {
        p_admin_code: ctx.adminCode,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        if (data?.error === "Unauthorized") {
          ctx.adminCode = null;
          showAuthLockout("Invalid admin code.");
          return;
        }
        throw new Error(data?.error || "Failed to load reviews");
      }

      reviewData.pending = data.pending || [];
      reviewData.approved = data.approved || [];
      reviewData.deleted = data.deleted || [];

      // Auto-normalize: if 2+ approved reviews share the same sort_order
      // (e.g. all 0 from bulk import), fix them with sequential 1..N
      if (reviewData.approved.length > 1) {
        const sortVals = reviewData.approved.map((r) => r.review_sort_order || 0);
        const unique = new Set(sortVals);
        if (unique.size < sortVals.length) {
          console.log("[Reviews] Detected duplicate sort_order values — normalizing...");
          try {
            const { data: normData } = await ctx.db.rpc("admin_normalize_review_sort_orders", {
              p_admin_code: ctx.adminCode,
            });
            if (normData?.success) {
              console.log("[Reviews] Normalized", normData.updated, "rows — reloading");
              // Re-fetch with corrected values (non-recursive, one-shot)
              const { data: d2 } = await ctx.db.rpc("admin_list_reviews", {
                p_admin_code: ctx.adminCode,
              });
              if (d2?.success) {
                reviewData.approved = d2.approved || [];
              }
            }
          } catch (_) { /* best-effort */ }
        }
      }

      rEl.pendingCount.textContent = reviewData.pending.length;
      rEl.approvedCount.textContent = reviewData.approved.length;
      rEl.deletedCount.textContent = reviewData.deleted.length;

      renderReviews();
      reviewLoaded = true;
    } catch (err) {
      rEl.list.textContent = "";
      const p = document.createElement("p");
      p.className = "text-danger text-xs";
      p.textContent = "Error: " + String(err?.message || err);
      rEl.list.appendChild(p);
    }
  }

  // ----- Render Stars -----
  function renderStars(rating) {
    const r = Math.max(1, Math.min(5, Math.floor(Number(rating) || 5)));
    return "⭐".repeat(r);
  }

  // ----- Render Reviews -----
  function renderReviews() {
    const items = reviewData[activeReviewTab] || [];
    rEl.list.textContent = "";
    selectedReviewIds.clear();

    if (items.length === 0) {
      const p = document.createElement("p");
      p.className = "text-muted-2 text-xs";
      p.textContent =
        activeReviewTab === "pending"
          ? "No pending reviews. All caught up!"
          : activeReviewTab === "approved"
            ? "No approved reviews yet."
            : "Trash is empty.";
      rEl.list.appendChild(p);
      return;
    }

    // Bulk selection bar
    const bar = document.createElement("div");
    bar.className = "review-bulk-bar";

    const selectAllCb = document.createElement("input");
    selectAllCb.type = "checkbox";
    selectAllCb.className = "review-select-all";
    selectAllCb.title = "Select / deselect all";
    selectAllCb.setAttribute("aria-label", "Select all reviews");

    const selectLabel = document.createElement("span");
    selectLabel.className = "review-select-count";
    selectLabel.textContent = "Select all";

    const bulkBtns = document.createElement("div");
    bulkBtns.className = "review-bulk-btns is-hidden";

    if (activeReviewTab === "pending") {
      const approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "mini-btn";
      approveBtn.dataset.bulkAction = "approve";
      approveBtn.textContent = "✅ Approve selected";
      bulkBtns.appendChild(approveBtn);
    }

    if (activeReviewTab === "approved") {
      const denyBtn = document.createElement("button");
      denyBtn.type = "button";
      denyBtn.className = "mini-btn secondary";
      denyBtn.dataset.bulkAction = "deny";
      denyBtn.textContent = "⏸️ Unpublish selected";
      bulkBtns.appendChild(denyBtn);
    }

    if (activeReviewTab !== "deleted") {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "mini-btn danger";
      delBtn.dataset.bulkAction = "delete";
      delBtn.textContent = "🗑️ Delete selected";
      bulkBtns.appendChild(delBtn);
    }

    if (activeReviewTab === "deleted") {
      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "mini-btn secondary";
      restoreBtn.dataset.bulkAction = "restore";
      restoreBtn.textContent = "♻️ Restore selected";
      bulkBtns.appendChild(restoreBtn);

      const purgeBtn = document.createElement("button");
      purgeBtn.type = "button";
      purgeBtn.className = "mini-btn danger";
      purgeBtn.dataset.bulkAction = "purge";
      purgeBtn.textContent = "💀 Purge selected";
      bulkBtns.appendChild(purgeBtn);
    }

    bar.append(selectAllCb, selectLabel, bulkBtns);
    rEl.list.appendChild(bar);

    // Select-all toggle
    selectAllCb.addEventListener("change", () => {
      const cards = rEl.list.querySelectorAll(".review-select-cb");
      cards.forEach((cb) => {
        cb.checked = selectAllCb.checked;
        const id = cb.dataset.reviewId;
        if (selectAllCb.checked) selectedReviewIds.add(id);
        else selectedReviewIds.delete(id);
        cb.closest(".review-mgmt-card")?.classList.toggle("selected", selectAllCb.checked);
      });
      updateBulkBar();
    });

    const fragment = document.createDocumentFragment();
    for (const review of items) {
      fragment.appendChild(renderReviewCard(review));
    }
    rEl.list.appendChild(fragment);
  }

  function updateBulkBar() {
    const bar = rEl.list.querySelector(".review-bulk-bar");
    if (!bar) return;
    const label = bar.querySelector(".review-select-count");
    const btns = bar.querySelector(".review-bulk-btns");
    const n = selectedReviewIds.size;
    if (n > 0) {
      label.textContent = `${n} selected`;
      btns.classList.remove("is-hidden");
    } else {
      label.textContent = "Select all";
      btns.classList.add("is-hidden");
    }
    // Sync select-all checkbox state
    const allCb = bar.querySelector(".review-select-all");
    const items = reviewData[activeReviewTab] || [];
    if (allCb) allCb.checked = n > 0 && n === items.length;
  }

  // ----- Render Review Card -----
  function renderReviewCard(review) {
    const card = document.createElement("div");
    card.className = "review-mgmt-card";
    card.setAttribute("data-review-id", String(review.id));

    // Select checkbox
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "review-select-cb";
    cb.dataset.reviewId = String(review.id);
    cb.setAttribute("aria-label", "Select " + (review.client_name || "review"));
    cb.addEventListener("change", () => {
      if (cb.checked) selectedReviewIds.add(String(review.id));
      else selectedReviewIds.delete(String(review.id));
      card.classList.toggle("selected", cb.checked);
      updateBulkBar();
    });

    // Top bar: [⠿ handle] [☑ select] [spacer] [# input]  (approved)
    // Or just: [☑ select]  (pending/deleted)
    const topBar = document.createElement("div");
    topBar.className = "review-topbar";

    if (activeReviewTab === "approved") {
      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.title = "Drag to reorder";
      handle.textContent = "⠿";

      const spacer = document.createElement("span");
      spacer.className = "review-topbar-spacer";

      const sortLabel = document.createElement("span");
      sortLabel.className = "review-sort-label";
      sortLabel.textContent = "#";

      const sortInput = document.createElement("input");
      sortInput.type = "number";
      sortInput.className = "review-sort-input";
      sortInput.min = "1";
      sortInput.max = "9999";
      sortInput.title = "Position (1 = first on carousel)";
      sortInput.setAttribute("data-review-sort", "true");
      sortInput.setAttribute("data-review-id", String(review.id));
      sortInput.setAttribute("aria-label", "Sort order for " + (review.client_name || "review"));
      const safeSort = Number.isFinite(Number(review.review_sort_order))
        ? Math.max(1, Number(review.review_sort_order))
        : 1;
      sortInput.value = String(safeSort);

      topBar.append(handle, cb, spacer, sortLabel, sortInput);
    } else {
      topBar.append(cb);
    }

    card.appendChild(topBar);

    // Header: name + stars + source
    const header = document.createElement("div");
    header.className = "review-mgmt-header";

    const nameEl = document.createElement("span");
    nameEl.className = "review-mgmt-name";
    nameEl.textContent = review.client_name || "Anonymous";

    const starsEl = document.createElement("span");
    starsEl.className = "review-mgmt-stars";
    starsEl.textContent = renderStars(review.rating);

    header.append(nameEl, starsEl);

    // Source badge
    const sourceMeta = getSourceMeta(review.source);
    const sourceEl = document.createElement("span");
    sourceEl.className = "review-mgmt-source";
    sourceEl.textContent = `${sourceMeta.emoji} ${sourceMeta.label}`;

    // Review text
    const textEl = document.createElement("p");
    textEl.className = "review-mgmt-text";
    textEl.textContent = '"' + (review.review_text || "") + '"';

    // Date
    const dateEl = document.createElement("div");
    dateEl.className = "review-mgmt-date";
    const date = new Date(review.created_at);
    dateEl.textContent =
      date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) +
      " at " +
      date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

    if (activeReviewTab === "deleted" && review.deleted_at) {
      const delDate = new Date(review.deleted_at);
      dateEl.textContent +=
        " • Deleted " +
        delDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
    }

    // Actions
    const actions = document.createElement("div");
    actions.className = "review-mgmt-actions";

    if (activeReviewTab === "pending") {
      const approveBtn = document.createElement("button");
      approveBtn.className = "mini-btn";
      approveBtn.type = "button";
      approveBtn.dataset.reviewAction = "approve";
      approveBtn.dataset.reviewId = String(review.id);
      approveBtn.textContent = "✅ Approve";
      actions.appendChild(approveBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "mini-btn danger";
      deleteBtn.type = "button";
      deleteBtn.dataset.reviewAction = "delete";
      deleteBtn.dataset.reviewId = String(review.id);
      deleteBtn.textContent = "🗑️ Delete";
      actions.appendChild(deleteBtn);
    } else if (activeReviewTab === "approved") {
      const denyBtn = document.createElement("button");
      denyBtn.className = "mini-btn secondary";
      denyBtn.type = "button";
      denyBtn.dataset.reviewAction = "deny";
      denyBtn.dataset.reviewId = String(review.id);
      denyBtn.textContent = "⏸️ Unpublish";
      actions.appendChild(denyBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "mini-btn danger";
      deleteBtn.type = "button";
      deleteBtn.dataset.reviewAction = "delete";
      deleteBtn.dataset.reviewId = String(review.id);
      deleteBtn.textContent = "🗑️ Delete";
      actions.appendChild(deleteBtn);
    } else if (activeReviewTab === "deleted") {
      const restoreBtn = document.createElement("button");
      restoreBtn.className = "mini-btn secondary";
      restoreBtn.type = "button";
      restoreBtn.dataset.reviewAction = "restore";
      restoreBtn.dataset.reviewId = String(review.id);
      restoreBtn.textContent = "♻️ Restore";
      actions.appendChild(restoreBtn);

      const purgeBtn = document.createElement("button");
      purgeBtn.className = "mini-btn danger";
      purgeBtn.type = "button";
      purgeBtn.dataset.reviewAction = "purge";
      purgeBtn.dataset.reviewId = String(review.id);
      purgeBtn.textContent = "💀 Purge";
      actions.appendChild(purgeBtn);
    }

    card.append(header, sourceEl, textEl, dateEl);

    // --- Image URL row (paste-to-attach, like gallery URL input) ---
    const imgRow = document.createElement("div");
    imgRow.className = "review-img-row";

    const imgLabel = document.createElement("label");
    imgLabel.className = "review-img-label";
    imgLabel.textContent = "📷 Attached image";

    const imgInputWrap = document.createElement("div");
    imgInputWrap.className = "review-img-input-wrap";

    const imgInput = document.createElement("input");
    imgInput.type = "text";
    imgInput.className = "review-img-input";
    imgInput.placeholder = "Paste image URL here...";
    imgInput.autocomplete = "off";
    imgInput.value = review.image_url || "";
    imgInput.setAttribute("data-review-id", String(review.id));

    const imgSaveBtn = document.createElement("button");
    imgSaveBtn.type = "button";
    imgSaveBtn.className = "mini-btn review-img-save";
    imgSaveBtn.textContent = "💾";
    imgSaveBtn.title = "Save image URL";
    imgSaveBtn.setAttribute("data-img-save", String(review.id));

    const imgClearBtn = document.createElement("button");
    imgClearBtn.type = "button";
    imgClearBtn.className = "mini-btn secondary review-img-clear";
    imgClearBtn.textContent = "✕";
    imgClearBtn.title = "Remove image";
    imgClearBtn.setAttribute("data-img-clear", String(review.id));

    imgInputWrap.append(imgInput, imgSaveBtn, imgClearBtn);

    // Preview thumbnail
    const imgPreview = document.createElement("div");
    imgPreview.className = "review-img-preview";
    if (review.image_url) {
      const thumb = document.createElement("img");
      thumb.src = review.image_url;
      thumb.alt = "Review photo";
      thumb.addEventListener("error", () => {
        imgPreview.textContent = "";
        const errSpan = document.createElement("span");
        errSpan.className = "text-muted-2 text-3xs";
        errSpan.textContent = "Could not load preview";
        imgPreview.appendChild(errSpan);
      }, { once: true });
      imgPreview.appendChild(thumb);
    }

    // Live preview on input change (auto-resolves Drive links for preview)
    imgInput.addEventListener("input", () => {
      const val = imgInput.value.trim();
      imgPreview.textContent = "";
      if (val) {
        const previewSrc = resolveImageUrl(val);
        const thumb = document.createElement("img");
        thumb.src = previewSrc;
        thumb.alt = "Preview";
        thumb.addEventListener("error", () => {
          imgPreview.textContent = "";
          const errSpan = document.createElement("span");
          errSpan.className = "text-muted-2 text-3xs";
          errSpan.textContent = "Could not load preview";
          imgPreview.appendChild(errSpan);
        }, { once: true });
        imgPreview.appendChild(thumb);
      }
    });

    imgRow.append(imgLabel, imgInputWrap, imgPreview);
    card.appendChild(imgRow);

    card.appendChild(actions);
    return card;
  }

  // ----- Action Handler (Event Delegation) -----
  rEl.list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-review-action]");
    if (!btn || !ctx.db || !ctx.adminCode) return;

    const action = btn.dataset.reviewAction;
    const id = parseInt(btn.dataset.reviewId, 10);
    if (!action || isNaN(id)) return;

    const rpcMap = {
      approve: "admin_approve_review",
      deny: "admin_deny_review",
      delete: "admin_delete_review",
      restore: "admin_restore_review",
      purge: "admin_purge_review",
    };

    const rpcName = rpcMap[action];
    if (!rpcName) return;

    // Two-click confirm for delete & purge
    if (action === "delete" || action === "purge") {
      const key = `${action}-${id}`;
      if (!reviewDeletePending.has(key)) {
        reviewDeletePending.set(key, true);
        btn.textContent =
          action === "delete" ? "⚠️ U Sure?" : "⚠️ Purge forever?";
        btn.classList.remove("danger");
        btn.classList.add("confirm-armed");
        setTimeout(() => {
          if (reviewDeletePending.has(key)) {
            reviewDeletePending.delete(key);
            btn.textContent = action === "delete" ? "🗑️ Delete" : "Purge";
            btn.classList.remove("confirm-armed");
            btn.classList.add("danger");
          }
        }, REVIEW_DELETE_MS);
        return;
      }
      reviewDeletePending.delete(key);
    }

    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "...";

    try {
      const { data, error } = await ctx.db.rpc(rpcName, {
        p_admin_code: ctx.adminCode,
        p_review_id: id,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        if (data?.error === "Unauthorized") {
          ctx.adminCode = null;
          showAuthLockout("Invalid admin code.");
          return;
        }
        throw new Error(data?.error || action + " failed");
      }

      const msgs = {
        approve: "Review approved and published!",
        deny: "Review unpublished (moved to pending)",
        delete: "Review moved to trash",
        restore: "Review restored to pending",
        purge: "Review permanently deleted",
      };
      showReviewMsg(msgs[action] || "Done!", false);
      await loadReviews();
    } catch (err) {
      showReviewMsg("Error: " + err.message, true);
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  // ----- Bulk Action Handler (select multiple + act) -----
  let bulkConfirmArmed = false;
  rEl.list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-bulk-action]");
    if (!btn || !ctx.db || !ctx.adminCode) return;
    if (selectedReviewIds.size === 0) return;

    const action = btn.dataset.bulkAction;
    const count = selectedReviewIds.size;
    const isDangerous = action === "delete" || action === "purge";

    // Two-click confirm for destructive bulk actions
    if (isDangerous && !bulkConfirmArmed) {
      bulkConfirmArmed = true;
      const origLabel = btn.textContent;
      btn.textContent = `⚠️ ${action === "purge" ? "Purge" : "Delete"} ${count} forever?`;
      btn.classList.remove("danger");
      btn.classList.add("confirm-armed");
      setTimeout(() => {
        bulkConfirmArmed = false;
        btn.textContent = origLabel;
        btn.classList.remove("confirm-armed");
        btn.classList.add("danger");
      }, 4000);
      return;
    }
    bulkConfirmArmed = false;

    const ids = Array.from(selectedReviewIds);
    btn.disabled = true;
    btn.textContent = `Working (${count})...`;

    try {
      const { data, error } = await ctx.db.rpc("admin_bulk_review_action", {
        p_admin_code: ctx.adminCode,
        p_ids: JSON.stringify(ids.map(Number)),
        p_action: action,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        if (data?.error === "Unauthorized") {
          ctx.adminCode = null;
          showAuthLockout("Invalid admin code.");
          return;
        }
        throw new Error(data?.error || "Bulk action failed");
      }

      const verbs = {
        approve: "approved", deny: "unpublished",
        delete: "deleted", restore: "restored", purge: "purged",
      };
      showReviewMsg(`${data.affected} review(s) ${verbs[action] || action}`, false);
      selectedReviewIds.clear();
      await loadReviews();
    } catch (err) {
      showReviewMsg("Error: " + err.message, true);
      btn.disabled = false;
      btn.textContent = "Retry";
    }
  });

  // ----- Sync sort-order values from server (like gallery's syncSortOrders) -----
  async function syncReviewSortOrders() {
    if (!ctx.db || !ctx.adminCode) return;
    try {
      const { data, error } = await ctx.db.rpc("admin_list_reviews", {
        p_admin_code: ctx.adminCode,
      });
      if (error || !data || !data.success) return;
      const serverItems = data.approved || [];
      const serverMap = new Map(serverItems.map((i) => [String(i.id), i]));
      reviewData.approved.forEach((item) => {
        const server = serverMap.get(String(item.id));
        if (server) item.review_sort_order = server.review_sort_order;
      });
      reviewData.approved.sort(
        (a, b) => (a.review_sort_order || 0) - (b.review_sort_order || 0),
      );
      reviewData.approved.forEach((item) => {
        const input = rEl.list.querySelector(
          `input.review-sort-input[data-review-id="${item.id}"]`,
        );
        if (input) input.value = item.review_sort_order;
      });
    } catch (_) {
      /* best-effort */
    }
  }

  // ----- Inline Sort-Order Save (numeric input) -----
  async function saveReviewSortOrder(input) {
    const id = input.getAttribute("data-review-id");
    const review = reviewData.approved.find((r) => String(r.id) === String(id));
    if (!review) return;
    let newVal = parseInt(input.value, 10);
    if (isNaN(newVal) || newVal < 1) {
      input.value = Math.max(1, review.review_sort_order || 1);
      return;
    }
    if (newVal === review.review_sort_order) return;

    input.disabled = true;
    try {
      const { data, error } = await ctx.db.rpc("admin_reorder_review", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(id, 10),
        p_new_sort_order: newVal,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showReviewMsg(data?.error || "Sort update failed", true);
        return;
      }
      showReviewMsg(`Review moved to position ${newVal}`, false);
      await loadReviews();
    } catch (err) {
      showReviewMsg("Error: " + err.message, true);
    } finally {
      input.disabled = false;
    }
  }

  rEl.list.addEventListener("change", (e) => {
    if (e.target.matches(".review-sort-input")) saveReviewSortOrder(e.target);
  });
  rEl.list.addEventListener("keydown", (e) => {
    if (e.target.matches(".review-sort-input") && e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
    }
  });

  // ----- Image URL Save / Clear (event delegation) -----
  // Auto-converts Google Drive share links to embeddable URLs (like gallery does)
  function resolveImageUrl(raw) {
    if (!raw) return "";
    const fileId = extractDriveFileId(raw);
    return fileId ? toEmbedUrl(fileId) : raw;
  }

  async function saveReviewImage(reviewId, url) {
    if (!ctx.db || !ctx.adminCode) return;
    try {
      const { data, error } = await ctx.db.rpc("admin_update_review_image", {
        p_admin_code: ctx.adminCode,
        p_review_id: parseInt(reviewId, 10),
        p_image_url: url || null,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        if (data?.error === "Unauthorized") {
          ctx.adminCode = null;
          showAuthLockout("Invalid admin code.");
          return;
        }
        throw new Error(data?.error || "Image update failed");
      }
      // Update local data
      for (const tab of ["pending", "approved", "deleted"]) {
        const item = reviewData[tab].find((r) => String(r.id) === String(reviewId));
        if (item) { item.image_url = url || null; break; }
      }
      showReviewMsg(url ? "Image saved!" : "Image removed.", false);
    } catch (err) {
      showReviewMsg("Error: " + err.message, true);
    }
  }

  rEl.list.addEventListener("click", async (e) => {
    // Save image button
    const saveBtn = e.target.closest("button[data-img-save]");
    if (saveBtn) {
      const id = saveBtn.getAttribute("data-img-save");
      const input = rEl.list.querySelector(`.review-img-input[data-review-id="${id}"]`);
      if (input) {
        const resolved = resolveImageUrl(input.value.trim());
        if (resolved !== input.value.trim()) {
          input.value = resolved; // show the converted URL
        }
        saveBtn.disabled = true;
        saveBtn.textContent = "...";
        await saveReviewImage(id, resolved);
        saveBtn.disabled = false;
        saveBtn.textContent = "💾";
      }
      return;
    }
    // Clear image button
    const clearBtn = e.target.closest("button[data-img-clear]");
    if (clearBtn) {
      const id = clearBtn.getAttribute("data-img-clear");
      const input = rEl.list.querySelector(`.review-img-input[data-review-id="${id}"]`);
      if (input) input.value = "";
      const preview = clearBtn.closest(".review-mgmt-card")?.querySelector(".review-img-preview");
      if (preview) preview.textContent = "";
      clearBtn.disabled = true;
      clearBtn.textContent = "...";
      await saveReviewImage(id, "");
      clearBtn.disabled = false;
      clearBtn.textContent = "✕";
      return;
    }
  });

  // Allow Enter in image input to trigger save
  rEl.list.addEventListener("keydown", (e) => {
    if (e.target.matches(".review-img-input") && e.key === "Enter") {
      e.preventDefault();
      const id = e.target.getAttribute("data-review-id");
      const saveBtn = rEl.list.querySelector(`button[data-img-save="${id}"]`);
      if (saveBtn) saveBtn.click();
    }
  });

  // ----- Drag & Drop Reorder for Approved Reviews (Desktop + Touch) -----
  let reviewDragSrcId = null;
  let reviewCurrentDropTarget = null;
  const reviewDragDropTarget = { id: null, position: "before" };

  function clearReviewDropIndicators() {
    if (!rEl.list) return;
    rEl.list
      .querySelectorAll(".drag-over, .drop-before, .drop-after")
      .forEach((el) => {
        el.classList.remove("drag-over", "drop-before", "drop-after");
      });
    reviewCurrentDropTarget = null;
  }

  function updateReviewDropIndicator(row, clientY) {
    if (!row || row.getAttribute("data-review-id") === reviewDragSrcId) {
      if (reviewCurrentDropTarget) {
        reviewCurrentDropTarget.classList.remove(
          "drag-over",
          "drop-before",
          "drop-after",
        );
        reviewCurrentDropTarget = null;
      }
      reviewDragDropTarget.id = null;
      return;
    }
    const rect = row.getBoundingClientRect();
    const isBefore = clientY - rect.top < rect.height / 2;

    if (reviewCurrentDropTarget && reviewCurrentDropTarget !== row) {
      reviewCurrentDropTarget.classList.remove(
        "drag-over",
        "drop-before",
        "drop-after",
      );
    }
    reviewCurrentDropTarget = row;
    row.classList.remove("drop-before", "drop-after");
    row.classList.add("drag-over", isBefore ? "drop-before" : "drop-after");

    reviewDragDropTarget.id = row.getAttribute("data-review-id");
    reviewDragDropTarget.position = isBefore ? "before" : "after";
  }

  function optimisticReviewReorder(srcId, tgtId, position) {
    const srcEl = rEl.list.querySelector(`[data-review-id="${srcId}"]`);
    const tgtEl = rEl.list.querySelector(`[data-review-id="${tgtId}"]`);
    if (!srcEl || !tgtEl) return;

    if (position === "before") {
      tgtEl.parentNode.insertBefore(srcEl, tgtEl);
    } else {
      tgtEl.parentNode.insertBefore(srcEl, tgtEl.nextSibling);
    }

    srcEl.classList.add("dropped");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => srcEl.classList.remove("dropped"));
    });

    // Update local reviewData.approved to match new order
    const items = reviewData.approved;
    const srcIdx = items.findIndex((i) => String(i.id) === String(srcId));
    const tgtIdx = items.findIndex((i) => String(i.id) === String(tgtId));
    if (srcIdx !== -1 && tgtIdx !== -1) {
      const [moved] = items.splice(srcIdx, 1);
      const newTgtIdx = items.findIndex(
        (i) => String(i.id) === String(tgtId),
      );
      if (newTgtIdx !== -1) {
        const insertAt = position === "before" ? newTgtIdx : newTgtIdx + 1;
        items.splice(insertAt, 0, moved);
      }
      items.forEach((item, i) => {
        item.review_sort_order = i + 1;
      });
      // Sync sort input values in the DOM
      items.forEach((item) => {
        const input = rEl.list.querySelector(
          `input.review-sort-input[data-review-id="${item.id}"]`,
        );
        if (input) input.value = item.review_sort_order;
      });
    }
  }

  async function performReviewDrop() {
    const targetId = reviewDragDropTarget.id;
    const targetPosition = reviewDragDropTarget.position || "before";
    clearReviewDropIndicators();

    if (!reviewDragSrcId || !targetId || reviewDragSrcId === targetId) return;

    const snapshot = reviewData.approved.map((i) => ({ ...i }));
    optimisticReviewReorder(reviewDragSrcId, targetId, targetPosition);

    try {
      const { data, error } = await ctx.db.rpc("admin_move_review", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(reviewDragSrcId, 10),
        p_target_id: parseInt(targetId, 10),
        p_position: targetPosition,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showReviewMsg(data?.error || "Move failed — reverting", true);
        reviewData.approved = snapshot;
        renderReviews();
        return;
      }
      syncReviewSortOrders();
    } catch (err) {
      showReviewMsg("Error: " + (err?.message || err) + " — reverting", true);
      reviewData.approved = snapshot;
      renderReviews();
    }
  }

  // ——— Shared pointer drag (mouse + touch) for reviews ———
  let reviewDragClone = null;
  let reviewDragSourceRow = null;
  let reviewDragOffsetY = 0;

  function startReviewDrag(row, clientX, clientY) {
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();

    reviewDragSrcId = row.getAttribute("data-review-id");
    reviewDragSourceRow = row;
    row.classList.add("dragging");
    document.body.classList.add("is-dragging");

    const rect = row.getBoundingClientRect();
    reviewDragOffsetY = clientY - rect.top;
    reviewDragClone = row.cloneNode(true);
    reviewDragClone.classList.add("review-drag-clone");
    reviewDragClone.style.width = `${rect.width}px`;
    reviewDragClone.style.left = `${rect.left}px`;
    reviewDragClone.style.top = `${rect.top}px`;
    document.body.appendChild(reviewDragClone);
  }

  function moveReviewDrag(clientX, clientY) {
    if (reviewDragClone) {
      reviewDragClone.style.top = clientY - reviewDragOffsetY + "px";
    }
    if (reviewDragSourceRow) reviewDragSourceRow.classList.add("no-pointer");
    const elBelow = document.elementFromPoint(clientX, clientY);
    if (reviewDragSourceRow) reviewDragSourceRow.classList.remove("no-pointer");
    const row = elBelow ? elBelow.closest("[data-review-id]") : null;
    updateReviewDropIndicator(row, clientY);
  }

  async function endReviewDrag() {
    if (reviewDragSourceRow) reviewDragSourceRow.classList.remove("dragging");
    if (reviewDragClone) {
      reviewDragClone.remove();
      reviewDragClone = null;
    }
    document.body.classList.remove("is-dragging");

    await performReviewDrop();

    reviewDragSourceRow = null;
    reviewDragSrcId = null;
    reviewDragDropTarget.id = null;
    reviewDragDropTarget.position = "before";
  }

  // ——— Mouse events (desktop) ———
  rEl.list.addEventListener("mousedown", (e) => {
    if (activeReviewTab !== "approved") return;
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    const row = handle.closest(".review-mgmt-card");
    if (!row) return;
    e.preventDefault();

    startReviewDrag(row, e.clientX, e.clientY);

    function onMouseMove(ev) {
      ev.preventDefault();
      moveReviewDrag(ev.clientX, ev.clientY);
    }
    async function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      await endReviewDrag();
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  rEl.list.addEventListener("dragstart", (e) => {
    e.preventDefault();
  });

  // ——— Touch events (mobile / tablet) ———
  rEl.list.addEventListener(
    "touchstart",
    (e) => {
      if (activeReviewTab !== "approved") return;
      const handle = e.target.closest(".drag-handle");
      if (!handle) return;
      const row = handle.closest(".review-mgmt-card");
      if (!row) return;

      const touch = e.touches[0];
      startReviewDrag(row, touch.clientX, touch.clientY);
    },
    { passive: true },
  );

  rEl.list.addEventListener(
    "touchmove",
    (e) => {
      if (!reviewDragSourceRow) return;
      e.preventDefault();
      const touch = e.touches[0];
      moveReviewDrag(touch.clientX, touch.clientY);
    },
    { passive: false },
  );

  rEl.list.addEventListener("touchend", async () => {
    if (!reviewDragSourceRow) return;
    await endReviewDrag();
  });

  // ----- Auto-open from URL hash (#reviews) -----
  function checkReviewHash() {
    if (window.location.hash === "#reviews") {
      if (rEl.section && !rEl.section.open) {
        rEl.section.open = true;
      }
      if (!reviewLoaded && ctx.db && ctx.adminCode) {
        loadReviews();
      }
    }
  }

  window.addEventListener("hashchange", checkReviewHash);

  // ----- Load on section open -----
  rEl.section.addEventListener("toggle", () => {
    if (rEl.section.open && !reviewLoaded && ctx.db && ctx.adminCode) {
      loadReviews();
    }
  });

  // Check hash on init (for Discord deep-link)
  checkReviewHash();
}
