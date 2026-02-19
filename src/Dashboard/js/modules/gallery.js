// ============================================
// GALLERY MANAGER MODULE
// ============================================
import {
  Trace,
  ctx,
  setHidden,
  extractDriveFileId,
  toEmbedUrl,
} from "./utils.js";

export function initGallery() {
  const gEl = {
    section: document.getElementById("gallerySection"),
    form: document.getElementById("galleryForm"),
    urlInput: document.getElementById("galleryUrl"),
    urlStatus: document.getElementById("galleryUrlStatus"),
    preview: document.getElementById("galleryPreview"),
    titleInput: document.getElementById("galleryTitle"),
    mediumInput: document.getElementById("galleryMedium"),
    yearInput: document.getElementById("galleryYear"),
    captionPreview: document.getElementById("galleryCaptionPreview"),
    addBtn: document.getElementById("galleryAddBtn"),
    message: document.getElementById("galleryMessage"),
    list: document.getElementById("galleryList"),
    count: document.getElementById("galleryCount"),
    bulkBar: document.getElementById("galleryBulkBar"),
    selectAll: document.getElementById("gallerySelectAll"),
    selectCount: document.getElementById("gallerySelectCount"),
    bulkBtns: document.getElementById("galleryBulkBtns"),
    randomizeBtn: document.getElementById("galleryRandomizeBtn"),
  };

  let galleryLoaded = false;
  let galleryItems = [];
  let lastMovedId = null;
  const galleryDeletePending = new Map();
  const GALLERY_DELETE_MS = 3000;
  const dragDropTarget = { id: null, position: "before" };
  const selectedGalleryIds = new Set();

  function buildCaption(title, medium, year) {
    let c = title || "";
    if (medium || year) {
      c += " - ";
      if (medium) c += medium;
      if (medium && year) c += " ";
      if (year) c += year;
    }
    return c;
  }

  // ----- URL Input Handler -----
  let convertedUrl = null;

  function handleUrlInput() {
    const raw = gEl.urlInput.value.trim();
    if (!raw) {
      setHidden(gEl.urlStatus, true);
      setHidden(gEl.preview, true);
      convertedUrl = null;
      return;
    }

    const fileId = extractDriveFileId(raw);
    if (fileId) {
      convertedUrl = toEmbedUrl(fileId);
      gEl.urlStatus.textContent = "✅ Valid Google Drive URL detected";
      gEl.urlStatus.className = "gallery-url-status valid";
      setHidden(gEl.urlStatus, false);
      gEl.preview.textContent = "";
      const img = document.createElement("img");
      img.alt = "Preview";
      img.src = convertedUrl;
      img.addEventListener(
        "error",
        () => {
          gEl.preview.textContent = "";
          const msg = document.createElement("span");
          msg.className = "text-muted-2";
          msg.style.fontSize = "0.7rem";
          msg.style.padding = "0.5rem";
          msg.textContent = "Could not load preview";
          gEl.preview.appendChild(msg);
        },
        { once: true },
      );
      gEl.preview.appendChild(img);
      setHidden(gEl.preview, false);
    } else {
      convertedUrl = null;
      gEl.urlStatus.textContent =
        "⚠️ Could not detect a Google Drive file ID";
      gEl.urlStatus.className = "gallery-url-status invalid";
      setHidden(gEl.urlStatus, false);
      setHidden(gEl.preview, true);
    }
  }

  gEl.urlInput.addEventListener("input", handleUrlInput);
  gEl.urlInput.addEventListener("paste", () =>
    setTimeout(handleUrlInput, 50),
  );

  // ----- Caption Preview -----
  function updateCaptionPreview() {
    const t = gEl.titleInput.value.trim();
    const m = gEl.mediumInput.value.trim();
    const y = gEl.yearInput.value.trim();
    if (t) {
      gEl.captionPreview.textContent =
        'Caption: "' + buildCaption(t, m, y) + '"';
    } else {
      gEl.captionPreview.textContent = "";
    }
  }

  gEl.titleInput.addEventListener("input", updateCaptionPreview);
  gEl.mediumInput.addEventListener("input", updateCaptionPreview);
  gEl.yearInput.addEventListener("input", updateCaptionPreview);

  // ----- Show Gallery Message -----
  function showGalleryMsg(text, isError) {
    gEl.message.textContent = text;
    gEl.message.className = "gallery-msg " + (isError ? "error" : "success");
    setHidden(gEl.message, false);
    setTimeout(() => setHidden(gEl.message, true), 5000);
  }

  // ----- Add Gallery Item -----
  gEl.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ctx.db || !ctx.adminCode) return;

    const imgUrl = convertedUrl;
    const title = gEl.titleInput.value.trim();
    const medium = gEl.mediumInput.value.trim() || null;
    const year = gEl.yearInput.value
      ? parseInt(gEl.yearInput.value, 10)
      : null;

    if (!imgUrl) {
      showGalleryMsg("Please paste a valid Google Drive image URL.", true);
      return;
    }
    if (!title) {
      showGalleryMsg("Please enter an artwork title.", true);
      return;
    }

    gEl.addBtn.disabled = true;
    gEl.addBtn.textContent = "Adding...";

    try {
      const maxSort =
        galleryItems.length > 0
          ? Math.max(...galleryItems.map((i) => i.sort_order || 0))
          : 0;
      const nextSort = Math.max(1, maxSort + 1);

      const { data, error } = await ctx.db.rpc("admin_add_gallery_item", {
        p_admin_code: ctx.adminCode,
        p_img_url: imgUrl,
        p_title: title,
        p_medium: medium,
        p_year_created: year,
        p_sort_order: nextSort,
      });

      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showGalleryMsg(data?.error || "Failed to add item", true);
        return;
      }

      showGalleryMsg(
        "Artwork added to gallery! Visitors will see it on page refresh.",
        false,
      );
      gEl.form.reset();
      convertedUrl = null;
      setHidden(gEl.urlStatus, true);
      setHidden(gEl.preview, true);
      gEl.captionPreview.textContent = "";
      loadGalleryItems();
    } catch (err) {
      showGalleryMsg("Error: " + err.message, true);
    } finally {
      gEl.addBtn.disabled = false;
      gEl.addBtn.textContent = "Add to Gallery";
    }
  });

  // ----- Load Gallery Items -----
  async function loadGalleryItems() {
    if (!ctx.db || !ctx.adminCode) return;

    try {
      const { data, error } = await ctx.db.rpc("admin_list_gallery", {
        p_admin_code: ctx.adminCode,
      });

      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        gEl.list.textContent = "";
        const p = document.createElement("p");
        p.className = "text-danger";
        p.style.fontSize = "0.85rem";
        p.textContent = String(data?.error || "Failed to load");
        gEl.list.appendChild(p);
        return;
      }

      galleryItems = data.items || [];
      renderGalleryItems();
      galleryLoaded = true;
    } catch (err) {
      gEl.list.textContent = "";
      const p = document.createElement("p");
      p.className = "text-danger";
      p.style.fontSize = "0.85rem";
      p.textContent =
        "Error: " + String(err?.message || err || "Unknown error");
      gEl.list.appendChild(p);
    }
  }

  // ----- Render Gallery Items -----
  function renderGalleryItems() {
    const visibleItems = galleryItems.filter((i) => i.is_active);
    const hiddenItems = galleryItems.filter((i) => !i.is_active);
    const total = galleryItems.length;
    gEl.count.textContent = `${visibleItems.length} active / ${total} total items`;

    if (total === 0) {
      gEl.list.textContent = "";
      const p = document.createElement("p");
      p.className = "text-muted-2";
      p.style.fontSize = "0.85rem";
      p.textContent = "No gallery items yet. Add your first artwork above!";
      gEl.list.appendChild(p);
      if (gEl.bulkBar) gEl.bulkBar.classList.add("is-hidden");
      return;
    }

    // Prune selection: remove IDs that no longer exist
    for (const id of selectedGalleryIds) {
      if (!galleryItems.some((i) => String(i.id) === id)) selectedGalleryIds.delete(id);
    }

    gEl.list.textContent = "";
    const fragment = document.createDocumentFragment();

    // Helper to build a single gallery row
    function buildRow(item) {
      const caption = buildCaption(item.title, item.medium, item.year_created);
      const isActive = Boolean(item.is_active);
      const date = new Date(item.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const flashClass =
        String(item.id) === String(lastMovedId) ? " flash" : "";

      const row = document.createElement("div");
      row.className =
        "gallery-item " + (isActive ? "" : "inactive") + flashClass;
      row.setAttribute("data-gallery-id", String(item.id));
      if (selectedGalleryIds.has(String(item.id))) row.classList.add("selected");

      // Selection checkbox
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "gallery-select-cb";
      cb.dataset.galleryId = String(item.id);
      cb.checked = selectedGalleryIds.has(String(item.id));
      cb.setAttribute("aria-label", "Select " + String(item.title || "Artwork"));
      cb.addEventListener("change", () => {
        if (cb.checked) selectedGalleryIds.add(String(item.id));
        else selectedGalleryIds.delete(String(item.id));
        row.classList.toggle("selected", cb.checked);
        updateGalleryBulkBar();
      });

      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.title = "Drag to reorder";
      handle.textContent = "⠿";

      const thumb = document.createElement("div");
      thumb.className = "gallery-item-thumb";
      if (
        typeof item.img_url === "string" &&
        item.img_url.startsWith("http")
      ) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.alt = String(item.title || "Artwork");
        img.src = item.img_url;
        img.addEventListener(
          "error",
          () => {
            img.style.display = "none";
          },
          { once: true },
        );
        thumb.appendChild(img);
      } else {
        const fallback = document.createElement("span");
        fallback.style.display = "flex";
        fallback.style.alignItems = "center";
        fallback.style.justifyContent = "center";
        fallback.style.height = "100%";
        fallback.style.fontSize = "1.2rem";
        fallback.textContent = "🖼️";
        thumb.appendChild(fallback);
      }

      const info = document.createElement("div");
      info.className = "gallery-item-info";
      const title = document.createElement("div");
      title.className = "gallery-item-title";
      title.textContent = caption;
      const meta = document.createElement("div");
      meta.className = "gallery-item-meta";
      meta.textContent = "Added " + date;
      info.append(title, meta);

      const sortInput = document.createElement("input");
      sortInput.type = "number";
      sortInput.className = "gallery-sort-input";
      sortInput.min = "1";
      sortInput.max = "9999";
      sortInput.title = "Position (1 = first)";
      sortInput.setAttribute("data-gallery-action", "sort");
      sortInput.setAttribute("data-gallery-id", String(item.id));
      sortInput.setAttribute(
        "aria-label",
        "Sort order for " + String(item.title || "Artwork"),
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
      toggleBtn.setAttribute("data-gallery-action", "toggle");
      toggleBtn.setAttribute("data-gallery-id", String(item.id));
      toggleBtn.title = "Click to " + (isActive ? "hide" : "show");
      toggleBtn.textContent = isActive ? "👁️" : "🚫";

      const editBtn = document.createElement("button");
      editBtn.className = "mini-btn secondary";
      editBtn.setAttribute("data-gallery-action", "edit");
      editBtn.setAttribute("data-gallery-id", String(item.id));
      editBtn.title = "Edit details";
      editBtn.textContent = "✏️";

      const delBtn = document.createElement("button");
      delBtn.className = "mini-btn danger";
      delBtn.setAttribute("data-gallery-action", "delete");
      delBtn.setAttribute("data-gallery-id", String(item.id));
      delBtn.title = "Delete permanently";
      delBtn.textContent = "🗑️";

      actions.append(toggleBtn, editBtn, delBtn);
      row.append(cb, handle, thumb, info, sortInput, actions);
      return row;
    }

    // ---- Visible section ----
    for (const item of visibleItems) {
      fragment.appendChild(buildRow(item));
    }

    // ---- Hidden section divider + hidden items ----
    if (hiddenItems.length > 0) {
      const divider = document.createElement("div");
      divider.className = "gallery-section-divider";
      divider.textContent = `🚫 Hidden (${hiddenItems.length})`;
      fragment.appendChild(divider);

      for (const item of hiddenItems) {
        fragment.appendChild(buildRow(item));
      }
    }

    gEl.list.appendChild(fragment);

    // Show bulk bar when there are visible items
    if (visibleItems.length > 0 && gEl.bulkBar) {
      gEl.bulkBar.classList.remove("is-hidden");
    } else if (gEl.bulkBar) {
      gEl.bulkBar.classList.add("is-hidden");
    }
    updateGalleryBulkBar();

    if (lastMovedId !== null) {
      setTimeout(() => {
        lastMovedId = null;
      }, 0);
    }
  }

  // ----- Gallery Bulk Selection Bar -----
  function updateGalleryBulkBar() {
    if (!gEl.selectCount || !gEl.bulkBtns || !gEl.selectAll) return;
    const visibleIds = new Set(galleryItems.filter((i) => i.is_active).map((i) => String(i.id)));
    // Only count selections among visible items
    const n = [...selectedGalleryIds].filter((id) => visibleIds.has(id)).length;
    if (n > 0) {
      gEl.selectCount.textContent = `${n} selected`;
      gEl.bulkBtns.classList.remove("is-hidden");
    } else {
      gEl.selectCount.textContent = "Select all";
      gEl.bulkBtns.classList.add("is-hidden");
    }
    // Sync select-all checkbox — checked only if all visible items are selected
    gEl.selectAll.checked = visibleIds.size > 0 && n === visibleIds.size;
  }

  // Select-all toggle (visible items only)
  if (gEl.selectAll) {
    gEl.selectAll.addEventListener("change", () => {
      const cbs = gEl.list.querySelectorAll(".gallery-select-cb");
      cbs.forEach((cb) => {
        const id = cb.dataset.galleryId;
        // Only auto-select visible (active) items
        const item = galleryItems.find((i) => String(i.id) === id);
        if (!item || !item.is_active) return;
        cb.checked = gEl.selectAll.checked;
        if (gEl.selectAll.checked) selectedGalleryIds.add(id);
        else selectedGalleryIds.delete(id);
        const row = cb.closest(".gallery-item");
        if (row) row.classList.toggle("selected", gEl.selectAll.checked);
      });
      updateGalleryBulkBar();
    });
  }

  // Randomize selected items
  if (gEl.randomizeBtn) {
    gEl.randomizeBtn.addEventListener("click", async () => {
      if (selectedGalleryIds.size < 2) {
        showGalleryMsg("Select at least 2 items to randomize.", true);
        return;
      }
      if (!ctx.db || !ctx.adminCode) return;

      // Gather selected items that are VISIBLE (active) — hidden items are never shuffled
      const selected = galleryItems.filter(
        (i) => i.is_active && selectedGalleryIds.has(String(i.id))
      );

      if (selected.length < 2) {
        showGalleryMsg("Select at least 2 visible items to randomize.", true);
        return;
      }

      const sortOrders = selected.map((i) => i.sort_order);

      // Fisher-Yates shuffle
      for (let i = sortOrders.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sortOrders[i], sortOrders[j]] = [sortOrders[j], sortOrders[i]];
      }

      gEl.randomizeBtn.disabled = true;
      gEl.randomizeBtn.textContent = "🎲 Shuffling...";

      try {
        // Apply shuffled sort_orders via individual reorder calls
        for (let i = 0; i < selected.length; i++) {
          const { error } = await ctx.db.rpc("admin_reorder_gallery_item", {
            p_admin_code: ctx.adminCode,
            p_item_id: parseInt(selected[i].id, 10),
            p_new_sort_order: sortOrders[i],
          });
          if (error) throw new Error(error.message);
        }

        showGalleryMsg(`Randomized ${selected.length} items!`, false);
        selectedGalleryIds.clear();
        loadGalleryItems();
      } catch (err) {
        showGalleryMsg("Randomize error: " + err.message, true);
      } finally {
        gEl.randomizeBtn.disabled = false;
        gEl.randomizeBtn.textContent = "🎲 Randomize Selected";
      }
    });
  }

  // ----- Toggle Gallery Item -----
  async function toggleGalleryItem(id, btn) {
    if (!ctx.db || !ctx.adminCode) return;
    btn.disabled = true;
    try {
      const { data, error } = await ctx.db.rpc("admin_toggle_gallery_item", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(id, 10),
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showGalleryMsg(data?.error || "Toggle failed", true);
        return;
      }
      showGalleryMsg(
        data.is_active
          ? "Item is now visible in gallery"
          : "Item hidden from gallery",
        false,
      );
      loadGalleryItems();
    } catch (err) {
      showGalleryMsg("Error: " + err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  // ----- Delete Gallery Item (double-click to confirm) -----
  async function deleteGalleryItem(id, btn) {
    if (!galleryDeletePending.has(id)) {
      galleryDeletePending.set(id, true);
      btn.textContent = "⚠️ Sure?";
      btn.classList.remove("danger");
      btn.classList.add("confirm-armed");
      setTimeout(() => {
        if (galleryDeletePending.has(id)) {
          galleryDeletePending.delete(id);
          btn.textContent = "🗑️";
          btn.classList.remove("confirm-armed");
          btn.classList.add("danger");
        }
      }, GALLERY_DELETE_MS);
      return;
    }

    galleryDeletePending.delete(id);
    btn.disabled = true;
    btn.textContent = "...";

    try {
      const { data, error } = await ctx.db.rpc("admin_delete_gallery_item", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(id, 10),
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showGalleryMsg(data?.error || "Delete failed", true);
        return;
      }
      showGalleryMsg("Item deleted permanently", false);
      loadGalleryItems();
    } catch (err) {
      showGalleryMsg("Error: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "🗑️";
      btn.classList.remove("confirm-armed");
      btn.classList.add("danger");
    }
  }

  // ----- Edit Gallery Item (modal) -----
  let editOverlay = null;
  let editConvertedUrl = null;
  let editEscHandler = null;

  function setPreviewImage(container, url, altText) {
    if (!container) return;
    container.textContent = "";
    if (!url) {
      const fallback = document.createElement("span");
      fallback.style.display = "flex";
      fallback.style.alignItems = "center";
      fallback.style.justifyContent = "center";
      fallback.style.height = "100%";
      fallback.style.fontSize = "2rem";
      fallback.textContent = "🖼️";
      container.appendChild(fallback);
      return;
    }
    const img = document.createElement("img");
    img.alt = altText || "Preview";
    img.src = url;
    img.addEventListener(
      "error",
      () => {
        img.style.display = "none";
      },
      { once: true },
    );
    container.appendChild(img);
  }

  function openEditModal(id) {
    const item = galleryItems.find((i) => String(i.id) === String(id));
    if (!item) return;

    if (editOverlay) editOverlay.remove();
    editConvertedUrl = null;

    editOverlay = document.createElement("div");
    editOverlay.className = "gallery-edit-overlay";
    editOverlay.innerHTML = `
      <div class="gallery-edit-modal">
          <h3>✏️ Edit Artwork</h3>
          <div id="editMessage" class="gallery-edit-message is-hidden"></div>
          <div class="gallery-edit-preview">
              <div class="gallery-edit-preview-img" id="editPreviewImg"></div>
              <div class="gallery-edit-preview-text">
                  <div style="font-weight:600;font-size:0.9rem;color:var(--color-text);" id="editPreviewCaption"></div>
                  <div class="gallery-edit-preview-caption" id="editPreviewSubtext"></div>
              </div>
          </div>
          <form class="gallery-form" id="galleryEditForm">
              <label for="editUrl">Image URL</label>
              <input type="text" id="editUrl" placeholder="Paste Google Drive share link or direct image URL" required>
              <div id="editUrlStatus" class="gallery-url-status is-hidden"></div>
              <label for="editTitle">Title</label>
              <input type="text" id="editTitle" required>
              <label for="editMedium">Medium</label>
              <input type="text" id="editMedium" list="mediumOptions" placeholder="e.g. Digital, Canvas, Physical">
              <label for="editYear">Year</label>
              <input type="number" id="editYear" min="1900" max="2100" placeholder="e.g. 2024">
              <label for="editSortOrder">Position (1 = first, higher numbers shown later)</label>
              <input type="number" id="editSortOrder" min="1" max="9999" placeholder="e.g. 1">
              <div class="gallery-edit-visibility">
                  <label>Visibility Status</label>
                  <button type="button" id="editActiveToggle" class="mini-btn gallery-item-badge" role="switch" aria-checked="false" data-active="false">🚫</button>
              </div>
              <div class="gallery-edit-actions">
                  <button type="button" class="gallery-edit-cancel" id="editCancelBtn">Cancel</button>
                  <button type="submit" class="gallery-add-btn" id="editSaveBtn">Save Changes</button>
              </div>
          </form>
      </div>
    `;

    document.body.appendChild(editOverlay);

    const urlInput = editOverlay.querySelector("#editUrl");
    const urlStatus = editOverlay.querySelector("#editUrlStatus");
    const previewImg = editOverlay.querySelector("#editPreviewImg");
    const titleInput = editOverlay.querySelector("#editTitle");
    const mediumInput = editOverlay.querySelector("#editMedium");
    const yearInput = editOverlay.querySelector("#editYear");
    const activeToggle = editOverlay.querySelector("#editActiveToggle");
    const previewCaption = editOverlay.querySelector("#editPreviewCaption");
    const previewSubtext = editOverlay.querySelector("#editPreviewSubtext");
    const editMessage = editOverlay.querySelector("#editMessage");

    urlInput.value = String(item.img_url || "");
    titleInput.value = String(item.title || "");
    mediumInput.value = String(item.medium || "");
    yearInput.value = item.year_created ? String(item.year_created) : "";
    editOverlay.querySelector("#editSortOrder").value = String(
      Math.max(1, Number(item.sort_order) || 1),
    );

    setPreviewImage(
      previewImg,
      typeof item.img_url === "string" && item.img_url.startsWith("http")
        ? item.img_url
        : "",
      "Current artwork",
    );
    previewCaption.textContent = buildCaption(
      item.title,
      item.medium,
      item.year_created,
    );
    previewSubtext.textContent = item.is_active
      ? "✅ Visible on site"
      : "🚫 Hidden from site";

    activeToggle.dataset.active = String(Boolean(item.is_active));
    activeToggle.setAttribute(
      "aria-checked",
      String(Boolean(item.is_active)),
    );
    activeToggle.className =
      "mini-btn gallery-item-badge " + (item.is_active ? "active" : "hidden");
    activeToggle.title = "Click to " + (item.is_active ? "hide" : "show");
    activeToggle.textContent = item.is_active ? "👁️" : "🚫";

    activeToggle.addEventListener("click", () => {
      const isActive = activeToggle.dataset.active === "true";
      const newActive = !isActive;
      activeToggle.dataset.active = String(newActive);
      activeToggle.setAttribute("aria-checked", String(newActive));
      activeToggle.className =
        "mini-btn gallery-item-badge " + (newActive ? "active" : "hidden");
      activeToggle.title = "Click to " + (newActive ? "hide" : "show");
      activeToggle.textContent = newActive ? "👁️" : "🚫";
      previewSubtext.textContent = newActive
        ? "✅ Visible on site"
        : "🚫 Hidden from site";
    });

    function handleEditUrlInput() {
      const raw = urlInput.value.trim();
      if (!raw) {
        urlStatus.classList.add("is-hidden");
        editConvertedUrl = null;
        return;
      }

      const fileId = extractDriveFileId(raw);
      if (fileId) {
        const embedUrl = toEmbedUrl(fileId);
        editConvertedUrl = embedUrl;
        urlStatus.textContent = "✅ Google Drive link converted";
        urlStatus.className = "gallery-url-status valid";
        setPreviewImage(previewImg, embedUrl, "Preview");
      } else {
        editConvertedUrl = null;
        if (raw.startsWith("http")) {
          urlStatus.textContent = "✅ Direct URL detected";
          urlStatus.className = "gallery-url-status valid";
          setPreviewImage(previewImg, raw, "Preview");
        } else {
          urlStatus.textContent = "⚠️ Invalid URL format";
          urlStatus.className = "gallery-url-status invalid";
        }
      }
    }

    function updateEditCaptionPreview() {
      const t2 = titleInput.value.trim() || "Untitled";
      const m2 = mediumInput.value.trim();
      const y2 = yearInput.value;
      previewCaption.textContent = buildCaption(t2, m2, y2);
    }

    urlInput.addEventListener("input", handleEditUrlInput);
    urlInput.addEventListener("paste", () =>
      setTimeout(handleEditUrlInput, 50),
    );
    titleInput.addEventListener("input", updateEditCaptionPreview);
    mediumInput.addEventListener("input", updateEditCaptionPreview);
    yearInput.addEventListener("input", updateEditCaptionPreview);

    titleInput.focus();
    titleInput.select();

    editOverlay.addEventListener("click", (ev) => {
      if (ev.target === editOverlay) closeEditModal();
    });

    editOverlay
      .querySelector("#editCancelBtn")
      .addEventListener("click", closeEditModal);

    const modal = editOverlay.querySelector(".gallery-edit-modal");
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

    if (editEscHandler) {
      document.removeEventListener("keydown", editEscHandler);
    }
    editEscHandler = (ev) => {
      if (ev.key === "Escape") closeEditModal();
    };
    document.addEventListener("keydown", editEscHandler);

    function showEditMessage(text, isError) {
      editMessage.textContent = text;
      editMessage.className = isError
        ? "gallery-edit-message error"
        : "gallery-edit-message success";
      editMessage.classList.remove("is-hidden");
      setTimeout(() => editMessage.classList.add("is-hidden"), 4000);
    }

    editOverlay
      .querySelector("#galleryEditForm")
      .addEventListener("submit", async (ev) => {
        ev.preventDefault();

        const newUrl = editConvertedUrl || urlInput.value.trim();
        const newTitle = titleInput.value.trim();
        const newMedium = mediumInput.value.trim() || null;
        const newYear = yearInput.value
          ? parseInt(yearInput.value, 10)
          : null;
        const newSort =
          editOverlay.querySelector("#editSortOrder").value !== ""
            ? Math.max(
                1,
                parseInt(
                  editOverlay.querySelector("#editSortOrder").value,
                  10,
                ),
              )
            : 1;
        const newActive = activeToggle.dataset.active === "true";

        if (!newUrl) {
          showEditMessage("Image URL is required.", true);
          return;
        }
        if (!newTitle) {
          showEditMessage("Title is required.", true);
          return;
        }

        const saveBtn = editOverlay.querySelector("#editSaveBtn");
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";

        try {
          const { data, error } = await ctx.db.rpc("admin_edit_gallery_item", {
            p_admin_code: ctx.adminCode,
            p_item_id: parseInt(id, 10),
            p_img_url: newUrl,
            p_title: newTitle,
            p_medium: newMedium,
            p_year_created: newYear,
            p_sort_order: newSort,
            p_is_active: newActive,
          });
          if (error) throw new Error(error.message);
          if (!data || !data.success) {
            showEditMessage(data?.error || "Update failed", true);
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Changes";
            return;
          }
          showEditMessage("✅ Artwork updated successfully!", false);

          if (newSort !== item.sort_order) {
            try {
              await ctx.db.rpc("admin_reorder_gallery_item", {
                p_admin_code: ctx.adminCode,
                p_item_id: parseInt(id, 10),
                p_new_sort_order: newSort,
              });
            } catch (_) {
              /* best-effort */
            }
          }

          setTimeout(() => {
            closeEditModal();
            loadGalleryItems();
          }, 1000);
        } catch (err) {
          showEditMessage("Error: " + err.message, true);
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Changes";
        }
      });
  }

  function closeEditModal() {
    if (editEscHandler) {
      document.removeEventListener("keydown", editEscHandler);
      editEscHandler = null;
    }
    if (editOverlay) {
      editOverlay.remove();
      editOverlay = null;
    }
  }

  // ----- Event Delegation for Gallery List -----
  gEl.list.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.getAttribute("data-gallery-action");
    const id = btn.getAttribute("data-gallery-id");
    if (!action || !id) return;

    if (action === "toggle") toggleGalleryItem(id, btn);
    if (action === "edit") openEditModal(id);
    if (action === "delete") deleteGalleryItem(id, btn);
  });

  // ----- Quiet Background Sync -----
  async function syncSortOrders() {
    if (!ctx.db || !ctx.adminCode) return;
    try {
      const { data, error } = await ctx.db.rpc("admin_list_gallery", {
        p_admin_code: ctx.adminCode,
      });
      if (error || !data || !data.success) return;
      const serverItems = data.items || [];
      const serverMap = new Map(serverItems.map((i) => [String(i.id), i]));
      galleryItems.forEach((item) => {
        const server = serverMap.get(String(item.id));
        if (server) item.sort_order = server.sort_order;
      });
      galleryItems.sort((a, b) => a.sort_order - b.sort_order);
      galleryItems.forEach((item) => {
        const input = gEl.list.querySelector(
          `input.gallery-sort-input[data-gallery-id="${item.id}"]`,
        );
        if (input) input.value = item.sort_order;
      });
    } catch (_) {
      /* best-effort */
    }
  }

  // ----- Inline Sort-Order Save -----
  async function saveSortOrder(input) {
    const id = input.getAttribute("data-gallery-id");
    const item = galleryItems.find((i) => String(i.id) === String(id));
    if (!item) return;
    let newVal = parseInt(input.value, 10);
    if (isNaN(newVal) || newVal < 1) {
      input.value = Math.max(1, item.sort_order);
      return;
    }
    if (newVal === item.sort_order) return;

    input.disabled = true;
    try {
      const { data, error } = await ctx.db.rpc("admin_reorder_gallery_item", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(id, 10),
        p_new_sort_order: newVal,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showGalleryMsg(data?.error || "Sort update failed", true);
        return;
      }
      showGalleryMsg(`Position updated to ${newVal}`, false);
      loadGalleryItems();
    } catch (err) {
      showGalleryMsg("Error: " + err.message, true);
    } finally {
      input.disabled = false;
    }
  }

  gEl.list.addEventListener("change", (e) => {
    if (e.target.matches(".gallery-sort-input")) saveSortOrder(e.target);
  });
  gEl.list.addEventListener("keydown", (e) => {
    if (e.target.matches(".gallery-sort-input") && e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
    }
  });

  // ----- Drag & Drop Reorder (Desktop + Touch) -----
  let dragSrcId = null;
  let currentDropTarget = null;

  function clearDropIndicators() {
    if (!gEl.list) return;
    gEl.list
      .querySelectorAll(".drag-over, .drop-before, .drop-after")
      .forEach((el) => {
        el.classList.remove("drag-over", "drop-before", "drop-after");
      });
    currentDropTarget = null;
  }

  function updateDropIndicator(row, clientY) {
    if (!row || row.getAttribute("data-gallery-id") === dragSrcId) {
      if (currentDropTarget) {
        currentDropTarget.classList.remove(
          "drag-over",
          "drop-before",
          "drop-after",
        );
        currentDropTarget = null;
      }
      dragDropTarget.id = null;
      return;
    }
    const rect = row.getBoundingClientRect();
    const isBefore = clientY - rect.top < rect.height / 2;

    if (currentDropTarget && currentDropTarget !== row) {
      currentDropTarget.classList.remove(
        "drag-over",
        "drop-before",
        "drop-after",
      );
    }
    currentDropTarget = row;
    row.classList.remove("drop-before", "drop-after");
    row.classList.add("drag-over", isBefore ? "drop-before" : "drop-after");

    dragDropTarget.id = row.getAttribute("data-gallery-id");
    dragDropTarget.position = isBefore ? "before" : "after";
  }

  function optimisticReorder(srcId, tgtId, position) {
    const srcEl = gEl.list.querySelector(`[data-gallery-id="${srcId}"]`);
    const tgtEl = gEl.list.querySelector(`[data-gallery-id="${tgtId}"]`);
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

    const srcIdx = galleryItems.findIndex(
      (i) => String(i.id) === String(srcId),
    );
    const tgtIdx = galleryItems.findIndex(
      (i) => String(i.id) === String(tgtId),
    );
    if (srcIdx !== -1 && tgtIdx !== -1) {
      const [moved] = galleryItems.splice(srcIdx, 1);
      const newTgtIdx = galleryItems.findIndex(
        (i) => String(i.id) === String(tgtId),
      );
      if (newTgtIdx !== -1) {
        const insertAt = position === "before" ? newTgtIdx : newTgtIdx + 1;
        galleryItems.splice(insertAt, 0, moved);
      }
      galleryItems.forEach((item, i) => {
        item.sort_order = i + 1;
      });
      galleryItems.forEach((item) => {
        const input = gEl.list.querySelector(
          `input.gallery-sort-input[data-gallery-id="${item.id}"]`,
        );
        if (input) input.value = item.sort_order;
      });
    }
  }

  async function performDrop() {
    const targetId = dragDropTarget.id;
    const targetPosition = dragDropTarget.position || "before";
    clearDropIndicators();

    if (!dragSrcId || !targetId || dragSrcId === targetId) return;

    const snapshot = galleryItems.map((i) => ({ ...i }));
    optimisticReorder(dragSrcId, targetId, targetPosition);

    try {
      const { data, error } = await ctx.db.rpc("admin_move_gallery_item", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(dragSrcId, 10),
        p_target_id: parseInt(targetId, 10),
        p_position: targetPosition,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showGalleryMsg(data?.error || "Move failed — reverting", true);
        galleryItems = snapshot;
        renderGalleryItems();
        return;
      }
      syncSortOrders();
    } catch (err) {
      showGalleryMsg(
        "Error: " + (err?.message || err) + " — reverting",
        true,
      );
      galleryItems = snapshot;
      renderGalleryItems();
    }
  }

  // ——— Shared pointer drag (mouse + touch) ———
  let dragClone = null;
  let dragSourceRow = null;
  let dragOffsetY = 0;

  function startDrag(row, clientX, clientY) {
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();

    dragSrcId = row.getAttribute("data-gallery-id");
    dragSourceRow = row;
    row.classList.add("dragging");
    document.body.classList.add("is-dragging");

    const rect = row.getBoundingClientRect();
    dragOffsetY = clientY - rect.top;
    dragClone = row.cloneNode(true);
    dragClone.style.cssText =
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
    document.body.appendChild(dragClone);
  }

  function moveDrag(clientX, clientY) {
    if (dragClone) {
      dragClone.style.top = clientY - dragOffsetY + "px";
    }
    if (dragSourceRow) dragSourceRow.style.pointerEvents = "none";
    const elBelow = document.elementFromPoint(clientX, clientY);
    if (dragSourceRow) dragSourceRow.style.pointerEvents = "";
    const row = elBelow ? elBelow.closest("[data-gallery-id]") : null;
    updateDropIndicator(row, clientY);
  }

  async function endDrag() {
    if (dragSourceRow) dragSourceRow.classList.remove("dragging");
    if (dragClone) {
      dragClone.remove();
      dragClone = null;
    }
    document.body.classList.remove("is-dragging");

    await performDrop();

    dragSourceRow = null;
    dragSrcId = null;
    dragDropTarget.id = null;
    dragDropTarget.position = "before";
  }

  // ——— Mouse events (desktop) ———
  gEl.list.addEventListener("mousedown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    const row = handle.closest(".gallery-item");
    if (!row) return;
    e.preventDefault();

    startDrag(row, e.clientX, e.clientY);

    function onMouseMove(ev) {
      ev.preventDefault();
      moveDrag(ev.clientX, ev.clientY);
    }

    async function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      await endDrag();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  gEl.list.addEventListener("dragstart", (e) => {
    e.preventDefault();
  });

  // ——— Touch events (mobile / tablet) ———
  gEl.list.addEventListener(
    "touchstart",
    (e) => {
      const handle = e.target.closest(".drag-handle");
      if (!handle) return;
      const row = handle.closest(".gallery-item");
      if (!row) return;

      const touch = e.touches[0];
      startDrag(row, touch.clientX, touch.clientY);
    },
    { passive: true },
  );

  gEl.list.addEventListener(
    "touchmove",
    (e) => {
      if (!dragSourceRow) return;
      e.preventDefault();
      const touch = e.touches[0];
      moveDrag(touch.clientX, touch.clientY);
    },
    { passive: false },
  );

  gEl.list.addEventListener("touchend", async () => {
    if (!dragSourceRow) return;
    await endDrag();
  });

  // ----- Load on section open -----
  gEl.section.addEventListener("toggle", () => {
    if (gEl.section.open && !galleryLoaded && ctx.db && ctx.adminCode) {
      loadGalleryItems();
    }
  });
}
