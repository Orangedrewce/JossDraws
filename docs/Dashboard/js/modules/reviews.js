// ============================================
// REVIEW MANAGER MODULE
// ============================================
import { ctx, setHidden, showAuthLockout, getSourceMeta } from "./utils.js";

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

  // ----- Show Review Message -----
  function showReviewMsg(text, isError) {
    rEl.message.textContent = text;
    rEl.message.className = "gallery-msg " + (isError ? "error" : "success");
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
    loader.className = "text-muted-2";
    loader.style.fontSize = "0.85rem";
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

      rEl.pendingCount.textContent = reviewData.pending.length;
      rEl.approvedCount.textContent = reviewData.approved.length;
      rEl.deletedCount.textContent = reviewData.deleted.length;

      renderReviews();
      reviewLoaded = true;
    } catch (err) {
      rEl.list.textContent = "";
      const p = document.createElement("p");
      p.className = "text-danger";
      p.style.fontSize = "0.85rem";
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

    if (items.length === 0) {
      const p = document.createElement("p");
      p.className = "text-muted-2";
      p.style.fontSize = "0.85rem";
      p.textContent =
        activeReviewTab === "pending"
          ? "No pending reviews. All caught up!"
          : activeReviewTab === "approved"
            ? "No approved reviews yet."
            : "Trash is empty.";
      rEl.list.appendChild(p);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const review of items) {
      fragment.appendChild(renderReviewCard(review));
    }
    rEl.list.appendChild(fragment);
  }

  // ----- Render Review Card -----
  function renderReviewCard(review) {
    const card = document.createElement("div");
    card.className = "review-mgmt-card";
    card.setAttribute("data-review-id", String(review.id));

    // Drag handle (approved tab only)
    if (activeReviewTab === "approved") {
      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⠿";
      card.appendChild(handle);
    }

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

    card.append(header, sourceEl, textEl, dateEl, actions);
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
    reviewDragClone.style.cssText =
      "position:fixed;pointer-events:none;z-index:10000;transition:none;" +
      "transform:scale(0.97);opacity:0.88;" +
      "box-shadow:0 8px 25px rgba(0,0,0,0.18);border-radius:8px;" +
      "width:" +
      rect.width +
      "px;" +
      "left:" +
      rect.left +
      "px;" +
      "top:" +
      rect.top +
      "px;";
    document.body.appendChild(reviewDragClone);
  }

  function moveReviewDrag(clientX, clientY) {
    if (reviewDragClone) {
      reviewDragClone.style.top = clientY - reviewDragOffsetY + "px";
    }
    if (reviewDragSourceRow) reviewDragSourceRow.style.pointerEvents = "none";
    const elBelow = document.elementFromPoint(clientX, clientY);
    if (reviewDragSourceRow) reviewDragSourceRow.style.pointerEvents = "";
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
