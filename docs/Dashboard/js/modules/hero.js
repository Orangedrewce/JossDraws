// ============================================
// HERO SLIDESHOW MANAGER MODULE
// ============================================
import {
  ctx,
  setHidden,
  extractDriveFileId,
  toEmbedUrl,
} from "./utils.js";

export function initHero() {
  const hEl = {
    section: document.getElementById("heroSection"),
    form: document.getElementById("heroForm"),
    urlInput: document.getElementById("heroUrl"),
    urlStatus: document.getElementById("heroUrlStatus"),
    preview: document.getElementById("heroPreview"),
    addBtn: document.getElementById("heroAddBtn"),
    message: document.getElementById("heroMessage"),
    list: document.getElementById("heroList"),
    count: document.getElementById("heroCount"),
  };

  let heroLoaded = false;
  let heroItems = [];
  let heroLastMovedId = null;
  const heroDeletePending = new Map();
  const HERO_DELETE_MS = 3000;
  const heroDragDropTarget = { id: null, position: "before" };

  // ----- URL Input Handler -----
  let heroConvertedUrl = null;

  function handleHeroUrlInput() {
    const raw = hEl.urlInput.value.trim();
    if (!raw) {
      setHidden(hEl.urlStatus, true);
      setHidden(hEl.preview, true);
      heroConvertedUrl = null;
      return;
    }

    const fileId = extractDriveFileId(raw);
    if (fileId) {
      heroConvertedUrl = toEmbedUrl(fileId);
      hEl.urlStatus.textContent = "✅ Valid Google Drive URL detected";
      hEl.urlStatus.className = "gallery-url-status valid";
      setHidden(hEl.urlStatus, false);
      hEl.preview.textContent = "";
      const img = document.createElement("img");
      img.alt = "Preview";
      img.src = heroConvertedUrl;
      img.addEventListener(
        "error",
        () => {
          hEl.preview.textContent = "";
          const msg = document.createElement("span");
          msg.className = "text-muted-2";
          msg.style.fontSize = "0.7rem";
          msg.style.padding = "0.5rem";
          msg.textContent = "Could not load preview";
          hEl.preview.appendChild(msg);
        },
        { once: true },
      );
      hEl.preview.appendChild(img);
      setHidden(hEl.preview, false);
    } else {
      heroConvertedUrl = null;
      hEl.urlStatus.textContent =
        "⚠️ Could not detect a Google Drive file ID";
      hEl.urlStatus.className = "gallery-url-status invalid";
      setHidden(hEl.urlStatus, false);
      setHidden(hEl.preview, true);
    }
  }

  hEl.urlInput.addEventListener("input", handleHeroUrlInput);
  hEl.urlInput.addEventListener("paste", () =>
    setTimeout(handleHeroUrlInput, 50),
  );

  // ----- Show Hero Message -----
  function showHeroMsg(text, isError) {
    hEl.message.textContent = text;
    hEl.message.className = "gallery-msg " + (isError ? "error" : "success");
    setHidden(hEl.message, false);
    setTimeout(() => setHidden(hEl.message, true), 5000);
  }

  // ----- Add Hero Slide -----
  hEl.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ctx.db || !ctx.adminCode) return;

    const imgUrl = heroConvertedUrl;
    if (!imgUrl) {
      showHeroMsg("Please paste a valid Google Drive image URL.", true);
      return;
    }

    hEl.addBtn.disabled = true;
    hEl.addBtn.textContent = "Adding...";

    try {
      const { data, error } = await ctx.db.rpc("admin_add_hero_slide", {
        p_admin_code: ctx.adminCode,
        p_img_url: imgUrl,
      });

      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showHeroMsg(data?.error || "Failed to add slide", true);
        return;
      }

      showHeroMsg(
        "Slide added! Visitors will see it on page refresh.",
        false,
      );
      hEl.form.reset();
      heroConvertedUrl = null;
      setHidden(hEl.urlStatus, true);
      setHidden(hEl.preview, true);
      loadHeroItems();
    } catch (err) {
      showHeroMsg("Error: " + err.message, true);
    } finally {
      hEl.addBtn.disabled = false;
      hEl.addBtn.textContent = "Add Slide";
    }
  });

  // ----- Load Hero Items -----
  async function loadHeroItems() {
    if (!ctx.db || !ctx.adminCode) return;

    try {
      const { data, error } = await ctx.db.rpc("admin_list_hero_slides", {
        p_admin_code: ctx.adminCode,
      });

      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        hEl.list.textContent = "";
        const p = document.createElement("p");
        p.className = "text-danger";
        p.style.fontSize = "0.85rem";
        p.textContent = String(data?.error || "Failed to load");
        hEl.list.appendChild(p);
        return;
      }

      heroItems = data.items || [];
      renderHeroItems();
      heroLoaded = true;
    } catch (err) {
      hEl.list.textContent = "";
      const p = document.createElement("p");
      p.className = "text-danger";
      p.style.fontSize = "0.85rem";
      p.textContent =
        "Error: " + String(err?.message || err || "Unknown error");
      hEl.list.appendChild(p);
    }
  }

  // ----- Render Hero Items -----
  function renderHeroItems() {
    const active = heroItems.filter((i) => i.is_active).length;
    const total = heroItems.length;
    hEl.count.textContent = `${active} active / ${total} total slides`;

    if (total === 0) {
      hEl.list.textContent = "";
      const p = document.createElement("p");
      p.className = "text-muted-2";
      p.style.fontSize = "0.85rem";
      p.textContent = "No hero slides yet. Add your first slide above!";
      hEl.list.appendChild(p);
      return;
    }

    hEl.list.textContent = "";
    const fragment = document.createDocumentFragment();

    for (const item of heroItems) {
      const isActive = Boolean(item.is_active);
      const date = new Date(item.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const flashClass =
        String(item.id) === String(heroLastMovedId) ? " flash" : "";

      const row = document.createElement("div");
      row.className =
        "gallery-item " + (isActive ? "" : "inactive") + flashClass;
      row.setAttribute("data-hero-id", String(item.id));

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
        img.alt = "Hero slide";
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
      // Truncate the URL for display
      const shortUrl =
        item.img_url.length > 50
          ? item.img_url.substring(0, 50) + "…"
          : item.img_url;
      title.textContent = shortUrl;
      title.title = item.img_url;
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
      sortInput.setAttribute("data-hero-action", "sort");
      sortInput.setAttribute("data-hero-id", String(item.id));
      sortInput.setAttribute("aria-label", "Sort order for hero slide");
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
      toggleBtn.setAttribute("data-hero-action", "toggle");
      toggleBtn.setAttribute("data-hero-id", String(item.id));
      toggleBtn.title = "Click to " + (isActive ? "hide" : "show");
      toggleBtn.textContent = isActive ? "👁️" : "🚫";

      const editBtn = document.createElement("button");
      editBtn.className = "mini-btn secondary";
      editBtn.setAttribute("data-hero-action", "edit");
      editBtn.setAttribute("data-hero-id", String(item.id));
      editBtn.title = "Edit URL";
      editBtn.textContent = "✏️";

      const delBtn = document.createElement("button");
      delBtn.className = "mini-btn danger";
      delBtn.setAttribute("data-hero-action", "delete");
      delBtn.setAttribute("data-hero-id", String(item.id));
      delBtn.title = "Delete permanently";
      delBtn.textContent = "🗑️";

      actions.append(toggleBtn, editBtn, delBtn);
      row.append(handle, thumb, info, sortInput, actions);
      fragment.appendChild(row);
    }

    hEl.list.appendChild(fragment);

    if (heroLastMovedId !== null) {
      setTimeout(() => {
        heroLastMovedId = null;
      }, 0);
    }
  }

  // ----- Toggle Hero Slide -----
  async function toggleHeroSlide(id, btn) {
    if (!ctx.db || !ctx.adminCode) return;
    btn.disabled = true;
    try {
      const { data, error } = await ctx.db.rpc("admin_toggle_hero_slide", {
        p_admin_code: ctx.adminCode,
        p_slide_id: parseInt(id, 10),
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showHeroMsg(data?.error || "Toggle failed", true);
        return;
      }
      showHeroMsg(
        data.is_active
          ? "Slide is now visible"
          : "Slide hidden from visitors",
        false,
      );
      loadHeroItems();
    } catch (err) {
      showHeroMsg("Error: " + err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  // ----- Delete Hero Slide (double-click to confirm) -----
  async function deleteHeroSlide(id, btn) {
    if (!heroDeletePending.has(id)) {
      heroDeletePending.set(id, true);
      btn.textContent = "⚠️ Sure?";
      btn.classList.remove("danger");
      btn.classList.add("confirm-armed");
      setTimeout(() => {
        if (heroDeletePending.has(id)) {
          heroDeletePending.delete(id);
          btn.textContent = "🗑️";
          btn.classList.remove("confirm-armed");
          btn.classList.add("danger");
        }
      }, HERO_DELETE_MS);
      return;
    }

    heroDeletePending.delete(id);
    btn.disabled = true;
    btn.textContent = "...";

    try {
      const { data, error } = await ctx.db.rpc("admin_delete_hero_slide", {
        p_admin_code: ctx.adminCode,
        p_slide_id: parseInt(id, 10),
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showHeroMsg(data?.error || "Delete failed", true);
        return;
      }
      showHeroMsg("Slide deleted permanently", false);
      loadHeroItems();
    } catch (err) {
      showHeroMsg("Error: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "🗑️";
      btn.classList.remove("confirm-armed");
      btn.classList.add("danger");
    }
  }

  // ----- Edit Hero Slide (inline URL edit modal) -----
  let heroEditOverlay = null;
  let heroEditConvertedUrl = null;
  let heroEditEscHandler = null;

  function openHeroEditModal(id) {
    const item = heroItems.find((i) => String(i.id) === String(id));
    if (!item) return;

    if (heroEditOverlay) heroEditOverlay.remove();
    heroEditConvertedUrl = null;

    heroEditOverlay = document.createElement("div");
    heroEditOverlay.className = "gallery-edit-overlay";
    heroEditOverlay.innerHTML = `
      <div class="gallery-edit-modal">
          <h3>✏️ Edit Slide URL</h3>
          <div id="heroEditMessage" class="gallery-edit-message is-hidden"></div>
          <div class="gallery-edit-preview">
              <div class="gallery-edit-preview-img" id="heroEditPreviewImg"></div>
              <div class="gallery-edit-preview-text">
                  <div style="font-weight:600;font-size:0.9rem;color:var(--color-text);" id="heroEditPreviewCaption">Hero Slide</div>
                  <div class="gallery-edit-preview-caption" id="heroEditPreviewSubtext"></div>
              </div>
          </div>
          <form class="gallery-form" id="heroEditForm">
              <label for="heroEditUrl">Image URL</label>
              <input type="text" id="heroEditUrl" placeholder="Paste Google Drive share link or direct image URL" required>
              <div id="heroEditUrlStatus" class="gallery-url-status is-hidden"></div>
              <div class="gallery-edit-actions">
                  <button type="button" class="gallery-edit-cancel" id="heroEditCancelBtn">Cancel</button>
                  <button type="submit" class="gallery-add-btn" id="heroEditSaveBtn">Save Changes</button>
              </div>
          </form>
      </div>
    `;

    document.body.appendChild(heroEditOverlay);

    const urlInput = heroEditOverlay.querySelector("#heroEditUrl");
    const urlStatus = heroEditOverlay.querySelector("#heroEditUrlStatus");
    const previewImg = heroEditOverlay.querySelector("#heroEditPreviewImg");
    const previewSubtext = heroEditOverlay.querySelector(
      "#heroEditPreviewSubtext",
    );
    const editMessage = heroEditOverlay.querySelector("#heroEditMessage");

    urlInput.value = String(item.img_url || "");
    previewSubtext.textContent = item.is_active
      ? "✅ Visible on site"
      : "🚫 Hidden from site";

    // Set preview image
    previewImg.textContent = "";
    if (typeof item.img_url === "string" && item.img_url.startsWith("http")) {
      const img = document.createElement("img");
      img.alt = "Current slide";
      img.src = item.img_url;
      img.addEventListener(
        "error",
        () => {
          img.style.display = "none";
        },
        { once: true },
      );
      previewImg.appendChild(img);
    }

    function handleHeroEditUrlInput() {
      const raw = urlInput.value.trim();
      if (!raw) {
        urlStatus.classList.add("is-hidden");
        heroEditConvertedUrl = null;
        return;
      }
      const fileId = extractDriveFileId(raw);
      if (fileId) {
        const embedUrl = toEmbedUrl(fileId);
        heroEditConvertedUrl = embedUrl;
        urlStatus.textContent = "✅ Google Drive link converted";
        urlStatus.className = "gallery-url-status valid";
        previewImg.textContent = "";
        const img = document.createElement("img");
        img.alt = "Preview";
        img.src = embedUrl;
        img.addEventListener(
          "error",
          () => {
            img.style.display = "none";
          },
          { once: true },
        );
        previewImg.appendChild(img);
      } else {
        heroEditConvertedUrl = null;
        if (raw.startsWith("http")) {
          urlStatus.textContent = "✅ Direct URL detected";
          urlStatus.className = "gallery-url-status valid";
          previewImg.textContent = "";
          const img = document.createElement("img");
          img.alt = "Preview";
          img.src = raw;
          img.addEventListener(
            "error",
            () => {
              img.style.display = "none";
            },
            { once: true },
          );
          previewImg.appendChild(img);
        } else {
          urlStatus.textContent = "⚠️ Invalid URL format";
          urlStatus.className = "gallery-url-status invalid";
        }
      }
    }

    urlInput.addEventListener("input", handleHeroEditUrlInput);
    urlInput.addEventListener("paste", () =>
      setTimeout(handleHeroEditUrlInput, 50),
    );

    urlInput.focus();
    urlInput.select();

    heroEditOverlay.addEventListener("click", (ev) => {
      if (ev.target === heroEditOverlay) closeHeroEditModal();
    });
    heroEditOverlay
      .querySelector("#heroEditCancelBtn")
      .addEventListener("click", closeHeroEditModal);

    // Focus trap
    const modal = heroEditOverlay.querySelector(".gallery-edit-modal");
    modal.addEventListener("keydown", (ev) => {
      if (ev.key !== "Tab") return;
      const focusable = modal.querySelectorAll(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

    if (heroEditEscHandler) {
      document.removeEventListener("keydown", heroEditEscHandler);
    }
    heroEditEscHandler = (ev) => {
      if (ev.key === "Escape") closeHeroEditModal();
    };
    document.addEventListener("keydown", heroEditEscHandler);

    function showHeroEditMessage(text, isError) {
      editMessage.textContent = text;
      editMessage.className = isError
        ? "gallery-edit-message error"
        : "gallery-edit-message success";
      editMessage.classList.remove("is-hidden");
      setTimeout(() => editMessage.classList.add("is-hidden"), 4000);
    }

    heroEditOverlay
      .querySelector("#heroEditForm")
      .addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const newUrl = heroEditConvertedUrl || urlInput.value.trim();
        if (!newUrl) {
          showHeroEditMessage("Image URL is required.", true);
          return;
        }

        const saveBtn = heroEditOverlay.querySelector("#heroEditSaveBtn");
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";

        try {
          const { data, error } = await ctx.db.rpc("admin_edit_hero_slide", {
            p_admin_code: ctx.adminCode,
            p_slide_id: parseInt(id, 10),
            p_img_url: newUrl,
          });
          if (error) throw new Error(error.message);
          if (!data || !data.success) {
            showHeroEditMessage(data?.error || "Update failed", true);
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Changes";
            return;
          }
          showHeroEditMessage("✅ Slide updated!", false);
          setTimeout(() => {
            closeHeroEditModal();
            loadHeroItems();
          }, 1000);
        } catch (err) {
          showHeroEditMessage("Error: " + err.message, true);
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Changes";
        }
      });
  }

  function closeHeroEditModal() {
    if (heroEditEscHandler) {
      document.removeEventListener("keydown", heroEditEscHandler);
      heroEditEscHandler = null;
    }
    if (heroEditOverlay) {
      heroEditOverlay.remove();
      heroEditOverlay = null;
    }
  }

  // ----- Event Delegation for Hero List -----
  hEl.list.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.getAttribute("data-hero-action");
    const id = btn.getAttribute("data-hero-id");
    if (!action || !id) return;

    if (action === "toggle") toggleHeroSlide(id, btn);
    if (action === "edit") openHeroEditModal(id);
    if (action === "delete") deleteHeroSlide(id, btn);
  });

  // ----- Quiet Background Sync -----
  async function heroSyncSortOrders() {
    if (!ctx.db || !ctx.adminCode) return;
    try {
      const { data, error } = await ctx.db.rpc("admin_list_hero_slides", {
        p_admin_code: ctx.adminCode,
      });
      if (error || !data || !data.success) return;
      const serverItems = data.items || [];
      const serverMap = new Map(serverItems.map((i) => [String(i.id), i]));
      heroItems.forEach((item) => {
        const server = serverMap.get(String(item.id));
        if (server) item.sort_order = server.sort_order;
      });
      heroItems.sort((a, b) => a.sort_order - b.sort_order);
      heroItems.forEach((item) => {
        const input = hEl.list.querySelector(
          `input.gallery-sort-input[data-hero-id="${item.id}"]`,
        );
        if (input) input.value = item.sort_order;
      });
    } catch (_) {
      /* best-effort */
    }
  }

  // ----- Inline Sort-Order Save -----
  async function heroSaveSortOrder(input) {
    const id = input.getAttribute("data-hero-id");
    const item = heroItems.find((i) => String(i.id) === String(id));
    if (!item) return;
    let newVal = parseInt(input.value, 10);
    if (isNaN(newVal) || newVal < 1) {
      input.value = Math.max(1, item.sort_order);
      return;
    }
    if (newVal === item.sort_order) return;

    input.disabled = true;
    try {
      const { data, error } = await ctx.db.rpc("admin_reorder_hero_slide", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(id, 10),
        p_new_sort_order: newVal,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showHeroMsg(data?.error || "Sort update failed", true);
        return;
      }
      showHeroMsg(`Position updated to ${newVal}`, false);
      loadHeroItems();
    } catch (err) {
      showHeroMsg("Error: " + err.message, true);
    } finally {
      input.disabled = false;
    }
  }

  hEl.list.addEventListener("change", (e) => {
    if (e.target.matches('.gallery-sort-input[data-hero-action="sort"]'))
      heroSaveSortOrder(e.target);
  });
  hEl.list.addEventListener("keydown", (e) => {
    if (
      e.target.matches('.gallery-sort-input[data-hero-action="sort"]') &&
      e.key === "Enter"
    ) {
      e.preventDefault();
      e.target.blur();
    }
  });

  // ----- Drag & Drop Reorder (Desktop + Touch) -----
  let heroDragSrcId = null;
  let heroCurrentDropTarget = null;

  function heroClearDropIndicators() {
    if (!hEl.list) return;
    hEl.list
      .querySelectorAll(".drag-over, .drop-before, .drop-after")
      .forEach((el) => {
        el.classList.remove("drag-over", "drop-before", "drop-after");
      });
    heroCurrentDropTarget = null;
  }

  function heroUpdateDropIndicator(row, clientY) {
    if (!row || row.getAttribute("data-hero-id") === heroDragSrcId) {
      if (heroCurrentDropTarget) {
        heroCurrentDropTarget.classList.remove(
          "drag-over",
          "drop-before",
          "drop-after",
        );
        heroCurrentDropTarget = null;
      }
      heroDragDropTarget.id = null;
      return;
    }
    const rect = row.getBoundingClientRect();
    const isBefore = clientY - rect.top < rect.height / 2;

    if (heroCurrentDropTarget && heroCurrentDropTarget !== row) {
      heroCurrentDropTarget.classList.remove(
        "drag-over",
        "drop-before",
        "drop-after",
      );
    }
    heroCurrentDropTarget = row;
    row.classList.remove("drop-before", "drop-after");
    row.classList.add("drag-over", isBefore ? "drop-before" : "drop-after");

    heroDragDropTarget.id = row.getAttribute("data-hero-id");
    heroDragDropTarget.position = isBefore ? "before" : "after";
  }

  function heroOptimisticReorder(srcId, tgtId, position) {
    const srcEl = hEl.list.querySelector(`[data-hero-id="${srcId}"]`);
    const tgtEl = hEl.list.querySelector(`[data-hero-id="${tgtId}"]`);
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

    const srcIdx = heroItems.findIndex((i) => String(i.id) === String(srcId));
    const tgtIdx = heroItems.findIndex((i) => String(i.id) === String(tgtId));
    if (srcIdx !== -1 && tgtIdx !== -1) {
      const [moved] = heroItems.splice(srcIdx, 1);
      const newTgtIdx = heroItems.findIndex(
        (i) => String(i.id) === String(tgtId),
      );
      if (newTgtIdx !== -1) {
        const insertAt = position === "before" ? newTgtIdx : newTgtIdx + 1;
        heroItems.splice(insertAt, 0, moved);
      }
      heroItems.forEach((item, i) => {
        item.sort_order = i + 1;
      });
      heroItems.forEach((item) => {
        const input = hEl.list.querySelector(
          `input.gallery-sort-input[data-hero-id="${item.id}"]`,
        );
        if (input) input.value = item.sort_order;
      });
    }
  }

  async function heroPerformDrop() {
    const targetId = heroDragDropTarget.id;
    const targetPosition = heroDragDropTarget.position || "before";
    heroClearDropIndicators();

    if (!heroDragSrcId || !targetId || heroDragSrcId === targetId) return;

    const snapshot = heroItems.map((i) => ({ ...i }));
    heroOptimisticReorder(heroDragSrcId, targetId, targetPosition);

    try {
      const { data, error } = await ctx.db.rpc("admin_move_hero_slide", {
        p_admin_code: ctx.adminCode,
        p_item_id: parseInt(heroDragSrcId, 10),
        p_target_id: parseInt(targetId, 10),
        p_position: targetPosition,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        showHeroMsg(data?.error || "Move failed — reverting", true);
        heroItems = snapshot;
        renderHeroItems();
        return;
      }
      heroSyncSortOrders();
    } catch (err) {
      showHeroMsg("Error: " + (err?.message || err) + " — reverting", true);
      heroItems = snapshot;
      renderHeroItems();
    }
  }

  // ——— Shared pointer drag (mouse + touch) ———
  let heroDragClone = null;
  let heroDragSourceRow = null;
  let heroDragOffsetY = 0;

  function heroStartDrag(row, clientX, clientY) {
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();

    heroDragSrcId = row.getAttribute("data-hero-id");
    heroDragSourceRow = row;
    row.classList.add("dragging");
    document.body.classList.add("is-dragging");

    const rect = row.getBoundingClientRect();
    heroDragOffsetY = clientY - rect.top;
    heroDragClone = row.cloneNode(true);
    heroDragClone.style.cssText =
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
    document.body.appendChild(heroDragClone);
  }

  function heroMoveDrag(clientX, clientY) {
    if (heroDragClone) {
      heroDragClone.style.top = clientY - heroDragOffsetY + "px";
    }
    if (heroDragSourceRow) heroDragSourceRow.style.pointerEvents = "none";
    const elBelow = document.elementFromPoint(clientX, clientY);
    if (heroDragSourceRow) heroDragSourceRow.style.pointerEvents = "";
    const row = elBelow ? elBelow.closest("[data-hero-id]") : null;
    heroUpdateDropIndicator(row, clientY);
  }

  async function heroEndDrag() {
    if (heroDragSourceRow) heroDragSourceRow.classList.remove("dragging");
    if (heroDragClone) {
      heroDragClone.remove();
      heroDragClone = null;
    }
    document.body.classList.remove("is-dragging");

    await heroPerformDrop();

    heroDragSourceRow = null;
    heroDragSrcId = null;
    heroDragDropTarget.id = null;
    heroDragDropTarget.position = "before";
  }

  // ——— Mouse events (desktop) ———
  hEl.list.addEventListener("mousedown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    const row = handle.closest("[data-hero-id]");
    if (!row) return;
    e.preventDefault();

    heroStartDrag(row, e.clientX, e.clientY);

    function onMouseMove(ev) {
      ev.preventDefault();
      heroMoveDrag(ev.clientX, ev.clientY);
    }

    async function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      await heroEndDrag();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  hEl.list.addEventListener("dragstart", (e) => {
    e.preventDefault();
  });

  // ——— Touch events (mobile / tablet) ———
  hEl.list.addEventListener(
    "touchstart",
    (e) => {
      const handle = e.target.closest(".drag-handle");
      if (!handle) return;
      const row = handle.closest("[data-hero-id]");
      if (!row) return;

      const touch = e.touches[0];
      heroStartDrag(row, touch.clientX, touch.clientY);
    },
    { passive: true },
  );

  hEl.list.addEventListener(
    "touchmove",
    (e) => {
      if (!heroDragSourceRow) return;
      e.preventDefault();
      const touch = e.touches[0];
      heroMoveDrag(touch.clientX, touch.clientY);
    },
    { passive: false },
  );

  hEl.list.addEventListener("touchend", async () => {
    if (!heroDragSourceRow) return;
    await heroEndDrag();
  });

  // ----- Load on section open -----
  hEl.section.addEventListener("toggle", () => {
    if (hEl.section.open && !heroLoaded && ctx.db && ctx.adminCode) {
      loadHeroItems();
    }
  });
}
