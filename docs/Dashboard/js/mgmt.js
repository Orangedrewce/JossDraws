(function () {
        'use strict';
        // ============================================
        // DEMO TRACE LOGGER
        // ============================================
        const Trace = (() => {
            let step = 0;

            function time() {
                return new Date().toISOString().split('T')[1].replace('Z', '');
            }

            function log(event, data = null) {
                step += 1;
                const id = String(step).padStart(2, '0');
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

        Trace.log('APP_INIT');

        // ============================================
        // AUTH LOCKOUT OVERLAY (no DOM replacement)
        // ============================================
        function showAuthLockout(message) {
            const existing = document.getElementById('auth-lockout');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'auth-lockout';
            overlay.className = 'auth-screen auth-screen--danger auth-lockout';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-label', 'Access denied');

            const title = document.createElement('h2');
            title.textContent = 'Access Denied';

            const body = document.createElement('p');
            body.textContent = message || 'Invalid admin code.';

            overlay.append(title, body);
            document.body.appendChild(overlay);
        }

        function clearAuthLockout() {
            const existing = document.getElementById('auth-lockout');
            if (existing) existing.remove();
        }

        // ============================================
        // ACCESS GUARD (server-side verified)
        // ============================================
        // The admin code is sent to Postgres on every action and
        // verified against a bcrypt hash. Even if someone reads this
        // source code, they cannot do anything without the real code.
        // ============================================
        let adminCode = null;
        {
            Trace.group('ACCESS_GUARD');
            const MAX_ATTEMPTS = 3;
            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                const input = prompt('Enter admin code:');
                if (input === null) break;
                if (input && input.trim().length > 0) {
                    adminCode = input.trim();
                    break;
                }
            }

            if (!adminCode) {
                Trace.log('AUTH_NO_INPUT');
                Trace.groupEnd();
                showAuthLockout('No admin code provided.');
                throw new Error('Access denied');
            }

            Trace.log('AUTH_CODE_RECEIVED');
            Trace.groupEnd();
        }

        Trace.log('PAGE_LOADED');

        // ============================================
        // CONFIGURATION
        // ============================================
        const CONFIG = {
            SUPABASE_URL: 'https://pciubbwphwpnptgawgok.supabase.co',
            SUPABASE_KEY: 'sb_publishable_jz1pWpo7TDvURxQ8cqP06A_xc4ckSwv',
            SITE_URL: 'https://www.jossdraws.com/Dashboard/review.html',
            MAX_RETRIES: 3,
            RETRY_DELAY: 1000
        };

        const DEFAULT_SOURCE_KEY = 'general';
        const SOURCES = {
            commission: { emoji: '🎨', label: 'Commission' },
            etsy: { emoji: '🛍️', label: 'Etsy Order' },
            print: { emoji: '🖨️', label: 'Art Print' },
            sticker: { emoji: '🏷️', label: 'Sticker' },
            bookmark: { emoji: '🔖', label: 'Bookmark' },
            pet_portrait: { emoji: '🐾', label: 'Pet Portrait' },
            faceless_portrait: { emoji: '👤', label: 'Faceless Portrait' },
            coloring_book: { emoji: '🖍️', label: 'Coloring Book' },
            general: { emoji: '📋', label: 'General' }
        };

        // ============================================
        // INITIALIZATION
        // ============================================
        // DOM Elements
        const elements = {
            form: document.getElementById('generatorForm'),
            btn: document.getElementById('generateBtn'),
            sourceSelect: document.getElementById('sourceSelect'),
            resultArea: document.getElementById('resultArea'),
            linkOutput: document.getElementById('linkOutput'),
            sourceTag: document.getElementById('sourceTag'),
            copyBtn: document.getElementById('copyBtn'),
            errorMessage: document.getElementById('errorMessage'),
            recentLinksContainer: document.getElementById('recentLinksContainer'),
            linksDivider: document.getElementById('linksDivider'),
            emptyState: document.getElementById('emptyState'),
            recentLinksToggle: document.getElementById('recentLinksToggle'),
            clearFilterBtn: document.getElementById('clearFilterBtn'),
            recentLinks: document.getElementById('recentLinks'),
            recentLinksList: document.getElementById('recentLinksList'),
            recentLinksSentinel: document.getElementById('recentLinksSentinel'),
            recentLinksTitle: document.getElementById('recentLinksTitle'),
            expandArrow: document.getElementById('expandArrow')
        };

        let db;
        try {
            db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
            Trace.log('DB_CONNECTED');
        } catch (error) {
            console.error('Failed to initialize Supabase client:', error);
            Trace.log('DB_CONNECTION_FAILED', { message: error?.message || String(error) });
            showError('Failed to connect to database. Please refresh the page.');
            if (elements.btn) elements.btn.disabled = true;
        }
        
        const state = {
            filter: null,
            links: {
                expanded: false,
                pageSize: 20,
                offset: 0,
                hasMore: true,
                loading: false,
                queryKey: 0,
                observer: null
            }
        };

        // Delete confirmation state
        const DELETE_CONFIRM_MS = 3000;
        const pendingDeletes = new Map();

        // ============================================
        // UTILITY FUNCTIONS
        // ============================================

        /**
         * Validates that a source value is non-empty and safe
         */
        function validateSource(source) {
            if (!source || typeof source !== 'string') {
                return { valid: false, error: 'Please select a valid source type' };
            }
            
            const trimmed = source.trim();
            if (trimmed.length === 0) {
                return { valid: false, error: 'Source cannot be empty' };
            }

            const key = trimmed.toLowerCase();
            if (!/^[a-z0-9_]+$/.test(key)) {
                return { valid: false, error: 'Invalid source type selected' };
            }

            if (!Object.prototype.hasOwnProperty.call(SOURCES, key)) {
                return { valid: false, error: 'Invalid source type selected' };
            }

            return { valid: true, value: key };
        }

        /**
         * Sanitizes text for display (prevents XSS)
         */
        function sanitizeText(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        /**
         * Sanitizes a value for use inside HTML attributes (prevents attribute-breakout XSS)
         */
        function sanitizeAttr(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        function setHidden(el, hidden) {
            if (!el) return;
            el.classList.toggle('is-hidden', Boolean(hidden));
        }

        /**
         * Shows error message to user
         */
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
        /**
         * Hides error message
         */
        function hideError() {
            if (errorTimer) {
                clearTimeout(errorTimer);
                errorTimer = null;
            }
            setHidden(elements.errorMessage, true);
        }

        /**
         * Updates button state
         */
        function setButtonState(isLoading) {
            const LOADING_LABEL = '⏳ Generating...';
            const DEFAULT_LABEL = 'Generate Link';
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

        function normalizeSourceKey(source) {
            const value = String(source ?? DEFAULT_SOURCE_KEY).trim().toLowerCase();
            if (!/^[a-z0-9_]+$/.test(value)) return DEFAULT_SOURCE_KEY;
            return Object.prototype.hasOwnProperty.call(SOURCES, value) ? value : DEFAULT_SOURCE_KEY;
        }

        function getSourceMeta(source) {
            const key = normalizeSourceKey(source);
            return SOURCES[key] || SOURCES[DEFAULT_SOURCE_KEY];
        }

        function populateSourceSelect() {
            if (!elements.sourceSelect) return;

            const previousRaw = elements.sourceSelect.value;
            const previous = normalizeSourceKey(previousRaw);
            const fragment = document.createDocumentFragment();
            for (const [key, meta] of Object.entries(SOURCES)) {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = `${meta.emoji} ${meta.label}`;
                fragment.appendChild(opt);
            }
            elements.sourceSelect.replaceChildren(fragment);

            if (previousRaw && Object.prototype.hasOwnProperty.call(SOURCES, previous)) {
                elements.sourceSelect.value = previous;
            } else if (Object.prototype.hasOwnProperty.call(SOURCES, 'commission')) {
                elements.sourceSelect.value = 'commission';
            } else {
                elements.sourceSelect.value = DEFAULT_SOURCE_KEY;
            }
        }

        /**
         * Returns a formatted display label with emoji for a source key
         */
        function formatSourceLabel(source) {
            const meta = getSourceMeta(source);
            return `${meta.emoji} ${meta.label}`;
        }

        /**
         * Gets the display label for a select option
         */
        function getSelectedLabel() {
            return formatSourceLabel(elements.sourceSelect.value);
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
        // CORE FUNCTIONALITY
        // ============================================

        /**
         * Generates a new review link token
         */
        async function generateLink() {
            Trace.group('GENERATE_LINK_FLOW');
            Trace.log('GENERATE_CLICK', { source: elements.sourceSelect?.value || null });
            hideError();

            if (!db) {
                Trace.log('GENERATE_ABORT_NO_DB');
                showError('Database not connected. Please refresh the page.');
                Trace.groupEnd();
                return;
            }
            
            // 1. Validate source selection
            const sourceValidation = validateSource(elements.sourceSelect.value);
            if (!sourceValidation.valid) {
                Trace.log('VALIDATION_FAILED', { error: sourceValidation.error });
                showError(sourceValidation.error);
                Trace.groupEnd();
                return;
            }

            const selectedSource = sourceValidation.value;
            const selectedLabel = getSelectedLabel();

            setButtonState(true);

            try {
                // 2. Create token via server-side admin function (bcrypt-verified)
                Trace.log('RPC_CREATE_START', { source: selectedSource });

                const { data: rpcResult, error } = await withRetry(async () => {
                    return await db.rpc('admin_create_token', {
                        p_admin_code: adminCode,
                        p_source: selectedSource
                    });
                });

                if (error) {
                    Trace.log('RPC_CREATE_ERROR', { message: error.message || 'Failed to create token' });
                    throw new Error(error.message || 'Failed to create token');
                }

                if (!rpcResult || !rpcResult.success) {
                    const errMsg = rpcResult?.error || 'Failed to create token';
                    Trace.log('RPC_CREATE_DENIED', { error: errMsg });
                    if (errMsg === 'Unauthorized') {
                        adminCode = null;
                        showAuthLockout('Invalid admin code.');
                        return;
                    }
                    throw new Error(errMsg);
                }

                const data = rpcResult.token;
                if (!data || !data.id) {
                    Trace.log('RPC_CREATE_BAD_RESPONSE');
                    throw new Error('Invalid response from server');
                }

                Trace.log('RPC_CREATE_SUCCESS', { tokenId: data.id });

                // 3. Construct and validate URL
                const fullLink = `${CONFIG.SITE_URL}?token=${encodeURIComponent(data.id)}`;
                Trace.log('LINK_BUILT', { url: fullLink });
                
                // Verify URL is valid
                try {
                    new URL(fullLink);
                } catch (e) {
                    Trace.log('LINK_INVALID');
                    throw new Error('Generated invalid URL');
                }

                // 4. Display result
                elements.linkOutput.value = fullLink;
                elements.sourceTag.textContent = `Source: ${selectedLabel}`;
                setHidden(elements.resultArea, false);

                Trace.log('UI_RENDER_RESULT');
                

                // Check if expiration info needs to be cleared (since we removed the feature)
                const existingExpiration = elements.resultArea.querySelector('.expiration-info');
                if (existingExpiration) {
                    existingExpiration.remove();
                }

                
                // Auto-select the link for easy copying
                elements.linkOutput.select();
                
                // Update button text
                elements.btn.textContent = 'Generate Another';

                // Refresh page data after creating new link
                // - clear filters so the new link is visible
                // - reset infinite scroll paging so newest items load first
                state.filter = null;
                if (elements.clearFilterBtn) {
                    setHidden(elements.clearFilterBtn, true);
                }
                resetRecentLinksPaging();
                Trace.log('RECENT_LINKS_REFRESH');
                await loadRecentLinks();

                // Optionally expand links so the new item is visible
                if (!state.links.expanded) {
                    toggleLinksSection();
                }

                Trace.log('GENERATE_DONE', { tokenId: data.id, source: selectedSource });

            } catch (error) {
                console.error('Error generating link:', error);
                Trace.log('GENERATE_FAILED', { message: error?.message || String(error) });
                showError(`Failed to generate link: ${error.message}`);
            } finally {
                setButtonState(false);
                Trace.groupEnd();
            }
        }

        /**
         * Copies link to clipboard
         */
        async function copyToClipboard() {
            const link = elements.linkOutput.value;
            
            if (!link) {
                showError('No link to copy');
                return;
            }

            try {
                Trace.log('COPY_TO_CLIPBOARD', { link });
                // Modern clipboard API
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(link);
                } else {
                    // Fallback for older browsers
                    elements.linkOutput.select();
                    document.execCommand('copy');
                }

                // Visual feedback
                const originalText = elements.copyBtn.textContent;
                elements.copyBtn.textContent = '✓ Copied!';
                elements.copyBtn.classList.add('copied');

                Trace.log('COPY_SUCCESS');

                setTimeout(() => {
                    elements.copyBtn.textContent = originalText;
                    elements.copyBtn.classList.remove('copied');
                }, 2000);

            } catch (error) {
                console.error('Copy failed:', error);
                Trace.log('COPY_FAILED', { message: error?.message || String(error) });
                showError('Failed to copy link. Please select and copy manually.');
            }
        }


        /**
         * Loads and displays recent links
         */
        async function loadRecentLinks(filterSource = null) {
            Trace.group('LOAD_RECENT_LINKS');
            Trace.log('FETCH_START', {
                filter: filterSource,
                offset: state.links.offset,
                pageSize: state.links.pageSize,
                queryKey: state.links.queryKey
            });
            try {
                if (!db) return;
                if (state.links.loading) return;

                state.links.loading = true;

                const queryKey = state.links.queryKey;
                const startOffset = state.links.offset;

                if (elements.recentLinksSentinel) {
                    elements.recentLinksSentinel.textContent = 'Loading…';
                }

                const { data: rpcResult, error } = await db.rpc('admin_list_tokens', {
                    p_admin_code: adminCode,
                    p_source: filterSource,
                    p_offset: startOffset,
                    p_limit: state.links.pageSize
                });

                const data = rpcResult?.items;

                if (!error && rpcResult && rpcResult.success === false && rpcResult.error === 'Unauthorized') {
                    adminCode = null;
                    showAuthLockout('Invalid admin code.');
                    return;
                }

                // If filter/reset happened while awaiting, ignore this response
                if (queryKey !== state.links.queryKey) {
                    Trace.log('FETCH_IGNORED_STALE', { expected: state.links.queryKey, got: queryKey });
                    return;
                }

                if (error) {
                    console.error('Recent links error:', error);
                    Trace.log('FETCH_ERROR', { message: error?.message || String(error) });
                    return;
                }

                if (!rpcResult || rpcResult.success !== true || !Array.isArray(data)) {
                    Trace.log('FETCH_ERROR', { message: rpcResult?.error || 'Invalid response from server' });
                    return;
                }

                Trace.log('FETCH_SUCCESS', { count: data?.length || 0 });

                const isFirstPage = startOffset === 0;
                if (isFirstPage) {
                    if (!data || data.length === 0) {
                        setHidden(elements.recentLinksContainer, true);
                        setHidden(elements.linksDivider, true);
                        setHidden(elements.emptyState, false);
                        if (elements.recentLinksSentinel) elements.recentLinksSentinel.textContent = '';
                        state.links.hasMore = false;
                        return;
                    }
                    setHidden(elements.recentLinksContainer, false);
                    setHidden(elements.linksDivider, false);
                    setHidden(elements.emptyState, true);
                }

                // Update title with filter if applicable
                if (filterSource) {
                    // Clear existing content and rebuild with filter badge
                    elements.recentLinksTitle.textContent = `${formatSourceLabel(filterSource)} Links`;

                    if (elements.clearFilterBtn) {
                        setHidden(elements.clearFilterBtn, false);
                    }
                } else {
                    if (elements.clearFilterBtn) {
                        setHidden(elements.clearFilterBtn, true);
                    }
                    elements.recentLinksTitle.textContent = 'Generated Links';
                }

                // Build links display (DOM nodes, no innerHTML)
                const now = new Date();
                const fragment = document.createDocumentFragment();
                for (const link of (data || [])) {
                    fragment.appendChild(renderLinkItem(link, now));
                }

                if (elements.recentLinksList) {
                    if (isFirstPage) {
                        elements.recentLinksList.replaceChildren(fragment);
                    } else {
                        elements.recentLinksList.appendChild(fragment);
                    }
                }

                // Update pagination state (offset-stable)
                state.links.offset = startOffset + (data?.length || 0);
                state.links.hasMore = (data?.length || 0) === state.links.pageSize;

                Trace.log('FETCH_RENDERED', { offset: state.links.offset, hasMore: state.links.hasMore });

                if (elements.recentLinksSentinel) {
                    if (state.links.hasMore) {
                        elements.recentLinksSentinel.textContent = 'Loading more…';
                    } else {
                        elements.recentLinksSentinel.textContent = 'End of list';
                    }
                }

                ensureLinksObserver();

            } catch (error) {
                console.error('Failed to load recent links:', error);
                Trace.log('FETCH_FAILED', { message: error?.message || String(error) });
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
            if (elements.recentLinksList) elements.recentLinksList.textContent = '';
            if (elements.recentLinksSentinel) elements.recentLinksSentinel.textContent = '';

            if (state.links.observer) {
                try { state.links.observer.disconnect(); } catch { /* noop */ }
                state.links.observer = null;
            }
        }

        function ensureLinksObserver() {
            if (!elements.recentLinksSentinel) return;
            if (state.links.observer) return;

            state.links.observer = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (!entry || !entry.isIntersecting) return;
                if (!state.links.expanded) return;
                if (!db) return;
                if (!state.links.hasMore) return;

                loadRecentLinks(state.filter).catch(() => {});
            }, {
                root: null,
                rootMargin: '300px 0px',
                threshold: 0
            });

            state.links.observer.observe(elements.recentLinksSentinel);
        }

        function computeStatusText(link, now) {
            const expiresDate = new Date(link.expires_at);
            const isExpired = expiresDate < now;

            if (link.is_used) return '✅ Used';
            if (isExpired) return '⚠️ Expired';

            const msRemaining = expiresDate - now;
            const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
            return `🔵 Active (${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left)`;
        }

        function renderLinkItem(link, now) {
            const fullLink = `${CONFIG.SITE_URL}?token=${encodeURIComponent(link.id)}`;
            const createdDate = new Date(link.created_at);
            const expiresDate = new Date(link.expires_at);
            const isExpired = expiresDate < now;

            const item = document.createElement('div');
            item.className = 'link-item';

            const header = document.createElement('div');
            header.className = 'link-item-header';

            const sourceBtn = document.createElement('button');
            sourceBtn.className = 'source-name';
            sourceBtn.type = 'button';
            sourceBtn.dataset.action = 'filter';
            sourceBtn.dataset.source = normalizeSourceKey(link.source);
            sourceBtn.title = 'Filter by this source';
            sourceBtn.textContent = formatSourceLabel(link.source);

            const dateStr = createdDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = createdDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            const dateTimeStr = `${dateStr} at ${timeStr}`;

            const dateSpan = document.createElement('span');
            dateSpan.className = 'link-item-date';
            dateSpan.title = dateTimeStr;
            dateSpan.textContent = `${dateStr} • ${timeStr}`;

            header.append(sourceBtn, dateSpan);

            const urlRow = document.createElement('textarea');
            urlRow.className = 'link-item-url link-item-url-field';
            urlRow.readOnly = true;
            urlRow.rows = 2;
            urlRow.value = fullLink;
            urlRow.spellcheck = false;

            const footer = document.createElement('div');
            footer.className = 'link-item-footer';

            const status = document.createElement('span');
            status.className = 'link-item-status text-muted';
            status.textContent = computeStatusText(link, now);

            const actions = document.createElement('div');
            actions.className = 'link-item-actions';

            const copyBtn = document.createElement('button');
            copyBtn.className = 'mini-btn';
            copyBtn.type = 'button';
            copyBtn.dataset.action = 'copy';
            copyBtn.dataset.link = fullLink;
            copyBtn.textContent = 'Copy Link';
            actions.appendChild(copyBtn);

            if (!link.is_used && !isExpired) {
                const testBtn = document.createElement('button');
                testBtn.className = 'mini-btn secondary';
                testBtn.type = 'button';
                testBtn.dataset.action = 'test';
                testBtn.dataset.link = fullLink;
                testBtn.textContent = 'Test';
                actions.appendChild(testBtn);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'mini-btn danger';
            delBtn.type = 'button';
            delBtn.dataset.action = 'delete';
            delBtn.dataset.id = link.id;
            delBtn.textContent = 'Delete';
            actions.appendChild(delBtn);

            footer.append(status, actions);

            item.append(header, urlRow, footer);
            return item;
        }

        function armDeleteConfirmation(tokenId) {
            const existingTimeout = pendingDeletes.get(tokenId);
            if (existingTimeout) {
                clearTimeout(existingTimeout);
            }
            const timeoutId = setTimeout(() => {
                pendingDeletes.delete(tokenId);
            }, DELETE_CONFIRM_MS);
            pendingDeletes.set(tokenId, timeoutId);
        }

        async function deleteToken(tokenId, buttonEl) {
            Trace.group('DELETE_FLOW');
            Trace.log('DELETE_CLICK', { tokenId });
            if (!db) {
                Trace.log('DELETE_ABORT_NO_DB');
                showError('Database not connected. Please refresh the page.');
                Trace.groupEnd();
                return;
            }

            // Two-click confirm
            if (!pendingDeletes.has(tokenId)) {
                armDeleteConfirmation(tokenId);
                // Visual feedback: show confirmation state on button
                if (buttonEl) {
                    const origText = buttonEl.textContent;
                    buttonEl.textContent = '⚠️ Sure?';
                    buttonEl.classList.add('confirm-armed');
                    const revertTimer = setTimeout(() => {
                        buttonEl.textContent = origText;
                        buttonEl.classList.remove('confirm-armed');
                    }, DELETE_CONFIRM_MS);
                    // Store revert timer so we can cancel it on actual delete
                    buttonEl._revertTimer = revertTimer;
                }
                Trace.log('DELETE_CONFIRM_ARMED', { ttlMs: DELETE_CONFIRM_MS });
                Trace.groupEnd();
                return;
            }

            // Confirmed
            const timeoutId = pendingDeletes.get(tokenId);
            if (timeoutId) clearTimeout(timeoutId);
            pendingDeletes.delete(tokenId);

            const originalText = buttonEl?.textContent;
            if (buttonEl) {
                if (buttonEl._revertTimer) clearTimeout(buttonEl._revertTimer);
                buttonEl.classList.remove('confirm-armed');
                buttonEl.disabled = true;
                buttonEl.textContent = 'Deleting...';
            }

            try {
                Trace.log('RPC_DELETE_START');
                const { data: delResult, error } = await db.rpc('admin_delete_token', {
                    p_admin_code: adminCode,
                    p_token_id: String(tokenId)
                });

                if (error) {
                    throw new Error(error.message || 'Delete failed');
                }

                if (!delResult || !delResult.success) {
                    const errMsg = delResult?.error || 'Delete failed';
                    if (errMsg === 'Unauthorized') {
                        adminCode = null;
                        showAuthLockout('Invalid admin code.');
                        return;
                    }
                    throw new Error(errMsg);
                }

                Trace.log('DELETE_SUCCESS');

                // Interlock: Hide result area if the deleted token is currently displayed
                // We check if the current link output contains the deleted token ID
                if (elements.resultArea && !elements.resultArea.classList.contains('is-hidden')) {
                    const currentLink = elements.linkOutput.value;
                    if (currentLink && currentLink.includes(tokenId)) {
                        setHidden(elements.resultArea, true);
                        elements.linkOutput.value = '';
                    }
                }

                // Refresh list and source performance to keep paging consistent
                resetRecentLinksPaging();
                await loadRecentLinks(state.filter);

            } catch (err) {
                console.error('Delete failed:', err);
                Trace.log('DELETE_FAILED', { message: err?.message || String(err) });
                showError(`Failed to delete link: ${err.message}`);
            } finally {
                if (buttonEl) {
                    buttonEl.disabled = false;
                    buttonEl.textContent = originalText || 'Delete';
                }

                Trace.groupEnd();
            }
        }
        
        /**
         * Copies a link to clipboard
         */
        async function copyLinkToClipboard(link) {
            try {
                Trace.log('COPY_RECENT_LINK', { link });
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(link);
                } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = link;
                    textarea.style.position = 'fixed';
                    textarea.style.left = '-9999px';
                    textarea.setAttribute('aria-hidden', 'true');
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                }
                Trace.log('COPY_RECENT_LINK_SUCCESS');
            } catch (error) {
                console.error('Copy failed:', error);
                Trace.log('COPY_RECENT_LINK_FAILED', { message: error?.message || String(error) });
            }
        }
        
        /**
         * Opens a link in new tab
         */
        function openLink(link) {
            Trace.log('USER_OPEN_TEST_LINK', { link });
            window.open(link, '_blank', 'noopener,noreferrer');
        }
        
        /**
         * Filters links by source
         */
        function filterBySource(source) {
            const normalized = normalizeSourceKey(source);
            state.filter = normalized;
            Trace.log('FILTER_APPLIED', { source: normalized });
            resetRecentLinksPaging();
            loadRecentLinks(normalized);

            // Unify filtering UX: expand the Recent Links panel when filtering
            if (!state.links.expanded) {
                state.links.expanded = true;
                setHidden(elements.recentLinks, false);
                elements.expandArrow.classList.toggle('collapsed', false);
                if (elements.recentLinksToggle) {
                    elements.recentLinksToggle.setAttribute('aria-expanded', 'true');
                }
            }
        }
        
        /**
         * Clears the source filter
         */
        function clearFilter() {
            state.filter = null;
            Trace.log('FILTER_CLEARED');
            resetRecentLinksPaging();
            loadRecentLinks();
        }
        
        /**
         * Toggles the links section visibility
         */
        function toggleLinksSection() {
            state.links.expanded = !state.links.expanded;
            Trace.log('LINKS_TOGGLED', { expanded: state.links.expanded });
            setHidden(elements.recentLinks, !state.links.expanded);
            elements.expandArrow.classList.toggle('collapsed', !state.links.expanded);

            if (elements.recentLinksToggle) {
                elements.recentLinksToggle.setAttribute('aria-expanded', String(state.links.expanded));
            }

            if (state.links.expanded) {
                ensureLinksObserver();
            }
        }

        // ============================================
        // EVENT LISTENERS
        // ============================================

        populateSourceSelect();

        if (elements.form) {
            elements.form.addEventListener('submit', (e) => {
                e.preventDefault();
                generateLink();
            });
        } else {
            elements.btn.addEventListener('click', generateLink);
        }
        elements.copyBtn.addEventListener('click', copyToClipboard);

        if (elements.recentLinksToggle) {
            elements.recentLinksToggle.addEventListener('click', () => {
                Trace.log('USER_TOGGLE_SECTION_CLICK');
                toggleLinksSection();
            });
        }

        if (elements.clearFilterBtn) {
            elements.clearFilterBtn.addEventListener('click', (e) => {
                e.preventDefault();
                Trace.log('USER_CLEAR_FILTER_CLICK');
                clearFilter();
            });
        }

        // Allow Enter key on select to generate
        elements.sourceSelect.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                generateLink();
            }
        });

        // ============================================
        // INITIALIZATION
        // ============================================

        Trace.log('UI_READY');

        // Verify admin code server-side, then load data
        if (db) {
            (async () => {
                try {
                    Trace.log('AUTH_SERVER_VERIFY_START');
                    const { data, error } = await db.rpc('verify_admin', { p_admin_code: adminCode });
                    if (error || !data || !data.success) {
                        Trace.log('AUTH_SERVER_DENIED');
                        adminCode = null;
                        showAuthLockout('Invalid admin code.');
                        return;
                    }
                    Trace.log('AUTH_SERVER_VERIFIED');
                    clearAuthLockout();
                } catch (e) {
                    // Network error — allow proceeding, individual RPCs will catch invalid codes
                    console.warn('Admin verification network error:', e);
                }
                resetRecentLinksPaging();
                loadRecentLinks();
            })();
        }

        // Handle page visibility changes (refresh when page becomes visible)
        // Cooldown prevents redundant fetches on rapid tab switching
        let lastVisibilityRefresh = 0;
        const VISIBILITY_COOLDOWN_MS = 60_000; // 1 minute

        function onVisibilityChange() {
            if (!document.hidden && db) {
                const now = Date.now();
                if (now - lastVisibilityRefresh < VISIBILITY_COOLDOWN_MS) return;
                lastVisibilityRefresh = now;
                resetRecentLinksPaging();
                loadRecentLinks(state.filter).catch(() => {});
            }
        }

        document.addEventListener('visibilitychange', onVisibilityChange);

        function cleanup() {
            try {
                if (state?.links?.observer) {
                    try { state.links.observer.disconnect(); } catch { /* noop */ }
                    state.links.observer = null;
                }
            } catch { /* noop */ }

            try {
                document.removeEventListener('visibilitychange', onVisibilityChange);
            } catch { /* noop */ }

            try {
                pendingDeletes.forEach((t) => { try { clearTimeout(t); } catch { /* noop */ } });
                pendingDeletes.clear();
            } catch { /* noop */ }
        }

        window.addEventListener('beforeunload', cleanup);

        // ============================================
        // CHANGE ADMIN CODE
        // ============================================
        {
            const changeBtn = document.getElementById('changeCodeBtn');
            const currentInput = document.getElementById('currentCodeInput');
            const newInput = document.getElementById('newCodeInput');
            const confirmInput = document.getElementById('confirmCodeInput');
            const changeMsg = document.getElementById('changeCodeMessage');

            function showChangeMsg(text, isError) {
                changeMsg.textContent = text;
                changeMsg.className = 'gallery-msg ' + (isError ? 'error' : 'success');
                setHidden(changeMsg, false);
            }

            if (changeBtn) {
                changeBtn.addEventListener('click', async () => {
                    setHidden(changeMsg, true);
                    const currentVal = currentInput.value.trim();
                    const newVal = newInput.value.trim();
                    const confirmVal = confirmInput.value.trim();

                    if (!currentVal) { showChangeMsg('Enter your current admin code.', true); return; }
                    if (newVal.length < 4) { showChangeMsg('New code must be at least 4 characters.', true); return; }
                    if (newVal !== confirmVal) { showChangeMsg('New codes do not match.', true); return; }
                    if (newVal === currentVal) { showChangeMsg('New code must be different from current code.', true); return; }

                    changeBtn.disabled = true;
                    changeBtn.textContent = 'Changing...';

                    try {
                        const { data, error } = await db.rpc('admin_change_code', {
                            p_current_code: currentVal,
                            p_new_code: newVal
                        });

                        if (error) throw new Error(error.message);
                        if (!data || !data.success) {
                            const errMsg = data?.error || 'Change failed';
                            showChangeMsg(errMsg, true);
                            return;
                        }

                        // Update in-memory admin code so subsequent actions use the new one
                        adminCode = newVal;
                        currentInput.value = '';
                        newInput.value = '';
                        confirmInput.value = '';
                        showChangeMsg('Admin code changed successfully!', false);
                        Trace.log('ADMIN_CODE_CHANGED');
                    } catch (err) {
                        showChangeMsg('Failed: ' + err.message, true);
                    } finally {
                        changeBtn.disabled = false;
                        changeBtn.textContent = 'Change Admin Code';
                    }
                });
            }
        }

        // ============================================
        // GALLERY MANAGER
        // ============================================
        {
            const gEl = {
                section: document.getElementById('gallerySection'),
                form: document.getElementById('galleryForm'),
                urlInput: document.getElementById('galleryUrl'),
                urlStatus: document.getElementById('galleryUrlStatus'),
                preview: document.getElementById('galleryPreview'),
                titleInput: document.getElementById('galleryTitle'),
                mediumInput: document.getElementById('galleryMedium'),
                yearInput: document.getElementById('galleryYear'),
                captionPreview: document.getElementById('galleryCaptionPreview'),
                addBtn: document.getElementById('galleryAddBtn'),
                message: document.getElementById('galleryMessage'),
                list: document.getElementById('galleryList'),
                count: document.getElementById('galleryCount')
            };

            let galleryLoaded = false;
            let galleryItems = [];
            let lastMovedId = null;
            const galleryDeletePending = new Map();
            const GALLERY_DELETE_MS = 3000;
            const dragDropTarget = { id: null, position: 'before' };

            // ----- Google Drive URL Converter -----
            function extractDriveFileId(url) {
                if (!url || typeof url !== 'string') return null;
                url = url.trim();
                // lh3.googleusercontent.com/d/{ID}
                let m = url.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
                if (m) return m[1];
                // drive.google.com/file/d/{ID}/...
                m = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
                if (m) return m[1];
                // drive.google.com/open?id={ID} or /uc?id= or /thumbnail?id=
                m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
                if (m) return m[1];
                // Bare ID (25+ chars, letters/numbers/dashes/underscores)
                if (/^[a-zA-Z0-9_-]{25,}$/.test(url)) return url;
                return null;
            }

            function toEmbedUrl(fileId) {
                return `https://lh3.googleusercontent.com/d/${fileId}`;
            }

            function buildCaption(title, medium, year) {
                let c = title || '';
                if (medium || year) {
                    c += ' - ';
                    if (medium) c += medium;
                    if (medium && year) c += ' ';
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
                    gEl.urlStatus.textContent = '✅ Valid Google Drive URL detected';
                    gEl.urlStatus.className = 'gallery-url-status valid';
                    setHidden(gEl.urlStatus, false);
                    // Show preview (no innerHTML)
                    gEl.preview.textContent = '';
                    const img = document.createElement('img');
                    img.alt = 'Preview';
                    img.src = convertedUrl;
                    img.addEventListener('error', () => {
                        gEl.preview.textContent = '';
                        const msg = document.createElement('span');
                        msg.className = 'text-muted-2';
                        msg.style.fontSize = '0.7rem';
                        msg.style.padding = '0.5rem';
                        msg.textContent = 'Could not load preview';
                        gEl.preview.appendChild(msg);
                    }, { once: true });
                    gEl.preview.appendChild(img);
                    setHidden(gEl.preview, false);
                } else {
                    convertedUrl = null;
                    gEl.urlStatus.textContent = '⚠️ Could not detect a Google Drive file ID';
                    gEl.urlStatus.className = 'gallery-url-status invalid';
                    setHidden(gEl.urlStatus, false);
                    setHidden(gEl.preview, true);
                }
            }

            gEl.urlInput.addEventListener('input', handleUrlInput);
            gEl.urlInput.addEventListener('paste', () => setTimeout(handleUrlInput, 50));

            // ----- Caption Preview -----
            function updateCaptionPreview() {
                const t = gEl.titleInput.value.trim();
                const m = gEl.mediumInput.value.trim();
                const y = gEl.yearInput.value.trim();
                if (t) {
                    gEl.captionPreview.textContent = 'Caption: "' + buildCaption(t, m, y) + '"';
                } else {
                    gEl.captionPreview.textContent = '';
                }
            }

            gEl.titleInput.addEventListener('input', updateCaptionPreview);
            gEl.mediumInput.addEventListener('input', updateCaptionPreview);
            gEl.yearInput.addEventListener('input', updateCaptionPreview);

            // ----- Show Gallery Message -----
            function showGalleryMsg(text, isError) {
                gEl.message.textContent = text;
                gEl.message.className = 'gallery-msg ' + (isError ? 'error' : 'success');
                setHidden(gEl.message, false);
                setTimeout(() => setHidden(gEl.message, true), 5000);
            }

            // ----- Add Gallery Item -----
            gEl.form.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!db || !adminCode) return;

                const imgUrl = convertedUrl;
                const title = gEl.titleInput.value.trim();
                const medium = gEl.mediumInput.value.trim() || null;
                const year = gEl.yearInput.value ? parseInt(gEl.yearInput.value, 10) : null;

                if (!imgUrl) {
                    showGalleryMsg('Please paste a valid Google Drive image URL.', true);
                    return;
                }
                if (!title) {
                    showGalleryMsg('Please enter an artwork title.', true);
                    return;
                }

                gEl.addBtn.disabled = true;
                gEl.addBtn.textContent = 'Adding...';

                try {
                    // Calculate next sort order (find max and add 1, starting from 1)
                    const maxSort = galleryItems.length > 0 
                        ? Math.max(...galleryItems.map(i => i.sort_order || 0))
                        : 0;
                    const nextSort = Math.max(1, maxSort + 1);

                    const { data, error } = await db.rpc('admin_add_gallery_item', {
                        p_admin_code: adminCode,
                        p_img_url: imgUrl,
                        p_title: title,
                        p_medium: medium,
                        p_year_created: year,
                        p_sort_order: nextSort
                    });

                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showGalleryMsg(data?.error || 'Failed to add item', true);
                        return;
                    }

                    showGalleryMsg('Artwork added to gallery! Visitors will see it on page refresh.', false);
                    // Reset form
                    gEl.form.reset();
                    convertedUrl = null;
                    setHidden(gEl.urlStatus, true);
                    setHidden(gEl.preview, true);
                    gEl.captionPreview.textContent = '';
                    // Reload list
                    loadGalleryItems();
                } catch (err) {
                    showGalleryMsg('Error: ' + err.message, true);
                } finally {
                    gEl.addBtn.disabled = false;
                    gEl.addBtn.textContent = 'Add to Gallery';
                }
            });

            // ----- Load Gallery Items -----
            async function loadGalleryItems() {
                if (!db || !adminCode) return;

                try {
                    const { data, error } = await db.rpc('admin_list_gallery', {
                        p_admin_code: adminCode
                    });

                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        gEl.list.textContent = '';
                        const p = document.createElement('p');
                        p.className = 'text-danger';
                        p.style.fontSize = '0.85rem';
                        p.textContent = String(data?.error || 'Failed to load');
                        gEl.list.appendChild(p);
                        return;
                    }

                    galleryItems = data.items || [];
                    renderGalleryItems();
                    galleryLoaded = true;
                } catch (err) {
                    gEl.list.textContent = '';
                    const p = document.createElement('p');
                    p.className = 'text-danger';
                    p.style.fontSize = '0.85rem';
                    p.textContent = 'Error: ' + String(err?.message || err || 'Unknown error');
                    gEl.list.appendChild(p);
                }
            }

            // ----- Render Gallery Items -----
            function renderGalleryItems() {
                const active = galleryItems.filter(i => i.is_active).length;
                const total = galleryItems.length;
                gEl.count.textContent = `${active} active / ${total} total items`;

                if (total === 0) {
                    gEl.list.textContent = '';
                    const p = document.createElement('p');
                    p.className = 'text-muted-2';
                    p.style.fontSize = '0.85rem';
                    p.textContent = 'No gallery items yet. Add your first artwork above!';
                    gEl.list.appendChild(p);
                    return;
                }

                gEl.list.textContent = '';
                const fragment = document.createDocumentFragment();

                for (const item of galleryItems) {
                    const caption = buildCaption(item.title, item.medium, item.year_created);
                    const isActive = Boolean(item.is_active);
                    const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    const flashClass = String(item.id) === String(lastMovedId) ? ' flash' : '';

                    const row = document.createElement('div');
                    row.className = 'gallery-item ' + (isActive ? '' : 'inactive') + flashClass;
                    row.setAttribute('data-gallery-id', String(item.id));

                    const handle = document.createElement('span');
                    handle.className = 'drag-handle';
                    handle.title = 'Drag to reorder';
                    handle.textContent = '⠿';

                    const thumb = document.createElement('div');
                    thumb.className = 'gallery-item-thumb';
                    if (typeof item.img_url === 'string' && item.img_url.startsWith('http')) {
                        const img = document.createElement('img');
                        img.loading = 'lazy';
                        img.alt = String(item.title || 'Artwork');
                        img.src = item.img_url;
                        img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
                        thumb.appendChild(img);
                    } else {
                        const fallback = document.createElement('span');
                        fallback.style.display = 'flex';
                        fallback.style.alignItems = 'center';
                        fallback.style.justifyContent = 'center';
                        fallback.style.height = '100%';
                        fallback.style.fontSize = '1.2rem';
                        fallback.textContent = '🖼️';
                        thumb.appendChild(fallback);
                    }

                    const info = document.createElement('div');
                    info.className = 'gallery-item-info';
                    const title = document.createElement('div');
                    title.className = 'gallery-item-title';
                    title.textContent = caption;
                    const meta = document.createElement('div');
                    meta.className = 'gallery-item-meta';
                    meta.textContent = 'Added ' + date;
                    info.append(title, meta);

                    const sortInput = document.createElement('input');
                    sortInput.type = 'number';
                    sortInput.className = 'gallery-sort-input';
                    sortInput.min = '1';
                    sortInput.max = '9999';
                    sortInput.title = 'Position (1 = first)';
                    sortInput.setAttribute('data-gallery-action', 'sort');
                    sortInput.setAttribute('data-gallery-id', String(item.id));
                    sortInput.setAttribute('aria-label', 'Sort order for ' + String(item.title || 'Artwork'));
                    const safeSort = Number.isFinite(Number(item.sort_order)) ? Math.max(1, Number(item.sort_order)) : 1;
                    sortInput.value = String(safeSort);

                    const actions = document.createElement('div');
                    actions.className = 'gallery-item-actions';

                    const toggleBtn = document.createElement('button');
                    toggleBtn.className = 'mini-btn gallery-item-badge ' + (isActive ? 'active' : 'hidden');
                    toggleBtn.setAttribute('role', 'switch');
                    toggleBtn.setAttribute('aria-checked', String(isActive));
                    toggleBtn.setAttribute('data-gallery-action', 'toggle');
                    toggleBtn.setAttribute('data-gallery-id', String(item.id));
                    toggleBtn.title = 'Click to ' + (isActive ? 'hide' : 'show');
                    toggleBtn.textContent = isActive ? '👁️' : '🚫';

                    const editBtn = document.createElement('button');
                    editBtn.className = 'mini-btn secondary';
                    editBtn.setAttribute('data-gallery-action', 'edit');
                    editBtn.setAttribute('data-gallery-id', String(item.id));
                    editBtn.title = 'Edit details';
                    editBtn.textContent = '✏️';

                    const delBtn = document.createElement('button');
                    delBtn.className = 'mini-btn danger';
                    delBtn.setAttribute('data-gallery-action', 'delete');
                    delBtn.setAttribute('data-gallery-id', String(item.id));
                    delBtn.title = 'Delete permanently';
                    delBtn.textContent = '🗑️';

                    actions.append(toggleBtn, editBtn, delBtn);
                    row.append(handle, thumb, info, sortInput, actions);
                    fragment.appendChild(row);
                }

                gEl.list.appendChild(fragment);

                if (lastMovedId !== null) {
                    setTimeout(() => { lastMovedId = null; }, 0);
                }
            }

            // ----- Toggle Gallery Item -----
            async function toggleGalleryItem(id, btn) {
                if (!db || !adminCode) return;
                btn.disabled = true;
                try {
                    const { data, error } = await db.rpc('admin_toggle_gallery_item', {
                        p_admin_code: adminCode,
                        p_item_id: parseInt(id, 10)
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showGalleryMsg(data?.error || 'Toggle failed', true);
                        return;
                    }
                    showGalleryMsg(data.is_active ? 'Item is now visible in gallery' : 'Item hidden from gallery', false);
                    loadGalleryItems();
                } catch (err) {
                    showGalleryMsg('Error: ' + err.message, true);
                } finally {
                    btn.disabled = false;
                }
            }

            // ----- Delete Gallery Item (double-click to confirm) -----
            async function deleteGalleryItem(id, btn) {
                // First click = arm confirmation
                if (!galleryDeletePending.has(id)) {
                    galleryDeletePending.set(id, true);
                    btn.textContent = '⚠️ Sure?';
                    btn.classList.remove('danger');
                    btn.classList.add('confirm-armed');
                    setTimeout(() => {
                        if (galleryDeletePending.has(id)) {
                            galleryDeletePending.delete(id);
                            btn.textContent = '🗑️';
                            btn.classList.remove('confirm-armed');
                            btn.classList.add('danger');
                        }
                    }, GALLERY_DELETE_MS);
                    return;
                }

                // Second click = confirmed
                galleryDeletePending.delete(id);
                btn.disabled = true;
                btn.textContent = '...';

                try {
                    const { data, error } = await db.rpc('admin_delete_gallery_item', {
                        p_admin_code: adminCode,
                        p_item_id: parseInt(id, 10)
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showGalleryMsg(data?.error || 'Delete failed', true);
                        return;
                    }
                    showGalleryMsg('Item deleted permanently', false);
                    loadGalleryItems();
                } catch (err) {
                    showGalleryMsg('Error: ' + err.message, true);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '🗑️';
                    btn.classList.remove('confirm-armed');
                    btn.classList.add('danger');
                }
            }

            // ----- Edit Gallery Item (modal) -----
            let editOverlay = null;
            let editConvertedUrl = null;
            let editEscHandler = null;

            function setPreviewImage(container, url, altText) {
                if (!container) return;
                container.textContent = '';
                if (!url) {
                    const fallback = document.createElement('span');
                    fallback.style.display = 'flex';
                    fallback.style.alignItems = 'center';
                    fallback.style.justifyContent = 'center';
                    fallback.style.height = '100%';
                    fallback.style.fontSize = '2rem';
                    fallback.textContent = '🖼️';
                    container.appendChild(fallback);
                    return;
                }
                const img = document.createElement('img');
                img.alt = altText || 'Preview';
                img.src = url;
                img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
                container.appendChild(img);
            }

            function openEditModal(id) {
                const item = galleryItems.find(i => String(i.id) === String(id));
                if (!item) return;

                // Remove existing overlay if any
                if (editOverlay) editOverlay.remove();
                editConvertedUrl = null;

                editOverlay = document.createElement('div');
                editOverlay.className = 'gallery-edit-overlay';
                // Static skeleton only; all item values are assigned via properties/textContent
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

                const urlInput = editOverlay.querySelector('#editUrl');
                const urlStatus = editOverlay.querySelector('#editUrlStatus');
                const previewImg = editOverlay.querySelector('#editPreviewImg');
                const titleInput = editOverlay.querySelector('#editTitle');
                const mediumInput = editOverlay.querySelector('#editMedium');
                const yearInput = editOverlay.querySelector('#editYear');
                const activeToggle = editOverlay.querySelector('#editActiveToggle');
                const previewCaption = editOverlay.querySelector('#editPreviewCaption');
                const previewSubtext = editOverlay.querySelector('#editPreviewSubtext');
                const editMessage = editOverlay.querySelector('#editMessage');

                // Seed modal fields safely
                urlInput.value = String(item.img_url || '');
                titleInput.value = String(item.title || '');
                mediumInput.value = String(item.medium || '');
                yearInput.value = item.year_created ? String(item.year_created) : '';
                editOverlay.querySelector('#editSortOrder').value = String(Math.max(1, Number(item.sort_order) || 1));

                setPreviewImage(previewImg, (typeof item.img_url === 'string' && item.img_url.startsWith('http')) ? item.img_url : '', 'Current artwork');
                previewCaption.textContent = buildCaption(item.title, item.medium, item.year_created);
                previewSubtext.textContent = item.is_active ? '✅ Visible on site' : '🚫 Hidden from site';

                activeToggle.dataset.active = String(Boolean(item.is_active));
                activeToggle.setAttribute('aria-checked', String(Boolean(item.is_active)));
                activeToggle.className = 'mini-btn gallery-item-badge ' + (item.is_active ? 'active' : 'hidden');
                activeToggle.title = 'Click to ' + (item.is_active ? 'hide' : 'show');
                activeToggle.textContent = item.is_active ? '👁️' : '🚫';

                // Active toggle button handler
                activeToggle.addEventListener('click', () => {
                    const isActive = activeToggle.dataset.active === 'true';
                    const newActive = !isActive;
                    activeToggle.dataset.active = String(newActive);
                    activeToggle.setAttribute('aria-checked', String(newActive));
                    activeToggle.className = 'mini-btn gallery-item-badge ' + (newActive ? 'active' : 'hidden');
                    activeToggle.title = 'Click to ' + (newActive ? 'hide' : 'show');
                    activeToggle.textContent = newActive ? '👁️' : '🚫';
                    previewSubtext.textContent = newActive ? '✅ Visible on site' : '🚫 Hidden from site';
                });

                // URL input handler with Google Drive converter
                function handleEditUrlInput() {
                    const raw = urlInput.value.trim();
                    if (!raw) {
                        urlStatus.classList.add('is-hidden');
                        editConvertedUrl = null;
                        return;
                    }

                    const fileId = extractDriveFileId(raw);
                    if (fileId) {
                        const embedUrl = toEmbedUrl(fileId);
                        editConvertedUrl = embedUrl;
                        urlStatus.textContent = '✅ Google Drive link converted';
                        urlStatus.className = 'gallery-url-status valid';
                        setPreviewImage(previewImg, embedUrl, 'Preview');
                    } else {
                        editConvertedUrl = null;
                        if (raw.startsWith('http')) {
                            urlStatus.textContent = '✅ Direct URL detected';
                            urlStatus.className = 'gallery-url-status valid';
                            setPreviewImage(previewImg, raw, 'Preview');
                        } else {
                            urlStatus.textContent = '⚠️ Invalid URL format';
                            urlStatus.className = 'gallery-url-status invalid';
                        }
                    }
                }

                // Live caption preview update
                function updateEditCaptionPreview() {
                    const title = titleInput.value.trim() || 'Untitled';
                    const medium = mediumInput.value.trim();
                    const year = yearInput.value;
                    previewCaption.textContent = buildCaption(title, medium, year);
                }

                // Active toggle preview
                function updateEditActivePreview() {
                    const isActive = activeToggle.dataset.active === 'true';
                    previewSubtext.textContent = isActive ? '✅ Visible on site' : '🚫 Hidden from site';
                }

                // Attach live preview handlers
                urlInput.addEventListener('input', handleEditUrlInput);
                urlInput.addEventListener('paste', () => setTimeout(handleEditUrlInput, 50));
                titleInput.addEventListener('input', updateEditCaptionPreview);
                mediumInput.addEventListener('input', updateEditCaptionPreview);
                yearInput.addEventListener('input', updateEditCaptionPreview);

                // Focus title input
                titleInput.focus();
                titleInput.select();

                // Close on backdrop click
                editOverlay.addEventListener('click', (ev) => {
                    if (ev.target === editOverlay) closeEditModal();
                });

                // Cancel button
                editOverlay.querySelector('#editCancelBtn').addEventListener('click', closeEditModal);

                // Focus trap — keep Tab cycling inside the modal
                const modal = editOverlay.querySelector('.gallery-edit-modal');
                modal.addEventListener('keydown', (ev) => {
                    if (ev.key !== 'Tab') return;
                    const focusable = modal.querySelectorAll(
                        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
                if (editEscHandler) {
                    document.removeEventListener('keydown', editEscHandler);
                }
                editEscHandler = (ev) => {
                    if (ev.key === 'Escape') closeEditModal();
                };
                document.addEventListener('keydown', editEscHandler);

                // Helper to show inline message
                function showEditMessage(text, isError) {
                    editMessage.textContent = text;
                    editMessage.className = isError ? 'gallery-edit-message error' : 'gallery-edit-message success';
                    editMessage.classList.remove('is-hidden');
                    setTimeout(() => editMessage.classList.add('is-hidden'), 4000);
                }

                // Save
                editOverlay.querySelector('#galleryEditForm').addEventListener('submit', async (ev) => {
                    ev.preventDefault();
                    
                    const newUrl = editConvertedUrl || urlInput.value.trim();
                    const newTitle = titleInput.value.trim();
                    const newMedium = mediumInput.value.trim() || null;
                    const newYear = yearInput.value ? parseInt(yearInput.value, 10) : null;
                    const newSort = editOverlay.querySelector('#editSortOrder').value !== '' ? Math.max(1, parseInt(editOverlay.querySelector('#editSortOrder').value, 10)) : 1;
                    const newActive = activeToggle.dataset.active === 'true';

                    if (!newUrl) { showEditMessage('Image URL is required.', true); return; }
                    if (!newTitle) { showEditMessage('Title is required.', true); return; }

                    const saveBtn = editOverlay.querySelector('#editSaveBtn');
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Saving...';

                    try {
                        const { data, error } = await db.rpc('admin_edit_gallery_item', {
                            p_admin_code: adminCode,
                            p_item_id: parseInt(id, 10),
                            p_img_url: newUrl,
                            p_title: newTitle,
                            p_medium: newMedium,
                            p_year_created: newYear,
                            p_sort_order: newSort,
                            p_is_active: newActive
                        });
                        if (error) throw new Error(error.message);
                        if (!data || !data.success) {
                            showEditMessage(data?.error || 'Update failed', true);
                            saveBtn.disabled = false;
                            saveBtn.textContent = 'Save Changes';
                            return;
                        }
                        showEditMessage('✅ Artwork updated successfully!', false);

                        // If sort_order changed, issue a reorder RPC
                        if (newSort !== item.sort_order) {
                            try {
                                await db.rpc('admin_reorder_gallery_item', {
                                    p_admin_code: adminCode,
                                    p_item_id: parseInt(id, 10),
                                    p_new_sort_order: newSort
                                });
                            } catch (_) { /* best-effort */ }
                        }

                        setTimeout(() => {
                            closeEditModal();
                            loadGalleryItems();
                        }, 1000);
                    } catch (err) {
                        showEditMessage('Error: ' + err.message, true);
                        saveBtn.disabled = false;
                        saveBtn.textContent = 'Save Changes';
                    }
                });
            }

            function closeEditModal() {
                if (editEscHandler) {
                    document.removeEventListener('keydown', editEscHandler);
                    editEscHandler = null;
                }
                if (editOverlay) {
                    editOverlay.remove();
                    editOverlay = null;
                }
            }

            // ----- Event Delegation for Gallery List -----
            gEl.list.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const action = btn.getAttribute('data-gallery-action');
                const id = btn.getAttribute('data-gallery-id');
                if (!action || !id) return;

                if (action === 'toggle') toggleGalleryItem(id, btn);
                if (action === 'edit') openEditModal(id);
                if (action === 'delete') deleteGalleryItem(id, btn);
            });

            // ----- Quiet Background Sync (updates local state + inputs, no DOM rebuild) -----
            async function syncSortOrders() {
                if (!db || !adminCode) return;
                try {
                    const { data, error } = await db.rpc('admin_list_gallery', {
                        p_admin_code: adminCode
                    });
                    if (error || !data || !data.success) return;
                    const serverItems = data.items || [];
                    // Build a lookup from server
                    const serverMap = new Map(serverItems.map(i => [String(i.id), i]));
                    // Update local array with server sort_order values
                    galleryItems.forEach(item => {
                        const server = serverMap.get(String(item.id));
                        if (server) item.sort_order = server.sort_order;
                    });
                    // Re-sort local array to match server order
                    galleryItems.sort((a, b) => a.sort_order - b.sort_order);
                    // Patch the DOM inputs in-place
                    galleryItems.forEach(item => {
                        const input = gEl.list.querySelector(`input.gallery-sort-input[data-gallery-id="${item.id}"]`);
                        if (input) input.value = item.sort_order;
                    });
                } catch (_) { /* best-effort */ }
            }

            // ----- Inline Sort-Order Save -----
            async function saveSortOrder(input) {
                const id = input.getAttribute('data-gallery-id');
                const item = galleryItems.find(i => String(i.id) === String(id));
                if (!item) return;
                let newVal = parseInt(input.value, 10);
                if (isNaN(newVal) || newVal < 1) {
                    input.value = Math.max(1, item.sort_order);
                    return;
                }
                if (newVal === item.sort_order) return;

                input.disabled = true;
                try {
                    const { data, error } = await db.rpc('admin_reorder_gallery_item', {
                        p_admin_code: adminCode,
                        p_item_id: parseInt(id, 10),
                        p_new_sort_order: newVal
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) { showGalleryMsg(data?.error || 'Sort update failed', true); return; }
                    showGalleryMsg(`Position updated to ${newVal}`, false);
                    loadGalleryItems();
                } catch (err) {
                    showGalleryMsg('Error: ' + err.message, true);
                } finally {
                    input.disabled = false;
                }
            }

            gEl.list.addEventListener('change', (e) => {
                if (e.target.matches('.gallery-sort-input')) saveSortOrder(e.target);
            });
            gEl.list.addEventListener('keydown', (e) => {
                if (e.target.matches('.gallery-sort-input') && e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur(); // triggers change event
                }
            });

            // ----- Drag & Drop Reorder (Desktop + Touch) -----
            let dragSrcId = null;
            let currentDropTarget = null;

            function clearDropIndicators() {
                if (!gEl.list) return;
                gEl.list.querySelectorAll('.drag-over, .drop-before, .drop-after').forEach(el => {
                    el.classList.remove('drag-over', 'drop-before', 'drop-after');
                });
                currentDropTarget = null;
            }

            /** Shared helper: update the drop-indicator on a target row */
            function updateDropIndicator(row, clientY) {
                if (!row || row.getAttribute('data-gallery-id') === dragSrcId) {
                    // Hovering over source or outside — clear stale indicators
                    if (currentDropTarget) {
                        currentDropTarget.classList.remove('drag-over', 'drop-before', 'drop-after');
                        currentDropTarget = null;
                    }
                    dragDropTarget.id = null;
                    return;
                }
                const rect = row.getBoundingClientRect();
                const isBefore = (clientY - rect.top) < rect.height / 2;

                // Switch highlight to new row (avoid clearing everything each frame)
                if (currentDropTarget && currentDropTarget !== row) {
                    currentDropTarget.classList.remove('drag-over', 'drop-before', 'drop-after');
                }
                currentDropTarget = row;
                row.classList.remove('drop-before', 'drop-after');
                row.classList.add('drag-over', isBefore ? 'drop-before' : 'drop-after');

                dragDropTarget.id = row.getAttribute('data-gallery-id');
                dragDropTarget.position = isBefore ? 'before' : 'after';
            }

            /** Optimistically reorder the DOM immediately, then sync server */
            function optimisticReorder(srcId, tgtId, position) {
                const srcEl = gEl.list.querySelector(`[data-gallery-id="${srcId}"]`);
                const tgtEl = gEl.list.querySelector(`[data-gallery-id="${tgtId}"]`);
                if (!srcEl || !tgtEl) return;

                // Move the DOM node directly (no re-render, no scroll jump)
                if (position === 'before') {
                    tgtEl.parentNode.insertBefore(srcEl, tgtEl);
                } else {
                    tgtEl.parentNode.insertBefore(srcEl, tgtEl.nextSibling);
                }

                // Brief "just landed" class to suppress transition flicker
                srcEl.classList.add('dropped');
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => srcEl.classList.remove('dropped'));
                });

                // Update local galleryItems array to match new order
                const srcIdx = galleryItems.findIndex(i => String(i.id) === String(srcId));
                const tgtIdx = galleryItems.findIndex(i => String(i.id) === String(tgtId));
                if (srcIdx !== -1 && tgtIdx !== -1) {
                    const [moved] = galleryItems.splice(srcIdx, 1);
                    const newTgtIdx = galleryItems.findIndex(i => String(i.id) === String(tgtId));
                    if (newTgtIdx !== -1) {
                        const insertAt = position === 'before' ? newTgtIdx : newTgtIdx + 1;
                        galleryItems.splice(insertAt, 0, moved);
                    }
                    // Renumber sort_order locally
                    galleryItems.forEach((item, i) => { item.sort_order = i + 1; });
                    // Update sort-order inputs in-place
                    galleryItems.forEach(item => {
                        const input = gEl.list.querySelector(`input.gallery-sort-input[data-gallery-id="${item.id}"]`);
                        if (input) input.value = item.sort_order;
                    });
                }
            }

            /** Shared helper: execute the move/swap RPC after a drop */
            async function performDrop() {
                const targetId = dragDropTarget.id;
                const targetPosition = dragDropTarget.position || 'before';
                clearDropIndicators();

                if (!dragSrcId || !targetId || dragSrcId === targetId) return;

                // Snapshot for immediate rollback (no network fetch required)
                const snapshot = galleryItems.map(i => ({ ...i }));

                // Optimistic: move the DOM node instantly (no flicker, no scroll jump)
                optimisticReorder(dragSrcId, targetId, targetPosition);

                // Sync to server in background
                try {
                    const { data, error } = await db.rpc('admin_move_gallery_item', {
                        p_admin_code: adminCode,
                        p_item_id: parseInt(dragSrcId, 10),
                        p_target_id: parseInt(targetId, 10),
                        p_position: targetPosition
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showGalleryMsg(data?.error || 'Move failed — reverting', true);
                        galleryItems = snapshot;
                        renderGalleryItems();
                        return;
                    }
                    // Quietly sync sort_order numbers from server
                    syncSortOrders();
                } catch (err) {
                    showGalleryMsg('Error: ' + (err?.message || err) + ' — reverting', true);
                    galleryItems = snapshot;
                    renderGalleryItems();
                }
            }

            // ——— Shared pointer drag (mouse + touch) ———
            // Uses manual clone instead of HTML5 drag — no ghost, no snap-back.

            let dragClone = null;
            let dragSourceRow = null;
            let dragOffsetY = 0;

            /** Start a drag from a pointer (mouse or touch) */
            function startDrag(row, clientX, clientY) {
                // Clear any existing text selection immediately
                const sel = window.getSelection();
                if (sel) sel.removeAllRanges();

                dragSrcId = row.getAttribute('data-gallery-id');
                dragSourceRow = row;
                row.classList.add('dragging');
                document.body.classList.add('is-dragging');

                // Build a floating clone that follows the pointer
                const rect = row.getBoundingClientRect();
                dragOffsetY = clientY - rect.top;
                dragClone = row.cloneNode(true);
                dragClone.style.cssText =
                    'position:fixed;pointer-events:none;z-index:10000;transition:none;' +
                    'transform:scale(0.97);opacity:0.88;' +
                    'box-shadow:0 8px 25px rgba(0,0,0,0.18);border-radius:8px;' +
                    'width:' + rect.width + 'px;' +
                    'left:' + rect.left + 'px;' +
                    'top:' + rect.top + 'px;';
                document.body.appendChild(dragClone);
            }

            /** Move the clone + update indicator */
            function moveDrag(clientX, clientY) {
                if (dragClone) {
                    dragClone.style.top = (clientY - dragOffsetY) + 'px';
                }
                // Temporarily hide the source row from hit-testing so
                // elementFromPoint finds the row *underneath* instead
                if (dragSourceRow) dragSourceRow.style.pointerEvents = 'none';
                const elBelow = document.elementFromPoint(clientX, clientY);
                if (dragSourceRow) dragSourceRow.style.pointerEvents = '';
                const row = elBelow ? elBelow.closest('[data-gallery-id]') : null;
                updateDropIndicator(row, clientY);
            }

            /** End drag, perform drop, clean up */
            async function endDrag() {
                if (dragSourceRow) dragSourceRow.classList.remove('dragging');
                if (dragClone) { dragClone.remove(); dragClone = null; }
                document.body.classList.remove('is-dragging');

                await performDrop();

                dragSourceRow = null;
                dragSrcId = null;
                dragDropTarget.id = null;
                dragDropTarget.position = 'before';
            }

            // ——— Mouse events (desktop) ———

            gEl.list.addEventListener('mousedown', (e) => {
                const handle = e.target.closest('.drag-handle');
                if (!handle) return;
                const row = handle.closest('.gallery-item');
                if (!row) return;
                e.preventDefault(); // prevent text selection

                startDrag(row, e.clientX, e.clientY);

                function onMouseMove(ev) {
                    ev.preventDefault();
                    moveDrag(ev.clientX, ev.clientY);
                }

                async function onMouseUp() {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    await endDrag();
                }

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            // Prevent native HTML5 drag on gallery items entirely
            gEl.list.addEventListener('dragstart', (e) => {
                e.preventDefault();
            });

            // ——— Touch events (mobile / tablet) ———

            gEl.list.addEventListener('touchstart', (e) => {
                const handle = e.target.closest('.drag-handle');
                if (!handle) return;
                const row = handle.closest('.gallery-item');
                if (!row) return;

                const touch = e.touches[0];
                startDrag(row, touch.clientX, touch.clientY);
            }, { passive: true });

            gEl.list.addEventListener('touchmove', (e) => {
                if (!dragSourceRow) return;
                e.preventDefault(); // prevent scrolling while dragging
                const touch = e.touches[0];
                moveDrag(touch.clientX, touch.clientY);
            }, { passive: false });

            gEl.list.addEventListener('touchend', async () => {
                if (!dragSourceRow) return;
                await endDrag();
            });

            // ----- Load on section open -----
            gEl.section.addEventListener('toggle', () => {
                if (gEl.section.open && !galleryLoaded && db && adminCode) {
                    loadGalleryItems();
                }
            });
        }

        // ============================================
        // HERO SLIDESHOW MANAGER
        // ============================================
        {
            const hEl = {
                section: document.getElementById('heroSection'),
                form: document.getElementById('heroForm'),
                urlInput: document.getElementById('heroUrl'),
                urlStatus: document.getElementById('heroUrlStatus'),
                preview: document.getElementById('heroPreview'),
                addBtn: document.getElementById('heroAddBtn'),
                message: document.getElementById('heroMessage'),
                list: document.getElementById('heroList'),
                count: document.getElementById('heroCount')
            };

            let heroLoaded = false;
            let heroItems = [];
            let heroLastMovedId = null;
            const heroDeletePending = new Map();
            const HERO_DELETE_MS = 3000;
            const heroDragDropTarget = { id: null, position: 'before' };

            // ----- Google Drive URL Converter (reuses gallery logic) -----
            function heroExtractDriveFileId(url) {
                if (!url || typeof url !== 'string') return null;
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

            function heroToEmbedUrl(fileId) {
                return `https://lh3.googleusercontent.com/d/${fileId}`;
            }

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

                const fileId = heroExtractDriveFileId(raw);
                if (fileId) {
                    heroConvertedUrl = heroToEmbedUrl(fileId);
                    hEl.urlStatus.textContent = '✅ Valid Google Drive URL detected';
                    hEl.urlStatus.className = 'gallery-url-status valid';
                    setHidden(hEl.urlStatus, false);
                    hEl.preview.textContent = '';
                    const img = document.createElement('img');
                    img.alt = 'Preview';
                    img.src = heroConvertedUrl;
                    img.addEventListener('error', () => {
                        hEl.preview.textContent = '';
                        const msg = document.createElement('span');
                        msg.className = 'text-muted-2';
                        msg.style.fontSize = '0.7rem';
                        msg.style.padding = '0.5rem';
                        msg.textContent = 'Could not load preview';
                        hEl.preview.appendChild(msg);
                    }, { once: true });
                    hEl.preview.appendChild(img);
                    setHidden(hEl.preview, false);
                } else {
                    heroConvertedUrl = null;
                    hEl.urlStatus.textContent = '⚠️ Could not detect a Google Drive file ID';
                    hEl.urlStatus.className = 'gallery-url-status invalid';
                    setHidden(hEl.urlStatus, false);
                    setHidden(hEl.preview, true);
                }
            }

            hEl.urlInput.addEventListener('input', handleHeroUrlInput);
            hEl.urlInput.addEventListener('paste', () => setTimeout(handleHeroUrlInput, 50));

            // ----- Show Hero Message -----
            function showHeroMsg(text, isError) {
                hEl.message.textContent = text;
                hEl.message.className = 'gallery-msg ' + (isError ? 'error' : 'success');
                setHidden(hEl.message, false);
                setTimeout(() => setHidden(hEl.message, true), 5000);
            }

            // ----- Add Hero Slide -----
            hEl.form.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!db || !adminCode) return;

                const imgUrl = heroConvertedUrl;
                if (!imgUrl) {
                    showHeroMsg('Please paste a valid Google Drive image URL.', true);
                    return;
                }

                hEl.addBtn.disabled = true;
                hEl.addBtn.textContent = 'Adding...';

                try {
                    const { data, error } = await db.rpc('admin_add_hero_slide', {
                        p_admin_code: adminCode,
                        p_img_url: imgUrl
                    });

                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showHeroMsg(data?.error || 'Failed to add slide', true);
                        return;
                    }

                    showHeroMsg('Slide added! Visitors will see it on page refresh.', false);
                    hEl.form.reset();
                    heroConvertedUrl = null;
                    setHidden(hEl.urlStatus, true);
                    setHidden(hEl.preview, true);
                    loadHeroItems();
                } catch (err) {
                    showHeroMsg('Error: ' + err.message, true);
                } finally {
                    hEl.addBtn.disabled = false;
                    hEl.addBtn.textContent = 'Add Slide';
                }
            });

            // ----- Load Hero Items -----
            async function loadHeroItems() {
                if (!db || !adminCode) return;

                try {
                    const { data, error } = await db.rpc('admin_list_hero_slides', {
                        p_admin_code: adminCode
                    });

                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        hEl.list.textContent = '';
                        const p = document.createElement('p');
                        p.className = 'text-danger';
                        p.style.fontSize = '0.85rem';
                        p.textContent = String(data?.error || 'Failed to load');
                        hEl.list.appendChild(p);
                        return;
                    }

                    heroItems = data.items || [];
                    renderHeroItems();
                    heroLoaded = true;
                } catch (err) {
                    hEl.list.textContent = '';
                    const p = document.createElement('p');
                    p.className = 'text-danger';
                    p.style.fontSize = '0.85rem';
                    p.textContent = 'Error: ' + String(err?.message || err || 'Unknown error');
                    hEl.list.appendChild(p);
                }
            }

            // ----- Render Hero Items -----
            function renderHeroItems() {
                const active = heroItems.filter(i => i.is_active).length;
                const total = heroItems.length;
                hEl.count.textContent = `${active} active / ${total} total slides`;

                if (total === 0) {
                    hEl.list.textContent = '';
                    const p = document.createElement('p');
                    p.className = 'text-muted-2';
                    p.style.fontSize = '0.85rem';
                    p.textContent = 'No hero slides yet. Add your first slide above!';
                    hEl.list.appendChild(p);
                    return;
                }

                hEl.list.textContent = '';
                const fragment = document.createDocumentFragment();

                for (const item of heroItems) {
                    const isActive = Boolean(item.is_active);
                    const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    const flashClass = String(item.id) === String(heroLastMovedId) ? ' flash' : '';

                    const row = document.createElement('div');
                    row.className = 'gallery-item ' + (isActive ? '' : 'inactive') + flashClass;
                    row.setAttribute('data-hero-id', String(item.id));

                    const handle = document.createElement('span');
                    handle.className = 'drag-handle';
                    handle.title = 'Drag to reorder';
                    handle.textContent = '⠿';

                    const thumb = document.createElement('div');
                    thumb.className = 'gallery-item-thumb';
                    if (typeof item.img_url === 'string' && item.img_url.startsWith('http')) {
                        const img = document.createElement('img');
                        img.loading = 'lazy';
                        img.alt = 'Hero slide';
                        img.src = item.img_url;
                        img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
                        thumb.appendChild(img);
                    } else {
                        const fallback = document.createElement('span');
                        fallback.style.display = 'flex';
                        fallback.style.alignItems = 'center';
                        fallback.style.justifyContent = 'center';
                        fallback.style.height = '100%';
                        fallback.style.fontSize = '1.2rem';
                        fallback.textContent = '🖼️';
                        thumb.appendChild(fallback);
                    }

                    const info = document.createElement('div');
                    info.className = 'gallery-item-info';
                    const title = document.createElement('div');
                    title.className = 'gallery-item-title';
                    // Truncate the URL for display
                    const shortUrl = item.img_url.length > 50 ? item.img_url.substring(0, 50) + '…' : item.img_url;
                    title.textContent = shortUrl;
                    title.title = item.img_url;
                    const meta = document.createElement('div');
                    meta.className = 'gallery-item-meta';
                    meta.textContent = 'Added ' + date;
                    info.append(title, meta);

                    const sortInput = document.createElement('input');
                    sortInput.type = 'number';
                    sortInput.className = 'gallery-sort-input';
                    sortInput.min = '1';
                    sortInput.max = '9999';
                    sortInput.title = 'Position (1 = first)';
                    sortInput.setAttribute('data-hero-action', 'sort');
                    sortInput.setAttribute('data-hero-id', String(item.id));
                    sortInput.setAttribute('aria-label', 'Sort order for hero slide');
                    const safeSort = Number.isFinite(Number(item.sort_order)) ? Math.max(1, Number(item.sort_order)) : 1;
                    sortInput.value = String(safeSort);

                    const actions = document.createElement('div');
                    actions.className = 'gallery-item-actions';

                    const toggleBtn = document.createElement('button');
                    toggleBtn.className = 'mini-btn gallery-item-badge ' + (isActive ? 'active' : 'hidden');
                    toggleBtn.setAttribute('role', 'switch');
                    toggleBtn.setAttribute('aria-checked', String(isActive));
                    toggleBtn.setAttribute('data-hero-action', 'toggle');
                    toggleBtn.setAttribute('data-hero-id', String(item.id));
                    toggleBtn.title = 'Click to ' + (isActive ? 'hide' : 'show');
                    toggleBtn.textContent = isActive ? '👁️' : '🚫';

                    const editBtn = document.createElement('button');
                    editBtn.className = 'mini-btn secondary';
                    editBtn.setAttribute('data-hero-action', 'edit');
                    editBtn.setAttribute('data-hero-id', String(item.id));
                    editBtn.title = 'Edit URL';
                    editBtn.textContent = '✏️';

                    const delBtn = document.createElement('button');
                    delBtn.className = 'mini-btn danger';
                    delBtn.setAttribute('data-hero-action', 'delete');
                    delBtn.setAttribute('data-hero-id', String(item.id));
                    delBtn.title = 'Delete permanently';
                    delBtn.textContent = '🗑️';

                    actions.append(toggleBtn, editBtn, delBtn);
                    row.append(handle, thumb, info, sortInput, actions);
                    fragment.appendChild(row);
                }

                hEl.list.appendChild(fragment);

                if (heroLastMovedId !== null) {
                    setTimeout(() => { heroLastMovedId = null; }, 0);
                }
            }

            // ----- Toggle Hero Slide -----
            async function toggleHeroSlide(id, btn) {
                if (!db || !adminCode) return;
                btn.disabled = true;
                try {
                    const { data, error } = await db.rpc('admin_toggle_hero_slide', {
                        p_admin_code: adminCode,
                        p_slide_id: parseInt(id, 10)
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showHeroMsg(data?.error || 'Toggle failed', true);
                        return;
                    }
                    showHeroMsg(data.is_active ? 'Slide is now visible' : 'Slide hidden from visitors', false);
                    loadHeroItems();
                } catch (err) {
                    showHeroMsg('Error: ' + err.message, true);
                } finally {
                    btn.disabled = false;
                }
            }

            // ----- Delete Hero Slide (double-click to confirm) -----
            async function deleteHeroSlide(id, btn) {
                if (!heroDeletePending.has(id)) {
                    heroDeletePending.set(id, true);
                    btn.textContent = '⚠️ Sure?';
                    btn.classList.remove('danger');
                    btn.classList.add('confirm-armed');
                    setTimeout(() => {
                        if (heroDeletePending.has(id)) {
                            heroDeletePending.delete(id);
                            btn.textContent = '🗑️';
                            btn.classList.remove('confirm-armed');
                            btn.classList.add('danger');
                        }
                    }, HERO_DELETE_MS);
                    return;
                }

                heroDeletePending.delete(id);
                btn.disabled = true;
                btn.textContent = '...';

                try {
                    const { data, error } = await db.rpc('admin_delete_hero_slide', {
                        p_admin_code: adminCode,
                        p_slide_id: parseInt(id, 10)
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showHeroMsg(data?.error || 'Delete failed', true);
                        return;
                    }
                    showHeroMsg('Slide deleted permanently', false);
                    loadHeroItems();
                } catch (err) {
                    showHeroMsg('Error: ' + err.message, true);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '🗑️';
                    btn.classList.remove('confirm-armed');
                    btn.classList.add('danger');
                }
            }

            // ----- Edit Hero Slide (inline URL edit modal) -----
            let heroEditOverlay = null;
            let heroEditConvertedUrl = null;
            let heroEditEscHandler = null;

            function openHeroEditModal(id) {
                const item = heroItems.find(i => String(i.id) === String(id));
                if (!item) return;

                if (heroEditOverlay) heroEditOverlay.remove();
                heroEditConvertedUrl = null;

                heroEditOverlay = document.createElement('div');
                heroEditOverlay.className = 'gallery-edit-overlay';
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

                const urlInput = heroEditOverlay.querySelector('#heroEditUrl');
                const urlStatus = heroEditOverlay.querySelector('#heroEditUrlStatus');
                const previewImg = heroEditOverlay.querySelector('#heroEditPreviewImg');
                const previewSubtext = heroEditOverlay.querySelector('#heroEditPreviewSubtext');
                const editMessage = heroEditOverlay.querySelector('#heroEditMessage');

                urlInput.value = String(item.img_url || '');
                previewSubtext.textContent = item.is_active ? '✅ Visible on site' : '🚫 Hidden from site';

                // Set preview image
                previewImg.textContent = '';
                if (typeof item.img_url === 'string' && item.img_url.startsWith('http')) {
                    const img = document.createElement('img');
                    img.alt = 'Current slide';
                    img.src = item.img_url;
                    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
                    previewImg.appendChild(img);
                }

                function handleHeroEditUrlInput() {
                    const raw = urlInput.value.trim();
                    if (!raw) {
                        urlStatus.classList.add('is-hidden');
                        heroEditConvertedUrl = null;
                        return;
                    }
                    const fileId = heroExtractDriveFileId(raw);
                    if (fileId) {
                        const embedUrl = heroToEmbedUrl(fileId);
                        heroEditConvertedUrl = embedUrl;
                        urlStatus.textContent = '✅ Google Drive link converted';
                        urlStatus.className = 'gallery-url-status valid';
                        previewImg.textContent = '';
                        const img = document.createElement('img');
                        img.alt = 'Preview';
                        img.src = embedUrl;
                        img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
                        previewImg.appendChild(img);
                    } else {
                        heroEditConvertedUrl = null;
                        if (raw.startsWith('http')) {
                            urlStatus.textContent = '✅ Direct URL detected';
                            urlStatus.className = 'gallery-url-status valid';
                            previewImg.textContent = '';
                            const img = document.createElement('img');
                            img.alt = 'Preview';
                            img.src = raw;
                            img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
                            previewImg.appendChild(img);
                        } else {
                            urlStatus.textContent = '⚠️ Invalid URL format';
                            urlStatus.className = 'gallery-url-status invalid';
                        }
                    }
                }

                urlInput.addEventListener('input', handleHeroEditUrlInput);
                urlInput.addEventListener('paste', () => setTimeout(handleHeroEditUrlInput, 50));

                urlInput.focus();
                urlInput.select();

                heroEditOverlay.addEventListener('click', (ev) => {
                    if (ev.target === heroEditOverlay) closeHeroEditModal();
                });
                heroEditOverlay.querySelector('#heroEditCancelBtn').addEventListener('click', closeHeroEditModal);

                // Focus trap
                const modal = heroEditOverlay.querySelector('.gallery-edit-modal');
                modal.addEventListener('keydown', (ev) => {
                    if (ev.key !== 'Tab') return;
                    const focusable = modal.querySelectorAll(
                        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
                    document.removeEventListener('keydown', heroEditEscHandler);
                }
                heroEditEscHandler = (ev) => {
                    if (ev.key === 'Escape') closeHeroEditModal();
                };
                document.addEventListener('keydown', heroEditEscHandler);

                function showHeroEditMessage(text, isError) {
                    editMessage.textContent = text;
                    editMessage.className = isError ? 'gallery-edit-message error' : 'gallery-edit-message success';
                    editMessage.classList.remove('is-hidden');
                    setTimeout(() => editMessage.classList.add('is-hidden'), 4000);
                }

                heroEditOverlay.querySelector('#heroEditForm').addEventListener('submit', async (ev) => {
                    ev.preventDefault();
                    const newUrl = heroEditConvertedUrl || urlInput.value.trim();
                    if (!newUrl) { showHeroEditMessage('Image URL is required.', true); return; }

                    const saveBtn = heroEditOverlay.querySelector('#heroEditSaveBtn');
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Saving...';

                    try {
                        const { data, error } = await db.rpc('admin_edit_hero_slide', {
                            p_admin_code: adminCode,
                            p_slide_id: parseInt(id, 10),
                            p_img_url: newUrl
                        });
                        if (error) throw new Error(error.message);
                        if (!data || !data.success) {
                            showHeroEditMessage(data?.error || 'Update failed', true);
                            saveBtn.disabled = false;
                            saveBtn.textContent = 'Save Changes';
                            return;
                        }
                        showHeroEditMessage('✅ Slide updated!', false);
                        setTimeout(() => {
                            closeHeroEditModal();
                            loadHeroItems();
                        }, 1000);
                    } catch (err) {
                        showHeroEditMessage('Error: ' + err.message, true);
                        saveBtn.disabled = false;
                        saveBtn.textContent = 'Save Changes';
                    }
                });
            }

            function closeHeroEditModal() {
                if (heroEditEscHandler) {
                    document.removeEventListener('keydown', heroEditEscHandler);
                    heroEditEscHandler = null;
                }
                if (heroEditOverlay) {
                    heroEditOverlay.remove();
                    heroEditOverlay = null;
                }
            }

            // ----- Event Delegation for Hero List -----
            hEl.list.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const action = btn.getAttribute('data-hero-action');
                const id = btn.getAttribute('data-hero-id');
                if (!action || !id) return;

                if (action === 'toggle') toggleHeroSlide(id, btn);
                if (action === 'edit') openHeroEditModal(id);
                if (action === 'delete') deleteHeroSlide(id, btn);
            });

            // ----- Quiet Background Sync -----
            async function heroSyncSortOrders() {
                if (!db || !adminCode) return;
                try {
                    const { data, error } = await db.rpc('admin_list_hero_slides', {
                        p_admin_code: adminCode
                    });
                    if (error || !data || !data.success) return;
                    const serverItems = data.items || [];
                    const serverMap = new Map(serverItems.map(i => [String(i.id), i]));
                    heroItems.forEach(item => {
                        const server = serverMap.get(String(item.id));
                        if (server) item.sort_order = server.sort_order;
                    });
                    heroItems.sort((a, b) => a.sort_order - b.sort_order);
                    heroItems.forEach(item => {
                        const input = hEl.list.querySelector(`input.gallery-sort-input[data-hero-id="${item.id}"]`);
                        if (input) input.value = item.sort_order;
                    });
                } catch (_) { /* best-effort */ }
            }

            // ----- Inline Sort-Order Save -----
            async function heroSaveSortOrder(input) {
                const id = input.getAttribute('data-hero-id');
                const item = heroItems.find(i => String(i.id) === String(id));
                if (!item) return;
                let newVal = parseInt(input.value, 10);
                if (isNaN(newVal) || newVal < 1) {
                    input.value = Math.max(1, item.sort_order);
                    return;
                }
                if (newVal === item.sort_order) return;

                input.disabled = true;
                try {
                    const { data, error } = await db.rpc('admin_reorder_hero_slide', {
                        p_admin_code: adminCode,
                        p_item_id: parseInt(id, 10),
                        p_new_sort_order: newVal
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) { showHeroMsg(data?.error || 'Sort update failed', true); return; }
                    showHeroMsg(`Position updated to ${newVal}`, false);
                    loadHeroItems();
                } catch (err) {
                    showHeroMsg('Error: ' + err.message, true);
                } finally {
                    input.disabled = false;
                }
            }

            hEl.list.addEventListener('change', (e) => {
                if (e.target.matches('.gallery-sort-input[data-hero-action="sort"]')) heroSaveSortOrder(e.target);
            });
            hEl.list.addEventListener('keydown', (e) => {
                if (e.target.matches('.gallery-sort-input[data-hero-action="sort"]') && e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur();
                }
            });

            // ----- Drag & Drop Reorder (Desktop + Touch) -----
            let heroDragSrcId = null;
            let heroCurrentDropTarget = null;

            function heroClearDropIndicators() {
                if (!hEl.list) return;
                hEl.list.querySelectorAll('.drag-over, .drop-before, .drop-after').forEach(el => {
                    el.classList.remove('drag-over', 'drop-before', 'drop-after');
                });
                heroCurrentDropTarget = null;
            }

            function heroUpdateDropIndicator(row, clientY) {
                if (!row || row.getAttribute('data-hero-id') === heroDragSrcId) {
                    if (heroCurrentDropTarget) {
                        heroCurrentDropTarget.classList.remove('drag-over', 'drop-before', 'drop-after');
                        heroCurrentDropTarget = null;
                    }
                    heroDragDropTarget.id = null;
                    return;
                }
                const rect = row.getBoundingClientRect();
                const isBefore = (clientY - rect.top) < rect.height / 2;

                if (heroCurrentDropTarget && heroCurrentDropTarget !== row) {
                    heroCurrentDropTarget.classList.remove('drag-over', 'drop-before', 'drop-after');
                }
                heroCurrentDropTarget = row;
                row.classList.remove('drop-before', 'drop-after');
                row.classList.add('drag-over', isBefore ? 'drop-before' : 'drop-after');

                heroDragDropTarget.id = row.getAttribute('data-hero-id');
                heroDragDropTarget.position = isBefore ? 'before' : 'after';
            }

            function heroOptimisticReorder(srcId, tgtId, position) {
                const srcEl = hEl.list.querySelector(`[data-hero-id="${srcId}"]`);
                const tgtEl = hEl.list.querySelector(`[data-hero-id="${tgtId}"]`);
                if (!srcEl || !tgtEl) return;

                if (position === 'before') {
                    tgtEl.parentNode.insertBefore(srcEl, tgtEl);
                } else {
                    tgtEl.parentNode.insertBefore(srcEl, tgtEl.nextSibling);
                }

                srcEl.classList.add('dropped');
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => srcEl.classList.remove('dropped'));
                });

                const srcIdx = heroItems.findIndex(i => String(i.id) === String(srcId));
                const tgtIdx = heroItems.findIndex(i => String(i.id) === String(tgtId));
                if (srcIdx !== -1 && tgtIdx !== -1) {
                    const [moved] = heroItems.splice(srcIdx, 1);
                    const newTgtIdx = heroItems.findIndex(i => String(i.id) === String(tgtId));
                    if (newTgtIdx !== -1) {
                        const insertAt = position === 'before' ? newTgtIdx : newTgtIdx + 1;
                        heroItems.splice(insertAt, 0, moved);
                    }
                    heroItems.forEach((item, i) => { item.sort_order = i + 1; });
                    heroItems.forEach(item => {
                        const input = hEl.list.querySelector(`input.gallery-sort-input[data-hero-id="${item.id}"]`);
                        if (input) input.value = item.sort_order;
                    });
                }
            }

            async function heroPerformDrop() {
                const targetId = heroDragDropTarget.id;
                const targetPosition = heroDragDropTarget.position || 'before';
                heroClearDropIndicators();

                if (!heroDragSrcId || !targetId || heroDragSrcId === targetId) return;

                const snapshot = heroItems.map(i => ({ ...i }));
                heroOptimisticReorder(heroDragSrcId, targetId, targetPosition);

                try {
                    const { data, error } = await db.rpc('admin_move_hero_slide', {
                        p_admin_code: adminCode,
                        p_item_id: parseInt(heroDragSrcId, 10),
                        p_target_id: parseInt(targetId, 10),
                        p_position: targetPosition
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showHeroMsg(data?.error || 'Move failed — reverting', true);
                        heroItems = snapshot;
                        renderHeroItems();
                        return;
                    }
                    heroSyncSortOrders();
                } catch (err) {
                    showHeroMsg('Error: ' + (err?.message || err) + ' — reverting', true);
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

                heroDragSrcId = row.getAttribute('data-hero-id');
                heroDragSourceRow = row;
                row.classList.add('dragging');
                document.body.classList.add('is-dragging');

                const rect = row.getBoundingClientRect();
                heroDragOffsetY = clientY - rect.top;
                heroDragClone = row.cloneNode(true);
                heroDragClone.style.cssText =
                    'position:fixed;pointer-events:none;z-index:10000;transition:none;' +
                    'transform:scale(0.97);opacity:0.88;' +
                    'box-shadow:0 8px 25px rgba(0,0,0,0.18);border-radius:8px;' +
                    'width:' + rect.width + 'px;' +
                    'left:' + rect.left + 'px;' +
                    'top:' + rect.top + 'px;';
                document.body.appendChild(heroDragClone);
            }

            function heroMoveDrag(clientX, clientY) {
                if (heroDragClone) {
                    heroDragClone.style.top = (clientY - heroDragOffsetY) + 'px';
                }
                if (heroDragSourceRow) heroDragSourceRow.style.pointerEvents = 'none';
                const elBelow = document.elementFromPoint(clientX, clientY);
                if (heroDragSourceRow) heroDragSourceRow.style.pointerEvents = '';
                const row = elBelow ? elBelow.closest('[data-hero-id]') : null;
                heroUpdateDropIndicator(row, clientY);
            }

            async function heroEndDrag() {
                if (heroDragSourceRow) heroDragSourceRow.classList.remove('dragging');
                if (heroDragClone) { heroDragClone.remove(); heroDragClone = null; }
                document.body.classList.remove('is-dragging');

                await heroPerformDrop();

                heroDragSourceRow = null;
                heroDragSrcId = null;
                heroDragDropTarget.id = null;
                heroDragDropTarget.position = 'before';
            }

            // ——— Mouse events (desktop) ———
            hEl.list.addEventListener('mousedown', (e) => {
                const handle = e.target.closest('.drag-handle');
                if (!handle) return;
                const row = handle.closest('[data-hero-id]');
                if (!row) return;
                e.preventDefault();

                heroStartDrag(row, e.clientX, e.clientY);

                function onMouseMove(ev) {
                    ev.preventDefault();
                    heroMoveDrag(ev.clientX, ev.clientY);
                }

                async function onMouseUp() {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    await heroEndDrag();
                }

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            hEl.list.addEventListener('dragstart', (e) => {
                e.preventDefault();
            });

            // ——— Touch events (mobile / tablet) ———
            hEl.list.addEventListener('touchstart', (e) => {
                const handle = e.target.closest('.drag-handle');
                if (!handle) return;
                const row = handle.closest('[data-hero-id]');
                if (!row) return;

                const touch = e.touches[0];
                heroStartDrag(row, touch.clientX, touch.clientY);
            }, { passive: true });

            hEl.list.addEventListener('touchmove', (e) => {
                if (!heroDragSourceRow) return;
                e.preventDefault();
                const touch = e.touches[0];
                heroMoveDrag(touch.clientX, touch.clientY);
            }, { passive: false });

            hEl.list.addEventListener('touchend', async () => {
                if (!heroDragSourceRow) return;
                await heroEndDrag();
            });

            // ----- Load on section open -----
            hEl.section.addEventListener('toggle', () => {
                if (hEl.section.open && !heroLoaded && db && adminCode) {
                    loadHeroItems();
                }
            });
        }

        // ============================================
        // SHOP MANAGER
        // ============================================
        {
            const sEl = {
                section: document.getElementById('shopSection'),
                form: document.getElementById('shopForm'),
                idInput: document.getElementById('shopId'),
                titleInput: document.getElementById('shopTitle'),
                priceInput: document.getElementById('shopPrice'),
                urlInput: document.getElementById('shopUrl'),

                mediaInput: document.getElementById('shopMedia'),
                activeCheckbox: document.getElementById('shopActive'),
                preview: document.getElementById('shopPreview'),
                saveBtn: document.getElementById('shopSaveBtn'),
                cancelBtn: document.getElementById('shopCancelBtn'),
                message: document.getElementById('shopMessage'),
                list: document.getElementById('shopList'),
                count: document.getElementById('shopCount'),
                // Page titles editor
                pageTitlesList: document.getElementById('shopPageTitlesList'),
                addPageTitleBtn: document.getElementById('shopAddPageTitleBtn'),
                savePageTitlesBtn: document.getElementById('shopSavePageTitlesBtn'),
                pageTitlesMsg: document.getElementById('shopPageTitlesMsg')
            };

            let shopLoaded = false;
            let shopItems = [];
            let shopLastMovedId = null;
            const shopDeletePending = new Map();
            const SHOP_DELETE_MS = 3000;
            const shopDragDropTarget = { id: null, position: 'before' };

            // ----- Google Drive URL Converter -----
            function shopExtractDriveFileId(url) {
                if (!url || typeof url !== 'string') return null;
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

            function shopToEmbedUrl(fileId) {
                return `https://lh3.googleusercontent.com/d/${fileId}`;
            }

            function shopConvertMediaUrl(url) {
                const fileId = shopExtractDriveFileId(url);
                return fileId ? shopToEmbedUrl(fileId) : url;
            }

            function parseMediaUrls(text) {
                return text.split('\n')
                    .map(u => u.trim())
                    .filter(Boolean)
                    .map(u => shopConvertMediaUrl(u));
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
                    sEl.preview.textContent = '';
                    const grid = document.createElement('div');
                    grid.className = 'shop-media-grid';
                    for (const url of urls.slice(0, 6)) {
                        const cell = document.createElement('div');
                        cell.className = 'shop-media-cell';
                        if (isVideoUrl(url)) {
                            const vid = document.createElement('video');
                            vid.src = url;
                            vid.muted = true;
                            vid.loop = true;
                            vid.playsInline = true;
                            vid.autoplay = true;
                            cell.appendChild(vid);
                        } else {
                            const img = document.createElement('img');
                            img.alt = 'Media preview';
                            img.src = url;
                            img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
                            cell.appendChild(img);
                        }
                        grid.appendChild(cell);
                    }
                    if (urls.length > 6) {
                        const more = document.createElement('div');
                        more.className = 'shop-media-cell shop-media-more';
                        more.textContent = `+${urls.length - 6} more`;
                        grid.appendChild(more);
                    }
                    sEl.preview.appendChild(grid);
                    setHidden(sEl.preview, false);
                }, 400);
            }

            sEl.mediaInput.addEventListener('input', updateMediaPreview);
            sEl.mediaInput.addEventListener('paste', () => setTimeout(updateMediaPreview, 50));

            // ----- Show Shop Message -----
            function showShopMsg(text, isError) {
                sEl.message.textContent = text;
                sEl.message.className = 'gallery-msg ' + (isError ? 'error' : 'success');
                setHidden(sEl.message, false);
                setTimeout(() => setHidden(sEl.message, true), 5000);
            }

            // ----- Reset Form -----
            function resetShopForm() {
                sEl.form.reset();
                sEl.idInput.value = '';
                sEl.activeCheckbox.checked = true;
                setHidden(sEl.preview, true);
                setHidden(sEl.cancelBtn, true);
                sEl.saveBtn.textContent = 'Save Product';
            }

            // ----- Cancel Edit -----
            sEl.cancelBtn.addEventListener('click', () => {
                resetShopForm();
            });

            // ----- Add / Edit Product -----
            sEl.form.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!db || !adminCode) return;

                const editId = sEl.idInput.value.trim();
                const title = sEl.titleInput.value.trim();
                const priceDisplay = sEl.priceInput.value.trim();
                const etsyUrl = sEl.urlInput.value.trim();
                const mediaUrls = parseMediaUrls(sEl.mediaInput.value);
                const isActive = sEl.activeCheckbox.checked;

                if (!title) { showShopMsg('Product title is required.', true); return; }
                if (!priceDisplay) { showShopMsg('Price display is required.', true); return; }
                if (!etsyUrl) { showShopMsg('Etsy URL is required.', true); return; }
                if (mediaUrls.length === 0) { showShopMsg('At least one media URL is required.', true); return; }

                // Validate Etsy URL
                try {
                    const urlObj = new URL(etsyUrl);
                    if (!urlObj.hostname.includes('etsy.com')) {
                        showShopMsg('Please enter a valid Etsy URL.', true);
                        return;
                    }
                } catch {
                    showShopMsg('Invalid URL format.', true);
                    return;
                }

                sEl.saveBtn.disabled = true;
                sEl.saveBtn.textContent = editId ? 'Updating...' : 'Adding...';

                try {
                    if (editId) {
                        // Edit existing
                        const { data, error } = await db.rpc('admin_edit_shop_item', {
                            p_admin_code: adminCode,
                            p_item_id: parseInt(editId, 10),
                            p_title: title,
                            p_price_display: priceDisplay,
                            p_etsy_url: etsyUrl,
                            p_media: mediaUrls,
                            p_is_active: isActive
                        });
                        if (error) throw new Error(error.message);
                        if (!data || !data.success) {
                            const errMsg = data?.error || 'Update failed';
                            if (errMsg === 'Unauthorized') { adminCode = null; showAuthLockout('Invalid admin code.'); return; }
                            showShopMsg(errMsg, true);
                            return;
                        }
                        showShopMsg('Product updated successfully!', false);
                    } else {
                        // Add new
                        const maxSort = shopItems.length > 0
                            ? Math.max(...shopItems.map(i => i.sort_order || 0))
                            : 0;
                        const nextSort = Math.max(1, maxSort + 1);

                        const { data, error } = await db.rpc('admin_add_shop_item', {
                            p_admin_code: adminCode,
                            p_title: title,
                            p_price_display: priceDisplay,
                            p_etsy_url: etsyUrl,
                            p_media: mediaUrls,
                            p_is_active: isActive,
                            p_sort_order: nextSort
                        });
                        if (error) throw new Error(error.message);
                        if (!data || !data.success) {
                            const errMsg = data?.error || 'Failed to add product';
                            if (errMsg === 'Unauthorized') { adminCode = null; showAuthLockout('Invalid admin code.'); return; }
                            showShopMsg(errMsg, true);
                            return;
                        }
                        showShopMsg('Product added to shop!', false);
                    }

                    resetShopForm();
                    loadShopItems();
                } catch (err) {
                    showShopMsg('Error: ' + err.message, true);
                } finally {
                    sEl.saveBtn.disabled = false;
                    sEl.saveBtn.textContent = 'Save Product';
                }
            });

            // ----- Load Shop Items -----
            async function loadShopItems() {
                if (!db || !adminCode) return;

                try {
                    const { data, error } = await db.rpc('admin_list_shop_items', {
                        p_admin_code: adminCode
                    });

                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        sEl.list.textContent = '';
                        const p = document.createElement('p');
                        p.className = 'text-danger';
                        p.style.fontSize = '0.85rem';
                        p.textContent = String(data?.error || 'Failed to load');
                        sEl.list.appendChild(p);
                        return;
                    }

                    shopItems = data.items || [];
                    renderShopItems();
                    shopLoaded = true;
                    renderPageTitleInputs(); // sync page count with titles
                } catch (err) {
                    sEl.list.textContent = '';
                    const p = document.createElement('p');
                    p.className = 'text-danger';
                    p.style.fontSize = '0.85rem';
                    p.textContent = 'Error: ' + String(err?.message || err || 'Unknown error');
                    sEl.list.appendChild(p);
                }
            }

            // ----- Render Shop Items -----
            function renderShopItems() {
                const active = shopItems.filter(i => i.is_active).length;
                const total = shopItems.length;
                sEl.count.textContent = `${active} active / ${total} total products`;

                if (total === 0) {
                    sEl.list.textContent = '';
                    const p = document.createElement('p');
                    p.className = 'text-muted-2';
                    p.style.fontSize = '0.85rem';
                    p.textContent = 'No shop items yet. Add your first product above!';
                    sEl.list.appendChild(p);
                    return;
                }

                sEl.list.textContent = '';
                const fragment = document.createDocumentFragment();

                for (const item of shopItems) {
                    const isActive = Boolean(item.is_active);
                    const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    const flashClass = String(item.id) === String(shopLastMovedId) ? ' flash' : '';
                    const media = Array.isArray(item.media) ? item.media : [];
                    const thumb = media[0] || '';

                    const row = document.createElement('div');
                    row.className = 'gallery-item ' + (isActive ? '' : 'inactive') + flashClass;
                    row.setAttribute('data-shop-id', String(item.id));

                    const handle = document.createElement('span');
                    handle.className = 'drag-handle';
                    handle.title = 'Drag to reorder';
                    handle.textContent = '\u2847';

                    const thumbEl = document.createElement('div');
                    thumbEl.className = 'gallery-item-thumb';
                    if (thumb && thumb.startsWith('http')) {
                        if (isVideoUrl(thumb)) {
                            const vid = document.createElement('video');
                            vid.src = thumb;
                            vid.muted = true;
                            vid.loop = true;
                            vid.playsInline = true;
                            vid.style.width = '100%';
                            vid.style.height = '100%';
                            vid.style.objectFit = 'cover';
                            thumbEl.appendChild(vid);
                        } else {
                            const img = document.createElement('img');
                            img.loading = 'lazy';
                            img.alt = String(item.title || 'Product');
                            img.src = thumb;
                            img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
                            thumbEl.appendChild(img);
                        }
                    } else {
                        const fallback = document.createElement('span');
                        fallback.style.display = 'flex';
                        fallback.style.alignItems = 'center';
                        fallback.style.justifyContent = 'center';
                        fallback.style.height = '100%';
                        fallback.style.fontSize = '1.2rem';
                        fallback.textContent = '\uD83D\uDECD\uFE0F';
                        thumbEl.appendChild(fallback);
                    }

                    const info = document.createElement('div');
                    info.className = 'gallery-item-info';
                    const titleEl = document.createElement('div');
                    titleEl.className = 'gallery-item-title';
                    titleEl.textContent = item.title || 'Untitled';
                    const metaEl = document.createElement('div');
                    metaEl.className = 'gallery-item-meta';
                    const metaParts = [item.price_display || ''];
                    metaParts.push(`${media.length} media`);
                    metaEl.textContent = metaParts.filter(Boolean).join(' \u00B7 ');
                    info.append(titleEl, metaEl);

                    const sortInput = document.createElement('input');
                    sortInput.type = 'number';
                    sortInput.className = 'gallery-sort-input';
                    sortInput.min = '1';
                    sortInput.max = '9999';
                    sortInput.title = 'Position (1 = first)';
                    sortInput.setAttribute('data-shop-action', 'sort');
                    sortInput.setAttribute('data-shop-id', String(item.id));
                    sortInput.setAttribute('aria-label', 'Sort order for ' + String(item.title || 'Product'));
                    const safeSort = Number.isFinite(Number(item.sort_order)) ? Math.max(1, Number(item.sort_order)) : 1;
                    sortInput.value = String(safeSort);

                    const actions = document.createElement('div');
                    actions.className = 'gallery-item-actions';

                    const toggleBtn = document.createElement('button');
                    toggleBtn.className = 'mini-btn gallery-item-badge ' + (isActive ? 'active' : 'hidden');
                    toggleBtn.setAttribute('role', 'switch');
                    toggleBtn.setAttribute('aria-checked', String(isActive));
                    toggleBtn.setAttribute('data-shop-action', 'toggle');
                    toggleBtn.setAttribute('data-shop-id', String(item.id));
                    toggleBtn.title = 'Click to ' + (isActive ? 'hide' : 'show');
                    toggleBtn.textContent = isActive ? '\uD83D\uDC41\uFE0F' : '\uD83D\uDEAB';

                    const editBtn = document.createElement('button');
                    editBtn.className = 'mini-btn secondary';
                    editBtn.setAttribute('data-shop-action', 'edit');
                    editBtn.setAttribute('data-shop-id', String(item.id));
                    editBtn.title = 'Edit product';
                    editBtn.textContent = '\u270F\uFE0F';

                    const delBtn = document.createElement('button');
                    delBtn.className = 'mini-btn danger';
                    delBtn.setAttribute('data-shop-action', 'delete');
                    delBtn.setAttribute('data-shop-id', String(item.id));
                    delBtn.title = 'Delete permanently';
                    delBtn.textContent = '\uD83D\uDDD1\uFE0F';

                    actions.append(toggleBtn, editBtn, delBtn);
                    row.append(handle, thumbEl, info, sortInput, actions);
                    fragment.appendChild(row);
                }

                sEl.list.appendChild(fragment);

                if (shopLastMovedId !== null) {
                    setTimeout(() => { shopLastMovedId = null; }, 0);
                }
            }

            // ----- Toggle Shop Item -----
            async function toggleShopItem(id, btn) {
                if (!db || !adminCode) return;
                btn.disabled = true;
                try {
                    const { data, error } = await db.rpc('admin_toggle_shop_item', {
                        p_admin_code: adminCode,
                        p_item_id: parseInt(id, 10)
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showShopMsg(data?.error || 'Toggle failed', true);
                        return;
                    }
                    showShopMsg(data.is_active ? 'Product is now visible' : 'Product hidden from shop', false);
                    loadShopItems();
                } catch (err) {
                    showShopMsg('Error: ' + err.message, true);
                } finally {
                    btn.disabled = false;
                }
            }

            // ----- Delete Shop Item (double-click to confirm) -----
            async function deleteShopItem(id, btn) {
                if (!shopDeletePending.has(id)) {
                    shopDeletePending.set(id, true);
                    btn.textContent = '\u26A0\uFE0F Sure?';
                    btn.classList.remove('danger');
                    btn.classList.add('confirm-armed');
                    setTimeout(() => {
                        if (shopDeletePending.has(id)) {
                            shopDeletePending.delete(id);
                            btn.textContent = '\uD83D\uDDD1\uFE0F';
                            btn.classList.remove('confirm-armed');
                            btn.classList.add('danger');
                        }
                    }, SHOP_DELETE_MS);
                    return;
                }

                shopDeletePending.delete(id);
                btn.disabled = true;
                btn.textContent = '...';

                try {
                    const { data, error } = await db.rpc('admin_delete_shop_item', {
                        p_admin_code: adminCode,
                        p_item_id: parseInt(id, 10)
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showShopMsg(data?.error || 'Delete failed', true);
                        return;
                    }
                    showShopMsg('Product deleted permanently', false);
                    loadShopItems();
                } catch (err) {
                    showShopMsg('Error: ' + err.message, true);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '\uD83D\uDDD1\uFE0F';
                    btn.classList.remove('confirm-armed');
                    btn.classList.add('danger');
                }
            }

            // ----- Edit Shop Item (modal) -----
            let shopEditOverlay = null;
            let shopEditEscHandler = null;

            function openShopEditModal(id) {
                const item = shopItems.find(i => String(i.id) === String(id));
                if (!item) return;

                if (shopEditOverlay) shopEditOverlay.remove();

                shopEditOverlay = document.createElement('div');
                shopEditOverlay.className = 'gallery-edit-overlay';
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
                const titleInput = shopEditOverlay.querySelector('#shopEditTitle');
                const priceInput = shopEditOverlay.querySelector('#shopEditPrice');
                const etsyUrlInput = shopEditOverlay.querySelector('#shopEditEtsyUrl');
                const mediaInput = shopEditOverlay.querySelector('#shopEditMedia');
                const sortInput = shopEditOverlay.querySelector('#shopEditSortOrder');
                const activeToggle = shopEditOverlay.querySelector('#shopEditActiveToggle');
                const previewImg = shopEditOverlay.querySelector('#shopEditPreviewImg');
                const previewCaption = shopEditOverlay.querySelector('#shopEditPreviewCaption');
                const previewSubtext = shopEditOverlay.querySelector('#shopEditPreviewSubtext');
                const editMessage = shopEditOverlay.querySelector('#shopEditMessage');

                // Seed values
                const media = Array.isArray(item.media) ? item.media : [];
                titleInput.value = String(item.title || '');
                priceInput.value = String(item.price_display || '');
                etsyUrlInput.value = String(item.etsy_url || '');
                mediaInput.value = media.join('\n');
                sortInput.value = String(Math.max(1, Number(item.sort_order) || 1));

                previewCaption.textContent = `${item.title || 'Untitled'} \u2014 ${item.price_display || ''}`;
                previewSubtext.textContent = item.is_active ? '\u2705 Visible on site' : '\uD83D\uDEAB Hidden from site';

                // Thumbnail preview
                previewImg.textContent = '';
                const thumbUrl = media[0];
                if (thumbUrl && thumbUrl.startsWith('http')) {
                    const img = document.createElement('img');
                    img.alt = 'Product thumbnail';
                    img.src = thumbUrl;
                    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
                    previewImg.appendChild(img);
                }

                // Active toggle
                const initActive = Boolean(item.is_active);
                activeToggle.dataset.active = String(initActive);
                activeToggle.setAttribute('aria-checked', String(initActive));
                activeToggle.className = 'mini-btn gallery-item-badge ' + (initActive ? 'active' : 'hidden');
                activeToggle.textContent = initActive ? '\uD83D\uDC41\uFE0F' : '\uD83D\uDEAB';
                activeToggle.title = 'Click to ' + (initActive ? 'hide' : 'show');

                activeToggle.addEventListener('click', () => {
                    const cur = activeToggle.dataset.active === 'true';
                    const next = !cur;
                    activeToggle.dataset.active = String(next);
                    activeToggle.setAttribute('aria-checked', String(next));
                    activeToggle.className = 'mini-btn gallery-item-badge ' + (next ? 'active' : 'hidden');
                    activeToggle.textContent = next ? '\uD83D\uDC41\uFE0F' : '\uD83D\uDEAB';
                    activeToggle.title = 'Click to ' + (next ? 'hide' : 'show');
                    previewSubtext.textContent = next ? '\u2705 Visible on site' : '\uD83D\uDEAB Hidden from site';
                });

                // Live preview updates
                titleInput.addEventListener('input', () => {
                    previewCaption.textContent = `${titleInput.value.trim() || 'Untitled'} \u2014 ${priceInput.value.trim() || ''}`;
                });
                priceInput.addEventListener('input', () => {
                    previewCaption.textContent = `${titleInput.value.trim() || 'Untitled'} \u2014 ${priceInput.value.trim() || ''}`;
                });

                titleInput.focus();
                titleInput.select();

                // Close handlers
                shopEditOverlay.addEventListener('click', (ev) => {
                    if (ev.target === shopEditOverlay) closeShopEditModal();
                });
                shopEditOverlay.querySelector('#shopEditCancelBtn').addEventListener('click', closeShopEditModal);

                // Focus trap
                const modal = shopEditOverlay.querySelector('.gallery-edit-modal');
                modal.addEventListener('keydown', (ev) => {
                    if (ev.key !== 'Tab') return;
                    const focusable = modal.querySelectorAll(
                        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
                if (shopEditEscHandler) document.removeEventListener('keydown', shopEditEscHandler);
                shopEditEscHandler = (ev) => {
                    if (ev.key === 'Escape') closeShopEditModal();
                };
                document.addEventListener('keydown', shopEditEscHandler);

                // Helper to show inline message
                function showShopEditMessage(text, isError) {
                    editMessage.textContent = text;
                    editMessage.className = isError ? 'gallery-edit-message error' : 'gallery-edit-message success';
                    editMessage.classList.remove('is-hidden');
                    setTimeout(() => editMessage.classList.add('is-hidden'), 4000);
                }

                // Save handler
                shopEditOverlay.querySelector('#shopEditForm').addEventListener('submit', async (ev) => {
                    ev.preventDefault();

                    const newTitle = titleInput.value.trim();
                    const newPrice = priceInput.value.trim();
                    const newEtsyUrl = etsyUrlInput.value.trim();
                    const newMedia = parseMediaUrls(mediaInput.value);
                    const newSort = sortInput.value ? Math.max(1, parseInt(sortInput.value, 10)) : 1;
                    const newActive = activeToggle.dataset.active === 'true';

                    if (!newTitle) { showShopEditMessage('Title is required.', true); return; }
                    if (!newPrice) { showShopEditMessage('Price is required.', true); return; }
                    if (!newEtsyUrl) { showShopEditMessage('Etsy URL is required.', true); return; }
                    if (newMedia.length === 0) { showShopEditMessage('At least one media URL is required.', true); return; }

                    const saveBtn = shopEditOverlay.querySelector('#shopEditSaveBtn');
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Saving...';

                    try {
                        const { data, error } = await db.rpc('admin_edit_shop_item', {
                            p_admin_code: adminCode,
                            p_item_id: parseInt(id, 10),
                            p_title: newTitle,
                            p_price_display: newPrice,
                            p_etsy_url: newEtsyUrl,
                            p_media: newMedia,
                            p_is_active: newActive,
                            p_sort_order: newSort
                        });
                        if (error) throw new Error(error.message);
                        if (!data || !data.success) {
                            showShopEditMessage(data?.error || 'Update failed', true);
                            saveBtn.disabled = false;
                            saveBtn.textContent = 'Save Changes';
                            return;
                        }
                        showShopEditMessage('\u2705 Product updated!', false);
                        setTimeout(() => {
                            closeShopEditModal();
                            loadShopItems();
                        }, 1000);
                    } catch (err) {
                        showShopEditMessage('Error: ' + err.message, true);
                        saveBtn.disabled = false;
                        saveBtn.textContent = 'Save Changes';
                    }
                });
            }

            function closeShopEditModal() {
                if (shopEditEscHandler) {
                    document.removeEventListener('keydown', shopEditEscHandler);
                    shopEditEscHandler = null;
                }
                if (shopEditOverlay) {
                    shopEditOverlay.remove();
                    shopEditOverlay = null;
                }
            }

            // ----- Event Delegation for Shop List -----
            sEl.list.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const action = btn.getAttribute('data-shop-action');
                const id = btn.getAttribute('data-shop-id');
                if (!action || !id) return;

                if (action === 'toggle') toggleShopItem(id, btn);
                if (action === 'edit') openShopEditModal(id);
                if (action === 'delete') deleteShopItem(id, btn);
            });

            // ----- Background Sync -----
            async function shopSyncSortOrders() {
                if (!db || !adminCode) return;
                try {
                    const { data, error } = await db.rpc('admin_list_shop_items', {
                        p_admin_code: adminCode
                    });
                    if (error || !data || !data.success) return;
                    const serverItems = data.items || [];
                    const serverMap = new Map(serverItems.map(i => [String(i.id), i]));
                    shopItems.forEach(item => {
                        const server = serverMap.get(String(item.id));
                        if (server) item.sort_order = server.sort_order;
                    });
                    shopItems.sort((a, b) => a.sort_order - b.sort_order);
                    shopItems.forEach(item => {
                        const input = sEl.list.querySelector(`input.gallery-sort-input[data-shop-id="${item.id}"]`);
                        if (input) input.value = item.sort_order;
                    });
                } catch (_) { /* best-effort */ }
            }

            // ----- Inline Sort-Order Save -----
            async function shopSaveSortOrder(input) {
                const id = input.getAttribute('data-shop-id');
                const item = shopItems.find(i => String(i.id) === String(id));
                if (!item) return;
                let newVal = parseInt(input.value, 10);
                if (isNaN(newVal) || newVal < 1) {
                    input.value = Math.max(1, item.sort_order);
                    return;
                }
                if (newVal === item.sort_order) return;

                input.disabled = true;
                try {
                    const { data, error } = await db.rpc('admin_reorder_shop_item', {
                        p_admin_code: adminCode,
                        p_item_id: parseInt(id, 10),
                        p_new_sort_order: newVal
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) { showShopMsg(data?.error || 'Sort update failed', true); return; }
                    showShopMsg(`Position updated to ${newVal}`, false);
                    loadShopItems();
                } catch (err) {
                    showShopMsg('Error: ' + err.message, true);
                } finally {
                    input.disabled = false;
                }
            }

            sEl.list.addEventListener('change', (e) => {
                if (e.target.matches('.gallery-sort-input[data-shop-action="sort"]')) shopSaveSortOrder(e.target);
            });
            sEl.list.addEventListener('keydown', (e) => {
                if (e.target.matches('.gallery-sort-input[data-shop-action="sort"]') && e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur();
                }
            });

            // ----- Drag & Drop Reorder (Desktop + Touch) -----
            let shopDragSrcId = null;
            let shopCurrentDropTarget = null;

            function shopClearDropIndicators() {
                if (!sEl.list) return;
                sEl.list.querySelectorAll('.drag-over, .drop-before, .drop-after').forEach(el => {
                    el.classList.remove('drag-over', 'drop-before', 'drop-after');
                });
                shopCurrentDropTarget = null;
            }

            function shopUpdateDropIndicator(row, clientY) {
                if (!row || row.getAttribute('data-shop-id') === shopDragSrcId) {
                    if (shopCurrentDropTarget) {
                        shopCurrentDropTarget.classList.remove('drag-over', 'drop-before', 'drop-after');
                        shopCurrentDropTarget = null;
                    }
                    shopDragDropTarget.id = null;
                    return;
                }
                const rect = row.getBoundingClientRect();
                const isBefore = (clientY - rect.top) < rect.height / 2;

                if (shopCurrentDropTarget && shopCurrentDropTarget !== row) {
                    shopCurrentDropTarget.classList.remove('drag-over', 'drop-before', 'drop-after');
                }
                shopCurrentDropTarget = row;
                row.classList.remove('drop-before', 'drop-after');
                row.classList.add('drag-over', isBefore ? 'drop-before' : 'drop-after');

                shopDragDropTarget.id = row.getAttribute('data-shop-id');
                shopDragDropTarget.position = isBefore ? 'before' : 'after';
            }

            function shopOptimisticReorder(srcId, tgtId, position) {
                const srcEl = sEl.list.querySelector(`[data-shop-id="${srcId}"]`);
                const tgtEl = sEl.list.querySelector(`[data-shop-id="${tgtId}"]`);
                if (!srcEl || !tgtEl) return;

                if (position === 'before') {
                    tgtEl.parentNode.insertBefore(srcEl, tgtEl);
                } else {
                    tgtEl.parentNode.insertBefore(srcEl, tgtEl.nextSibling);
                }

                srcEl.classList.add('dropped');
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => srcEl.classList.remove('dropped'));
                });

                const srcIdx = shopItems.findIndex(i => String(i.id) === String(srcId));
                const tgtIdx = shopItems.findIndex(i => String(i.id) === String(tgtId));
                if (srcIdx !== -1 && tgtIdx !== -1) {
                    const [moved] = shopItems.splice(srcIdx, 1);
                    const newTgtIdx = shopItems.findIndex(i => String(i.id) === String(tgtId));
                    if (newTgtIdx !== -1) {
                        const insertAt = position === 'before' ? newTgtIdx : newTgtIdx + 1;
                        shopItems.splice(insertAt, 0, moved);
                    }
                    shopItems.forEach((item, i) => { item.sort_order = i + 1; });
                    shopItems.forEach(item => {
                        const input = sEl.list.querySelector(`input.gallery-sort-input[data-shop-id="${item.id}"]`);
                        if (input) input.value = item.sort_order;
                    });
                }
            }

            async function shopPerformDrop() {
                const targetId = shopDragDropTarget.id;
                const targetPosition = shopDragDropTarget.position || 'before';
                shopClearDropIndicators();

                if (!shopDragSrcId || !targetId || shopDragSrcId === targetId) return;

                const snapshot = shopItems.map(i => ({ ...i }));
                shopOptimisticReorder(shopDragSrcId, targetId, targetPosition);

                try {
                    const { data, error } = await db.rpc('admin_move_shop_item', {
                        p_admin_code: adminCode,
                        p_item_id: parseInt(shopDragSrcId, 10),
                        p_target_id: parseInt(targetId, 10),
                        p_position: targetPosition
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showShopMsg(data?.error || 'Move failed \u2014 reverting', true);
                        shopItems = snapshot;
                        renderShopItems();
                        return;
                    }
                    shopSyncSortOrders();
                } catch (err) {
                    showShopMsg('Error: ' + (err?.message || err) + ' \u2014 reverting', true);
                    shopItems = snapshot;
                    renderShopItems();
                }
            }

            // \u2014\u2014\u2014 Shared pointer drag (mouse + touch) \u2014\u2014\u2014
            let shopDragClone = null;
            let shopDragSourceRow = null;
            let shopDragOffsetY = 0;

            function shopStartDrag(row, clientX, clientY) {
                const sel = window.getSelection();
                if (sel) sel.removeAllRanges();

                shopDragSrcId = row.getAttribute('data-shop-id');
                shopDragSourceRow = row;
                row.classList.add('dragging');
                document.body.classList.add('is-dragging');

                const rect = row.getBoundingClientRect();
                shopDragOffsetY = clientY - rect.top;
                shopDragClone = row.cloneNode(true);
                shopDragClone.style.cssText =
                    'position:fixed;pointer-events:none;z-index:10000;transition:none;' +
                    'transform:scale(0.97);opacity:0.88;' +
                    'box-shadow:0 8px 25px rgba(0,0,0,0.18);border-radius:8px;' +
                    'width:' + rect.width + 'px;' +
                    'left:' + rect.left + 'px;' +
                    'top:' + rect.top + 'px;';
                document.body.appendChild(shopDragClone);
            }

            function shopMoveDrag(clientX, clientY) {
                if (shopDragClone) {
                    shopDragClone.style.top = (clientY - shopDragOffsetY) + 'px';
                }
                if (shopDragSourceRow) shopDragSourceRow.style.pointerEvents = 'none';
                const elBelow = document.elementFromPoint(clientX, clientY);
                if (shopDragSourceRow) shopDragSourceRow.style.pointerEvents = '';
                const row = elBelow ? elBelow.closest('[data-shop-id]') : null;
                shopUpdateDropIndicator(row, clientY);
            }

            async function shopEndDrag() {
                if (shopDragSourceRow) shopDragSourceRow.classList.remove('dragging');
                if (shopDragClone) { shopDragClone.remove(); shopDragClone = null; }
                document.body.classList.remove('is-dragging');

                await shopPerformDrop();

                shopDragSourceRow = null;
                shopDragSrcId = null;
                shopDragDropTarget.id = null;
                shopDragDropTarget.position = 'before';
            }

            // Mouse events (desktop)
            sEl.list.addEventListener('mousedown', (e) => {
                const handle = e.target.closest('.drag-handle');
                if (!handle) return;
                const row = handle.closest('[data-shop-id]');
                if (!row) return;
                e.preventDefault();

                shopStartDrag(row, e.clientX, e.clientY);

                function onMouseMove(ev) {
                    ev.preventDefault();
                    shopMoveDrag(ev.clientX, ev.clientY);
                }

                async function onMouseUp() {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    await shopEndDrag();
                }

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            sEl.list.addEventListener('dragstart', (e) => {
                e.preventDefault();
            });

            // Touch events (mobile / tablet)
            sEl.list.addEventListener('touchstart', (e) => {
                const handle = e.target.closest('.drag-handle');
                if (!handle) return;
                const row = handle.closest('[data-shop-id]');
                if (!row) return;

                const touch = e.touches[0];
                shopStartDrag(row, touch.clientX, touch.clientY);
            }, { passive: true });

            sEl.list.addEventListener('touchmove', (e) => {
                if (!shopDragSourceRow) return;
                e.preventDefault();
                const touch = e.touches[0];
                shopMoveDrag(touch.clientX, touch.clientY);
            }, { passive: false });

            sEl.list.addEventListener('touchend', async () => {
                if (!shopDragSourceRow) return;
                await shopEndDrag();
            });

            // ----- Page Titles Editor -----
            let shopPageTitles = [];

            function renderPageTitleInputs() {
                if (!sEl.pageTitlesList) return;
                sEl.pageTitlesList.innerHTML = '';
                const totalPages = Math.max(1, Math.ceil(shopItems.length / 3));

                // Ensure we have at least as many title slots as pages
                while (shopPageTitles.length < totalPages) shopPageTitles.push('');

                shopPageTitles.forEach((title, idx) => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem;';

                    const label = document.createElement('label');
                    label.textContent = 'Page ' + (idx + 1) + ':';
                    label.style.cssText = 'font-size:0.82rem;min-width:55px;white-space:nowrap;';

                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = title;
                    input.placeholder = '(no title)';
                    input.style.cssText = 'flex:1;font-size:0.85rem;padding:0.25rem 0.4rem;border:1px solid var(--mgmt-border);border-radius:4px;background:var(--mgmt-input-bg);color:var(--mgmt-text);';
                    input.dataset.pageIdx = idx;

                    input.addEventListener('input', () => {
                        shopPageTitles[idx] = input.value;
                    });

                    const removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.textContent = '\u00D7';
                    removeBtn.title = 'Remove page title';
                    removeBtn.className = 'mini-btn danger';
                    removeBtn.addEventListener('click', () => {
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
                sEl.pageTitlesMsg.className = 'gallery-msg ' + (isError ? 'danger' : 'success');
                setHidden(sEl.pageTitlesMsg, false);
                setTimeout(() => setHidden(sEl.pageTitlesMsg, true), 3000);
            }

            async function loadPageTitles() {
                if (!db || !adminCode) return;
                try {
                    const { data, error } = await db.rpc('admin_get_shop_page_titles', {
                        p_admin_code: adminCode
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) return;
                    shopPageTitles = Array.isArray(data.titles) ? data.titles : [];
                    renderPageTitleInputs();
                } catch (err) {
                    console.error('Failed to load page titles:', err);
                }
            }

            if (sEl.addPageTitleBtn) {
                sEl.addPageTitleBtn.addEventListener('click', () => {
                    shopPageTitles.push('');
                    renderPageTitleInputs();
                    // Focus the new input
                    const inputs = sEl.pageTitlesList.querySelectorAll('input');
                    if (inputs.length) inputs[inputs.length - 1].focus();
                });
            }

            if (sEl.savePageTitlesBtn) {
                sEl.savePageTitlesBtn.addEventListener('click', async () => {
                    if (!db || !adminCode) return;
                    sEl.savePageTitlesBtn.disabled = true;
                    sEl.savePageTitlesBtn.textContent = 'Saving...';
                    try {
                        // Trim trailing empty strings
                        const trimmed = shopPageTitles.slice();
                        while (trimmed.length > 0 && !trimmed[trimmed.length - 1].trim()) trimmed.pop();

                        const { data, error } = await db.rpc('admin_set_shop_page_titles', {
                            p_admin_code: adminCode,
                            p_titles: trimmed
                        });
                        if (error) throw new Error(error.message);
                        if (!data || !data.success) {
                            showPageTitlesMsg(data?.error || 'Failed to save', true);
                            return;
                        }
                        shopPageTitles = trimmed;
                        renderPageTitleInputs();
                        showPageTitlesMsg('Page titles saved!', false);
                    } catch (err) {
                        showPageTitlesMsg('Error: ' + err.message, true);
                    } finally {
                        sEl.savePageTitlesBtn.disabled = false;
                        sEl.savePageTitlesBtn.textContent = 'Save Titles';
                    }
                });
            }

            // ----- Load on section open -----
            sEl.section.addEventListener('toggle', () => {
                if (sEl.section.open && !shopLoaded && db && adminCode) {
                    loadShopItems();
                    loadPageTitles();
                }
            });
        }

        // ============================================
        // REVIEW MANAGER
        // ============================================
        {
            const rEl = {
                section: document.getElementById('reviewSection'),
                tabs: document.getElementById('reviewTabs'),
                list: document.getElementById('reviewList'),
                message: document.getElementById('reviewMessage'),
                pendingCount: document.getElementById('reviewPendingCount'),
                approvedCount: document.getElementById('reviewApprovedCount'),
                deletedCount: document.getElementById('reviewDeletedCount')
            };

            let reviewLoaded = false;
            let reviewData = { pending: [], approved: [], deleted: [] };
            let activeReviewTab = 'pending';
            const reviewDeletePending = new Map();
            const REVIEW_DELETE_MS = 3000;

            function showReviewMsg(text, isError) {
                rEl.message.textContent = text;
                rEl.message.className = 'gallery-msg ' + (isError ? 'error' : 'success');
                setHidden(rEl.message, false);
                setTimeout(() => setHidden(rEl.message, true), 5000);
            }

            function setReviewTab(tab) {
                activeReviewTab = tab;
                rEl.tabs.querySelectorAll('.review-tab').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.tab === tab);
                });
                renderReviews();
            }

            rEl.tabs.addEventListener('click', (e) => {
                const btn = e.target.closest('.review-tab');
                if (!btn) return;
                setReviewTab(btn.dataset.tab);
            });

            async function loadReviews() {
                if (!db || !adminCode) return;
                rEl.list.textContent = '';
                const loader = document.createElement('p');
                loader.className = 'text-muted-2';
                loader.style.fontSize = '0.85rem';
                loader.textContent = 'Loading reviews...';
                rEl.list.appendChild(loader);

                try {
                    const { data, error } = await db.rpc('admin_list_reviews', {
                        p_admin_code: adminCode
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        if (data?.error === 'Unauthorized') {
                            adminCode = null;
                            showAuthLockout('Invalid admin code.');
                            return;
                        }
                        throw new Error(data?.error || 'Failed to load reviews');
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
                    rEl.list.textContent = '';
                    const p = document.createElement('p');
                    p.className = 'text-danger';
                    p.style.fontSize = '0.85rem';
                    p.textContent = 'Error: ' + String(err?.message || err);
                    rEl.list.appendChild(p);
                }
            }

            function renderStars(rating) {
                const r = Math.max(1, Math.min(5, Math.floor(Number(rating) || 5)));
                return '⭐'.repeat(r);
            }

            function renderReviews() {
                const items = reviewData[activeReviewTab] || [];
                rEl.list.textContent = '';

                if (items.length === 0) {
                    const p = document.createElement('p');
                    p.className = 'text-muted-2';
                    p.style.fontSize = '0.85rem';
                    p.textContent = activeReviewTab === 'pending'
                        ? 'No pending reviews. All caught up!'
                        : activeReviewTab === 'approved'
                        ? 'No approved reviews yet.'
                        : 'Trash is empty.';
                    rEl.list.appendChild(p);
                    return;
                }

                const fragment = document.createDocumentFragment();
                for (const review of items) {
                    fragment.appendChild(renderReviewCard(review));
                }
                rEl.list.appendChild(fragment);
            }

            function renderReviewCard(review) {
                const card = document.createElement('div');
                card.className = 'review-mgmt-card';
                card.setAttribute('data-review-id', String(review.id));

                // Drag handle (approved tab only)
                if (activeReviewTab === 'approved') {
                    const handle = document.createElement('span');
                    handle.className = 'drag-handle';
                    handle.textContent = '⠿';
                    card.appendChild(handle);
                }

                // Header: name + stars + source
                const header = document.createElement('div');
                header.className = 'review-mgmt-header';

                const nameEl = document.createElement('span');
                nameEl.className = 'review-mgmt-name';
                nameEl.textContent = review.client_name || 'Anonymous';

                const starsEl = document.createElement('span');
                starsEl.className = 'review-mgmt-stars';
                starsEl.textContent = renderStars(review.rating);

                header.append(nameEl, starsEl);

                // Source badge
                const sourceMeta = getSourceMeta(review.source);
                const sourceEl = document.createElement('span');
                sourceEl.className = 'review-mgmt-source';
                sourceEl.textContent = `${sourceMeta.emoji} ${sourceMeta.label}`;

                // Review text
                const textEl = document.createElement('p');
                textEl.className = 'review-mgmt-text';
                textEl.textContent = '"' + (review.review_text || '') + '"';

                // Date
                const dateEl = document.createElement('div');
                dateEl.className = 'review-mgmt-date';
                const date = new Date(review.created_at);
                dateEl.textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
                    ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

                if (activeReviewTab === 'deleted' && review.deleted_at) {
                    const delDate = new Date(review.deleted_at);
                    dateEl.textContent += ' • Deleted ' + delDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }

                // Actions
                const actions = document.createElement('div');
                actions.className = 'review-mgmt-actions';

                if (activeReviewTab === 'pending') {
                    const approveBtn = document.createElement('button');
                    approveBtn.className = 'mini-btn';
                    approveBtn.type = 'button';
                    approveBtn.dataset.reviewAction = 'approve';
                    approveBtn.dataset.reviewId = String(review.id);
                    approveBtn.textContent = '✅ Approve';
                    actions.appendChild(approveBtn);

                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'mini-btn danger';
                    deleteBtn.type = 'button';
                    deleteBtn.dataset.reviewAction = 'delete';
                    deleteBtn.dataset.reviewId = String(review.id);
                    deleteBtn.textContent = '🗑️ Delete';
                    actions.appendChild(deleteBtn);
                } else if (activeReviewTab === 'approved') {
                    const denyBtn = document.createElement('button');
                    denyBtn.className = 'mini-btn secondary';
                    denyBtn.type = 'button';
                    denyBtn.dataset.reviewAction = 'deny';
                    denyBtn.dataset.reviewId = String(review.id);
                    denyBtn.textContent = '⏸️ Unpublish';
                    actions.appendChild(denyBtn);

                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'mini-btn danger';
                    deleteBtn.type = 'button';
                    deleteBtn.dataset.reviewAction = 'delete';
                    deleteBtn.dataset.reviewId = String(review.id);
                    deleteBtn.textContent = '🗑️ Delete';
                    actions.appendChild(deleteBtn);
                } else if (activeReviewTab === 'deleted') {
                    const restoreBtn = document.createElement('button');
                    restoreBtn.className = 'mini-btn secondary';
                    restoreBtn.type = 'button';
                    restoreBtn.dataset.reviewAction = 'restore';
                    restoreBtn.dataset.reviewId = String(review.id);
                    restoreBtn.textContent = '♻️ Restore';
                    actions.appendChild(restoreBtn);

                    const purgeBtn = document.createElement('button');
                    purgeBtn.className = 'mini-btn danger';
                    purgeBtn.type = 'button';
                    purgeBtn.dataset.reviewAction = 'purge';
                    purgeBtn.dataset.reviewId = String(review.id);
                    purgeBtn.textContent = '💀 Purge';
                    actions.appendChild(purgeBtn);
                }

                card.append(header, sourceEl, textEl, dateEl, actions);
                return card;
            }

            // ----- Action Handler (Event Delegation) -----
            rEl.list.addEventListener('click', async (e) => {
                const btn = e.target.closest('button[data-review-action]');
                if (!btn || !db || !adminCode) return;

                const action = btn.dataset.reviewAction;
                const id = parseInt(btn.dataset.reviewId, 10);
                if (!action || isNaN(id)) return;

                const rpcMap = {
                    approve: 'admin_approve_review',
                    deny: 'admin_deny_review',
                    delete: 'admin_delete_review',
                    restore: 'admin_restore_review',
                    purge: 'admin_purge_review'
                };

                const rpcName = rpcMap[action];
                if (!rpcName) return;

                // Two-click confirm for delete & purge
                if (action === 'delete' || action === 'purge') {
                    const key = `${action}-${id}`;
                    if (!reviewDeletePending.has(key)) {
                        reviewDeletePending.set(key, true);
                        btn.textContent = action === 'delete' ? '⚠️ U Sure?' : '⚠️ Purge forever?';
                        btn.classList.remove('danger');
                        btn.classList.add('confirm-armed');
                        setTimeout(() => {
                            if (reviewDeletePending.has(key)) {
                                reviewDeletePending.delete(key);
                                btn.textContent = action === 'delete' ? '🗑️ Delete' : 'Purge';
                                btn.classList.remove('confirm-armed');
                                btn.classList.add('danger');
                            }
                        }, REVIEW_DELETE_MS);
                        return;
                    }
                    reviewDeletePending.delete(key);
                }

                const origText = btn.textContent;
                btn.disabled = true;
                btn.textContent = '...';

                try {
                    const { data, error } = await db.rpc(rpcName, {
                        p_admin_code: adminCode,
                        p_review_id: id
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        if (data?.error === 'Unauthorized') {
                            adminCode = null;
                            showAuthLockout('Invalid admin code.');
                            return;
                        }
                        throw new Error(data?.error || action + ' failed');
                    }

                    const msgs = {
                        approve: 'Review approved and published!',
                        deny: 'Review unpublished (moved to pending)',
                        delete: 'Review moved to trash',
                        restore: 'Review restored to pending',
                        purge: 'Review permanently deleted'
                    };
                    showReviewMsg(msgs[action] || 'Done!', false);
                    await loadReviews();
                } catch (err) {
                    showReviewMsg('Error: ' + err.message, true);
                    btn.disabled = false;
                    btn.textContent = origText;
                }
            });

            // ----- Drag & Drop Reorder for Approved Reviews (Desktop + Touch) -----
            let reviewDragSrcId = null;
            let reviewCurrentDropTarget = null;
            const reviewDragDropTarget = { id: null, position: 'before' };

            function clearReviewDropIndicators() {
                if (!rEl.list) return;
                rEl.list.querySelectorAll('.drag-over, .drop-before, .drop-after').forEach(el => {
                    el.classList.remove('drag-over', 'drop-before', 'drop-after');
                });
                reviewCurrentDropTarget = null;
            }

            function updateReviewDropIndicator(row, clientY) {
                if (!row || row.getAttribute('data-review-id') === reviewDragSrcId) {
                    if (reviewCurrentDropTarget) {
                        reviewCurrentDropTarget.classList.remove('drag-over', 'drop-before', 'drop-after');
                        reviewCurrentDropTarget = null;
                    }
                    reviewDragDropTarget.id = null;
                    return;
                }
                const rect = row.getBoundingClientRect();
                const isBefore = (clientY - rect.top) < rect.height / 2;

                if (reviewCurrentDropTarget && reviewCurrentDropTarget !== row) {
                    reviewCurrentDropTarget.classList.remove('drag-over', 'drop-before', 'drop-after');
                }
                reviewCurrentDropTarget = row;
                row.classList.remove('drop-before', 'drop-after');
                row.classList.add('drag-over', isBefore ? 'drop-before' : 'drop-after');

                reviewDragDropTarget.id = row.getAttribute('data-review-id');
                reviewDragDropTarget.position = isBefore ? 'before' : 'after';
            }

            function optimisticReviewReorder(srcId, tgtId, position) {
                const srcEl = rEl.list.querySelector(`[data-review-id="${srcId}"]`);
                const tgtEl = rEl.list.querySelector(`[data-review-id="${tgtId}"]`);
                if (!srcEl || !tgtEl) return;

                if (position === 'before') {
                    tgtEl.parentNode.insertBefore(srcEl, tgtEl);
                } else {
                    tgtEl.parentNode.insertBefore(srcEl, tgtEl.nextSibling);
                }

                srcEl.classList.add('dropped');
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => srcEl.classList.remove('dropped'));
                });

                // Update local reviewData.approved to match new order
                const items = reviewData.approved;
                const srcIdx = items.findIndex(i => String(i.id) === String(srcId));
                const tgtIdx = items.findIndex(i => String(i.id) === String(tgtId));
                if (srcIdx !== -1 && tgtIdx !== -1) {
                    const [moved] = items.splice(srcIdx, 1);
                    const newTgtIdx = items.findIndex(i => String(i.id) === String(tgtId));
                    if (newTgtIdx !== -1) {
                        const insertAt = position === 'before' ? newTgtIdx : newTgtIdx + 1;
                        items.splice(insertAt, 0, moved);
                    }
                    items.forEach((item, i) => { item.review_sort_order = i + 1; });
                }
            }

            async function performReviewDrop() {
                const targetId = reviewDragDropTarget.id;
                const targetPosition = reviewDragDropTarget.position || 'before';
                clearReviewDropIndicators();

                if (!reviewDragSrcId || !targetId || reviewDragSrcId === targetId) return;

                const snapshot = reviewData.approved.map(i => ({ ...i }));
                optimisticReviewReorder(reviewDragSrcId, targetId, targetPosition);

                try {
                    const { data, error } = await db.rpc('admin_move_review', {
                        p_admin_code: adminCode,
                        p_item_id: parseInt(reviewDragSrcId, 10),
                        p_target_id: parseInt(targetId, 10),
                        p_position: targetPosition
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        showReviewMsg(data?.error || 'Move failed — reverting', true);
                        reviewData.approved = snapshot;
                        renderReviews();
                        return;
                    }
                } catch (err) {
                    showReviewMsg('Error: ' + (err?.message || err) + ' — reverting', true);
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

                reviewDragSrcId = row.getAttribute('data-review-id');
                reviewDragSourceRow = row;
                row.classList.add('dragging');
                document.body.classList.add('is-dragging');

                const rect = row.getBoundingClientRect();
                reviewDragOffsetY = clientY - rect.top;
                reviewDragClone = row.cloneNode(true);
                reviewDragClone.style.cssText =
                    'position:fixed;pointer-events:none;z-index:10000;transition:none;' +
                    'transform:scale(0.97);opacity:0.88;' +
                    'box-shadow:0 8px 25px rgba(0,0,0,0.18);border-radius:8px;' +
                    'width:' + rect.width + 'px;' +
                    'left:' + rect.left + 'px;' +
                    'top:' + rect.top + 'px;';
                document.body.appendChild(reviewDragClone);
            }

            function moveReviewDrag(clientX, clientY) {
                if (reviewDragClone) {
                    reviewDragClone.style.top = (clientY - reviewDragOffsetY) + 'px';
                }
                if (reviewDragSourceRow) reviewDragSourceRow.style.pointerEvents = 'none';
                const elBelow = document.elementFromPoint(clientX, clientY);
                if (reviewDragSourceRow) reviewDragSourceRow.style.pointerEvents = '';
                const row = elBelow ? elBelow.closest('[data-review-id]') : null;
                updateReviewDropIndicator(row, clientY);
            }

            async function endReviewDrag() {
                if (reviewDragSourceRow) reviewDragSourceRow.classList.remove('dragging');
                if (reviewDragClone) { reviewDragClone.remove(); reviewDragClone = null; }
                document.body.classList.remove('is-dragging');

                await performReviewDrop();

                reviewDragSourceRow = null;
                reviewDragSrcId = null;
                reviewDragDropTarget.id = null;
                reviewDragDropTarget.position = 'before';
            }

            // ——— Mouse events (desktop) ———
            rEl.list.addEventListener('mousedown', (e) => {
                if (activeReviewTab !== 'approved') return;
                const handle = e.target.closest('.drag-handle');
                if (!handle) return;
                const row = handle.closest('.review-mgmt-card');
                if (!row) return;
                e.preventDefault();

                startReviewDrag(row, e.clientX, e.clientY);

                function onMouseMove(ev) {
                    ev.preventDefault();
                    moveReviewDrag(ev.clientX, ev.clientY);
                }
                async function onMouseUp() {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    await endReviewDrag();
                }
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            rEl.list.addEventListener('dragstart', (e) => { e.preventDefault(); });

            // ——— Touch events (mobile / tablet) ———
            rEl.list.addEventListener('touchstart', (e) => {
                if (activeReviewTab !== 'approved') return;
                const handle = e.target.closest('.drag-handle');
                if (!handle) return;
                const row = handle.closest('.review-mgmt-card');
                if (!row) return;

                const touch = e.touches[0];
                startReviewDrag(row, touch.clientX, touch.clientY);
            }, { passive: true });

            rEl.list.addEventListener('touchmove', (e) => {
                if (!reviewDragSourceRow) return;
                e.preventDefault();
                const touch = e.touches[0];
                moveReviewDrag(touch.clientX, touch.clientY);
            }, { passive: false });

            rEl.list.addEventListener('touchend', async () => {
                if (!reviewDragSourceRow) return;
                await endReviewDrag();
            });

            // ----- Auto-open from URL hash (#reviews) -----
            function checkReviewHash() {
                if (window.location.hash === '#reviews') {
                    if (rEl.section && !rEl.section.open) {
                        rEl.section.open = true;
                    }
                    if (!reviewLoaded && db && adminCode) {
                        loadReviews();
                    }
                }
            }

            window.addEventListener('hashchange', checkReviewHash);

            // ----- Load on section open -----
            rEl.section.addEventListener('toggle', () => {
                if (rEl.section.open && !reviewLoaded && db && adminCode) {
                    loadReviews();
                }
            });

            // Check hash on init (for Discord deep-link)
            checkReviewHash();
        }

        // ============================================
        // ABOUT PAGE EDITOR
        // ============================================
        {
            const aEl = {
                section: document.getElementById('aboutSection'),
                form: document.getElementById('aboutForm'),
                photoUrl: document.getElementById('aboutPhotoUrl'),
                urlStatus: document.getElementById('aboutUrlStatus'),
                photoPreview: document.getElementById('aboutPhotoPreview'),
                bioText: document.getElementById('aboutBioText'),
                saveBtn: document.getElementById('aboutSaveBtn'),
                message: document.getElementById('aboutMessage'),
                previewPhoto: document.getElementById('aboutPreviewPhoto'),
                previewText: document.getElementById('aboutPreviewText')
            };

            let aboutLoaded = false;
            let aboutConvertedUrl = null;

            function showAboutMsg(text, isError) {
                aEl.message.textContent = text;
                aEl.message.className = 'gallery-msg ' + (isError ? 'error' : 'success');
                setHidden(aEl.message, false);
                setTimeout(() => setHidden(aEl.message, true), 5000);
            }

            // ----- Google Drive URL Converter (reuses existing logic) -----
            function aboutExtractDriveFileId(url) {
                if (!url || typeof url !== 'string') return null;
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

            function aboutToEmbedUrl(fileId) {
                return `https://lh3.googleusercontent.com/d/${fileId}`;
            }

            function handleAboutUrlInput() {
                const raw = aEl.photoUrl.value.trim();
                if (!raw) {
                    setHidden(aEl.urlStatus, true);
                    setHidden(aEl.photoPreview, true);
                    aboutConvertedUrl = null;
                    return;
                }
                const fileId = aboutExtractDriveFileId(raw);
                if (fileId) {
                    aboutConvertedUrl = aboutToEmbedUrl(fileId);
                    aEl.urlStatus.textContent = '✅ Valid Google Drive URL detected';
                    aEl.urlStatus.className = 'gallery-url-status valid';
                    setHidden(aEl.urlStatus, false);
                    aEl.photoPreview.textContent = '';
                    const img = document.createElement('img');
                    img.alt = 'Photo preview';
                    img.src = aboutConvertedUrl;
                    img.addEventListener('error', () => {
                        aEl.photoPreview.textContent = '';
                        const msg = document.createElement('span');
                        msg.className = 'text-muted-2';
                        msg.style.fontSize = '0.7rem';
                        msg.style.padding = '0.5rem';
                        msg.textContent = 'Could not load preview';
                        aEl.photoPreview.appendChild(msg);
                    }, { once: true });
                    aEl.photoPreview.appendChild(img);
                    setHidden(aEl.photoPreview, false);

                    // Update live preview
                    aEl.previewPhoto.textContent = '';
                    const previewImg = document.createElement('img');
                    previewImg.alt = 'About photo';
                    previewImg.src = aboutConvertedUrl;
                    previewImg.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                    aEl.previewPhoto.appendChild(previewImg);
                } else {
                    aboutConvertedUrl = null;
                    aEl.urlStatus.textContent = '⚠️ Could not detect a Google Drive file ID';
                    aEl.urlStatus.className = 'gallery-url-status invalid';
                    setHidden(aEl.urlStatus, false);
                    setHidden(aEl.photoPreview, true);
                }
            }

            aEl.photoUrl.addEventListener('input', handleAboutUrlInput);
            aEl.photoUrl.addEventListener('paste', () => setTimeout(handleAboutUrlInput, 50));

            // ----- Live bio preview -----
            aEl.bioText.addEventListener('input', () => {
                const val = aEl.bioText.value;
                if (val.trim()) {
                    aEl.previewText.innerHTML = val;
                }
            });

            // ----- Load existing content -----
            async function loadAboutContent() {
                if (!db || !adminCode) return;
                try {
                    const { data, error } = await db.rpc('admin_get_about_content', {
                        p_admin_code: adminCode
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        if (data?.error === 'Unauthorized') {
                            adminCode = null;
                            showAuthLockout('Invalid admin code.');
                            return;
                        }
                        throw new Error(data?.error || 'Failed to load about content');
                    }

                    // Populate form fields
                    if (data.photo_url) {
                        aEl.photoUrl.value = data.photo_url;
                        aboutConvertedUrl = data.photo_url;

                        // Show preview
                        aEl.previewPhoto.textContent = '';
                        const img = document.createElement('img');
                        img.alt = 'About photo';
                        img.src = data.photo_url;
                        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                        img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
                        aEl.previewPhoto.appendChild(img);
                    }

                    if (data.bio_text) {
                        aEl.bioText.value = data.bio_text;
                        aEl.previewText.innerHTML = data.bio_text;
                    }

                    aboutLoaded = true;
                } catch (err) {
                    aEl.previewText.textContent = '';
                    const p = document.createElement('p');
                    p.className = 'text-danger';
                    p.style.fontSize = '0.85rem';
                    p.textContent = 'Error: ' + String(err?.message || err);
                    aEl.previewText.appendChild(p);
                }
            }

            // ----- Save -----
            aEl.form.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!db || !adminCode) return;

                const photoUrl = aboutConvertedUrl || aEl.photoUrl.value.trim();
                const bioText = aEl.bioText.value;

                if (!photoUrl && !bioText) {
                    showAboutMsg('Nothing to save — enter a photo URL or bio text.', true);
                    return;
                }

                aEl.saveBtn.disabled = true;
                aEl.saveBtn.textContent = 'Saving...';

                try {
                    const { data, error } = await db.rpc('admin_set_about_content', {
                        p_admin_code: adminCode,
                        p_photo_url: photoUrl || '',
                        p_bio_text: bioText
                    });
                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        if (data?.error === 'Unauthorized') {
                            adminCode = null;
                            showAuthLockout('Invalid admin code.');
                            return;
                        }
                        showAboutMsg(data?.error || 'Save failed', true);
                        return;
                    }
                    showAboutMsg('About page updated! Visitors will see changes on refresh.', false);
                } catch (err) {
                    showAboutMsg('Error: ' + err.message, true);
                } finally {
                    aEl.saveBtn.disabled = false;
                    aEl.saveBtn.textContent = 'Save Changes';
                }
            });

            // ----- Load on section open -----
            aEl.section.addEventListener('toggle', () => {
                if (aEl.section.open && !aboutLoaded && db && adminCode) {
                    loadAboutContent();
                }
            });
        }

        // ============================================
        // BANNER PARAMETERS
        // ============================================
        {
            Trace.group('BANNER_PARAMS');

            const bEl = {
                section:   document.getElementById('bannerParamsSection'),
                canvas:    document.getElementById('shaderCanvas'),
                overlay:   document.getElementById('bannerPreviewOverlay'),
                wrapper:   document.getElementById('bannerPreviewWrapper'),
                resetBtn:  document.getElementById('reset-params'),
                exportBtn: document.getElementById('export-params'),
                message:   document.getElementById('bannerParamsMessage'),
                // Profile elements
                profilesList:      document.getElementById('profilesList'),
                saveProfileBtn:    document.getElementById('save-profile-btn'),
                saveProfileForm:   document.getElementById('saveProfileForm'),
                profileNameInput:  document.getElementById('profileNameInput'),
                confirmSaveBtn:    document.getElementById('confirmSaveProfile'),
                cancelSaveBtn:     document.getElementById('cancelSaveProfile'),
                profilesMessage:   document.getElementById('profilesMessage')
            };

            /* ── Default values (mirror of WEBGL_CONFIG in webgl.js) ── */
            const BANNER_DEFAULTS = {
                colors: {
                    c0: { r: 0.004, g: 0.569, b: 0.663 },
                    c1: { r: 0.482, g: 0.804, b: 0.796 },
                    c2: { r: 0.988, g: 0.855, b: 0.024 },
                    c3: { r: 0.973, g: 0.561, b: 0.173 },
                    c4: { r: 0.937, g: 0.341, b: 0.553 },
                    background: { r: 1.0, g: 1.0, b: 1.0 }
                },
                thickness: {
                    base: 0.10,
                    stretchMin: 0.8,
                    stretchMax: 1.2,
                    stretchSpeed: 1.3,
                    stretchFrequency: 2.5
                },
                wave: {
                    mainSpeed: 1.0,
                    mainFrequency: 3.0,
                    mainAmplitude: 0.25,
                    secondarySpeed: 1.8,
                    secondaryFreq: 1.1,
                    secondaryAmp: 0.1,
                    horizontalSpeed: 0.7,
                    horizontalFrequency: 2.0,
                    horizontalAmount: 0.25,
                    offsetBlend: 0.3
                },
                twist: {
                    enabled: false,
                    intensity: 0.5
                },
                appearance: {
                    brightness: 1.125,
                    plasticEffect: false,
                    centerSoftness: 0.35,
                    specularPower: 50.0,
                    specularIntensity: 0.75,
                    shadowStrength: 0.1,
                    shadowWidth: 2.0,
                    aaSharpness: 0.5,
                    aaFallback: 0.001
                },
                positioning: {
                    verticalOffset: 0.205,
                    bandCount: 5
                },
                interaction: {
                    hoverSlowdown: 0.1,
                    smoothTime: 0.25
                },
                performance: {
                    supersampleDesktop: 2.5,
                    supersampleMobile: 1.0,
                    mobileBreakpoint: 768,
                    respectDPR: true,
                    pauseWhenHidden: true,
                    maxDeltaTime: 0.05,
                    debugMode: false
                }
            };

            /* ── Map of every control: config path → DOM id ── */
            const PARAM_MAP = [
                // Thickness
                { path: 'thickness.base',             id: 'thickness-base',             type: 'range' },
                { path: 'thickness.stretchMin',       id: 'thickness-stretchMin',       type: 'range' },
                { path: 'thickness.stretchMax',       id: 'thickness-stretchMax',       type: 'range' },
                { path: 'thickness.stretchSpeed',     id: 'thickness-stretchSpeed',     type: 'range' },
                { path: 'thickness.stretchFrequency', id: 'thickness-stretchFrequency', type: 'range' },
                // Wave
                { path: 'wave.mainSpeed',             id: 'wave-mainSpeed',             type: 'range' },
                { path: 'wave.mainFrequency',         id: 'wave-mainFrequency',         type: 'range' },
                { path: 'wave.mainAmplitude',         id: 'wave-mainAmplitude',         type: 'range' },
                { path: 'wave.secondarySpeed',        id: 'wave-secondarySpeed',        type: 'range' },
                { path: 'wave.secondaryFreq',         id: 'wave-secondaryFreq',         type: 'range' },
                { path: 'wave.secondaryAmp',          id: 'wave-secondaryAmp',          type: 'range' },
                { path: 'wave.horizontalSpeed',       id: 'wave-horizontalSpeed',       type: 'range' },
                { path: 'wave.horizontalFrequency',   id: 'wave-horizontalFrequency',   type: 'range' },
                { path: 'wave.horizontalAmount',      id: 'wave-horizontalAmount',      type: 'range' },
                { path: 'wave.offsetBlend',           id: 'wave-offsetBlend',           type: 'range' },
                // World Rotation
                { path: 'twist.enabled',              id: 'twist-enabled',              type: 'checkbox' },
                { path: 'twist.intensity',            id: 'twist-intensity',            type: 'range' },
                // Appearance
                { path: 'appearance.brightness',         id: 'appearance-brightness',         type: 'range' },
                { path: 'appearance.plasticEffect',      id: 'appearance-plasticEffect',      type: 'checkbox' },
                { path: 'appearance.centerSoftness',     id: 'appearance-centerSoftness',     type: 'range' },
                { path: 'appearance.specularPower',      id: 'appearance-specularPower',      type: 'range' },
                { path: 'appearance.specularIntensity',  id: 'appearance-specularIntensity',  type: 'range' },
                { path: 'appearance.shadowStrength',     id: 'appearance-shadowStrength',     type: 'range' },
                { path: 'appearance.shadowWidth',        id: 'appearance-shadowWidth',        type: 'range' },
                { path: 'appearance.aaSharpness',        id: 'appearance-aaSharpness',        type: 'range' },
                { path: 'appearance.aaFallback',         id: 'appearance-aaFallback',         type: 'number' },
                // Positioning
                { path: 'positioning.verticalOffset',    id: 'positioning-verticalOffset',    type: 'range' },
                { path: 'positioning.bandCount',         id: 'positioning-bandCount',         type: 'number' },
                // Interaction
                { path: 'interaction.hoverSlowdown',     id: 'interaction-hoverSlowdown',     type: 'range' },
                { path: 'interaction.smoothTime',        id: 'interaction-smoothTime',        type: 'range' },
                // Performance
                { path: 'performance.supersampleDesktop', id: 'performance-supersampleDesktop', type: 'range' },
                { path: 'performance.supersampleMobile',  id: 'performance-supersampleMobile',  type: 'range' },
                { path: 'performance.mobileBreakpoint',   id: 'performance-mobileBreakpoint',   type: 'number' },
                { path: 'performance.respectDPR',         id: 'performance-respectDPR',         type: 'checkbox' },
                { path: 'performance.pauseWhenHidden',    id: 'performance-pauseWhenHidden',    type: 'checkbox' },
                { path: 'performance.maxDeltaTime',       id: 'performance-maxDeltaTime',       type: 'range' },
                { path: 'performance.debugMode',          id: 'performance-debugMode',          type: 'checkbox' }
            ];

            /* ── Helpers ── */
            function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
            function getPath(obj, path) {
                const parts = path.split('.');
                let cur = obj;
                for (const p of parts) { cur = cur?.[p]; }
                return cur;
            }
            function setPath(obj, path, val) {
                const parts = path.split('.');
                let cur = obj;
                for (let i = 0; i < parts.length - 1; i++) {
                    if (cur[parts[i]] == null) cur[parts[i]] = {};
                    cur = cur[parts[i]];
                }
                cur[parts[parts.length - 1]] = val;
            }

            /* ── Live config object (mutable, used by preview engine) ── */
            let liveConfig = deepClone(BANNER_DEFAULTS);

            /* ── Sync UI controls from liveConfig ── */
            function syncControls() {
                for (const p of PARAM_MAP) {
                    const val = getPath(liveConfig, p.path);
                    if (val === undefined) continue;
                    if (p.type === 'checkbox') {
                        const el = document.getElementById(p.id);
                        if (el) el.checked = !!val;
                    } else if (p.type === 'range') {
                        const slider = document.getElementById(p.id);
                        const num = document.getElementById(p.id + '-num');
                        if (slider) slider.value = val;
                        if (num) num.value = val;
                    } else {
                        const el = document.getElementById(p.id);
                        if (el) el.value = val;
                    }
                }
            }

            /* ── Read a single control value ── */
            function readControlValue(p) {
                if (p.type === 'checkbox') {
                    const el = document.getElementById(p.id);
                    return el ? el.checked : getPath(BANNER_DEFAULTS, p.path);
                }
                const el = document.getElementById(p.id);
                if (!el) return getPath(BANNER_DEFAULTS, p.path);
                const v = parseFloat(el.value);
                return isNaN(v) ? getPath(BANNER_DEFAULTS, p.path) : v;
            }

            /* ── Read all controls into liveConfig ── */
            function readAllControls() {
                for (const p of PARAM_MAP) {
                    setPath(liveConfig, p.path, readControlValue(p));
                }
            }

            /* ── Debounced preview rebuild ── */
            let rebuildTimer = null;
            function scheduleRebuild() {
                readAllControls();
                clearTimeout(rebuildTimer);
                rebuildTimer = setTimeout(() => { rebuildPreview(); }, 150);
            }

            /* ── Bidirectional slider ↔ number sync ── */
            if (bEl.section) {
                bEl.section.addEventListener('input', (e) => {
                    const el = e.target;
                    if (!el || !el.id) return;

                    // Slider changed → update paired number
                    if (el.type === 'range') {
                        const numEl = document.getElementById(el.id + '-num');
                        if (numEl) numEl.value = el.value;
                    }
                    // Number changed → update paired slider
                    else if (el.type === 'number' && el.id.endsWith('-num')) {
                        const sliderId = el.id.replace(/-num$/, '');
                        const sliderEl = document.getElementById(sliderId);
                        if (sliderEl) sliderEl.value = el.value;
                    }
                    scheduleRebuild();
                });

                // Checkbox toggles fire 'change', not always 'input'
                bEl.section.addEventListener('change', (e) => {
                    if (e.target && e.target.type === 'checkbox') {
                        scheduleRebuild();
                    }
                });
            }

            // ================================================
            // SELF-CONTAINED WEBGL PREVIEW ENGINE
            // ================================================

            /* ── Master Loop Duration (phase-space) ── */
            const PREVIEW_LOOP_SECONDS = 12.0;

            const previewState = {
                gl: null,
                program: null,
                resLoc: null,
                timeLoc: null,
                rafId: null,
                animTime: 0,
                lastTime: 0,
                curSpeed: 1.0,
                targetSpeed: 1.0,
                running: false
            };

            /* ── GLSL float formatter ── */
            function fmtF(num) {
                const n = Math.round(num * 1e6) / 1e6;
                return Number.isInteger(n) ? `${n}.0` : `${n}`;
            }
            function fmtVec3(c) {
                return `vec3(${fmtF(c.r)}, ${fmtF(c.g)}, ${fmtF(c.b)})`;
            }

            /* ── Build fragment shader from liveConfig ── */
            function buildFragmentShader(cfg) {
                const bandMax = cfg.positioning.bandCount - 1;
                const maxWaveAbs = cfg.wave.mainAmplitude
                    + cfg.wave.secondaryAmp
                    + (cfg.wave.horizontalAmount * Math.abs(cfg.wave.offsetBlend));
                const maxRibbonHalfHeight = maxWaveAbs
                    + (cfg.thickness.base * cfg.thickness.stretchMax * cfg.positioning.bandCount)
                    + cfg.appearance.aaFallback;

                const twistEnabled = cfg.twist.enabled;
                const hasDerivatives = true; // dashboard always has OES_standard_derivatives

                // Integer-snapped speeds for seamless phase loop
                const speedMain    = Math.round(cfg.wave.mainSpeed);
                const speedSec     = Math.round(cfg.wave.secondarySpeed);
                const speedHoriz   = Math.round(cfg.wave.horizontalSpeed);
                const speedStretch = Math.round(cfg.thickness.stretchSpeed);
                const speedTwist   = Math.round(cfg.twist.intensity);

                return `
precision highp float;
#extension GL_OES_standard_derivatives : enable

uniform vec2 iResolution;
uniform float iTime;

#define R iResolution
#define T iTime
#define BASE_THICKNESS ${fmtF(cfg.thickness.base)}

vec3 c0 = ${fmtVec3(cfg.colors.c0)};
vec3 c1 = ${fmtVec3(cfg.colors.c1)};
vec3 c2 = ${fmtVec3(cfg.colors.c2)};
vec3 c3 = ${fmtVec3(cfg.colors.c3)};
vec3 c4 = ${fmtVec3(cfg.colors.c4)};
vec3 bg = ${fmtVec3(cfg.colors.background)};

vec3 getColor(int i){
    if(i==0) return c0;
    if(i==1) return c1;
    if(i==2) return c2;
    if(i==3) return c3;
    if(i==4) return c4;
    return vec3(1.0);
}

mat2 rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 uv = (fragCoord - 0.5 * R.xy) / min(R.x, R.y);
  vec3 col = bg;

  // Phase-space time: T is normalized 0→1 phase, convert to radians
  #define TAU 6.28318530718
  float t = T * TAU;

  // Early ribbon rejection (aspect-corrected for min(R.x,R.y) UV normalization)
  ${twistEnabled ? '' : `
  float halfH = ${fmtF(maxRibbonHalfHeight)} * R.y / min(R.x, R.y);
  float ribbonMinY = ${fmtF(cfg.positioning.verticalOffset)} - halfH;
  float ribbonMaxY = ${fmtF(cfg.positioning.verticalOffset)} + halfH;
  if (uv.y < ribbonMinY || uv.y > ribbonMaxY) {
    gl_FragColor = vec4(bg, 1.0);
    return;
  }
  `}

  // World rotation (rotate entire coordinate space, then build ribbon inside it)
  ${twistEnabled ? `
    uv *= rot(t * ${fmtF(speedTwist)});
  ` : ''}

  // Wave motion (integer speeds × phase radians = guaranteed seamless loop)
  float yWave = sin(uv.x * ${fmtF(cfg.wave.mainFrequency)} + t * ${fmtF(speedMain)}) * ${fmtF(cfg.wave.mainAmplitude)}
              + sin(uv.x * ${fmtF(cfg.wave.secondaryFreq)} - t * ${fmtF(speedSec)}) * ${fmtF(cfg.wave.secondaryAmp)};

  float xOffset = sin(t * ${fmtF(speedHoriz)} + uv.y * ${fmtF(cfg.wave.horizontalFrequency)}) * ${fmtF(cfg.wave.horizontalAmount)};

  float stretch = mix(
    ${fmtF(cfg.thickness.stretchMin)},
    ${fmtF(cfg.thickness.stretchMax)},
    0.5 + 0.5 * sin(t * ${fmtF(speedStretch)} + uv.x * ${fmtF(cfg.thickness.stretchFrequency)})
  );

  float bandThickness = BASE_THICKNESS * stretch;
  float offset = (uv.y - yWave) + xOffset * ${fmtF(cfg.wave.offsetBlend)};

  // Mapping (defensive clamp prevents precision blowout)
  float s = clamp((offset + ${fmtF(cfg.positioning.verticalOffset)}) / bandThickness, -100.0, 100.0);

  // AA width (clamped to prevent screen-flooding tearing artifacts)
  ${hasDerivatives ? `
  float aaw = clamp(fwidth(s) * ${fmtF(cfg.appearance.aaSharpness)}, ${fmtF(cfg.appearance.aaFallback)}, 0.35);
  ` : `
  float aaw = ${fmtF(cfg.appearance.aaFallback)};
  `}

  float xi = floor(s);
  float xf = s - xi;

  int iCenter = int(xi);
  int cCenter = int(clamp(float(iCenter), 0.0, ${fmtF(bandMax)}));
  vec3 bandCol;

  if (xf > aaw && xf < (1.0 - aaw)) {
    bandCol = getColor(cCenter);
  } else {
    int cLeft   = int(clamp(float(iCenter - 1), 0.0, ${fmtF(bandMax)}));
    int cRight  = int(clamp(float(iCenter + 1), 0.0, ${fmtF(bandMax)}));

    vec3 colC = getColor(cCenter);
    vec3 colL = getColor(cLeft);
    vec3 colR = getColor(cRight);

    float wL = 1.0 - smoothstep(0.0, aaw, xf);
    float wR = smoothstep(1.0 - aaw, 1.0, xf);
    float w0 = 1.0 - wL - wR;
    bandCol = colC*w0 + colL*wL + colR*wR;
  }

  vec3 shaded = bandCol;

  ${cfg.appearance.plasticEffect ? `
    float dEdge = min(xf, 1.0 - xf);
    float centerFactor = smoothstep(0.0, ${fmtF(cfg.appearance.centerSoftness)}, dEdge);
    shaded = bandCol * mix(${fmtF(cfg.appearance.brightness)}, 1.0, centerFactor);
    float highlight = pow(centerFactor, ${fmtF(cfg.appearance.specularPower)});
    shaded = mix(shaded, vec3(1.0), highlight * ${fmtF(cfg.appearance.specularIntensity)});
    float edgeShadow = 1.0 - smoothstep(0.0, max(aaw * ${fmtF(cfg.appearance.shadowWidth)}, 0.002), xf);
    shaded *= 1.0 - edgeShadow * ${fmtF(cfg.appearance.shadowStrength)};
  ` : `
    shaded = bandCol * ${fmtF(cfg.appearance.brightness)};
  `}

  float inRangeAA = smoothstep(-aaw, 0.0, s) * (1.0 - smoothstep(${fmtF(cfg.positioning.bandCount)}, ${fmtF(cfg.positioning.bandCount)} + aaw, s));
  col = mix(bg, shaded, inRangeAA);

  gl_FragColor = vec4(col, 1.0);
}
`;
            }

            /* ── Compile a single shader ── */
            function compileShaderSrc(gl, src, type) {
                const sh = gl.createShader(type);
                gl.shaderSource(sh, src);
                gl.compileShader(sh);
                if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                    console.error('[BannerPreview] Shader compile error:', gl.getShaderInfoLog(sh));
                    gl.deleteShader(sh);
                    return null;
                }
                return sh;
            }

            /* ── Create a WebGL program ── */
            function createPreviewProgram(gl, vsSrc, fsSrc) {
                const vs = compileShaderSrc(gl, vsSrc, gl.VERTEX_SHADER);
                const fs = compileShaderSrc(gl, fsSrc, gl.FRAGMENT_SHADER);
                if (!vs || !fs) {
                    if (vs) gl.deleteShader(vs);
                    if (fs) gl.deleteShader(fs);
                    return null;
                }
                const prog = gl.createProgram();
                gl.attachShader(prog, vs);
                gl.attachShader(prog, fs);
                gl.linkProgram(prog);
                if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                    console.error('[BannerPreview] Program link error:', gl.getProgramInfoLog(prog));
                    gl.deleteProgram(prog);
                    gl.deleteShader(vs);
                    gl.deleteShader(fs);
                    return null;
                }
                gl.deleteShader(vs);
                gl.deleteShader(fs);
                return prog;
            }

            /* ── Init WebGL context on the preview canvas ── */
            function initPreview() {
                if (!bEl.canvas) return false;

                const glOpts = { alpha: false, antialias: false, powerPreference: 'default' };
                const gl = bEl.canvas.getContext('webgl', glOpts)
                        || bEl.canvas.getContext('experimental-webgl', glOpts);
                if (!gl) {
                    console.warn('[BannerPreview] WebGL not supported');
                    return false;
                }
                gl.getExtension('OES_standard_derivatives');

                previewState.gl = gl;

                // Fullscreen quad
                const buf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
                gl.enableVertexAttribArray(0);
                gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

                previewState.buffer = buf;

                // Build initial program
                const vsSrc = 'attribute vec2 a_position; void main(){ gl_Position = vec4(a_position,0.0,1.0); }';
                const fsSrc = buildFragmentShader(liveConfig);
                const prog = createPreviewProgram(gl, vsSrc, fsSrc);
                if (!prog) return false;

                previewState.program = prog;
                gl.useProgram(prog);
                previewState.resLoc  = gl.getUniformLocation(prog, 'iResolution');
                previewState.timeLoc = gl.getUniformLocation(prog, 'iTime');

                const bgC = liveConfig.colors.background;
                gl.clearColor(bgC.r, bgC.g, bgC.b, 1.0);

                resizePreviewCanvas();

                // Hide overlay
                if (bEl.overlay) {
                    bEl.overlay.style.opacity = '0';
                    bEl.overlay.style.pointerEvents = 'none';
                }

                Trace.log('BANNER_PREVIEW_INIT');
                return true;
            }

            /* ── Rebuild shader program (hot-swap) ── */
            function rebuildShader() {
                const gl = previewState.gl;
                if (!gl) return;
                const vsSrc = 'attribute vec2 a_position; void main(){ gl_Position = vec4(a_position,0.0,1.0); }';
                const fsSrc = buildFragmentShader(liveConfig);
                const newProg = createPreviewProgram(gl, vsSrc, fsSrc);
                if (!newProg) return;
                if (previewState.program) gl.deleteProgram(previewState.program);
                previewState.program = newProg;
                gl.useProgram(newProg);

                // Re-bind attribute (location 0 = a_position)
                gl.bindBuffer(gl.ARRAY_BUFFER, previewState.buffer);
                gl.enableVertexAttribArray(0);
                gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

                previewState.resLoc  = gl.getUniformLocation(newProg, 'iResolution');
                previewState.timeLoc = gl.getUniformLocation(newProg, 'iTime');

                resizePreviewCanvas();
            }

            /* ── Resize canvas to CSS dimensions ── */
            function resizePreviewCanvas() {
                const gl = previewState.gl;
                if (!gl || !bEl.canvas) return;
                const dpr = window.devicePixelRatio || 1;
                const w = Math.max(1, Math.floor(bEl.canvas.clientWidth * dpr));
                const h = Math.max(1, Math.floor(bEl.canvas.clientHeight * dpr));
                if (bEl.canvas.width !== w || bEl.canvas.height !== h) {
                    bEl.canvas.width = w;
                    bEl.canvas.height = h;
                }
                gl.viewport(0, 0, w, h);
                if (previewState.resLoc) gl.uniform2f(previewState.resLoc, w, h);
            }

            /* ── Render one frame with hover slowdown ── */
            function renderPreviewFrame(timestamp) {
                if (!previewState.running) return;
                const gl = previewState.gl;
                if (!gl) return;

                const now = timestamp * 0.001;
                const dt = Math.min(now - previewState.lastTime, 0.05);
                previewState.lastTime = now;

                // Smooth speed transition for hover slowdown
                const tau = Math.max(0.0001, liveConfig.interaction.smoothTime);
                previewState.curSpeed += (previewState.targetSpeed - previewState.curSpeed)
                    * (1.0 - Math.exp(-dt / tau));

                // Phase-space: accumulate real seconds, normalize to 0→1 phase for shader
                previewState.animTime = (previewState.animTime + dt * previewState.curSpeed) % PREVIEW_LOOP_SECONDS;
                const loopPhase = previewState.animTime / PREVIEW_LOOP_SECONDS;

                gl.clear(gl.COLOR_BUFFER_BIT);
                if (previewState.timeLoc) gl.uniform1f(previewState.timeLoc, loopPhase);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

                previewState.rafId = requestAnimationFrame(renderPreviewFrame);
            }

            /* ── Start / stop / rebuild helpers ── */
            function startPreview() {
                if (previewState.running) return;
                previewState.running = true;
                previewState.lastTime = performance.now() * 0.001;
                previewState.rafId = requestAnimationFrame(renderPreviewFrame);
            }
            function stopPreview() {
                previewState.running = false;
                if (previewState.rafId) {
                    cancelAnimationFrame(previewState.rafId);
                    previewState.rafId = null;
                }
            }
            function rebuildPreview() {
                if (!previewState.gl) return;
                rebuildShader();
            }

            /* ── Message flash ── */
            function showBannerMsg(text, type) {
                if (!bEl.message) return;
                bEl.message.textContent = text;
                bEl.message.className = 'gallery-msg ' + (type === 'error' ? 'is-error' : 'is-success');
                bEl.message.classList.remove('is-hidden');
                setTimeout(() => { bEl.message.classList.add('is-hidden'); }, 4000);
            }

            /* ── Build config for publishing (colors excluded) ── */
            function buildPublishConfig() {
                const out = {};
                const groups = ['thickness', 'wave', 'twist', 'appearance', 'positioning', 'interaction', 'performance'];
                for (const g of groups) {
                    if (liveConfig[g]) out[g] = deepClone(liveConfig[g]);
                }
                return out;
            }

            /* ── Load saved config from Supabase ── */
            async function loadBannerConfig() {
                if (!db || !adminCode) return;
                try {
                    const { data, error } = await db.rpc('admin_get_banner_config', {
                        p_admin_code: adminCode
                    });
                    if (error) throw error;
                    if (data?.success && data.config) {
                        const saved = data.config;
                        const groups = ['thickness', 'wave', 'twist', 'appearance', 'positioning', 'interaction', 'performance'];
                        for (const g of groups) {
                            if (saved[g] && typeof saved[g] === 'object' && liveConfig[g]) {
                                for (const key in saved[g]) {
                                    if (key in liveConfig[g]) {
                                        liveConfig[g][key] = saved[g][key];
                                    }
                                }
                            }
                        }
                        Trace.log('BANNER_CONFIG_LOADED');
                    }
                } catch (err) {
                    console.warn('[BannerParams] Failed to load config:', err);
                }
            }

            /* ── Reset button ── */
            if (bEl.resetBtn) {
                bEl.resetBtn.addEventListener('click', () => {
                    liveConfig = deepClone(BANNER_DEFAULTS);
                    syncControls();
                    rebuildPreview();
                    showBannerMsg('Reset to defaults', 'success');
                    Trace.log('BANNER_RESET');
                });
            }

            /* ── Publish button (save to Supabase) ── */
            if (bEl.exportBtn) {
                bEl.exportBtn.addEventListener('click', async () => {
                    if (!db || !adminCode) {
                        showBannerMsg('Not authenticated', 'error');
                        return;
                    }
                    bEl.exportBtn.disabled = true;
                    bEl.exportBtn.textContent = 'Publishing…';
                    try {
                        const payload = buildPublishConfig();
                        const { data, error } = await db.rpc('admin_set_banner_config', {
                            p_admin_code: adminCode,
                            p_config: payload
                        });
                        if (error) throw error;
                        if (!data?.success) throw new Error(data?.error || 'Unknown error');
                        showBannerMsg('Published! Live site will use new config on next load.', 'success');
                        Trace.log('BANNER_PUBLISHED');

                        // Also copy JSON to clipboard as backup
                        try {
                            await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                        } catch (_) { /* clipboard optional */ }
                    } catch (err) {
                        showBannerMsg('Publish failed: ' + (err.message || err), 'error');
                        Trace.log('BANNER_PUBLISH_FAILED', { error: err.message || String(err) });
                    } finally {
                        bEl.exportBtn.disabled = false;
                        bEl.exportBtn.textContent = 'Publish to Site';
                    }
                });
            }

            // ================================================
            // SAVED PROFILES (localStorage)
            // ================================================
            const PROFILES_KEY = 'jossd_banner_profiles';

            function loadProfiles() {
                try {
                    const raw = localStorage.getItem(PROFILES_KEY);
                    return raw ? JSON.parse(raw) : [];
                } catch { return []; }
            }

            function saveProfiles(profiles) {
                localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
            }

            function showProfileMsg(text, type) {
                if (!bEl.profilesMessage) return;
                bEl.profilesMessage.textContent = text;
                bEl.profilesMessage.className = 'gallery-msg ' + (type === 'error' ? 'is-error' : 'is-success');
                bEl.profilesMessage.classList.remove('is-hidden');
                setTimeout(() => { bEl.profilesMessage.classList.add('is-hidden'); }, 3500);
            }

            function fmtDate(ts) {
                const d = new Date(ts);
                return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            }

            function renderProfiles() {
                if (!bEl.profilesList) return;
                const profiles = loadProfiles();

                if (profiles.length === 0) {
                    bEl.profilesList.innerHTML = '<p class="text-muted-2 text-xs profiles-empty">No saved profiles yet. Click \u201c\ud83d\udcbe Save as Profile\u201d below to create one.</p>';
                    return;
                }

                bEl.profilesList.innerHTML = profiles.map((p, i) => `
                    <div class="profile-item" data-profile-idx="${i}">
                        <div class="profile-item-info">
                            <span class="profile-name">${escHTML(p.name)}</span>
                            <span class="profile-date">${fmtDate(p.savedAt)}</span>
                        </div>
                        <div class="profile-item-actions">
                            <button type="button" class="btn-load-profile" data-action="load" data-idx="${i}">Load</button>
                            <button type="button" class="btn-rename-profile" data-action="rename" data-idx="${i}">Rename</button>
                            <button type="button" class="btn-delete-profile" data-action="delete" data-idx="${i}">Delete</button>
                        </div>
                    </div>
                `).join('');
            }

            function escHTML(str) {
                const d = document.createElement('div');
                d.textContent = str;
                return d.innerHTML;
            }

            /* ── Save Profile button → show form ── */
            if (bEl.saveProfileBtn) {
                bEl.saveProfileBtn.addEventListener('click', () => {
                    if (bEl.saveProfileForm) bEl.saveProfileForm.classList.remove('is-hidden');
                    if (bEl.profileNameInput) {
                        bEl.profileNameInput.value = '';
                        bEl.profileNameInput.focus();
                    }
                });
            }

            /* ── Cancel save ── */
            if (bEl.cancelSaveBtn) {
                bEl.cancelSaveBtn.addEventListener('click', () => {
                    if (bEl.saveProfileForm) bEl.saveProfileForm.classList.add('is-hidden');
                });
            }

            /* ── Confirm save ── */
            if (bEl.confirmSaveBtn) {
                bEl.confirmSaveBtn.addEventListener('click', () => {
                    const name = (bEl.profileNameInput?.value || '').trim();
                    if (!name) {
                        showProfileMsg('Please enter a profile name.', 'error');
                        return;
                    }
                    readAllControls();
                    const profiles = loadProfiles();
                    profiles.push({
                        name,
                        savedAt: Date.now(),
                        config: deepClone(liveConfig)
                    });
                    saveProfiles(profiles);
                    renderProfiles();
                    if (bEl.saveProfileForm) bEl.saveProfileForm.classList.add('is-hidden');
                    showProfileMsg(`Profile "${name}" saved.`, 'success');
                    Trace.log('PROFILE_SAVED', { name });
                });
            }

            /* ── Allow Enter key to confirm save ── */
            if (bEl.profileNameInput) {
                bEl.profileNameInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        bEl.confirmSaveBtn?.click();
                    }
                });
            }

            /* ── Profile list actions (delegated) ── */
            if (bEl.profilesList) {
                bEl.profilesList.addEventListener('click', (e) => {
                    const btn = e.target.closest('button[data-action]');
                    if (!btn) return;
                    const action = btn.dataset.action;
                    const idx = parseInt(btn.dataset.idx, 10);
                    const profiles = loadProfiles();
                    if (idx < 0 || idx >= profiles.length) return;

                    if (action === 'load') {
                        const saved = profiles[idx].config;
                        const groups = ['thickness', 'wave', 'twist', 'appearance', 'positioning', 'interaction', 'performance'];
                        for (const g of groups) {
                            if (saved[g] && typeof saved[g] === 'object' && liveConfig[g]) {
                                for (const key in saved[g]) {
                                    if (key in liveConfig[g]) {
                                        liveConfig[g][key] = saved[g][key];
                                    }
                                }
                            }
                        }
                        // Preserve colors from saved profile if present
                        if (saved.colors) liveConfig.colors = deepClone(saved.colors);
                        syncControls();
                        rebuildPreview();
                        showProfileMsg(`Loaded "${profiles[idx].name}".`, 'success');
                        Trace.log('PROFILE_LOADED', { name: profiles[idx].name });
                    }

                    else if (action === 'rename') {
                        const item = btn.closest('.profile-item');
                        const nameSpan = item?.querySelector('.profile-name');
                        if (!nameSpan) return;

                        // Replace name with inline input
                        const currentName = profiles[idx].name;
                        const inp = document.createElement('input');
                        inp.type = 'text';
                        inp.className = 'profile-rename-input';
                        inp.value = currentName;
                        inp.maxLength = 50;
                        nameSpan.replaceWith(inp);
                        inp.focus();
                        inp.select();

                        // Swap Rename button to Confirm
                        btn.textContent = 'OK';
                        btn.dataset.action = 'confirm-rename';

                        const commit = () => {
                            const newName = (inp.value || '').trim() || currentName;
                            profiles[idx].name = newName;
                            saveProfiles(profiles);
                            renderProfiles();
                            showProfileMsg(`Renamed to "${newName}".`, 'success');
                            Trace.log('PROFILE_RENAMED', { oldName: currentName, newName });
                        };

                        inp.addEventListener('keydown', (ev) => {
                            if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
                            if (ev.key === 'Escape') { renderProfiles(); }
                        });
                        inp.addEventListener('blur', () => {
                         

   // Slight delay so click on OK still fires
                            setTimeout(() => {
                                if (document.querySelector('.profile-rename-input')) commit();
                            }, 150);
                        });
                    }

                    else if (action === 'confirm-rename') {
                        const item = btn.closest('.profile-item');
                        const inp = item?.querySelector('.profile-rename-input');
                        const newName = (inp?.value || '').trim() || profiles[idx].name;
                        profiles[idx].name = newName;
                        saveProfiles(profiles);
                        renderProfiles();
                        showProfileMsg(`Renamed to "${newName}".`, 'success');
                    }

                    else if (action === 'delete') {
                        const name = profiles[idx].name;
                        if (!confirm(`Delete profile "${name}"?`)) return;
                        profiles.splice(idx, 1);
                        saveProfiles(profiles);
                        renderProfiles();
                        showProfileMsg(`Deleted "${name}".`, 'success');
                        Trace.log('PROFILE_DELETED', { name });
                    }
                });
            }

            /* ── Render profiles on load ── */
            renderProfiles();

            /* ── Lazy-init on section open ── */
            let bannerInited = false;
            if (bEl.section) {
                bEl.section.addEventListener('toggle', async () => {
                    if (!bEl.section.open) {
                        stopPreview();
                        return;
                    }
                    if (!bannerInited && db && adminCode) {
                        bannerInited = true;
                        await loadBannerConfig();
                        syncControls();
                        if (initPreview()) {
                            startPreview();
                        }
                    } else if (previewState.gl) {
                        startPreview();
                    }
                });
            }

            /* ── Resize listener ── */
            window.addEventListener('resize', () => {
                if (previewState.running) resizePreviewCanvas();
            });

            /* ── Pointer hover slowdown on preview canvas ── */
            if (bEl.wrapper) {
                bEl.wrapper.addEventListener('pointerenter', () => {
                    previewState.targetSpeed = liveConfig.interaction.hoverSlowdown;
                });
                bEl.wrapper.addEventListener('pointerleave', () => {
                    previewState.targetSpeed = 1.0;
                });
            }

            Trace.log('BANNER_PARAMS_READY');
            Trace.groupEnd();
        }

        // Event Delegation for generated links
        if (elements.recentLinksList) {
            elements.recentLinksList.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;

                const action = btn.getAttribute('data-action');
                if (!action) return;

                if (action === 'copy') {
                    const link = btn.getAttribute('data-link');
                    if (link) copyLinkToClipboard(link);
                } else if (action === 'test') {
                    const link = btn.getAttribute('data-link');
                    Trace.log('USER_TEST_CLICK', { link });
                    if (link) openLink(link);
                } else if (action === 'delete') {
                    const id = btn.getAttribute('data-id');
                    if (id) deleteToken(id, btn);
                } else if (action === 'filter') {
                    const source = btn.getAttribute('data-source');
                    Trace.log('USER_FILTER_CLICK', { source });
                    if (source) filterBySource(source);
                }
            });

            elements.recentLinksList.addEventListener('dblclick', (e) => {
                const field = e.target.closest('.link-item-url-field');
                if (!field) return;
                field.focus();
                field.select();
                Trace.log('USER_URL_DBLCLICK', { url: field.value });
            });
        }


    })();