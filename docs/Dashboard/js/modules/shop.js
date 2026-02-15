// ============================================
// SHOP MANAGER MODULE
// ============================================
import {
  ctx,
  setHidden,
  showAuthLockout,
  extractDriveFileId,
  toEmbedUrl,
} from "./utils.js";

export function initShop() {
  const sEl = {
    section: document.getElementById("shopSection"),
    form: document.getElementById("shopForm"),
    idInput: document.getElementById("shopId"),
    titleInput: document.getElementById("shopTitle"),
    priceInput: document.getElementById("shopPrice"),
    urlInput: document.getElementById("shopUrl"),
    mediaInput: document.getElementById("shopMedia"),
    activeCheckbox: document.getElementById("shopActive"),
    preview: document.getElementById("shopPreview"),
    saveBtn: document.getElementById("shopSaveBtn"),
    cancelBtn: document.getElementById("shopCancelBtn"),
    message: document.getElementById("shopMessage"),
    list: document.getElementById("shopList"),
    count: document.getElementById("shopCount"),
    // Page titles editor
    pageTitlesList: document.getElementById("shopPageTitlesList"),
    addPageTitleBtn: document.getElementById("shopAddPageTitleBtn"),
    savePageTitlesBtn: document.getElementById("shopSavePageTitlesBtn"),
    pageTitlesMsg: document.getElementById("shopPageTitlesMsg"),
  };

  let shopLoaded = false;
  let shopItems = [];
  let shopLastMovedId = null;
  const shopDeletePending = new Map();
  const SHOP_DELETE_MS = 3000;
  const shopDragDropTarget = { id: null, position: "before" };

  // ----- Google Drive URL Converter -----
  function shopConvertMediaUrl(url) {
    const fileId = extractDriveFileId(url);
    return fileId ? toEmbedUrl(fileId) : url;
  }

  function parseMediaUrls(text) {
    return text
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean)
      .map((u) => shopConvertMediaUrl(u));
  }

  function isVideoUrl(url) {
    return /\.mp4(\?|$)/i.test(url);
  }

  // ----- Media Preview -----
  let mediaPreviewTimer = null;

  function updateMediaPreview() {
    if (mediaPreviewTimer) clearTimeout(mediaPreviewTimer);
    mediaPreviewTimer = setTimeout(() => {
      const urls = parseMediaUrls(sEl.mediaInput.value);
      if (urls.length === 0) {
        setHidden(sEl.preview, true);
        return;
      }
      sEl.preview.textContent = "";
      const grid = document.createElement("div");
      grid.className = "shop-media-grid";
      for (const url of urls.slice(0, 6)) {
        const cell = document.createElement("div");
        cell.className = "shop-media-cell";
        if (isVideoUrl(url)) {
          const vid = document.createElement("video");
          vid.src = url;
          vid.muted = true;
          vid.loop = true;
          vid.playsInline = true;
          vid.autoplay = true;
          cell.appendChild(vid);
        } else {
          const img = document.createElement("img");
          img.alt = "Media preview";
          img.src = url;
          img.addEventListener(
            "error",
            () => {
              img.style.display = "none";
            },
            { once: true },
          );
          cell.appendChild(img);
        }
        grid.appendChild(cell);
      }
      if (urls.length > 6) {
        const more = document.createElement("div");
        more.className = "shop-media-cell shop-media-more";
        more.textContent = `+${urls.length - 6} more`;
        grid.appendChild(more);
      }
      sEl.preview.appendChild(grid);
      setHidden(sEl.preview, false);
    }, 400);
  }

  sEl.mediaInput.addEventListener("input", updateMediaPreview);
  sEl.mediaInput.addEventListener("paste", () =>
    setTimeout(updateMediaPreview, 50),
  );

  // ----- Show Shop Message -----
  function showShopMsg(text, isError) {
    sEl.message.textContent = text;
    sEl.message.className = "gallery-msg " + (isError ? "error" : "success");
    setHidden(sEl.message, false);
    setTimeout(() => setHidden(sEl.message, true), 5000);
  }

  // ----- Reset Form -----
  function resetShopForm() {
    sEl.form.reset();
    sEl.idInput.value = "";
    sEl.activeCheckbox.checked = true;
    setHidden(sEl.preview, true);
    setHidden(sEl.cancelBtn, true);
    sEl.saveBtn.textContent = "Save Product";
  }

  // ----- Cancel Edit -----
  sEl.cancelBtn.addEventListener("click", () => {
    resetShopForm();
  });

  // ----- Add / Edit Product -----
  sEl.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ctx.db || !ctx.adminCode) return;

    const editId = sEl.idInput.value.trim();
    const title = sEl.titleInput.value.trim();
    const priceDisplay = sEl.priceInput.value.trim();
    const etsyUrl = sEl.urlInput.value.trim();
    const mediaUrls = parseMediaUrls(sEl.mediaInput.value);
    const isActive = sEl.activeCheckbox.checked;

    if (!title) {
      showShopMsg("Product title is required.", true);
      return;
    }
    if (!priceDisplay) {
      showShopMsg("Price display is required.", true);
      return;
    }
    if (!etsyUrl) {
      showShopMsg("Etsy URL is required.", true);
      return;
    }
    if (mediaUrls.length === 0) {
      showShopMsg("At least one media URL is required.", true);
      return;
    }

    // Validate Etsy URL
    try {
      const urlObj = new URL(etsyUrl);
      if (!urlObj.hostname.includes("etsy.com")) {
        showShopMsg("Please enter a valid Etsy URL.", true);
        return;
      }
    } catch {
      showShopMsg("Invalid URL format.", true);
      return;
    }

    sEl.saveBtn.disabled = true;
    sEl.saveBtn.textContent = editId ? "Updating..." : "Adding...";

    try {
      if (editId) {
        // Edit existing
        const { data, error } = await ctx.db.rpc("admin_edit_shop_item", {
          p_admin_code: ctx.adminCode,
          p_item_id: parseInt(editId, 10),
          p_title: title,
          p_price_display: priceDisplay,
          p_etsy_url: etsyUrl,
          p_media: mediaUrls,
          p_is_active: isActive,
        });
        if (error) throw new Error(error.message);
        if (!data || !data.success) {
          const errMsg = data?.error || "Update failed";
          if (errMsg === "Unauthorized") {
            ctx.adminCode = null;
            showAuthLockout("Invalid admin code.");
            return;
          }
          showShopMsg(errMsg, true);
          return;
        }
        showShopMsg("Product updated successfully!", false);
      } else {
        // Add new
        const maxSort =
          shopItems.length > 0
            ? Math.max(...shopItems.map((i) => i.sort_order || 0))
            : 0;
        const nextSort = Math.max(1, maxSort + 1);

        const { data, error } = await ctx.db.rpc("admin_add_shop_item", {
          p_admin_code: ctx.adminCode,
          p_title: title,
          p_price_display: priceDisplay,
          p_etsy_url: etsyUrl,
          p_media: mediaUrls,
          p_is_active: isActive,
          p_sort_order: nextSort,
        });
        if (error) throw new Error(error.message);
        if (!data || !data.success) {
          const errMsg = data?.error || "Failed to add product";
          if (errMsg === "Unauthorized") {
            ctx.adminCode = null;
            showAuthLockout("Invalid admin code.");
            return;
          }
          showShopMsg(errMsg, true);
          return;
        }
        showShopMsg("Product added to shop!", false);
      }

      resetShopForm();
      loadShopItems();
    } catch (err) {
      showShopMsg("Error: " + err.message, true);
    } finally {
      sEl.saveBtn.disabled = false;
      sEl.saveBtn.textContent = "Save Product";
    }
  });

  // ----- Load Shop Items -----
  async function loadShopItems() {
    if (!ctx.db || !ctx.adminCode) return;

    try {
      const { data, error } = await ctx.db.rpc("admin_list_shop_items", {
        p_admin_code: ctx.adminCode,
      });

      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        sEl.list.textContent = "";
        const p = document.createElement("p");
        p.className = "text-danger";
        p.style.fontSize = "0.85rem";
        p.textContent = String(data?.error || "Failed to load");
        sEl.list.appendChild(p);
        return;
      }

      shopItems = data.items || [];
      renderShopItems();
      shopLoaded = true;
      renderPageTitleInputs(); // sync page count with titles
    } catch (err) {
      sEl.list.textContent = "";
      const p = document.createElement("p");
      p.className = "text-danger";
      p.style.fontSize = "0.85rem";
      p.textContent =
        "Error: " + String(err?.message || err || "Unknown error");
      sEl.list.appendChild(p);
    }
  }

  // ----- Render Shop Items -----
  function renderShopItems() {
    const active = shopItems.filter((i) => i.is_active).length;
    const total = shopItems.length;
    sEl.count.textContent = `${active} active / ${total} total products`;

    if (total === 0) {
      sEl.list.textContent = "";
      const p = document.createElement("p");
      p.className = "text-muted-2";
      p.style.fontSize = "0.85rem";
      p.textContent = "No shop items yet. Add your first product above!";
      sEl.list.appendChild(p);
      return;
    }

    sEl.list.textContent = "";
    const fragment = document.createDocumentFragment();

    for (const item of shopItems) {
      const isActive = Boolean(item.is_active);
      const date = new Date(item.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const flashClass =
        String(item.id) === String(shopLastMovedId) ? " flash" : "";
      const media = Array.isArray(item.media) ? item.media : [];
      const thumb = media[0] || "";

      const row = document.createElement("div");
      row.className =
        "gallery-item " + (isActive ? "" : "inactive") + flashClass;
      row.setAttribute("data-shop-id", String(item.id));

      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.title = "Drag to reorder";
      handle.textContent = "\u2847";

      const thumbEl = document.createElement("div");
      thumbEl.className = "gallery-item-thumb";
      if (thumb && thumb.startsWith("http")) {
        if (isVideoUrl(thumb)) {
          const vid = document.createElement("video");
          vid.src = thumb;
          vid.muted = true;
          vid.loop = true;
          vid.playsInline = true;
          vid.style.width = "100%";
          vid.style.height = "100%";
          vid.style.objectFit = "cover";
          thumbEl.appendChild(vid);
        } else {
          const img = document.createElement("img");
          img.loading = "lazy";
          img.alt = String(item.title || "Product");
          img.src = thumb;
          img.addEventListener(
            "error",
            () => {
              img.style.display = "none";
            },
            { once: true },
          );
          thumbEl.appendChild(img);
        }
      } else {
        const fallback = document.createElement("span");
        fallback.style.display = "flex";
        fallback.style.alignItems = "center";
        fallback.style.justifyContent = "center";
        fallback.style.height = "100%";
        fallback.style.fontSize = "1.2rem";
        fallback.textContent = "\uD83D\uDECD\uFE0F";
        thumbEl.appendChild(fallback);
      }

      const info = document.createElement("div");
      info.className = "gallery-item-info";
      const titleEl = document.createElement("div");
      titleEl.className = "gallery-item-title";
      titleEl.textContent = item.title || "Untitled";
      const metaEl = document.createElement("div");
      metaEl.className = "gallery-item-meta";
      const metaParts = [item.price_display || ""];
      metaParts.push(`${media.length} media`);
      metaEl.textContent = metaParts.filter(Boolean).join(" \u00B7 ");
      info.append(titleEl, metaEl);

      const sortInput = document.createElement("input");
      sortInput.type = "number";
      sortInput.className = "gallery-sort-input";
      sortInput.min = "1";
      sortInput.max = "9999";
      sortInput.title = "Position (1 = first)";
      sortInput.setAttribute("data-shop-action", "sort");
      sortInput.setAttribute("data-shop-id", String(item.id));
      sortInput.setAttribute(
        "aria-label",
        "Sort order for " + String(item.title || "Product"),
      );
      const safeSort = Number.isFinite(Number(item.sort_order))
        ? Math.max(1, Number(item.sort_order))
        : 1;
      sortInput.value = String(safeSort);

      const actions = document.createElement("div");
      actions.className = "gallery-item-actions";

      const toggleBtn = document.createElement("button");
      toggleBtn.className =
        "mini-btn gallery-item-badge " + (isActive ? "active" : "hidden");
      toggleBtn.setAttribute("role", "switch");
      toggleBtn.setAttribute("aria-checked", String(isActive));
      toggleBtn.setAttribute("data-shop-action", "toggle");
      toggleBtn.setAttribute("data-shop-id", String(item.id));
      toggleBtn.title = "Click to " + (isActive ? "hide" : "show");
      toggleBtn.textContent = isActive
        ? "\uD83D\uDC41\uFE0F"
        : "\uD83D\uDEAB";

      const editBtn = document.createElement("button");
      editBtn.className = "mini-btn secondary";
      editBtn.setAttribute("data-shop-action", "edit");
      editBtn.setAttribute("data-shop-id", String(item.id));
      editBtn.title = "Edit product";
      editBtn.textContent = "\u270F\uFE0F";

      const delBtn = document.createElement("button");
      delBtn.className = "mini-btn danger";
      delBtn.setAttribute("data-shop-action", "delete");
      delBtn.setAttribute("data-shop-id", String(item.id));
      delBtn.title = "Delete permanently";
      delBtn.textContent = "\uD83D\uDDD1\uFE0F";

      actions.append(toggleBtn, editBtn, delBtn);
      row.append(handle, thumbEl, info, sortInput, actions);
      fragment.appendChild(row);
    }

    sEl.list.appendChild(fragment);

    if (shopLastMovedId !== null) {
      setTimeout(() => {
        shopLastMovedId = null;
      }, 0);
    }
  }

  // ----- Toggle Shop Item -----
  async function toggleShopItem(id, btn) {
    if (!ctx.db || !ctx.adminCode) return;
    btn.disabled = true;
    try {
      const { data, error } = await ctx.db.rpc("admin_toggle_shop_item", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(id, 10),
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showShopMsg(data?.error || "Toggle failed", true);
        return;
      }
      showShopMsg(
        data.is_active
          ? "Product is now visible"
          : "Product hidden from shop",
        false,
      );
      loadShopItems();
    } catch (err) {
      showShopMsg("Error: " + err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  // ----- Delete Shop Item (double-click to confirm) -----
  async function deleteShopItem(id, btn) {
    if (!shopDeletePending.has(id)) {
      shopDeletePending.set(id, true);
      btn.textContent = "\u26A0\uFE0F Sure?";
      btn.classList.remove("danger");
      btn.classList.add("confirm-armed");
      setTimeout(() => {
        if (shopDeletePending.has(id)) {
          shopDeletePending.delete(id);
          btn.textContent = "\uD83D\uDDD1\uFE0F";
          btn.classList.remove("confirm-armed");
          btn.classList.add("danger");
        }
      }, SHOP_DELETE_MS);
      return;
    }

    shopDeletePending.delete(id);
    btn.disabled = true;
    btn.textContent = "...";

    try {
      const { data, error } = await ctx.db.rpc("admin_delete_shop_item", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(id, 10),
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showShopMsg(data?.error || "Delete failed", true);
        return;
      }
      showShopMsg("Product deleted permanently", false);
      loadShopItems();
    } catch (err) {
      showShopMsg("Error: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "\uD83D\uDDD1\uFE0F";
      btn.classList.remove("confirm-armed");
      btn.classList.add("danger");
    }
  }

  // ----- Edit Shop Item (modal) -----
  let shopEditOverlay = null;
  let shopEditEscHandler = null;

  function openShopEditModal(id) {
    const item = shopItems.find((i) => String(i.id) === String(id));
    if (!item) return;

    if (shopEditOverlay) shopEditOverlay.remove();

    shopEditOverlay = document.createElement("div");
    shopEditOverlay.className = "gallery-edit-overlay";
    shopEditOverlay.innerHTML = `
      <div class="gallery-edit-modal">
        <h3>\u270F\uFE0F Edit Product</h3>
        <div id="shopEditMessage" class="gallery-edit-message is-hidden"></div>
        <div class="gallery-edit-preview">
          <div class="gallery-edit-preview-img" id="shopEditPreviewImg"></div>
          <div class="gallery-edit-preview-text">
            <div style="font-weight:600;font-size:0.9rem;color:var(--color-text);" id="shopEditPreviewCaption"></div>
            <div class="gallery-edit-preview-caption" id="shopEditPreviewSubtext"></div>
          </div>
        </div>
        <form class="gallery-form" id="shopEditForm">
          <label for="shopEditTitle">Product Title</label>
          <input type="text" id="shopEditTitle" required>
          <label for="shopEditPrice">Price Display</label>
          <input type="text" id="shopEditPrice" required>
          <label for="shopEditEtsyUrl">Etsy URL</label>
          <input type="url" id="shopEditEtsyUrl" required>
          <label for="shopEditMedia">Media URLs (one per line)</label>
          <textarea id="shopEditMedia" rows="4" required></textarea>
          <label for="shopEditSortOrder">Position (1 = first)</label>
          <input type="number" id="shopEditSortOrder" min="1" max="9999">
          <div class="gallery-edit-visibility">
            <label>Visibility</label>
            <button type="button" id="shopEditActiveToggle" class="mini-btn gallery-item-badge" role="switch">&#x1F6AB;</button>
          </div>
          <div class="gallery-edit-actions">
            <button type="button" class="gallery-edit-cancel" id="shopEditCancelBtn">Cancel</button>
            <button type="submit" class="gallery-add-btn" id="shopEditSaveBtn">Save Changes</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(shopEditOverlay);

    // Cache modal elements
    const titleInput = shopEditOverlay.querySelector("#shopEditTitle");
    const priceInput = shopEditOverlay.querySelector("#shopEditPrice");
    const etsyUrlInput = shopEditOverlay.querySelector("#shopEditEtsyUrl");
    const mediaInput = shopEditOverlay.querySelector("#shopEditMedia");
    const sortInput = shopEditOverlay.querySelector("#shopEditSortOrder");
    const activeToggle = shopEditOverlay.querySelector(
      "#shopEditActiveToggle",
    );
    const previewImg = shopEditOverlay.querySelector("#shopEditPreviewImg");
    const previewCaption = shopEditOverlay.querySelector(
      "#shopEditPreviewCaption",
    );
    const previewSubtext = shopEditOverlay.querySelector(
      "#shopEditPreviewSubtext",
    );
    const editMessage = shopEditOverlay.querySelector("#shopEditMessage");

    // Seed values
    const media = Array.isArray(item.media) ? item.media : [];
    titleInput.value = String(item.title || "");
    priceInput.value = String(item.price_display || "");
    etsyUrlInput.value = String(item.etsy_url || "");
    mediaInput.value = media.join("\n");
    sortInput.value = String(Math.max(1, Number(item.sort_order) || 1));

    previewCaption.textContent = `${item.title || "Untitled"} \u2014 ${item.price_display || ""}`;
    previewSubtext.textContent = item.is_active
      ? "\u2705 Visible on site"
      : "\uD83D\uDEAB Hidden from site";

    // Thumbnail preview
    previewImg.textContent = "";
    const thumbUrl = media[0];
    if (thumbUrl && thumbUrl.startsWith("http")) {
      const img = document.createElement("img");
      img.alt = "Product thumbnail";
      img.src = thumbUrl;
      img.addEventListener(
        "error",
        () => {
          img.style.display = "none";
        },
        { once: true },
      );
      previewImg.appendChild(img);
    }

    // Active toggle
    const initActive = Boolean(item.is_active);
    activeToggle.dataset.active = String(initActive);
    activeToggle.setAttribute("aria-checked", String(initActive));
    activeToggle.className =
      "mini-btn gallery-item-badge " + (initActive ? "active" : "hidden");
    activeToggle.textContent = initActive
      ? "\uD83D\uDC41\uFE0F"
      : "\uD83D\uDEAB";
    activeToggle.title = "Click to " + (initActive ? "hide" : "show");

    activeToggle.addEventListener("click", () => {
      const cur = activeToggle.dataset.active === "true";
      const next = !cur;
      activeToggle.dataset.active = String(next);
      activeToggle.setAttribute("aria-checked", String(next));
      activeToggle.className =
        "mini-btn gallery-item-badge " + (next ? "active" : "hidden");
      activeToggle.textContent = next ? "\uD83D\uDC41\uFE0F" : "\uD83D\uDEAB";
      activeToggle.title = "Click to " + (next ? "hide" : "show");
      previewSubtext.textContent = next
        ? "\u2705 Visible on site"
        : "\uD83D\uDEAB Hidden from site";
    });

    // Live preview updates
    titleInput.addEventListener("input", () => {
      previewCaption.textContent = `${titleInput.value.trim() || "Untitled"} \u2014 ${priceInput.value.trim() || ""}`;
    });
    priceInput.addEventListener("input", () => {
      previewCaption.textContent = `${titleInput.value.trim() || "Untitled"} \u2014 ${priceInput.value.trim() || ""}`;
    });

    titleInput.focus();
    titleInput.select();

    // Close handlers
    shopEditOverlay.addEventListener("click", (ev) => {
      if (ev.target === shopEditOverlay) closeShopEditModal();
    });
    shopEditOverlay
      .querySelector("#shopEditCancelBtn")
      .addEventListener("click", closeShopEditModal);

    // Focus trap
    const modal = shopEditOverlay.querySelector(".gallery-edit-modal");
    modal.addEventListener("keydown", (ev) => {
      if (ev.key !== "Tab") return;
      const focusable = modal.querySelectorAll(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    });

    // Escape key
    if (shopEditEscHandler)
      document.removeEventListener("keydown", shopEditEscHandler);
    shopEditEscHandler = (ev) => {
      if (ev.key === "Escape") closeShopEditModal();
    };
    document.addEventListener("keydown", shopEditEscHandler);

    // Helper to show inline message
    function showShopEditMessage(text, isError) {
      editMessage.textContent = text;
      editMessage.className = isError
        ? "gallery-edit-message error"
        : "gallery-edit-message success";
      editMessage.classList.remove("is-hidden");
      setTimeout(() => editMessage.classList.add("is-hidden"), 4000);
    }

    // Save handler
    shopEditOverlay
      .querySelector("#shopEditForm")
      .addEventListener("submit", async (ev) => {
        ev.preventDefault();

        const newTitle = titleInput.value.trim();
        const newPrice = priceInput.value.trim();
        const newEtsyUrl = etsyUrlInput.value.trim();
        const newMedia = parseMediaUrls(mediaInput.value);
        const newSort = sortInput.value
          ? Math.max(1, parseInt(sortInput.value, 10))
          : 1;
        const newActive = activeToggle.dataset.active === "true";

        if (!newTitle) {
          showShopEditMessage("Title is required.", true);
          return;
        }
        if (!newPrice) {
          showShopEditMessage("Price is required.", true);
          return;
        }
        if (!newEtsyUrl) {
          showShopEditMessage("Etsy URL is required.", true);
          return;
        }
        if (newMedia.length === 0) {
          showShopEditMessage("At least one media URL is required.", true);
          return;
        }

        const saveBtn = shopEditOverlay.querySelector("#shopEditSaveBtn");
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";

        try {
          const { data, error } = await ctx.db.rpc("admin_edit_shop_item", {
            p_admin_code: ctx.adminCode,
            p_item_id: parseInt(id, 10),
            p_title: newTitle,
            p_price_display: newPrice,
            p_etsy_url: newEtsyUrl,
            p_media: newMedia,
            p_is_active: newActive,
            p_sort_order: newSort,
          });
          if (error) throw new Error(error.message);
          if (!data || !data.success) {
            showShopEditMessage(data?.error || "Update failed", true);
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Changes";
            return;
          }
          showShopEditMessage("\u2705 Product updated!", false);
          setTimeout(() => {
            closeShopEditModal();
            loadShopItems();
          }, 1000);
        } catch (err) {
          showShopEditMessage("Error: " + err.message, true);
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Changes";
        }
      });
  }

  function closeShopEditModal() {
    if (shopEditEscHandler) {
      document.removeEventListener("keydown", shopEditEscHandler);
      shopEditEscHandler = null;
    }
    if (shopEditOverlay) {
      shopEditOverlay.remove();
      shopEditOverlay = null;
    }
  }

  // ----- Event Delegation for Shop List -----
  sEl.list.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.getAttribute("data-shop-action");
    const id = btn.getAttribute("data-shop-id");
    if (!action || !id) return;

    if (action === "toggle") toggleShopItem(id, btn);
    if (action === "edit") openShopEditModal(id);
    if (action === "delete") deleteShopItem(id, btn);
  });

  // ----- Background Sync -----
  async function shopSyncSortOrders() {
    if (!ctx.db || !ctx.adminCode) return;
    try {
      const { data, error } = await ctx.db.rpc("admin_list_shop_items", {
        p_admin_code: ctx.adminCode,
      });
      if (error || !data || !data.success) return;
      const serverItems = data.items || [];
      const serverMap = new Map(serverItems.map((i) => [String(i.id), i]));
      shopItems.forEach((item) => {
        const server = serverMap.get(String(item.id));
        if (server) item.sort_order = server.sort_order;
      });
      shopItems.sort((a, b) => a.sort_order - b.sort_order);
      shopItems.forEach((item) => {
        const input = sEl.list.querySelector(
          `input.gallery-sort-input[data-shop-id="${item.id}"]`,
        );
        if (input) input.value = item.sort_order;
      });
    } catch (_) {
      /* best-effort */
    }
  }

  // ----- Inline Sort-Order Save -----
  async function shopSaveSortOrder(input) {
    const id = input.getAttribute("data-shop-id");
    const item = shopItems.find((i) => String(i.id) === String(id));
    if (!item) return;
    let newVal = parseInt(input.value, 10);
    if (isNaN(newVal) || newVal < 1) {
      input.value = Math.max(1, item.sort_order);
      return;
    }
    if (newVal === item.sort_order) return;

    input.disabled = true;
    try {
      const { data, error } = await ctx.db.rpc("admin_reorder_shop_item", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(id, 10),
        p_new_sort_order: newVal,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showShopMsg(data?.error || "Sort update failed", true);
        return;
      }
      showShopMsg(`Position updated to ${newVal}`, false);
      loadShopItems();
    } catch (err) {
      showShopMsg("Error: " + err.message, true);
    } finally {
      input.disabled = false;
    }
  }

  sEl.list.addEventListener("change", (e) => {
    if (e.target.matches('.gallery-sort-input[data-shop-action="sort"]'))
      shopSaveSortOrder(e.target);
  });
  sEl.list.addEventListener("keydown", (e) => {
    if (
      e.target.matches('.gallery-sort-input[data-shop-action="sort"]') &&
      e.key === "Enter"
    ) {
      e.preventDefault();
      e.target.blur();
    }
  });

  // ----- Drag & Drop Reorder (Desktop + Touch) -----
  let shopDragSrcId = null;
  let shopCurrentDropTarget = null;

  function shopClearDropIndicators() {
    if (!sEl.list) return;
    sEl.list
      .querySelectorAll(".drag-over, .drop-before, .drop-after")
      .forEach((el) => {
        el.classList.remove("drag-over", "drop-before", "drop-after");
      });
    shopCurrentDropTarget = null;
  }

  function shopUpdateDropIndicator(row, clientY) {
    if (!row || row.getAttribute("data-shop-id") === shopDragSrcId) {
      if (shopCurrentDropTarget) {
        shopCurrentDropTarget.classList.remove(
          "drag-over",
          "drop-before",
          "drop-after",
        );
        shopCurrentDropTarget = null;
      }
      shopDragDropTarget.id = null;
      return;
    }
    const rect = row.getBoundingClientRect();
    const isBefore = clientY - rect.top < rect.height / 2;

    if (shopCurrentDropTarget && shopCurrentDropTarget !== row) {
      shopCurrentDropTarget.classList.remove(
        "drag-over",
        "drop-before",
        "drop-after",
      );
    }
    shopCurrentDropTarget = row;
    row.classList.remove("drop-before", "drop-after");
    row.classList.add("drag-over", isBefore ? "drop-before" : "drop-after");

    shopDragDropTarget.id = row.getAttribute("data-shop-id");
    shopDragDropTarget.position = isBefore ? "before" : "after";
  }

  function shopOptimisticReorder(srcId, tgtId, position) {
    const srcEl = sEl.list.querySelector(`[data-shop-id="${srcId}"]`);
    const tgtEl = sEl.list.querySelector(`[data-shop-id="${tgtId}"]`);
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

    const srcIdx = shopItems.findIndex((i) => String(i.id) === String(srcId));
    const tgtIdx = shopItems.findIndex((i) => String(i.id) === String(tgtId));
    if (srcIdx !== -1 && tgtIdx !== -1) {
      const [moved] = shopItems.splice(srcIdx, 1);
      const newTgtIdx = shopItems.findIndex(
        (i) => String(i.id) === String(tgtId),
      );
      if (newTgtIdx !== -1) {
        const insertAt = position === "before" ? newTgtIdx : newTgtIdx + 1;
        shopItems.splice(insertAt, 0, moved);
      }
      shopItems.forEach((item, i) => {
        item.sort_order = i + 1;
      });
      shopItems.forEach((item) => {
        const input = sEl.list.querySelector(
          `input.gallery-sort-input[data-shop-id="${item.id}"]`,
        );
        if (input) input.value = item.sort_order;
      });
    }
  }

  async function shopPerformDrop() {
    const targetId = shopDragDropTarget.id;
    const targetPosition = shopDragDropTarget.position || "before";
    shopClearDropIndicators();

    if (!shopDragSrcId || !targetId || shopDragSrcId === targetId) return;

    const snapshot = shopItems.map((i) => ({ ...i }));
    shopOptimisticReorder(shopDragSrcId, targetId, targetPosition);

    try {
      const { data, error } = await ctx.db.rpc("admin_move_shop_item", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(shopDragSrcId, 10),
        p_target_id: parseInt(targetId, 10),
        p_position: targetPosition,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showShopMsg(data?.error || "Move failed \u2014 reverting", true);
        shopItems = snapshot;
        renderShopItems();
        return;
      }
      shopSyncSortOrders();
    } catch (err) {
      showShopMsg(
        "Error: " + (err?.message || err) + " \u2014 reverting",
        true,
      );
      shopItems = snapshot;
      renderShopItems();
    }
  }

  // --- Shared pointer drag (mouse + touch) ---
  let shopDragClone = null;
  let shopDragSourceRow = null;
  let shopDragOffsetY = 0;

  function shopStartDrag(row, clientX, clientY) {
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();

    shopDragSrcId = row.getAttribute("data-shop-id");
    shopDragSourceRow = row;
    row.classList.add("dragging");
    document.body.classList.add("is-dragging");

    const rect = row.getBoundingClientRect();
    shopDragOffsetY = clientY - rect.top;
    shopDragClone = row.cloneNode(true);
    shopDragClone.style.cssText =
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
    document.body.appendChild(shopDragClone);
  }

  function shopMoveDrag(clientX, clientY) {
    if (shopDragClone) {
      shopDragClone.style.top = clientY - shopDragOffsetY + "px";
    }
    if (shopDragSourceRow) shopDragSourceRow.style.pointerEvents = "none";
    const elBelow = document.elementFromPoint(clientX, clientY);
    if (shopDragSourceRow) shopDragSourceRow.style.pointerEvents = "";
    const row = elBelow ? elBelow.closest("[data-shop-id]") : null;
    shopUpdateDropIndicator(row, clientY);
  }

  async function shopEndDrag() {
    if (shopDragSourceRow) shopDragSourceRow.classList.remove("dragging");
    if (shopDragClone) {
      shopDragClone.remove();
      shopDragClone = null;
    }
    document.body.classList.remove("is-dragging");

    await shopPerformDrop();

    shopDragSourceRow = null;
    shopDragSrcId = null;
    shopDragDropTarget.id = null;
    shopDragDropTarget.position = "before";
  }

  // Mouse events (desktop)
  sEl.list.addEventListener("mousedown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    const row = handle.closest("[data-shop-id]");
    if (!row) return;
    e.preventDefault();

    shopStartDrag(row, e.clientX, e.clientY);

    function onMouseMove(ev) {
      ev.preventDefault();
      shopMoveDrag(ev.clientX, ev.clientY);
    }

    async function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      await shopEndDrag();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  sEl.list.addEventListener("dragstart", (e) => {
    e.preventDefault();
  });

  // Touch events (mobile / tablet)
  sEl.list.addEventListener(
    "touchstart",
    (e) => {
      const handle = e.target.closest(".drag-handle");
      if (!handle) return;
      const row = handle.closest("[data-shop-id]");
      if (!row) return;

      const touch = e.touches[0];
      shopStartDrag(row, touch.clientX, touch.clientY);
    },
    { passive: true },
  );

  sEl.list.addEventListener(
    "touchmove",
    (e) => {
      if (!shopDragSourceRow) return;
      e.preventDefault();
      const touch = e.touches[0];
      shopMoveDrag(touch.clientX, touch.clientY);
    },
    { passive: false },
  );

  sEl.list.addEventListener("touchend", async () => {
    if (!shopDragSourceRow) return;
    await shopEndDrag();
  });

  // ----- Page Titles Editor -----
  let shopPageTitles = [];

  function renderPageTitleInputs() {
    if (!sEl.pageTitlesList) return;
    sEl.pageTitlesList.innerHTML = "";
    const totalPages = Math.max(1, Math.ceil(shopItems.length / 3));

    // Ensure we have at least as many title slots as pages
    while (shopPageTitles.length < totalPages) shopPageTitles.push("");

    shopPageTitles.forEach((title, idx) => {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem;";

      const label = document.createElement("label");
      label.textContent = "Page " + (idx + 1) + ":";
      label.style.cssText =
        "font-size:0.82rem;min-width:55px;white-space:nowrap;";

      const input = document.createElement("input");
      input.type = "text";
      input.value = title;
      input.placeholder = "(no title)";
      input.style.cssText =
        "flex:1;font-size:0.85rem;padding:0.25rem 0.4rem;border:1px solid var(--mgmt-border);border-radius:4px;background:var(--mgmt-input-bg);color:var(--mgmt-text);";
      input.dataset.pageIdx = idx;

      input.addEventListener("input", () => {
        shopPageTitles[idx] = input.value;
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "\u00D7";
      removeBtn.title = "Remove page title";
      removeBtn.className = "mini-btn danger";
      removeBtn.addEventListener("click", () => {
        shopPageTitles.splice(idx, 1);
        renderPageTitleInputs();
      });

      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(removeBtn);
      sEl.pageTitlesList.appendChild(row);
    });
  }

  function showPageTitlesMsg(msg, isError) {
    if (!sEl.pageTitlesMsg) return;
    sEl.pageTitlesMsg.textContent = msg;
    sEl.pageTitlesMsg.className =
      "gallery-msg " + (isError ? "danger" : "success");
    setHidden(sEl.pageTitlesMsg, false);
    setTimeout(() => setHidden(sEl.pageTitlesMsg, true), 3000);
  }

  async function loadPageTitles() {
    if (!ctx.db || !ctx.adminCode) return;
    try {
      const { data, error } = await ctx.db.rpc("admin_get_shop_page_titles", {
        p_admin_code: ctx.adminCode,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) return;
      shopPageTitles = Array.isArray(data.titles) ? data.titles : [];
      renderPageTitleInputs();
    } catch (err) {
      console.error("Failed to load page titles:", err);
    }
  }

  if (sEl.addPageTitleBtn) {
    sEl.addPageTitleBtn.addEventListener("click", () => {
      shopPageTitles.push("");
      renderPageTitleInputs();
      // Focus the new input
      const inputs = sEl.pageTitlesList.querySelectorAll("input");
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
  }

  if (sEl.savePageTitlesBtn) {
    sEl.savePageTitlesBtn.addEventListener("click", async () => {
      if (!ctx.db || !ctx.adminCode) return;
      sEl.savePageTitlesBtn.disabled = true;
      sEl.savePageTitlesBtn.textContent = "Saving...";
      try {
        // Trim trailing empty strings
        const trimmed = shopPageTitles.slice();
        while (trimmed.length > 0 && !trimmed[trimmed.length - 1].trim())
          trimmed.pop();

        const { data, error } = await ctx.db.rpc(
          "admin_set_shop_page_titles",
          {
            p_admin_code: ctx.adminCode,
            p_titles: trimmed,
          },
        );
        if (error) throw new Error(error.message);
        if (!data || !data.success) {
          showPageTitlesMsg(data?.error || "Failed to save", true);
          return;
        }
        shopPageTitles = trimmed;
        renderPageTitleInputs();
        showPageTitlesMsg("Page titles saved!", false);
      } catch (err) {
        showPageTitlesMsg("Error: " + err.message, true);
      } finally {
        sEl.savePageTitlesBtn.disabled = false;
        sEl.savePageTitlesBtn.textContent = "Save Titles";
      }
    });
  }

  // ----- Load on section open -----
  sEl.section.addEventListener("toggle", () => {
    if (sEl.section.open && !shopLoaded && ctx.db && ctx.adminCode) {
      loadShopItems();
      loadPageTitles();
    }
  });
}
