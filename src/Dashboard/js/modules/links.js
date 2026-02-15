// ============================================
// LINKS MODULE — Review Link Generator & Recent Links
// ============================================
import {
  Trace,
  CONFIG,
  SOURCES,
  DEFAULT_SOURCE_KEY,
  ctx,
  showAuthLockout,
  setHidden,
  normalizeSourceKey,
  getSourceMeta,
  formatSourceLabel,
  withRetry,
} from "./utils.js";

export function initLinks() {
  // ---- DOM Elements ----
  const elements = {
    form: document.getElementById("generatorForm"),
    btn: document.getElementById("generateBtn"),
    sourceSelect: document.getElementById("sourceSelect"),
    resultArea: document.getElementById("resultArea"),
    linkOutput: document.getElementById("linkOutput"),
    sourceTag: document.getElementById("sourceTag"),
    copyBtn: document.getElementById("copyBtn"),
    errorMessage: document.getElementById("errorMessage"),
    recentLinksContainer: document.getElementById("recentLinksContainer"),
    linksDivider: document.getElementById("linksDivider"),
    emptyState: document.getElementById("emptyState"),
    recentLinksToggle: document.getElementById("recentLinksToggle"),
    clearFilterBtn: document.getElementById("clearFilterBtn"),
    recentLinks: document.getElementById("recentLinks"),
    recentLinksList: document.getElementById("recentLinksList"),
    recentLinksSentinel: document.getElementById("recentLinksSentinel"),
    recentLinksTitle: document.getElementById("recentLinksTitle"),
    expandArrow: document.getElementById("expandArrow"),
  };

  const state = {
    filter: null,
    links: {
      expanded: false,
      pageSize: 20,
      offset: 0,
      hasMore: true,
      loading: false,
      queryKey: 0,
      observer: null,
    },
  };

  const DELETE_CONFIRM_MS = 3000;
  const pendingDeletes = new Map();

  // ---- Utility ----
  function validateSource(source) {
    if (!source || typeof source !== "string") {
      return { valid: false, error: "Please select a valid source type" };
    }
    const trimmed = source.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: "Source cannot be empty" };
    }
    const key = trimmed.toLowerCase();
    if (!/^[a-z0-9_]+$/.test(key)) {
      return { valid: false, error: "Invalid source type selected" };
    }
    if (!Object.prototype.hasOwnProperty.call(SOURCES, key)) {
      return { valid: false, error: "Invalid source type selected" };
    }
    return { valid: true, value: key };
  }

  let errorTimer = null;
  function showError(message) {
    if (errorTimer) clearTimeout(errorTimer);
    elements.errorMessage.textContent = message;
    setHidden(elements.errorMessage, false);
    errorTimer = setTimeout(() => {
      setHidden(elements.errorMessage, true);
      errorTimer = null;
    }, 5000);
  }

  function hideError() {
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    setHidden(elements.errorMessage, true);
  }

  function setButtonState(isLoading) {
    const LOADING_LABEL = "⏳ Generating...";
    const DEFAULT_LABEL = "Generate Link";
    if (isLoading) {
      elements.btn.disabled = true;
      elements.btn.textContent = LOADING_LABEL;
    } else {
      elements.btn.disabled = false;
      if (elements.btn.textContent === LOADING_LABEL) {
        elements.btn.textContent = DEFAULT_LABEL;
      }
    }
  }

  function populateSourceSelect() {
    if (!elements.sourceSelect) return;
    const previousRaw = elements.sourceSelect.value;
    const previous = normalizeSourceKey(previousRaw);
    const fragment = document.createDocumentFragment();
    for (const [key, meta] of Object.entries(SOURCES)) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = `${meta.emoji} ${meta.label}`;
      fragment.appendChild(opt);
    }
    elements.sourceSelect.replaceChildren(fragment);

    if (
      previousRaw &&
      Object.prototype.hasOwnProperty.call(SOURCES, previous)
    ) {
      elements.sourceSelect.value = previous;
    } else if (Object.prototype.hasOwnProperty.call(SOURCES, "commission")) {
      elements.sourceSelect.value = "commission";
    } else {
      elements.sourceSelect.value = DEFAULT_SOURCE_KEY;
    }
  }

  function getSelectedLabel() {
    return formatSourceLabel(elements.sourceSelect.value);
  }

  // ---- Core Functionality ----

  async function generateLink() {
    Trace.group("GENERATE_LINK_FLOW");
    Trace.log("GENERATE_CLICK", {
      source: elements.sourceSelect?.value || null,
    });
    hideError();

    if (!ctx.db) {
      Trace.log("GENERATE_ABORT_NO_DB");
      showError("Database not connected. Please refresh the page.");
      Trace.groupEnd();
      return;
    }

    const sourceValidation = validateSource(elements.sourceSelect.value);
    if (!sourceValidation.valid) {
      Trace.log("VALIDATION_FAILED", { error: sourceValidation.error });
      showError(sourceValidation.error);
      Trace.groupEnd();
      return;
    }

    const selectedSource = sourceValidation.value;
    const selectedLabel = getSelectedLabel();

    setButtonState(true);

    try {
      Trace.log("RPC_CREATE_START", { source: selectedSource });

      const { data: rpcResult, error } = await withRetry(async () => {
        return await ctx.db.rpc("admin_create_token", {
          p_admin_code: ctx.adminCode,
          p_source: selectedSource,
        });
      });

      if (error) {
        Trace.log("RPC_CREATE_ERROR", {
          message: error.message || "Failed to create token",
        });
        throw new Error(error.message || "Failed to create token");
      }

      if (!rpcResult || !rpcResult.success) {
        const errMsg = rpcResult?.error || "Failed to create token";
        Trace.log("RPC_CREATE_DENIED", { error: errMsg });
        if (errMsg === "Unauthorized") {
          ctx.adminCode = null;
          showAuthLockout("Invalid admin code.");
          return;
        }
        throw new Error(errMsg);
      }

      const data = rpcResult.token;
      if (!data || !data.id) {
        Trace.log("RPC_CREATE_BAD_RESPONSE");
        throw new Error("Invalid response from server");
      }

      Trace.log("RPC_CREATE_SUCCESS", { tokenId: data.id });

      const fullLink = `${CONFIG.SITE_URL}?token=${encodeURIComponent(data.id)}`;
      Trace.log("LINK_BUILT", { url: fullLink });

      try {
        new URL(fullLink);
      } catch (e) {
        Trace.log("LINK_INVALID");
        throw new Error("Generated invalid URL");
      }

      elements.linkOutput.value = fullLink;
      elements.sourceTag.textContent = `Source: ${selectedLabel}`;
      setHidden(elements.resultArea, false);

      Trace.log("UI_RENDER_RESULT");

      const existingExpiration =
        elements.resultArea.querySelector(".expiration-info");
      if (existingExpiration) {
        existingExpiration.remove();
      }

      elements.linkOutput.select();
      elements.btn.textContent = "Generate Another";

      state.filter = null;
      if (elements.clearFilterBtn) {
        setHidden(elements.clearFilterBtn, true);
      }
      resetRecentLinksPaging();
      Trace.log("RECENT_LINKS_REFRESH");
      await loadRecentLinks();

      if (!state.links.expanded) {
        toggleLinksSection();
      }

      Trace.log("GENERATE_DONE", { tokenId: data.id, source: selectedSource });
    } catch (error) {
      console.error("Error generating link:", error);
      Trace.log("GENERATE_FAILED", {
        message: error?.message || String(error),
      });
      showError(`Failed to generate link: ${error.message}`);
    } finally {
      setButtonState(false);
      Trace.groupEnd();
    }
  }

  async function copyToClipboard() {
    const link = elements.linkOutput.value;
    if (!link) {
      showError("No link to copy");
      return;
    }

    try {
      Trace.log("COPY_TO_CLIPBOARD", { link });
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        elements.linkOutput.select();
        document.execCommand("copy");
      }

      const originalText = elements.copyBtn.textContent;
      elements.copyBtn.textContent = "✓ Copied!";
      elements.copyBtn.classList.add("copied");
      Trace.log("COPY_SUCCESS");

      setTimeout(() => {
        elements.copyBtn.textContent = originalText;
        elements.copyBtn.classList.remove("copied");
      }, 2000);
    } catch (error) {
      console.error("Copy failed:", error);
      Trace.log("COPY_FAILED", { message: error?.message || String(error) });
      showError("Failed to copy link. Please select and copy manually.");
    }
  }

  // ---- Recent Links ----

  async function loadRecentLinks(filterSource = null) {
    Trace.group("LOAD_RECENT_LINKS");
    Trace.log("FETCH_START", {
      filter: filterSource,
      offset: state.links.offset,
      pageSize: state.links.pageSize,
      queryKey: state.links.queryKey,
    });
    try {
      if (!ctx.db) return;
      if (state.links.loading) return;

      state.links.loading = true;
      const queryKey = state.links.queryKey;
      const startOffset = state.links.offset;

      if (elements.recentLinksSentinel) {
        elements.recentLinksSentinel.textContent = "Loading…";
      }

      const { data: rpcResult, error } = await ctx.db.rpc(
        "admin_list_tokens",
        {
          p_admin_code: ctx.adminCode,
          p_source: filterSource,
          p_offset: startOffset,
          p_limit: state.links.pageSize,
        },
      );

      const data = rpcResult?.items;

      if (
        !error &&
        rpcResult &&
        rpcResult.success === false &&
        rpcResult.error === "Unauthorized"
      ) {
        ctx.adminCode = null;
        showAuthLockout("Invalid admin code.");
        return;
      }

      if (queryKey !== state.links.queryKey) {
        Trace.log("FETCH_IGNORED_STALE", {
          expected: state.links.queryKey,
          got: queryKey,
        });
        return;
      }

      if (error) {
        console.error("Recent links error:", error);
        Trace.log("FETCH_ERROR", { message: error?.message || String(error) });
        return;
      }

      if (!rpcResult || rpcResult.success !== true || !Array.isArray(data)) {
        Trace.log("FETCH_ERROR", {
          message: rpcResult?.error || "Invalid response from server",
        });
        return;
      }

      Trace.log("FETCH_SUCCESS", { count: data?.length || 0 });

      const isFirstPage = startOffset === 0;
      if (isFirstPage) {
        if (!data || data.length === 0) {
          setHidden(elements.recentLinksContainer, true);
          setHidden(elements.linksDivider, true);
          setHidden(elements.emptyState, false);
          if (elements.recentLinksSentinel)
            elements.recentLinksSentinel.textContent = "";
          state.links.hasMore = false;
          return;
        }
        setHidden(elements.recentLinksContainer, false);
        setHidden(elements.linksDivider, false);
        setHidden(elements.emptyState, true);
      }

      if (filterSource) {
        elements.recentLinksTitle.textContent = `${formatSourceLabel(filterSource)} Links`;
        if (elements.clearFilterBtn) {
          setHidden(elements.clearFilterBtn, false);
        }
      } else {
        if (elements.clearFilterBtn) {
          setHidden(elements.clearFilterBtn, true);
        }
        elements.recentLinksTitle.textContent = "Generated Links";
      }

      const now = new Date();
      const fragment = document.createDocumentFragment();
      for (const link of data || []) {
        fragment.appendChild(renderLinkItem(link, now));
      }

      if (elements.recentLinksList) {
        if (isFirstPage) {
          elements.recentLinksList.replaceChildren(fragment);
        } else {
          elements.recentLinksList.appendChild(fragment);
        }
      }

      state.links.offset = startOffset + (data?.length || 0);
      state.links.hasMore = (data?.length || 0) === state.links.pageSize;

      Trace.log("FETCH_RENDERED", {
        offset: state.links.offset,
        hasMore: state.links.hasMore,
      });

      if (elements.recentLinksSentinel) {
        if (state.links.hasMore) {
          elements.recentLinksSentinel.textContent = "Loading more…";
        } else {
          elements.recentLinksSentinel.textContent = "End of list";
        }
      }

      ensureLinksObserver();
    } catch (error) {
      console.error("Failed to load recent links:", error);
      Trace.log("FETCH_FAILED", { message: error?.message || String(error) });
    } finally {
      state.links.loading = false;
      Trace.groupEnd();
    }
  }

  function resetRecentLinksPaging() {
    state.links.queryKey++;
    state.links.offset = 0;
    state.links.hasMore = true;
    state.links.loading = false;
    if (elements.recentLinksList) elements.recentLinksList.textContent = "";
    if (elements.recentLinksSentinel)
      elements.recentLinksSentinel.textContent = "";

    if (state.links.observer) {
      try {
        state.links.observer.disconnect();
      } catch {
        /* noop */
      }
      state.links.observer = null;
    }
  }

  function ensureLinksObserver() {
    if (!elements.recentLinksSentinel) return;
    if (state.links.observer) return;

    state.links.observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || !entry.isIntersecting) return;
        if (!state.links.expanded) return;
        if (!ctx.db) return;
        if (!state.links.hasMore) return;
        loadRecentLinks(state.filter).catch(() => {});
      },
      { root: null, rootMargin: "300px 0px", threshold: 0 },
    );

    state.links.observer.observe(elements.recentLinksSentinel);
  }

  function computeStatusText(link, now) {
    const expiresDate = new Date(link.expires_at);
    const isExpired = expiresDate < now;
    if (link.is_used) return "✅ Used";
    if (isExpired) return "⚠️ Expired";
    const msRemaining = expiresDate - now;
    const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
    return `🔵 Active (${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} left)`;
  }

  function renderLinkItem(link, now) {
    const fullLink = `${CONFIG.SITE_URL}?token=${encodeURIComponent(link.id)}`;
    const createdDate = new Date(link.created_at);
    const expiresDate = new Date(link.expires_at);
    const isExpired = expiresDate < now;

    const item = document.createElement("div");
    item.className = "link-item";

    const header = document.createElement("div");
    header.className = "link-item-header";

    const sourceBtn = document.createElement("button");
    sourceBtn.className = "source-name";
    sourceBtn.type = "button";
    sourceBtn.dataset.action = "filter";
    sourceBtn.dataset.source = normalizeSourceKey(link.source);
    sourceBtn.title = "Filter by this source";
    sourceBtn.textContent = formatSourceLabel(link.source);

    const dateStr = createdDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const timeStr = createdDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const dateTimeStr = `${dateStr} at ${timeStr}`;

    const dateSpan = document.createElement("span");
    dateSpan.className = "link-item-date";
    dateSpan.title = dateTimeStr;
    dateSpan.textContent = `${dateStr} • ${timeStr}`;

    header.append(sourceBtn, dateSpan);

    const urlRow = document.createElement("textarea");
    urlRow.className = "link-item-url link-item-url-field";
    urlRow.readOnly = true;
    urlRow.rows = 2;
    urlRow.value = fullLink;
    urlRow.spellcheck = false;

    const footer = document.createElement("div");
    footer.className = "link-item-footer";

    const status = document.createElement("span");
    status.className = "link-item-status text-muted";
    status.textContent = computeStatusText(link, now);

    const actions = document.createElement("div");
    actions.className = "link-item-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "mini-btn";
    copyBtn.type = "button";
    copyBtn.dataset.action = "copy";
    copyBtn.dataset.link = fullLink;
    copyBtn.textContent = "Copy Link";
    actions.appendChild(copyBtn);

    if (!link.is_used && !isExpired) {
      const testBtn = document.createElement("button");
      testBtn.className = "mini-btn secondary";
      testBtn.type = "button";
      testBtn.dataset.action = "test";
      testBtn.dataset.link = fullLink;
      testBtn.textContent = "Test";
      actions.appendChild(testBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "mini-btn danger";
    delBtn.type = "button";
    delBtn.dataset.action = "delete";
    delBtn.dataset.id = link.id;
    delBtn.textContent = "Delete";
    actions.appendChild(delBtn);

    footer.append(status, actions);
    item.append(header, urlRow, footer);
    return item;
  }

  function armDeleteConfirmation(tokenId) {
    const existingTimeout = pendingDeletes.get(tokenId);
    if (existingTimeout) clearTimeout(existingTimeout);
    const timeoutId = setTimeout(() => {
      pendingDeletes.delete(tokenId);
    }, DELETE_CONFIRM_MS);
    pendingDeletes.set(tokenId, timeoutId);
  }

  async function deleteToken(tokenId, buttonEl) {
    Trace.group("DELETE_FLOW");
    Trace.log("DELETE_CLICK", { tokenId });
    if (!ctx.db) {
      Trace.log("DELETE_ABORT_NO_DB");
      showError("Database not connected. Please refresh the page.");
      Trace.groupEnd();
      return;
    }

    if (!pendingDeletes.has(tokenId)) {
      armDeleteConfirmation(tokenId);
      if (buttonEl) {
        const origText = buttonEl.textContent;
        buttonEl.textContent = "⚠️ Sure?";
        buttonEl.classList.add("confirm-armed");
        const revertTimer = setTimeout(() => {
          buttonEl.textContent = origText;
          buttonEl.classList.remove("confirm-armed");
        }, DELETE_CONFIRM_MS);
        buttonEl._revertTimer = revertTimer;
      }
      Trace.log("DELETE_CONFIRM_ARMED", { ttlMs: DELETE_CONFIRM_MS });
      Trace.groupEnd();
      return;
    }

    const timeoutId = pendingDeletes.get(tokenId);
    if (timeoutId) clearTimeout(timeoutId);
    pendingDeletes.delete(tokenId);

    const originalText = buttonEl?.textContent;
    if (buttonEl) {
      if (buttonEl._revertTimer) clearTimeout(buttonEl._revertTimer);
      buttonEl.classList.remove("confirm-armed");
      buttonEl.disabled = true;
      buttonEl.textContent = "Deleting...";
    }

    try {
      Trace.log("RPC_DELETE_START");
      const { data: delResult, error } = await ctx.db.rpc(
        "admin_delete_token",
        {
          p_admin_code: ctx.adminCode,
          p_token_id: String(tokenId),
        },
      );

      if (error) throw new Error(error.message || "Delete failed");

      if (!delResult || !delResult.success) {
        const errMsg = delResult?.error || "Delete failed";
        if (errMsg === "Unauthorized") {
          ctx.adminCode = null;
          showAuthLockout("Invalid admin code.");
          return;
        }
        throw new Error(errMsg);
      }

      Trace.log("DELETE_SUCCESS");

      if (
        elements.resultArea &&
        !elements.resultArea.classList.contains("is-hidden")
      ) {
        const currentLink = elements.linkOutput.value;
        if (currentLink && currentLink.includes(tokenId)) {
          setHidden(elements.resultArea, true);
          elements.linkOutput.value = "";
        }
      }

      resetRecentLinksPaging();
      await loadRecentLinks(state.filter);
    } catch (err) {
      console.error("Delete failed:", err);
      Trace.log("DELETE_FAILED", { message: err?.message || String(err) });
      showError(`Failed to delete link: ${err.message}`);
    } finally {
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent = originalText || "Delete";
      }
      Trace.groupEnd();
    }
  }

  async function copyLinkToClipboard(link) {
    try {
      Trace.log("COPY_RECENT_LINK", { link });
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = link;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.setAttribute("aria-hidden", "true");
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      Trace.log("COPY_RECENT_LINK_SUCCESS");
    } catch (error) {
      console.error("Copy failed:", error);
      Trace.log("COPY_RECENT_LINK_FAILED", {
        message: error?.message || String(error),
      });
    }
  }

  function openLink(link) {
    Trace.log("USER_OPEN_TEST_LINK", { link });
    window.open(link, "_blank", "noopener,noreferrer");
  }

  function filterBySource(source) {
    const normalized = normalizeSourceKey(source);
    state.filter = normalized;
    Trace.log("FILTER_APPLIED", { source: normalized });
    resetRecentLinksPaging();
    loadRecentLinks(normalized);

    if (!state.links.expanded) {
      state.links.expanded = true;
      setHidden(elements.recentLinks, false);
      elements.expandArrow.classList.toggle("collapsed", false);
      if (elements.recentLinksToggle) {
        elements.recentLinksToggle.setAttribute("aria-expanded", "true");
      }
    }
  }

  function clearFilter() {
    state.filter = null;
    Trace.log("FILTER_CLEARED");
    resetRecentLinksPaging();
    loadRecentLinks();
  }

  function toggleLinksSection() {
    state.links.expanded = !state.links.expanded;
    Trace.log("LINKS_TOGGLED", { expanded: state.links.expanded });
    setHidden(elements.recentLinks, !state.links.expanded);
    elements.expandArrow.classList.toggle("collapsed", !state.links.expanded);

    if (elements.recentLinksToggle) {
      elements.recentLinksToggle.setAttribute(
        "aria-expanded",
        String(state.links.expanded),
      );
    }

    if (state.links.expanded) {
      ensureLinksObserver();
    }
  }

  // ---- Event Listeners ----

  populateSourceSelect();

  if (elements.form) {
    elements.form.addEventListener("submit", (e) => {
      e.preventDefault();
      generateLink();
    });
  } else if (elements.btn) {
    elements.btn.addEventListener("click", generateLink);
  }

  if (elements.copyBtn) {
    elements.copyBtn.addEventListener("click", copyToClipboard);
  }

  if (elements.recentLinksToggle) {
    elements.recentLinksToggle.addEventListener("click", () => {
      Trace.log("USER_TOGGLE_SECTION_CLICK");
      toggleLinksSection();
    });
  }

  if (elements.clearFilterBtn) {
    elements.clearFilterBtn.addEventListener("click", (e) => {
      e.preventDefault();
      Trace.log("USER_CLEAR_FILTER_CLICK");
      clearFilter();
    });
  }

  if (elements.sourceSelect) {
    elements.sourceSelect.addEventListener("keydown", (e) => {
      if (e.key === "Enter") generateLink();
    });
  }

  // Event delegation for link list actions
  if (elements.recentLinksList) {
    elements.recentLinksList.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (!action) return;

      if (action === "copy") {
        const link = btn.getAttribute("data-link");
        if (link) copyLinkToClipboard(link);
      } else if (action === "test") {
        const link = btn.getAttribute("data-link");
        Trace.log("USER_TEST_CLICK", { link });
        if (link) openLink(link);
      } else if (action === "delete") {
        const id = btn.getAttribute("data-id");
        if (id) deleteToken(id, btn);
      } else if (action === "filter") {
        const source = btn.getAttribute("data-source");
        Trace.log("USER_FILTER_CLICK", { source });
        if (source) filterBySource(source);
      }
    });

    elements.recentLinksList.addEventListener("dblclick", (e) => {
      const field = e.target.closest(".link-item-url-field");
      if (!field) return;
      field.focus();
      field.select();
      Trace.log("USER_URL_DBLCLICK", { url: field.value });
    });
  }

  // ---- Visibility Refresh ----
  let lastVisibilityRefresh = 0;
  const VISIBILITY_COOLDOWN_MS = 60_000;

  function onVisibilityChange() {
    if (!document.hidden && ctx.db) {
      const now = Date.now();
      if (now - lastVisibilityRefresh < VISIBILITY_COOLDOWN_MS) return;
      lastVisibilityRefresh = now;
      resetRecentLinksPaging();
      loadRecentLinks(state.filter).catch(() => {});
    }
  }

  document.addEventListener("visibilitychange", onVisibilityChange);

  // ---- Cleanup ----
  function cleanup() {
    try {
      if (state?.links?.observer) {
        try {
          state.links.observer.disconnect();
        } catch {
          /* noop */
        }
        state.links.observer = null;
      }
    } catch {
      /* noop */
    }

    try {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    } catch {
      /* noop */
    }

    try {
      pendingDeletes.forEach((t) => {
        try {
          clearTimeout(t);
        } catch {
          /* noop */
        }
      });
      pendingDeletes.clear();
    } catch {
      /* noop */
    }
  }

  window.addEventListener("beforeunload", cleanup);

  // ---- Initial Load ----
  Trace.log("UI_READY");
  resetRecentLinksPaging();
  loadRecentLinks();
}
