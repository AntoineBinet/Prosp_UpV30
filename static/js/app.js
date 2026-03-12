// v24.2 — Global error safety net
window.addEventListener('unhandledrejection', function(e) {
    console.error("[Prosp'Up] Unhandled promise:", e.reason);
    if (window.showToast) window.showToast('Erreur inattendue', 'error');
});
window.onerror = function(msg, src, line) {
    console.error("[Prosp'Up] Error:", msg, "at", src + ":" + line);
};

// ═══════════════════════════════════════════════════════════════════
// Auth & User Session Module (v15)
// ═══════════════════════════════════════════════════════════════════
const AppAuth = {
    user: null,
    ROLE_LABELS: {admin:'🔑 Admin', editor:'✏️ Éditeur', reader:'👁️ Lecteur'},
    async init() {
        try {
            const r = await fetch('/api/auth/me');
            if (r.status === 401) { window.location.href = '/login'; return; }
            const d = await r.json();
            if (d.ok) this.user = d.user;
        } catch(e) {}
        this._injectBadge();
        this._applyReadOnly();
    },
    _injectBadge() {
        if (!this.user) return;
        const u = this.user;
        const label = this.ROLE_LABELS[u.role] || u.role;
        const name = (typeof escapeHtml === 'function' ? escapeHtml(u.display_name || u.username) : String(u.display_name || u.username || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c)));
        const initial = (u.display_name || u.username || '').charAt(0).toUpperCase();
        const isMobile = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
        const badgeHtml = `
            <div class="user-session-badge">
                <div class="user-session-avatar">${initial}</div>
                <div class="user-session-info">
                    <div class="user-session-name">${name}</div>
                    <div class="user-session-role">${typeof escapeHtml === 'function' ? escapeHtml(label) : label}</div>
                </div>
                <button onclick="AppAuth.logout()" title="Déconnexion" class="user-session-logout">⏻</button>
            </div>`;
        
        // v25: badge utilisateur uniquement dans le header (plus dans la sidebar)
        const _doInject = () => {
            const headerCenter = document.querySelector('.header-center');
            const existingHeaderBadge = headerCenter ? headerCenter.querySelector('.user-session-badge') : null;
            if (existingHeaderBadge) existingHeaderBadge.remove();
            if (headerCenter) {
                headerCenter.insertAdjacentHTML('beforeend', badgeHtml);
                return true;
            }
            return false;
        };
        
        if (_doInject()) return;
        
        let pollInterval = null;
        let eventListener = null;
        let resolved = false;
        const cleanup = () => {
            if (pollInterval) clearInterval(pollInterval);
            if (eventListener) document.removeEventListener('header-layout-ready', eventListener);
            resolved = true;
        };
        const tryInject = () => {
            if (resolved) return;
            if (_doInject()) cleanup();
        };
        document.addEventListener('header-layout-ready', tryInject, { once: true });
        let attempts = 0;
        const maxAttempts = 40;
        pollInterval = setInterval(() => {
            attempts++;
            tryInject();
            if (resolved || attempts >= maxAttempts) cleanup();
        }, 50);
    },
    _applyReadOnly() {
        if (!this.user || this.user.role !== 'reader') return;
        document.body.classList.add('role-reader');
        // Intercept all write requests and show warning
        const origFetch = window.fetch;
        window.fetch = function(url, opts) {
            if (opts && ['POST','PUT','DELETE'].includes((opts.method||'').toUpperCase())) {
                const path = typeof url === 'string' ? url : url.toString();
                if (!path.includes('/api/auth/') && !path.includes('/api/saved-views')) {
                    if (typeof showToast === 'function') showToast('🔒 Accès en lecture seule', 'warning');
                    return Promise.resolve(new Response(JSON.stringify({ok:false,error:'Lecture seule'}), {status:403}));
                }
            }
            return origFetch.apply(this, arguments);
        };
    },
    async logout() {
        await fetch('/api/auth/logout', {method:'POST'});
        window.location.href = '/login';
    }
};

// Ré-injecter le badge utilisateur après chaque reconstruction de la sidebar (sidebar.js écrase le contenu)
document.addEventListener('sidebar-ready', function () {
    if (window.AppAuth && typeof AppAuth._injectBadge === 'function') AppAuth._injectBadge();
});

let _badgeResizeRaf = null;
window.addEventListener('resize', function () {
    if (!window.AppAuth || !AppAuth.user || typeof AppAuth._injectBadge !== 'function') return;
    if (_badgeResizeRaf) cancelAnimationFrame(_badgeResizeRaf);
    _badgeResizeRaf = requestAnimationFrame(function () {
        AppAuth._injectBadge();
        _badgeResizeRaf = null;
    });
});

// ═══════════════════════════════════════════════════════════════════
// Mobile tel: link helper (v15)
// ═══════════════════════════════════════════════════════════════════
function telLink(phone, label) {
    if (!phone) return '';
    const clean = phone.replace(/[^\d+]/g, '');
    const display = label || phone;
    // Always render as link — on desktop it opens phone app, on mobile it dials
    return `<a href="tel:${clean}" class="tel-link" title="Appeler ${display}">📞 ${display}</a>`;
}

const data = {
    companies: [],
    templates: [],
    prospects: [],
    candidates: []
};
let _globalMaxProspectId = null;
let _globalMaxCompanyId = null;

// ====== Persistance serveur locale (Python + SQLite) ======
// Les données sont stockées dans un fichier SQLite sur votre PC via un petit serveur local Python.
// IMPORTANT : ouvrez l'app via http://127.0.0.1:8000 (pas en double-clic).
async function loadFromServer() {
    try {
        const res = await fetch('/api/data');
        if (res.status === 401) {
            window.location.href = '/login';
            return false;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const parsed = await res.json();
        if (!parsed || !Array.isArray(parsed.companies) || !Array.isArray(parsed.prospects)) return false;
        data.companies = parsed.companies;
        data.prospects = parsed.prospects;
        const apiMaxProspectId = Number(parsed.maxProspectId);
        const apiMaxCompanyId = Number(parsed.maxCompanyId);
        _globalMaxProspectId = Number.isFinite(apiMaxProspectId) ? apiMaxProspectId : null;
        _globalMaxCompanyId = Number.isFinite(apiMaxCompanyId) ? apiMaxCompanyId : null;
        return true;
    } catch (err) {
        console.warn('Impossible de charger depuis le serveur local.', err);
        return false;
    }
}


async function loadTemplatesFromServer() {
    try {
        const res = await fetch('/api/templates');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const arr = await res.json();
        data.templates = Array.isArray(arr) ? arr : [];
        return true;
    } catch (err) {
        console.warn('Impossible de charger les templates.', err);
        data.templates = [];
        return false;
    }
}

function getDefaultTemplate() {
    if (!Array.isArray(data.templates)) return null;
    return data.templates.find(t => Number(t.is_default) === 1) || data.templates[0] || null;
}

function getTemplateById(id) {
    if (!Array.isArray(data.templates)) return null;
    const nid = Number(id);
    return data.templates.find(t => Number(t.id) === nid) || null;
}

function saveToServerAsync(opts) {
    opts = opts || {};
    const payload = { companies: data.companies, prospects: data.prospects };
    if (opts.confirmMassDelete) payload.confirm_mass_delete = true;
    return fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(res => {
        if (!res.ok) {
            return res.text().then(t => {
                let msg = t || ('HTTP ' + res.status);
                try { const j = JSON.parse(t); if (j && j.error) msg = j.error; } catch(e) {}
                throw new Error(msg);
            });
        }
        showToast('✓ Sauvegardé', 'success');
    });
}

function saveToServer(opts) {
    saveToServerAsync(opts).catch(err => {
        console.error('Erreur sauvegarde serveur :', err);
        showToast(err && err.message ? err.message : "⚠ Erreur de sauvegarde — vérifiez que app.py est lancé", 'error');
    });
}

// Toast notification system (enhanced v8)
function showToast(msg, type) {
    type = type || 'success';
    if (window.haptic) window.haptic(type === 'error' ? 30 : 10);
    if (window.showToast && window.showToast !== showToast) {
        window.showToast(msg, type);
        return;
    }
    // Fallback if v8-features not loaded yet
    let container = document.getElementById('toastContainer') || document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const colors = { success:'rgba(34,197,94,0.92)', error:'rgba(239,68,68,0.92)', warning:'rgba(245,158,11,0.92)', info:'rgba(59,130,246,0.92)' };
    toast.style.cssText = 'padding:12px 18px;border-radius:14px;color:#fff;font-size:13px;font-weight:500;backdrop-filter:blur(12px);background:' + (colors[type] || colors.info) + ';box-shadow:0 8px 32px rgba(0,0,0,0.35);opacity:0;transform:translateX(40px);transition:all .3s cubic-bezier(.4,0,.2,1);pointer-events:auto;';
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(function() { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; });
    setTimeout(function() {
        toast.style.opacity = '0'; toast.style.transform = 'translateX(40px)';
        setTimeout(function() { toast.remove(); }, 300);
    }, type === 'error' ? 5000 : 3000);
}

// ═══════════════════════════════════════════════════════════════════
// Button Loading & Success Feedback Helpers (v25.1)
// ═══════════════════════════════════════════════════════════════════

/**
 * Set button to loading state with spinner
 * @param {HTMLElement|string} button - Button element or selector
 * @returns {HTMLElement} The button element
 */
function setButtonLoading(button) {
    if (typeof button === 'string') button = document.querySelector(button);
    if (!button) return null;
    
    // Store original content if not already stored
    if (!button.dataset.originalContent) {
        button.dataset.originalContent = button.innerHTML;
    }
    
    // Add loading class and spinner
    button.classList.add('btn-loading');
    button.disabled = true;
    
    // Create spinner if not exists
    let spinner = button.querySelector('.spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.className = 'spinner spinner-small';
        button.appendChild(spinner);
    }
    
    return button;
}

/**
 * Remove loading state from button
 * @param {HTMLElement|string} button - Button element or selector
 * @returns {HTMLElement} The button element
 */
function removeButtonLoading(button) {
    if (typeof button === 'string') button = document.querySelector(button);
    if (!button) return null;
    
    button.classList.remove('btn-loading');
    button.disabled = false;
    
    // Remove spinner
    const spinner = button.querySelector('.spinner');
    if (spinner) spinner.remove();
    
    return button;
}

/**
 * Show success feedback on button (checkmark animation)
 * @param {HTMLElement|string} button - Button element or selector
 * @param {number} duration - Duration in ms (default 1500)
 * @returns {HTMLElement} The button element
 */
function showButtonSuccess(button, duration) {
    duration = duration || 1500;
    if (typeof button === 'string') button = document.querySelector(button);
    if (!button) return null;
    
    // Add success feedback class
    button.classList.add('btn-success-feedback');
    
    // Remove after animation
    setTimeout(() => {
        button.classList.remove('btn-success-feedback');
        // Remove the ::after pseudo-element by forcing a reflow
        button.style.animation = 'none';
        void button.offsetWidth;
        button.style.animation = '';
    }, duration);
    
    return button;
}

/**
 * Wrapper for async functions with automatic loading/success feedback
 * @param {HTMLElement|string} button - Button element or selector
 * @param {Function} asyncFn - Async function to execute
 * @param {Object} options - Options { onSuccess, onError, successDuration, haptic }
 * @returns {Promise} Promise from asyncFn
 */
async function withButtonFeedback(button, asyncFn, options) {
    options = options || {};
    const { onSuccess, onError, successDuration = 1500, haptic = true } = options;
    
    if (typeof button === 'string') button = document.querySelector(button);
    if (!button) {
        console.warn('withButtonFeedback: button not found');
        return asyncFn();
    }
    
    // Haptic feedback on click
    if (haptic && window.haptic) window.haptic(10);
    
    // Set loading state
    setButtonLoading(button);
    
    try {
        const result = await asyncFn();
        
        // Show success feedback
        removeButtonLoading(button);
        showButtonSuccess(button, successDuration);
        
        if (onSuccess) onSuccess(result);
        return result;
    } catch (error) {
        // Remove loading state on error
        removeButtonLoading(button);
        
        if (onError) onError(error);
        else {
            console.error('withButtonFeedback error:', error);
            if (window.showToast) {
                window.showToast(error.message || 'Erreur', 'error');
            }
        }
        throw error;
    }
}

// Expose helpers globally
window.setButtonLoading = setButtonLoading;
window.removeButtonLoading = removeButtonLoading;
window.showButtonSuccess = showButtonSuccess;
window.withButtonFeedback = withButtonFeedback;

/**
 * Enhanced haptic feedback helper with automatic button detection
 * Adds haptic feedback to all important button clicks
 */
function enhanceHapticFeedback() {
    // Add haptic to all buttons on click
    document.addEventListener('click', function(e) {
        const target = e.target;
        
        // Check if it's a button or inside a button
        const button = target.closest('button, .btn, [role="button"], a.btn');
        if (!button) return;
        
        // Skip if disabled or loading
        if (button.disabled || button.classList.contains('btn-loading')) return;
        
        // Skip navigation links (they have their own feedback)
        if (button.tagName === 'A' && button.href && !button.classList.contains('btn')) return;
        
        // Determine haptic intensity based on button type
        let intensity = 10; // Default
        
        if (button.classList.contains('btn-primary') || 
            button.classList.contains('btn-success') ||
            button.classList.contains('btn-danger')) {
            intensity = 15; // Stronger for primary actions
        }
        
        // Apply haptic feedback
        if (window.haptic) {
            window.haptic(intensity);
        }
    }, true); // Use capture phase to catch early
    
    // Also add haptic to form submissions
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (form.tagName === 'FORM') {
            const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
            if (submitBtn && !submitBtn.disabled && window.haptic) {
                window.haptic(15);
            }
        }
    });
}

// Initialize haptic feedback enhancement on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceHapticFeedback);
} else {
    enhanceHapticFeedback();
}

// Bulk progress system
let _bulkProgressContainer = null;
let _bulkProgressToast = null;

function showBulkProgress(current, total, message) {
    message = message || 'Traitement en cours...';
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    
    // Create or get container
    if (!_bulkProgressContainer) {
        _bulkProgressContainer = document.getElementById('bulkProgressContainer');
        if (!_bulkProgressContainer) {
            _bulkProgressContainer = document.createElement('div');
            _bulkProgressContainer.id = 'bulkProgressContainer';
            _bulkProgressContainer.className = 'bulk-progress-container';
            document.body.appendChild(_bulkProgressContainer);
        }
    }
    
    // Create or update progress bar
    if (!_bulkProgressContainer.querySelector('.bulk-progress')) {
        const progressEl = document.createElement('div');
        progressEl.className = 'bulk-progress';
        progressEl.innerHTML = `
            <div class="bulk-progress-bar">
                <div class="bulk-progress-fill"></div>
            </div>
            <div class="bulk-progress-text"></div>
        `;
        _bulkProgressContainer.appendChild(progressEl);
    }
    
    const progressEl = _bulkProgressContainer.querySelector('.bulk-progress');
    const fillEl = progressEl.querySelector('.bulk-progress-fill');
    const textEl = progressEl.querySelector('.bulk-progress-text');
    
    fillEl.style.width = percent + '%';
    textEl.textContent = `${current}/${total} ${message}`;
    
    // Show container
    _bulkProgressContainer.style.display = 'block';
    progressEl.style.display = 'flex';
    
    // Show toast with counter
    if (!_bulkProgressToast) {
        _bulkProgressToast = document.createElement('div');
        _bulkProgressToast.className = 'bulk-progress-toast';
        const toastContainer = document.getElementById('toastContainer') || document.getElementById('toast-container');
        if (!toastContainer) {
            const container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
            document.body.appendChild(container);
            container.appendChild(_bulkProgressToast);
        } else {
            toastContainer.appendChild(_bulkProgressToast);
        }
    }
    
    _bulkProgressToast.textContent = `${current}/${total} ${message}`;
    _bulkProgressToast.style.display = 'block';
    _bulkProgressToast.style.opacity = '1';
    
    // Hide when complete
    if (current >= total) {
        setTimeout(() => {
            if (_bulkProgressContainer) {
                _bulkProgressContainer.style.display = 'none';
            }
            if (_bulkProgressToast) {
                _bulkProgressToast.style.opacity = '0';
                setTimeout(() => {
                    if (_bulkProgressToast) _bulkProgressToast.style.display = 'none';
                }, 300);
            }
        }, 500);
    }
}

function hideBulkProgress() {
    if (_bulkProgressContainer) {
        _bulkProgressContainer.style.display = 'none';
    }
    if (_bulkProgressToast) {
        _bulkProgressToast.classList.remove('show');
        setTimeout(() => {
            if (_bulkProgressToast) _bulkProgressToast.style.display = 'none';
        }, 300);
    }
}

// Animation flash vert pour les lignes modifiées
function flashRowSuccess(prospectId) {
    const row = document.querySelector(`tr[data-prospect-id="${prospectId}"]`);
    if (row) {
        row.classList.add('flash-success');
        setTimeout(() => {
            row.classList.remove('flash-success');
        }, 800);
    }
}

// Animate row with .row-updated class temporarily
function animateRowUpdated(prospectId) {
    const row = document.querySelector(`tr[data-prospect-id="${prospectId}"]`);
    if (!row) return;
    
    row.classList.add('row-updated');
    setTimeout(() => {
        row.classList.remove('row-updated');
    }, 2000);
}

// Auto-sauvegarde activée (SQLite) : on garde markUnsaved comme no-op pour compatibilité.
function markUnsaved() {}

// Fix #21: Active nav highlighting now handled by sidebar.js (v23)

// ═══════════════════════════════════════════════════════════════════
// Modal Management Utilities (v25.1)
// ═══════════════════════════════════════════════════════════════════
let _activeModal = null;
let _modalFocusTrap = null;
let _modalEscapeHandler = null;
let _previousActiveElement = null;

/**
 * Open a modal with animations, focus trap, and accessibility
 * @param {string|HTMLElement} modalIdOrElement - Modal ID or element
 * @param {Object} options - Options: { focusElement, onClose }
 */
function openModal(modalIdOrElement, options = {}) {
    const modal = typeof modalIdOrElement === 'string' 
        ? document.getElementById(modalIdOrElement) 
        : modalIdOrElement;
    
    if (!modal) {
        console.warn('[openModal] Modal not found:', modalIdOrElement);
        return;
    }

    // Close any existing modal first
    if (_activeModal && _activeModal !== modal) {
        closeModal(_activeModal);
    }

    // Store previous active element for focus restoration
    _previousActiveElement = document.activeElement;

    // Set aria attributes
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-hidden', 'false');

    // Add active class (triggers display + animation)
    modal.classList.add('active');

    // Focus management
    const focusElement = options.focusElement 
        ? (typeof options.focusElement === 'string' 
            ? modal.querySelector(options.focusElement) 
            : options.focusElement)
        : modal.querySelector('input, textarea, button, [tabindex="0"]') 
            || modal.querySelector('.modal-close') 
            || modal.querySelector('.modal-content');

    if (focusElement && typeof focusElement.focus === 'function') {
        // Small delay to ensure modal is visible
        requestAnimationFrame(() => {
            focusElement.focus();
        });
    }

    // Focus trap: keep Tab/Shift+Tab within modal
    _modalFocusTrap = (e) => {
        if (e.key !== 'Tab') return;
        
        const focusableElements = modal.querySelectorAll(
            'a[href], button:not([disabled]), textarea:not([disabled]), ' +
            'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];

        if (!firstFocusable) return;

        if (e.shiftKey) {
            // Shift+Tab: if on first element, go to last
            if (document.activeElement === firstFocusable) {
                e.preventDefault();
                lastFocusable?.focus();
            }
        } else {
            // Tab: if on last element, go to first
            if (document.activeElement === lastFocusable) {
                e.preventDefault();
                firstFocusable.focus();
            }
        }
    };

    // Escape key handler
    _modalEscapeHandler = (e) => {
        if (e.key === 'Escape' && _activeModal === modal) {
            e.preventDefault();
            e.stopPropagation();
            closeModal(modal, options.onClose);
        }
    };

    // Attach event listeners
    modal.addEventListener('keydown', _modalFocusTrap);
    document.addEventListener('keydown', _modalEscapeHandler);

    // Close on backdrop click
    const backdropClickHandler = (e) => {
        if (e.target === modal) {
            closeModal(modal, options.onClose);
        }
    };
    modal.addEventListener('click', backdropClickHandler);
    modal._backdropClickHandler = backdropClickHandler;

    _activeModal = modal;
    modal._modalOptions = options;
}

/**
 * Close a modal with exit animation
 * @param {string|HTMLElement} modalIdOrElement - Modal ID or element
 * @param {Function} onClose - Optional callback after close
 */
function closeModal(modalIdOrElement, onClose) {
    const modal = typeof modalIdOrElement === 'string' 
        ? document.getElementById(modalIdOrElement) 
        : modalIdOrElement;
    
    if (!modal || !modal.classList.contains('active')) return;

    // Remove event listeners
    if (_modalFocusTrap) {
        modal.removeEventListener('keydown', _modalFocusTrap);
        _modalFocusTrap = null;
    }
    if (_modalEscapeHandler) {
        document.removeEventListener('keydown', _modalEscapeHandler);
        _modalEscapeHandler = null;
    }
    if (modal._backdropClickHandler) {
        modal.removeEventListener('click', modal._backdropClickHandler);
        modal._backdropClickHandler = null;
    }

    // Trigger exit animation
    modal.classList.add('exiting');
    modal.classList.remove('active');

    // Remove exiting class and hide after animation
    setTimeout(() => {
        modal.classList.remove('exiting');
        modal.setAttribute('aria-hidden', 'true');
        _activeModal = null;
        modal._modalOptions = null;

        // Restore focus to previous element
        if (_previousActiveElement && typeof _previousActiveElement.focus === 'function') {
            _previousActiveElement.focus();
        }
        _previousActiveElement = null;

        // Call onClose callback if provided
        if (typeof onClose === 'function') {
            onClose();
        }
    }, 200); // Match modalExit animation duration
}

// Expose to window for global access
window.openModal = openModal;
window.closeModal = closeModal;

// Auto-handle modal-close buttons
document.addEventListener('DOMContentLoaded', function() {
    // Delegate click events to modal-close buttons
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal-close') || e.target.closest('.modal-close')) {
            const closeBtn = e.target.classList.contains('modal-close') ? e.target : e.target.closest('.modal-close');
            const modal = closeBtn.closest('.modal');
            if (modal) {
                e.preventDefault();
                e.stopPropagation();
                closeModal(modal);
            }
        }
    });

    // Indicateur de chargement pour navigation entre pages
    let pageLoadingIndicator = document.getElementById('page-loading-indicator');
    if (!pageLoadingIndicator) {
        pageLoadingIndicator = document.createElement('div');
        pageLoadingIndicator.id = 'page-loading-indicator';
        pageLoadingIndicator.className = 'page-loading-indicator';
        document.body.appendChild(pageLoadingIndicator);
    }

    const showPageLoading = () => {
        if (pageLoadingIndicator) {
            pageLoadingIndicator.classList.add('active');
        }
    };

    const hidePageLoading = () => {
        if (pageLoadingIndicator) {
            pageLoadingIndicator.classList.remove('active');
        }
    };

    // Intercepter les clics sur les liens de navigation interne
    document.addEventListener('click', function(e) {
        const link = e.target.closest('a[href]');
        if (!link) return;

        const href = link.getAttribute('href');
        // Ignorer les liens externes, javascript:, mailto:, tel:, etc.
        if (!href || href.startsWith('http') || href.startsWith('javascript:') || 
            href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#') ||
            link.target === '_blank' || link.hasAttribute('download')) {
            return;
        }

        // Vérifier si c'est un lien interne (commence par / ou est relatif)
        if (href.startsWith('/') || (!href.startsWith('http') && !href.startsWith('//'))) {
            showPageLoading();
            
            // Si la navigation est immédiate, cacher l'indicateur après un court délai
            // Sinon, il sera caché par le chargement de la nouvelle page
            setTimeout(() => {
                // Si on est toujours sur la même page après 2 secondes, cacher l'indicateur
                if (document.getElementById('page-loading-indicator')) {
                    hidePageLoading();
                }
            }, 2000);
        }
    });

    // Cacher l'indicateur au chargement de la page
    hidePageLoading();

    // Appliquer la classe page-transition au contenu principal
    const content = document.querySelector('.content, main.content, main');
    if (content && !content.classList.contains('page-transition')) {
        content.classList.add('page-transition', 'entering');
        // Retirer la classe entering après l'animation
        setTimeout(() => {
            content.classList.remove('entering');
        }, 400);
    }
});


function ensureUnassignedCompany() {
    // Crée (si besoin) l'entreprise "Sans entreprise" et renvoie son id
    const existing = data.companies.find(c => (c.groupe || '').trim().toLowerCase() === 'sans entreprise');
    if (existing) return existing.id;

    const newId = Math.max(...data.companies.map(c => c.id), 0) + 1;
    data.companies.push({ id: newId, groupe: 'Sans entreprise', site: '-', phone: 'Non disponible', notes: '' });
    return newId;
}

function isUnassignedCompany(companyId) {
    const c = data.companies.find(x => x.id === companyId);
    return !!c && (c.groupe || '').trim().toLowerCase() === 'sans entreprise';
}

function safeStr(v) { return (v === null || v === undefined) ? '' : String(v); }

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

// ═══════════════════════════════════════════════════════════════════
// Form Validation System (v25.1)
// ═══════════════════════════════════════════════════════════════════

/**
 * Affiche un message d'erreur pour un champ de formulaire
 * @param {HTMLElement} field - Le champ de formulaire (input, select, textarea)
 * @param {string} message - Le message d'erreur à afficher
 */
function showFieldError(field, message) {
    if (!field) return;
    
    // Ajouter la classe is-invalid
    field.classList.add('is-invalid');
    field.setAttribute('aria-invalid', 'true');
    
    // Créer ou récupérer le conteneur d'erreur
    let errorContainer = field.parentElement.querySelector('.form-error');
    if (!errorContainer) {
        errorContainer = document.createElement('span');
        errorContainer.className = 'form-error';
        errorContainer.setAttribute('role', 'alert');
        field.parentElement.appendChild(errorContainer);
    }
    
    // Lier le champ au message d'erreur via aria-describedby
    const errorId = errorContainer.id || `error-${field.id || Math.random().toString(36).substr(2, 9)}`;
    errorContainer.id = errorId;
    const describedBy = field.getAttribute('aria-describedby');
    if (!describedBy || !describedBy.includes(errorId)) {
        field.setAttribute('aria-describedby', describedBy ? `${describedBy} ${errorId}` : errorId);
    }
    
    // Afficher le message
    errorContainer.textContent = message;
    errorContainer.style.display = 'block';
}

/**
 * Efface le message d'erreur d'un champ
 * @param {HTMLElement} field - Le champ de formulaire
 */
function clearFieldError(field) {
    if (!field) return;
    
    field.classList.remove('is-invalid');
    field.setAttribute('aria-invalid', 'false');
    
    const errorContainer = field.parentElement.querySelector('.form-error');
    if (errorContainer) {
        errorContainer.textContent = '';
        errorContainer.style.display = 'none';
    }
}

/**
 * Valide un champ de formulaire selon ses contraintes HTML5 et règles personnalisées
 * @param {HTMLElement} field - Le champ à valider
 * @param {Object} options - Options de validation personnalisées
 * @returns {boolean} - true si valide, false sinon
 */
function validateField(field, options = {}) {
    if (!field) return true;
    
    const value = field.value.trim();
    const isRequired = field.hasAttribute('required');
    const type = field.type || field.tagName.toLowerCase();
    
    // Si le champ n'est pas requis et est vide, il est valide
    if (!isRequired && !value) {
        clearFieldError(field);
        return true;
    }
    
    // Validation HTML5 native
    if (!field.checkValidity()) {
        let message = field.validationMessage || 'Ce champ est invalide';
        
        // Messages personnalisés selon le type d'erreur
        if (field.validity.valueMissing) {
            message = options.requiredMessage || 'Ce champ est requis';
        } else if (field.validity.typeMismatch) {
            if (type === 'email') {
                message = options.emailMessage || 'Veuillez entrer une adresse email valide';
            } else if (type === 'url') {
                message = options.urlMessage || 'Veuillez entrer une URL valide';
            }
        } else if (field.validity.patternMismatch) {
            message = options.patternMessage || 'Le format saisi est incorrect';
        } else if (field.validity.tooShort) {
            message = options.tooShortMessage || `Minimum ${field.minLength} caractères requis`;
        } else if (field.validity.tooLong) {
            message = options.tooLongMessage || `Maximum ${field.maxLength} caractères autorisés`;
        } else if (field.validity.rangeUnderflow) {
            message = options.rangeUnderflowMessage || `La valeur minimale est ${field.min}`;
        } else if (field.validity.rangeOverflow) {
            message = options.rangeOverflowMessage || `La valeur maximale est ${field.max}`;
        }
        
        showFieldError(field, message);
        return false;
    }
    
    // Validations personnalisées
    if (options.customValidator && typeof options.customValidator === 'function') {
        const customResult = options.customValidator(value, field);
        if (customResult !== true) {
            showFieldError(field, typeof customResult === 'string' ? customResult : 'Validation personnalisée échouée');
            return false;
        }
    }
    
    // Validation email personnalisée (plus stricte que HTML5)
    if (type === 'email' && value && options.strictEmail !== false) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
            showFieldError(field, options.emailMessage || 'Veuillez entrer une adresse email valide');
            return false;
        }
    }
    
    // Tout est OK
    clearFieldError(field);
    return true;
}

/**
 * Valide tous les champs d'un formulaire
 * @param {HTMLFormElement} form - Le formulaire à valider
 * @param {Object} fieldOptions - Options de validation par champ (clé = name ou id du champ)
 * @returns {boolean} - true si tous les champs sont valides
 */
function validateForm(form, fieldOptions = {}) {
    if (!form) return false;
    
    let isValid = true;
    const fields = form.querySelectorAll('input, select, textarea');
    
    fields.forEach(field => {
        const fieldName = field.name || field.id;
        const options = fieldOptions[fieldName] || {};
        if (!validateField(field, options)) {
            isValid = false;
        }
    });
    
    // Mettre à jour l'état du formulaire pour désactiver le submit
    if (isValid) {
        form.classList.remove('has-invalid-fields');
    } else {
        form.classList.add('has-invalid-fields');
    }
    
    return isValid;
}

/**
 * Initialise la validation en temps réel sur un formulaire
 * @param {HTMLFormElement} form - Le formulaire
 * @param {Object} options - Options (validateOnBlur, validateOnInput, fieldOptions)
 */
function initFormValidation(form, options = {}) {
    if (!form) return;
    
    const {
        validateOnBlur = true,
        validateOnInput = true,
        fieldOptions = {}
    } = options;
    
    const fields = form.querySelectorAll('input, select, textarea');
    
    fields.forEach(field => {
        // Validation au blur (quand l'utilisateur quitte le champ)
        if (validateOnBlur) {
            field.addEventListener('blur', function() {
                const fieldName = this.name || this.id;
                const options = fieldOptions[fieldName] || {};
                validateField(this, options);
                updateFormSubmitState(form);
            });
        }
        
        // Validation en temps réel (pendant la saisie) pour les champs critiques
        if (validateOnInput && field.hasAttribute('required')) {
            let timeout;
            field.addEventListener('input', function() {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    const fieldName = this.name || this.id;
                    const options = fieldOptions[fieldName] || {};
                    validateField(this, options);
                    updateFormSubmitState(form);
                }, 300); // Debounce de 300ms
            });
        }
        
        // Validation au change pour les selects
        if (field.tagName.toLowerCase() === 'select') {
            field.addEventListener('change', function() {
                const fieldName = this.name || this.id;
                const options = fieldOptions[fieldName] || {};
                validateField(this, options);
                updateFormSubmitState(form);
            });
        }
    });
    
    // Validation à la soumission
    form.addEventListener('submit', function(e) {
        if (!validateForm(form, fieldOptions)) {
            e.preventDefault();
            e.stopPropagation();
            
            // Focus sur le premier champ invalide
            const firstInvalid = form.querySelector('.is-invalid, :invalid');
            if (firstInvalid) {
                firstInvalid.focus();
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            
            showToast('Veuillez corriger les erreurs dans le formulaire', 'error');
            return false;
        }
    });
    
    // Mise à jour initiale de l'état du submit
    updateFormSubmitState(form);
}

/**
 * Met à jour l'état des boutons submit d'un formulaire
 * @param {HTMLFormElement} form - Le formulaire
 */
function updateFormSubmitState(form) {
    if (!form) return;
    
    const isValid = validateForm(form);
    const submitButtons = form.querySelectorAll('button[type="submit"], input[type="submit"]');
    
    submitButtons.forEach(btn => {
        if (isValid) {
            btn.disabled = false;
            btn.removeAttribute('aria-disabled');
        } else {
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
        }
    });
}

// Exposer les fonctions globalement
window.showFieldError = showFieldError;
window.clearFieldError = clearFieldError;
window.validateField = validateField;
window.validateForm = validateForm;
window.initFormValidation = initFormValidation;
window.updateFormSubmitState = updateFormSubmitState;

function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function normalizeData() {
    if (!Array.isArray(data.companies)) data.companies = [];
    if (!Array.isArray(data.prospects)) data.prospects = [];

    const unassignedId = ensureUnassignedCompany();

    // Normaliser les entreprises
    data.companies.forEach(c => {
        if (c.notes === undefined || c.notes === null) c.notes = '';
        if (c.phone === undefined || c.phone === null) c.phone = 'Non disponible';
        if (c.tags === undefined || c.tags === null) c.tags = [];
    });

    const companyIds = new Set(data.companies.map(c => c.id));
    data.prospects.forEach(p => {
        if (!Array.isArray(p.callNotes)) p.callNotes = [];
        if (!p.lastContact) p.lastContact = todayISO();
        if (p.nextFollowUp === undefined) p.nextFollowUp = '';
        if (p.priority === undefined) p.priority = 2;
        if (p.pushEmailSentAt === undefined) p.pushEmailSentAt = '';
        if (p.pushLinkedInSentAt === undefined) p.pushLinkedInSentAt = '';
        if (p.nextAction === undefined || p.nextAction === null) p.nextAction = '';
        if (p.tags === undefined || p.tags === null) p.tags = [];
        if (p.template_id === undefined) p.template_id = null;
        if (p.push_category_id === undefined) p.push_category_id = null;
        if (p.rdvDate === undefined || p.rdvDate === null) p.rdvDate = '';
        if (p.is_contact === undefined || p.is_contact === null) p.is_contact = 0;
        if (!p.statut) p.statut = "Pas d'actions";
        if (!p.pertinence && p.pertinence !== 0) p.pertinence = '3';
        if (!p.name) p.name = '(Sans nom)';
        if (!p.fonction) p.fonction = '';

        // Sécurité : si company_id manquant ou invalide, basculer vers "Sans entreprise"
        if (p.company_id === undefined || p.company_id === null || !companyIds.has(p.company_id)) {
            p.company_id = unassignedId;
        }
    });
}

// ====== Fin persistance serveur ======
let currentView = 'all';
let filteredProspects = [];
let editingId = null;
let selectedProspects = new Set();
// Pagination state
let _pageSize = parseInt(localStorage.getItem('prospup_pageSize') || '50', 10);
let _currentPage = 1;
// Multi-status exclusion filter (UI: 🚫 Exclure)
let excludedStatuses = new Set();
let sortKey = 'lastContact';
let companySortKey = 'groupe';
let companySortDir = 'asc';
const COMPANIES_VIEW_STORAGE_KEY = 'prospup_companies_view';
let companiesViewMode = (typeof localStorage !== 'undefined' && localStorage.getItem(COMPANIES_VIEW_STORAGE_KEY)) || 'cards';
if (companiesViewMode !== 'table' && companiesViewMode !== 'cards') companiesViewMode = 'cards';
let inlineCompanyNotesEditingId = null;
let sortDir = 'desc'; // 'asc' ou 'desc'
let pendingCompanyFocusId = null;
let companySheetState = { companyId: null, mode: 'view' };
let _pendingProspListScrollRestore = null;

// Saved views (v6)
let savedViews = [];
let savedViewSelectedId = null;

async function fetchSavedViews() {
    try {
        const res = await fetch('/api/views?page=prospects');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const arr = await res.json();
        savedViews = Array.isArray(arr) ? arr : [];
    } catch (e) {
        console.warn('Saved views load failed', e);
        savedViews = [];
    }
}

function getCurrentProspectsViewState() {
    const get = (id, def='') => (document.getElementById(id) ? document.getElementById(id).value : def);
    return {
        searchInput: get('searchInput', ''),
        companyFilter: get('companyFilter', ''),
        statusFilter: get('statusFilter', ''),
        pertinenceFilter: get('pertinenceFilter', ''),
        followupFilter: get('followupFilter', ''),
        phoneFilter: get('phoneFilter', ''),
        emailFilter: get('emailFilter', ''),
        linkedinFilter: get('linkedinFilter', ''),
        pushFilter: get('pushFilter', ''),
        priorityFilter: get('priorityFilter', ''),
        filterTags: [...filterTags],
        excludedStatuses: Array.from(excludedStatuses || []),
        sortKey,
        sortDir,
        displayMode: _currentView || 'table',
    };
}

function applyProspectsViewState(state) {
    if (!state || typeof state !== 'object') return;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v ?? ''); };

    setVal('searchInput', state.searchInput ?? '');
    setVal('companyFilter', state.companyFilter ?? '');
    setVal('statusFilter', state.statusFilter ?? '');
    setVal('pertinenceFilter', state.pertinenceFilter ?? '');
    setVal('followupFilter', state.followupFilter ?? '');
    setVal('phoneFilter', state.phoneFilter ?? '');
    setVal('emailFilter', state.emailFilter ?? '');
    setVal('linkedinFilter', state.linkedinFilter ?? '');
    setVal('pushFilter', state.pushFilter ?? '');
    setVal('priorityFilter', state.priorityFilter ?? '');
    filterTags = Array.isArray(state.filterTags) ? [...state.filterTags] : [];
    renderFilterTagChips();

    excludedStatuses = new Set(Array.isArray(state.excludedStatuses) ? state.excludedStatuses : []);
    const panel = document.getElementById('excludePanel');
    if (panel) {
        panel.querySelectorAll('input[type="checkbox"]').forEach(i => {
            i.checked = excludedStatuses.has(i.value);
        });
    }

    if (state.sortKey) sortKey = state.sortKey;
    if (state.sortDir) sortDir = state.sortDir;
    try { applySort(); } catch(e) {}
    filterProspects();
    const preferredMode = (state.displayMode === 'kanban' || state.displayMode === 'prosp') ? state.displayMode : 'table';
    try { switchTableKanban(preferredMode); } catch (e) {}
}

function renderSavedViewsSelect() {
    const sel = document.getElementById('savedViewSelect');
    if (!sel) return;
    const current = savedViewSelectedId ? String(savedViewSelectedId) : '';
    sel.innerHTML = '<option value="">Vues…</option>' +
        savedViews.map(v => `<option value="${v.id}" ${String(v.id)===current?'selected':''}>${escapeHtml(v.name || ('Vue ' + v.id))}</option>`).join('');

    const del = document.getElementById('btnDeleteView');
    if (del) del.disabled = !current;
}

async function initSavedViewsUI() {
    await fetchSavedViews();
    renderSavedViewsSelect();
}

async function onSavedViewChanged() {
    const sel = document.getElementById('savedViewSelect');
    const id = sel ? sel.value : '';
    savedViewSelectedId = id ? parseInt(id, 10) : null;
    const del = document.getElementById('btnDeleteView');
    if (del) del.disabled = !savedViewSelectedId;
    if (!savedViewSelectedId) return;
    const v = savedViews.find(x => String(x.id) === String(savedViewSelectedId));
    if (v) applyProspectsViewState(v.state || {});
}

async function saveCurrentView() {
    const name = (prompt('Nom de la vue (filtres + tri) :') || '').trim();
    if (!name) return;
    const payload = {
        page: 'prospects',
        name,
        state: getCurrentProspectsViewState(),
    };
    // if a view is selected, update it
    if (savedViewSelectedId) payload.id = savedViewSelectedId;
    try {
        const res = await fetch('/api/views/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const out = await res.json().catch(()=>({}));
        if (!res.ok || !out.ok) throw new Error(out.error || ('HTTP ' + res.status));
        savedViewSelectedId = out.id;
        await fetchSavedViews();
        renderSavedViewsSelect();
    } catch (e) {
        console.error(e);
        alert('❌ Impossible d\'enregistrer la vue: ' + (e && e.message ? e.message : e));
    }
}

async function deleteSelectedView() {
    if (!savedViewSelectedId) return;
    if (!confirm('Supprimer la vue sélectionnée ?')) return;
    try {
        const res = await fetch('/api/views/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: savedViewSelectedId }),
        });
        const out = await res.json().catch(()=>({}));
        if (!res.ok || !out.ok) throw new Error(out.error || ('HTTP ' + res.status));
        savedViewSelectedId = null;
        await fetchSavedViews();
        renderSavedViewsSelect();
    } catch (e) {
        console.error(e);
        alert('❌ Impossible de supprimer la vue: ' + (e && e.message ? e.message : e));
    }
}


function initProspectsPage() {
    filteredProspects = [...data.prospects];
    populateCompanySelects();
    try {
        const params = new URLSearchParams(window.location.search);
        const cid = params.get('company');
        if (cid && document.getElementById('inputCompany')) {
            const sel = document.getElementById('inputCompany');
            sel.value = cid;
        }
        if (params.get('contacts') === '1') {
            _showContacts = true;
            // Highlight Contacts in sidebar instead of Prospects
            const contactsBtn = document.getElementById('sidebarContactsBtn');
            if (contactsBtn) contactsBtn.classList.add('active');
            // Un-highlight Prospects
            document.querySelectorAll('.sidebar .nav-button').forEach(btn => {
                if (btn.getAttribute('href') === '/' && btn.id !== 'sidebarContactsBtn') {
                    btn.classList.remove('active');
                }
            });
        }
    } catch (e) {}

    filterProspects();
    setupListeners();
    updateBulkBar();
    updateSelectAllState();
    try { initSavedViewsUI(); } catch(e) {}
    try {
        if (sessionStorage.getItem(PROSP_SESSION_STORAGE_KEY)) showProspResumeBanner();
    } catch (e) {}
}

function populateCompanySelects() {
    const companyFilter = document.getElementById('companyFilter');
    const inputCompany = document.getElementById('inputCompany');

    // Filtre entreprises (avec option "toutes")
    if (companyFilter) {
        companyFilter.innerHTML = '<option value="">Toutes les entreprises</option>';
    }
    // Select dans le formulaire prospect (pas d'option par défaut ici, on garde tel quel)
    if (inputCompany) {
        inputCompany.innerHTML = '';
    }

    const unassignedId = ensureUnassignedCompany();

    // Normaliser les entreprises
    data.companies.forEach(c => {
        if (c.notes === undefined || c.notes === null) c.notes = '';
        if (c.phone === undefined || c.phone === null) c.phone = 'Non disponible';
        if (c.tags === undefined || c.tags === null) c.tags = [];
    });

    
    // Pré-calcul des compteurs
    const counts = {};
    data.companies.forEach(c => {
        counts[c.id] = { prospects: 0, rdv: 0, callable: 0 };
    });

    data.prospects.forEach(p => {
        if (!counts[p.company_id]) counts[p.company_id] = { prospects: 0, rdv: 0, callable: 0 };
        counts[p.company_id].prospects += 1;
        if (p.statut === 'Rendez-vous') counts[p.company_id].rdv += 1;
        if (isProspectCallable(p)) counts[p.company_id].callable += 1;
    });

    const companiesSorted = [...data.companies].sort((a, b) => {
        // Toujours garder "Sans entreprise" en premier
        if (a.id === unassignedId) return -1;
        if (b.id === unassignedId) return 1;

        const ca = counts[a.id] || { prospects: 0, rdv: 0, callable: 0 };
        const cb = counts[b.id] || { prospects: 0, rdv: 0, callable: 0 };

        const getVal = (company, c) => {
            switch (companySortKey) {
                case 'site': return (company.site || '').toLowerCase();
                case 'prospects': return c.prospects || 0;
                case 'rdv': return c.rdv || 0;
                case 'callable': return c.callable || 0;
                case 'groupe':
                default: return (company.groupe || '').toLowerCase();
            }
        };

        const va = getVal(a, ca);
        const vb = getVal(b, cb);

        let res = 0;
        if (typeof va === 'number' && typeof vb === 'number') {
            res = va - vb;
        } else {
            res = String(va).localeCompare(String(vb));
        }
        return (companySortDir === 'asc') ? res : -res;
    });

    companiesSorted.forEach(company => {
        const label = `${company.groupe} (${company.site})`;

        if (companyFilter) {
            const opt = document.createElement('option');
            opt.value = company.id;
            opt.textContent = label;
            companyFilter.appendChild(opt);
        }
        if (inputCompany) {
            const opt2 = document.createElement('option');
            opt2.value = company.id;
            opt2.textContent = label;
            inputCompany.appendChild(opt2);
        }
    });
}


function setupListeners() {
    const on = (id, evt, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(evt, fn);
    };

    // Prospects page filters — v26: debounce pour input (performance)
    let _filterDebounceTimer = null;
    const debouncedFilterProspects = () => {
        if (_filterDebounceTimer) clearTimeout(_filterDebounceTimer);
        _filterDebounceTimer = setTimeout(() => {
            filterProspects();
            _filterDebounceTimer = null;
        }, 150); // 150ms debounce pour input
    };
    on('searchInput', 'input', debouncedFilterProspects);
    on('companyFilter', 'change', filterProspects);
    on('statusFilter', 'change', filterProspects);
    on('pertinenceFilter', 'change', filterProspects);
    on('followupFilter', 'change', filterProspects);
    on('pushFilter', 'change', filterProspects);

    // New filters
    on('phoneFilter', 'change', filterProspects);
    on('emailFilter', 'change', filterProspects);
    on('linkedinFilter', 'change', filterProspects);
    on('priorityFilter', 'change', filterProspects);

    // Filter panel toggle
    const btnToggle = document.getElementById('btnToggleFilters');
    if (btnToggle) btnToggle.addEventListener('click', () => {
        const panel = document.getElementById('filterPanel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    // Close filter panel on click outside
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('filterPanel');
        if (!panel || panel.style.display === 'none') return;
        const btn = document.getElementById('btnToggleFilters');
        // If click is inside filter panel or on the toggle button, ignore
        if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
        panel.style.display = 'none';
    });

    // Reset filters
    const btnReset = document.getElementById('btnResetFilters');
    if (btnReset) btnReset.addEventListener('click', resetAllFilters);

    // Tags filter input
    const tagInput = document.getElementById('filterTagsInput');
    if (tagInput) {
        tagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                const v = tagInput.value.trim().replace(/,/g, '');
                if (v && !filterTags.includes(v)) {
                    filterTags.push(v);
                    tagInput.value = '';
                    renderFilterTagChips();
                    filterProspects();
                }
            }
        });
    }

    // Refresh tag suggestions on data load
    refreshTagSuggestions();

    // Saved views (v6)
    on('savedViewSelect', 'change', onSavedViewChanged);
    const btnSaveView = document.getElementById('btnSaveView');
    if (btnSaveView) btnSaveView.addEventListener('click', (e) => { e.preventDefault(); saveCurrentView(); });
    const btnDeleteView = document.getElementById('btnDeleteView');
    if (btnDeleteView) btnDeleteView.addEventListener('click', (e) => { e.preventDefault(); deleteSelectedView(); });

    // Exclude statuses dropdown (optional)
    const toggleBtn = document.getElementById('excludeToggle');
    const panel = document.getElementById('excludePanel');
    const btnApply = document.getElementById('excludeApply');
    const btnClear = document.getElementById('excludeClear');

    const closePanel = () => { if (panel) panel.style.display = 'none'; };
    const openPanel = () => { if (panel) panel.style.display = ''; };
    const isOpen = () => (panel && panel.style.display !== 'none');

    if (toggleBtn && panel) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isOpen()) closePanel(); else openPanel();
        });
    }

    // Prevent closing when clicking inside
    panel?.addEventListener('click', (e) => e.stopPropagation());

    // Apply
    btnApply?.addEventListener('click', () => {
        excludedStatuses = new Set(
            Array.from(panel.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value)
        );
        closePanel();
        filterProspects();
    });

    // Clear
    btnClear?.addEventListener('click', () => {
        excludedStatuses = new Set();
        panel.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = false; });
        closePanel();
        filterProspects();
    });

    // Close on outside click
    document.addEventListener('click', () => closePanel());

    // Tri prospects
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => setSort(th.dataset.sort));
    });

    // Tri entreprises
    document.querySelectorAll('th.company-sortable').forEach(th => {
        th.addEventListener('click', () => setCompanySort(th.dataset.companySort));
    });

    // Recherche entreprises
    on('companySearchInput', 'input', renderCompanies);

    // Import JSON (page Paramètres)
    on('jsonFile', 'change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const imported = JSON.parse(evt.target.result);
                if (imported && imported.companies && imported.prospects) {
                    await checkAndMergeImportedData(imported);
                    // Rafraîchir si on est sur la page prospects
                    const companyFilter = document.getElementById('companyFilter');
                    const inputCompany = document.getElementById('inputCompany');
                    if (companyFilter) companyFilter.innerHTML = '<option value="">Toutes les entreprises</option>';
                    if (inputCompany) inputCompany.innerHTML = '';
                    if (companyFilter || inputCompany) {
                        populateCompanySelects();
    try {
        const params = new URLSearchParams(window.location.search);
        const cid = params.get('company');
        if (cid && document.getElementById('inputCompany')) {
            const sel = document.getElementById('inputCompany');
            sel.value = cid;
        }
    } catch (e) {}

                        switchView('all');
                    } else {
                        // Sinon, on renvoie vers la page principale
                        window.location.href = '/?imported=1';
                    }
                    showToast('✅ Données importées et fusionnées !', 'success');
                } else {
                    alert('❌ JSON invalide : attendu {companies:[...], prospects:[...]}');
                }
            } catch (err) {
                alert('❌ Erreur de lecture : ' + (err && err.message ? err.message : err));
            } finally {
                e.target.value = '';
            }
        };
        reader.readAsText(file, 'utf-8');
    });
}

function switchView(view) {
    const vp = document.getElementById('viewProspects');
    const vc = document.getElementById('viewCompanies');
    const vs = document.getElementById('viewSettings');

    if (vp) vp.style.display = 'none';
    if (vc) vc.style.display = 'none';
    if (vs) vs.style.display = 'none';

    if (view === 'all' || view === 'status' || view === 'actions') {
        if (vp) vp.style.display = 'block';
        currentView = view;

        // Title is set by filterProspects() which respects _showContacts mode

        // Pré-configurer les filtres selon la vue
        const follow = document.getElementById('followupFilter');
        if (view === 'actions' && follow) {
            follow.value = 'due';
        }
        filterProspects();
        return;
    }

    if (view === 'companies') {
        if (vc) vc.style.display = 'block';
        currentView = 'companies';
        renderCompanies();
        return;
    }

    if (view === 'settings') {
        if (vs) vs.style.display = 'block';
        currentView = 'settings';
        return;
    }
}

function refreshCompaniesUI() {
    populateCompanySelects();
    try {
        const params = new URLSearchParams(window.location.search);
        const cid = params.get('company');
        if (cid && document.getElementById('inputCompany')) {
            const sel = document.getElementById('inputCompany');
            sel.value = cid;
        }
    } catch (e) {}

    if (document.getElementById('viewCompanies')?.style.display !== 'none') {
        renderCompanies();
    }
    // Rafraîchir les prospects si on est sur la vue prospects
    if (document.getElementById('viewProspects')?.style.display !== 'none') {
        filterProspects();
    }
}

function deleteCompany(companyId) {
    const unassignedId = ensureUnassignedCompany();

    // Normaliser les entreprises
    data.companies.forEach(c => {
        if (c.notes === undefined || c.notes === null) c.notes = '';
        if (c.phone === undefined || c.phone === null) c.phone = 'Non disponible';
        if (c.tags === undefined || c.tags === null) c.tags = [];
    });
    if (isUnassignedCompany(companyId)) {
        showToast('⚠️ Impossible de supprimer cette entreprise.', 'warning');
        return;
    }
    const company = data.companies.find(c => c.id === companyId);
    if (!company) return;

    const impacted = data.prospects.filter(p => p.company_id === companyId).length;
    const msg = impacted > 0
        ? `Supprimer "${company.groupe} (${company.site})" ?\n\nLes ${impacted} prospect(s) seront déplacés vers "Sans entreprise".`
        : `Supprimer "${company.groupe} (${company.site})" ?`;
    if (!confirm(msg)) return;

    // Déplacer les prospects vers "Sans entreprise"
    data.prospects.forEach(p => {
        if (p.company_id === companyId) p.company_id = unassignedId;
    });

    // Supprimer l'entreprise
    data.companies = data.companies.filter(c => c.id !== companyId);

    // Si un filtre était positionné sur cette entreprise, le basculer sur "Sans entreprise"
    const companyFilter = document.getElementById('companyFilter');
    if (companyFilter && String(companyFilter.value) === String(companyId)) {
        companyFilter.value = String(unassignedId);
    }

    saveToServer();
    refreshCompaniesUI();
    showToast('✅ Entreprise supprimée', 'success');
}


function setCompanySort(key) {
    if (!key) return;
    if (companySortKey === key) {
        companySortDir = (companySortDir === 'asc') ? 'desc' : 'asc';
    } else {
        companySortKey = key;
        companySortDir = 'asc';
    }
    renderCompanies();
}

function updateCompanySortIndicators() {
    document.querySelectorAll('th.company-sortable').forEach(th => {
        const ind = th.querySelector('.sort-indicator');
        if (!ind) return;
        if (th.dataset.companySort === companySortKey) {
            ind.textContent = (companySortDir === 'asc') ? '▲' : '▼';
            ind.style.opacity = '1';
        } else {
            ind.textContent = '';
            ind.style.opacity = '0.6';
        }
    });
}

function viewProspectsForCompany(companyId) {
    if (window.__APP_PAGE__ === 'companies') {
        window.location.href = '/?company=' + companyId;
        return;
    }
    const companyFilter = document.getElementById('companyFilter');
    if (companyFilter) companyFilter.value = companyId;
    switchView('all');
}

function beginCompanyNotesInline(companyId) {
    if (isUnassignedCompany(companyId)) {
        showToast('⚠️ Cette entreprise ne peut pas être modifiée.', 'warning');
        return;
    }
    inlineCompanyNotesEditingId = companyId;
    renderCompanies();
}

function cancelCompanyNotesInline() {
    inlineCompanyNotesEditingId = null;
    renderCompanies();
}

function saveCompanyNotesInline(companyId) {
    const ta = document.getElementById('companyNotesInlineTextarea');
    if (!ta) return;
    const company = data.companies.find(c => c.id === companyId);
    if (!company) return;
    company.notes = ta.value || '';
    inlineCompanyNotesEditingId = null;
    saveToServer();
    refreshCompaniesUI();
}

function updateCompanySummary(summary) {
    const set = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(v);
    };
    set('companySummaryCompanies', summary.companies);
    set('companySummaryProspects', summary.prospects);
    set('companySummaryRDV', summary.rdv);
    set('companySummaryCallable', summary.callable);
}
function renderCompanies() {
    const tbody = document.getElementById('companyTableBody');
    if (!tbody) return;

    const q = (document.getElementById('companySearchInput')?.value || '').trim().toLowerCase();

    // Optimisation: utiliser requestAnimationFrame pour différer le rendu lourd
    if (window._renderCompaniesRaf) {
        cancelAnimationFrame(window._renderCompaniesRaf);
    }
    
    window._renderCompaniesRaf = requestAnimationFrame(() => {
        const result = _renderCompaniesInternal(tbody, q);
        window._renderCompaniesRaf = null;
        applyCompaniesViewVisibility();
        if (result && companiesViewMode === 'cards') {
            renderCompaniesCards(result.companiesSorted, result.counts);
        }
    });
}

function applyCompaniesViewVisibility() {
    const tableView = document.getElementById('companiesTableView');
    const cardsView = document.getElementById('companiesCardsView');
    const btnTable = document.getElementById('btnCompaniesViewTable');
    const btnCards = document.getElementById('btnCompaniesViewCards');
    if (!tableView || !cardsView) return;
    if (companiesViewMode === 'cards') {
        tableView.style.display = 'none';
        cardsView.style.display = 'grid';
        if (btnTable) btnTable.classList.remove('active');
        if (btnCards) btnCards.classList.add('active');
    } else {
        tableView.style.display = '';
        cardsView.style.display = 'none';
        if (btnTable) btnTable.classList.add('active');
        if (btnCards) btnCards.classList.remove('active');
    }
}

function switchCompaniesView(mode) {
    if (mode !== 'table' && mode !== 'cards') return;
    companiesViewMode = mode;
    try { localStorage.setItem(COMPANIES_VIEW_STORAGE_KEY, mode); } catch (e) {}
    applyCompaniesViewVisibility();
    if (mode === 'cards') renderCompanies();
}

function renderCompaniesCards(companiesSorted, counts) {
    const container = document.getElementById('companiesCardsView');
    if (!container) return;
    const unassignedId = ensureUnassignedCompany();
    container.innerHTML = '';
    companiesSorted.forEach(company => {
        const c = counts[company.id] || { prospects: 0, rdv: 0, callable: 0 };
        const card = document.createElement('div');
        card.className = 'company-card company-card-modern';
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.setAttribute('aria-label', `Entreprise ${escapeHtml(company.groupe || '')} ${escapeHtml(company.site || '')}`);
        const notesRaw = (company.notes || '').trim();
        const noteSnippet = notesRaw ? (escapeHtml(notesRaw).slice(0, 80) + (notesRaw.length > 80 ? '…' : '')) : '';
        card.innerHTML = `
            <div class="company-card-header">
                <span class="company-card-name">${escapeHtml(company.groupe || '')}</span>
                ${company.id === unassignedId ? '<span class="company-default-badge">(défaut)</span>' : ''}
            </div>
            <div class="company-card-site">${escapeHtml(company.site || '')}</div>
            ${noteSnippet ? `<div class="company-card-note">${noteSnippet}</div>` : ''}
            <div class="company-card-counts">
                <span class="count-badge count-badge-sm ${c.prospects > 0 ? 'has-prospects' : ''}" title="Prospects">${c.prospects}</span>
                <span class="count-badge count-badge-sm rdv ${c.rdv > 0 ? 'has-rdv' : ''}" title="RDV">${c.rdv}</span>
                <span class="count-badge count-badge-sm callable ${c.callable > 0 ? 'has-callable' : ''}" title="Appelables">${c.callable}</span>
            </div>
            <div class="company-card-actions" onclick="event.stopPropagation();">
                <button type="button" class="btn-action btn-action-view" title="Voir la fiche entreprise" onclick="event.stopPropagation(); openCompanySheet(${company.id}, 'view');"><span class="btn-action-icon">&#x1F3E2;</span></button>
                <button type="button" class="btn-action btn-action-prospects" title="Voir prospects" onclick="event.stopPropagation(); viewProspectsForCompany(${company.id});"><span class="btn-action-icon">&#x1F465;</span></button>
                <button type="button" class="btn-action btn-action-edit" title="Modifier" onclick="event.stopPropagation(); openEditCompanyModal(${company.id});"><span class="btn-action-icon">&#x270F;&#xFE0F;</span></button>
                <button type="button" class="btn-action btn-action-delete" title="Supprimer" onclick="event.stopPropagation(); deleteCompany(${company.id});" ${company.id === unassignedId ? 'disabled' : ''}><span class="btn-action-icon">&#x1F5D1;</span></button>
            </div>
        `;
        card.onclick = () => {
            if (window.__APP_PAGE__ === 'companies') {
                window.location.href = `/?company=${company.id}`;
                return;
            }
            const companyFilter = document.getElementById('companyFilter');
            if (companyFilter) companyFilter.value = company.id;
            switchView('all');
        };
        container.appendChild(card);
    });
}

function _renderCompaniesInternal(tbody, q) {
    // Pré-calcul des compteurs (une seule passe)
    const counts = {};
    data.companies.forEach(c => {
        counts[c.id] = { prospects: 0, rdv: 0, callable: 0 };
    });

    // Une seule passe sur les prospects
    data.prospects.forEach(p => {
        if (p.company_id && counts[p.company_id]) {
            counts[p.company_id].prospects += 1;
            if (p.statut === 'Rendez-vous') counts[p.company_id].rdv += 1;
            if (isProspectCallable(p)) counts[p.company_id].callable += 1;
        }
    });

    const unassignedId = ensureUnassignedCompany();

    // Normaliser les entreprises (une seule passe)
    data.companies.forEach(c => {
        if (c.notes === undefined || c.notes === null) c.notes = '';
        if (c.phone === undefined || c.phone === null) c.phone = 'Non disponible';
        if (c.tags === undefined || c.tags === null) c.tags = [];
    });

    // Filtrer et trier en une seule passe
    const companiesFiltered = q 
        ? data.companies.filter(c => {
            const label = `${c.groupe || ''} ${c.site || ''}`.toLowerCase();
            return label.includes(q);
        })
        : data.companies;

    const companiesSorted = [...companiesFiltered].sort((a, b) => {
        // Toujours garder "Sans entreprise" en premier
        if (a.id === unassignedId) return -1;
        if (b.id === unassignedId) return 1;

        const ca = counts[a.id] || { prospects: 0, rdv: 0, callable: 0 };
        const cb = counts[b.id] || { prospects: 0, rdv: 0, callable: 0 };

        const getVal = (company, c) => {
            switch (companySortKey) {
                case 'site': return (company.site || '').toLowerCase();
                case 'prospects': return Number(c.prospects || 0);
                case 'rdv': return Number(c.rdv || 0);
                case 'callable': return Number(c.callable || 0);
                case 'groupe':
                default: return (company.groupe || '').toLowerCase();
            }
        };

        const va = getVal(a, ca);
        const vb = getVal(b, cb);

        let res = 0;
        if (typeof va === 'number' && typeof vb === 'number') {
            res = va - vb;
        } else {
            res = String(va).localeCompare(String(vb), 'fr', { numeric: true, sensitivity: 'base' });
        }
        return (companySortDir === 'asc') ? res : -res;
    });

    // Utiliser DocumentFragment pour réduire les reflows
    const fragment = document.createDocumentFragment();
    let summary = { companies: 0, prospects: 0, rdv: 0, callable: 0 };

    companiesSorted.forEach(company => {
        const c = counts[company.id] || { prospects: 0, rdv: 0, callable: 0 };
        summary.companies += 1;
        summary.prospects += c.prospects;
        summary.rdv += c.rdv;
        summary.callable += c.callable;
        
        const notesRaw = (company.notes || '').trim();
        let notesSnippet = '';
        if (inlineCompanyNotesEditingId === company.id) {
            notesSnippet = `
                <div class="company-note-editor" onclick="event.stopPropagation();">
                    <textarea id="companyNotesInlineTextarea" placeholder="Notes / description de l'entreprise...">${escapeHtml(company.notes || '')}</textarea>
                    <div class="note-actions">
                        <button class="btn btn-secondary" onclick="event.stopPropagation(); cancelCompanyNotesInline();">Annuler</button>
                        <button class="btn btn-primary" onclick="event.stopPropagation(); saveCompanyNotesInline(${company.id});">Enregistrer</button>
                    </div>
                </div>
            `;
        } else {
            const snippetText = notesRaw ? (escapeHtml(notesRaw).slice(0, 120) + (notesRaw.length > 120 ? '…' : '')) : '<span class="company-note-empty">Ajouter une note…</span>';
            notesSnippet = `
                <div class="company-note-snippet" title="Cliquer pour modifier la note" onclick="event.stopPropagation(); beginCompanyNotesInline(${company.id});">
                    <span class="note-text">${snippetText}</span>
                    <span class="company-note-edit">✎</span>
                </div>
            `;
        }
        
        const tr = document.createElement('tr');
        tr.className = 'company-row';
        tr.style.cursor = 'pointer';
        
        // Focus visuel (ex: depuis une fiche prospect)
        if (pendingCompanyFocusId && company.id === pendingCompanyFocusId) {
            tr.classList.add('company-focus');
            setTimeout(() => {
                try { tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
            }, 0);
            pendingCompanyFocusId = null;
        }

        tr.innerHTML = `
            <td class="company-name-cell">
                <div class="company-name-wrapper">
                    <strong class="company-groupe">${escapeHtml(company.groupe || '')}</strong>
                    ${company.id === unassignedId ? '<span class="company-default-badge">(défaut)</span>' : ''}
                </div>
                ${notesSnippet}
            </td>
            <td class="company-site-cell">${escapeHtml(company.site || '')}</td>
            <td class="center company-count-cell">
                <span class="count-badge ${c.prospects > 0 ? 'has-prospects' : ''}">${c.prospects}</span>
            </td>
            <td class="center company-count-cell">
                <span class="count-badge rdv ${c.rdv > 0 ? 'has-rdv' : ''}">${c.rdv}</span>
            </td>
            <td class="center company-count-cell">
                <span class="count-badge callable ${c.callable > 0 ? 'has-callable' : ''}">${c.callable}</span>
            </td>
            <td class="center company-actions-cell">
                <div class="company-actions-group">
                    <button class="btn-action btn-action-view" title="Voir la fiche entreprise" onclick="event.stopPropagation(); openCompanySheet(${company.id}, 'view');">
                        <span class="btn-action-icon">🏢</span>
                    </button>
                    <button class="btn-action btn-action-prospects" title="Voir prospects" onclick="event.stopPropagation(); viewProspectsForCompany(${company.id});">
                        <span class="btn-action-icon">👥</span>
                    </button>
                    <button class="btn-action btn-action-edit" title="Modifier" onclick="event.stopPropagation(); openEditCompanyModal(${company.id});">
                        <span class="btn-action-icon">✏️</span>
                    </button>
                    <button class="btn-action btn-action-delete" title="Supprimer" onclick="event.stopPropagation(); deleteCompany(${company.id});" ${company.id === unassignedId ? 'disabled' : ''}>
                        <span class="btn-action-icon">🗑️</span>
                    </button>
                </div>
            </td>
        `;

        tr.onclick = () => {
            if (window.__APP_PAGE__ === 'companies') {
                window.location.href = `/?company=${company.id}`;
                return;
            }
            const companyFilter = document.getElementById('companyFilter');
            if (companyFilter) companyFilter.value = company.id;
            switchView('all');
        };

        fragment.appendChild(tr);
    });

    // Un seul reflow pour remplacer tout le contenu
    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    updateCompanySummary(summary);
    updateCompanySortIndicators();
    return { companiesSorted, counts, summary };
}

// ===== Score (v6) =====
function computeProspectScore(p) {
    // Score 0-100 (heuristique simple) : priorité + pertinence + échéance + signaux
    let score = 0;

    // pertinence: 1..5 -> 10..50
    const pert = Number(p && p.pertinence ? p.pertinence : 0) || 0;
    if (pert > 0) score += Math.max(0, Math.min(5, pert)) * 10;

    // priority: 1 (haut) / 2 / 3
    const pr = Number(p && p.priority !== undefined ? p.priority : 2) || 2;
    if (pr === 1) score += 15;
    else if (pr === 2) score += 10;
    else if (pr === 3) score += 5;

    // nextFollowUp urgency
    const nf = (p && p.nextFollowUp) ? String(p.nextFollowUp).trim() : '';
    const today = todayISO();
    if (nf) {
        if (nf < today) score += 20;          // en retard
        else if (nf === today) score += 15;   // aujourd'hui
        else {
            // dans les 7 prochains jours
            try {
                const d = new Date(nf + 'T00:00:00');
                const t = new Date(today + 'T00:00:00');
                const diffDays = Math.round((d - t) / (1000 * 60 * 60 * 24));
                if (diffDays <= 7) score += 10;
                else score += 5;
            } catch (e) {
                score += 5;
            }
        }
    }

    // push not sent (email) but email exists
    const hasEmail = !!(p && p.email && String(p.email).trim());
    if (hasEmail && !(p.pushEmailSentAt && String(p.pushEmailSentAt).trim())) score += 5;

    // status adjustments (soft)
    const st = (p && p.statut) ? String(p.statut) : '';
    if (st === "Pas intéressé") score -= 25;
    if (st === "Rendez-vous") score -= 5;

    // clamp
    score = Math.max(0, Math.min(100, Math.round(score)));
    return score;
}


// ===== ADVANCED FILTER SYSTEM =====
let filterTags = []; // active tag filters

function getAllProspectTags() {
    const set = new Set();
    data.prospects.forEach(p => {
        (Array.isArray(p.tags) ? p.tags : []).forEach(t => { if (t) set.add(t); });
    });
    return Array.from(set).sort((a,b) => a.localeCompare(b, 'fr'));
}

function refreshTagSuggestions() {
    const dl = document.getElementById('filterTagsSuggestions');
    if (!dl) return;
    dl.innerHTML = '';
    getAllProspectTags().forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        dl.appendChild(opt);
    });
}

function renderFilterTagChips() {
    const box = document.getElementById('filterTagsChips');
    if (!box) return;
    box.innerHTML = filterTags.map((t, i) => 
        `<span class="ftag-chip">${escapeHtml(t)}<button type="button" onclick="removeFilterTag(${i})">×</button></span>`
    ).join('');
}

function removeFilterTag(i) {
    filterTags.splice(i, 1);
    renderFilterTagChips();
    filterProspects();
}

function getFilterVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

function countActiveFilters() {
    let n = 0;
    if (getFilterVal('companyFilter')) n++;
    if (getFilterVal('statusFilter')) n++;
    if (getFilterVal('pertinenceFilter')) n++;
    if (getFilterVal('phoneFilter')) n++;
    if (getFilterVal('emailFilter')) n++;
    if (getFilterVal('linkedinFilter')) n++;
    if (getFilterVal('pushFilter')) n++;
    if (getFilterVal('followupFilter')) n++;
    if (getFilterVal('priorityFilter')) n++;
    if (filterTags.length) n++;
    if (excludedStatuses && excludedStatuses.size) n++;
    return n;
}

function renderActiveFilterChips() {
    const bar = document.getElementById('activeFilterChips');
    if (!bar) return;
    const chips = [];
    const add = (label, clearFn) => {
        chips.push(`<span class="active-filter-chip">${escapeHtml(label)}<button type="button" onclick="${clearFn}">×</button></span>`);
    };
    const gv = (id) => { const e = document.getElementById(id); return e ? e.options[e.selectedIndex]?.text : ''; };

    if (getFilterVal('companyFilter')) add('Entreprise: ' + gv('companyFilter'), "document.getElementById('companyFilter').value='';filterProspects()");
    if (getFilterVal('statusFilter')) add('Statut: ' + gv('statusFilter'), "document.getElementById('statusFilter').value='';filterProspects()");
    if (getFilterVal('pertinenceFilter')) add('Pertinence: ' + gv('pertinenceFilter'), "document.getElementById('pertinenceFilter').value='';filterProspects()");
    if (getFilterVal('phoneFilter')) add('Tél: ' + gv('phoneFilter'), "document.getElementById('phoneFilter').value='';filterProspects()");
    if (getFilterVal('emailFilter')) add('Email: ' + gv('emailFilter'), "document.getElementById('emailFilter').value='';filterProspects()");
    if (getFilterVal('linkedinFilter')) add('LinkedIn: ' + gv('linkedinFilter'), "document.getElementById('linkedinFilter').value='';filterProspects()");
    if (getFilterVal('pushFilter')) add('Push: ' + gv('pushFilter'), "document.getElementById('pushFilter').value='';filterProspects()");
    if (getFilterVal('followupFilter')) add('Relance: ' + gv('followupFilter'), "document.getElementById('followupFilter').value='';filterProspects()");
    if (getFilterVal('priorityFilter')) add('Priorité: P' + getFilterVal('priorityFilter'), "document.getElementById('priorityFilter').value='';filterProspects()");
    filterTags.forEach((t, i) => add('🏷️ ' + t, `removeFilterTag(${i})`));
    if (excludedStatuses && excludedStatuses.size) add('🚫 ' + excludedStatuses.size + ' exclu(s)', "excludedStatuses.clear();filterProspects()");

    bar.innerHTML = chips.join('');
    bar.style.display = chips.length ? 'flex' : 'none';

    // update filter count badge
    const cnt = document.getElementById('filterCount');
    const n = countActiveFilters();
    if (cnt) cnt.textContent = n ? `${n} filtre${n > 1 ? 's' : ''} actif${n > 1 ? 's' : ''}` : '';

    // update toggle button
    const btn = document.getElementById('btnToggleFilters');
    if (btn) btn.innerHTML = n ? `⚙️ Filtres <span class="filter-badge">${n}</span>` : '⚙️ Filtres';
}

function resetAllFilters() {
    ['companyFilter','statusFilter','pertinenceFilter','phoneFilter','emailFilter','linkedinFilter','pushFilter','followupFilter','priorityFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    filterTags = [];
    renderFilterTagChips();
    if (excludedStatuses) excludedStatuses.clear();
    filterProspects();
}

function matchWithWithout(filterVal, fieldVal) {
    if (!filterVal) return true;
    const has = fieldVal && String(fieldVal).trim() !== '';
    if (filterVal === 'with') return has;
    if (filterVal === 'without') return !has;
    return true;
}

let _showContacts = false;

// toggleContactsView kept for backward compat (old pages)
function toggleContactsView() {
    window.location.href = '/?contacts=1';
}

function moveToContacts(id) {
    const p = data.prospects.find(x => x.id === id);
    if (!p) return;
    const label = p.name || 'Ce prospect';
    if (!confirm(`📁 Déplacer "${label}" vers le vivier de contacts ?`)) return;
    p.is_contact = 1;
    saveToServer();
    closeDetail();
    filterProspects();
    showToast(`📁 ${label} déplacé vers les contacts`, 'success');
}

function restoreFromContacts(id) {
    const p = data.prospects.find(x => x.id === id);
    if (!p) return;
    p.is_contact = 0;
    saveToServer();
    closeDetail();
    filterProspects();
    showToast(`👥 ${p.name} restauré dans les prospects`, 'success');
}

function filterProspects() {
    const shouldPreserveProspScroll = (_currentView === 'prosp' && _prospSession.active);
    const prospScrollSnapshot = shouldPreserveProspScroll
        ? _captureProspectsScrollState(_prospSession.currentId)
        : null;

    const search = document.getElementById('searchInput').value.toLowerCase();
    const company = getFilterVal('companyFilter');
    const status = getFilterVal('statusFilter');
    const pertinence = getFilterVal('pertinenceFilter');
    const phoneFilter = getFilterVal('phoneFilter');
    const emailFilter = getFilterVal('emailFilter');
    const linkedinFilter = getFilterVal('linkedinFilter');
    const pushFilter = getFilterVal('pushFilter');
    const followup = getFilterVal('followupFilter');
    const priorityFilter = getFilterVal('priorityFilter');

    let baseProspects = data.prospects;

    // Filter contacts vs prospects
    if (_showContacts) {
        baseProspects = baseProspects.filter(p => Number(p.is_contact) === 1);
    } else {
        baseProspects = baseProspects.filter(p => !p.is_contact || Number(p.is_contact) === 0);
    }

    if (currentView === 'actions') {
        baseProspects = baseProspects.filter(p => ['À rappeler', 'Rendez-vous', 'Messagerie'].includes(p.statut));
        document.getElementById('viewTitle').textContent = '⏰ Actions à faire';
    } else {
        document.getElementById('viewTitle').textContent = _showContacts ? '📁 Vivier de contacts' : '👥 Tous les prospects';
    }
    syncStatsCardsMode();

    // v26: Optimisation — créer un Map pour lookup companies (évite find() répétés dans le filtre)
    const companyMapForFilter = new Map();
    data.companies.forEach(c => companyMapForFilter.set(c.id, c));
    
    filteredProspects = baseProspects.filter(p => {
        const companyObj = companyMapForFilter.get(p.company_id);
        const companyName = companyObj?.groupe || '';
        const companySite = companyObj?.site || '';
        const notesText = (p.notes || '');
        const callNotesText = Array.isArray(p.callNotes) ? p.callNotes.map(n => (n.content || '')).join(' ') : '';
        const tagsText = (Array.isArray(p.tags) ? p.tags.join(' ') : '');
        const haystack = `${p.name || ''} ${p.fonction || ''} ${companyName} ${companySite} ${p.telephone || ''} ${p.email || ''} ${p.linkedin || ''} ${p.statut || ''} ${notesText} ${callNotesText} ${tagsText}`.toLowerCase();

        // Tags/compétences filter (AND logic)
        let okTags = true;
        if (filterTags.length) {
            const prospectTags = new Set((Array.isArray(p.tags) ? p.tags : []).map(t => t.toLowerCase()));
            okTags = filterTags.every(ft => prospectTags.has(ft.toLowerCase()) || haystack.includes(ft.toLowerCase()));
        }

        return (!search || haystack.includes(search)) &&
               (!company || p.company_id == company) &&
               (!excludedStatuses || excludedStatuses.size === 0 || !excludedStatuses.has(p.statut)) &&
               matchWithWithout(phoneFilter, p.telephone) &&
               matchWithWithout(emailFilter, p.email) &&
               matchWithWithout(linkedinFilter, p.linkedin) &&
               (!pushFilter || (pushFilter === 'sent' ? (!!(p.pushEmailSentAt && String(p.pushEmailSentAt).trim())) : (pushFilter === 'unsent' ? ((p.email && String(p.email).trim() !== '') && !(p.pushEmailSentAt && String(p.pushEmailSentAt).trim())) : true))) &&
               (!status || p.statut === status) &&
               (!pertinence || String(p.pertinence) === String(pertinence)) &&
               (!priorityFilter || String(p.priority || '') === String(priorityFilter)) &&
               (!followup || (followup === 'due' ? (p.nextFollowUp && p.nextFollowUp <= todayISO()) : (followup === 'has' ? (!!p.nextFollowUp) : (!p.nextFollowUp)))) &&
               okTags;
    });

    applySort();
    _currentPage = 1; // Reset pagination when filters change
    if (prospScrollSnapshot) {
        _queueProspectsScrollRestore(prospScrollSnapshot);
    }
    renderProspects(); // v26: utilise maintenant RAF pour éviter re-renders multiples
    updateBulkBar();
    updateSelectAllState();
    renderActiveFilterChips();
    if (_currentView === 'prosp') {
        syncProspSessionWithFilteredList();
    }
}

function syncStatsCardsMode() {
    const cards = document.querySelectorAll('.stats .stat-card');
    if (!cards || cards.length === 0) return;
    cards.forEach((card, idx) => {
        const keepVisible = !_showContacts || idx === 0;
        card.style.display = keepVisible ? '' : 'none';
    });
}


function applySort() {
    // v26: Optimisation — créer un Map pour lookup companies (évite find() répétés)
    const companyMapForSort = new Map();
    data.companies.forEach(c => companyMapForSort.set(c.id, c));
    const getCompanyName = (p) => {
        const c = companyMapForSort.get(p.company_id);
        return (c?.groupe || '') + ' ' + (c?.site || '');
    };

    filteredProspects.sort((a, b) => {
        const dir = (sortDir === 'asc') ? 1 : -1;

        if (sortKey === 'id') {
            return dir * (a.id - b.id);
        }
        if (sortKey === 'name') {
            return dir * (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
        }
        if (sortKey === 'company') {
            return dir * getCompanyName(a).localeCompare(getCompanyName(b), 'fr', { sensitivity: 'base' });
        }
        if (sortKey === 'statut') {
            return dir * (a.statut || '').localeCompare(b.statut || '', 'fr', { sensitivity: 'base' });
        }
        if (sortKey === 'pertinence') {
            return dir * ((parseInt(a.pertinence || '0', 10)) - (parseInt(b.pertinence || '0', 10)));
        }
        if (sortKey === 'score') {
            return dir * (computeProspectScore(a) - computeProspectScore(b));
        }
        if (sortKey === 'lastContact') {
            const da = a.lastContact || '';
            const db = b.lastContact || '';
            return dir * da.localeCompare(db);
        }
        if (sortKey === 'nextFollowUp') {
            const emptyHigh = (sortDir === 'asc') ? '9999-12-31' : '';
            const da = (a.nextFollowUp || '').trim() || emptyHigh;
            const db = (b.nextFollowUp || '').trim() || emptyHigh;
            return dir * da.localeCompare(db);
        }
        return 0;
    });

    updateSortIndicators();
}

function setSort(key) {
    if (!key) return;
    if (sortKey === key) {
        sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
    } else {
        sortKey = key;
        // Par défaut : dates desc, le reste asc
        sortDir = (key === 'lastContact' || key === 'id') ? 'desc' : (key === 'nextFollowUp' ? 'asc' : (key === 'score' ? 'desc' : 'asc'));
    }
    applySort();
    renderProspects();
    updateSelectAllState();
}

function updateSortIndicators() {
    const ids = ['id','name','company','pertinence','score','statut','lastContact','nextFollowUp'];
    ids.forEach(k => {
        const el = document.getElementById(`sort-${k}`);
        if (!el) return;
        if (k !== sortKey) { el.textContent = ''; return; }
        el.textContent = (sortDir === 'asc') ? '▲' : '▼';
    });
}

function toggleSelect(id, isChecked) {
    if (isChecked) selectedProspects.add(id);
    else selectedProspects.delete(id);
    // Garder les deux checkboxes (desktop + mobile) synchronisées
    const row = document.querySelector('#tableBody tr[data-prospect-id="' + id + '"]');
    if (row) row.querySelectorAll('input.row-select').forEach(function (cb) { cb.checked = isChecked; });
    updateBulkBar();
    updateSelectAllState();
}

function toggleSelectAll(isChecked) {
    if (isChecked) {
        filteredProspects.forEach(p => selectedProspects.add(p.id));
    } else {
        filteredProspects.forEach(p => selectedProspects.delete(p.id));
    }
    renderProspects();
    updateBulkBar();
    updateSelectAllState();
}

function clearSelection() {
    selectedProspects.clear();
    renderProspects();
    updateBulkBar();
    updateSelectAllState();
}

function updateSelectAllState() {
    const cb = document.getElementById('selectAll');
    if (!cb) return;
    if (filteredProspects.length === 0) {
        cb.checked = false;
        cb.indeterminate = false;
        return;
    }
    const selectedCount = filteredProspects.filter(p => selectedProspects.has(p.id)).length;
    cb.checked = selectedCount === filteredProspects.length;
    cb.indeterminate = selectedCount > 0 && selectedCount < filteredProspects.length;
}

function updateBulkBar() {
    const bulk = document.getElementById('bulkActions');
    const countEl = document.getElementById('bulkCount');
    if (!bulk || !countEl) return;
    const count = selectedProspects.size;
    countEl.textContent = count;
    bulk.style.display = count > 0 ? 'flex' : 'none';
}

async function applyBulkStatus() {
    const status = document.getElementById('bulkStatus').value;
    if (!status) return;
    
    const ids = Array.from(selectedProspects);
    const total = ids.length;
    if (total === 0) return;
    
    let updated = 0;
    for (const id of ids) {
        const p = data.prospects.find(x => x.id === id);
        if (p) {
            p.statut = status;
            updated++;
            showBulkProgress(updated, total, 'prospects mis à jour...');
            flashRowSuccess(id);
            // Petit délai pour visualiser la progression
            if (total > 10) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    }
    
    await saveToServerAsync();
    filterProspects(); // refresh list & stats
    selectedProspects.clear();
    updateBulkBar();
    showToast(`✅ ${updated} prospect(s) mis à jour`, 'success');
}

async function applyBulkPertinence() {
    const per = document.getElementById('bulkPertinence').value;
    if (!per) return;
    
    const ids = Array.from(selectedProspects);
    const total = ids.length;
    if (total === 0) return;
    
    let updated = 0;
    for (const id of ids) {
        const p = data.prospects.find(x => x.id === id);
        if (p) {
            p.pertinence = per;
            updated++;
            showBulkProgress(updated, total, 'prospects mis à jour...');
            flashRowSuccess(id);
            // Petit délai pour visualiser la progression
            if (total > 10) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    }
    
    await saveToServerAsync();
    filterProspects();
    selectedProspects.clear();
    updateBulkBar();
    showToast(`✅ ${updated} prospect(s) mis à jour`, 'success');
}

async function applyBulkRelance() {
    const sel = document.getElementById('bulkRelance');
    const dateInput = document.getElementById('bulkRelanceDate');
    const val = sel && sel.value ? sel.value : '';
    if (!val || selectedProspects.size === 0) return;
    let dateStr = null;
    if (val === 'date') {
        dateStr = dateInput && dateInput.value ? dateInput.value.trim() : null;
        if (!dateStr) {
            if (typeof showToast === 'function') showToast('Choisissez une date ou +3j / +7j / +30j', 'warning');
            return;
        }
    } else {
        const days = parseInt(val.replace('+', ''), 10);
        if (!Number.isNaN(days)) dateStr = addDaysISO(todayISO(), days);
    }
    const ids = Array.from(selectedProspects);
    const total = ids.length;
    
    try {
        // Afficher la progression pendant l'appel API
        showBulkProgress(0, total, 'relances en cours...');
        
        const res = await fetch('/api/prospects/bulk-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids, nextFollowUp: dateStr }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        
        // Mettre à jour avec progression visuelle
        let updated = 0;
        for (const id of ids) {
            const p = data.prospects.find(x => x.id === id);
            if (p) {
                p.nextFollowUp = dateStr;
                updated++;
                showBulkProgress(updated, total, 'relances appliquées...');
                flashRowSuccess(id);
                if (total > 10) {
                    await new Promise(resolve => setTimeout(resolve, 30));
                }
            }
        }
        
        selectedProspects.clear();
        updateBulkBar();
        filterProspects();
        updateOverdueAlerts();
        if (typeof showToast === 'function') showToast('Relance appliquée à ' + (json.updated || ids.length) + ' prospect(s)', 'success');
    } catch (e) {
        hideBulkProgress();
        if (typeof showToast === 'function') showToast(e.message || 'Erreur bulk relance', 'error');
    }
}

async function applyBulkRelanceDone() {
    if (selectedProspects.size === 0) return;
    const ids = Array.from(selectedProspects);
    const total = ids.length;
    
    try {
        // Afficher la progression pendant l'appel API
        showBulkProgress(0, total, 'relances en cours...');
        
        const res = await fetch('/api/prospects/bulk-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids, nextFollowUp: null }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        
        // Mettre à jour avec progression visuelle
        let updated = 0;
        for (const id of ids) {
            const p = data.prospects.find(x => x.id === id);
            if (p) {
                p.nextFollowUp = null;
                updated++;
                showBulkProgress(updated, total, 'relances marquées faites...');
                flashRowSuccess(id);
                if (total > 10) {
                    await new Promise(resolve => setTimeout(resolve, 30));
                }
            }
        }
        
        selectedProspects.clear();
        updateBulkBar();
        filterProspects();
        updateOverdueAlerts();
        if (typeof showToast === 'function') showToast('Relance marquée faite pour ' + (json.updated || ids.length) + ' prospect(s)', 'success');
    } catch (e) {
        hideBulkProgress();
        if (typeof showToast === 'function') showToast(e.message || 'Erreur', 'error');
    }
}

async function deleteSelectedProspects() {
    const count = selectedProspects.size;
    if (count === 0) return;
    if (!confirm(`⚠️ Supprimer définitivement ${count} prospect(s) ?`)) return;

    const ids = Array.from(selectedProspects);
    const total = ids.length;
    
    // Afficher la progression
    let deleted = 0;
    for (const id of ids) {
        const index = data.prospects.findIndex(p => p.id === id);
        if (index !== -1) {
            data.prospects.splice(index, 1);
            deleted++;
            showBulkProgress(deleted, total, 'prospects supprimés...');
            if (total > 10) {
                await new Promise(resolve => setTimeout(resolve, 30));
            }
        }
    }
    
    selectedProspects.clear();
    await saveToServerAsync({ confirmMassDelete: true });
    filterProspects();
    updateBulkBar();
    showToast(`✅ ${deleted} prospect(s) supprimé(s)`, 'success');
}

// todayISO() est défini dans les helpers globaux (en haut du fichier).

// Addition robuste de jours sur une date ISO (YYYY-MM-DD) sans décalage UTC/local.
function addDaysISO(isoDate, days) {
    const parts = String(isoDate || '').split('-').map(n => parseInt(n, 10));
    if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return String(isoDate || '');
    const [y, m, d] = parts;
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
    return dt.toISOString().slice(0, 10);
}

// Raccourcis relance dans la fiche prospect : met à jour le champ date (aujourd'hui + N jours).
function setRelanceShortcut(days) {
    const el = document.getElementById('editNextFollowUp');
    if (el) el.value = addDaysISO(todayISO(), Number(days) || 0);
}

// Depuis l'onglet Infos : fixe la relance (aujourd'hui + N jours), enregistre et met à jour l'affichage.
function setRelanceFromInfo(prospectId, days) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return;
    p.nextFollowUp = addDaysISO(todayISO(), Number(days) || 0);
    saveToServer();
    const valEl = document.getElementById('detailRelanceValue');
    if (valEl) {
        valEl.innerHTML = escapeHtml(p.nextFollowUp);
    }
    try { filterProspects(); } catch (e) {}
    if (typeof showToast === 'function') showToast('Relance programmée : ' + p.nextFollowUp, 'success');
}

function setFollowup(prospectId, days) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return;
    const base = (p.nextFollowUp && p.nextFollowUp >= todayISO()) ? p.nextFollowUp : todayISO();
    p.nextFollowUp = addDaysISO(base, days);
    saveToServer();
    filterProspects();
}

function clearFollowup(prospectId) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return;
    p.nextFollowUp = '';
    saveToServer();
    filterProspects();
}

function renderFollowupCell(p) {
    // Desktop: keep it clean (no quick buttons). Mobile uses its own compact rendering.
    const iso = (p.nextFollowUp || '').trim();
    if (!iso) {
        return `<span class="muted">—</span>`;
    }
    const due = iso <= todayISO();
    const pr = (p.priority !== undefined && p.priority !== null) ? `P${p.priority}` : '';
    return `<span class="followup-badge ${due ? 'due' : 'ok'}" title="Relance">${iso}${pr ? ` · ${pr}` : ''}</span>`;
}


// ─────────────────────────────────────────────────────────────
// Mobile helpers (Prospects list)
// ─────────────────────────────────────────────────────────────
function getStatusMeta(statut) {
    const s = String(statut || '').toLowerCase();
    if (!s) return { icon: '•', slug: 'none', label: '' };

    if (s.includes('messagerie')) return { icon: '💬', slug: 'messagerie', label: 'Messagerie' };
    if (s.includes('rendez')) return { icon: '🤝', slug: 'rdv', label: 'RDV' };
    if (s.includes('rencontr')) return { icon: '✅', slug: 'rencontre', label: 'Rencontré' };
    if (s.includes('prospecté') || s.includes('prospecte')) return { icon: '🎯', slug: 'prospecte', label: 'Prospecté' };
    if (s.includes('à rappeler') || s.includes('rappeler')) return { icon: '⏳', slug: 'rappeler', label: 'À rappeler' };
    if (s.includes('appel')) return { icon: '📞', slug: 'appele', label: 'Appelé' };
    if (s.includes('pas intéress')) return { icon: '❌', slug: 'pas-interesse', label: 'Pas intéressé' };
    if (s.includes("pas d'actions") || s.includes('pas dactions')) return { icon: '✓', slug: 'pas-actions', label: 'Pas d\'actions' };

    return { icon: '•', slug: 'autre', label: (statut || '').slice(0, 12) };
}

function _statusSlugToBadgeClass(slug) {
    const map = { rappeler: 'badge-à-rappeler', appele: 'badge-appelé', rdv: 'badge-rdv', messagerie: 'badge-messagerie', rencontre: 'badge-rencontre', 'pas-interesse': 'badge-pas-intéressé', 'pas-actions': 'badge-pas-d\'actions' };
    return map[slug] || '';
}

function renderFollowupMini(p) {
    const iso = (p && p.nextFollowUp) ? String(p.nextFollowUp).trim() : '';
    if (!iso) return '';
    const due = iso <= todayISO();
    return `<span class="followup-mini ${due ? 'due' : 'ok'}" title="Relance">${due ? '⚠️' : '📅'} ${escapeHtml(iso)}</span>`;
}

function renderPushMini(p) {
    const hasEmail = (p && p.email) ? String(p.email).trim() !== '' : false;
    const emailSent = (p && p.pushEmailSentAt) ? String(p.pushEmailSentAt).trim() : '';
    const hasLi = (p && p.linkedin) ? String(p.linkedin).trim() !== '' : false;
    const liSent = (p && p.pushLinkedInSentAt) ? String(p.pushLinkedInSentAt).trim() : '';

    const parts = [];
    if (hasEmail) parts.push(`<span class="push-mini ${emailSent ? 'yes' : 'no'}" title="Push email">${emailSent ? '✉️✅' : '✉️'}</span>`);
    if (hasLi) parts.push(`<span class="push-mini ${liSent ? 'yes' : 'no'}" title="Push LinkedIn">${liSent ? 'in✅' : 'in'}</span>`);
    return parts.join('');
}

function _totalPages() {
    if (_pageSize <= 0 || filteredProspects.length === 0) return 1;
    return Math.ceil(filteredProspects.length / _pageSize);
}

function _clampPage() {
    const tp = _totalPages();
    if (_currentPage < 1) _currentPage = 1;
    if (_currentPage > tp) _currentPage = tp;
}

function goToPage(p) {
    _currentPage = p;
    _clampPage();
    renderProspects();
    // Scroll to top of table
    var tbl = document.getElementById('tableBody');
    if (tbl) tbl.closest('.table-container')?.scrollTo({top: 0, behavior: 'smooth'});
}

function changePageSize(val) {
    var n = parseInt(val, 10);
    if (n > 0) {
        _pageSize = n;
        localStorage.setItem('prospup_pageSize', String(n));
        _currentPage = 1;
        renderProspects();
    }
}

function _renderPagination() {
    var container = document.getElementById('paginationControls');
    if (!container) return;
    var total = filteredProspects.length;
    if (total <= 25) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }
    container.style.display = '';
    var tp = _totalPages();
    _clampPage();
    var start = (_currentPage - 1) * _pageSize + 1;
    var end = Math.min(_currentPage * _pageSize, total);

    var html = '<div class="pagination-bar">';
    html += '<div class="pagination-info">';
    html += '<span>' + start + '–' + end + ' sur ' + total + '</span>';
    html += ' <select class="pagination-size-select" onchange="changePageSize(this.value)" title="Prospects par page">';
    [25, 50, 100].forEach(function(s) {
        html += '<option value="' + s + '"' + (s === _pageSize ? ' selected' : '') + '>' + s + ' / page</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '<div class="pagination-pages">';
    // Previous button
    html += '<button class="pagination-btn" ' + (_currentPage <= 1 ? 'disabled' : '') + ' onclick="goToPage(' + (_currentPage - 1) + ')" title="Page précédente">&lsaquo;</button>';

    // Page numbers with smart ellipsis
    var pages = [];
    if (tp <= 7) {
        for (var i = 1; i <= tp; i++) pages.push(i);
    } else {
        pages.push(1);
        if (_currentPage > 3) pages.push('...');
        var rangeStart = Math.max(2, _currentPage - 1);
        var rangeEnd = Math.min(tp - 1, _currentPage + 1);
        for (var i = rangeStart; i <= rangeEnd; i++) pages.push(i);
        if (_currentPage < tp - 2) pages.push('...');
        pages.push(tp);
    }
    pages.forEach(function(p) {
        if (p === '...') {
            html += '<span class="pagination-ellipsis">…</span>';
        } else {
            html += '<button class="pagination-btn' + (p === _currentPage ? ' pagination-active' : '') + '" onclick="goToPage(' + p + ')">' + p + '</button>';
        }
    });

    // Next button
    html += '<button class="pagination-btn" ' + (_currentPage >= tp ? 'disabled' : '') + ' onclick="goToPage(' + (_currentPage + 1) + ')" title="Page suivante">&rsaquo;</button>';
    html += '</div></div>';
    container.innerHTML = html;
}

// v26: Optimisation — éviter les re-renders multiples avec RAF
let _renderProspectsRaf = null;
function renderProspects() {
    if (_renderProspectsRaf) {
        cancelAnimationFrame(_renderProspectsRaf);
        _renderProspectsRaf = null;
    }
    _renderProspectsRaf = requestAnimationFrame(() => {
        _renderProspectsRaf = null;
        _renderProspectsImpl();
    });
}

function _renderProspectsImpl() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    
    // v26: Optimisation performance — utiliser DocumentFragment pour batch DOM updates
    const fragment = document.createDocumentFragment();
    tbody.innerHTML = '';

    if (filteredProspects.length === 0) {
        // Distinguish: no prospects at all vs active filter returning 0 results
        const noDataAtAll = data.prospects.length === 0;
        if (noDataAtAll) {
            tbody.innerHTML = `<tr><td colspan="13">
                <div style="text-align:center;padding:60px 20px;">
                    <div style="font-size:48px;margin-bottom:16px;">📋</div>
                    <div style="font-size:18px;font-weight:600;margin-bottom:8px;color:var(--color-text,#e2e8f0)">Aucun prospect pour l'instant</div>
                    <div style="color:var(--color-text-secondary,#94a3b8);font-size:14px;margin-bottom:24px;">Commencez par importer une liste ou ajouter votre premier prospect.</div>
                    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                        <button class="btn btn-primary" onclick="openImportListModal && openImportListModal()">📥 Importer une liste Excel</button>
                        <button class="btn btn-secondary" onclick="openNewProspectModal && openNewProspectModal()">+ Ajouter un prospect</button>
                    </div>
                </div>
            </td></tr>`;
        } else {
            tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 40px; color: var(--color-text-secondary,#94a3b8);">Aucun prospect ne correspond aux filtres actifs.</td></tr>';
        }
        updateStats([]);
        _renderPagination();
        _flushProspectsScrollRestore();
        return;
    }

    // Pagination: slice to current page
    _clampPage();
    var startIdx = (_currentPage - 1) * _pageSize;
    var endIdx = Math.min(startIdx + _pageSize, filteredProspects.length);
    var pageProspects = filteredProspects.slice(startIdx, endIdx);

    // v26: Optimisation — créer un Map pour lookup companies (évite find() répétés)
    const companyMap = new Map();
    data.companies.forEach(c => companyMap.set(c.id, c));

    // Desktop : tableau avec 13 colonnes triables + bouton Voir. Mobile : carte (premier td) via CSS.
    pageProspects.forEach((prospect, pageIdx) => {
        const company = companyMap.get(prospect.company_id);
        const stMeta = getStatusMeta(prospect.statut);
        const companyName = (company && company.groupe) ? String(company.groupe).trim() : '';
        const mobileSub = companyName ? escapeHtml(companyName) : '—';
        const telRaw = (prospect.telephone && String(prospect.telephone).trim()) ? String(prospect.telephone).trim() : '';
        const telShort = telRaw.slice(0, 20);
        const mobileMetaParts = [];
        if (telShort) mobileMetaParts.push('<span class="prospect-card-mobile-tel">📞 ' + escapeHtml(telShort) + '</span>');
        const followupMini = renderFollowupMini(prospect);
        if (followupMini) mobileMetaParts.push(followupMini);
        const mobileMeta = mobileMetaParts.join(' ');
        const displayName = (prospect.name && String(prospect.name).trim()) ? escapeHtml(prospect.name) : '—';
        const statusLabel = (stMeta.label && stMeta.slug !== 'none') ? escapeHtml(stMeta.label) : '';
        const pid = Number(prospect.id) || 0;
        const checked = selectedProspects.has(prospect.id) ? ' checked' : '';

        const pert = Math.min(5, Math.max(0, parseInt(prospect.pertinence || '3', 10) || 0));
        const stars = '★'.repeat(pert) + '☆'.repeat(5 - pert);
        const score = typeof computeProspectScore === 'function' ? computeProspectScore(prospect) : '—';
        const lastContact = (prospect.lastContact && String(prospect.lastContact).trim()) ? escapeHtml(String(prospect.lastContact).slice(0, 10)) : '—';
        const nextFollowUpStr = (prospect.nextFollowUp && String(prospect.nextFollowUp).trim()) ? escapeHtml(String(prospect.nextFollowUp).slice(0, 10)) : '—';
        const fonctionStr = (prospect.fonction && String(prospect.fonction).trim()) ? escapeHtml(prospect.fonction) : '—';

        const mobileCardHtml =
            '<div class="prospect-card-mobile mobile-only">' +
            '<div class="prospect-card-mobile-inner">' +
            '<span class="prospect-card-mobile-check"><input type="checkbox" class="row-select" title="Sélectionner"' + checked + ' onclick="event.stopPropagation();toggleSelect(' + pid + ',this.checked)"></span>' +
            '<div class="prospect-card-mobile-body">' +
            '<div class="prospect-card-mobile-name">' + displayName + '</div>' +
            '<div class="prospect-card-mobile-company">' + mobileSub + '</div>' +
            (mobileMeta ? '<div class="prospect-card-mobile-meta">' + mobileMeta + '</div>' : '') +
            (statusLabel ? '<div class="prospect-card-mobile-status">' + statusLabel + '</div>' : '') +
            '</div>' +
            '<span class="prospect-card-mobile-chevron">›</span>' +
            '</div></div>';

        const row = document.createElement('tr');
        row.dataset.prospectId = String(prospect.id);
        row.className = 'prospect-row';
        row.style.cursor = 'pointer';
        row.addEventListener('click', function (e) {
            if (e.target.tagName === 'INPUT' || e.target.closest('.prospect-card-mobile-check') || e.target.closest('button')) return;
            viewDetail(prospect.id);
        });
        row.innerHTML =
            '<td class="prospect-td-check">' +
            '<input type="checkbox" class="row-select desktop-checkbox" title="Sélectionner"' + checked + ' onclick="event.stopPropagation();toggleSelect(' + pid + ',this.checked)">' +
            mobileCardHtml +
            '</td>' +
            '<td>' + (prospect.id || '') + '</td>' +
            '<td class="name-cell-with-tel">' + '<span class="name-cell">' + displayName + '</span>' +
            (telRaw ? '<a href="javascript:void(0)" class="phone-dot has-phone" onclick="event.stopPropagation();callNumberById(' + pid + ')" title="Appeler">📞</a>' : '') + '</td>' +
            '<td>' + (companyName ? escapeHtml(companyName) : '—') + '</td>' +
            '<td>' + fonctionStr + '</td>' +
            '<td class="stars-cell" title="Pertinence">' + stars + '</td>' +
            '<td>' + score + '</td>' +
            '<td class="table-statut-cell"><span class="table-statut-badge ' + (_statusSlugToBadgeClass(stMeta.slug)) + '">' + (stMeta.label ? escapeHtml(stMeta.label) : '—') + '</span></td>' +
            '<td>' + lastContact + '</td>' +
            '<td>' + renderEmailCell(prospect) + '</td>' +
            '<td>' + renderPushCell(prospect) + '</td>' +
            '<td>' + nextFollowUpStr + '</td>' +
            '<td class="prospect-actions-cell">' +
            '<div class="prospect-actions-inner"><button type="button" class="btn btn-secondary prospect-action-voir" onclick="event.stopPropagation();viewDetail(' + pid + ')" title="Voir fiche">Voir</button></div>' +
            '</td>';
        fragment.appendChild(row);
    });
    
    // v26: Append fragment en une seule opération DOM (plus rapide)
    tbody.appendChild(fragment);

    // Stats use ALL filtered prospects (not just current page)
    updateStats(filteredProspects);
    _renderPagination();
    if (typeof renderKanban === 'function') renderKanban();
    _flushProspectsScrollRestore();
}

// v26: Alias pour compatibilité (anciens appels directs)
function _renderProspectsDirect() {
    _renderProspectsImpl();
}

function renderEmailCell(p) {
    const email = (p && p.email) ? String(p.email).trim() : '';
    if (!email) return '<span class="email-indicator no-email" title="Pas d\'email">✉️</span>';
    const escaped = escapeHtml(email).replace(/'/g, "\\'");
    return `<span class="email-indicator has-email" onclick="copyEmailToClipboard('${escaped}')" title="${escapeHtml(email)} — Cliquer pour copier">✉️</span>`;
}

function renderPushCell(p) {
    const parts = [];
    const hasEmail = (p && p.email) ? String(p.email).trim() !== '' : false;
    const emailSent = (p && p.pushEmailSentAt) ? String(p.pushEmailSentAt).trim() : '';
    const hasLi = (p && p.linkedin) ? String(p.linkedin).trim() !== '' : false;
    const liSent = (p && p.pushLinkedInSentAt) ? String(p.pushLinkedInSentAt).trim() : '';

    // Make the push icons interactive: clicking the envelope calls openEmailForProspect(id), clicking "in" copies a LinkedIn message.
    if (hasEmail) {
        parts.push(`<span class="push-badge ${emailSent ? 'push-yes' : 'push-no'}" title="Email${emailSent ? (' · ' + escapeHtml(emailSent)) : ''}" onclick="openEmailForProspect(${p.id})" style="cursor:pointer;">✉️${emailSent ? '✅' : ''}</span>`);
    }
    if (hasLi) {
        parts.push(`<span class="push-badge ${liSent ? 'push-yes' : 'push-no'}" title="LinkedIn${liSent ? (' · ' + escapeHtml(liSent)) : ''}" onclick="copyLinkedInForProspect(${p.id})" style="cursor:pointer;margin-left:6px;">in${liSent ? '✅' : ''}</span>`);
    }
    if (!parts.length) return '<span class="push-badge push-na" title="Pas de canal">—</span>';

    // Mini sparkline from callNotes activity (last 4 weeks)
    if (typeof window.generateSparkline === 'function') {
        try {
            const notes = Array.isArray(p.callNotes) ? p.callNotes : [];
            if (notes.length > 0) {
                const now = new Date();
                const weeks = [0,0,0,0];
                notes.forEach(function(n) {
                    if (!n.date) return;
                    const diff = Math.floor((now - new Date(n.date)) / (7*86400000));
                    if (diff >= 0 && diff < 4) weeks[3-diff]++;
                });
                if (weeks.some(function(v){return v>0;})) {
                    parts.push('<span style="margin-left:4px;" title="Activité 4 sem.">' + window.generateSparkline(weeks) + '</span>');
                }
            }
        } catch(e) {}
    }

    return parts.join('');
}

function isProspectCallable(p) {
    const tel = (p && p.telephone) ? String(p.telephone) : '';
    if (!tel) return false;
    // Un prospect est "appelable" s'il contient au moins un chiffre (et extractPhoneNumbers en trouve idéalement).
    try {
        const phones = extractPhoneNumbers(tel);
        if (Array.isArray(phones) && phones.length > 0) return true;
    } catch (e) {}
    return /\d/.test(tel);
}

function updateStats(prospects) {
    const activeProspects = Array.isArray(prospects) ? prospects : [];
    const totalEl = document.getElementById('totalCount');
    if (totalEl) totalEl.textContent = activeProspects.length;

    if (_showContacts) {
        const calledEl = document.getElementById('appeléCount');
        const rdvEl = document.getElementById('rdvCount');
        const interactionsEl = document.getElementById('intéressésCount');
        if (calledEl) calledEl.textContent = '-';
        if (rdvEl) rdvEl.textContent = '-';
        if (interactionsEl) interactionsEl.textContent = '-';
        updateOverdueAlerts([]);
        return;
    }

    // ORANGE : nombre de prospects "appelables" (champ téléphone rempli / exploitable)
    document.getElementById('appeléCount').textContent = activeProspects.filter(p => isProspectCallable(p)).length;

    // VERT : RDV (exclude Rencontré — they've been met)
    document.getElementById('rdvCount').textContent = activeProspects.filter(p => p.statut === 'Rendez-vous').length;

    // BLEU : prospectés (statut : Prospecté)
    document.getElementById('intéressésCount').textContent = activeProspects.filter(p => p.statut === 'Prospecté').length;

    // ROUGE : relances en retard
    updateOverdueAlerts(activeProspects);
}

// ═══ Quick filter from stat cards ═══
let _activeStatFilter = null;

function quickFilterStat(type) {
    const sf = document.getElementById('statusFilter');
    const pf = document.getElementById('phoneFilter');

    // Reset filters first
    if (document.getElementById('searchInput')) document.getElementById('searchInput').value = '';
    if (sf) sf.value = '';
    if (pf) pf.value = '';
    if (document.getElementById('companyFilter')) document.getElementById('companyFilter').value = '';
    if (document.getElementById('pertinenceFilter')) document.getElementById('pertinenceFilter').value = '';
    if (document.getElementById('followupFilter')) document.getElementById('followupFilter').value = '';
    if (document.getElementById('pushFilter')) document.getElementById('pushFilter').value = '';
    if (document.getElementById('emailFilter')) document.getElementById('emailFilter').value = '';
    if (document.getElementById('linkedinFilter')) document.getElementById('linkedinFilter').value = '';
    if (document.getElementById('priorityFilter')) document.getElementById('priorityFilter').value = '';
    if (typeof excludedStatuses !== 'undefined' && excludedStatuses) excludedStatuses.clear();
    if (typeof filterTags !== 'undefined' && filterTags) filterTags.length = 0;

    // Deselect previous active card
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('stat-active'));

    if (_activeStatFilter === type) {
        // Toggle off — show all
        _activeStatFilter = null;
        switchView('all');
        return;
    }

    _activeStatFilter = type;

    if (type === 'total') {
        // Just show all — filters already cleared
        _activeStatFilter = null;
        switchView('all');
        return;
    }

    // Highlight active card
    const cardMap = { appelables: '.stat-card.appelé', rdv: '.stat-card.rdv', prospectes: '.stat-card.intéressés' };
    const card = document.querySelector(cardMap[type]);
    if (card) card.classList.add('stat-active');

    if (type === 'appelables') {
        if (pf) pf.value = 'with';
    } else if (type === 'rdv') {
        if (sf) sf.value = 'Rendez-vous';
    } else if (type === 'prospectes') {
        if (sf) sf.value = 'Prospecté';
    }

    filterProspects();
}

// P8: Suggestions de next action selon le statut (heuristiques, pas d'API)
function getNextActionSuggestionsHtml(statut) {
    const suggestions = {
        "À rappeler": ["Relancer dans 1 semaine", "Rappeler demain", "Envoyer email de relance"],
        "Appelé": ["Relancer dans 3 jours", "Envoyer email de suivi", "Planifier RDV"],
        "Rendez-vous": ["Envoyer 2 profils", "Préparer RT technique", "Relancer pour confirmation"],
        "Rencontré": ["Envoyer proposition", "Relancer pour suite", "Demander retour"],
        "Prospecté": ["Planifier nouveau RDV", "Envoyer proposition commerciale", "Relancer pour suite"],
        "Messagerie": ["Relancer par message", "Proposer un appel", "Envoyer doc"],
        "Pas d'actions": ["Premier contact", "Qualifier le besoin", "Présenter Up Technologies"],
        "Pas intéressé": ["Relancer dans 6 mois", "Garder en base"]
    };
    const list = suggestions[statut] || suggestions["Pas d'actions"] || [];
    if (!list.length) return '';
    return '<div class="next-action-suggestions-label muted">Suggestions :</div>' +
        list.map(function (text) {
            var safe = escapeHtml(text).replace(/"/g, '&quot;');
            return '<button type="button" class="next-action-suggestion-chip" data-value="' + safe + '" onclick="var el=document.getElementById(\'editNextAction\'); var v=this.getAttribute(\'data-value\'); if(el&&v) el.value=v">' + escapeHtml(text) + '</button>';
        }).join('');
}

// ═══ Alertes relances en retard ═══
function updateOverdueAlerts(prospects) {
    const today = todayISO();
    const overdue = (prospects || data.prospects || []).filter(p => {
        const nf = (p.nextFollowUp || '').trim();
        return nf && nf < today;
    });
    const overdueCount = overdue.length;
    const dueTodayCount = (prospects || data.prospects || []).filter(p => {
        const nf = (p.nextFollowUp || '').trim();
        return nf && nf === today;
    }).length;

    // 1. Stat-card on main page
    const card = document.getElementById('relancesCard');
    const countEl = document.getElementById('relancesOverdueCount');
    if (card && countEl) {
        if (overdueCount > 0) {
            card.style.display = '';
            countEl.textContent = overdueCount;
        } else {
            card.style.display = 'none';
        }
    }

    // 2. Badge on sidebar Focus nav-button (works on ALL pages)
    _injectSidebarBadge(overdueCount, dueTodayCount);

    // 3. Bannière alerte relances sur la page prospects (P1)
    const bannerEl = document.getElementById('relanceAlertBannerProspects');
    const bannerTextEl = document.getElementById('relanceAlertBannerProspectsText');
    if (bannerEl && bannerTextEl) {
        if (typeof window.getDisplayPref === 'function' && !window.getDisplayPref('display_relance_banner')) {
            bannerEl.style.display = 'none';
            return;
        }
        if (overdueCount > 0 || dueTodayCount > 0) {
            if (!sessionStorage.getItem('relanceAlertDismissed') || (Date.now() - parseInt(sessionStorage.getItem('relanceAlertDismissed'), 10)) >= 3600000) {
                var parts = [];
                if (overdueCount > 0) parts.push(overdueCount + ' relance' + (overdueCount > 1 ? 's' : '') + ' en retard');
                if (dueTodayCount > 0) parts.push(dueTodayCount + ' à faire aujourd\'hui');
                bannerTextEl.textContent = '⚠️ ' + parts.join(' · ');
                bannerEl.style.display = 'flex';
            } else {
                bannerEl.style.display = 'none';
            }
        } else {
            bannerEl.style.display = 'none';
        }
    }
}

function _injectSidebarBadge(overdueCount, dueTodayCount) {
    // Find Focus nav-button in sidebar
    const focusLinks = document.querySelectorAll('a.nav-button[href="/focus"]');
    focusLinks.forEach(link => {
        // Remove all existing badges (avoid duplicate pastilles)
        link.querySelectorAll('.sidebar-alert-badge').forEach(b => b.remove());

        if (overdueCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'sidebar-alert-badge pulse';
            badge.textContent = overdueCount;
            badge.title = `${overdueCount} relance${overdueCount > 1 ? 's' : ''} en retard`;
            link.appendChild(badge);
            link.classList.add('nav-has-alert');
        } else if (dueTodayCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'sidebar-alert-badge today';
            badge.textContent = dueTodayCount;
            badge.title = `${dueTodayCount} relance${dueTodayCount > 1 ? 's' : ''} aujourd'hui`;
            link.appendChild(badge);
            link.classList.add('nav-has-alert');
        } else {
            link.classList.remove('nav-has-alert');
        }
    });
}


async function viewDetail(id) {
    // Stocker l'ID du prospect actuel pour refreshMetierSuggestions
    window._currentDetailProspectId = id;
    window._currentPushTemplate = null; // Reset template
    const prospect = data.prospects.find(p => p.id === id);
    if (!prospect) return;
    const isProspMode = (_currentView === 'prosp' && _prospSession.active);
    if (isProspMode) {
        _syncProspCurrent(id);
        if (typeof _saveProspSessionToStorage === 'function') _saveProspSessionToStorage();
    }
    const prospProgress = isProspMode ? getProspProgress(id) : { index: 0, total: 0 };
    const hasNextInProsp = isProspMode && !!getProspNextId(id);
    const hasPrevInProsp = isProspMode && !!getProspPrevId(id);

    const company = data.companies.find(c => c.id === prospect.company_id);
    const pert = parseInt(prospect.pertinence, 10) || 3;
    const stars = '★'.repeat(pert) + '☆'.repeat(5 - pert);

    // Status color map
    const statusColors = {
        "Pas d'actions": '#64748b', 'Appelé': '#f59e0b', 'Messagerie': '#3b82f6',
        'À rappeler': '#ef4444', 'Rendez-vous': '#22c55e', 'Rencontré': '#10b981', 'Prospecté': '#8b5cf6', 'Pas intéressé': '#94a3b8'
    };
    const heroColor = statusColors[prospect.statut] || '#64748b';
    const initials = (prospect.name || '??').split(/\s+/).map(w => w[0]).slice(0,2).join('');

    // Avatar: photo or initials — clickable to upload
    const photoUrl = prospect.photo_url ? String(prospect.photo_url).trim() : '';
    const avatarInner = photoUrl
        ? `<img class="detail-avatar-img" src="${escapeHtml(photoUrl)}?t=${Date.now()}" alt="${escapeHtml(initials)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="detail-avatar" style="background:${heroColor};display:none;">${escapeHtml(initials)}</div>`
        : `<div class="detail-avatar" style="background:${heroColor};">${escapeHtml(initials)}</div>`;
    const avatarHtml = `<div class="detail-avatar-wrap" onclick="triggerPhotoUpload(${prospect.id})" title="Cliquer pour changer la photo">${avatarInner}<div class="detail-avatar-overlay">📷</div></div>`;

    // Company link → open quick company view popup
    const companyLink = company
        ? `<a href="javascript:void(0)" onclick="openCompanyQuickView(${company.id})" style="color:#fff;opacity:.9;text-decoration:underline dotted;text-underline-offset:3px;" title="Voir les infos de l'entreprise">${escapeHtml(company.groupe || '')} ${escapeHtml(company.site ? '('+company.site+')' : '')}</a>`
        : '';

    // Status select options (for hero)
    const statusOptions = ["Pas d'actions","Appelé","À rappeler","Rendez-vous","Rencontré","Prospecté","Messagerie","Pas intéressé"];
    const statusSelectHtml = statusOptions.map(s =>
        `<option value="${escapeHtml(s)}" ${prospect.statut === s ? 'selected' : ''}>${escapeHtml(s)}</option>`
    ).join('');

    // Notes HTML
    let notesHtml = '';
    if (prospect.callNotes && prospect.callNotes.length > 0) {
        notesHtml = prospect.callNotes.map((note, idx) => `
            <div class="detail-note-card">
                <button class="detail-note-del" title="Supprimer" onclick="deleteCallNote(${id}, ${idx})">🗑️</button>
                <div class="detail-note-date">${escapeHtml(note.date || '')}</div>
                <div class="detail-note-text">${escapeHtml(note.content || '').split('\n').join('<br>')}</div>
            </div>
        `).join('');
    }

    const showCandidats = typeof window.getDisplayPref === 'function' ? window.getDisplayPref('display_candidate_proposition') : true;
    const showTimeline = typeof window.getDisplayPref === 'function' ? window.getDisplayPref('display_prospect_timeline') : true;
    const showPushSection = typeof window.getDisplayPref === 'function' ? window.getDisplayPref('display_prospect_push_section') : true;
    const showMetier = typeof window.getDisplayPref === 'function' ? window.getDisplayPref('display_prospect_metier') : true;

    const html = `
        <input type="file" id="photoFileInput" accept="image/*" style="display:none;" onchange="uploadProspectPhoto(${prospect.id}, this)">

        <div class="detail-hero">
            <div class="detail-hero-bg" style="background: linear-gradient(135deg, ${heroColor} 0%, ${heroColor}bb 100%);"></div>
            <button class="detail-hero-close" onclick="closeDetail()">×</button>
            <div class="detail-hero-content">
                ${avatarHtml}
                <div class="detail-hero-info">
                    <div class="detail-hero-name">${escapeHtml(prospect.name)}</div>
                    <div class="detail-hero-sub">
                        ${prospect.fonction ? `<span>${escapeHtml(prospect.fonction)}</span>` : ''}
                        ${companyLink ? `<span>· ${companyLink}</span>` : ''}
                    </div>
                    <div class="detail-hero-sub" style="margin-top:6px;gap:10px;">
                        <select class="detail-status-select" id="heroStatusSelect" onchange="quickChangeStatus(${prospect.id}, this.value)">
                            ${statusSelectHtml}
                        </select>
                        <span style="color:#fff;opacity:.85;font-size:13px;letter-spacing:-1px;">${stars}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="detail-quick-actions">
            <button class="btn btn-success" onclick="callNumberById(${prospect.id})" ${prospect.telephone ? '' : 'disabled'} title="Appeler le prospect (ouvre l'application téléphone)">📞 Appeler</button>
            ${prospect.email ? `<button class="btn btn-secondary" onclick="openEmailForProspect(${prospect.id})" title="Copier l'email et ouvrir le template Outlook si une catégorie push est définie">✉️ Email</button>` : `<button class="btn btn-secondary" disabled title="Email non renseigné">✉️ Email</button>`}
            <button class="btn btn-primary" onclick="openTeamsInvite(${prospect.id})" title="Copier le profil formaté pour une invitation Teams">📅 Teams</button>
            ${prospect.linkedin ? `<button class="btn btn-secondary" onclick="copyLinkedInForProspect(${prospect.id})" title="Copier le lien LinkedIn dans le presse-papier">📋 LinkedIn</button>` : ''}
            <button class="btn btn-secondary" onclick="downloadVcf(${prospect.id})" title="Télécharger la fiche contact (.vcf)">📇 vCard</button>
            <button class="btn btn-secondary" onclick="handleScanIA(${prospect.id})" title="Rechercher des informations supplémentaires sur internet via l'IA pour enrichir la fiche" data-help-section="scrapping-ia">🔍 Scan IA</button>
        </div>
        ${(prospect.nextAction || '').trim() ? `<div class="detail-next-action-banner" role="status"><strong>🎯 Prochaine action :</strong> ${escapeHtml(prospect.nextAction)}</div>` : ''}

        <div class="detail-tabs">
            <button class="detail-tab active" onclick="switchDetailTab(this,'tab-info')">Infos</button>
            ${showCandidats ? `<button class="detail-tab" onclick="var infosTab=this.parentElement.querySelector('.detail-tab'); switchDetailTab(infosTab,'tab-info'); setTimeout(function(){ document.getElementById('candidateMatchSection')?.scrollIntoView({behavior:'smooth',block:'start'}); }, 80);" title="Aller aux candidats recommandés">🎯 Candidats</button>` : ''}
            ${showTimeline ? '<button class="detail-tab" onclick="switchDetailTab(this,\'tab-timeline\')">Timeline</button>' : ''}
            <button class="detail-tab" onclick="switchDetailTab(this,'tab-notes')">Notes (${(prospect.callNotes||[]).length})</button>
            ${['Rendez-vous','Rencontré','Prospecté'].includes(prospect.statut) ? `<button class="detail-tab" onclick="switchDetailTab(this,'tab-rdv');loadRdvChecklist(${prospect.id})">📋 RDV</button>` : ''}
            <button class="detail-tab" onclick="switchDetailTab(this,'tab-edit')">✏️ Modifier</button>
        </div>
        ${isProspMode ? `<div class="detail-prosp-progress">Mode Prosp · ${prospProgress.index}/${prospProgress.total}</div><div class="detail-prosp-hint">Swipe gauche: suivant · Swipe droite: fermer</div>` : ''}

        <!-- TAB: Infos -->
        <div class="detail-tab-content active" id="tab-info">
            <div class="detail-info-grid">
                <div class="detail-info-item"><div class="detail-info-label">Téléphone</div><div class="detail-info-value">${prospect.telephone ? telLink(prospect.telephone) : '—'}</div></div>
                <div class="detail-info-item"><div class="detail-info-label">Email</div><div class="detail-info-value">${prospect.email ? `<a href="javascript:void(0)" onclick="copyEmailToClipboard('${escapeHtml(prospect.email)}')" title="Cliquer pour copier l'email" style="cursor:pointer;">${escapeHtml(prospect.email)}</a>` : '—'}</div></div>
                <div class="detail-info-item"><div class="detail-info-label">LinkedIn</div><div class="detail-info-value">${prospect.linkedin ? `<a href="${escapeHtml(prospect.linkedin)}" target="_blank">Voir le profil</a>` : '—'}</div></div>
                <div class="detail-info-item"><div class="detail-info-label">Dernier contact</div><div class="detail-info-value"><span id="detailLastContact">${escapeHtml(prospect.lastContact || '—')}</span></div></div>
                <div class="detail-info-item" id="detailRelanceRow"><div class="detail-info-label">Relance</div><div class="detail-info-value" id="detailRelanceValue">${(prospect.nextFollowUp || '').trim() ? escapeHtml(prospect.nextFollowUp) : '<div class="relance-shortcuts"><button type="button" class="relance-shortcut-btn" onclick="setRelanceFromInfo(' + id + ', 3)" title="Aujourd\'hui + 3 jours">+3j</button><button type="button" class="relance-shortcut-btn" onclick="setRelanceFromInfo(' + id + ', 7)" title="Aujourd\'hui + 7 jours">+7j</button><button type="button" class="relance-shortcut-btn" onclick="setRelanceFromInfo(' + id + ', 30)" title="Aujourd\'hui + 30 jours">+30j</button></div><span class="muted">—</span>'}</div></div>
                <div class="detail-info-item"><div class="detail-info-label">Next action</div><div class="detail-info-value">${escapeHtml(prospect.nextAction || '—')}</div></div>
                <div class="detail-info-item"><div class="detail-info-label">Priorité</div><div class="detail-info-value">P${prospect.priority ?? 2}</div></div>
                ${prospect.rdvDate ? `<div class="detail-info-item"><div class="detail-info-label">📅 Date RDV</div><div class="detail-info-value">${escapeHtml(prospect.rdvDate)} <button class="mini-action" onclick="copyRdvForTeams(${prospect.id})" title="Copier RDV pour Teams" style="margin-left:6px;font-size:11px;">📋 Teams</button></div></div>` : ''}
                <div class="detail-info-item full"><div class="detail-info-label">Compétences</div><div class="detail-info-value" id="detailTagsContainer">${(prospect.tags && prospect.tags.length) ? prospect.tags.map(t => { const inRef = typeof buildReferentialTagSet === 'function' && buildReferentialTagSet().has(t.toLowerCase()); return `<span class="tag-pill${inRef ? '' : ' tag-pill-custom'}" title="${inRef ? 'Référentiel Up Technologies' : 'Tag personnalisé (hors référentiel)'}">${escapeHtml(t)}${inRef ? '' : ' *'}</span>`; }).join(' ') : '—'}</div></div>
                ${showMetier ? `<div class="detail-info-item full" id="metierSection"><div class="detail-info-label">🏗️ Métier suggéré</div><div class="detail-info-value" id="metierSuggestions">${renderMetierSection(prospect)}</div></div>` : ''}
                <div class="detail-info-item full"><div class="detail-info-label">Notes</div><div class="detail-info-value" style="white-space:pre-wrap;">${escapeHtml(prospect.notes || '—')}</div></div>
            </div>

            ${showPushSection ? `<div class="detail-section-card" style="margin-top:14px;">
                <div class="detail-section-title" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>📤 Push & Catégorie</span>
                    <button class="btn btn-secondary btn-sm" onclick="openPushCategoryManager()" style="font-size:12px;padding:4px 10px;">⚙️ Gérer catégorie</button>
                </div>
                <div class="detail-info-grid">
                    <div class="detail-info-item full">
                        <div class="detail-info-label">Catégorie push</div>
                        <div class="detail-info-value">${renderPushCategorySelect(id, prospect.push_category_id)}</div>
                    </div>
                    <div class="detail-info-item full" id="detailPushTemplate" style="display:none;">
                        <div class="detail-info-label">📧 Template disponible</div>
                        <div class="detail-info-value" id="detailPushTemplateList"><span class="muted">Chargement…</span></div>
                    </div>
                    <div class="detail-info-item full">
                        <div class="detail-info-label">Dossiers de compétences</div>
                        <div class="detail-info-value" style="display:flex;gap:12px;">
                            <div style="flex:1;">
                                <select id="detailPushCandidate1" class="template-select" style="width:100%;" onchange="updatePushGenerateButton(${id})">
                                    <option value="">— Aucun —</option>
                                </select>
                            </div>
                            <div style="flex:1;">
                                <select id="detailPushCandidate2" class="template-select" style="width:100%;" onchange="updatePushGenerateButton(${id})">
                                    <option value="">— Aucun —</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="detail-info-item full" style="margin-top:10px;">
                        <button class="btn btn-primary" id="btnGeneratePush" onclick="generatePush(${id})" disabled style="width:100%;">📧 Générer et télécharger le push</button>
                    </div>
                    <div class="detail-info-item"><div class="detail-info-label">Push email</div><div class="detail-info-value"><span id="detailPushSent">${prospect.email ? (prospect.pushEmailSentAt ? ('✅ ' + prospect.pushEmailSentAt) : '🕒 Non envoyé') : '—'}</span>${(prospect.email && prospect.pushEmailSentAt) ? ` <button class="mini-link-btn" onclick="undoLastPush(${id},'email')">↩️</button>` : ''}</div></div>
                    <div class="detail-info-item"><div class="detail-info-label">Push LinkedIn</div><div class="detail-info-value"><span id="detailPushLinkedInSent">${prospect.linkedin ? (prospect.pushLinkedInSentAt ? ('✅ ' + prospect.pushLinkedInSentAt) : '🕒 Non envoyé') : '—'}</span>${(prospect.linkedin && prospect.pushLinkedInSentAt) ? ` <button class="mini-link-btn" onclick="undoLastPush(${id},'linkedin')">↩️</button>` : ''}</div></div>
                </div>
            </div>
            <script>
                // v25.9: Initialiser les dropdowns de candidats après chargement de la fiche
                (function() {
                    setTimeout(() => {
                        if (typeof updatePushCandidates === 'function') {
                            updatePushCandidates(${id});
                        }
                        if (${prospect.push_category_id ? 'true' : 'false'} && typeof onPushCategoryChange === 'function') {
                            onPushCategoryChange(${id}, ${prospect.push_category_id});
                        }
                    }, 200);
                })();
            </script>` : ''}

            ${showCandidats ? `<div class="detail-section-card" id="candidateMatchSection" style="margin-top:14px;">
                <div class="detail-section-title">🎯 Candidats recommandés (4 maximum)</div>
                <div id="unifiedCandidateList"><span class="muted">Analyse en cours…</span></div>
            </div>` : ''}
        </div>

        ${showTimeline ? `<!-- TAB: Timeline -->
        <div class="detail-tab-content" id="tab-timeline">
            <div id="timelineBox" class="detail-timeline">
                <div class="muted" style="text-align:center;padding:14px;">Chargement…</div>
            </div>
        </div>` : ''}

        <!-- TAB: Notes -->
        <div class="detail-tab-content" id="tab-notes">
            <div class="detail-notes-input">
                <textarea id="newNote" placeholder="Ajouter une note d'appel…"></textarea>
                <button type="button" class="btn btn-primary" onclick="addNote(${id})" style="align-self:flex-end;">➕</button>
            </div>
            ${notesHtml || '<div class="muted" style="text-align:center;padding:20px;">Aucune note d\'appel</div>'}
        </div>

        ${['Rendez-vous','Rencontré','Prospecté'].includes(prospect.statut) ? `
        <!-- TAB: RDV Checklist -->
        <div class="detail-tab-content" id="tab-rdv">
            <!-- Onglets des réunions précédentes -->
            <div id="meetingsTabsContainer" style="margin-bottom:16px;display:none;">
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--color-border);">
                    <button class="btn btn-secondary btn-sm" onclick="switchMeetingTab(null, ${prospect.id})" id="meetingTab_current" style="background:var(--color-primary);color:#fff;">📋 Grille actuelle</button>
                    <div id="meetingsTabsList"></div>
                </div>
                <div id="meetingDetailView" style="display:none;">
                    <div id="meetingDetailContent"></div>
                </div>
            </div>
            
            <!-- Grille de qualification -->
            <div id="rdvChecklistContainer">
                <div class="rdv-checklist-header">
                    <div class="rdv-checklist-title">
                        <span>📋 Grille de qualification</span>
                        <span class="rdv-checklist-progress" id="rdvProgress">0 / 0</span>
                    </div>
                    <div class="rdv-checklist-actions">
                        <button class="btn btn-primary btn-sm" id="btnPostMeetingIA_${prospect.id}" onclick="handlePostMeetingIA(${prospect.id})" title="Générer un compte-rendu IA et pré-remplir les champs" data-help-section="scrapping-ia">🤖 Après réunion IA</button>
                        <button class="btn btn-secondary btn-sm" onclick="copyRdvChecklist(${prospect.id})" title="Copier dans le presse-papier">📋 Copier</button>
                        <button class="btn btn-secondary btn-sm" onclick="resetRdvChecklist(${prospect.id})" title="Réinitialiser toutes les réponses">🔄 Reset</button>
                    </div>
                </div>
                <div class="rdv-checklist-bar-wrap"><div class="rdv-checklist-bar" id="rdvProgressBar"></div></div>
                <div id="rdvChecklistBody" class="rdv-checklist-body">
                    <div class="muted" style="text-align:center;padding:20px;">Chargement…</div>
                </div>
            </div>
        </div>
        ` : ''}

        <!-- TAB: Edit -->
        <div class="detail-tab-content" id="tab-edit">
            <div class="detail-edit-form">
                <div class="detail-info-grid">
                    <div class="detail-info-item"><label class="detail-info-label">Nom</label><input id="editName" type="text" value="${escapeHtml(prospect.name || '')}" class="detail-edit-input"></div>
                    <div class="detail-info-item"><label class="detail-info-label">Entreprise</label><select id="editCompany" class="detail-edit-input">${data.companies.map(c => `<option value="${c.id}" ${c.id === prospect.company_id ? 'selected' : ''}>${escapeHtml(c.groupe)} (${escapeHtml(c.site)})</option>`).join('')}</select></div>
                    <div class="detail-info-item"><label class="detail-info-label">Fonction</label><input id="editFonction" type="text" value="${escapeHtml(prospect.fonction || '')}" class="detail-edit-input"></div>
                    <div class="detail-info-item"><label class="detail-info-label">Téléphone</label><input id="editTel" type="text" value="${escapeHtml(prospect.telephone || '')}" class="detail-edit-input"></div>
                    <div class="detail-info-item"><label class="detail-info-label">Email</label><input id="editEmail" type="email" value="${escapeHtml(prospect.email || '')}" class="detail-edit-input"></div>
                    <div class="detail-info-item"><label class="detail-info-label">LinkedIn</label><input id="editLinkedin" type="text" value="${escapeHtml(prospect.linkedin || '')}" class="detail-edit-input"></div>
                    <div class="detail-info-item"><label class="detail-info-label">Photo</label><div style="display:flex;gap:8px;align-items:center;margin-top:4px;"><button type="button" class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" onclick="triggerPhotoUpload(${prospect.id})">📷 ${photoUrl ? 'Changer' : 'Ajouter'}</button>${photoUrl ? `<button type="button" class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" onclick="deleteProspectPhoto(${prospect.id})">🗑️ Supprimer</button>` : ''}</div></div>
                    <div class="detail-info-item"><label class="detail-info-label">Dernier contact</label><input id="editLastContact" type="date" value="${prospect.lastContact || todayISO()}" class="detail-edit-input"></div>
                    <div class="detail-info-item">
                        <label class="detail-info-label">Relance</label>
                        <div class="relance-shortcuts">
                            <button type="button" class="relance-shortcut-btn" onclick="setRelanceShortcut(3)" title="Aujourd\'hui + 3 jours">+3j</button>
                            <button type="button" class="relance-shortcut-btn" onclick="setRelanceShortcut(7)" title="Aujourd\'hui + 7 jours">+7j</button>
                            <button type="button" class="relance-shortcut-btn" onclick="setRelanceShortcut(30)" title="Aujourd\'hui + 30 jours">+30j</button>
                        </div>
                        <input id="editNextFollowUp" type="date" value="${prospect.nextFollowUp || ''}" class="detail-edit-input">
                    </div>
                    <div class="detail-info-item"><label class="detail-info-label">Next action</label><input id="editNextAction" type="text" value="${escapeHtml(prospect.nextAction || '')}" class="detail-edit-input" placeholder="Ex: Relancer dans 1 semaine"><div id="editNextActionSuggestions" class="next-action-suggestions">${getNextActionSuggestionsHtml(prospect.statut)}</div></div>
                    <div class="detail-info-item"><label class="detail-info-label">📅 Date RDV</label><input id="editRdvDate" type="datetime-local" value="${prospect.rdvDate || ''}" class="detail-edit-input"></div>
                    <div class="detail-info-item"><label class="detail-info-label">Priorité</label><select id="editPriority" class="detail-edit-input"><option value="1" ${String(prospect.priority)==='1'?'selected':''}>P1 (haute)</option><option value="2" ${String(prospect.priority)==='2'||prospect.priority==null?'selected':''}>P2 (normal)</option><option value="3" ${String(prospect.priority)==='3'?'selected':''}>P3 (basse)</option></select></div>
                    <div class="detail-info-item"><label class="detail-info-label">Pertinence</label><select id="editPertinence" class="detail-edit-input"><option value="5" ${String(prospect.pertinence)==='5'?'selected':''}>⭐⭐⭐⭐⭐</option><option value="4" ${String(prospect.pertinence)==='4'?'selected':''}>⭐⭐⭐⭐</option><option value="3" ${String(prospect.pertinence)==='3'?'selected':''}>⭐⭐⭐</option><option value="2" ${String(prospect.pertinence)==='2'?'selected':''}>⭐⭐</option><option value="1" ${String(prospect.pertinence)==='1'?'selected':''}>⭐</option></select></div>
                </div>
                <div style="margin-top:16px;">
                    <label class="detail-info-label">Statut</label>
                    <select id="editStatut" class="detail-edit-input" style="margin-top:6px;">
                        <option value="Pas d'actions" ${prospect.statut==="Pas d'actions"?'selected':''}>Pas d'actions</option>
                        <option value="Appelé" ${prospect.statut==='Appelé'?'selected':''}>Appelé</option>
                        <option value="À rappeler" ${prospect.statut==='À rappeler'?'selected':''}>À rappeler</option>
                        <option value="Rendez-vous" ${prospect.statut==='Rendez-vous'?'selected':''}>Rendez-vous</option>
                        <option value="Rencontré" ${prospect.statut==='Rencontré'?'selected':''}>Rencontré</option>
                        <option value="Prospecté" ${prospect.statut==='Prospecté'?'selected':''}>Prospecté</option>
                        <option value="Messagerie" ${prospect.statut==='Messagerie'?'selected':''}>Messagerie</option>
                        <option value="Pas intéressé" ${prospect.statut==='Pas intéressé'?'selected':''}>Pas intéressé</option>
                    </select>
                </div>
                <div style="margin-top:16px;">
                    <label class="detail-info-label">Compétences</label>
                    <input id="editTagsValue" type="hidden" value="${escapeHtml(JSON.stringify(prospect.tags || []))}">
                    <div id="editTagsEditor" class="tag-editor-host" style="margin-top:6px;"></div>
                </div>
                <div style="margin-top:16px;">
                    <label class="detail-info-label">🏗️ Métier (fixé manuellement)</label>
                    <select id="editMetier" class="detail-edit-input" style="margin-top:6px;">
                        <option value="">— Auto (basé sur les tags)</option>
                        ${buildMetierOptionsHtml(prospect.fixedMetier)}
                    </select>
                </div>
                <div style="margin-top:16px;">
                    <label class="detail-info-label">Notes</label>
                    <textarea id="editNotes" rows="4" class="detail-edit-input" style="margin-top:6px;min-height:80px;resize:vertical;">${escapeHtml(prospect.notes || '')}</textarea>
                </div>
                <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--color-border);">
                    <button id="btnIA_prospect_${prospect.id}" class="btn btn-secondary" onclick="handleIAButton('prospect', ${prospect.id})" title="Enrichir la fiche avec l'IA" data-help-section="scrapping-ia" style="font-size:13px;">🤖 Scrapping IA</button>
                    <div class="muted" style="margin-top:6px; font-size:11px;">1er clic = copier le prompt · 2e clic = coller le retour IA pour pré-remplir</div>
                </div>
            </div>
        </div>

        <div class="detail-footer">
            <div style="display:flex;gap:8px;">
                <button class="btn btn-danger" onclick="deleteProspect(${id})" title="Supprimer définitivement">🗑️</button>
                ${prospect.is_contact ? `<button class="btn btn-primary" onclick="restoreFromContacts(${id})" title="Restaurer dans les prospects" style="font-size:12px;">👥 Restaurer</button>` : `<button class="btn btn-secondary" onclick="moveToContacts(${id})" title="Déplacer vers le vivier de contacts" style="font-size:12px;">📁 Contacts</button>`}
                ${['Rendez-vous','Rencontré','Prospecté'].includes(prospect.statut) ? `<button class="btn btn-success" id="btnSaveMeeting_${prospect.id}" onclick="saveMeeting(${prospect.id})" title="Enregistrer la grille de qualification comme réunion" style="font-size:12px;display:none;">💾 Enregistrer réunion</button>` : ''}
            </div>
            <div style="display:flex;gap:8px;">
                ${hasPrevInProsp ? `<button class="btn btn-secondary btn-prosp-prev" onclick="goToProspPrev(${id})" title="Prospect précédent">← Précédent</button>` : ''}
                <button class="btn btn-secondary" onclick="closeDetail()">Fermer</button>
                <button class="btn btn-primary" onclick="saveDetail(${id})">💾 Enregistrer</button>
                ${isProspMode ? `<button class="btn btn-primary btn-prosp-next ${hasNextInProsp ? '' : 'is-last'}" onclick="saveAndNext(${id})" title="${hasNextInProsp ? 'Enregistrer puis prospect suivant' : 'Enregistrer puis quitter le mode Prosp'}">${hasNextInProsp ? 'Suivant →' : 'Terminer ✓'}</button>` : ''}
            </div>
        </div>
    `;

    const detailContentEl = document.getElementById('detailContent');
    if (!detailContentEl) return;
    detailContentEl.innerHTML = html;
    detailContentEl.scrollTop = 0;
    const firstActiveTab = detailContentEl.querySelector('.detail-tab-content.active');
    if (firstActiveTab) firstActiveTab.scrollTop = 0;
    const detailModal = document.getElementById('modalDetail');
    if (window.openModal) {
        window.openModal(detailModal);
    } else {
        detailModal.classList.add('active');
    }
    if (window.decorateHelpSections) window.decorateHelpSections();
    const detailCard = detailModal.querySelector('.modal-content');
    if (detailCard) {
        detailCard.classList.toggle('prosp-mode-card', isProspMode);
        if (isProspMode) {
            detailCard.classList.remove('prosp-enter');
            requestAnimationFrame(() => detailCard.classList.add('prosp-enter'));
        } else {
            detailCard.classList.remove('prosp-enter');
        }
    }

    // init tags editor (edit mode)
    try { initTagsEditor('editTagsEditor', 'editTagsValue', prospect.tags || []); } catch (e) {}

    // Auto-load candidate suggestions if push category is already set (et modules activés)
    const showCandidatsPref = typeof window.getDisplayPref === 'function' ? window.getDisplayPref('display_candidate_proposition') : true;
    const showPushSectionPref = typeof window.getDisplayPref === 'function' ? window.getDisplayPref('display_prospect_push_section') : true;
    if (showPushSectionPref && prospect.push_category_id) {
        onPushCategoryChange(prospect.id, String(prospect.push_category_id));
    }

    // Auto-load best-match candidates (unified section)
    if (showCandidatsPref) {
        loadUnifiedCandidates(prospect.id, prospect.tags, prospect.push_category_id);
    }

    // load timeline (si module activé)
    const showTimelinePref = typeof window.getDisplayPref === 'function' ? window.getDisplayPref('display_prospect_timeline') : true;
    if (showTimelinePref) {
        try {
            const res = await fetch(`/api/prospect/timeline?id=${prospect.id}`);
            if (res.ok) {
                const payload = await res.json();
                if (payload && payload.ok) {
                    const box = document.getElementById('timelineBox');
                    if (box) {
                        const ev = Array.isArray(payload.events) ? payload.events : [];
                        if (ev.length === 0) {
                            box.innerHTML = '<div class="muted" style="text-align:center; padding: 14px;">Aucun événement</div>';
                        } else {
                            box.innerHTML = ev.map(e => {
                                const date = escapeHtml((e.date || '').slice(0, 19));
                                const title = escapeHtml(e.title || e.type || '');
                                const content = escapeHtml(e.content || '').split('\n').join('<br>');
                                const dotClass = (e.type === 'push') ? 'push' : (e.type === 'call_note') ? 'call' : (e.type === 'done') ? 'done' : '';
                                return `<div class="detail-tl-item"><div class="detail-tl-dot ${dotClass}"></div><div class="detail-tl-date">${date}</div><div class="detail-tl-title">${title}</div><div class="detail-tl-content">${content}</div></div>`;
                            }).join('');
                        }
                    }
                }
            }
        } catch (e) {}
    }
}

// ====== Detail tabs switching ======
function switchDetailTab(btn, tabId) {
    // Gérer l'affichage du bouton "Enregistrer réunion"
    const prospectId = _rdvProspectId;
    const saveMeetingBtn = prospectId ? document.getElementById(`btnSaveMeeting_${prospectId}`) : null;
    if (saveMeetingBtn) {
        saveMeetingBtn.style.display = (tabId === 'tab-rdv') ? '' : 'none';
    }
    const tabs = btn.parentElement.querySelectorAll('.detail-tab');
    tabs.forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const container = document.getElementById('detailContent');
    if (!container) return;
    container.querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('active'));
    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');
}

// ====== Photo upload ======
function triggerPhotoUpload(prospectId) {
    const input = document.getElementById('photoFileInput');
    if (input) input.click();
}

async function uploadProspectPhoto(prospectId, fileInput) {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('prospect_id', prospectId);
    formData.append('photo', file);

    try {
        const res = await fetch('/api/prospect/photo', { method: 'POST', body: formData });
        const json = await res.json();
        if (json.ok && json.photo_url) {
            const p = data.prospects.find(p => p.id === prospectId);
            if (p) p.photo_url = json.photo_url;
            viewDetail(prospectId);
        } else {
            alert('❌ Erreur upload: ' + (json.error || 'inconnue'));
        }
    } catch (e) {
        alert('❌ Erreur réseau lors de l\'upload');
        console.error(e);
    }
}

async function deleteProspectPhoto(prospectId) {
    if (!confirm('Supprimer la photo ?')) return;
    try {
        const res = await fetch(`/api/prospect/photo?prospect_id=${prospectId}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.ok) {
            const p = data.prospects.find(p => p.id === prospectId);
            if (p) p.photo_url = '';
            viewDetail(prospectId);
        }
    } catch (e) {
        console.error(e);
    }
}

// ====== Quick status change from hero ======
function quickChangeStatus(prospectId, newStatus) {
    const prospect = data.prospects.find(p => p.id === prospectId);
    if (!prospect || prospect.statut === newStatus) return;
    
    // If selecting "Rendez-vous", show date picker popup first
    if (newStatus === 'Rendez-vous') {
        showRdvDatePicker(prospectId, function(selectedDate) {
            prospect.statut = newStatus;
            if (selectedDate) {
                prospect.rdvDate = selectedDate;
            }
            _stampProspectLastContact(prospect);
            saveToServer();
            markUnsaved();
            if (_currentView === 'prosp' && _prospSession.active) {
                const nextId = getProspNextId(prospectId);
                if (typeof filterProspects === 'function') filterProspects();
                _prospGoToNextAfterStatusChange(prospectId, nextId);
            } else {
                viewDetail(prospectId);
                if (typeof filterProspects === 'function') filterProspects();
            }
        });
        return;
    }
    
    // If selecting "À rappeler", show relance date picker popup
    if (newStatus === 'À rappeler') {
        showRelanceDatePicker(prospectId, function(selectedDate) {
            prospect.statut = newStatus;
            if (selectedDate) {
                prospect.nextFollowUp = selectedDate;
            }
            _stampProspectLastContact(prospect);
            saveToServer();
            markUnsaved();
            if (_currentView === 'prosp' && _prospSession.active) {
                const nextId = getProspNextId(prospectId);
                if (typeof filterProspects === 'function') filterProspects();
                _prospGoToNextAfterStatusChange(prospectId, nextId);
            } else {
                viewDetail(prospectId);
                if (typeof filterProspects === 'function') filterProspects();
            }
        });
        return;
    }
    
    prospect.statut = newStatus;
    _stampProspectLastContact(prospect);
    saveToServer();
    markUnsaved();
    if (_currentView === 'prosp' && _prospSession.active) {
        const nextId = getProspNextId(prospectId);
        if (typeof filterProspects === 'function') filterProspects();
        _prospGoToNextAfterStatusChange(prospectId, nextId);
    } else {
        viewDetail(prospectId);
        if (typeof filterProspects === 'function') filterProspects();
    }
}

// ── RDV Date Picker Popup ──
function showRdvDatePicker(prospectId, callback) {
    const prospect = data.prospects.find(p => p.id === prospectId);
    const existingDate = prospect && prospect.rdvDate ? prospect.rdvDate : '';
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'rdv-date-modal';
    overlay.id = 'rdvDateModal';
    
    const today = new Date().toISOString().split('T')[0];
    
    overlay.innerHTML = `
        <div class="rdv-date-modal-content">
            <h3 style="margin-bottom:4px;font-size:16px;">📅 Date du rendez-vous</h3>
            <p class="muted" style="font-size:13px;margin-bottom:8px;">Choisissez la date et l'heure du RDV avec ce prospect.</p>
            <input type="datetime-local" class="rdv-date-input" id="rdvDateInput" value="${existingDate || today + 'T10:00'}">
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button class="btn btn-secondary" onclick="closeRdvDatePicker(false)">Passer</button>
                <button class="btn btn-primary" onclick="closeRdvDatePicker(true)">✅ Confirmer</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Focus the date input
    setTimeout(() => {
        const input = document.getElementById('rdvDateInput');
        if (input) input.focus();
    }, 100);
    
    // Store callback
    window._rdvDateCallback = callback;
    
    // Close on overlay click
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeRdvDatePicker(false);
    });
    
    // Close on Escape
    const escHandler = function(e) {
        if (e.key === 'Escape') { closeRdvDatePicker(false); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
}

function closeRdvDatePicker(confirmed) {
    const modal = document.getElementById('rdvDateModal');
    const input = document.getElementById('rdvDateInput');
    const callback = window._rdvDateCallback;
    
    if (modal) {
        modal.style.opacity = '0';
        setTimeout(() => modal.remove(), 200);
    }
    
    if (callback) {
        const dateVal = (confirmed && input) ? input.value : null;
        callback(dateVal);
        window._rdvDateCallback = null;
    }
}

// ── Relance Date Picker Popup (statut "À rappeler") ──
function showRelanceDatePicker(prospectId, callback) {
    const prospect = data.prospects.find(p => p.id === prospectId);
    const existing = prospect && prospect.nextFollowUp ? String(prospect.nextFollowUp).trim().slice(0, 10) : '';
    const today = new Date().toISOString().split('T')[0];
    
    const overlay = document.createElement('div');
    overlay.className = 'rdv-date-modal';
    overlay.id = 'relanceDateModal';
    
    overlay.innerHTML = `
        <div class="rdv-date-modal-content">
            <h3 style="margin-bottom:4px;font-size:16px;">📅 Date de relance</h3>
            <p class="muted" style="font-size:13px;margin-bottom:8px;">Choisissez la date à laquelle vous souhaitez rappeler ce prospect.</p>
            <input type="date" class="rdv-date-input" id="relanceDateInput" value="${existing || today}">
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button class="btn btn-secondary" onclick="closeRelanceDatePicker(false)">Passer</button>
                <button class="btn btn-primary" onclick="closeRelanceDatePicker(true)">✅ Confirmer</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    setTimeout(() => {
        const input = document.getElementById('relanceDateInput');
        if (input) input.focus();
    }, 100);
    
    window._relanceDateCallback = callback;
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeRelanceDatePicker(false);
    });
    const escHandler = function(e) {
        if (e.key === 'Escape') { closeRelanceDatePicker(false); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
}

function closeRelanceDatePicker(confirmed) {
    const modal = document.getElementById('relanceDateModal');
    const input = document.getElementById('relanceDateInput');
    const callback = window._relanceDateCallback;
    
    if (modal) {
        modal.style.opacity = '0';
        setTimeout(() => modal.remove(), 200);
    }
    
    if (callback) {
        const dateVal = (confirmed && input && input.value) ? input.value : null;
        callback(dateVal);
        window._relanceDateCallback = null;
    }
}

// ====== Kanban + Prosp view ======
const PROSP_SESSION_STORAGE_KEY = 'prospup_last_prosp_session';
let _currentView = 'table';
let _prospSession = { active: false, ids: [], currentId: null, currentIndex: -1, listScrollState: null };

function _setViewToggleButtons(mode) {
    const btnTable = document.getElementById('btnViewTable');
    const btnKanban = document.getElementById('btnViewKanban');
    const btnProsp = document.getElementById('btnViewProsp');
    btnTable?.classList.toggle('active', mode === 'table');
    btnKanban?.classList.toggle('active', mode === 'kanban');
    btnProsp?.classList.toggle('active', mode === 'prosp');
}

function _getCurrentProspIds() {
    return (Array.isArray(filteredProspects) ? filteredProspects : []).map(p => p.id);
}

function _rebuildProspIdsKeepingOrder(previousIds, freshIds) {
    const fresh = Array.isArray(freshIds) ? freshIds : [];
    const freshSet = new Set(fresh);
    const ordered = [];
    const seen = new Set();

    (Array.isArray(previousIds) ? previousIds : []).forEach(id => {
        if (!freshSet.has(id) || seen.has(id)) return;
        seen.add(id);
        ordered.push(id);
    });

    fresh.forEach(id => {
        if (seen.has(id)) return;
        seen.add(id);
        ordered.push(id);
    });

    return ordered;
}

function _captureProspectsScrollState(anchorId) {
    const tableView = document.getElementById('tableView');
    const aid = Number(anchorId);
    return {
        anchorId: Number.isFinite(aid) ? aid : null,
        tableScrollTop: tableView ? tableView.scrollTop : 0,
        windowY: window.scrollY || window.pageYOffset || 0
    };
}

function _restoreProspectsScrollState(state) {
    if (!state || typeof state !== 'object') return;
    try {
        const tableView = document.getElementById('tableView');
        if (tableView && typeof state.tableScrollTop === 'number') {
            tableView.scrollTop = state.tableScrollTop;
        }
        if (typeof state.windowY === 'number') {
            window.scrollTo(0, state.windowY);
        }
        const aid = Number(state.anchorId);
        if (Number.isFinite(aid)) {
            const row = document.querySelector(`#tableBody tr[data-prospect-id="${aid}"]`);
            if (row) row.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
    } catch (e) {}
}

function _queueProspectsScrollRestore(state) {
    _pendingProspListScrollRestore = state || null;
}

function _flushProspectsScrollRestore() {
    if (!_pendingProspListScrollRestore) return;
    const state = _pendingProspListScrollRestore;
    _pendingProspListScrollRestore = null;
    requestAnimationFrame(() => requestAnimationFrame(() => _restoreProspectsScrollState(state)));
}

function _parseLastContactTs(value) {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const normalized = raw.length <= 10 ? `${raw}T00:00:00` : raw.replace(' ', 'T');
    const ts = Date.parse(normalized);
    return Number.isFinite(ts) ? ts : 0;
}

function _pickMostRecentSessionProspectId(candidateIds) {
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) return null;
    let best = null;
    candidateIds.forEach((id, idx) => {
        const prospect = data.prospects.find(p => p.id === id);
        if (!prospect) return;
        const ts = _parseLastContactTs(prospect.lastContact);
        if (!best || ts > best.ts || (ts === best.ts && idx > best.idx)) {
            best = { id, ts, idx };
        }
    });
    return best ? best.id : null;
}

function _syncProspCurrent(id) {
    if (!_prospSession.active) return;
    _prospSession.ids = _rebuildProspIdsKeepingOrder(_prospSession.ids, _getCurrentProspIds());
    _prospSession.currentId = id;
    _prospSession.currentIndex = _prospSession.ids.indexOf(id);
}

function getProspProgress(id) {
    if (!_prospSession.active) return { index: 0, total: 0 };
    const ids = _prospSession.ids || [];
    const idx = ids.indexOf(id);
    return { index: idx >= 0 ? (idx + 1) : 0, total: ids.length };
}

function getProspNextId(id) {
    if (!_prospSession.active) return null;
    const ids = _prospSession.ids || [];
    const idx = ids.indexOf(id);
    if (idx < 0) return null;
    return (idx + 1 < ids.length) ? ids[idx + 1] : null;
}

function getProspPrevId(id) {
    if (!_prospSession.active) return null;
    const ids = _prospSession.ids || [];
    const idx = ids.indexOf(id);
    if (idx <= 0) return null;
    return ids[idx - 1];
}

function syncProspSessionWithFilteredList() {
    if (_currentView !== 'prosp' || !_prospSession.active) return;
    const previousIds = Array.isArray(_prospSession.ids) ? _prospSession.ids.slice() : [];
    const previousCurrentId = _prospSession.currentId;
    const previousIndex = previousIds.indexOf(previousCurrentId);
    _prospSession.ids = _rebuildProspIdsKeepingOrder(previousIds, _getCurrentProspIds());
    if (_prospSession.ids.length === 0) {
        if (typeof showToast === 'function') showToast('Aucun prospect dans ce filtre, sortie du mode Prosp.', 'warning');
        closeDetail();
        return;
    }
    if (!_prospSession.currentId || !_prospSession.ids.includes(_prospSession.currentId)) {
        const fallbackIndex = previousIndex >= 0 ? Math.min(previousIndex, _prospSession.ids.length - 1) : 0;
        _prospSession.currentId = _prospSession.ids[fallbackIndex];
        _prospSession.currentIndex = fallbackIndex;
        _prospSession.listScrollState = _captureProspectsScrollState(_prospSession.currentId);
        _queueProspectsScrollRestore(_prospSession.listScrollState);
        if (typeof _saveProspSessionToStorage === 'function') _saveProspSessionToStorage();
        viewDetail(_prospSession.currentId).catch(() => {});
        return;
    }
    _prospSession.currentIndex = _prospSession.ids.indexOf(_prospSession.currentId);
}

function switchTableKanban(mode) {
    const normalizedMode = (mode === 'kanban' || mode === 'prosp') ? mode : 'table';
    const previousMode = _currentView;
    _currentView = normalizedMode;

    const tableEl = document.getElementById('tableView');
    const kanbanEl = document.getElementById('kanbanView');
    if (!tableEl || !kanbanEl) return;

    // Fonction helper pour appliquer les transitions fluides entre vues
    const applyViewTransition = (elementOut, elementIn, callback) => {
        if (!elementIn) {
            // Si pas d'élément entrant (mode prosp), juste cacher l'élément sortant
            if (elementOut && previousMode !== normalizedMode && elementOut.style.display !== 'none') {
                elementOut.classList.remove('view-transition-enter');
                elementOut.classList.add('view-transition-exit');
                setTimeout(() => {
                    elementOut.style.display = 'none';
                    elementOut.classList.remove('view-transition-exit');
                    if (callback) callback();
                }, 300);
            } else {
                if (elementOut) {
                    elementOut.style.display = 'none';
                    elementOut.classList.remove('view-transition-enter', 'view-transition-exit');
                }
                if (callback) callback();
            }
            return;
        }

        if (!elementOut) {
            // Pas d'élément sortant, juste montrer le nouveau
            elementIn.style.display = '';
            elementIn.classList.remove('view-transition-exit');
            elementIn.classList.add('view-transition-enter');
            void elementIn.offsetWidth;
            if (callback) callback();
            return;
        }

        // Si c'est la première fois ou si on change de vue
        if (previousMode !== normalizedMode && elementOut.style.display !== 'none') {
            // Animation de sortie
            elementOut.classList.remove('view-transition-enter');
            elementOut.classList.add('view-transition-exit');
            
            // Après l'animation de sortie, cacher l'élément et montrer le nouveau
            setTimeout(() => {
                elementOut.style.display = 'none';
                elementOut.classList.remove('view-transition-exit');
                
                elementIn.style.display = '';
                elementIn.classList.remove('view-transition-exit');
                elementIn.classList.add('view-transition-enter');
                
                // Forcer le reflow pour déclencher l'animation
                void elementIn.offsetWidth;
                
                if (callback) callback();
            }, 300); // Durée de l'animation de sortie
        } else {
            // Pas de transition nécessaire, changement direct
            elementOut.style.display = 'none';
            elementOut.classList.remove('view-transition-enter', 'view-transition-exit');
            elementIn.style.display = '';
            elementIn.classList.remove('view-transition-exit');
            elementIn.classList.add('view-transition-enter');
            void elementIn.offsetWidth;
            if (callback) callback();
        }
    };

    _setViewToggleButtons(normalizedMode);

    if (normalizedMode === 'kanban') {
        _prospSession = { active: false, ids: [], currentId: null, currentIndex: -1, listScrollState: null };
        const modal = document.getElementById('modalDetail');
        if (modal && modal.classList.contains('active')) closeDetail({ keepProspMode: false, fromViewSwitch: true });
        
        applyViewTransition(tableEl, kanbanEl, () => {
            renderKanban();
        });
        return;
    }

    if (normalizedMode === 'table') {
        _prospSession = { active: false, ids: [], currentId: null, currentIndex: -1, listScrollState: null };
        const modal = document.getElementById('modalDetail');
        if (modal && modal.classList.contains('active')) closeDetail({ keepProspMode: false, fromViewSwitch: true });
        
        applyViewTransition(kanbanEl, tableEl);
        return;
    }

    // Mode prosp
    const ids = _getCurrentProspIds();
    if (!ids.length) {
        _currentView = 'table';
        applyViewTransition(kanbanEl, tableEl, () => {
            _setViewToggleButtons('table');
            if (typeof showToast === 'function') showToast('Aucun prospect à défiler avec les filtres actuels.', 'warning');
        });
        return;
    }

    _prospSession = {
        active: true,
        ids,
        currentId: ids[0],
        currentIndex: 0,
        listScrollState: _captureProspectsScrollState(ids[0])
    };
    if (typeof showToast === 'function') {
        showToast(`Mode Prosp activé · ${ids.length} prospect${ids.length > 1 ? 's' : ''} à traiter`, 'info');
    }
    if (typeof _saveProspSessionToStorage === 'function') _saveProspSessionToStorage();
    
    // Pour le mode prosp, on cache les deux vues (table et kanban)
    applyViewTransition(previousMode === 'kanban' ? kanbanEl : tableEl, null, () => {
        viewDetail(ids[0]).catch(() => {});
    });
}

function renderKanban() {
    const board = document.getElementById('kanbanView');
    if (!board || _currentView !== 'kanban') return;

    const statuses = [
"Pas d'actions", "Appelé", "Messagerie", "À rappeler", "Rendez-vous", "Rencontré", "Prospecté", "Pas intéressé"
    ];
    const statusEmoji = {
"Pas d'actions": '📋', 'Appelé': '📞', 'Messagerie': '💬',
'À rappeler': '🔁', 'Rendez-vous': '🤝', 'Rencontré': '✅', 'Prospecté': '🎯', 'Pas intéressé': '❌'
    };

    const grouped = {};
    statuses.forEach(s => grouped[s] = []);
    filteredProspects.forEach(p => {
        const s = statuses.includes(p.statut) ? p.statut : "Pas d'actions";
        grouped[s].push(p);
    });

    const todayStr = todayISO();

    board.innerHTML = statuses.map(status => {
        const prospects = grouped[status];
        const cardsHtml = prospects.map(p => {
            const company = data.companies.find(c => c.id === p.company_id);
            const compName = company ? (company.groupe || '') : '';
            const stars = '★'.repeat(Math.min(p.pertinence || 0, 5));
            let followupHtml = '';
            if (p.nextFollowUp) {
                const isDue = p.nextFollowUp <= todayStr;
                followupHtml = `<span class="kanban-card-followup ${isDue ? 'due' : 'ok'}">${isDue ? '⚠' : '📅'} ${escapeHtml(p.nextFollowUp)}</span>`;
            }
            return `
                <div class="kanban-card" draggable="true" data-id="${p.id}"
                     ondragstart="kanbanDragStart(event)" ondragend="kanbanDragEnd(event)">
                    <div class="kanban-card-name">${escapeHtml(p.name || '?')}</div>
                    <div class="kanban-card-company">${escapeHtml(compName)}</div>
                    ${p.fonction ? `<div class="kanban-card-fonction">${escapeHtml(p.fonction)}</div>` : ''}
                    <div class="kanban-card-meta">
                        <span class="stars" style="color:#f59e0b;">${stars || '☆'}</span>
                        ${followupHtml}
                    </div>
                    <div class="kanban-card-actions">
                        <button onclick="viewDetail(${p.id})" title="Voir fiche">Voir</button>
                        ${p.telephone ? `<button onclick="callNumberById(${p.id})" title="Appeler">📞</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="kanban-col" data-status="${escapeHtml(status)}"
                 ondragover="kanbanDragOver(event)" ondrop="kanbanDrop(event)" ondragleave="kanbanDragLeave(event)">
                <div class="kanban-col-header">
                    <span>${statusEmoji[status] || ''} ${escapeHtml(status)}</span>
                    <span class="kanban-count">${prospects.length}</span>
                </div>
                <div class="kanban-col-body">${cardsHtml}</div>
            </div>
        `;
    }).join('');
}

// Drag & drop helpers for Kanban
let _draggedProspectId = null;

function kanbanDragStart(e) {
    _draggedProspectId = parseInt(e.target.dataset.id, 10);
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}
function kanbanDragEnd(e) {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
}
function kanbanDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const col = e.target.closest('.kanban-col');
    if (col) col.classList.add('drag-over');
}
function kanbanDragLeave(e) {
    const col = e.target.closest('.kanban-col');
    if (col) col.classList.remove('drag-over');
}
function kanbanDrop(e) {
    e.preventDefault();
    const col = e.target.closest('.kanban-col');
    if (!col || _draggedProspectId == null) return;
    col.classList.remove('drag-over');

    const newStatus = col.dataset.status;
    const prospect = data.prospects.find(p => p.id === _draggedProspectId);
    if (prospect && prospect.statut !== newStatus) {
        prospect.statut = newStatus;
        saveToServer();
        markUnsaved();
        renderKanban();
        if (typeof renderProspects === 'function') renderProspects();
    }
    _draggedProspectId = null;
}


function deleteCallNote(prospectId, noteIndex) {
    const prospect = data.prospects.find(p => p.id === prospectId);
    if (!prospect || !Array.isArray(prospect.callNotes)) return;

    const note = prospect.callNotes[noteIndex];
    if (!note) return;

    const preview = (note.content || '').slice(0, 120);
    if (!confirm(`⚠️ Supprimer cette note ?\n\n${note.date || ''} - ${preview}${(note.content || '').length > 120 ? '…' : ''}`)) return;

    prospect.callNotes.splice(noteIndex, 1);

    saveToServer();
    markUnsaved();

    viewDetail(prospectId);
}

function addNote(id) {
    const prospect = data.prospects.find(p => p.id === id);
    const content = document.getElementById('newNote').value.trim();
    if (content) {
        if (!prospect.callNotes) prospect.callNotes = [];
        prospect.callNotes.push({ date: todayISO(), content });
        saveToServer();
    markUnsaved();
        document.getElementById('newNote').value = '';
        viewDetail(id);
    }
}

function saveDetail(id, options = {}) {
    const prospect = data.prospects.find(p => p.id === id);
    if (!prospect) return false;
    const previousStatus = prospect.statut;
    const previousLastContact = prospect.lastContact;
    const closeAfterSave = options.closeAfterSave !== false;
    const refreshAfterSave = options.refreshAfterSave !== false;

    // Champs fiche prospect (édition)
    const nameEl = document.getElementById('editName');
    if (nameEl) {
        prospect.name = nameEl.value;
        prospect.company_id = parseInt(document.getElementById('editCompany').value);
        prospect.fonction = document.getElementById('editFonction').value;
        prospect.telephone = document.getElementById('editTel').value;
        prospect.email = document.getElementById('editEmail').value;
        prospect.linkedin = document.getElementById('editLinkedin').value;
        prospect.lastContact = document.getElementById('editLastContact').value;
        prospect.nextFollowUp = document.getElementById('editNextFollowUp').value;
        const na = document.getElementById('editNextAction');
        prospect.nextAction = na ? na.value : (prospect.nextAction || '');
        const rdvEl = document.getElementById('editRdvDate');
        prospect.rdvDate = rdvEl ? rdvEl.value : (prospect.rdvDate || '');
        prospect.priority = parseInt(document.getElementById('editPriority').value, 10);
        prospect.notes = document.getElementById('editNotes').value;
        prospect.tags = readTagsFromHidden('editTagsValue');
        const metierSel = document.getElementById('editMetier');
        prospect.fixedMetier = metierSel ? metierSel.value : '';
    }

    // Champs existants
    prospect.pertinence = document.getElementById('editPertinence').value;
    const newStatut = document.getElementById('editStatut').value;
    
    // Auto-prompt rdvDate si passage en Rendez-vous sans date
    if (newStatut === 'Rendez-vous' && prospect.statut !== 'Rendez-vous' && !prospect.rdvDate) {
        const rdvInput = prompt('📅 Date et heure du RDV (format : AAAA-MM-JJ HH:MM)\nEx: 2026-02-16 16:00\n\n(Laisser vide pour définir plus tard)');
        if (rdvInput && rdvInput.trim()) {
            // Convert to datetime-local format
            const clean = rdvInput.trim().replace(' ', 'T');
            prospect.rdvDate = clean.length === 10 ? clean + 'T09:00' : clean;
        }
    }
    prospect.statut = newStatut;
    if (newStatut !== previousStatus) {
        const editedLastContact = (document.getElementById('editLastContact')?.value || '').trim();
        if (!editedLastContact || editedLastContact === String(previousLastContact || '').trim()) {
            _stampProspectLastContact(prospect);
        }
    }

    saveToServer();
    markUnsaved();

    if (refreshAfterSave) {
        filterProspects();
    }
    if (closeAfterSave) {
        closeDetail();
    }
    return true;
}

async function saveAndNext(id) {
    if (!(_currentView === 'prosp' && _prospSession.active)) {
        saveDetail(id);
        return;
    }

    const preferredNextId = getProspNextId(id);
    const saved = saveDetail(id, { closeAfterSave: false, refreshAfterSave: true });
    if (!saved) return;

    _syncProspCurrent(id);
    let nextId = null;
    if (preferredNextId && (_prospSession.ids || []).includes(preferredNextId)) {
        nextId = preferredNextId;
    } else {
        nextId = getProspNextId(id);
    }
    if (!nextId) {
        if (typeof showToast === 'function') showToast('Dernier prospect enregistré. Mode Prosp terminé.', 'success');
        closeDetail();
        return;
    }

    const detailModal = document.getElementById('modalDetail');
    const detailCard = detailModal ? detailModal.querySelector('.modal-content') : null;
    if (detailCard) {
        detailCard.classList.remove('prosp-swipe-left');
        detailCard.classList.remove('prosp-enter');
        detailCard.classList.add('prosp-swipe-left');
    }

    await new Promise(resolve => setTimeout(resolve, 170));
    _prospSession.currentId = nextId;
    _prospSession.currentIndex = (_prospSession.ids || []).indexOf(nextId);
    if (typeof _saveProspSessionToStorage === 'function') _saveProspSessionToStorage();
    await viewDetail(nextId);
}

function goToProspPrev(id) {
    if (!(_currentView === 'prosp' && _prospSession.active)) return;
    const prevId = getProspPrevId(id);
    if (!prevId) return;
    _prospSession.currentId = prevId;
    _prospSession.currentIndex = (_prospSession.ids || []).indexOf(prevId);
    viewDetail(prevId).catch(function () {});
}

// Après changement de statut en Mode Prosp : passer à la fiche suivante (ou première / fermer)
function _prospGoToNextAfterStatusChange(prospectId, nextId) {
    if (_currentView !== 'prosp' || !_prospSession.active) return;
    const ids = _prospSession.ids || [];
    if (nextId && ids.includes(nextId)) {
        _prospSession.currentId = nextId;
        _prospSession.currentIndex = ids.indexOf(nextId);
        if (typeof _saveProspSessionToStorage === 'function') _saveProspSessionToStorage();
        viewDetail(nextId).catch(function () {});
    } else if (ids.length > 0) {
        const currentPos = ids.indexOf(prospectId);
        const fallbackIndex = currentPos >= 0 ? Math.min(currentPos, ids.length - 1) : 0;
        const fallbackId = ids[fallbackIndex];
        _prospSession.currentId = fallbackId;
        _prospSession.currentIndex = fallbackIndex;
        if (typeof _saveProspSessionToStorage === 'function') _saveProspSessionToStorage();
        viewDetail(fallbackId).catch(function () {});
    } else {
        closeDetail();
        if (typeof showToast === 'function') showToast('Mode Prosp terminé.', 'success');
    }
}

// ═══ Company Sheet Popup (detailed) ═══
function companySheetHasModal() {
    return !!document.getElementById('modalCompanySheet');
}

function companySheetFieldIds() {
    return [
        'cs_groupe', 'cs_site', 'cs_phone', 'cs_notes', 'cs_website', 'cs_linkedin',
        'cs_industry', 'cs_size', 'cs_address', 'cs_city', 'cs_country',
        'cs_stack', 'cs_pain_points', 'cs_budget', 'cs_urgency'
    ];
}

async function loadCompanySheet(companyId) {
    const company = data.companies.find(c => c.id === companyId);
    if (!company) throw new Error('Entreprise introuvable');

    const modal = document.getElementById('modalCompanySheet');
    if (!modal) throw new Error('Modal fiche entreprise absente');

    const title = document.getElementById('companySheetTitle');
    const subtitle = document.getElementById('companySheetSubtitle');
    const hiddenId = document.getElementById('companySheetId');
    if (hiddenId) hiddenId.value = String(companyId);

    let full = { company: company };
    try {
        const res = await fetch(`/api/company/full?id=${companyId}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const payload = await res.json();
        if (!payload || !payload.ok) throw new Error(payload?.error || 'Erreur API');
        full = payload;
    } catch (e) {
        console.warn('Chargement fiche entreprise en fallback local', e);
    }

    const c = full.company || company;
    const subtitleParts = [c.industry, c.size].filter(Boolean);
    if (title) title.textContent = `${c.groupe || 'Entreprise'}${c.site ? ' · ' + c.site : ''}`;
    if (subtitle) subtitle.textContent = subtitleParts.join(' · ');

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = (val === null || val === undefined) ? '' : String(val);
    };
    setVal('cs_groupe', c.groupe);
    setVal('cs_site', c.site);
    setVal('cs_phone', c.phone === 'Non disponible' ? '' : c.phone);
    setVal('cs_notes', c.notes);
    setVal('cs_website', c.website);
    setVal('cs_linkedin', c.linkedin);
    setVal('cs_industry', c.industry);
    setVal('cs_size', c.size);
    setVal('cs_address', c.address);
    setVal('cs_city', c.city);
    setVal('cs_country', c.country);
    setVal('cs_stack', c.stack);
    setVal('cs_pain_points', c.pain_points);
    setVal('cs_budget', c.budget);
    setVal('cs_urgency', c.urgency);

    try {
        const tags = Array.isArray(c.tags) ? c.tags : [];
        const hid = document.getElementById('cs_tags_value');
        if (hid) hid.value = JSON.stringify(tags);
        initTagsEditor('cs_tags_editor', 'cs_tags_value', tags);
    } catch (e) {
        console.warn(e);
    }
}

function setCompanySheetMode(mode) {
    const form = document.getElementById('companySheetForm');
    const editBtn = document.getElementById('companySheetEditBtn');
    const saveBtn = document.getElementById('companySheetSaveBtn');
    const subtitle = document.getElementById('companySheetSubtitle');
    const tagsHost = document.getElementById('cs_tags_editor');
    if (!form) return;

    const normalizedMode = (mode === 'edit') ? 'edit' : 'view';
    companySheetState.mode = normalizedMode;
    form.classList.toggle('company-sheet-form-readonly', normalizedMode === 'view');

    companySheetFieldIds().forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const canEdit = normalizedMode === 'edit' || id === 'cs_notes';
        el.disabled = !canEdit;
        el.readOnly = !canEdit;
    });

    if (tagsHost) {
        const canEditTags = normalizedMode === 'edit';
        tagsHost.style.pointerEvents = canEditTags ? '' : 'none';
        tagsHost.style.opacity = canEditTags ? '' : '0.7';
    }

    if (editBtn) editBtn.style.display = normalizedMode === 'edit' ? 'none' : '';
    if (saveBtn) saveBtn.textContent = normalizedMode === 'edit' ? 'Enregistrer' : 'Enregistrer les notes';
    if (subtitle) {
        const suffix = normalizedMode === 'edit'
            ? ' · mode édition'
            : ' · mode consultation (notes modifiables)';
        if (subtitle.textContent) subtitle.textContent = subtitle.textContent.replace(/\s·\smode .+$/, '') + suffix;
        else subtitle.textContent = 'mode consultation (notes modifiables)';
    }
}

async function openCompanySheet(companyId, mode) {
    if (!Number.isFinite(Number(companyId))) return;
    if (!companySheetHasModal()) {
        const suffix = (mode === 'edit') ? '&companyMode=edit' : '';
        window.location.href = `/entreprises?openCompany=${Number(companyId)}${suffix}`;
        return;
    }

    companySheetState.companyId = Number(companyId);
    const modal = document.getElementById('modalCompanySheet');
    if (!modal) return;
    if (window.openModal) {
        window.openModal(modal);
    } else {
        modal.classList.add('active');
    }

    try {
        await loadCompanySheet(companySheetState.companyId);
        setCompanySheetMode(mode || 'view');
    } catch (e) {
        console.error(e);
        showToast("❌ Impossible de charger la fiche entreprise.", 'error');
        closeCompanySheet();
    }
}

function closeCompanySheet() {
    const modal = document.getElementById('modalCompanySheet');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
}

function syncCompanyCacheFromPayload(payload) {
    const cid = Number(payload.id);
    const company = data.companies.find(c => c.id === cid);
    if (!company) return;
    Object.assign(company, {
        groupe: payload.groupe,
        site: payload.site,
        phone: payload.phone || 'Non disponible',
        notes: payload.notes || '',
        tags: Array.isArray(payload.tags) ? payload.tags : [],
        website: payload.website || '',
        linkedin: payload.linkedin || '',
        industry: payload.industry || '',
        size: payload.size || '',
        address: payload.address || '',
        city: payload.city || '',
        country: payload.country || '',
        stack: payload.stack || '',
        pain_points: payload.pain_points || '',
        budget: payload.budget || '',
        urgency: payload.urgency || ''
    });
}

async function saveCompanySheet(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const companyId = Number(document.getElementById('companySheetId')?.value || 0);
    if (!companyId) return;

    const payload = {
        id: companyId,
        groupe: document.getElementById('cs_groupe')?.value || '',
        site: document.getElementById('cs_site')?.value || '',
        phone: document.getElementById('cs_phone')?.value || '',
        notes: document.getElementById('cs_notes')?.value || '',
        tags: readTagsFromHidden('cs_tags_value'),
        website: document.getElementById('cs_website')?.value || '',
        linkedin: document.getElementById('cs_linkedin')?.value || '',
        industry: document.getElementById('cs_industry')?.value || '',
        size: document.getElementById('cs_size')?.value || '',
        address: document.getElementById('cs_address')?.value || '',
        city: document.getElementById('cs_city')?.value || '',
        country: document.getElementById('cs_country')?.value || '',
        stack: document.getElementById('cs_stack')?.value || '',
        pain_points: document.getElementById('cs_pain_points')?.value || '',
        budget: document.getElementById('cs_budget')?.value || '',
        urgency: document.getElementById('cs_urgency')?.value || ''
    };

    if (!payload.groupe.trim() || !payload.site.trim()) {
        showToast('⚠️ Groupe et Site sont obligatoires.', 'warning');
        return;
    }

    try {
        const res = await fetch('/api/company/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || 'Erreur de sauvegarde');

        syncCompanyCacheFromPayload(payload);
        if (window.__APP_PAGE__ === 'companies') refreshCompaniesUI();
        showToast('✅ Entreprise mise à jour', 'success');
        await loadCompanySheet(companyId);
        setCompanySheetMode(companySheetState.mode);
    } catch (err) {
        console.error(err);
        showToast('❌ Impossible d’enregistrer la fiche entreprise', 'error');
    }
}

function openCompanySheetProspects() {
    const companyId = Number(document.getElementById('companySheetId')?.value || 0);
    if (!companyId) return;
    closeCompanySheet();
    viewProspectsForCompany(companyId);
}

// Compat alias: old quick view entry now opens the detailed company sheet.
function openCompanyQuickView(companyId) {
    const company = data.companies.find(c => c.id === companyId);
    if (!company) return;

    const prospects = data.prospects.filter(p => p.company_id === companyId);
    const phone = (company.phone && company.phone !== 'Non disponible') ? String(company.phone).trim() : '';
    const website = (company.website || '').trim();
    const linkedin = (company.linkedin || '').trim();
    const notes = (company.notes || '').trim();

    const phoneDisplay = phone
        ? `<a href="tel:${phone.replace(/\s/g,'')}" class="btn btn-success btn-sm" style="text-decoration:none;font-size:12px;padding:5px 12px;">📞 ${escapeHtml(phone)}</a>`
        : '<span class="muted">Non renseigné</span>';
    const websiteDisplay = website
        ? `<a href="${escapeHtml(website.startsWith('http') ? website : ('https://' + website))}" target="_blank" rel="noopener" style="color:var(--color-primary);font-size:13px;">${escapeHtml(website)}</a>`
        : '<span class="muted">Non renseigné</span>';
    const linkedinDisplay = linkedin
        ? `<a href="${escapeHtml(linkedin.startsWith('http') ? linkedin : ('https://' + linkedin))}" target="_blank" rel="noopener" style="color:var(--color-primary);font-size:13px;">Voir LinkedIn</a>`
        : '<span class="muted">Non renseigné</span>';
    const notesDisplay = notes
        ? `<div style="white-space:pre-wrap;font-size:13px;line-height:1.45;max-height:160px;overflow-y:auto;">${escapeHtml(notes)}</div>`
        : '<span class="muted">Aucune note</span>';

    const html = `
        <div class="company-quickview-overlay" id="companyQuickViewOverlay" onclick="if(event.target===this)closeCompanyQuickView()">
            <div class="company-quickview-modal">
                <div class="company-quickview-header">
                    <div>
                        <div style="font-size:18px;font-weight:700;">🏢 ${escapeHtml(company.groupe || '')}</div>
                        <div style="font-size:13px;opacity:.8;margin-top:2px;">${escapeHtml(company.site || '')}</div>
                    </div>
                    <button class="company-quickview-close" onclick="closeCompanyQuickView()">✕</button>
                </div>

                <div class="company-quickview-body">
                    <div class="company-quickview-row">
                        <div class="company-quickview-label">📞 Standard</div>
                        <div class="company-quickview-value">${phoneDisplay}</div>
                    </div>
                    <div class="company-quickview-row">
                        <div class="company-quickview-label">🌐 Site</div>
                        <div class="company-quickview-value">${websiteDisplay}</div>
                    </div>
                    <div class="company-quickview-row">
                        <div class="company-quickview-label">🔗 LinkedIn</div>
                        <div class="company-quickview-value">${linkedinDisplay}</div>
                    </div>
                    <div class="company-quickview-row">
                        <div class="company-quickview-label">👥 Prospects</div>
                        <div class="company-quickview-value">${prospects.length} prospect${prospects.length > 1 ? 's' : ''}</div>
                    </div>
                    <div class="company-quickview-row" style="flex-direction:column;align-items:stretch;">
                        <div class="company-quickview-label" style="margin-bottom:6px;">📝 Notes</div>
                        <div>${notesDisplay}</div>
                    </div>
                </div>

                <div class="company-quickview-footer" style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
                    <button class="btn btn-secondary" type="button" onclick="closeCompanyQuickView(); viewProspectsForCompany(${companyId});">👥 Voir prospects entreprise</button>
                    <button class="btn btn-primary" type="button" onclick="closeCompanyQuickView(); openEditCompanyModal(${companyId});">✏️ Modifier entreprise</button>
                </div>
            </div>
        </div>
    `;

    closeCompanyQuickView();
    document.body.insertAdjacentHTML('beforeend', html);
}

function closeCompanyQuickView() {
    const el = document.getElementById('companyQuickViewOverlay');
    if (el) el.remove();
}
async function deleteProspect(id) {
    const prospect = data.prospects.find(p => p.id === id);
    if (!prospect) return;

    const company = data.companies.find(c => c.id === prospect.company_id);
    const label = `${prospect.name} (${company?.groupe || 'Entreprise inconnue'})`;

    if (!confirm(`⚠️ Supprimer définitivement ce prospect ?\n\n${label}`)) return;

    // Find delete button if in modal
    const deleteBtn = document.querySelector('[onclick*="deleteProspect(' + id + ')"]') || 
                      document.querySelector('.btn-danger[onclick*="deleteProspect"]');
    
    await withButtonFeedback(deleteBtn, async () => {
        data.prospects = data.prospects.filter(p => p.id !== id);
        await saveToServerAsync();
        markUnsaved();
        closeDetail();
        filterProspects();
        showToast('🗑️ Prospect supprimé', 'success', 3000);
    }, {
        haptic: true
    });
}


function extractPhoneNumbers(raw) {
    if (!raw) return [];
    // Exemple d'entrée: "04 78 ... / 07 70 ..." ou "04... 07..."
    // On récupère des "blocs" de chiffres (+ possible) assez longs.
    const matches = raw.match(/\+?\d[\d\s().-]{6,}\d/g);
    if (!matches) return [];
    // Nettoyage + dédoublonnage
    const cleaned = matches
.map(s => s.trim())
.map(s => s.replace(/\s+/g, ' '));
    return [...new Set(cleaned)];
}

function normalizeTelForLink(phone) {
    // Pour les liens tel:, on garde + et chiffres
    let p = phone.trim();
    const plus = p.startsWith('+');
    p = p.replace(/[^\d]/g, '');
    return plus ? ('+' + p) : p;
}

function openCallChoice(phones, prospectId) {
    const modal = document.getElementById('modalCallChoice');
    const list = document.getElementById('callChoiceList');
    if (!modal || !list) return;

    list.innerHTML = '';
    phones.forEach((p) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = `📞 ${p}`;
        btn.style.width = '100%';
        btn.onclick = async () => {
            closeCallChoice();
            await touchLastContact(prospectId);
            setTimeout(() => {
                window.location.href = `tel:${normalizeTelForLink(p)}`;
            }, 50);
        };
        list.appendChild(btn);
    });

    if (window.openModal) {
        window.openModal(modal);
    } else {
        modal.classList.add('active');
    }
}

function closeCallChoice() {
    const modal = document.getElementById('modalCallChoice');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
}

function _stampProspectLastContact(prospect) {
    if (!prospect) return;
    const nowIso = todayISO();
    prospect.lastContact = nowIso;
    try {
        const last = document.getElementById('detailLastContact');
        if (last) last.textContent = nowIso;
        const edit = document.getElementById('editLastContact');
        if (edit) edit.value = nowIso;
    } catch (e) {}
}

async function touchLastContact(prospectId) {
    if (!prospectId) return;
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return;

    _stampProspectLastContact(p);

    // Éviter de casser le déroulé Prosp en plein appel (réordonnancement par lastContact).
    if (_currentView === 'prosp' && _prospSession.active) {
        const snapshot = _captureProspectsScrollState(prospectId);
        if (snapshot) {
            _prospSession.listScrollState = snapshot;
            _queueProspectsScrollRestore(snapshot);
        }
    } else {
        try { filterProspects(); } catch (e) {}
    }

    try {
        await saveToServerAsync();
    } catch (err) {
        console.error('Erreur sauvegarde serveur :', err);
        alert("❌ Le serveur local n'a pas pu sauvegarder. Vérifiez que Python est lancé (app.py).");
    }
}

async function callNumber(tel, prospectId) {
    if (!tel) return;
    const phones = extractPhoneNumbers(tel);
    if (phones.length <= 1) {
        await touchLastContact(prospectId);
        setTimeout(() => {
            window.location.href = `tel:${normalizeTelForLink(phones[0] || tel)}`;
        }, 50);
    } else {
        openCallChoice(phones, prospectId);
    }
}

function callNumberById(prospectId) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p || !p.telephone) {
        alert("⚠️ Aucun numéro de téléphone renseigné pour ce prospect.");
        return;
    }
    callNumber(p.telephone, prospectId);
}


function inferCiviliteNomPrenom(fullNameRaw) {
    const fullName = String(fullNameRaw || '').trim();
    let civilite = '';
    if (/(\bMme\b|\bMadame\b)/i.test(fullName)) civilite = 'Mme';
    else if (/(\bM\.?\b|\bMr\b|\bMonsieur\b)/i.test(fullName)) civilite = 'M.';
    const nameClean = fullName.replace(/\b(Mme|Madame|M\.?|Mr|Monsieur)\b\.?/gi, '').trim();
    const parts = nameClean ? nameClean.split(/\s+/) : [];
    const prenom = parts.length >= 2 ? parts[0] : (parts[0] || '');
    const nom = parts.length >= 2 ? parts[parts.length - 1] : (parts[0] || '');
    return { civilite, prenom, nom, fullName: nameClean || fullName };
}

function renderTemplateString(tpl, vars) {
    let s = String(tpl ?? '');
    // Replace HTML var tags: <span class="tpl-var-tag" ...>{{var}}</span>
    s = s.replace(/<span[^>]*class="tpl-var-tag"[^>]*>\{\{\s*([a-zA-Z0-9_]+)\s*\}\}<\/span>/g, (_, k) => {
const v = vars && Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : '';
return (v === null || v === undefined) ? '' : String(v);
    });
    // Replace plain {{var}} patterns
    s = s.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
const v = vars && Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : '';
return (v === null || v === undefined) ? '' : String(v);
    });
    return s;
}

function htmlToPlainText(html) {
    // Convert HTML to plain text for mailto fallback
    let text = html;
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<li>/gi, '- ');
    text = text.replace(/<\/li>/gi, '\n');
    text = text.replace(/<[^>]*>/g, '');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

// ═══════════════════════════════════════════════════════════════
// Teams / Planner Integration helpers (v22.1)
// ═══════════════════════════════════════════════════════════════

function getTeamsPrefix() {
    return (window.AppAuth && AppAuth.user && AppAuth.user.prefix) ? AppAuth.user.prefix : '';
}

async function copyForTeams(text, label) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (_e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
    if (typeof showToast === 'function') {
        showToast('📋 Teams : ' + (label || 'copié'), 'success', 2500);
    }
}

async function copyHtmlToClipboard(html) {
    // Copy rich HTML to clipboard (for pasting in Outlook)
    try {
const blob = new Blob([html], { type: 'text/html' });
const plainBlob = new Blob([htmlToPlainText(html)], { type: 'text/plain' });
await navigator.clipboard.write([
    new ClipboardItem({
        'text/html': blob,
        'text/plain': plainBlob
    })
]);
return true;
    } catch (e) {
console.warn('Clipboard HTML write failed, fallback to plain text', e);
try {
    await navigator.clipboard.writeText(htmlToPlainText(html));
    return true;
} catch (e2) {
    return false;
}
    }
}

function buildTemplateVars(p, company) {
    const name = inferCiviliteNomPrenom(p?.name);
    return {
civilite: name.civilite || '',
prenom: name.prenom || '',
nom: name.nom || name.fullName || '',
nom_complet: name.fullName || '',
entreprise: (company?.groupe || '').trim(),
site: (company?.site || '').trim(),
poste: (p?.fonction || '').trim(),
email: (p?.email || '').trim(),
telephone: (p?.telephone || '').trim(),
linkedin: (p?.linkedin || '').trim(),
date: todayISO(),
    };
}

/**
 * Push categories (loaded from /api/push-categories)
 */
let pushCategories = [];

async function loadPushCategories() {
    try {
const res = await fetch('/api/push-categories');
if (res.ok) pushCategories = await res.json();
    } catch (e) {
console.warn('Failed to load push categories', e);
    }
}

function renderPushCategorySelect(prospectId, selectedId) {
    const cats = Array.isArray(pushCategories) ? pushCategories : [];
    const current = (selectedId !== undefined && selectedId !== null && String(selectedId).trim() !== '') ? Number(selectedId) : null;

    const head = `<option value="" ${!current ? 'selected' : ''}>— Aucune catégorie —</option>`;
    const options = cats.map(c => {
const id = Number(c.id);
const kw = (Array.isArray(c.keywords) && c.keywords.length) ? ` (${c.keywords.slice(0,3).join(', ')})` : '';
const sel = (current && id === current) ? 'selected' : '';
return `<option value="${id}" ${sel}>${escapeHtml(c.name)}${kw}</option>`;
    }).join('');

    const disabled = cats.length ? '' : 'disabled';
    return `<select id="detailCategorySelect" class="template-select" ${disabled} onchange="onPushCategoryChange(${prospectId}, this.value)">${head}${options}</select>`;
}

let __categorySaveTimer = null;
async function onPushCategoryChange(prospectId, value) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return;
    const v = String(value || '').trim();
    p.push_category_id = v ? Number(v) : null;

    // Debounced save
    if (__categorySaveTimer) clearTimeout(__categorySaveTimer);
    __categorySaveTimer = setTimeout(async () => {
        try { await saveToServerAsync(); } catch (e) {}
    }, 700);

    // Load template files (v25.9: nouveau système)
    const templateBox = document.getElementById('detailPushTemplate');
    const templateList = document.getElementById('detailPushTemplateList');
    if (!v) {
        if (templateBox) templateBox.style.display = 'none';
        window._currentPushTemplate = null;
        setTimeout(() => updatePushCandidates(prospectId), 100);
        return;
    }
    
    if (v && templateBox) {
        templateBox.style.display = '';
        if (templateList) templateList.innerHTML = '<span class="muted">Chargement…</span>';
        try {
            const res = await fetch(`/api/push-categories/${v}/files`);
            if (res.ok) {
                const fdata = await res.json();
                if (fdata.ok && fdata.files && fdata.files.length) {
                    // Prendre le premier template disponible
                    const firstTemplate = fdata.files[0];
                    templateList.innerHTML = `
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span>📧 ${escapeHtml(firstTemplate.name)}</span>
                            <span class="muted" style="font-size:11px;">${(firstTemplate.size/1024).toFixed(0)} Ko</span>
                        </div>
                    `;
                    // Stocker le nom du template pour generatePush
                    window._currentPushTemplate = firstTemplate.name;
                    // Mettre à jour le bouton
                    updatePushGenerateButton(prospectId);
                } else {
                    templateList.innerHTML = '<span class="muted">Aucun template disponible. Utilisez "Gérer catégorie" pour en ajouter un.</span>';
                    window._currentPushTemplate = null;
                }
            }
        } catch (e) {
            if (templateList) templateList.innerHTML = '<span class="muted">Erreur de chargement</span>';
            window._currentPushTemplate = null;
        }
    }

    // Mettre à jour les dropdowns de candidats
    setTimeout(() => updatePushCandidates(prospectId), 100);

    // Also refresh unified candidates list with updated category
    const prospect = data.prospects.find(x => x.id === prospectId);
    if (prospect) {
        loadUnifiedCandidates(prospectId, prospect.tags, prospect.push_category_id);
    }
}

// v25.9: Suggérer une catégorie push selon le métier suggéré (appelé après chargement des suggestions)
function suggestPushCategoryFromMetier(prospectId) {
    const prospect = data.prospects.find(p => p.id === prospectId);
    if (!prospect || prospect.push_category_id) return; // Déjà une catégorie sélectionnée
    
    const metierEl = document.getElementById('metierSuggestions');
    if (!metierEl) return;
    
    // Attendre un peu que les catégories soient chargées
    setTimeout(async () => {
        await loadPushCategories();
        const metierText = metierEl.textContent.toLowerCase();
        const suggestedCat = pushCategories.find(cat => {
            const catName = cat.name.toLowerCase();
            const keywords = (cat.keywords || []).map(k => k.toLowerCase());
            // Matching simple : nom de catégorie ou keywords dans le texte du métier
            return metierText.includes(catName) || keywords.some(k => metierText.includes(k)) ||
                   (catName.includes('logiciel') && metierText.includes('logiciel')) ||
                   (catName.includes('embarqué') && (metierText.includes('embarqué') || metierText.includes('iot'))) ||
                   (catName.includes('électronique') && metierText.includes('électronique')) ||
                   (catName.includes('système') && metierText.includes('système'));
        });
        if (suggestedCat) {
            const select = document.getElementById('detailCategorySelect');
            if (select && !select.value) {
                select.value = suggestedCat.id;
                onPushCategoryChange(prospectId, suggestedCat.id);
            }
        }
    }, 800);
}

// v25.9: Mettre à jour les dropdowns de candidats pour le push
async function updatePushCandidates(prospectId) {
    const prospect = data.prospects.find(x => x.id === prospectId);
    if (!prospect) return;
    
    const select1 = document.getElementById('detailPushCandidate1');
    const select2 = document.getElementById('detailPushCandidate2');
    const btnGenerate = document.getElementById('btnGeneratePush');
    
    if (!select1 || !select2) return;
    
    // Charger les 4 meilleurs candidats recommandés
    let recommendedCandidates = [];
    try {
        const res = await fetch(`/api/prospect/${prospectId}/best-candidates${prospect.push_category_id ? `?push_category_id=${prospect.push_category_id}` : ''}`);
        if (res.ok) {
            const data = await res.json();
            if (data.ok && data.candidates) {
                recommendedCandidates = data.candidates.slice(0, 4);
            }
        }
    } catch (e) {
        console.warn('Erreur chargement candidats recommandés:', e);
    }
    
    // Remplir les dropdowns avec tous les candidats (charger depuis l'API si nécessaire)
    let allCandidates = data.candidates || [];
    if (allCandidates.length === 0) {
        // Charger les candidats depuis l'API
        try {
            const res = await fetch('/api/candidates');
            if (res.ok) {
                const apiData = await res.json();
                // Gérer les deux formats : array direct ou {ok: true, candidates: [...]}
                if (Array.isArray(apiData)) {
                    allCandidates = apiData;
                } else if (apiData.ok && apiData.candidates) {
                    allCandidates = apiData.candidates;
                } else if (apiData.candidates) {
                    allCandidates = apiData.candidates;
                }
                if (typeof data !== 'undefined') {
                    data.candidates = allCandidates; // Mettre en cache
                }
            }
        } catch (e) {
            console.warn('Erreur chargement candidats:', e);
        }
    }
    allCandidates = allCandidates.filter(c => !c.is_archived);
    const options = allCandidates.map(c => 
        `<option value="${c.id}">${escapeHtml(c.name)}${c.role ? ' - ' + escapeHtml(c.role) : ''}</option>`
    ).join('');
    
    select1.innerHTML = '<option value="">— Aucun —</option>' + options;
    select2.innerHTML = '<option value="">— Aucun —</option>' + options;
    
    // Pré-remplir avec les candidats recommandés si disponibles
    if (recommendedCandidates.length > 0) {
        if (select1 && recommendedCandidates[0]) {
            select1.value = recommendedCandidates[0].id;
        }
        if (select2 && recommendedCandidates[1]) {
            select2.value = recommendedCandidates[1].id;
        }
    }
    
    // Activer/désactiver le bouton selon les sélections
    updatePushGenerateButton(prospectId);
}

// v25.9: Mettre à jour l'état du bouton de génération
function updatePushGenerateButton(prospectId) {
    const prospect = data.prospects.find(x => x.id === prospectId);
    if (!prospect) return;
    
    const btnGenerate = document.getElementById('btnGeneratePush');
    const select1 = document.getElementById('detailPushCandidate1');
    const select2 = document.getElementById('detailPushCandidate2');
    
    if (btnGenerate) {
        const hasCategory = prospect.push_category_id;
        const hasTemplate = window._currentPushTemplate;
        const hasCandidate = (select1 && select1.value) || (select2 && select2.value);
        btnGenerate.disabled = !(hasCategory && hasTemplate && hasCandidate);
    }
}

// v25.9: Générer le push (template rempli ou ZIP)
async function generatePush(prospectId) {
    const prospect = data.prospects.find(x => x.id === prospectId);
    if (!prospect || !prospect.push_category_id) {
        showToast('Sélectionnez d\'abord une catégorie', 'error');
        return;
    }
    
    const templateName = window._currentPushTemplate;
    if (!templateName) {
        showToast('Aucun template disponible pour cette catégorie', 'error');
        return;
    }
    
    const select1 = document.getElementById('detailPushCandidate1');
    const select2 = document.getElementById('detailPushCandidate2');
    const candidateId1 = select1 ? parseInt(select1.value) : null;
    const candidateId2 = select2 ? parseInt(select2.value) : null;
    
    if (!candidateId1 && !candidateId2) {
        showToast('Sélectionnez au moins un candidat', 'error');
        return;
    }
    
    try {
        showToast('Génération du push en cours...', 'info');
        const res = await fetch('/api/push/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prospect_id: prospectId,
                category_id: prospect.push_category_id,
                template_filename: templateName,
                candidate_id1: candidateId1,
                candidate_id2: candidateId2,
                format: 'zip' // Pour l'instant, toujours ZIP (template + DC)
            })
        });
        
        if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `push_${prospect.name}_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            // Copier l'email dans le presse-papier si disponible
            if (prospect.email) {
                await navigator.clipboard.writeText(prospect.email);
                showToast('Push généré ! Email copié dans le presse-papier', 'success');
            } else {
                showToast('Push généré !', 'success');
            }
        } else {
            const data = await res.json();
            showToast(data.error || 'Erreur lors de la génération', 'error');
        }
    } catch (e) {
        console.error('Erreur génération push:', e);
        showToast('Erreur lors de la génération du push', 'error');
    }
}

// v25.9: Ouvrir la modale de gestion des catégories push
function openPushCategoryManager() {
    if (document.getElementById('pushCategoryManagerModal')) {
        document.getElementById('pushCategoryManagerModal').style.display = 'flex';
        loadPushCategoryManager();
        return;
    }
    
    const modal = document.createElement('div');
    modal.id = 'pushCategoryManagerModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:700px;">
            <button class="modal-close" onclick="closePushCategoryManager()">×</button>
            <h2 style="margin-top:0;">⚙️ Gérer les catégories push</h2>
            <div style="margin-bottom:20px;">
                <button class="btn btn-primary" onclick="createNewPushCategory()">➕ Nouvelle catégorie</button>
            </div>
            <div id="pushCategoryManagerList">
                <span class="muted">Chargement…</span>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'flex';
    loadPushCategoryManager();
}

function closePushCategoryManager() {
    const modal = document.getElementById('pushCategoryManagerModal');
    if (modal) modal.style.display = 'none';
}

async function loadPushCategoryManager() {
    const listBox = document.getElementById('pushCategoryManagerList');
    if (!listBox) return;
    
    try {
        const res = await fetch('/api/push-categories');
        if (res.ok) {
            const categories = await res.json();
            if (categories.length === 0) {
                listBox.innerHTML = '<span class="muted">Aucune catégorie. Créez-en une pour commencer.</span>';
                return;
            }
            
            listBox.innerHTML = categories.map(cat => `
                <div class="push-category-item" style="padding:12px;border:1px solid var(--color-border);border-radius:8px;margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <strong>${escapeHtml(cat.name)}</strong>
                            ${cat.keywords && cat.keywords.length ? `<div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px;">Mots-clés: ${escapeHtml(cat.keywords.join(', '))}</div>` : ''}
                        </div>
                        <div style="display:flex;gap:8px;">
                            <button class="btn btn-secondary btn-sm" onclick="uploadPushTemplate(${cat.id}, '${escapeHtml(cat.name)}')" style="font-size:11px;">📤 Upload template</button>
                            <button class="btn btn-danger btn-sm" onclick="deletePushCategory(${cat.id})" style="font-size:11px;">🗑️</button>
                        </div>
                    </div>
                    <div id="pushCatFiles_${cat.id}" style="margin-top:8px;font-size:11px;color:var(--color-text-secondary);">
                        <span class="muted">Chargement fichiers…</span>
                    </div>
                </div>
            `).join('');
            
            // Charger les fichiers pour chaque catégorie
            categories.forEach(cat => {
                loadPushCategoryFiles(cat.id);
            });
        }
    } catch (e) {
        listBox.innerHTML = '<span class="muted">Erreur de chargement</span>';
    }
}

async function loadPushCategoryFiles(catId) {
    const filesBox = document.getElementById(`pushCatFiles_${catId}`);
    if (!filesBox) return;
    
    try {
        const res = await fetch(`/api/push-categories/${catId}/files`);
        if (res.ok) {
            const data = await res.json();
            if (data.ok && data.files && data.files.length) {
                filesBox.innerHTML = `Templates: ${data.files.map(f => escapeHtml(f.name)).join(', ')}`;
            } else {
                filesBox.innerHTML = '<span class="muted">Aucun template</span>';
            }
        }
    } catch (e) {
        filesBox.innerHTML = '<span class="muted">Erreur</span>';
    }
}

function createNewPushCategory() {
    const name = prompt('Nom de la catégorie:');
    if (!name || !name.trim()) return;
    
    fetch('/api/push-categories/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
    }).then(res => res.json()).then(data => {
        if (data.ok) {
            showToast('Catégorie créée', 'success');
            loadPushCategoryManager();
            loadPushCategories().then(() => {
                // Recharger le select dans la fiche prospect si ouvert
                const select = document.getElementById('detailCategorySelect');
                if (select) {
                    const prospectId = window._currentDetailProspectId;
                    if (prospectId) {
                        const prospect = data.prospects.find(p => p.id === prospectId);
                        if (prospect) {
                            select.outerHTML = renderPushCategorySelect(prospectId, prospect.push_category_id);
                        }
                    }
                }
            });
        } else {
            showToast(data.error || 'Erreur', 'error');
        }
    });
}

function uploadPushTemplate(catId, catName) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.msg,.eml,.oft,.htm,.html';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            showToast('Upload en cours...', 'info');
            const res = await fetch(`/api/push-categories/${catId}/upload-template`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.ok) {
                showToast('Template uploadé avec succès', 'success');
                loadPushCategoryFiles(catId);
            } else {
                showToast(data.error || 'Erreur upload', 'error');
            }
        } catch (e) {
            showToast('Erreur upload', 'error');
        }
    };
    input.click();
}

function deletePushCategory(catId) {
    if (!confirm('Supprimer cette catégorie ? Les templates associés seront également supprimés.')) return;
    
    fetch('/api/push-categories/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: catId })
    }).then(res => res.json()).then(data => {
        if (data.ok) {
            showToast('Catégorie supprimée', 'success');
            loadPushCategoryManager();
            loadPushCategories();
        } else {
            showToast(data.error || 'Erreur', 'error');
        }
    });
}

function onTemplateChange(prospectId, value) {
    onPushCategoryChange(prospectId, value);
}

// ===== Tags editor (chips) with autocomplete from referential =====
function normalizeTags(input) {
    const arr = Array.isArray(input) ? input : [];
    return Array.from(new Set(arr.map(t => String(t || '').trim()).filter(Boolean)));
}

// Tag color hash — consistent color per tag name
function _tagColor(tag) {
    const colors = ['#3b82f6','#8b5cf6','#ec4899','#f97316','#14b8a6','#eab308','#ef4444','#22c55e','#6366f1','#0ea5e9','#f43f5e','#84cc16','#a855f7','#06b6d4'];
    let h = 0;
    for (let i = 0; i < (tag||'').length; i++) h = ((h << 5) - h + tag.charCodeAt(i)) | 0;
    return colors[Math.abs(h) % colors.length];
}

function initTagsEditor(containerId, hiddenInputId, initialTags) {
    const box = document.getElementById(containerId);
    const hidden = document.getElementById(hiddenInputId);
    if (!box || !hidden) return;

    let tags = normalizeTags(initialTags);
    const refSet = (typeof buildReferentialTagSet === 'function') ? buildReferentialTagSet() : new Set();
    const acList = (typeof buildAutocompleteTags === 'function') ? buildAutocompleteTags() : [];

    function syncHidden() {
hidden.value = JSON.stringify(tags);
    }

    function render() {
box.innerHTML = '';
const chips = document.createElement('div');
chips.className = 'tag-chips';

tags.forEach((t, idx) => {
    const chip = document.createElement('span');
    const inRef = refSet.has(t.toLowerCase());
    chip.className = 'tag-chip' + (inRef ? '' : ' tag-chip-custom');
    const tagColor = _tagColor(t);
    chip.style.cssText = `background:${tagColor}18;color:${tagColor};border:1px solid ${tagColor}30;`;
    chip.title = inRef ? 'Référentiel Up Technologies' : 'Tag personnalisé (hors référentiel)';
    chip.innerHTML = `<span>${escapeHtml(t)}${inRef ? '' : ' <span style="opacity:.5;font-size:10px;">✱</span>'}</span><button type="button" class="tag-x" title="Retirer">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
        tags.splice(idx, 1);
        tags = normalizeTags(tags);
        syncHidden();
        render();
        refreshMetierPreview();
    });
    chips.appendChild(chip);
});

// Input with autocomplete
const wrap = document.createElement('div');
wrap.style.cssText = 'position:relative;width:100%;';

const input = document.createElement('input');
input.type = 'text';
input.placeholder = 'Ajouter une compétence… (Entrée)';
input.className = 'tag-input';
input.autocomplete = 'off';

const dropdown = document.createElement('div');
dropdown.className = 'tag-autocomplete-dropdown';
dropdown.style.cssText = 'display:none;position:absolute;top:100%;left:0;right:0;z-index:99;max-height:180px;overflow-y:auto;border-radius:10px;border:1px solid var(--color-border);background:var(--color-surface);box-shadow:0 8px 24px rgba(0,0,0,.15);margin-top:2px;';

let selectedIdx = -1;
let filteredItems = [];

function showSuggestions(val) {
    const q = val.toLowerCase().trim();
    if (!q || q.length < 1) { dropdown.style.display = 'none'; return; }
    const existing = new Set(tags.map(t => t.toLowerCase()));
    filteredItems = acList.filter(t => t.toLowerCase().includes(q) && !existing.has(t.toLowerCase())).slice(0, 10);
    if (!filteredItems.length) { dropdown.style.display = 'none'; return; }
    selectedIdx = -1;
    dropdown.innerHTML = '';
    filteredItems.forEach((item, i) => {
        const div = document.createElement('div');
        div.style.cssText = 'padding:7px 12px;cursor:pointer;font-size:12.5px;transition:background .1s;';
        div.textContent = item;
        div.addEventListener('mouseenter', () => { selectedIdx = i; highlightItem(); });
        div.addEventListener('click', () => { addTag(item); });
        dropdown.appendChild(div);
    });
    dropdown.style.display = 'block';
}

function highlightItem() {
    Array.from(dropdown.children).forEach((d, i) => {
        d.style.background = (i === selectedIdx) ? 'rgba(50,184,198,.12)' : '';
    });
}

function addTag(val) {
    const v = val.trim().replace(/^,+|,+$/g, '');
    if (v) {
        tags.push(v);
        tags = normalizeTags(tags);
        input.value = '';
        dropdown.style.display = 'none';
        syncHidden();
        render();
        refreshMetierPreview();
    }
}

input.addEventListener('input', () => showSuggestions(input.value));
input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && filteredItems.length) {
        e.preventDefault();
        selectedIdx = Math.min(selectedIdx + 1, filteredItems.length - 1);
        highlightItem();
    } else if (e.key === 'ArrowUp' && filteredItems.length) {
        e.preventDefault();
        selectedIdx = Math.max(selectedIdx - 1, 0);
        highlightItem();
    } else if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        if (selectedIdx >= 0 && filteredItems[selectedIdx]) {
            addTag(filteredItems[selectedIdx]);
        } else {
            addTag(input.value);
        }
    } else if (e.key === 'Backspace' && !input.value && tags.length > 0) {
        tags.pop();
        syncHidden();
        render();
        refreshMetierPreview();
    } else if (e.key === 'Escape') {
        dropdown.style.display = 'none';
    }
});

input.addEventListener('blur', () => { setTimeout(() => { dropdown.style.display = 'none'; }, 150); });

wrap.appendChild(input);
wrap.appendChild(dropdown);
box.appendChild(chips);
box.appendChild(wrap);
syncHidden();
    }

    render();
}

function refreshMetierPreview() {
    // Refresh the metier suggestions in the info tab if visible
    const el = document.getElementById('metierSuggestions');
    if (!el) return;
    const tags = readTagsFromHidden('editTagsValue');
    const fakeProspect = { tags, fixedMetier: '' };
    const metierSel = document.getElementById('editMetier');
    if (metierSel && metierSel.value) fakeProspect.fixedMetier = metierSel.value;
    el.innerHTML = renderMetierSection(fakeProspect);
}

function readTagsFromHidden(hiddenId) {
    const el = document.getElementById(hiddenId);
    if (!el) return [];
    const v = (el.value || '').trim();
    if (!v) return [];
    try {
const j = JSON.parse(v);
return normalizeTags(j);
    } catch (e) {
return normalizeTags(v.split(','));
    }
}

/* ── Métier matching & rendering ── */

function renderMetierSection(prospect) {
    if (!prospect) return '<span class="muted">—</span>';

    // If a metier is manually fixed, show it prominently
    if (prospect.fixedMetier) {
const parts = prospect.fixedMetier.split(' > ');
return `<div class="metier-fixed-badge">
    <span class="metier-fixed-icon">📌</span>
    <span><strong>${escapeHtml(parts[0] || '')}</strong> › ${escapeHtml(parts[1] || '')}</span>
    <button class="mini-link-btn" onclick="clearFixedMetier(${prospect.id})" title="Retirer le métier fixé">✕</button>
</div>`;
    }

    // Auto-suggest based on tags
    if (!prospect.tags || !prospect.tags.length) {
return '<span class="muted">Ajoutez des compétences pour obtenir des suggestions de métier</span>';
    }

    if (typeof computeMetierMatches !== 'function') return '<span class="muted">Référentiel non chargé</span>';

    // Version synchrone pour affichage immédiat
    const matches = computeMetierMatches(prospect.tags).slice(0, 3);
    if (!matches.length) {
        // Si aucune correspondance, lancer l'intégration en arrière-plan et réafficher
        if (typeof computeMetierMatchesEnhanced === 'function' && prospect.id) {
            const company = data.companies.find(c => c.id === prospect.company_id);
            const context = {
                company: company ? `${company.groupe} (${company.site})` : '',
                fonction: prospect.fonction || '',
                linkedin: prospect.linkedin || ''
            };
            computeMetierMatchesEnhanced(prospect.tags, context).then(enhancedMatches => {
                if (enhancedMatches.length > 0) {
                    const el = document.getElementById('metierSuggestions');
                    if (el) {
                        el.innerHTML = enhancedMatches.slice(0, 3).map((m, i) => {
                            const barWidth = Math.max(m.score, 8);
                            const opacity = i === 0 ? 1 : (i === 1 ? 0.7 : 0.5);
                            const fullPath = m.category + ' > ' + m.specialty;
                            const integratedBadge = m.hasIntegratedTags ? ' <span style="font-size:10px;opacity:0.7;" title="Tags intégrés via IA">🤖</span>' : '';
                            return `<div class="metier-suggestion" style="opacity:${opacity};" title="${m.matched}/${m.total} tags matchés: ${m.matchedTags.join(', ')}">
    <div class="metier-suggestion-header">
        <span class="metier-suggestion-icon" style="color:${m.categoryColor}">${m.categoryIcon}</span>
        <span class="metier-suggestion-name"><strong>${escapeHtml(m.category)}</strong> › ${escapeHtml(m.specialty)}</span>
        <span class="metier-suggestion-score">${m.score}%${integratedBadge}</span>
        ${prospect.id ? `<button class="mini-link-btn" onclick="fixMetier(${prospect.id}, '${escapeHtml(fullPath).replace(/'/g, "\\'")}')">📌</button>` : ''}
    </div>
    <div class="metier-bar-bg"><div class="metier-bar-fill" style="width:${barWidth}%;background:${m.categoryColor};"></div></div>
</div>`;
                        }).join('');
                    }
                }
            });
        }
        return '<span class="muted">Aucune correspondance trouvée. Intégration des tags en cours…</span>';
    }

    const html = matches.map((m, i) => {
const barWidth = Math.max(m.score, 8);
const opacity = i === 0 ? 1 : (i === 1 ? 0.7 : 0.5);
const fullPath = m.category + ' > ' + m.specialty;
return `<div class="metier-suggestion" style="opacity:${opacity};" title="${m.matched}/${m.total} tags matchés: ${m.matchedTags.join(', ')}">
    <div class="metier-suggestion-header">
        <span class="metier-suggestion-icon" style="color:${m.categoryColor}">${m.categoryIcon}</span>
        <span class="metier-suggestion-name"><strong>${escapeHtml(m.category)}</strong> › ${escapeHtml(m.specialty)}</span>
        <span class="metier-suggestion-score">${m.score}%</span>
        ${prospect.id ? `<button class="mini-link-btn" onclick="fixMetier(${prospect.id}, '${escapeHtml(fullPath).replace(/'/g, "\\'")}')">📌</button>` : ''}
    </div>
    <div class="metier-bar-bg"><div class="metier-bar-fill" style="width:${barWidth}%;background:${m.categoryColor};"></div></div>
</div>`;
    }).join('');
    
    // v25.9: Suggérer une catégorie push après affichage des métiers
    if (prospect.id && typeof suggestPushCategoryFromMetier === 'function') {
        setTimeout(() => suggestPushCategoryFromMetier(prospect.id), 300);
    }
    
    return html;
}

// Fonction pour rafraîchir les suggestions de métier (appelée après intégration)
async function refreshMetierSuggestions() {
    const prospectId = window._currentDetailProspectId;
    if (!prospectId) return;
    const prospect = data.prospects.find(p => p.id === prospectId);
    if (!prospect) return;
    
    const company = data.companies.find(c => c.id === prospect.company_id);
    const context = {
        company: company ? `${company.groupe} (${company.site})` : '',
        fonction: prospect.fonction || '',
        linkedin: prospect.linkedin || ''
    };
    
    // Recharger le cache des intégrations
    if (typeof loadTagIntegrationsCache === 'function') {
        await loadTagIntegrationsCache();
    }
    
    if (typeof computeMetierMatchesEnhanced === 'function') {
        computeMetierMatchesEnhanced(prospect.tags, context).then(enhancedMatches => {
            const el = document.getElementById('metierSuggestions');
            if (el) {
                if (enhancedMatches.length > 0) {
                    el.innerHTML = enhancedMatches.slice(0, 3).map((m, i) => {
                        const barWidth = Math.max(m.score, 8);
                        const opacity = i === 0 ? 1 : (i === 1 ? 0.7 : 0.5);
                        const fullPath = m.category + ' > ' + m.specialty;
                        const integratedBadge = m.hasIntegratedTags ? ' <span style="font-size:10px;opacity:0.7;" title="Tags intégrés via IA">🤖</span>' : '';
                        return `<div class="metier-suggestion" style="opacity:${opacity};" title="${m.matched}/${m.total} tags matchés: ${m.matchedTags.join(', ')}">
    <div class="metier-suggestion-header">
        <span class="metier-suggestion-icon" style="color:${m.categoryColor}">${m.categoryIcon}</span>
        <span class="metier-suggestion-name"><strong>${escapeHtml(m.category)}</strong> › ${escapeHtml(m.specialty)}</span>
        <span class="metier-suggestion-score">${m.score}%${integratedBadge}</span>
        ${prospect.id ? `<button class="mini-link-btn" onclick="fixMetier(${prospect.id}, '${escapeHtml(fullPath).replace(/'/g, "\\'")}')">📌</button>` : ''}
    </div>
    <div class="metier-bar-bg"><div class="metier-bar-fill" style="width:${barWidth}%;background:${m.categoryColor};"></div></div>
</div>`;
                    }).join('');
                } else {
                    el.innerHTML = '<span class="muted">Aucune correspondance trouvée</span>';
                }
            }
            
            // Mettre à jour l'affichage des tags pour montrer ceux qui ont été intégrés
            const tagsEl = document.getElementById('detailTagsContainer');
            if (tagsEl && prospect.tags && prospect.tags.length) {
                const refSet = typeof buildReferentialTagSet === 'function' ? buildReferentialTagSet() : new Set();
                const integrations = window._tagIntegrationsCache || {};
                tagsEl.innerHTML = prospect.tags.map(t => {
                    const tLower = t.toLowerCase().trim();
                    const inRef = refSet.has(tLower);
                    const integrated = integrations[tLower] && integrations[tLower].category;
                    let title = inRef ? 'Référentiel Up Technologies' : (integrated ? 'Tag intégré via IA dans ' + integrations[tLower].category : 'Tag personnalisé (hors référentiel)');
                    let badge = inRef ? '' : (integrated ? ' 🤖' : ' *');
                    return `<span class="tag-pill${inRef ? '' : ' tag-pill-custom'}" title="${title}">${escapeHtml(t)}${badge}</span>`;
                }).join(' ');
            }
        });
    }
}

function buildMetierOptionsHtml(currentValue) {
    if (typeof METIERS_DATA === 'undefined') return '';
    let html = '';
    METIERS_DATA.forEach(m => {
html += `<optgroup label="${m.icon} ${m.name}">`;
m.specialties.forEach(sp => {
    const val = m.name + ' > ' + sp.name;
    html += `<option value="${escapeHtml(val)}" ${currentValue === val ? 'selected' : ''}>${sp.name}</option>`;
});
html += `</optgroup>`;
    });
    return html;
}

function fixMetier(prospectId, metierPath) {
    const prospect = data.prospects.find(p => p.id === prospectId);
    if (!prospect) return;
    prospect.fixedMetier = metierPath;
    saveToServer();
    markUnsaved();
    viewDetail(prospectId);
}

function clearFixedMetier(prospectId) {
    const prospect = data.prospects.find(p => p.id === prospectId);
    if (!prospect) return;
    prospect.fixedMetier = '';
    saveToServer();
    markUnsaved();
    viewDetail(prospectId);
}


// v25.3: Modale pour sélectionner candidats et consultants avant push
let _pushModalProspectId = null;
let _pushModalChannel = 'email';
let _pushModalCandidates = [];
let _pushModalUsers = [];

function _ensurePushModal() {
    if (document.getElementById('pushSelectModal')) return;
    const modal = document.createElement('div');
    modal.id = 'pushSelectModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:700px;">
            <button class="modal-close" onclick="closePushSelectModal()">×</button>
            <h2 style="margin-top:0;">📤 Envoyer un push</h2>
            <div style="margin-bottom:20px;">
                <label style="display:block;margin-bottom:8px;font-weight:600;">Catégorie push (optionnel)</label>
                <select id="pushModalCategory" class="input" style="width:100%;">
                    <option value="">Aucune catégorie</option>
                </select>
            </div>
            <div style="margin-bottom:20px;">
                <label style="display:block;margin-bottom:8px;font-weight:600;">Candidat 1 (optionnel)</label>
                <select id="pushModalCandidate1" class="input" style="width:100%;">
                    <option value="">Aucun candidat</option>
                </select>
            </div>
            <div style="margin-bottom:20px;">
                <label style="display:block;margin-bottom:8px;font-weight:600;">Candidat 2 (optionnel)</label>
                <select id="pushModalCandidate2" class="input" style="width:100%;">
                    <option value="">Aucun candidat</option>
                </select>
            </div>
            <div style="margin-bottom:20px;">
                <label style="display:block;margin-bottom:8px;font-weight:600;">Consultant 1 (optionnel)</label>
                <select id="pushModalConsultant1" class="input" style="width:100%;">
                    <option value="">Aucun consultant</option>
                </select>
            </div>
            <div style="margin-bottom:20px;">
                <label style="display:block;margin-bottom:8px;font-weight:600;">Consultant 2 (optionnel)</label>
                <select id="pushModalConsultant2" class="input" style="width:100%;">
                    <option value="">Aucun consultant</option>
                </select>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button class="btn btn-secondary" onclick="closePushSelectModal()">Annuler</button>
                <button class="btn btn-primary" onclick="confirmPushSend()">📤 Envoyer</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function openPushSelectModal(prospectId, channel = 'email') {
    _ensurePushModal();
    _pushModalProspectId = prospectId;
    _pushModalChannel = channel;
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) {
        showToast("⚠️ Prospect introuvable.", 'warning');
        return;
    }
    if (channel === 'email' && !p.email) {
        showToast("⚠️ Aucun email renseigné pour ce prospect.", 'warning');
        return;
    }
    if (channel === 'linkedin' && !p.linkedin) {
        showToast("⚠️ Aucun LinkedIn renseigné pour ce prospect.", 'warning');
        return;
    }

    // Charger les catégories push
    const catSelect = document.getElementById('pushModalCategory');
    if (catSelect) {
        try {
            const res = await fetch('/api/push-categories');
            if (res.ok) {
                const cats = await res.json();
                catSelect.innerHTML = '<option value="">Aucune catégorie</option>' +
                    (Array.isArray(cats) ? cats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('') : '');
                if (p.push_category_id) {
                    catSelect.value = String(p.push_category_id);
                }
            }
        } catch (e) {
            console.warn('Error loading push categories', e);
        }
    }

    // Charger les candidats
    _pushModalCandidates = [];
    const cand1Select = document.getElementById('pushModalCandidate1');
    const cand2Select = document.getElementById('pushModalCandidate2');
    if (cand1Select && cand2Select) {
        try {
            const qs = p.push_category_id ? `?push_category_id=${encodeURIComponent(p.push_category_id)}` : '';
            const res = await fetch(`/api/prospect/${prospectId}/best-candidates${qs}`);
            if (res.ok) {
                const j = await res.json();
                if (j.ok && j.candidates) {
                    _pushModalCandidates = j.candidates;
                    const options = '<option value="">Aucun candidat</option>' +
                        _pushModalCandidates.map(c => `<option value="${c.id}">${escapeHtml(c.name)}${c.role ? ' - ' + escapeHtml(c.role) : ''}</option>`).join('');
                    cand1Select.innerHTML = options;
                    cand2Select.innerHTML = options;
                }
            }
        } catch (e) {
            console.warn('Error loading candidates', e);
        }
    }

    // Charger les utilisateurs (consultants)
    _pushModalUsers = [];
    const cons1Select = document.getElementById('pushModalConsultant1');
    const cons2Select = document.getElementById('pushModalConsultant2');
    if (cons1Select && cons2Select) {
        try {
            const res = await fetch('/api/users');
            if (res.ok) {
                const users = await res.json();
                if (Array.isArray(users)) {
                    _pushModalUsers = users;
                    const options = '<option value="">Aucun consultant</option>' +
                        users.map(u => `<option value="${u.id}">${escapeHtml(u.display_name || u.username || 'Utilisateur ' + u.id)}</option>`).join('');
                    cons1Select.innerHTML = options;
                    cons2Select.innerHTML = options;
                }
            }
        } catch (e) {
            console.warn('Error loading users', e);
        }
    }

    const modal = document.getElementById('pushSelectModal');
    if (modal) {
        if (window.openModal) {
            window.openModal(modal);
        } else {
            modal.classList.add('active');
        }
    }
}

function closePushSelectModal() {
    const modal = document.getElementById('pushSelectModal');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
    _pushModalProspectId = null;
    _pushModalChannel = 'email';
}

async function confirmPushSend() {
    if (!_pushModalProspectId) return;
    const p = data.prospects.find(x => x.id === _pushModalProspectId);
    if (!p) {
        showToast("⚠️ Prospect introuvable.", 'error');
        return;
    }
    const channel = _pushModalChannel || 'email';
    if (channel === 'email' && !p.email) {
        showToast("⚠️ Aucun email renseigné.", 'error');
        return;
    }
    if (channel === 'linkedin' && !p.linkedin) {
        showToast("⚠️ Aucun LinkedIn renseigné.", 'error');
        return;
    }

    const catId = document.getElementById('pushModalCategory')?.value || null;
    const candidateId1 = document.getElementById('pushModalCandidate1')?.value || null;
    const candidateId2 = document.getElementById('pushModalCandidate2')?.value || null;
    const consultantId1 = document.getElementById('pushModalConsultant1')?.value || null;
    const consultantId2 = document.getElementById('pushModalConsultant2')?.value || null;

    const company = data.companies.find(c => c.id === p.company_id);
    const companyName = company?.groupe || '';

    let text = '';
    let templateOpened = false;
    let templateName = '';

    if (channel === 'email') {
        // ALWAYS copy the email address to clipboard
        try { await navigator.clipboard.writeText(p.email); } catch(e) {
            const ta = document.createElement('textarea');
            ta.value = p.email;
            ta.style.position = 'fixed'; ta.style.left = '-9999px';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy');
            document.body.removeChild(ta);
        }
    } else if (channel === 'linkedin') {
        // Template choisi -> sinon défaut
        let templateId = p.template_id;
        const tpl = (templateId ? getTemplateById(templateId) : null) || getDefaultTemplate();
        const vars = buildTemplateVars(p, company);

        // Check for custom InMail template in settings
        try {
            const settingsRes = await fetch('/api/settings');
            const settings = await settingsRes.json();
            if (settings && settings.linkedin_inmail_template && settings.linkedin_inmail_template.trim()) {
                text = renderTemplateString(settings.linkedin_inmail_template, vars).trim();
            }
        } catch(e) {}

        if (!text) {
            text = `Bonjour ${vars.civilite ? (vars.civilite + ' ') : ''}${vars.nom || vars.nom_complet || ''},\n\nJe me permets de vous contacter concernant ${vars.entreprise || 'votre entreprise'}.\n\nBelle journée,`;
            if (tpl) {
                const b = renderTemplateString((tpl.linkedin_body || tpl.linkedinBody || tpl.body || ''), vars).trim();
                if (b) text = b;
            }
        }

        // Copy to clipboard
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            try { document.execCommand('copy'); } catch (e2) {}
            document.body.removeChild(ta);
        }

        // Open LinkedIn profile in new tab
        if (p.linkedin) {
            window.open(p.linkedin, '_blank');
        }
    }

    // Try to open .msg template if push category is set (email only)
    if (channel === 'email' && catId) {
        try {
            const res = await fetch(`/api/push-categories/${catId}/files`);
            if (res.ok) {
                const fdata = await res.json();
                if (fdata.ok && fdata.files && fdata.files.length) {
                    const file = fdata.files[0];
                    templateName = file.name;
                    const openRes = await fetch('/api/pushs/open', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ category_id: catId, filename: file.name })
                    });
                    const openData = await openRes.json();
                    if (openData.ok) {
                        templateOpened = true;
                    } else {
                        showToast(`⚠️ Impossible d'ouvrir le template : ${openData.error || 'erreur inconnue'}`, 'warning', 5000);
                    }
                } else {
                    showToast("⚠️ Aucun fichier template (.msg/.eml) trouvé dans cette catégorie.", 'warning', 4000);
                }
            } else {
                showToast(`⚠️ Erreur chargement catégorie (HTTP ${res.status})`, 'warning');
            }
        } catch (e) {
            console.warn('Error opening push file', e);
            showToast(`⚠️ Erreur réseau : ${e.message}`, 'warning');
        }
    }

    // Télécharger automatiquement les dossiers de compétences des candidats sélectionnés (email only)
    if (channel === 'email' && (candidateId1 || candidateId2)) {
        const candidateIds = [candidateId1, candidateId2].filter(Boolean);
        for (const candId of candidateIds) {
            try {
                // Récupérer les infos du candidat pour vérifier s'il a un dossier de compétence
                const candRes = await fetch(`/api/candidates/${candId}`);
                if (candRes.ok) {
                    const candData = await candRes.json();
                    if (candData.ok && candData.candidate && candData.candidate.dossier_competence_pdf) {
                        // Télécharger le PDF
                        const pdfUrl = `/api/candidates/${candId}/dossier-competence`;
                        const link = document.createElement('a');
                        link.href = pdfUrl;
                        link.download = candData.candidate.dossier_competence_pdf;
                        link.style.display = 'none';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        // Petit délai entre les téléchargements pour éviter les problèmes
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }
            } catch (e) {
                console.warn(`Error downloading PDF for candidate ${candId}:`, e);
            }
        }
    }

    // Mark push as sent
    const sentAt = todayISO();
    if (channel === 'email') {
        p.pushEmailSentAt = sentAt;
        try {
            const el = document.getElementById('detailPushSent');
            if (el) el.textContent = '✅ ' + sentAt;
        } catch (e) {}
    } else if (channel === 'linkedin') {
        p.pushLinkedInSentAt = sentAt;
        try {
            const el = document.getElementById('detailPushLinkedInSent');
            if (el) el.textContent = '✅ ' + sentAt;
        } catch (e) {}
    }

    try { await saveToServerAsync(); } catch (e) {}

    // Log push avec candidats et consultants
    try {
        await fetch('/api/push-logs/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prospect_id: p.id, sentAt, channel: channel,
                to_email: channel === 'email' ? p.email : null,
                subject: channel === 'email' ? (templateOpened ? `Push ${companyName}` : 'Push manuel') : null,
                body: channel === 'email' ? (templateOpened ? `Template: ${templateName}` : '') : text,
                template_id: null,
                template_name: templateName || null,
                candidate_id1: candidateId1 ? parseInt(candidateId1, 10) : null,
                candidate_id2: candidateId2 ? parseInt(candidateId2, 10) : null,
                consultant1_id: consultantId1 ? parseInt(consultantId1, 10) : null,
                consultant2_id: consultantId2 ? parseInt(consultantId2, 10) : null
            })
        });
    } catch (e) {
        console.warn('Error logging push', e);
    }

    closePushSelectModal();

    // Feedback
    if (channel === 'email') {
        if (templateOpened) {
            showToast(`✅ Email ${p.email} copié ! Template Outlook ouvert. Collez l'email dans "À:".`, 'success', 6000);
        } else {
            showToast(`📋 Email ${p.email} copié dans le presse-papier.`, 'info', 4000);
        }
    } else if (channel === 'linkedin') {
        showToast(`📋 Message LinkedIn copié ! Profil ouvert dans un nouvel onglet.`, 'success', 4000);
    }
}

async function openEmailForProspect(prospectId) {
    // v25.3: Ouvrir la modale de sélection candidats/consultants
    await openPushSelectModal(prospectId);
}


// ═══ OLLAMA — Appel IA locale (proxy backend) ═══
/** Affiche/masque l'indicateur visuel de progression Ollama */
function _showOllamaProgress(show, message, tokenCount) {
    let overlay = document.getElementById('ollama-progress-overlay');
    if (show) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'ollama-progress-overlay';
            overlay.innerHTML = `
                <div class="ollama-progress-container">
                    <div class="ollama-progress-spinner"></div>
                    <div class="ollama-progress-message" id="ollama-progress-message">${message || 'Connexion à Ollama…'}</div>
                    <div class="ollama-progress-stats" id="ollama-progress-stats"></div>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        const msgEl = document.getElementById('ollama-progress-message');
        const statsEl = document.getElementById('ollama-progress-stats');
        if (msgEl) msgEl.textContent = message || 'Connexion à Ollama…';
        if (statsEl && tokenCount !== undefined) {
            statsEl.textContent = tokenCount > 0 ? `${tokenCount} caractères reçus` : '';
        }
        overlay.style.display = 'flex';
    } else {
        if (overlay) overlay.style.display = 'none';
    }
}

/** Envoie le prompt à Ollama via le backend avec streaming, retourne le texte généré. options.timeoutMs (ex. 300000 pour 5 min). Rejette en cas d'erreur. */
async function callOllama(prompt, options) {
    options = options || {};
    const timeoutMs = options.timeoutMs != null ? Math.max(10000, Math.min(600000, options.timeoutMs)) : 180000;
    const useStream = options.stream !== false; // Streaming par défaut, peut être désactivé
    
    // Afficher l'indicateur visuel
    _showOllamaProgress(true, 'Connexion à Ollama…', 0);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(function () { 
        controller.abort(); 
        _showOllamaProgress(false);
    }, timeoutMs);
    
    try {
        const body = { prompt };
        if (options.model) body.model = options.model;
        body.timeout = Math.min(600, Math.ceil(timeoutMs / 1000));
        
        let fullText = '';
        let tokenCount = 0;
        
        if (useStream) {
            // Mode streaming avec SSE
            const res = await fetch('/api/ollama/generate-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                const msg = data.error || ('Erreur ' + res.status);
                _showOllamaProgress(false);
                if (typeof showToast === 'function') showToast('Ollama : ' + msg, 'error', 5000);
                throw new Error(msg);
            }
            
            // Lire le stream SSE
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                // SSE utilise des blocs séparés par \n\n
                let parts = buffer.split('\n\n');
                buffer = parts.pop() || ''; // Garder le dernier bloc incomplet
                
                for (const part of parts) {
                    const lines = part.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.type === 'start') {
                                    _showOllamaProgress(true, data.message || 'Génération en cours…', 0);
                                } else if (data.type === 'token') {
                                    fullText += data.text || '';
                                    tokenCount = fullText.length;
                                    _showOllamaProgress(true, 'Génération en cours…', tokenCount);
                                    if (data.done) {
                                        // Dernier token
                                        _showOllamaProgress(true, 'Finalisation…', tokenCount);
                                    }
                                } else if (data.type === 'end') {
                                    _showOllamaProgress(true, data.message || 'Terminé', tokenCount);
                                } else if (data.type === 'error') {
                                    _showOllamaProgress(false);
                                    if (typeof showToast === 'function') showToast('Ollama : ' + data.message, 'error', 5000);
                                    throw new Error(data.message);
                                }
                            } catch (e) {
                                // Ignorer les erreurs de parsing des lignes SSE invalides
                                if (e.name !== 'SyntaxError') {
                                    console.warn('Erreur parsing SSE:', e);
                                }
                            }
                        }
                    }
                }
            }
            
            clearTimeout(timeoutId);
            _showOllamaProgress(false);
            if (typeof showToast === 'function') showToast('Ollama : résultat reçu', 'success', 2500);
            return fullText;
        } else {
            // Mode non-streaming (fallback)
            const res = await fetch('/api/ollama/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            _showOllamaProgress(false);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = data.error || ('Erreur ' + res.status);
                if (typeof showToast === 'function') showToast('Ollama : ' + msg, 'error', 5000);
                throw new Error(msg);
            }
            if (!data.ok || data.text === undefined) {
                if (typeof showToast === 'function') showToast('Réponse Ollama invalide', 'error', 4000);
                throw new Error('Réponse invalide');
            }
            if (typeof showToast === 'function') showToast('Ollama : résultat reçu', 'success', 2500);
            return data.text;
        }
    } catch (e) {
        clearTimeout(timeoutId);
        _showOllamaProgress(false);
        if (e.name === 'AbortError') {
            if (typeof showToast === 'function') showToast('Génération trop longue. Utilisez « Copier » puis collez le retour manuellement, ou réduisez le nombre d\'entrées.', 'error', 8000);
            throw new Error('Timeout');
        }
        if (e.name === 'TypeError' && e.message.includes('fetch')) {
            if (typeof showToast === 'function') showToast('Ollama indisponible (réseau ou serveur)', 'error', 5000);
        }
        throw e;
    }
}

// ═══ SCRAPPING IA — PROMPTS ═══

/** Retourne le prompt d'enrichissement prospect (pour Ollama ou copie). */
function getScrapingPromptProspect(prospectId) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return null;
    const company = data.companies.find(c => c.id === p.company_id);
    const companyName = company ? `${company.groupe} (${company.site})` : '';
    const tags = Array.isArray(p.tags) ? p.tags.join(', ') : '';
    return `Tu es un assistant de prospection B2B spécialisé en ingénierie (systèmes embarqués, électronique, robotique, logiciel). Je dois enrichir la fiche d'un PROSPECT (= un manager / responsable chez un client potentiel) dans mon CRM de prospection.

══════ INFORMATIONS ACTUELLES ══════
• Nom : ${p.name || '[INCONNU]'}
• Entreprise : ${companyName || '[INCONNUE]'}
• Fonction : ${p.fonction || '[À TROUVER]'}
• Téléphone : ${p.telephone || '[À TROUVER]'}
• Email : ${p.email || '[À TROUVER]'}
• LinkedIn : ${p.linkedin || '[À TROUVER]'}
• Compétences/Tags : ${tags || '[À TROUVER]'}
• Notes : ${p.notes || '[VIDE]'}

══════ CE QUE JE VEUX QUE TU TROUVES ══════

1. **Informations de contact** : Trouve ou confirme le téléphone direct, l'email professionnel et l'URL LinkedIn exacte.

2. **Fonction exacte** : Titre de poste précis, périmètre managérial (nb de personnes, types d'équipes), lien hiérarchique (à qui il reporte).

3. **Compétences / Tags techniques** : Liste les domaines techniques que cette personne ou son équipe pilote. Utilise des tags courts au format suivant (ceux que j'utilise dans mon CRM) :
   AUTOSAR, C/C++, RTOS, Linux embarqué, FPGA, VHDL, Verilog, Python, Java, C#, .NET, ARM, Microcontrôleur, PCB, Altium, KiCad, Yocto, QNX, FreeRTOS, VxWorks, CAN, LIN, Ethernet, TCP/IP, SPI, I2C, UART, JTAG, Modbus, Cybersécurité, ISO 26262, DO-178, IEC 61508, ADAS, Lidar, Radar, Vision, IA/ML, ROS, Matlab/Simulink, LabVIEW, Banc de test, Qualification, Validation, Electronique analogique, Electronique numérique, Puissance, RF, Hyperfréquence, Mécatronique, CAO mécanique, Catia, SolidWorks, Gestion de projet, Agilité, V-cycle

4. **Métier principal** : Détermine le métier principal parmi : Électronique, Logiciel embarqué, Informatique industrielle, Mécanique, Systèmes, Automatisme, Robotique, Validation/Test, Chef de projet, Direction technique.

5. **Pertinence** (1 à 5 étoiles) : Évalue la pertinence de ce prospect pour une ESN spécialisée en systèmes embarqués et électronique. 5 = décideur direct qui recrute des ingénieurs dans nos domaines, 1 = peu de lien avec nos métiers.

6. **Notes enrichies** : Résumé en 3-5 lignes : contexte de l'équipe, projets en cours/récents, technologies utilisées, besoins potentiels en sous-traitance ou consultants.

7. **Entreprise** : Infos clés sur le site ${company?.site || ''} : taille du site, activité principale, présence de bureaux d'études, actualité récente (recrutements, projets).

══════ FORMAT DE SORTIE ══════
Retourne les résultats dans ce format exact (je vais copier-coller dans mon CRM) :

FONCTION: [titre exact]
TELEPHONE: [numéro direct]
EMAIL: [email pro]
LINKEDIN: [URL complète]
TAGS: [tag1, tag2, tag3, ...]
METIER: [métier principal]
PERTINENCE: [1-5]
NOTES: [résumé 3-5 lignes]
ENTREPRISE_NOTES: [infos site/activité]

Sources : utilise LinkedIn, societe.com, le site de l'entreprise, et tout article/communiqué pertinent.`;
}

function copyScrapingPromptProspect(prospectId) {
    const prompt = getScrapingPromptProspect(prospectId);
    if (!prompt) return;
    navigator.clipboard.writeText(prompt).then(() => {
        showToast('Prompt prospect copié. Collez dans votre IA ou utilisez Enrichir avec Ollama.', 'success', 4000);
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = prompt; ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Prompt prospect copié.', 'success', 4000);
    });
}

/** Retourne le prompt de scan IA prospect (recherche d'infos sur internet). */
function getScanIAPromptProspect(prospectId) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return null;
    const company = data.companies.find(c => c.id === p.company_id);
    const companyName = company ? `${company.groupe} (${company.site})` : '';
    const tags = Array.isArray(p.tags) ? p.tags.join(', ') : '';
    return `Tu es un assistant de prospection B2B spécialisé en ingénierie (systèmes embarqués, électronique, robotique, logiciel). Je dois rechercher des informations supplémentaires sur internet pour enrichir la fiche d'un PROSPECT dans mon CRM de prospection.

══════ INFORMATIONS ACTUELLES ══════
• Nom : ${p.name || '[INCONNU]'}
• Entreprise : ${companyName || '[INCONNUE]'}
• Fonction : ${p.fonction || '[À TROUVER]'}
• Téléphone : ${p.telephone || '[À TROUVER]'}
• Email : ${p.email || '[À TROUVER]'}
• LinkedIn : ${p.linkedin || '[À TROUVER]'}
• Compétences/Tags : ${tags || '[À TROUVER]'}
• Notes : ${p.notes || '[VIDE]'}

══════ MISSION : RECHERCHE SUR INTERNET ══════

Je veux que tu recherches activement des informations sur internet concernant cette personne et son entreprise. Utilise tes connaissances et ta capacité à rechercher des informations publiques disponibles sur :
- LinkedIn (profil professionnel, expériences, compétences, publications)
- Site web de l'entreprise ${companyName || ''}
- Articles de presse, communiqués, actualités
- Réseaux sociaux professionnels
- Bases de données publiques (societe.com, etc.)

══════ CE QUE JE VEUX QUE TU TROUVES ══════

1. **Informations de contact manquantes** : Si le téléphone, l'email ou le LinkedIn ne sont pas renseignés, cherche-les activement. Pour le LinkedIn, fournis l'URL complète exacte.

2. **Fonction exacte et périmètre** : Titre de poste précis, périmètre managérial (nombre de personnes, types d'équipes), lien hiérarchique (à qui il reporte), responsabilités.

3. **Compétences / Tags techniques** : Liste les domaines techniques que cette personne ou son équipe pilote. Utilise des tags courts au format suivant :
   AUTOSAR, C/C++, RTOS, Linux embarqué, FPGA, VHDL, Verilog, Python, Java, C#, .NET, ARM, Microcontrôleur, PCB, Altium, KiCad, Yocto, QNX, FreeRTOS, VxWorks, CAN, LIN, Ethernet, TCP/IP, SPI, I2C, UART, JTAG, Modbus, Cybersécurité, ISO 26262, DO-178, IEC 61508, ADAS, Lidar, Radar, Vision, IA/ML, ROS, Matlab/Simulink, LabVIEW, Banc de test, Qualification, Validation, Electronique analogique, Electronique numérique, Puissance, RF, Hyperfréquence, Mécatronique, CAO mécanique, Catia, SolidWorks, Gestion de projet, Agilité, V-cycle

4. **Métier principal** : Détermine le métier principal parmi : Électronique, Logiciel embarqué, Informatique industrielle, Mécanique, Systèmes, Automatisme, Robotique, Validation/Test, Chef de projet, Direction technique.

5. **Pertinence** (1 à 5 étoiles) : Évalue la pertinence de ce prospect pour une ESN spécialisée en systèmes embarqués et électronique. 5 = décideur direct qui recrute des ingénieurs dans nos domaines, 1 = peu de lien avec nos métiers.

6. **Notes enrichies** : Résumé en 3-5 lignes basé sur tes recherches : contexte de l'équipe, projets en cours/récents mentionnés publiquement, technologies utilisées, besoins potentiels en sous-traitance ou consultants, actualités récentes.

7. **Entreprise** : Infos clés sur le site ${company?.site || ''} basées sur tes recherches : taille du site, activité principale, présence de bureaux d'études, actualité récente (recrutements, projets, communiqués).

8. **Informations supplémentaires** : Toute autre information pertinente trouvée (formations, certifications, publications, interventions publiques, etc.).

══════ FORMAT DE SORTIE ══════
Retourne les résultats dans ce format exact (je vais copier-coller dans mon CRM) :

FONCTION: [titre exact trouvé]
TELEPHONE: [numéro direct si trouvé]
EMAIL: [email pro si trouvé]
LINKEDIN: [URL complète si trouvée]
TAGS: [tag1, tag2, tag3, ...]
METIER: [métier principal]
PERTINENCE: [1-5]
NOTES: [résumé 3-5 lignes basé sur tes recherches]
ENTREPRISE_NOTES: [infos site/activité trouvées]

Important : Ne fournis que les informations que tu as réellement trouvées ou que tu peux déduire avec confiance. Si une information n'est pas disponible, ne l'invente pas.`;
}

/** Retourne le prompt d'enrichissement candidat (pour Ollama ou copie). */
function getScrapingPromptCandidate(candidateData) {
    const c = candidateData;
    if (!c) return null;
    const skills = Array.isArray(c.skills) ? c.skills.join(', ') : (c.tech || '');
    const companies = Array.isArray(c.linkedCompanyNames) ? c.linkedCompanyNames.join(', ') : '';
    return `Tu es un assistant de recrutement spécialisé en ingénierie (systèmes embarqués, électronique, robotique, logiciel). Je dois enrichir la fiche d'un CANDIDAT (= un consultant/ingénieur potentiel à recruter) dans mon CRM de sourcing.
══════ INFORMATIONS ACTUELLES ══════
• Nom : ${c.name || '[INCONNU]'}
• Rôle : ${c.role || '[À TROUVER]'}
• Localisation : ${c.location || '[À TROUVER]'}
• Seniorité : ${c.seniority || '[À TROUVER]'}
• Tech : ${c.tech || '[À TROUVER]'}
• Compétences : ${skills || '[À TROUVER]'}
• LinkedIn : ${c.linkedin || '[À TROUVER]'}
• Source : ${c.source || '[INCONNUE]'}
• Entreprises liées : ${companies || '[AUCUNE]'}
• Notes : ${c.notes || '[VIDE]'}

══════ CE QUE JE VEUX QUE TU TROUVES ══════

1. **Profil complet** : Titre de poste actuel, entreprise actuelle, années d'expérience totales, formation (école d'ingénieur, diplôme).

2. **Parcours** : Résume les 3-4 dernières expériences (entreprise, durée, rôle, technos utilisées).

3. **Compétences techniques (tags)** : Liste exhaustive des compétences identifiées. Utilise ces tags standard :
   AUTOSAR, C/C++, RTOS, Linux embarqué, FPGA, VHDL, Verilog, Python, Java, C#, .NET, ARM, Microcontrôleur, PCB, Altium, KiCad, Yocto, QNX, FreeRTOS, VxWorks, CAN, LIN, Ethernet, TCP/IP, SPI, I2C, UART, JTAG, Modbus, Cybersécurité, ISO 26262, DO-178, IEC 61508, ADAS, Lidar, Radar, Vision, IA/ML, ROS, Matlab/Simulink, LabVIEW, Banc de test, Qualification, Validation, Electronique analogique, Electronique numérique, Puissance, RF, Hyperfréquence, Mécatronique, CAO mécanique, Catia, SolidWorks, Gestion de projet, Agilité, V-cycle

4. **Années d'expérience** : Nombre total d'années d'expérience professionnelle pertinente (nombre entier).

5. **Rôle cible** : Le titre de poste le plus pertinent pour ce profil (ex: Ingénieur développement embarqué C/C++, Ingénieur électronique hardware, Architecte logiciel embarqué…).

6. **Localisation** : Ville actuelle, mobilité géographique si mentionnée.

7. **Secteur** : Secteurs d'expérience (automobile, aéronautique, ferroviaire, médical, défense, énergie, spatial, IoT…).

8. **Disponibilité estimée** : Freelance, en poste (ouvert/pas ouvert), en recherche active, préavis.

9. **TJM / Salaire estimé** : Fourchette indicative basée sur le profil, la localisation et le marché actuel en ingénierie embarquée région lyonnaise.

10. **Notes enrichies** : Résumé 3-5 lignes : points forts, domaines d'expertise principal, type de missions idéales.

11. **Entreprises cibles** : Quelles entreprises de la région lyonnaise pourraient être intéressées par ce profil ? (liste 5-10 noms).

══════ FORMAT DE SORTIE ══════
Retourne les résultats dans ce format exact (je vais copier-coller dans mon CRM) :

ROLE: [titre de poste cible]
LOCALISATION: [ville + mobilité]
ANNEES_EXPERIENCE: [nombre entier d'années]
SENIORITE: [Junior/Confirmé/Senior/Expert - texte libre]
TECH: [technologies principales, séparées par virgules]
SKILLS: [tag1, tag2, tag3, ...]
SECTEUR: [automobile, aéronautique, défense...]
TELEPHONE: [numéro si trouvé]
EMAIL: [email si trouvé]
LINKEDIN: [URL LinkedIn si trouvée]
DISPONIBILITE: [statut estimé]
TJM_ESTIME: [fourchette €/jour ou salaire annuel]
NOTES: [résumé 3-5 lignes]
PARCOURS: [exp1 | exp2 | exp3]
ENTREPRISES_CIBLES: [entreprise1, entreprise2, ...]

Sources : utilise LinkedIn et toute info publique disponible.`;
}

function copyScrapingPromptCandidate(candidateData) {
    const prompt = getScrapingPromptCandidate(candidateData);
    if (!prompt) return;
    navigator.clipboard.writeText(prompt).then(() => {
        showToast('Prompt candidat copié. Collez dans votre IA ou utilisez Enrichir avec Ollama.', 'success', 4000);
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = prompt; ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Prompt candidat copié.', 'success', 4000);
    });
}

// ═══════════════════════════════════════════════════════
// VSA IMPORT — Extraction candidat depuis fiche VSA (collage + Ollama)
// ═══════════════════════════════════════════════════════

/** Retourne le prompt pour extraire les champs candidat depuis un contenu de fiche VSA. */
function getVsaExtractionPrompt(vsaContent) {
    return `Tu as ci-dessous le contenu d'une fiche candidat VSA (Suivi des candidats, vsactivity). Extrais les champs suivants au format exact (une ligne par champ, clé en majuscules avec underscores) :

NOM: [nom et prénom du candidat]
ROLE: [titre de poste / rôle]
LOCALISATION: [ville, région, mobilité si mentionnée]
SENIORITE: [Junior, Confirmé, Senior, Expert si identifiable]
TECH: [technologies principales, séparées par des virgules]
SKILLS: [compétences, tags séparés par des virgules]
TELEPHONE: [numéro si présent]
EMAIL: [email si présent]
LINKEDIN: [URL du profil LinkedIn si présente]
NOTES: [résumé ou contexte utile en une ou deux lignes]

Si un champ est absent ou introuvable, ne l'écris pas. Réponds UNIQUEMENT avec les lignes CLÉ: valeur, sans introduction ni conclusion.

══════ CONTENU FICHE VSA ══════
${vsaContent}`;
}

/** Parse un texte au format KEY: value et retourne un objet pour pré-remplir le formulaire candidat (name, role, location, etc.). */
function parseVsaCandidateText(text) {
    const out = { name: '', role: '', location: '', seniority: '', tech: '', linkedin: '', source: 'VSA', notes: '', phone: '', email: '', skills: [], vsa_url: '' };
    if (!text || typeof text !== 'string') return out;
    const lines = text.split('\n');
    let currentKey = null;
    let currentValue = '';

    const keyToField = {
        'NOM': 'name',
        'ROLE': 'role',
        'LOCALISATION': 'location',
        'SENIORITE': 'seniority',
        'TECH': 'tech',
        'LINKEDIN': 'linkedin',
        'NOTES': 'notes',
        'TELEPHONE': 'phone',
        'EMAIL': 'email',
        'SKILLS': 'skills'
    };

    function flush() {
        if (!currentKey) return;
        const key = currentKey.toUpperCase().replace(/\s+/g, '_');
        const field = keyToField[key];
        const val = currentValue.trim();
        if (!field || !val || /^\[?à trouver\]?$/i.test(val) || /^\[?absent\]?$/i.test(val)) return;
        if (field === 'skills') {
            const list = val.split(/[,;]/).map(s => s.trim()).filter(Boolean);
            if (list.length) out.skills = list;
        } else {
            out[field] = val;
        }
    }

    for (const line of lines) {
        const match = line.match(/^([A-ZÀ-Ü_]+)\s*:\s*(.*)$/);
        if (match) {
            flush();
            currentKey = match[1].trim();
            currentValue = match[2].trim();
        } else if (currentKey) {
            currentValue += '\n' + line;
        }
    }
    flush();
    return out;
}

// ═══════════════════════════════════════════════════════
// IA IMPORT SYSTEM — Parse AI results & fill fields
// ═══════════════════════════════════════════════════════

/** Ouvre la modale d'import IA ; si prefillText est fourni, remplit le textarea et lance l'analyse (étape 2). */
function openIAImportModalWithText(type, id, prefillText) {
    openIAImportModal(type, id);
    if (prefillText != null && prefillText !== '') {
        const ta = document.getElementById('iaImportTextarea');
        if (ta) {
            ta.value = prefillText;
            parseIAImportModal();
        }
    }
}

function handleIAButton(type, id) {
    let prompt = null;
    if (type === 'prospect') prompt = getScrapingPromptProspect(id);
    else if (type === 'company') prompt = getScrapingPromptCompany(id);
    else if (type === 'candidate') {
        const candidate = data.candidates && data.candidates.find(x => x.id === id);
        prompt = candidate ? getScrapingPromptCandidate(candidate) : null;
    }
    if (!prompt) {
        showToast('Données introuvables pour cette fiche.', 'warning');
        return;
    }
    const btn = document.getElementById(`btnIA_${type}_${id}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Génération…'; }
    callOllama(prompt).then(function (text) {
        openIAImportModalWithText(type, id, text);
    }).catch(function () {
        openIAImportModal(type, id);
        showToast('Ollama indisponible. Vous pouvez coller manuellement le retour ci-dessous.', 'warning', 6000);
    }).finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = '🤖 Scrapping IA'; }
    });
}

/** Gère le bouton "Scan IA" : recherche d'infos supplémentaires sur internet via Ollama. */
function handleScanIA(prospectId) {
    const prompt = getScanIAPromptProspect(prospectId);
    if (!prompt) {
        showToast('Données introuvables pour ce prospect.', 'warning');
        return;
    }
    // Trouver le bouton dans la barre d'actions rapides
    const btn = document.querySelector(`button[onclick="handleScanIA(${prospectId})"]`);
    if (btn) { 
        btn.disabled = true; 
        const originalText = btn.textContent;
        btn.textContent = '🔍 Recherche…';
        callOllama(prompt).then(function (text) {
            openIAImportModalWithText('prospect', prospectId, text);
        }).catch(function () {
            openIAImportModal('prospect', prospectId);
            showToast('Ollama indisponible. Vous pouvez coller manuellement le retour ci-dessous.', 'warning', 6000);
        }).finally(function () {
            if (btn) { 
                btn.disabled = false; 
                btn.textContent = originalText;
            }
        });
    } else {
        // Fallback si le bouton n'est pas trouvé
        callOllama(prompt).then(function (text) {
            openIAImportModalWithText('prospect', prospectId, text);
        }).catch(function () {
            openIAImportModal('prospect', prospectId);
            showToast('Ollama indisponible. Vous pouvez coller manuellement le retour ci-dessous.', 'warning', 6000);
        });
    }
}

// ─── Modal ───
function _ensureIAModal() {
    if (document.getElementById('modalIAImport')) return;
    const div = document.createElement('div');
    div.innerHTML = `
    <div id="modalIAImport" class="modal">
        <div class="modal-content">
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                <span id="iaModalTitle">📥 Import retour IA</span>
                <button class="btn btn-secondary" onclick="closeIAImportModal()" style="font-size:14px;padding:4px 10px;">✕</button>
            </div>
            <div id="iaStep1" style="margin-top:16px;">
                <p class="muted" style="font-size:12px;margin-bottom:8px;">Résultat Ollama ou collez manuellement le retour d'une IA ci-dessous, puis cliquez "Analyser".</p>
                <textarea id="iaImportTextarea" placeholder="FONCTION: Responsable Bureau d'Études&#10;TELEPHONE: 04 72 xx xx xx&#10;EMAIL: jean@example.com&#10;TAGS: C/C++, FPGA, VHDL&#10;..."></textarea>
                <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
                    <button class="btn btn-secondary" onclick="closeIAImportModal()">Annuler</button>
                    <button class="btn btn-primary" onclick="parseIAImportModal()">🔍 Analyser</button>
                </div>
            </div>
            <div id="iaStep2" style="margin-top:16px;display:none;">
                <p class="muted" style="font-size:12px;margin-bottom:8px;">Vérifiez les champs détectés. Acceptez ou ignorez chaque modification.</p>
                <div id="iaFieldsPreview"></div>
                <div id="iaManagersPreview" style="display:none;margin-top:16px;"></div>
                <div style="display:flex;gap:8px;margin-top:16px;justify-content:space-between;">
                    <button class="btn btn-secondary" onclick="iaBackToStep1()">← Modifier le texte</button>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-secondary" onclick="iaToggleAll(true)">✅ Tout accepter</button>
                        <button class="btn btn-primary" onclick="applyIAImport()">💾 Appliquer</button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(div.firstElementChild);
}

let _iaCurrentType = '';
let _iaCurrentId = 0;
let _iaParsedFields = [];
let _iaParsedManagers = [];

function openIAImportModal(type, id) {
    _ensureIAModal();
    _iaCurrentType = type;
    _iaCurrentId = id;
    _iaParsedFields = [];
    _iaParsedManagers = [];
    document.getElementById('iaImportTextarea').value = '';
    document.getElementById('iaStep1').style.display = '';
    document.getElementById('iaStep2').style.display = 'none';
    document.getElementById('iaManagersPreview').style.display = 'none';
    const titles = { prospect: 'prospect', candidate: 'candidat', company: 'entreprise' };
    document.getElementById('iaModalTitle').textContent = `📥 Import IA — Fiche ${titles[type] || type}`;
    const modal = document.getElementById('modalIAImport');
    if (modal) {
        if (window.openModal) {
            window.openModal(modal, { focusElement: '.gsearch-input, input, textarea' });
        } else {
            modal.classList.add('active');
        }
    }
}

function closeIAImportModal() {
    const modal = document.getElementById('modalIAImport');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
}

function iaBackToStep1() {
    document.getElementById('iaStep1').style.display = '';
    document.getElementById('iaStep2').style.display = 'none';
}

// ─── Parser ───
const IA_FIELD_MAP_PROSPECT = {
    'FONCTION': { key: 'fonction', label: 'Fonction' },
    'TELEPHONE': { key: 'telephone', label: 'Téléphone' },
    'EMAIL': { key: 'email', label: 'Email' },
    'LINKEDIN': { key: 'linkedin', label: 'LinkedIn' },
    'TAGS': { key: 'tags', label: 'Compétences', isArray: true },
    'METIER': { key: 'fixedMetier', label: 'Métier' },
    'PERTINENCE': { key: 'pertinence', label: 'Pertinence' },
    'NOTES': { key: 'notes', label: 'Notes', append: true },
    'ENTREPRISE_NOTES': { key: '_company_notes', label: 'Notes entreprise', append: true },
};
const IA_FIELD_MAP_CANDIDATE = {
    'ROLE': { key: 'role', label: 'Rôle' },
    'LOCALISATION': { key: 'location', label: 'Localisation' },
    'ANNEES_EXPERIENCE': { key: 'years_experience', label: 'Années d\'expérience', isNumeric: true },
    'SENIORITE': { key: 'seniority', label: 'Seniorité' },
    'TECH': { key: 'tech', label: 'Tech' },
    'SKILLS': { key: 'skills', label: 'Compétences', isArray: true },
    'SECTEUR': { key: 'sector', label: 'Secteur' },
    'TELEPHONE': { key: 'phone', label: 'Téléphone' },
    'EMAIL': { key: 'email', label: 'Email' },
    'DISPONIBILITE': { key: '_dispo', label: 'Disponibilité', appendNote: true },
    'TJM_ESTIME': { key: '_tjm', label: 'TJM estimé', appendNote: true },
    'NOTES': { key: 'notes', label: 'Notes', append: true },
    'PARCOURS': { key: '_parcours', label: 'Parcours', appendNote: true },
    'ENTREPRISES_CIBLES': { key: '_cibles', label: 'Entreprises cibles', appendNote: true },
    'LINKEDIN': { key: 'linkedin', label: 'LinkedIn' },
};
const IA_FIELD_MAP_COMPANY = {
    'SECTEUR': { key: 'tags', label: 'Secteur / Tags', isArray: true },
    'EFFECTIF': { key: '_effectif', label: 'Effectif', appendNote: true },
    'ACTU': { key: '_actu', label: 'Actualité', appendNote: true },
    'NOTES': { key: 'notes', label: 'Notes', append: true },
    'TELEPHONE': { key: 'phone', label: 'Téléphone' },
    'MANAGERS': { key: '_managers', label: 'Managers', isManagers: true },
};

function _getFieldMap(type) {
    if (type === 'prospect') return IA_FIELD_MAP_PROSPECT;
    if (type === 'candidate') return IA_FIELD_MAP_CANDIDATE;
    if (type === 'company') return IA_FIELD_MAP_COMPANY;
    return {};
}

function _getExistingData(type, id) {
    if (type === 'prospect') {
        const p = data.prospects.find(x => x.id === id);
        return p ? { ...p } : {};
    }
    if (type === 'company') {
        const c = data.companies.find(x => x.id === id);
        return c ? { ...c } : {};
    }
    if (type === 'candidate') {
        // For candidates, read from form fields since __cand may not be accessible
        return {
            role: document.getElementById('fRole')?.value || '',
            location: document.getElementById('fLocation')?.value || '',
            seniority: document.getElementById('fSeniority')?.value || '',
            years_experience: parseInt(document.getElementById('fYearsExperience')?.value) || null,
            tech: document.getElementById('fTech')?.value || '',
            linkedin: document.getElementById('fLinkedIn')?.value || '',
            source: document.getElementById('fSource')?.value || '',
            notes: document.getElementById('fNotes')?.value || '',
            phone: document.getElementById('fPhone')?.value || '',
            email: document.getElementById('fEmail')?.value || '',
            sector: document.getElementById('fSector')?.value || '',
            skills: [],  // read from chips
        };
    }
    return {};
}

function parseIAImportModal() {
    const text = document.getElementById('iaImportTextarea').value.trim();
    if (!text) { showToast('⚠️ Collez le retour de l\'IA d\'abord.', 'warning'); return; }

    const fieldMap = _getFieldMap(_iaCurrentType);
    const existing = _getExistingData(_iaCurrentType, _iaCurrentId);
    const fields = [];
    const managers = [];

    // Parse lines: KEY: value (supports multi-word keys with underscores)
    const lines = text.split('\n');
    let currentKey = null;
    let currentValue = '';

    for (const line of lines) {
        const match = line.match(/^([A-ZÀ-Ü_]+)\s*:\s*(.*)$/);
        if (match) {
            // Save previous
            if (currentKey) _processField(currentKey, currentValue, fieldMap, existing, fields, managers);
            currentKey = match[1].trim();
            currentValue = match[2].trim();
        } else if (currentKey) {
            // Continuation line
            currentValue += '\n' + line;
        }
    }
    // Don't forget last one
    if (currentKey) _processField(currentKey, currentValue, fieldMap, existing, fields, managers);

    if (fields.length === 0 && managers.length === 0) {
        showToast('⚠️ Aucun champ reconnu. Vérifiez le format (CLÉ: valeur).', 'warning');
        return;
    }

    _iaParsedFields = fields;
    _iaParsedManagers = managers;
    _renderIAPreview();
}

function _processField(rawKey, rawValue, fieldMap, existing, fields, managers) {
    const key = rawKey.toUpperCase().replace(/\s+/g, '_');
    const mapping = fieldMap[key];
    if (!mapping) return; // Unknown field, skip

    const value = rawValue.trim();
    if (!value || value === '[À TROUVER]' || value === '[INCONNU]' || value === '[VIDE]' || value === '[INCONNUE]' || value === '[AUCUNE]') return;

    if (mapping.isManagers) {
        // Parse manager list: "Nom - Fonction" or "Nom (Fonction)" per line or comma-separated
        const entries = value.includes('\n') ? value.split('\n') : value.split(/[,;]/);
        for (const entry of entries) {
            const e = entry.replace(/^[-•*]\s*/, '').trim();
            if (!e) continue;
            const mMatch = e.match(/^(.+?)\s*[-–—:]\s*(.+)$/) || e.match(/^(.+?)\s*\((.+?)\)$/);
            if (mMatch) {
                managers.push({ name: mMatch[1].trim(), fonction: mMatch[2].trim(), accepted: true });
            } else {
                managers.push({ name: e, fonction: '', accepted: true });
            }
        }
        return;
    }

    if (mapping.isArray) {
        const newTags = value.split(',').map(t => t.trim()).filter(Boolean);
        const oldTags = Array.isArray(existing[mapping.key]) ? existing[mapping.key] : [];
        const oldSet = new Set(oldTags.map(t => t.toLowerCase()));
        const added = newTags.filter(t => !oldSet.has(t.toLowerCase()));
        if (added.length > 0 || oldTags.length === 0) {
            fields.push({
                mapping,
                newValue: newTags,
                oldValue: oldTags,
                displayNew: newTags.join(', '),
                displayOld: oldTags.join(', '),
                isNew: oldTags.length === 0,
                isConflict: false, // tags always merge
                accepted: true,
            });
        }
        return;
    }

    // Numeric field (e.g. years_experience)
    if (mapping.isNumeric) {
        const numVal = parseInt(value);
        if (!isNaN(numVal)) {
            const oldVal = existing[mapping.key];
            fields.push({
                mapping,
                newValue: numVal,
                oldValue: oldVal != null ? oldVal : '',
                displayNew: String(numVal),
                displayOld: oldVal != null ? String(oldVal) : '',
                isNew: oldVal == null,
                isConflict: oldVal != null && oldVal !== numVal,
                accepted: true,
            });
        }
        return;
    }

    const oldVal = existing[mapping.key] || '';
    const oldStr = String(oldVal).trim();

    if (mapping.append || mapping.appendNote) {
        // Always add (will be appended to notes)
        fields.push({
            mapping,
            newValue: value,
            oldValue: oldStr,
            displayNew: value.length > 120 ? value.substring(0, 120) + '…' : value,
            displayOld: oldStr.length > 80 ? oldStr.substring(0, 80) + '…' : oldStr,
            isNew: !oldStr,
            isConflict: false,
            accepted: true,
        });
        return;
    }

    // Simple field
    if (!oldStr) {
        fields.push({ mapping, newValue: value, oldValue: '', displayNew: value, displayOld: '', isNew: true, isConflict: false, accepted: true });
    } else if (oldStr.toLowerCase() !== value.toLowerCase()) {
        fields.push({ mapping, newValue: value, oldValue: oldStr, displayNew: value, displayOld: oldStr, isNew: false, isConflict: true, accepted: true });
    }
    // If same value, skip
}

// ─── Preview rendering ───
function _renderIAPreview() {
    const container = document.getElementById('iaFieldsPreview');
    let html = '';

    _iaParsedFields.forEach((f, i) => {
        const statusClass = f.isNew ? 'new-field' : (f.isConflict ? 'conflict' : 'new-field');
        const statusText = f.isNew ? '✨ Nouveau' : (f.isConflict ? '⚡ Conflit' : '➕ Ajout');
        html += `<div class="ia-field-row" id="iaRow_${i}">
            <div class="ia-field-label">${f.mapping.label}</div>
            <div class="ia-field-values">
                ${f.isConflict && f.displayOld ? `<div class="ia-field-old">Ancien : ${_escIA(f.displayOld)}</div>` : ''}
                <div class="ia-field-new">${_escIA(f.displayNew)}</div>
                <div class="ia-field-status ${statusClass}">${statusText}</div>
            </div>
            <div class="ia-field-actions">
                ${f.isConflict || !f.isNew ? `
                    <button class="ia-accept ${f.accepted ? 'active' : ''}" onclick="iaToggleField(${i}, true)">Accepter</button>
                    <button class="ia-ignore ${!f.accepted ? 'active' : ''}" onclick="iaToggleField(${i}, false)">Ignorer</button>
                ` : `
                    <button class="ia-accept active" onclick="iaToggleField(${i}, true)">✓</button>
                    <button class="ia-ignore" onclick="iaToggleField(${i}, false)">✕</button>
                `}
            </div>
        </div>`;
    });

    container.innerHTML = html || '<div class="muted" style="text-align:center;padding:14px;">Aucun champ à importer.</div>';

    // Managers
    const mgContainer = document.getElementById('iaManagersPreview');
    if (_iaParsedManagers.length > 0) {
        let mhtml = '<div style="font-weight:700;margin-bottom:8px;">👥 Managers détectés</div>';
        _iaParsedManagers.forEach((m, i) => {
            mhtml += `<div class="ia-manager-row">
                <span>${_escIA(m.name)}${m.fonction ? ' — ' + _escIA(m.fonction) : ''}</span>
                <button class="btn btn-primary" style="font-size:11px;padding:3px 10px;" onclick="iaCreateProspectFromManager(${i})">+ Créer prospect</button>
            </div>`;
        });
        mgContainer.innerHTML = mhtml;
        mgContainer.style.display = '';
    } else {
        mgContainer.style.display = 'none';
    }

    document.getElementById('iaStep1').style.display = 'none';
    document.getElementById('iaStep2').style.display = '';
}

function _escIA(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function iaToggleField(index, accept) {
    _iaParsedFields[index].accepted = accept;
    const row = document.getElementById(`iaRow_${index}`);
    if (!row) return;
    const btns = row.querySelectorAll('.ia-field-actions button');
    btns.forEach(b => b.classList.remove('active'));
    if (accept) btns[0]?.classList.add('active');
    else if (btns[1]) btns[1].classList.add('active');
    row.style.opacity = accept ? '1' : '0.4';
}

function iaToggleAll(accept) {
    _iaParsedFields.forEach((f, i) => iaToggleField(i, accept));
}

// ─── Apply import ───
async function applyIAImport() {
    const accepted = _iaParsedFields.filter(f => f.accepted);
    if (accepted.length === 0) { showToast('ℹ️ Aucun champ sélectionné.', 'info'); return; }

    if (_iaCurrentType === 'prospect') _applyProspectIA(accepted);
    else if (_iaCurrentType === 'candidate') _applyCandidateIA(accepted);
    else if (_iaCurrentType === 'company') _applyCompanyIA(accepted);

    // Log to timeline
    try {
        const fieldNames = accepted.map(f => f.mapping.label).join(', ');
        await fetch('/api/ia-enrichment-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: _iaCurrentType,
                entity_id: _iaCurrentId,
                fields_updated: fieldNames,
                field_count: accepted.length,
            })
        });
    } catch (e) { console.warn('IA log failed', e); }

    closeIAImportModal();
    showToast(`✅ ${accepted.length} champ(s) importé(s) depuis l'IA !`, 'success', 4000);
}

function _applyProspectIA(fields) {
    const p = data.prospects.find(x => x.id === _iaCurrentId);
    if (!p) return;
    const company = data.companies.find(c => c.id === p.company_id);
    let notesAppend = [];

    for (const f of fields) {
        const key = f.mapping.key;

        if (key === 'tags') {
            const oldTags = Array.isArray(p.tags) ? p.tags : [];
            const oldSet = new Set(oldTags.map(t => t.toLowerCase()));
            const merged = [...oldTags, ...f.newValue.filter(t => !oldSet.has(t.toLowerCase()))];
            p.tags = merged;
            // Update editor if visible
            const hid = document.getElementById('editTagsValue');
            if (hid) { hid.value = JSON.stringify(merged); try { initTagsEditor('editTagsEditor', 'editTagsValue', merged); } catch(e) {} }
            continue;
        }

        if (key === '_company_notes' && company) {
            const old = company.notes || '';
            company.notes = old ? old + '\n--- IA ' + todayISO() + ' ---\n' + f.newValue : f.newValue;
            continue;
        }

        if (f.mapping.append) {
            const old = p[key] || '';
            p[key] = old ? old + '\n--- IA ' + todayISO() + ' ---\n' + f.newValue : f.newValue;
        } else {
            p[key] = f.newValue;
        }
    }

    // Update form fields if edit tab is visible
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setVal('editFonction', p.fonction);
    setVal('editTel', p.telephone);
    setVal('editEmail', p.email);
    setVal('editLinkedin', p.linkedin);
    setVal('editPertinence', p.pertinence);
    setVal('editNotes', p.notes);
    const metierSel = document.getElementById('editMetier');
    if (metierSel && p.fixedMetier) {
        // Try to match option
        for (const opt of metierSel.options) {
            if (opt.value && opt.value.toLowerCase() === p.fixedMetier.toLowerCase()) {
                metierSel.value = opt.value; break;
            }
        }
    }

    try { saveToServer(); } catch (e) {}
}

function _applyCandidateIA(fields) {
    let notesExtra = [];

    for (const f of fields) {
        const key = f.mapping.key;

        if (key === 'skills') {
            // Add to skills via exposed helper from page-candidate.js
            const newSkills = Array.isArray(f.newValue) ? f.newValue : f.newValue.split(',').map(s => s.trim());
            if (typeof window.addSkillsFromIA === 'function') {
                window.addSkillsFromIA(newSkills);
            }
            continue;
        }

        if (f.mapping.appendNote) {
            notesExtra.push(`${f.mapping.label}: ${f.newValue}`);
            continue;
        }

        // Direct field mapping
        const fieldIds = { role: 'fRole', location: 'fLocation', seniority: 'fSeniority', tech: 'fTech', linkedin: 'fLinkedIn', source: 'fSource', phone: 'fPhone', email: 'fEmail', sector: 'fSector' };
        const elId = fieldIds[key];
        if (elId) {
            const el = document.getElementById(elId);
            if (el) el.value = f.newValue;
            continue;
        }

        // Numeric fields
        if (key === 'years_experience') {
            const el = document.getElementById('fYearsExperience');
            if (el) el.value = f.newValue;
            continue;
        }

        if (f.mapping.append && key === 'notes') {
            const el = document.getElementById('fNotes');
            if (el) {
                const old = el.value.trim();
                el.value = old ? old + '\n--- IA ' + todayISO() + ' ---\n' + f.newValue : f.newValue;
            }
            continue;
        }
    }

    // Append extra info to notes
    if (notesExtra.length > 0) {
        const el = document.getElementById('fNotes');
        if (el) {
            const old = el.value.trim();
            const extra = notesExtra.join('\n');
            el.value = old ? old + '\n--- IA ' + todayISO() + ' ---\n' + extra : extra;
        }
    }

    // Trigger autosave
    if (typeof window.triggerCandidateAutoSave === 'function') {
        window.triggerCandidateAutoSave();
    }
}

function _applyCompanyIA(fields) {
    const c = data.companies.find(x => x.id === _iaCurrentId);
    if (!c) return;
    let notesExtra = [];

    for (const f of fields) {
        const key = f.mapping.key;

        if (key === 'tags') {
            const oldTags = Array.isArray(c.tags) ? c.tags : [];
            const oldSet = new Set(oldTags.map(t => t.toLowerCase()));
            const merged = [...oldTags, ...f.newValue.filter(t => !oldSet.has(t.toLowerCase()))];
            c.tags = merged;
            const hid = document.getElementById('inputCompanyTagsValue');
            if (hid) { hid.value = JSON.stringify(merged); try { initTagsEditor('companyTagsEditor', 'inputCompanyTagsValue', merged); } catch(e) {} }
            continue;
        }

        if (f.mapping.appendNote) {
            notesExtra.push(`${f.mapping.label}: ${f.newValue}`);
            continue;
        }

        if (key === 'phone') {
            c.phone = f.newValue;
            const el = document.getElementById('inputCompanyPhone');
            if (el) el.value = f.newValue;
            continue;
        }

        if (f.mapping.append && key === 'notes') {
            const old = c.notes || '';
            c.notes = old ? old + '\n--- IA ' + todayISO() + ' ---\n' + f.newValue : f.newValue;
            const el = document.getElementById('inputCompanyNotes');
            if (el) el.value = c.notes;
            continue;
        }
    }

    if (notesExtra.length > 0) {
        const old = c.notes || '';
        const extra = notesExtra.join('\n');
        c.notes = old ? old + '\n--- IA ' + todayISO() + ' ---\n' + extra : extra;
        const el = document.getElementById('inputCompanyNotes');
        if (el) el.value = c.notes;
    }

    try { saveToServer(); } catch (e) {}
}

// ─── Create prospect from manager ───
async function iaCreateProspectFromManager(index) {
    const m = _iaParsedManagers[index];
    if (!m) return;

    // Get company from current context
    let companyId = null;
    if (_iaCurrentType === 'company') {
        companyId = _iaCurrentId;
    } else if (_iaCurrentType === 'prospect') {
        const p = data.prospects.find(x => x.id === _iaCurrentId);
        companyId = p ? p.company_id : null;
    }
    if (!companyId) {
        showToast('⚠️ Entreprise introuvable.', 'warning');
        return;
    }

    // Check duplicate
    const existing = data.prospects.find(p =>
        p.company_id === companyId &&
        p.name.toLowerCase() === m.name.toLowerCase()
    );
    if (existing) {
        showToast(`⚠️ ${m.name} existe déjà dans cette entreprise.`, 'warning');
        return;
    }

    const newId = data.prospects.length ? Math.max(...data.prospects.map(p => p.id)) + 1 : 1;
    const prospect = {
        id: newId,
        name: m.name,
        company_id: companyId,
        fonction: m.fonction || '',
        telephone: '',
        email: '',
        linkedin: '',
        pertinence: '',
        statut: "Pas d'actions",
        lastContact: '',
        nextFollowUp: '',
        priority: 2,
        notes: '🤖 Créé depuis scrapping IA entreprise',
        callNotes: [],
        pushEmailSentAt: '',
        tags: [],
        template_id: null,
        is_contact: 0,
    };

    data.prospects.push(prospect);
    try { await saveToServerAsync(); } catch (e) {}

    // Disable button
    const btn = event.target;
    btn.textContent = '✅ Créé';
    btn.disabled = true;
    btn.style.opacity = '0.5';

    showToast(`✅ Prospect "${m.name}" créé !`, 'success', 3000);
}

// ─── Company scraping prompt ───
/** Retourne le prompt d'enrichissement entreprise (pour Ollama ou copie). */
function getScrapingPromptCompany(companyId) {
    const c = data.companies.find(x => x.id === companyId);
    if (!c) return null;
    const tags = Array.isArray(c.tags) ? c.tags.join(', ') : '';
    const prospectCount = data.prospects.filter(p => p.company_id === companyId).length;
    return `Tu es un assistant de prospection B2B spécialisé en ingénierie (systèmes embarqués, électronique, robotique, logiciel). Je dois enrichir la fiche d'une ENTREPRISE dans mon CRM de prospection.

══════ INFORMATIONS ACTUELLES ══════
• Nom / Groupe : ${c.groupe || '[INCONNU]'}
• Site / Localisation : ${c.site || '[INCONNU]'}
• Téléphone : ${c.phone || '[À TROUVER]'}
• Tags existants : ${tags || '[AUCUN]'}
• Nb prospects existants : ${prospectCount}
• Notes : ${c.notes || '[VIDE]'}

══════ CE QUE JE VEUX QUE TU TROUVES ══════

1. **Secteur d'activité / domaines techniques** : Dans quels domaines techniques cette entreprise (site de ${c.site || '?'}) travaille ? Tags courts : automobile, aéronautique, ferroviaire, défense, spatial, médical, énergie, nucléaire, IoT, telecom, robotique, etc.

2. **Effectif** : Taille du site, nb d'employés si trouvable, nb d'ingénieurs/R&D.

3. **Managers clés** : Liste les responsables techniques, chefs de service R&D, responsables BE, directeurs techniques que tu trouves pour ce site. Format : Nom — Fonction.

4. **Actualité** : Recrutements en cours, projets récents, investissements, acquisitions, partenariats. Focus sur les signaux de besoin en sous-traitance ingénierie.

5. **Notes** : Résumé 3-5 lignes sur l'activité du site.

6. **Téléphone** : Standard ou accueil du site.

══════ FORMAT DE SORTIE ══════
SECTEUR: [tag1, tag2, tag3, ...]
EFFECTIF: [description taille site]
MANAGERS: [Nom1 - Fonction1, Nom2 - Fonction2, ...]
ACTU: [actualité résumée]
NOTES: [résumé activité 3-5 lignes]
TELEPHONE: [numéro standard]

Sources : societe.com, LinkedIn, site entreprise, Indeed (offres d'emploi du site), communiqués de presse.`;
}

function copyScrapingPromptCompany(companyId) {
    const prompt = getScrapingPromptCompany(companyId);
    if (!prompt) return;
    navigator.clipboard.writeText(prompt).then(() => {
        showToast('Prompt entreprise copié. Collez dans votre IA ou utilisez Enrichir avec Ollama.', 'success', 4000);
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = prompt; ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Prompt entreprise copié.', 'success', 4000);
    });
}

// ═══════════════════════════════════════════════════════════════════
// ──── Bulk IA : Email / Téléphone en masse ────
// ═══════════════════════════════════════════════════════════════════

let _bulkIAMode = ''; // 'email' or 'tel'
let _bulkIAProspects = []; // [{id, name, company, current}]

function _ensureBulkIAModal() {
    if (document.getElementById('modalBulkIA')) return;
    const div = document.createElement('div');
    div.innerHTML = `
    <div id="modalBulkIA" class="modal">
        <div class="modal-content">
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                <span id="bulkIATitle" style="font-weight:700;">📧 Enrichissement IA en masse</span>
                <button class="btn btn-secondary" onclick="closeBulkIAModal()" style="font-size:14px;padding:4px 10px;">✕</button>
            </div>

            <!-- Tabs (only for tel mode) -->
            <div id="bulkIATabs" style="display:none;margin-top:12px;border-bottom:1px solid var(--border-color);">
                <button class="bulk-ia-tab active" data-tab="ollama" onclick="switchBulkIATab('ollama')">🤖 Ollama</button>
                <button class="bulk-ia-tab" data-tab="paste" onclick="switchBulkIATab('paste')">📋 Coller</button>
                <button class="bulk-ia-tab" data-tab="csv" onclick="switchBulkIATab('csv')">📄 CSV</button>
            </div>

            <!-- Step 1: Ollama (existing) -->
            <div id="bulkIAStep1Ollama" class="bulk-ia-step" style="margin-top:14px;">
                <p class="muted" style="font-size:12px;margin-bottom:8px;">
                    <strong>Étape 1 :</strong> Générez avec Ollama (local) ou copiez le prompt pour une autre IA.
                </p>
                <div class="bulk-ia-prompt-box" id="bulkIAPromptBox">
                    <button class="copy-prompt-btn" onclick="runBulkIAWithOllama()" id="bulkIAOllamaBtn">🤖 Générer avec Ollama</button>
                    <button class="copy-prompt-btn" onclick="copyBulkIAPrompt()">📋 Copier</button>
                    <pre id="bulkIAPromptText" style="margin:0;white-space:pre-wrap;font-size:12px;"></pre>
                </div>
                <p class="muted" style="font-size:12px;margin-top:14px;margin-bottom:8px;">
                    <strong>Étape 2 :</strong> Résultat Ollama ou collez le retour de l'IA ci-dessous.
                </p>
                <textarea id="bulkIAResultTextarea" placeholder="Collez ici le retour de l'IA..."></textarea>
                <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
                    <button class="btn btn-secondary" onclick="closeBulkIAModal()">Annuler</button>
                    <button class="btn btn-primary" onclick="parseBulkIAResult()">🔍 Analyser</button>
                </div>
            </div>

            <!-- Step 1: Paste manual -->
            <div id="bulkIAStep1Paste" class="bulk-ia-step" style="margin-top:14px;display:none;">
                <p class="muted" style="font-size:12px;margin-bottom:8px;">
                    <strong>Collez vos numéros :</strong> Format : une ligne par prospect avec "Nom / Numéro" ou "Nom / Numéro1 / Numéro2" pour plusieurs numéros.
                </p>
                <textarea id="bulkIAPasteTextarea" placeholder="Exemple :&#10;Nicolas Mugnier / +33 4 37 59 09 80&#10;Herve Pays / +33 4 37 59 09 80 / +33 6 15 23 65 89&#10;Sebastien Chapacou / +33 6 12 34 56 78" style="min-height:200px;font-family:monospace;font-size:12px;"></textarea>
                <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
                    <button class="btn btn-secondary" onclick="closeBulkIAModal()">Annuler</button>
                    <button class="btn btn-primary" onclick="parseBulkIAPaste()">🔍 Analyser</button>
                </div>
            </div>

            <!-- Step 1: CSV import -->
            <div id="bulkIAStep1Csv" class="bulk-ia-step" style="margin-top:14px;display:none;">
                <p class="muted" style="font-size:12px;margin-bottom:8px;">
                    <strong>Importez un fichier CSV :</strong> Le format peut varier. Vous pourrez vérifier le mapping avec Ollama si nécessaire.
                </p>
                <div style="margin-bottom:12px;">
                    <label style="font-size:12px;display:block;margin-bottom:4px;">Séparateur :</label>
                    <select id="bulkIACsvSeparator" style="font-size:13px;padding:6px 10px;border-radius:6px;margin-right:12px;">
                        <option value="auto">Auto</option>
                        <option value=";">Point-virgule (;)</option>
                        <option value=",">Virgule (,)</option>
                        <option value="\t">Tabulation</option>
                    </select>
                    <button class="btn btn-secondary" onclick="suggestBulkIACsvMappingWithOllama()" id="bulkIACsvSuggestOllamaBtn" style="font-size:12px;padding:6px 12px;">🤖 Vérifier format avec Ollama</button>
                </div>
                <input type="file" id="bulkIACsvFile" accept=".csv,.txt" style="display:none;">
                <button type="button" class="btn btn-primary" onclick="document.getElementById('bulkIACsvFile').click()">Choisir un fichier CSV</button>
                <div id="bulkIACsvMapping" style="display:none;margin-top:16px;">
                    <p class="muted" style="font-size:12px;margin-bottom:8px;"><strong>Mapping des colonnes :</strong></p>
                    <div id="bulkIACsvMappingGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;"></div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button class="btn btn-secondary" onclick="closeBulkIAModal()">Annuler</button>
                        <button class="btn btn-primary" onclick="parseBulkIACsv()">🔍 Analyser</button>
                    </div>
                </div>
            </div>

            <!-- Step 2: Preview & Apply -->
            <div id="bulkIAStep2" style="margin-top:14px;display:none;">
                <p class="muted" style="font-size:12px;margin-bottom:8px;">
                    Vérifiez et corrigez les résultats. Décochez les lignes à ignorer.
                </p>
                <div style="max-height:400px;overflow-y:auto;">
                    <table class="bulk-ia-results-table">
                        <thead>
                            <tr>
                                <th style="width:30px;">✓</th>
                                <th>Prospect</th>
                                <th>Entreprise</th>
                                <th id="bulkIAResultHeader">Email</th>
                                <th style="width:70px;">Statut</th>
                            </tr>
                        </thead>
                        <tbody id="bulkIAResultsBody"></tbody>
                    </table>
                </div>
                <div style="display:flex;gap:8px;margin-top:16px;justify-content:space-between;">
                    <button class="btn btn-secondary" onclick="bulkIABackToStep1()">← Modifier</button>
                    <div style="display:flex;gap:8px;">
                        <span id="bulkIAFoundCount" class="muted" style="font-size:12px;align-self:center;"></span>
                        <button class="btn btn-primary" onclick="applyBulkIA()">💾 Appliquer</button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(div.firstElementChild);
    
    // CSV file handler
    document.getElementById('bulkIACsvFile').addEventListener('change', function(e) {
        const f = e.target.files[0];
        if (f) parseBulkIACsvFile(f);
    });
}

let _bulkIACurrentTab = 'ollama';
let _bulkIACsvData = null; // {headers, rows}

function openBulkIAModal(mode) {
    if (selectedProspects.size === 0) {
        showToast('⚠️ Sélectionnez des prospects d\'abord.', 'warning');
        return;
    }
    _ensureBulkIAModal();
    _bulkIAMode = mode;
    const field = mode === 'email' ? 'email' : 'telephone';
    const fieldLabel = mode === 'email' ? 'Email' : 'Téléphone';

    // Gather selected prospects info
    _bulkIAProspects = [];
    selectedProspects.forEach(id => {
        const p = data.prospects.find(x => x.id === id);
        if (!p) return;
        const c = data.companies.find(x => x.id === p.company_id);
        _bulkIAProspects.push({
            id: p.id,
            name: p.name,
            company: c ? (c.groupe || c.site || '') : '',
            companySite: c ? (c.site || '') : '',
            fonction: p.fonction || '',
            current: p[field] || '',
        });
    });

    if (_bulkIAProspects.length === 0) {
        showToast('⚠️ Aucun prospect valide sélectionné.', 'warning');
        return;
    }

    // Update title
    const icon = mode === 'email' ? '📧' : '📞';
    document.getElementById('bulkIATitle').textContent = `${icon} Trouver les ${fieldLabel}s — ${_bulkIAProspects.length} prospect(s)`;
    document.getElementById('bulkIAResultHeader').textContent = fieldLabel;

    // Show tabs only for tel mode
    const tabsEl = document.getElementById('bulkIATabs');
    if (tabsEl) tabsEl.style.display = mode === 'tel' ? '' : 'none';

    // Reset tabs and show ollama by default
    _bulkIACurrentTab = 'ollama';
    switchBulkIATab('ollama');

    // Generate prompt
    const prompt = _generateBulkIAPrompt(mode);
    document.getElementById('bulkIAPromptText').textContent = prompt;
    document.getElementById('bulkIAResultTextarea').value = '';
    document.getElementById('bulkIAPasteTextarea').value = '';
    document.getElementById('bulkIAStep2').style.display = 'none';
    _bulkIACsvData = null;
    document.getElementById('bulkIACsvMapping').style.display = 'none';
    document.getElementById('bulkIACsvFile').value = '';

    const modal = document.getElementById('modalBulkIA');
    if (modal) {
        if (window.openModal) {
            window.openModal(modal, { focusElement: 'input, textarea' });
        } else {
            modal.classList.add('active');
        }
    }
}

function switchBulkIATab(tab) {
    _bulkIACurrentTab = tab;
    document.querySelectorAll('.bulk-ia-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.bulk-ia-step').forEach(step => {
        step.style.display = 'none';
    });
    if (tab === 'ollama') {
        document.getElementById('bulkIAStep1Ollama').style.display = '';
    } else if (tab === 'paste') {
        document.getElementById('bulkIAStep1Paste').style.display = '';
    } else if (tab === 'csv') {
        document.getElementById('bulkIAStep1Csv').style.display = '';
    }
}

function closeBulkIAModal() {
    const modal = document.getElementById('modalBulkIA');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
}

function bulkIABackToStep1() {
    if (_bulkIACurrentTab === 'ollama') {
        document.getElementById('bulkIAStep1Ollama').style.display = '';
    } else if (_bulkIACurrentTab === 'paste') {
        document.getElementById('bulkIAStep1Paste').style.display = '';
    } else if (_bulkIACurrentTab === 'csv') {
        document.getElementById('bulkIAStep1Csv').style.display = '';
    }
    document.getElementById('bulkIAStep2').style.display = 'none';
}

function _generateBulkIAPrompt(mode) {
    const isEmail = mode === 'email';
    const fieldLabel = isEmail ? 'EMAIL' : 'TELEPHONE';

    let list = _bulkIAProspects.map((p, i) =>
        `${i + 1}. ${p.name} — ${p.fonction ? p.fonction + ' — ' : ''}${p.company}`
    ).join('\n');

    if (isEmail) {
        return `Tu es un assistant de prospection B2B. Je dois trouver les adresses email professionnelles des personnes suivantes.

══════ LISTE DES PROSPECTS ══════
${list}

══════ INSTRUCTIONS ══════
Pour chaque personne, cherche l'adresse email professionnelle la plus probable.
Utilise les conventions de nommage d'email classiques des entreprises (prenom.nom@domaine.com, p.nom@domaine.com, etc.).
Si tu ne trouves pas l'email, écris "NON TROUVÉ".

══════ FORMAT DE SORTIE (respecte exactement ce format) ══════
1. EMAIL: prenom.nom@entreprise.com
2. EMAIL: p.nom@entreprise.com
3. EMAIL: NON TROUVÉ
...

Sources : LinkedIn, site entreprise, Hunter.io, signaux web.`;
    } else {
        return `Tu es un assistant de prospection B2B. Je dois trouver les numéros de téléphone professionnels (ligne directe ou portable pro) des personnes suivantes.

══════ LISTE DES PROSPECTS ══════
${list}

══════ INSTRUCTIONS ══════
Pour chaque personne, cherche le numéro de téléphone professionnel (ligne directe, portable pro, ou standard + poste).
Si tu ne trouves pas le numéro, écris "NON TROUVÉ".

══════ FORMAT DE SORTIE (respecte exactement ce format) ══════
1. TELEPHONE: 04 72 XX XX XX
2. TELEPHONE: 06 XX XX XX XX
3. TELEPHONE: NON TROUVÉ
...

Sources : LinkedIn, site entreprise, annuaires professionnels, signaux web.`;
    }
}

async function runBulkIAWithOllama() {
    const prompt = document.getElementById('bulkIAPromptText').textContent;
    if (!prompt) return;
    const btn = document.getElementById('bulkIAOllamaBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Génération…'; }
    try {
        const text = await callOllama(prompt);
        document.getElementById('bulkIAResultTextarea').value = text;
        parseBulkIAResult();
    } catch (e) {
        showToast('Génération Ollama échouée. Collez manuellement le retour ci-dessous.', 'warning', 5000);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🤖 Générer avec Ollama'; }
    }
}

function copyBulkIAPrompt() {
    const text = document.getElementById('bulkIAPromptText').textContent;
    navigator.clipboard.writeText(text).then(() => {
        showToast('Prompt copié. Collez dans votre IA ou utilisez Générer avec Ollama.', 'success', 4000);
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('📋 Prompt copié !', 'success', 3000);
    });
}

function parseBulkIAResult() {
    const text = document.getElementById('bulkIAResultTextarea').value.trim();
    if (!text) { showToast('⚠️ Collez le retour de l\'IA d\'abord.', 'warning'); return; }

    const isEmail = _bulkIAMode === 'email';
    const fieldKey = isEmail ? 'EMAIL' : 'TELEPHONE';
    const lines = text.split('\n');

    // Parse: "1. EMAIL: value" or "1. TELEPHONE: value" or just "1. value"
    const results = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Try: "N. KEY: value" or "N. value" or "N) KEY: value"
        const match = trimmed.match(/^(\d+)\s*[.)]\s*(?:(?:EMAIL|TELEPHONE|TEL|MAIL)\s*:\s*)?(.+)$/i);
        if (match) {
            const idx = parseInt(match[1]) - 1;
            let value = match[2].trim();
            const notFound = /non\s*trouv|introuvable|inconnu|n\/a|pas\s*trouv|not\s*found|aucun/i.test(value);
            if (notFound) value = '';
            results[idx] = value;
        }
    }

    _displayBulkIAResults(results);
}

// Parse pasted manual data (format: "Nom / Numéro" or "Nom / Numéro1 / Numéro2")
function parseBulkIAPaste() {
    const text = document.getElementById('bulkIAPasteTextarea').value.trim();
    if (!text) { showToast('⚠️ Collez les numéros d\'abord.', 'warning'); return; }

    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const results = [];

    // Build a map of name -> phone numbers
    const nameToPhones = {};
    lines.forEach(line => {
        const parts = line.split('/').map(p => p.trim()).filter(p => p);
        if (parts.length < 2) return; // Need at least name + one phone
        const name = parts[0];
        const phones = parts.slice(1).filter(p => p);
        if (phones.length > 0) {
            nameToPhones[name] = phones.join(' / ');
        }
    });

    // Match prospects by name (fuzzy matching)
    _bulkIAProspects.forEach((p, i) => {
        let found = '';
        // Exact match first
        if (nameToPhones[p.name]) {
            found = nameToPhones[p.name];
        } else {
            // Try fuzzy match (case insensitive, partial)
            const pNameLower = p.name.toLowerCase();
            for (const [name, phones] of Object.entries(nameToPhones)) {
                if (name.toLowerCase() === pNameLower || 
                    name.toLowerCase().includes(pNameLower) || 
                    pNameLower.includes(name.toLowerCase())) {
                    found = phones;
                    break;
                }
            }
        }
        results[i] = found;
    });

    _displayBulkIAResults(results);
}

// Parse CSV file
function parseBulkIACsvFile(file) {
    const sepEl = document.getElementById('bulkIACsvSeparator');
    let sep = (sepEl && sepEl.value && sepEl.value !== 'auto') ? sepEl.value : null;
    if (sep === '\\t') sep = '\t';
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const raw = _parseCsvText(e.target.result, sep ? { separator: sep } : {});
            if (!raw || !raw.rows.length) { 
                showToast('CSV vide ou invalide.', 'warning'); 
                return; 
            }
            _bulkIACsvData = raw;
            _showBulkIACsvMapping();
        } catch (err) {
            showToast('Erreur lecture CSV: ' + (err.message || err), 'error');
        }
    };
    reader.onerror = function() { 
        showToast('Erreur de lecture du fichier.', 'error'); 
    };
    reader.readAsText(file, 'utf-8');
}

function _showBulkIACsvMapping() {
    if (!_bulkIACsvData) return;
    const grid = document.getElementById('bulkIACsvMappingGrid');
    const mapping = {};
    
    grid.innerHTML = _bulkIACsvData.headers.map((h, i) => {
        const guessed = _guessMapping(h);
        const isName = /nom|name|contact/i.test(h) && !/entreprise|company|société/i.test(h);
        const isTel = /tél|tel|telephone|phone|mobile|portable/i.test(h);
        let opts = '<option value="">— Ignorer —</option>';
        if (isName) opts += '<option value="name" selected>Nom du prospect</option>';
        if (isTel) opts += '<option value="telephone" selected>Téléphone</option>';
        if (!isName && !isTel) {
            opts += '<option value="name">Nom du prospect</option>';
            opts += '<option value="telephone">Téléphone</option>';
        }
        return `<div class="import-list-mapping-row"><label style="font-size:11px;">${escapeHtml(h) || 'Colonne ' + (i+1)}</label><select class="bulk-ia-csv-map-select" data-col="${i}" style="font-size:12px;padding:4px 8px;">${opts}</select></div>`;
    }).join('');
    
    document.getElementById('bulkIACsvMapping').style.display = '';
}

async function suggestBulkIACsvMappingWithOllama() {
    if (!_bulkIACsvData || !_bulkIACsvData.headers.length) return;
    const headers = _bulkIACsvData.headers;
    const prompt = `Tu es un assistant. Voici les en-têtes de colonnes d'un fichier CSV pour ajouter des numéros de téléphone à des prospects : ${JSON.stringify(headers)}. Retourne un objet JSON unique dont les clés sont exactement ces en-têtes (une par colonne) et les valeurs sont soit "name" (pour la colonne contenant le nom du prospect), soit "telephone" (pour la colonne contenant le numéro de téléphone), soit "" (chaîne vide pour ignorer). Exemple : {"NOM":"name","TEL":"telephone","PORTABLE":"telephone","AUTRE":"","DATE":""}. Réponds uniquement avec ce JSON, sans texte avant ou après, sans markdown.`;
    const btn = document.getElementById('bulkIACsvSuggestOllamaBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Génération…'; }
    try {
        const text = await callOllama(prompt);
        let jsonStr = (text || '').trim();
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];
        const mapping = JSON.parse(jsonStr);
        const headerToIndex = {};
        headers.forEach((h, i) => { headerToIndex[h] = i; });
        Object.keys(mapping).forEach(header => {
            const field = mapping[header];
            const idx = headerToIndex[header];
            if (idx === undefined || !field) return;
            const select = document.querySelector(`.bulk-ia-csv-map-select[data-col="${idx}"]`);
            if (select && (field === 'name' || field === 'telephone')) select.value = field;
        });
        showToast('Mapping suggéré appliqué. Vérifiez puis cliquez Analyser.', 'success', 4000);
    } catch (e) {
        showToast('Ollama indisponible ou réponse invalide. Vérifiez le mapping manuellement.', 'warning', 5000);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🤖 Vérifier format avec Ollama'; }
    }
}

function parseBulkIACsv() {
    if (!_bulkIACsvData) { showToast('⚠️ Importez un fichier CSV d\'abord.', 'warning'); return; }
    
    const selects = document.querySelectorAll('.bulk-ia-csv-map-select');
    const nameCols = [];
    const telCols = [];
    
    selects.forEach(s => {
        const col = parseInt(s.dataset.col, 10);
        const field = s.value;
        if (field === 'name') nameCols.push(col);
        else if (field === 'telephone') telCols.push(col);
    });
    
    if (nameCols.length === 0) {
        showToast('⚠️ Mappez au moins une colonne "Nom du prospect".', 'warning');
        return;
    }
    
    if (telCols.length === 0) {
        showToast('⚠️ Mappez au moins une colonne "Téléphone".', 'warning');
        return;
    }
    
    // Build map: name -> phones (multiple phones joined with /)
    const nameToPhones = {};
    _bulkIACsvData.rows.forEach(row => {
        const nameParts = nameCols.map(c => (row[c] != null ? String(row[c]).trim() : '')).filter(Boolean);
        const name = nameParts.join(' ').trim();
        if (!name) return;
        
        const phoneParts = telCols.map(c => (row[c] != null ? String(row[c]).trim() : '')).filter(Boolean);
        if (phoneParts.length > 0) {
            // If multiple phone columns, join them with /
            nameToPhones[name] = phoneParts.join(' / ');
        }
    });
    
    // Match prospects by name
    const results = [];
    _bulkIAProspects.forEach((p, i) => {
        let found = '';
        // Exact match first
        if (nameToPhones[p.name]) {
            found = nameToPhones[p.name];
        } else {
            // Try fuzzy match
            const pNameLower = p.name.toLowerCase();
            for (const [name, phones] of Object.entries(nameToPhones)) {
                if (name.toLowerCase() === pNameLower || 
                    name.toLowerCase().includes(pNameLower) || 
                    pNameLower.includes(name.toLowerCase())) {
                    found = phones;
                    break;
                }
            }
        }
        results[i] = found;
    });
    
    _displayBulkIAResults(results);
}

// Common function to display results (used by all parsing methods)
function _displayBulkIAResults(results) {
    const tbody = document.getElementById('bulkIAResultsBody');
    let html = '';
    let foundCount = 0;

    _bulkIAProspects.forEach((p, i) => {
        const found = results[i] || '';
        const hasValue = found && found.length > 0;
        if (hasValue) foundCount++;

        const statusClass = hasValue ? 'found' : 'not-found';
        const statusText = hasValue ? '✅ Trouvé' : '—';
        const currentNote = p.current ? ` (actuel : ${_escIA(p.current)})` : '';

        html += `<tr>
            <td><input type="checkbox" class="bulk-ia-check" data-idx="${i}" ${hasValue ? 'checked' : ''} ${!hasValue ? 'disabled' : ''}></td>
            <td>${_escIA(p.name)}<span class="muted" style="font-size:10px;">${currentNote}</span></td>
            <td style="font-size:11px;">${_escIA(p.company)}</td>
            <td><input type="text" class="bulk-ia-value" data-idx="${i}" value="${_escIA(found)}" placeholder="${hasValue ? '' : 'Non trouvé'}" ${!hasValue ? 'style="opacity:0.4;"' : ''}></td>
            <td class="${statusClass}" style="font-size:11px;">${statusText}</td>
        </tr>`;
    });

    tbody.innerHTML = html;
    document.getElementById('bulkIAFoundCount').textContent = `${foundCount}/${_bulkIAProspects.length} trouvé(s)`;

    if (_bulkIACurrentTab === 'ollama') {
        document.getElementById('bulkIAStep1Ollama').style.display = 'none';
    } else if (_bulkIACurrentTab === 'paste') {
        document.getElementById('bulkIAStep1Paste').style.display = 'none';
    } else if (_bulkIACurrentTab === 'csv') {
        document.getElementById('bulkIAStep1Csv').style.display = 'none';
    }
    document.getElementById('bulkIAStep2').style.display = '';
}

async function applyBulkIA() {
    const isEmail = _bulkIAMode === 'email';
    const field = isEmail ? 'email' : 'telephone';
    const rows = document.querySelectorAll('#bulkIAResultsBody tr');
    const updates = [];

    rows.forEach(row => {
        const checkbox = row.querySelector('.bulk-ia-check');
        const input = row.querySelector('.bulk-ia-value');
        if (!checkbox || !input) return;
        const idx = parseInt(checkbox.dataset.idx);
        const value = input.value.trim();
        if (checkbox.checked && value) {
            updates.push({ idx, value });
        }
    });

    if (updates.length === 0) {
        showToast('ℹ️ Aucune donnée à appliquer.', 'info');
        return;
    }

    const total = updates.length;
    const label = isEmail ? 'email(s)' : 'téléphone(s)';
    
    // Apply to local data with progression
    const ids = [];
    const values = [];
    let applied = 0;
    
    for (const u of updates) {
        const p = data.prospects.find(x => x.id === _bulkIAProspects[u.idx].id);
        if (p) {
            p[field] = u.value;
            ids.push(p.id);
            values.push(u.value);
            applied++;
            showBulkProgress(applied, total, `${label} ajoutés...`);
            flashRowSuccess(p.id);
            if (total > 10) {
                await new Promise(resolve => setTimeout(resolve, 30));
            }
        }
    }

    // Save via bulk endpoint
    try {
        const res = await fetch('/api/prospects/bulk-field-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, field, values }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
    } catch (e) {
        // Fallback: save all data
        try { await saveToServerAsync(); } catch (e2) {}
    }

    closeBulkIAModal();
    filterProspects();
    showToast(`✅ ${applied} ${label} ajouté(s) via IA !`, 'success', 5000);
}

// Copy email address to clipboard (from email hyperlink)
// Open a push template file via server (launches Outlook)
async function openPushFile(prospectId, filename) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p || !p.push_category_id) {
        showToast('⚠️ Sélectionnez une catégorie push d\'abord.', 'warning');
        return;
    }
    try {
        const res = await fetch('/api/pushs/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category_id: p.push_category_id, filename })
        });
        const data2 = await res.json();
        if (data2.ok) {
            showToast('✅ Template ouvert dans Outlook !', 'success', 3000);
        } else {
            showToast('❌ ' + (data2.error || 'Erreur'), 'error');
        }
    } catch (e) {
        showToast('❌ Erreur: ' + e.message, 'error');
    }
}

function copyEmailToClipboard(email) {
    navigator.clipboard.writeText(email).then(() => {
        showToast('📋 Email copié : ' + email, 'success', 2500);
    }).catch(() => {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = email;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('📋 Email copié : ' + email, 'success', 2500);
    });
}


async function copyLinkedInForProspect(prospectId) {
    // v25.3: Ouvrir la modale de sélection candidats/consultants pour LinkedIn aussi
    await openPushSelectModal(prospectId, 'linkedin');
    return;
    
    // Code legacy (ne devrait plus être atteint)
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p || !p.linkedin) {
        alert("⚠️ Aucun LinkedIn renseigné.");
        return;
    }
    const company = data.companies.find(c => c.id === p.company_id);

    // Template choisi -> sinon défaut
    let templateId = p.template_id;

    const tpl = (templateId ? getTemplateById(templateId) : null) || getDefaultTemplate();
    const vars = buildTemplateVars(p, company);

    // Check for custom InMail template in settings
    let text = '';
    try {
        const settingsRes = await fetch('/api/settings');
        const settings = await settingsRes.json();
        if (settings && settings.linkedin_inmail_template && settings.linkedin_inmail_template.trim()) {
            text = renderTemplateString(settings.linkedin_inmail_template, vars).trim();
        }
    } catch(e) {}

    if (!text) {
        text =
`Bonjour ${vars.civilite ? (vars.civilite + ' ') : ''}${vars.nom || vars.nom_complet || ''},

Je me permets de vous contacter concernant ${vars.entreprise || 'votre entreprise'}.

Belle journée,`;

        if (tpl) {
const b = renderTemplateString((tpl.linkedin_body || tpl.linkedinBody || tpl.body || ''), vars).trim();
if (b) text = b;
        }
    }

    // Copy to clipboard
    try {
await navigator.clipboard.writeText(text);
    } catch (e) {
// fallback
const ta = document.createElement('textarea');
ta.value = text;
ta.style.position = 'fixed';
ta.style.left = '-9999px';
document.body.appendChild(ta);
ta.focus(); ta.select();
try { document.execCommand('copy'); } catch (e2) {}
document.body.removeChild(ta);
    }

    // Open LinkedIn profile in new tab
    if (p.linkedin) {
        window.open(p.linkedin, '_blank');
    }

    // Log push linkedin + set date
    const sentAt = todayISO();
    const prev = p.pushLinkedInSentAt || '';
    p.pushLinkedInSentAt = sentAt;

    try {
const el = document.getElementById('detailPushLinkedInSent');
if (el) el.textContent = `Oui · ${sentAt}`;
    } catch (e) {}

    try { if (typeof filterProspects === 'function') filterProspects(); } catch (e) {}

    try {
if (tpl && tpl.id) p.template_id = Number(tpl.id);
await saveToServerAsync();
    } catch (e) {
console.warn('Impossible de sauvegarder la date de push linkedin', e);
    }

    try {
const res = await fetch('/api/push-logs/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        prospect_id: p.id,
        sentAt,
        channel: 'linkedin',
        to_email: null,
        subject: null,
        body: text,
        template_id: (tpl && tpl.id) ? Number(tpl.id) : null,
        template_name: (tpl && tpl.name) ? String(tpl.name) : null
    })
});
if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.warn('push-logs/add (linkedin) failed', txt);
    p.pushLinkedInSentAt = prev;
    try { await saveToServerAsync(); } catch (e) {}
    alert("❌ Impossible d'enregistrer le push LinkedIn dans le suivi.");
}
    } catch (e) {
console.warn("push-logs/add (linkedin) error", e);
    }

    // feedback
    showToast("✅ Message InMail copié + LinkedIn ouvert !", 'success');
}



async function undoLastPush(prospectId, channel) {
    channel = (channel || 'email');
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return;

    const current = (channel === 'linkedin') ? (p.pushLinkedInSentAt || '') : (p.pushEmailSentAt || '');
    if (!current) {
showToast("ℹ️ Aucun push à annuler.", "info");
return;
    }

    const company = data.companies.find(c => c.id === p.company_id);
    const label = `${p.name} (${company?.groupe || 'Sans entreprise'})\nDernier push (${channel}): ${current}`;

    if (!confirm(`⚠️ Annuler le dernier push ?\n\n${label}\n\nCela supprimera l'entrée dans le suivi des push et retirera la mention "Push envoyé".`)) return;

    // 1) Supprimer le dernier log serveur + nettoyer pushEmailSentAt côté DB
    try {
const res = await fetch('/api/push-logs/undo_last', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prospect_id: prospectId, channel })
});

if (!res.ok) {
    const msg = await res.text().catch(() => '');
    console.warn('Undo push failed:', msg);
    alert("❌ Impossible d'annuler le push (serveur). Vérifiez que le serveur Python est lancé et que la base est accessible.");
    return;
}
    } catch (e) {
console.warn("Undo push: API error", e);
alert("❌ Impossible d'annuler le push (réseau/serveur).");
return;
    }

    // 2) Mettre à jour l'état local et persister
    if (channel === 'linkedin') p.pushLinkedInSentAt = ''; else p.pushEmailSentAt = '';

    try {
if (channel === 'linkedin') {
    const el2 = document.getElementById('detailPushLinkedInSent');
    if (el2) el2.textContent = 'Non';
} else {
    const el = document.getElementById('detailPushSent');
    if (el) el.textContent = 'Non';
}
    } catch (e) {}

    try { if (typeof filterProspects === 'function') filterProspects(); } catch (e) {}

    try {
await saveToServerAsync();
    } catch (err) {
console.error('Erreur sauvegarde serveur :', err);
alert("❌ Le serveur local n'a pas pu sauvegarder. Vérifiez que Python est lancé (app.py).");
    }

    // Refresh modal pour retirer le bouton Annuler
    try { viewDetail(prospectId); } catch (e) {}
}


function openTeamsInvite(prospectId) {
    const p = data.prospects.find(x => x.id === prospectId) || {};
    const company = data.companies.find(c => c.id === p.company_id);
    const subject = encodeURIComponent(`RDV - ${company?.groupe || 'Prospection'}`);
    const content = encodeURIComponent(`Bonjour,\n\nJe vous propose un court échange concernant...\n\nMerci,\n`);
    const start = new Date(Date.now() + 15 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    // Format ISO 8601 (Teams accepte généralement ce format)
    const startTime = encodeURIComponent(start.toISOString());
    const endTime = encodeURIComponent(end.toISOString());

    let url = `https://teams.microsoft.com/l/meeting/new?subject=${subject}&content=${content}&startTime=${startTime}&endTime=${endTime}`;
    if (p.email) {
url += `&attendees=${encodeURIComponent(p.email)}`;
    }
    window.open(url, '_blank');
}

function toggleDetailEdit(isEdit) {
    const ro = document.getElementById('detailReadonly');
    const ed = document.getElementById('detailEditSection');
    if (!ro || !ed) return;
    ro.style.display = isEdit ? 'none' : 'block';
    ed.style.display = isEdit ? 'block' : 'none';
}

function closeDetail(options = {}) {
    const modal = document.getElementById('modalDetail');
    if (!modal) return;
    if (window.closeModal) {
        window.closeModal(modal);
    } else {
        modal.classList.remove('active');
    }

    const card = modal.querySelector('.modal-content');
    if (card) {
        card.classList.remove('prosp-mode-card');
        card.classList.remove('prosp-enter');
        card.classList.remove('prosp-swipe-left');
    }

    const shouldExitProsp = (_currentView === 'prosp') && !options.keepProspMode;
    if (shouldExitProsp) {
        const exitScrollState = _prospSession.listScrollState || _captureProspectsScrollState(_prospSession.currentId);
        _saveProspSessionToStorage({ scrollState: exitScrollState, anchorId: _prospSession.currentId });
        _prospSession = { active: false, ids: [], currentId: null, currentIndex: -1, listScrollState: null };
        _currentView = 'table';
        const tableEl = document.getElementById('tableView');
        const kanbanEl = document.getElementById('kanbanView');
        if (tableEl) tableEl.style.display = '';
        if (kanbanEl) kanbanEl.style.display = 'none';
        _setViewToggleButtons('table');
        if (exitScrollState) {
            _queueProspectsScrollRestore(exitScrollState);
            _flushProspectsScrollRestore();
        }
        showProspResumeBanner();
    }
}

function showProspResumeBanner() {
    const el = document.getElementById('prospResumeBanner');
    if (el) el.classList.add('visible');
}

function dismissProspResumeBanner() {
    const el = document.getElementById('prospResumeBanner');
    if (el) el.classList.remove('visible');
    try { sessionStorage.removeItem(PROSP_SESSION_STORAGE_KEY); } catch (e) {}
}

function resumeProspSession() {
    let raw;
    try {
        raw = sessionStorage.getItem(PROSP_SESSION_STORAGE_KEY);
    } catch (e) { return; }
    if (!raw) {
        if (typeof showToast === 'function') showToast('Aucune session à reprendre.', 'info');
        return;
    }
    let saved;
    try {
        saved = JSON.parse(raw);
    } catch (e) {
        dismissProspResumeBanner();
        return;
    }
    if (!saved || !Array.isArray(saved.ids) || saved.ids.length === 0) {
        dismissProspResumeBanner();
        return;
    }

    const liveProspectIds = new Set((Array.isArray(data.prospects) ? data.prospects : []).map(p => p.id));
    const savedIds = saved.ids.filter(id => liveProspectIds.has(id));
    if (savedIds.length === 0) {
        dismissProspResumeBanner();
        return;
    }

    const currentFilteredIds = _getCurrentProspIds();
    const savedSet = new Set(savedIds);
    let ids = currentFilteredIds.filter(id => savedSet.has(id));
    if (ids.length === 0) ids = savedIds;

    let currentId = saved.currentId;
    if (!ids.includes(currentId)) {
        if (saved.lastContactHintId && ids.includes(saved.lastContactHintId)) {
            currentId = saved.lastContactHintId;
        } else {
            currentId = _pickMostRecentSessionProspectId(ids) || ids[0];
        }
    }

    let currentIndex = ids.indexOf(currentId);
    if (currentIndex < 0) currentIndex = 0;

    _prospSession = {
        active: true,
        ids,
        currentId,
        currentIndex,
        listScrollState: saved.scrollState || _captureProspectsScrollState(currentId)
    };
    _currentView = 'prosp';
    const tableEl = document.getElementById('tableView');
    const kanbanEl = document.getElementById('kanbanView');
    if (tableEl) tableEl.style.display = 'none';
    if (kanbanEl) kanbanEl.style.display = 'none';
    _setViewToggleButtons('prosp');
    try { sessionStorage.removeItem(PROSP_SESSION_STORAGE_KEY); } catch (e) {}
    dismissProspResumeBanner();
    viewDetail(currentId).catch(function () {});
}

// Sauvegarder la session Prosp quand l'app passe en arrière-plan (ex: quitter pour appeler)
// pour pouvoir reprendre au bon endroit au retour (même si la page a été rechargée)
function _saveProspSessionToStorage(options = {}) {
    if (_currentView !== 'prosp' || !_prospSession.active) return;
    const ids = Array.isArray(_prospSession.ids) && _prospSession.ids.length
        ? _prospSession.ids.slice()
        : _getCurrentProspIds();
    const anchorId = options.anchorId != null ? options.anchorId : _prospSession.currentId;
    const scrollState = options.scrollState || _captureProspectsScrollState(anchorId);
    _prospSession.listScrollState = scrollState;
    try {
        sessionStorage.setItem(PROSP_SESSION_STORAGE_KEY, JSON.stringify({
            version: 2,
            ids,
            currentId: _prospSession.currentId,
            currentIndex: _prospSession.currentIndex,
            lastContactHintId: _pickMostRecentSessionProspectId(ids),
            savedAt: new Date().toISOString(),
            scrollState
        }));
    } catch (e) {}
}
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
        _saveProspSessionToStorage();
    } else if (document.visibilityState === 'visible') {
        // Reprendre si une session est en storage mais qu'on n'est plus en Mode Prosp (ex: perte de state en mémoire)
        try {
            if (window.__APP_PAGE__ === 'prospects' && _currentView !== 'prosp' && sessionStorage.getItem(PROSP_SESSION_STORAGE_KEY)) {
                const raw = sessionStorage.getItem(PROSP_SESSION_STORAGE_KEY);
                if (raw) {
                    const saved = JSON.parse(raw);
                    if (saved && Array.isArray(saved.ids) && saved.ids.length > 0 && saved.currentId != null) {
                        resumeProspSession();
                    }
                }
            }
        } catch (e) {}
    }
});
window.addEventListener('pagehide', _saveProspSessionToStorage);

// Close detail modal on backdrop click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('modalDetail');
    if (!modal || !modal.classList.contains('active')) return;
    // Only close if clicking the backdrop itself, not the content
    if (e.target === modal) closeDetail();
});

// Swipe gestures on detail card (mobile):
// - right: close
// - left (mode Prosp only): save + next
(function () {
    var swipeStartX = null;
    var swipeStartY = null;
    var SWIPE_THRESHOLD = 80;
    var mobile = window.matchMedia('(max-width: 600px)');

    function onTouchStart(e) {
        if (!mobile.matches) return;
        var modal = document.getElementById('modalDetail');
        if (!modal || !modal.classList.contains('active')) return;
        if (!e.target.closest('#modalDetail .modal-content')) return;
        if (e.target.closest('.detail-quick-actions, .detail-tabs, .detail-footer')) return;
        swipeStartX = e.touches[0].clientX;
        swipeStartY = e.touches[0].clientY;
    }
    function onTouchEnd(e) {
        if (swipeStartX === null) return;
        var endX = e.changedTouches[0].clientX;
        var endY = e.changedTouches[0].clientY;
        var deltaX = endX - swipeStartX;
        var deltaY = Math.abs(endY - swipeStartY);
        if (_currentView === 'prosp' && _prospSession.active && deltaX < -SWIPE_THRESHOLD && Math.abs(deltaX) > deltaY && _prospSession.currentId) {
            saveAndNext(_prospSession.currentId);
        } else if (deltaX > SWIPE_THRESHOLD && deltaX > deltaY) {
            closeDetail();
        }
        swipeStartX = null;
        swipeStartY = null;
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
})();

function openAddModal() {
    editingId = null;
    document.getElementById('modalTitle').textContent = 'Ajouter Prospect';
    const form = document.getElementById('prospectForm');
    if (form) {
        form.reset();
        // Nettoyer les erreurs de validation
        if (typeof window.clearFieldError === 'function') {
            form.querySelectorAll('input, select, textarea').forEach(field => {
                window.clearFieldError(field);
            });
        }
        // Initialiser la validation si pas déjà fait
        if (typeof window.initFormValidation === 'function' && !form.dataset.validationInitialized) {
            window.initFormValidation(form, {
                validateOnBlur: true,
                validateOnInput: true,
                fieldOptions: {
                    name: { requiredMessage: 'Le nom est requis' },
                    company: { requiredMessage: 'L\'entreprise est requise' },
                    email: { emailMessage: 'Veuillez entrer une adresse email valide' },
                    linkedin: { urlMessage: 'Veuillez entrer une URL LinkedIn valide' }
                }
            });
            form.dataset.validationInitialized = 'true';
        }
    }

    // Auto-fill company if a company filter is active
    const companyFilterVal = document.getElementById('companyFilter')?.value;
    if (companyFilterVal) {
        const companySelect = document.getElementById('inputCompany');
        if (companySelect) companySelect.value = companyFilterVal;
    }

    const modal = document.getElementById('modalProspect');
    if (modal) {
        if (window.openModal) {
            window.openModal(modal, { focusElement: '#inputName' });
        } else {
            modal.classList.add('active');
        }
    }
}

function closeProspectModal() {
    const modal = document.getElementById('modalProspect');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
}

function saveProspect(e) {
    e.preventDefault();
    const form = document.getElementById('prospectForm');
    
    // Valider le formulaire
    if (typeof window.validateForm === 'function') {
        if (!window.validateForm(form, {
            name: { requiredMessage: 'Le nom est requis' },
            company: { requiredMessage: 'L\'entreprise est requise' },
            email: { emailMessage: 'Veuillez entrer une adresse email valide' },
            linkedin: { urlMessage: 'Veuillez entrer une URL LinkedIn valide' }
        })) {
            // Focus sur le premier champ invalide
            const firstInvalid = form.querySelector('.is-invalid, :invalid');
            if (firstInvalid) {
                firstInvalid.focus();
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }
    }
    
    const newProspect = {
        id: Math.max(...data.prospects.map(p => p.id), 0) + 1,
        name: document.getElementById('inputName').value.trim(),
        company_id: parseInt(document.getElementById('inputCompany').value),
        fonction: document.getElementById('inputFonction').value.trim(),
        telephone: document.getElementById('inputTel').value.trim(),
        email: document.getElementById('inputEmail').value.trim(),
        linkedin: document.getElementById('inputLinkedin').value.trim(),
        pertinence: document.getElementById('inputPertinence').value,
        statut: document.getElementById('inputStatut').value,
        lastContact: todayISO(),
        notes: document.getElementById('inputNotes').value.trim(),
        callNotes: [],
        nextFollowUp: '',
        priority: 2,
        pushEmailSentAt: '',
        tags: [],
        template_id: null
    };
    data.prospects.push(newProspect);
    saveToServer();
    markUnsaved();
    closeModal();
    filterProspects();
}

function exportJSON() {
    const json = JSON.stringify({ companies: data.companies, prospects: data.prospects }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Prospects_${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    markSavedByExport();
}

function importJSON() {
    document.getElementById('jsonFile').click();
}


function normalizeCompanyKey(groupe, site) {
    const norm = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
    return norm(groupe) + '|' + norm(site);
}

function mergeCompany(sourceId, targetId, newFields = null) {
    if (sourceId === targetId) return;
    // Déplacer les prospects
    data.prospects.forEach(p => {
        if (p.company_id === sourceId) p.company_id = targetId;
    });

    const target = data.companies.find(c => c.id === targetId);
    const source = data.companies.find(c => c.id === sourceId);

    // Fusionner notes / phone si fourni
    if (target) {
        if (newFields) {
            if (newFields.phone && (target.phone === 'Non disponible' || !target.phone)) target.phone = newFields.phone;
            if (newFields.notes && !target.notes) target.notes = newFields.notes;
            else if (newFields.notes && target.notes && !target.notes.includes(newFields.notes)) {
                target.notes = (target.notes + '\n\n' + newFields.notes).trim();
            }
        }
        if (source && source.notes && !target.notes) target.notes = source.notes;
        // Fusion tags
        if (source && Array.isArray(source.tags)) {
            const merged = normalizeTags([...(target.tags || []), ...source.tags]);
            target.tags = merged;
        }
    }

    // Supprimer l'entreprise source
    data.companies = data.companies.filter(c => c.id !== sourceId);
}
function openAddCompanyModal() {
    document.getElementById('companyForm').reset();
    document.getElementById('companyModalTitle').textContent = 'Ajouter Entreprise';
    document.getElementById('inputCompanyId').value = '';
    document.getElementById('companySubmitBtn').textContent = 'Ajouter';
    document.getElementById('inputCompanyPhone').value = '';
    document.getElementById('inputCompanyNotes').value = '';
    try {
        const hid = document.getElementById('inputCompanyTagsValue');
        if (hid) hid.value = '[]';
        initTagsEditor('companyTagsEditor', 'inputCompanyTagsValue', []);
    } catch (e) {}
    const iaSection = document.getElementById('companyIASection');
    if (iaSection) iaSection.style.display = 'none';
    
    // Initialiser la validation du formulaire
    const form = document.getElementById('companyForm');
    if (form && typeof window.initFormValidation === 'function' && !form.dataset.validationInitialized) {
        window.initFormValidation(form, {
            validateOnBlur: true,
            validateOnInput: true,
            fieldOptions: {
                company_name: { requiredMessage: 'Le nom du groupe est requis' },
                company_site: { requiredMessage: 'Le site / localisation est requis' }
            }
        });
        form.dataset.validationInitialized = 'true';
    }
    
    // Nettoyer les erreurs de validation
    if (form && typeof window.clearFieldError === 'function') {
        form.querySelectorAll('input, select, textarea').forEach(field => {
            window.clearFieldError(field);
        });
    }
    
    const modal = document.getElementById('modalCompany');
    if (modal) {
        if (window.openModal) {
            window.openModal(modal, { focusElement: 'input' });
        } else {
            modal.classList.add('active');
        }
    }
}

function openEditCompanyModal(companyId) {
    const company = data.companies.find(c => c.id === companyId);
    if (!company) return;

    if (isUnassignedCompany(companyId)) {
        showToast('⚠️ L\'entreprise "Sans entreprise" ne peut pas être modifiée.', 'warning');
        return;
    }
    openCompanySheet(companyId, 'edit');
}

function openCompanyFromProspect(companyId) {
    pendingCompanyFocusId = companyId;
    const input = document.getElementById('companySearchInput');
    if (input) input.value = '';
    switchView('companies');
}

function closeCompanyModal() {
    const modal = document.getElementById('modalCompany');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
}

function saveCompany(e) {
    e.preventDefault();
    
    const form = document.getElementById('companyForm');
    
    // Valider le formulaire
    if (typeof window.validateForm === 'function') {
        if (!window.validateForm(form, {
            company_name: { requiredMessage: 'Le nom du groupe est requis' },
            company_site: { requiredMessage: 'Le site / localisation est requis' }
        })) {
            // Focus sur le premier champ invalide
            const firstInvalid = form.querySelector('.is-invalid, :invalid');
            if (firstInvalid) {
                firstInvalid.focus();
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }
    }

    const idRaw = document.getElementById('inputCompanyId').value;
    const groupe = document.getElementById('inputCompanyName').value.trim();
    const site = document.getElementById('inputCompanySite').value.trim();
    const phoneVal = document.getElementById('inputCompanyPhone').value || 'Non disponible';
    const notesVal = document.getElementById('inputCompanyNotes').value || '';
    const tagsVal = readTagsFromHidden('inputCompanyTagsValue');

    const key = normalizeCompanyKey(groupe, site);

    if (idRaw) {
        const companyId = parseInt(idRaw, 10);
        if (isUnassignedCompany(companyId)) {
            alert('⚠️ L\'entreprise "Sans entreprise" ne peut pas être modifiée.');
            return;
        }
        const existing = data.companies.find(c => c.id === companyId);
        if (!existing) return;

        const dup = data.companies.find(c => c.id !== companyId && normalizeCompanyKey(c.groupe, c.site) === key);
        if (dup) {
            const ok = confirm(`Une entreprise identique existe déjà : "${dup.groupe || ''} ${dup.site || ''}".\n\nVoulez-vous fusionner l'entreprise actuelle dans celle-ci ?`);
            if (ok) {
                mergeCompany(companyId, dup.id, { phone: phoneVal, notes: notesVal });
                saveToServer();
                closeCompanyModal();
                refreshCompaniesUI();
                alert('✅ Entreprises fusionnées');
                return;
            }
        }
        existing.groupe = groupe;
        existing.site = site;
        existing.phone = phoneVal;
        existing.notes = notesVal;
        existing.tags = tagsVal;
        saveToServer();
        closeCompanyModal();
        refreshCompaniesUI();
        alert('✅ Entreprise modifiée');
    } else {
        const dup = data.companies.find(c => normalizeCompanyKey(c.groupe, c.site) === key);
        if (dup) {
            const ok = confirm(`Une entreprise identique existe déjà : "${dup.groupe || ''} ${dup.site || ''}".\n\nVoulez-vous fusionner en ajoutant les infos (tél/notes) à cette entreprise, plutôt que de créer un doublon ?`);
            if (ok) {
                // Enrichir l'entreprise existante
                if (phoneVal && (dup.phone === 'Non disponible' || !dup.phone)) dup.phone = phoneVal;
                if (notesVal && !dup.notes) dup.notes = notesVal;
                else if (notesVal && dup.notes && !dup.notes.includes(notesVal)) dup.notes = (dup.notes + '\n\n' + notesVal).trim();
                saveToServer();
                closeCompanyModal();
                refreshCompaniesUI();
                alert('✅ Informations ajoutées à l\'entreprise existante');
                return;
            }
        }

        const newCompany = {
            id: Math.max(...data.companies.map(c => c.id), 0) + 1,
            groupe,
            site,
            phone: phoneVal,
            notes: notesVal,
            tags: tagsVal
        };
        data.companies.push(newCompany);
        saveToServer();
        closeCompanyModal();
        refreshCompaniesUI();
        alert('✅ Entreprise ajoutée');
    }
}



/** Construit la map id entreprise importée -> id local sans modifier data (pour check doublons). */
function buildImportCompanyIdMap(imported) {
    const companyIdMap = {};
    if (!Array.isArray(imported.companies)) return companyIdMap;
    let nextId = Math.max(0, ...(data.companies || []).map(c => Number(c.id) || 0), 0) + 1;
    imported.companies.forEach(importedCompany => {
        const g = (importedCompany.groupe || '').trim().toLowerCase();
        const s = (importedCompany.site || '').trim().toLowerCase();
        const existing = (data.companies || []).find(c => (c.groupe || '').trim().toLowerCase() === g && (c.site || '').trim().toLowerCase() === s);
        if (existing) {
            companyIdMap[importedCompany.id] = existing.id;
        } else {
            companyIdMap[importedCompany.id] = nextId++;
        }
    });
    return companyIdMap;
}

/** Vérifie les doublons côté serveur sur les prospects "nouveaux" de l'import, puis fusionne. */
async function checkAndMergeImportedData(imported) {
    const companyIdMap = buildImportCompanyIdMap(imported);
    const newIndices = [];
    const newProspects = [];
    if (!Array.isArray(imported.prospects)) {
        mergeImportedData(imported);
        return;
    }
    const existingIds = new Set((data.companies || []).map(c => c.id));
    imported.prospects.forEach((ip, i) => {
        const mappedCompanyId = companyIdMap[ip.company_id] || companyIdMap[String(ip.company_id)] || ip.company_id;
        const emailKey = (ip.email || '').trim().toLowerCase();
        const nameKey = (ip.name || '').trim().toLowerCase();
        const existing = (data.prospects || []).find(p => {
            if (emailKey) return (p.email || '').trim().toLowerCase() === emailKey;
            return (p.company_id === mappedCompanyId) && ((p.name || '').trim().toLowerCase() === nameKey);
        });
        if (!existing) {
            newIndices.push(i);
            newProspects.push({
                name: (ip.name || '').trim(),
                email: (ip.email || '').trim(),
                telephone: (ip.telephone || '').trim(),
                linkedin: (ip.linkedin || '').trim(),
                company_id: existingIds.has(mappedCompanyId) ? mappedCompanyId : null
            });
        }
    });
    if (newProspects.length > 0) {
        try {
            const res = await fetch('/api/prospects/check-duplicates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prospects: newProspects })
            });
            if (res.ok) {
                const json = await res.json();
                const dupList = json.duplicate_indexes || [];
                if (dupList.length > 0) {
                    const msg = dupList.length === 1
                        ? '1 prospect semble déjà exister en base. Ne pas l\'ajouter ?'
                        : dupList.length + ' prospects semblent déjà exister en base. Ne pas les ajouter ?';
                    const skipDuplicates = confirm(msg + '\n\nOK = ne pas ajouter les doublons, Annuler = tout importer.');
                    if (skipDuplicates) {
                        const indicesToRemove = new Set(dupList.map(d => newIndices[d.index]));
                        imported.prospects = imported.prospects.filter((_, idx) => !indicesToRemove.has(idx));
                    }
                }
            }
        } catch (e) {
            console.warn('Check duplicates on import:', e);
        }
    }
    mergeImportedData(imported);
}

function mergeImportedData(imported) {
    const companyIdMap = {};

    // 1) Entreprises : dédup par (groupe+site) + construire la map des ids importés -> ids locaux
    if (Array.isArray(imported.companies)) {
        imported.companies.forEach(importedCompany => {
            const g = (importedCompany.groupe || '').trim().toLowerCase();
            const s = (importedCompany.site || '').trim().toLowerCase();
            const existing = data.companies.find(c => (c.groupe || '').trim().toLowerCase() === g && (c.site || '').trim().toLowerCase() === s);
            if (existing) {
                companyIdMap[importedCompany.id] = existing.id;
            } else {
                const oldId = importedCompany.id;
                const newId = Math.max(...data.companies.map(c => Number(c.id) || 0), 0) + 1;
                importedCompany.id = newId;
                data.companies.push(importedCompany);
                // map ancien id importé -> nouvel id local
                companyIdMap[oldId] = newId;
            }
        });
    }

    let created = 0, updated = 0, skipped = 0;

    // 2) Prospects : dédup par email (si présent) sinon par (companyId + name)
    if (Array.isArray(imported.prospects)) {
        imported.prospects.forEach(ip => {
            const mappedCompanyId = companyIdMap[ip.company_id] || companyIdMap[String(ip.company_id)] || ip.company_id;
            const emailKey = (ip.email || '').trim().toLowerCase();
            const nameKey = (ip.name || '').trim().toLowerCase();

            const existing = data.prospects.find(p => {
                if (emailKey) {
                    return (p.email || '').trim().toLowerCase() === emailKey;
                }
                return (p.company_id === mappedCompanyId) && ((p.name || '').trim().toLowerCase() === nameKey);
            });

            if (existing) {
                // Mise à jour "safe": on ne remplace que si import non vide
                const setIf = (k) => {
                    if (ip[k] !== undefined && String(ip[k]).trim() !== '') existing[k] = ip[k];
                };
                setIf('fonction'); setIf('telephone'); setIf('email'); setIf('linkedin'); setIf('notes');
                if (ip.pertinence !== undefined) existing.pertinence = ip.pertinence;
                if (ip.statut !== undefined && String(ip.statut).trim() !== '') existing.statut = ip.statut;
                if (ip.lastContact && (!existing.lastContact || ip.lastContact > existing.lastContact)) existing.lastContact = ip.lastContact;
                if (ip.nextFollowUp !== undefined) existing.nextFollowUp = ip.nextFollowUp || existing.nextFollowUp || '';
                if (ip.priority !== undefined) existing.priority = ip.priority;

                existing.company_id = mappedCompanyId;

                // Fusion notes d'appel
                if (ip.callNotes && ip.callNotes.length > 0) {
                    if (!existing.callNotes) existing.callNotes = [];
                    ip.callNotes.forEach(note => {
                        if (!existing.callNotes.find(n => n.date === note.date && n.content === note.content)) {
                            existing.callNotes.push(note);
                        }
                    });
                }

                updated += 1;
            } else {
                // Nouveau
                ip.id = Math.max(...data.prospects.map(p => Number(p.id) || 0), 0) + 1;
                ip.company_id = mappedCompanyId;
                if (ip.nextFollowUp === undefined) ip.nextFollowUp = '';
                if (ip.priority === undefined) ip.priority = 2;
                if (!ip.callNotes) ip.callNotes = [];
                if (!ip.lastContact) ip.lastContact = todayISO();
                data.prospects.push(ip);
                created += 1;
            }
        });
    }

    saveToServer();
    filterProspects();
    showToast(`✅ Import terminé : ${created} créé(s), ${updated} mis à jour.`, 'success', 5000);
}

// ====== Import ma liste (Excel / CSV) — guide nouvel utilisateur ======
const IMPORT_LIST_FIELDS = [
    { value: '', label: '— Ignorer' },
    { value: 'name', label: 'Nom' },
    { value: 'prenom', label: 'Prénom' },
    { value: 'groupe', label: 'Entreprise' },
    { value: 'site', label: 'Site' },
    { value: 'fonction', label: 'Fonction' },
    { value: 'telephone', label: 'Téléphone' },
    { value: 'email', label: 'Email' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'notes', label: 'Notes' },
    { value: 'tags', label: 'Tags' },
    { value: 'pertinence', label: 'Pertinence' },
    { value: 'statut', label: 'Statut' },
    { value: 'lastContact', label: 'Date dernier contact' },
];

let _importListRaw = null; // { headers: string[], rows: string[][] }
let _importListMapping = null; // { name: [0], groupe: [1], telephone: [7, 8], ... } arrays of column indices
let _importListWorkbook = null; // XLSX workbook pour choix de feuille multi-sheets

function _ensureImportListModal() {
    if (document.getElementById('modalImportList')) return;
    const div = document.createElement('div');
    div.innerHTML = `
    <div id="modalImportList" class="modal">
        <div class="modal-content" style="max-width:620px;">
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                <span>📥 Importer ma liste de prospection</span>
                <button class="btn btn-secondary" onclick="closeImportListModal()" style="font-size:14px;padding:4px 10px;">✕</button>
            </div>
            <div class="modal-body" style="padding:16px 0;">
                <div id="importListStepChoice">
                    <p class="muted" style="margin-bottom:14px;">Choisissez comment importer vos prospects (Excel, CSV ou collage).</p>
                    <div class="import-list-tabs">
                        <button type="button" class="import-list-tab active" data-tab="excel">📊 Fichier Excel</button>
                        <button type="button" class="import-list-tab" data-tab="csv">📄 Fichier CSV</button>
                        <button type="button" class="import-list-tab" data-tab="paste">📋 Coller (CSV)</button>
                        <button type="button" class="import-list-tab" data-tab="ia">🤖 Retour IA</button>
                    </div>
                    <div id="importListPaneExcel" class="import-list-pane active">
                        <input type="file" id="importListFileExcel" accept=".xlsx,.xls" style="display:none;">
                        <button type="button" class="btn btn-primary" onclick="document.getElementById('importListFileExcel').click()">Choisir un fichier .xlsx ou .xls</button>
                        <div id="importListExcelSheetChoice" style="display:none;margin-top:12px;">
                            <label style="font-size:12px;">Feuille à importer :</label>
                            <select id="importListExcelSheetSelect" style="font-size:13px;padding:6px 10px;border-radius:6px;margin-left:8px;min-width:180px;"></select>
                            <button type="button" class="btn btn-primary" style="margin-left:8px;" onclick="applyImportListExcelSheetChoice()">Utiliser cette feuille</button>
                        </div>
                    </div>
                    <div id="importListPaneCsv" class="import-list-pane" style="display:none;">
                        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px;align-items:center;">
                            <label style="font-size:12px;">Séparateur :</label>
                            <select id="importListCsvSeparator" style="font-size:13px;padding:6px 10px;border-radius:6px;">
                                <option value="auto">Auto (détection)</option>
                                <option value=";">Point-virgule (;)</option>
                                <option value=",">Virgule (,)</option>
                                <option value="\t">Tabulation</option>
                            </select>
                            <label style="font-size:12px;">Encodage :</label>
                            <select id="importListCsvEncoding" style="font-size:13px;padding:6px 10px;border-radius:6px;">
                                <option value="utf-8">UTF-8</option>
                                <option value="iso-8859-1">Latin-1 / Windows</option>
                            </select>
                        </div>
                        <input type="file" id="importListFileCsv" accept=".csv,.txt" style="display:none;">
                        <button type="button" class="btn btn-primary" onclick="document.getElementById('importListFileCsv').click()">Choisir un fichier .csv ou .txt</button>
                    </div>
                    <div id="importListPanePaste" class="import-list-pane" style="display:none;">
                        <p class="muted" style="font-size:12px;margin-bottom:8px;">Collez ici le contenu copié depuis Excel (une ligne par prospect, première ligne = en-têtes).</p>
                        <textarea id="importListPasteArea" rows="8" style="width:100%;border:1px solid var(--color-border);border-radius:8px;padding:10px;font-size:12px;font-family:monospace;resize:vertical;" placeholder="Nom;Entreprise;Fonction;Téléphone;Email&#10;Jean Dupont;ACME;Directeur;06...;jean@..."></textarea>
                        <button type="button" class="btn btn-primary" style="margin-top:10px;" onclick="parseImportListPaste()">🔍 Analyser</button>
                    </div>
                    <div id="importListPaneIa" class="import-list-pane" style="display:none;">
                        <p class="muted" style="margin-bottom:12px;">Utilisez l’outil « Ajout IA » pour coller un retour Ollama local ou copier-coller (JSON ou texte).</p>
                        <button type="button" class="btn btn-primary" onclick="closeImportListModal(); openQuickAddModal();">Ouvrir Ajout IA</button>
                    </div>
                </div>
                <div id="importListStepMapping" style="display:none;">
                    <p class="muted" style="margin-bottom:10px;">Associez chaque colonne à un champ Prosp'Up (la première ligne de votre fichier est utilisée comme en-têtes).</p>
                    <div id="importListMappingGrid"></div>
                    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">
                        <button type="button" class="btn btn-secondary" onclick="importListBackToChoice()">← Retour</button>
                        <button type="button" class="btn btn-secondary" id="importListSuggestOllamaBtn" onclick="suggestImportListMappingWithOllama()">Suggérer le mapping avec Ollama</button>
                        <button type="button" class="btn btn-primary" onclick="importListGoPreview()">Aperçu →</button>
                    </div>
                </div>
                <div id="importListStepPreview" style="display:none;">
                    <p class="muted" style="margin-bottom:8px;"><strong id="importListPreviewCount">0</strong> prospect(s) à importer.</p>
                    <p class="muted" style="margin-bottom:8px;font-size:12px;">Colonnes mal détectées ? Reformatez avec l’IA (bouton « Générer avec Ollama » dans la modale) :</p>
                    <div id="importListReformatButtons" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
                    <div id="importListPreviewTable" style="max-height:280px;overflow:auto;border:1px solid var(--color-border);border-radius:8px;"></div>
                    <div style="display:flex;gap:10px;margin-top:14px;">
                        <button type="button" class="btn btn-secondary" onclick="importListBackToMapping()">← Retour</button>
                        <button type="button" class="btn btn-secondary" id="importListReformatAllBtn" onclick="openImportListReformatAllModal()" style="display:none;">🤖 Reformater plusieurs colonnes</button>
                        <button type="button" class="btn btn-primary" onclick="applyImportList()">✅ Importer</button>
                    </div>
                </div>
                <div id="modalImportListReformat" class="modal" style="z-index:1150;">
                    <div class="modal-content" style="max-width:560px;">
                        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                            <span id="importListReformatTitle">Reformater avec l’IA</span>
                            <button type="button" class="btn btn-secondary" onclick="closeImportListReformatModal()" style="padding:4px 10px;">✕</button>
                        </div>
                        <div class="modal-body">
                            <p class="muted" style="font-size:12px;margin-bottom:8px;">Générez avec Ollama (local) ou copiez le prompt dans une IA puis collez le résultat ci-dessous.</p>
                            <label class="import-reformat-label">Prompt</label>
                            <div style="display:flex;gap:8px;margin-bottom:6px;">
                                <button type="button" class="btn btn-primary" id="importListReformatOllamaBtn" onclick="runImportListReformatWithOllama()">Générer avec Ollama</button>
                            </div>
                            <textarea id="importListReformatPrompt" readonly style="width:100%;height:100px;font-size:12px;border:1px solid var(--color-border);border-radius:8px;padding:8px;resize:vertical;"></textarea>
                            <label class="import-reformat-label" style="margin-top:12px;">Résultat (réponse Ollama ou une valeur par ligne)</label>
                            <textarea id="importListReformatPaste" placeholder="Collez ici la réponse de l'IA (une valeur par ligne, même ordre que les données)" style="width:100%;height:120px;font-size:12px;border:1px solid var(--color-border);border-radius:8px;padding:8px;resize:vertical;"></textarea>
                            <div style="display:flex;gap:10px;margin-top:12px;">
                                <button type="button" class="btn btn-primary" onclick="applyImportListReformat()">Appliquer</button>
                                <button type="button" class="btn btn-secondary" onclick="closeImportListReformatModal()">Annuler</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="modalImportListReformatAll" class="modal" style="z-index:1150;">
                    <div class="modal-content" style="max-width:600px;">
                        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                            <span>🤖 Reformater plusieurs colonnes avec l'IA</span>
                            <button type="button" class="btn btn-secondary" onclick="closeImportListReformatAllModal()" style="padding:4px 10px;">✕</button>
                        </div>
                        <div class="modal-body">
                            <p class="muted" style="font-size:12px;margin-bottom:12px;">Sélectionnez les colonnes à reformater en une seule fois. Ollama normalisera toutes les colonnes sélectionnées.</p>
                            <div id="importListReformatAllCheckboxes" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;"></div>
                            <div style="display:flex;gap:10px;margin-top:12px;">
                                <button type="button" class="btn btn-primary" id="importListReformatAllOllamaBtn" onclick="runImportListReformatAllWithOllama()">Générer avec Ollama</button>
                                <button type="button" class="btn btn-secondary" onclick="closeImportListReformatAllModal()">Annuler</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(div.firstElementChild);

    document.getElementById('importListFileExcel').addEventListener('change', function(e) {
        const f = e.target.files && e.target.files[0];
        if (f) parseImportListExcel(f);
        e.target.value = '';
    });
    document.getElementById('importListFileCsv').addEventListener('change', function(e) {
        const f = e.target.files && e.target.files[0];
        if (f) parseImportListCsvFile(f);
        e.target.value = '';
    });
    document.querySelectorAll('.import-list-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.import-list-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.import-list-pane').forEach(p => p.classList.remove('active'));
            this.classList.add('active');
            const tabName = this.getAttribute('data-tab');
            const pane = document.getElementById('importListPane' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
            if (pane) { pane.style.display = ''; pane.classList.add('active'); }
            ['importListPaneExcel','importListPaneCsv','importListPanePaste','importListPaneIa'].forEach(id => {
                const el = document.getElementById(id);
                if (el && !el.classList.contains('active')) el.style.display = 'none';
            });
        });
    });
}

function openImportListModal() {
    _ensureImportListModal();
    _importListRaw = null;
    _importListMapping = null;
    _importListWorkbook = null;
    const sheetBox = document.getElementById('importListExcelSheetChoice');
    if (sheetBox) sheetBox.style.display = 'none';
    document.getElementById('importListStepChoice').style.display = '';
    document.getElementById('importListStepMapping').style.display = 'none';
    document.getElementById('importListStepPreview').style.display = 'none';
    const modal = document.getElementById('modalImportList');
    if (modal) {
        if (window.openModal) {
            window.openModal(modal);
        } else {
            modal.classList.add('active');
        }
    }
}

function closeImportListModal() {
    const modal = document.getElementById('modalImportList');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
}

function importListBackToChoice() {
    document.getElementById('importListStepMapping').style.display = 'none';
    document.getElementById('importListStepChoice').style.display = '';
}

function importListBackToMapping() {
    document.getElementById('importListStepPreview').style.display = 'none';
    document.getElementById('importListStepMapping').style.display = '';
}

function _detectSeparator(firstLine) {
    if (firstLine.includes('\t') && (firstLine.match(/\t/g) || []).length >= (firstLine.match(/[;,]/g) || []).length)
        return '\t';
    const semi = (firstLine.match(/;/g) || []).length;
    const comma = (firstLine.match(/,/g) || []).length;
    return semi >= comma ? ';' : ',';
}

/** options: { separator?: string } — 'auto', ';', ',', '\\t' ou non fourni = auto */
function _parseCsvText(text, options) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return null;
    let sep = (options && options.separator && options.separator !== 'auto') ? options.separator : _detectSeparator(lines[0]);
    if (sep === '\\t') sep = '\t';
    const headers = _parseCsvLine(lines[0], sep);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = _parseCsvLine(lines[i], sep);
        if (cells.some(c => c)) rows.push(cells);
    }
    return { headers, rows };
}

function _parseCsvLine(line, sep) {
    const cells = [];
    let cur = '', inQuotes = false;
    for (let j = 0; j < line.length; j++) {
        const c = line[j];
        if (c === '"' || c === "'") inQuotes = !inQuotes;
        else if (c === sep && !inQuotes) { cells.push(cur.replace(/^["']|["']$/g, '').trim()); cur = ''; }
        else cur += c;
    }
    cells.push(cur.replace(/^["']|["']$/g, '').trim());
    return cells;
}

function _excelSheetToRaw(wb, sheetName) {
    const sh = wb.Sheets[sheetName];
    if (!sh) return null;
    const data = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
    if (!data.length) return null;
    const headers = data[0].map(h => String(h || '').trim());
    const rows = data.slice(1).filter(row => row.some(c => String(c || '').trim())).map(row => {
        const r = [];
        for (let i = 0; i < headers.length; i++) r.push(String(row[i] != null ? row[i] : '').trim());
        return r;
    });
    return { headers, rows };
}

function parseImportListExcel(file) {
    if (typeof XLSX === 'undefined') { showToast('Bibliothèque Excel non chargée.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            _importListWorkbook = wb;
            const names = wb.SheetNames || [];
            if (names.length === 0) { showToast('Fichier Excel sans feuille.', 'warning'); return; }
            if (names.length === 1) {
                const raw = _excelSheetToRaw(wb, names[0]);
                if (!raw || !raw.rows.length) { showToast('Feuille vide.', 'warning'); return; }
                _importListRaw = raw;
                _importListWorkbook = null;
                showImportListMapping();
                return;
            }
            const box = document.getElementById('importListExcelSheetChoice');
            const sel = document.getElementById('importListExcelSheetSelect');
            if (box && sel) {
                sel.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
                box.style.display = '';
            }
        } catch (err) {
            showToast('Erreur lecture Excel: ' + (err.message || err), 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function applyImportListExcelSheetChoice() {
    const sel = document.getElementById('importListExcelSheetSelect');
    if (!_importListWorkbook || !sel) return;
    const sheetName = sel.value;
    const raw = _excelSheetToRaw(_importListWorkbook, sheetName);
    _importListWorkbook = null;
    const box = document.getElementById('importListExcelSheetChoice');
    if (box) box.style.display = 'none';
    if (!raw || !raw.rows.length) { showToast('Feuille vide.', 'warning'); return; }
    _importListRaw = raw;
    showImportListMapping();
}

function parseImportListCsvFile(file) {
    const encEl = document.getElementById('importListCsvEncoding');
    const sepEl = document.getElementById('importListCsvSeparator');
    const encoding = (encEl && encEl.value) ? encEl.value : 'utf-8';
    let sep = (sepEl && sepEl.value) ? sepEl.value : 'auto';
    if (sep === 'auto') sep = null;
    const options = sep ? { separator: sep } : {};
    const reader = new FileReader();
    reader.onload = function(e) {
        const raw = _parseCsvText(e.target.result, options);
        if (!raw || !raw.rows.length) { showToast('CSV vide ou invalide.', 'warning'); return; }
        _importListRaw = raw;
        showImportListMapping();
    };
    reader.onerror = function() { showToast('Erreur de lecture du fichier (encodage ?).', 'error'); };
    reader.readAsText(file, encoding);
}

function parseImportListPaste() {
    const text = document.getElementById('importListPasteArea').value.trim();
    const raw = _parseCsvText(text, {}); // séparateur auto
    if (!raw || !raw.rows.length) { showToast('Collez au moins une ligne d\'en-têtes et une ligne de données.', 'warning'); return; }
    _importListRaw = raw;
    showImportListMapping();
}

function _guessMapping(header) {
    const h = (header || '').toLowerCase().trim();
    if (/prénom|prenom|firstname|first\.name/.test(h)) return 'prenom';
    if (/(^nom$|^name$|contact)/.test(h) && !/société|company|entreprise|groupe|commentaire/.test(h)) return 'name';
    if (/entreprise|société|company|groupe|client/.test(h)) return 'groupe';
    if (/site|ville|city|adresse|filiale/.test(h)) return 'site';
    if (/fonction|poste|role|titre/.test(h)) return 'fonction';
    if (/tél|tel|telephone|phone|mobile|portable/.test(h)) return 'telephone';
    if (/mail|email|e-mail/.test(h)) return 'email';
    if (/linkedin|linked\.in/.test(h)) return 'linkedin';
    if (/note|commentaire/.test(h)) return 'notes';
    if (/tag|compétence|competence/.test(h)) return 'tags';
    if (/pertinence|score/.test(h)) return 'pertinence';
    if (/statut|status|action/.test(h)) return 'statut';
    if (/date.*dernier\.?contact|dernier\.?contact|last\.?contact/.test(h)) return 'lastContact';
    return '';
}

function showImportListMapping() {
    if (!_importListRaw) return;
    document.getElementById('importListStepChoice').style.display = 'none';
    document.getElementById('importListStepMapping').style.display = '';
    const grid = document.getElementById('importListMappingGrid');
    _importListMapping = {};
    grid.innerHTML = _importListRaw.headers.map((h, i) => {
        const guessed = _guessMapping(h);
        let opts = IMPORT_LIST_FIELDS.map(f => `<option value="${f.value}"${f.value === guessed ? ' selected' : ''}>${f.label}</option>`).join('');
        return `<div class="import-list-mapping-row"><label>${escapeHtml(h) || 'Colonne ' + (i+1)}</label><select class="import-list-map-select" data-col="${i}">${opts}</select></div>`;
    }).join('');
}

async function suggestImportListMappingWithOllama() {
    if (!_importListRaw || !_importListRaw.headers.length) return;
    const headers = _importListRaw.headers;
    const fieldsList = 'name, prenom, groupe, site, fonction, telephone, email, linkedin, notes, tags, pertinence, statut, lastContact';
    
    // Enrichir le prompt avec des exemples de formats variés
    const examples = [
        '{"NOM":"name","PRENOM":"prenom","GROUPE":"groupe","SITE":"site","FONCTION":"fonction","TEL":"telephone","PORTABLE":"telephone","MAIL":"email","COMMENTAIRE":"notes","LINKEDIN":"linkedin","ACTION":"statut","DATE DERNIER CONTACT":"lastContact"}',
        '{"Nom complet":"name","Société":"groupe","Ville":"site","Poste":"fonction","Téléphone":"telephone","Email":"email","Notes":"notes","Statut":"statut"}',
        '{"Contact":"name","Entreprise":"groupe","Localisation":"site","Fonction":"fonction","Tel":"telephone","E-mail":"email","Remarques":"notes","État":"statut"}',
        '{"FIRSTNAME":"prenom","LASTNAME":"name","COMPANY":"groupe","CITY":"site","ROLE":"fonction","PHONE":"telephone","EMAIL":"email","NOTES":"notes","STATUS":"statut"}'
    ];
    
    const prompt = `Tu es un assistant expert en mapping de données Excel pour un CRM de prospection B2B.

Voici les en-têtes de colonnes d'un fichier Excel d'import de prospects : ${JSON.stringify(headers)}

Tu dois retourner un objet JSON unique dont :
- Les clés sont exactement ces en-têtes (une par colonne, respecte la casse et les accents)
- Les valeurs sont exactement un des champs suivants (ou chaîne vide "" pour ignorer) : ${fieldsList}

Règles importantes :
- "name" = nom complet ou nom de famille (peut être combiné avec "prenom")
- "prenom" = prénom (peut être combiné avec "name" pour former le nom complet)
- "groupe" = nom de l'entreprise/société
- "site" = ville/localisation/filiale
- "telephone" = numéro de téléphone (peut être plusieurs colonnes fusionnées : TEL, PORTABLE, MOBILE, etc.)
- "email" = adresse email (MAIL, E-MAIL, EMAIL, etc.)
- "fonction" = poste/rôle/titre
- "notes" = commentaires/remarques/observations
- "statut" = statut/action/état
- "lastContact" = date dernier contact (peut être en format varié)

Exemples de mappings corrects :
${examples.join('\n')}

Réponds UNIQUEMENT avec le JSON, sans texte avant ou après, sans markdown, sans explications.`;
    
    const btn = document.getElementById('importListSuggestOllamaBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Génération…'; }
    try {
        const text = await callOllama(prompt);
        let jsonStr = (text || '').trim();
        // Extraire le JSON même s'il y a du texte autour
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];
        const mapping = JSON.parse(jsonStr);
        const headerToIndex = {};
        headers.forEach((h, i) => { headerToIndex[h] = i; });
        let applied = 0;
        Object.keys(mapping).forEach(header => {
            const field = mapping[header];
            const idx = headerToIndex[header];
            if (idx === undefined || !field) return;
            const select = document.querySelector(`.import-list-map-select[data-col="${idx}"]`);
            if (select && IMPORT_LIST_FIELDS.some(f => f.value === field)) {
                select.value = field;
                applied++;
            }
        });
        if (applied > 0) {
            showToast(`Mapping suggéré appliqué (${applied} colonne(s)). Vérifiez puis cliquez Aperçu.`, 'success', 4000);
        } else {
            showToast('Aucun mapping valide trouvé. Vérifiez manuellement.', 'warning', 4000);
        }
    } catch (e) {
        console.error('Erreur mapping Ollama:', e);
        showToast('Ollama indisponible ou réponse invalide. Vérifiez le mapping manuellement.', 'warning', 5000);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Suggérer le mapping avec Ollama'; }
    }
}

function _detectDataIssues(previewRows) {
    /** Détecte les problèmes de données dans l'aperçu et suggère des actions. */
    const issues = [];
    
    // Vérifier les emails invalides
    const emailRows = previewRows.filter(r => r.email && r.email.trim());
    if (emailRows.length > 0) {
        const invalidEmails = emailRows.filter(r => {
            const email = r.email.trim();
            return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        });
        if (invalidEmails.length > 0) {
            issues.push({
                field: 'email',
                count: invalidEmails.length,
                message: `${invalidEmails.length} email(s) invalide(s) détecté(s)`,
                severity: 'warning'
            });
        }
    }
    
    // Vérifier les téléphones mal formatés
    const phoneRows = previewRows.filter(r => r.telephone && r.telephone.trim());
    if (phoneRows.length > 0) {
        const invalidPhones = phoneRows.filter(r => {
            const phone = r.telephone.trim().replace(/\s+/g, '');
            // Format français : 10 chiffres commençant par 0, ou international
            return !/^(0[1-9]|(\+33|0033)[1-9])\d{8,9}$/.test(phone);
        });
        if (invalidPhones.length > phoneRows.length * 0.3) { // Si plus de 30% sont invalides
            issues.push({
                field: 'telephone',
                count: invalidPhones.length,
                message: `${invalidPhones.length} téléphone(s) avec format suspect`,
                severity: 'info'
            });
        }
    }
    
    // Vérifier les noms vides ou suspects
    const nameRows = previewRows.filter(r => r.name && r.name.trim());
    if (nameRows.length < previewRows.length * 0.5) {
        issues.push({
            field: 'name',
            count: previewRows.length - nameRows.length,
            message: `${previewRows.length - nameRows.length} prospect(s) sans nom`,
            severity: 'warning'
        });
    }
    
    // Vérifier les entreprises vides
    const groupeRows = previewRows.filter(r => r.groupe && r.groupe.trim());
    if (groupeRows.length < previewRows.length * 0.3) {
        issues.push({
            field: 'groupe',
            count: previewRows.length - groupeRows.length,
            message: `${previewRows.length - groupeRows.length} prospect(s) sans entreprise`,
            severity: 'info'
        });
    }
    
    return issues;
}

function importListGoPreview() {
    if (!_importListRaw) return;
    const selects = document.querySelectorAll('.import-list-map-select');
    _importListMapping = {};
    selects.forEach(s => {
        const col = parseInt(s.dataset.col, 10);
        const field = s.value;
        if (field) {
            if (!_importListMapping[field]) _importListMapping[field] = [];
            _importListMapping[field].push(col);
        }
    });
    const hasName = (_importListMapping.name && _importListMapping.name.length) || (_importListMapping.prenom && _importListMapping.prenom.length);
    if (!hasName && !(_importListMapping.groupe && _importListMapping.groupe.length)) {
        showToast('Associez au moins la colonne « Nom » ou « Prénom » ou « Entreprise ».', 'warning');
        return;
    }
    const previewRows = _importListRaw.rows.map(row => {
        const o = {};
        for (const [field, cols] of Object.entries(_importListMapping)) {
            const vals = cols.map(c => (row[c] != null && String(row[c]).trim() !== '') ? String(row[c]).trim() : null).filter(Boolean);
            o[field] = vals.join(' ; ').trim();
        }
        o.name = [o.prenom, o.name].filter(Boolean).join(' ').trim() || o.name || o.prenom || '';
        return o;
    }).filter(o => (o.name || '').trim() || (o.groupe || '').trim());
    window._importListPreviewRows = previewRows;
    document.getElementById('importListPreviewCount').textContent = previewRows.length;
    _renderImportListPreviewTable();
    
    // Détecter les problèmes de données
    const issues = _detectDataIssues(previewRows);
    const issuesHtml = issues.length > 0 ? `<div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:8px;padding:10px;margin-bottom:10px;font-size:12px;"><strong>💡 Suggestions d'amélioration :</strong><ul style="margin:8px 0 0 0;padding-left:20px;">${issues.map(i => `<li style="margin:4px 0;">${i.message} — <button type="button" class="btn btn-secondary" style="font-size:11px;padding:2px 6px;" onclick="openImportListReformatModal('${i.field}')">Reformater ${(IMPORT_LIST_FIELDS.find(f => f.value === i.field) || {}).label || i.field}</button></li>`).join('')}</ul></div>` : '';
    
    const reformatCols = ['name', 'groupe', 'fonction', 'telephone', 'email'];
    const btns = document.getElementById('importListReformatButtons');
    btns.innerHTML = issuesHtml + reformatCols.map(c => {
        const label = (IMPORT_LIST_FIELDS.find(f => f.value === c) || {}).label || c;
        const hasIssue = issues.some(i => i.field === c);
        return `<button type="button" class="btn ${hasIssue ? 'btn-warning' : 'btn-secondary'}" style="font-size:12px;padding:4px 10px;" onclick="openImportListReformatModal('${c}')">🤖 Reformater ${label}${hasIssue ? ' ⚠️' : ''}</button>`;
    }).join('');
    
    // Afficher le bouton de reformatage multi-colonnes si plusieurs colonnes ont des données
    const hasMultipleFields = reformatCols.filter(c => previewRows.some(r => r[c] && r[c].trim())).length > 1;
    const reformatAllBtn = document.getElementById('importListReformatAllBtn');
    if (reformatAllBtn) {
        reformatAllBtn.style.display = hasMultipleFields ? '' : 'none';
    }
    
    document.getElementById('importListStepMapping').style.display = 'none';
    document.getElementById('importListStepPreview').style.display = '';
}

function _renderImportListPreviewTable() {
    const previewRows = window._importListPreviewRows;
    if (!previewRows || !previewRows.length) return;
    const table = document.getElementById('importListPreviewTable');
    if (!table) return;
    const cols = ['name', 'groupe', 'fonction', 'telephone', 'email', 'statut', 'lastContact'];
    table.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr>${cols.map(c => `<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--color-border);">${(IMPORT_LIST_FIELDS.find(f => f.value === c) || {}).label || c}</th>`).join('')}</tr></thead><tbody>${previewRows.slice(0, 50).map(r => `<tr>${cols.map(c => `<td style="padding:6px 8px;border-bottom:1px solid var(--color-border);">${escapeHtml((r[c] || '').slice(0, 40))}</td>`).join('')}</tr>`).join('')}</tbody></table>${previewRows.length > 50 ? `<p class="muted" style="padding:8px;">… et ${previewRows.length - 50} autre(s)</p>` : ''}`;
}

const _IMPORT_REFORMAT_PROMPTS = {
    name: 'Tu es un assistant. Normalise les données suivantes pour qu\'elles soient des **noms de personnes** (Prénom Nom, sans titre, sans entreprise). Réponds uniquement avec une valeur par ligne, dans le même ordre, sans numérotation. Données :',
    groupe: 'Tu es un assistant. Normalise les données suivantes pour qu\'elles soient des **noms d\'entreprises** (raison sociale, pas de sigle seul si tu peux l’écrire en entier). Une valeur par ligne, même ordre, sans numérotation. Données :',
    fonction: 'Tu es un assistant. Normalise les données suivantes pour qu\'elles soient des **intitulés de poste / fonctions** (ex: Directeur technique, Ingénieur R&D). Une valeur par ligne, même ordre, sans numérotation. Données :',
    telephone: 'Tu es un assistant. Normalise les numéros de téléphone suivants (format français 0X XX XX XX XX ou international). Une valeur par ligne, même ordre. Données :',
    email: 'Tu es un assistant. Vérifie et normalise les adresses email suivantes (une par ligne, même ordre). Données :'
};

function openImportListReformatModal(field) {
    const rows = window._importListPreviewRows;
    if (!rows || !rows.length) return;
    window._importListReformatField = field;
    const label = (IMPORT_LIST_FIELDS.find(f => f.value === field) || {}).label || field;
    document.getElementById('importListReformatTitle').textContent = 'Reformater : ' + label;
    const values = rows.map(r => (r[field] || '').trim() || '(vide)');
    const promptText = (_IMPORT_REFORMAT_PROMPTS[field] || 'Normalise les données suivantes (une valeur par ligne, même ordre). Données :') + '\n\n' + values.join('\n');
    document.getElementById('importListReformatPrompt').value = promptText;
    document.getElementById('importListReformatPaste').value = '';
    const modal = document.getElementById('modalImportListReformat');
    if (modal) {
        if (window.openModal) {
            window.openModal(modal, { focusElement: 'textarea' });
        } else {
            modal.classList.add('active');
        }
    }
}

async function runImportListReformatWithOllama() {
    const prompt = document.getElementById('importListReformatPrompt').value;
    if (!prompt) return;
    const btn = document.getElementById('importListReformatOllamaBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Génération…'; }
    try {
        const text = await callOllama(prompt);
        document.getElementById('importListReformatPaste').value = text || '';
    } catch (e) {
        showToast('Ollama indisponible. Collez manuellement le résultat ci-dessous.', 'warning', 5000);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Générer avec Ollama'; }
    }
}

function closeImportListReformatModal() {
    const modal = document.getElementById('modalImportListReformat');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
    window._importListReformatField = null;
}

function applyImportListReformat() {
    const field = window._importListReformatField;
    const rows = window._importListPreviewRows;
    if (!field || !rows || !rows.length) return;
    const paste = (document.getElementById('importListReformatPaste').value || '').trim();
    const lines = paste.split(/\r?\n/).map(l => l.replace(/^\d+[.)\s\-]+/, '').trim());
    if (lines.length < rows.length) {
        showToast('Pas assez de lignes (attendu ' + rows.length + ', reçu ' + lines.length + ').', 'warning');
        return;
    }
    rows.forEach((r, i) => { r[field] = (lines[i] || '').trim(); });
    _renderImportListPreviewTable();
    closeImportListReformatModal();
    showToast('Colonne mise à jour. Vérifiez l’aperçu puis importez.', 'success');
}

function openImportListReformatAllModal() {
    const rows = window._importListPreviewRows;
    if (!rows || !rows.length) return;
    const modal = document.getElementById('modalImportListReformatAll');
    if (!modal) return;
    const checkboxes = document.getElementById('importListReformatAllCheckboxes');
    const reformatCols = ['name', 'groupe', 'fonction', 'telephone', 'email'];
    checkboxes.innerHTML = reformatCols.map(c => {
        const label = (IMPORT_LIST_FIELDS.find(f => f.value === c) || {}).label || c;
        const hasData = rows.some(r => r[c] && r[c].trim());
        return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" value="${c}" ${hasData ? 'checked' : ''} style="cursor:pointer;"> ${label}${hasData ? '' : ' <span class="muted">(vide)</span>'}</label>`;
    }).join('');
    if (window.openModal) window.openModal(modal); else modal.classList.add('active');
}

function closeImportListReformatAllModal() {
    const modal = document.getElementById('modalImportListReformatAll');
    if (modal) {
        if (window.closeModal) window.closeModal(modal); else modal.classList.remove('active');
    }
}

async function runImportListReformatAllWithOllama() {
    const rows = window._importListPreviewRows;
    if (!rows || !rows.length) return;
    const checkboxes = document.querySelectorAll('#importListReformatAllCheckboxes input[type="checkbox"]:checked');
    const selectedFields = Array.from(checkboxes).map(cb => cb.value);
    if (selectedFields.length === 0) {
        showToast('Sélectionnez au moins une colonne à reformater.', 'warning');
        return;
    }
    const btn = document.getElementById('importListReformatAllOllamaBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Génération…'; }
    try {
        const fieldLabels = selectedFields.map(f => (IMPORT_LIST_FIELDS.find(fld => fld.value === f) || {}).label || f);
        const prompts = selectedFields.map(f => _IMPORT_REFORMAT_PROMPTS[f] || `Normalise les données suivantes pour le champ "${(IMPORT_LIST_FIELDS.find(fld => fld.value === f) || {}).label || f}" (une valeur par ligne, même ordre). Données :`);
        const combinedPrompt = `Tu es un assistant. Normalise les données suivantes pour ${selectedFields.length} colonne(s) : ${fieldLabels.join(', ')}.\n\nPour chaque colonne, je vais te donner les données à normaliser. Réponds avec un JSON où chaque clé est le nom du champ et la valeur est un tableau de valeurs normalisées (une par ligne, dans le même ordre).\n\n${selectedFields.map((f, i) => {
            const values = rows.map(r => (r[f] || '').trim() || '(vide)');
            return `Colonne "${fieldLabels[i]}" :\n${prompts[i]}\n${values.join('\n')}`;
        }).join('\n\n')}\n\nRéponds avec un JSON de cette forme :\n{\n  "${selectedFields[0]}": ["valeur1", "valeur2", ...],\n  ${selectedFields.slice(1).map(f => `"${f}": ["valeur1", "valeur2", ...]`).join(',\n  ')}\n}`;
        const text = await callOllama(combinedPrompt);
        let jsonStr = (text || '').trim();
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];
        const result = JSON.parse(jsonStr);
        let applied = 0;
        selectedFields.forEach(field => {
            if (result[field] && Array.isArray(result[field])) {
                const values = result[field];
                if (values.length >= rows.length) {
                    rows.forEach((r, i) => { r[field] = (values[i] || '').trim(); });
                    applied++;
                }
            }
        });
        if (applied > 0) {
            _renderImportListPreviewTable();
            closeImportListReformatAllModal();
            showToast(`${applied} colonne(s) reformatée(s). Vérifiez l'aperçu puis importez.`, 'success', 5000);
        } else {
            showToast('Aucune colonne reformatée. Vérifiez le format de la réponse Ollama.', 'warning');
        }
    } catch (e) {
        console.error('Erreur reformatage multi-colonnes:', e);
        showToast('Ollama indisponible ou réponse invalide. Reformatez colonne par colonne.', 'warning', 5000);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Générer avec Ollama'; }
    }
}

function applyImportList() {
    const rows = window._importListPreviewRows;
    if (!rows || !rows.length) { showToast('Aucune ligne à importer.', 'warning'); return; }
    const unassignedId = ensureUnassignedCompany();
    const companyByKey = new Map();
    data.companies.forEach(c => { companyByKey.set((c.groupe || '').trim().toLowerCase() + '|' + (c.site || '').trim().toLowerCase(), c); });
    const localMaxCompanyId = Math.max(...data.companies.map(c => Number(c.id) || 0), 0);
    const localMaxProspectId = Math.max(...data.prospects.map(p => Number(p.id) || 0), 0);
    const baseMaxCompanyId = Number.isFinite(_globalMaxCompanyId) ? Math.max(Number(_globalMaxCompanyId) || 0, localMaxCompanyId) : localMaxCompanyId;
    const baseMaxProspectId = Number.isFinite(_globalMaxProspectId) ? Math.max(Number(_globalMaxProspectId) || 0, localMaxProspectId) : localMaxProspectId;
    let newCompanyId = baseMaxCompanyId + 1;
    let created = 0;
    let lastCreatedProspectId = baseMaxProspectId;
    rows.forEach((row, i) => {
        const groupe = (row.groupe || '').trim() || 'Sans entreprise';
        const site = (row.site || '').trim() || '';
        const key = groupe.toLowerCase() + '|' + site.toLowerCase();
        let companyId = unassignedId;
        if (groupe && groupe !== 'Sans entreprise') {
            let company = companyByKey.get(key);
            if (!company) {
                company = { id: newCompanyId, groupe, site, phone: 'Non disponible', notes: '', tags: [] };
                data.companies.push(company);
                companyByKey.set(key, company);
                newCompanyId++;
            }
            companyId = company.id;
        }
        const name = (row.name || '').trim() || 'Sans nom';
        const tags = (row.tags || '').trim() ? (row.tags || '').split(/[,;]/).map(t => t.trim()).filter(Boolean) : [];
        const newProspectId = baseMaxProspectId + 1 + i;
        const lastContactVal = (row.lastContact || '').trim();
        const p = {
            id: newProspectId,
            name,
            company_id: companyId,
            fonction: (row.fonction || '').trim(),
            telephone: (row.telephone || '').trim(),
            email: (row.email || '').trim(),
            linkedin: (row.linkedin || '').trim(),
            pertinence: (row.pertinence || '3').replace(/[⭐*]/g, '').trim() || '3',
            statut: (row.statut || '').trim() || "Pas d'actions",
            lastContact: lastContactVal || todayISO(),
            nextFollowUp: '',
            priority: 2,
            notes: (row.notes || '').trim(),
            callNotes: [],
            pushEmailSentAt: '',
            tags: Array.isArray(tags) ? tags : (typeof tags === 'string' ? [tags] : []),
            template_id: null,
            nextAction: '',
            pushLinkedInSentAt: '',
            photo_url: '',
            push_category_id: null,
            fixedMetier: '',
            rdvDate: '',
            is_contact: 0,
        };
        data.prospects.push(p);
        created++;
        lastCreatedProspectId = newProspectId;
    });
    if (created > 0) _globalMaxProspectId = Math.max(Number(_globalMaxProspectId) || 0, lastCreatedProspectId);
    _globalMaxCompanyId = Math.max(Number(_globalMaxCompanyId) || 0, newCompanyId - 1);
    closeImportListModal();
    saveToServerAsync().then(() => {
        normalizeData();
        filterProspects();
        renderProspects();
        populateCompanySelects();
        showToast(`✅ ${created} prospect(s) importé(s). Retrouvez votre liste ci-dessous.`, 'success', 6000);
    }).catch(err => showToast('Erreur sauvegarde: ' + (err && err.message), 'error'));
}

// ====== Onboarding : popup bienvenue + visite guidée (nouveaux utilisateurs) ======
const ONBOARDING_STEPS = [
    { id: 'welcome', title: 'Bienvenue sur Prosp\'Up', icon: '👋', body: 'Votre CRM pour la prospection B2B et le sourcing. Tout au même endroit : prospects, relances, RDV et candidats.' },
    { id: 'prospects', title: 'Vos prospects', icon: '👥', body: 'Cette page liste tous vos contacts. Recherchez, filtrez par entreprise ou statut, et cliquez sur une ligne pour ouvrir la fiche détaillée.' },
    { id: 'import', title: 'Importer ou ajouter', icon: '📥', body: 'Importez votre liste Excel ou CSV en un clic, ou ajoutez des prospects un par un. Le bouton « + Prospect » en bas à droite ouvre le formulaire d\'ajout.' },
    { id: 'focus', title: 'Focus & relances', icon: '🎯', body: 'La page Focus affiche les prospects à relancer et les RDV à venir. Idéal pour prioriser vos actions du jour.' },
    { id: 'dashboard', title: 'Dashboard', icon: '📊', body: 'Le Dashboard résume votre activité : KPIs, prochaines actions, objectifs. Parfait pour un coup d\'œil le matin.' },
    { id: 'actions', title: 'Prêt à démarrer ?', icon: '🚀', body: 'Importez votre liste existante ou ajoutez votre premier prospect. Vous pourrez toujours accéder au guide depuis Aide.' }
];

function _ensureOnboardingModal() {
    if (document.getElementById('onboardingModal')) return;
    const name = (AppAuth.user && (AppAuth.user.display_name || AppAuth.user.username)) ? (AppAuth.user.display_name || AppAuth.user.username).split(/\s+/)[0] : '';
    const welcomeTitle = name ? `Bienvenue, ${name} !` : 'Bienvenue sur Prosp\'Up !';
    const div = document.createElement('div');
    div.id = 'onboardingModal';
    div.className = 'modal onboarding-modal';
    div.innerHTML = `
    <div class="modal-content onboarding-modal-content">
        <button type="button" class="onboarding-close" onclick="closeOnboardingModal(false)" title="Fermer">×</button>
        <div id="onboardingSlide" class="onboarding-slide">
            <div class="onboarding-step-icon" id="onboardingStepIcon">👋</div>
            <h2 class="onboarding-step-title" id="onboardingStepTitle">${welcomeTitle}</h2>
            <p class="onboarding-step-body" id="onboardingStepBody">Votre CRM pour la prospection B2B et le sourcing. Tout au même endroit : prospects, relances, RDV et candidats.</p>
            <div class="onboarding-progress" id="onboardingProgress"></div>
            <div class="onboarding-actions">
                <button type="button" class="btn btn-secondary" id="onboardingBtnPrev" onclick="onboardingPrev()" style="display:none;">← Précédent</button>
                <button type="button" class="btn btn-primary" id="onboardingBtnNext" onclick="onboardingNext()">Suivant →</button>
                <div id="onboardingFinalActions" style="display:none;">
                    <button type="button" class="btn btn-primary" onclick="onboardingDoneThenRedirect('/?openImport=1');">📥 Importer ma liste</button>
                    <button type="button" class="btn btn-primary" onclick="onboardingDoneThenRedirect('/?add=1');">➕ Ajouter un prospect</button>
                    <a href="/help" class="btn btn-secondary" onclick="event.preventDefault(); closeOnboardingModal(true); window.location.href='/help';">Je découvrirai plus tard</a>
                </div>
            </div>
            <label class="onboarding-dont-show"><input type="checkbox" id="onboardingDontShow"> Ne plus afficher cette visite</label>
        </div>
    </div>`;
    document.body.appendChild(div);
    window.__onboardingStep = 0;
    window.__onboardingTotalSteps = ONBOARDING_STEPS.length;
}

function _renderOnboardingStep(index) {
    const isWelcome = index === 0;
    const name = (AppAuth.user && (AppAuth.user.display_name || AppAuth.user.username)) ? (AppAuth.user.display_name || AppAuth.user.username).split(/\s+/)[0] : '';
    const welcomeTitle = name ? `Bienvenue, ${name} !` : 'Bienvenue sur Prosp\'Up !';
    const step = ONBOARDING_STEPS[index];
    const iconEl = document.getElementById('onboardingStepIcon');
    const titleEl = document.getElementById('onboardingStepTitle');
    const bodyEl = document.getElementById('onboardingStepBody');
    const btnPrev = document.getElementById('onboardingBtnPrev');
    const btnNext = document.getElementById('onboardingBtnNext');
    const finalActions = document.getElementById('onboardingFinalActions');
    const progressEl = document.getElementById('onboardingProgress');
    if (!iconEl || !titleEl || !bodyEl) return;
    if (isWelcome) {
        titleEl.textContent = welcomeTitle;
        bodyEl.textContent = step.body;
        iconEl.textContent = step.icon;
    } else {
        titleEl.textContent = step.title;
        bodyEl.textContent = step.body;
        iconEl.textContent = step.icon;
    }
    btnPrev.style.display = index <= 0 ? 'none' : '';
    const isLast = index >= ONBOARDING_STEPS.length - 1;
    btnNext.style.display = isLast ? 'none' : '';
    finalActions.style.display = isLast ? 'flex' : 'none';
    if (progressEl) {
        progressEl.innerHTML = ONBOARDING_STEPS.map((_, i) =>
            `<span class="onboarding-dot ${i === index ? 'active' : ''}" role="presentation"></span>`).join('');
    }
    window.__onboardingStep = index;
}

function onboardingNext() {
    const next = (window.__onboardingStep || 0) + 1;
    if (next >= ONBOARDING_STEPS.length) return;
    _renderOnboardingStep(next);
}

function onboardingPrev() {
    const prev = (window.__onboardingStep || 0) - 1;
    if (prev < 0) return;
    _renderOnboardingStep(prev);
}

function closeOnboardingModal(fromButton) {
    const modal = document.getElementById('onboardingModal');
    if (!modal) return;
    modal.classList.remove('active');
    const checkbox = document.getElementById('onboardingDontShow');
    const checked = (checkbox && checkbox.checked) || fromButton;
    if (checked) {
        fetch('/api/auth/onboarding-seen', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(r => r.json()).then(d => { if (d.ok) AppAuth.user && (AppAuth.user.onboarding_seen = 1); }).catch(() => {});
    }
}

function onboardingDoneThenRedirect(url) {
    const modal = document.getElementById('onboardingModal');
    if (modal) modal.classList.remove('active');
    fetch('/api/auth/onboarding-seen', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .then(r => r.json()).then(d => { if (d.ok) AppAuth.user && (AppAuth.user.onboarding_seen = 1); window.location.href = url; })
        .catch(function() { window.location.href = url; });
}

function showOnboardingIfNeeded() {
    if (!AppAuth.user || AppAuth.user.onboarding_seen !== 0) return;
    _ensureOnboardingModal();
    _renderOnboardingStep(0);
    document.getElementById('onboardingModal').classList.add('active');
}

// ====== Bootstrap multi-pages ======
const APP_BUILD = '2026.03.06-01';

function ensureBuildIndicator() {
    try {
        // v23.4: Only show build badge in local/dev environments
        const isProduction = /prospup\.work$/i.test(window.location.hostname);
        if (isProduction) return;

        const indicatorId = 'appBuildIndicator';
        let badge = document.getElementById(indicatorId);
        if (!badge) {
            badge = document.createElement('div');
            badge.id = indicatorId;
            badge.style.position = 'fixed';
            badge.style.left = '10px';
            badge.style.bottom = '10px';
            badge.style.zIndex = '1200';
            badge.style.padding = '3px 8px';
            badge.style.borderRadius = '999px';
            badge.style.fontSize = '11px';
            badge.style.fontFamily = 'monospace';
            badge.style.opacity = '0.6';
            badge.style.pointerEvents = 'none';
            badge.style.background = 'rgba(0,0,0,0.35)';
            badge.style.color = '#e2e8f0';
            badge.style.border = '1px solid rgba(255,255,255,0.12)';
            document.body.appendChild(badge);
        }

        const env = /prospup\.work$/i.test(window.location.hostname) ? 'web' : 'local';
        badge.textContent = `build ${APP_BUILD} · ${env}`;
        badge.title = `Prosp'Up build ${APP_BUILD} (${window.location.hostname})`;
    } catch (e) {}
}

async function bootstrap(page) {
    window.__APP_PAGE__ = page;
    ensureBuildIndicator();

    // Auth init (v15)
    await AppAuth.init();

    await loadFromServer();
    try { await loadTemplatesFromServer(); } catch(e) { console.warn("[Prosp'Up] Templates load failed:", e); }
    try { await loadPushCategories(); } catch(e) { console.warn("[Prosp'Up] Push categories load failed:", e); }
    normalizeData();
    filteredProspects = [...data.prospects];

    // Init listeners (safe, will bind only what exists on the page)
    setupListeners();

    const params = new URLSearchParams(window.location.search);

    if (page === 'prospects') {
        populateCompanySelects();
    try {
        const cid = params.get('company');
        if (cid && document.getElementById('inputCompany')) {
            const sel = document.getElementById('inputCompany');
            sel.value = cid;
        }
    } catch (e) {}

        // ═══ Contacts mode ═══
        if (params.get('contacts') === '1') {
            _showContacts = true;
            const contactsBtn = document.getElementById('sidebarContactsBtn');
            if (contactsBtn) contactsBtn.classList.add('active');
            document.querySelectorAll('.sidebar .nav-button').forEach(btn => {
                if (btn.getAttribute('href') === '/' && btn.id !== 'sidebarContactsBtn') {
                    btn.classList.remove('active');
                }
            });
        }

        applySort();
        filterProspects();
        renderProspects();
        updateBulkBar();
        updateSelectAllState();
        try { initSavedViewsUI(); } catch(e) {}

        // Mode (all/status/actions)
        const mode = params.get('mode');
        if (mode === 'status' || mode === 'actions') switchView(mode);
        else switchView('all');

        // Filtre entreprise depuis la page "Entreprises"
        const companyId = params.get('company');
        if (companyId) {
            const cf = document.getElementById('companyFilter');
            if (cf) {
                cf.value = companyId;
                filterProspects();
            }
        }

        // Ouvrir directement la modal ajout prospect
        if (params.get('add') === '1') {
            openAddModal();
        }

        // Guide nouvel utilisateur : ouvrir la modal "Importer ma liste"
        if (params.get('openImport') === '1') {
            try { history.replaceState(null, '', window.location.pathname + (window.location.hash || '')); } catch (e) {}
            setTimeout(() => openImportListModal(), 300);
        }

        // Ouvrir directement la fiche prospect depuis une autre page (ex: Focus / Recherche)
        const openId = params.get('open');
        if (openId) {
            const pid = parseInt(openId, 10);
            if (!Number.isNaN(pid)) {
                try { await viewDetail(pid); } catch (e) { console.warn(e); }
            }
        }

        // Reprendre automatiquement le Mode Prosp au bon index si session sauvegardée (ex: retour après appel)
        try {
            const raw = sessionStorage.getItem(PROSP_SESSION_STORAGE_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                if (saved && Array.isArray(saved.ids) && saved.ids.length > 0 && saved.currentId != null) {
                    resumeProspSession();
                    if (typeof showToast === 'function') showToast('Session Prosp reprise', 'info');
                }
            }
        } catch (e) {}

    }

    if (page === 'companies') {
        applyCompaniesViewVisibility();
        const openCompanyId = params.get('openCompany');
        const openCompanyMode = params.get('companyMode') === 'edit' ? 'edit' : 'view';
        if (openCompanyId) {
            const cid = parseInt(openCompanyId, 10);
            if (Number.isFinite(cid)) {
                try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
                setTimeout(() => { openCompanySheet(cid, openCompanyMode); }, 80);
            }
        }
        renderCompanies();

        // Ouvrir directement la modal ajout entreprise
        if (params.get('addCompany') === '1') {
            openAddCompanyModal();
        }
    }

    if (page === 'settings') {
        // rien de spécial : les boutons sont en onclick, et l'import JSON est géré par setupListeners()
    }

    // === Global: sidebar badge pour relances en retard (toutes pages) ===
    try { updateOverdueAlerts(data.prospects || []); } catch (e) {}

    // === Popup bienvenue + visite guidée pour nouveaux utilisateurs (onboarding_seen = 0) ===
    setTimeout(function() { showOnboardingIfNeeded(); }, 450);
}

// Expose bootstrap globally so page-*.js can always call it reliably.
// Some browsers treat function declarations inside blocks as block-scoped,
// which can make `bootstrap` undefined from other scripts.
try { window.bootstrap = bootstrap; } catch (e) {}
try { window.appBootstrap = bootstrap; } catch (e) {}
try { window.switchCompaniesView = switchCompaniesView; } catch (e) {}

// ====== Prospect export & navigation helpers ======
function openStatsModal() {
    // le bouton "Stats" sur la page prospects pointe désormais vers /stats
    window.location.href = '/stats';
}
function closeStatsModal() {}

function exportSelectedJSON() {
    if (!selectedProspects || selectedProspects.size === 0) {
        alert("ℹ️ Aucun prospect sélectionné.");
        return;
    }
    const selected = data.prospects.filter(p => selectedProspects.has(p.id));
    const companyIds = new Set(selected.map(p => p.company_id));
    const companies = data.companies.filter(c => companyIds.has(c.id));
    const payload = { companies, prospects: selected };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Prospects_selection_${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportSelectedCSV() {
    if (!selectedProspects || selectedProspects.size === 0) {
        alert("ℹ️ Aucun prospect sélectionné.");
        return;
    }
    const selected = data.prospects.filter(p => selectedProspects.has(p.id));
    const companyById = new Map(data.companies.map(c => [c.id, c]));
    const headers = ["id","name","company","site","fonction","telephone","email","linkedin","pertinence","statut","lastContact","nextFollowUp","priority","notes"];
    const rows = [headers.join(",")];

    // Normaliser sauts de ligne dans les cellules pour éviter décalage des lignes CSV
    const esc = (v) => {
        const s = String(v ?? "").replace(/\r\n|\r|\n/g, " ").trim();
        if (/[",]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    };

    selected.forEach(p => {
        const c = companyById.get(p.company_id) || {};
        rows.push([
            p.id, p.name, c.groupe || "", c.site || "",
            p.fonction || "", p.telephone || "", p.email || "", p.linkedin || "",
            p.pertinence || "", p.statut || "", p.lastContact || "", p.nextFollowUp || "",
            (p.priority ?? ""), (p.notes || "")
        ].map(esc).join(","));
    });

    const blob = new Blob(["\uFEFF" + rows.join("\r\n")], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Prospects_selection_${todayISO()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ===== VCF / vCard export =====

function vcfEscape(str) {
    if (!str) return '';
    // VCF 3.0: escape commas, semicolons, backslashes, newlines
    return String(str)
.replace(/\\/g, '\\\\')
.replace(/;/g, '\\;')
.replace(/,/g, '\\,')
.replace(/\n/g, '\\n');
}

function prospectToVcf(prospect, company) {
    const nameParts = (prospect.name || '').trim().split(/\s+/);
    const lastName = nameParts.length > 1 ? nameParts.pop() : '';
    const firstName = nameParts.join(' ') || prospect.name || '';

    const org = company ? (company.groupe || '') + (company.site ? ' (' + company.site + ')' : '') : '';

    const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'N:' + vcfEscape(lastName) + ';' + vcfEscape(firstName) + ';;;',
        'FN:' + vcfEscape(prospect.name || '')
    ];

    if (org) lines.push('ORG:' + vcfEscape(org));
    if (prospect.fonction) lines.push('TITLE:' + vcfEscape(prospect.fonction));

    if (prospect.telephone) {
        const phones = prospect.telephone.match(/\+?\d[\d\s().\-]{6,}\d/g);
        if (phones) {
            phones.forEach((ph, i) => {
                const type = i === 0 ? 'WORK' : 'CELL';
                lines.push('TEL;TYPE=' + type + ':' + ph.replace(/\s+/g, ' ').trim());
            });
        } else {
            lines.push('TEL;TYPE=WORK:' + prospect.telephone.trim());
        }
    }

    if (prospect.email) lines.push('EMAIL;TYPE=INTERNET:' + prospect.email.trim());
    if (prospect.linkedin) lines.push('URL:' + prospect.linkedin.trim());

    if (prospect.notes) lines.push('NOTE:' + vcfEscape(prospect.notes));

    if (prospect.tags && prospect.tags.length) {
        lines.push('CATEGORIES:' + prospect.tags.map(vcfEscape).join(','));
    }

    lines.push('REV:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z');
    lines.push('END:VCARD');

    return lines.join('\r\n');
}

function downloadVcf(prospectId) {
    const prospect = data.prospects.find(p => p.id === prospectId);
    if (!prospect) return;
    const company = data.companies.find(c => c.id === prospect.company_id);

    const vcf = prospectToVcf(prospect, company);
    const safeName = (prospect.name || 'contact').replace(/[^a-zA-Z0-9àâäéèêëïîôùûüç\s-]/gi, '').replace(/\s+/g, '_');
    const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeName + '.vcf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportSelectedVCF() {
    if (!selectedProspects || selectedProspects.size === 0) {
        alert("ℹ️ Aucun prospect sélectionné.");
        return;
    }
    const selected = data.prospects.filter(p => selectedProspects.has(p.id));
    const companyById = new Map(data.companies.map(c => [c.id, c]));

    const vcfAll = selected.map(p => {
        const c = companyById.get(p.company_id);
        return prospectToVcf(p, c);
    }).join('\r\n');

    const blob = new Blob([vcfAll], { type: 'text/vcard;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Prospects_selection_${todayISO()}.vcf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function resetAllData() {
    if (!confirm("⚠️ ATTENTION : Réinitialiser TOUTES les données ?\n\nCela va :\n• Créer un snapshot de sauvegarde\n• Supprimer la base actuelle\n• Recharger les données du fichier initial (potentiellement ancien)\n\nUtilise plutôt « Restaurer un snapshot » si tu veux revenir à un état précis.")) return;
    if (!confirm("🔴 DERNIÈRE CHANCE : Es-tu vraiment sûr ?\n\nTes données actuelles seront perdues (un snapshot sera créé au cas où).")) return;
    try {
        const res = await fetch('/api/reset', { method: 'POST' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert('❌ Reset impossible: ' + (body.error || ('HTTP ' + res.status)));
            return;
        }
        const seed = body.seed || {};
        if (seed.seeded) {
            alert(`✅ Reset effectué.\n\nSource : ${seed.source}\nDate du fichier : ${seed.source_date}\nEntreprises : ${seed.companies}\nProspects : ${seed.prospects}\n\n⚠️ Un snapshot "before_reset" a été créé.`);
        } else {
            alert('✅ Reset effectué (base vide — aucun fichier source trouvé).\n\n⚠️ Un snapshot "before_reset" a été créé si tu veux revenir en arrière.');
        }
        window.location.reload();
    } catch (e) {
        console.error(e);
        alert("❌ Reset impossible (réseau/serveur).");
    }
}

// ════════════════════════════════════════════════════════════════════
// Unified candidate recommendations – combines tags + push category
// ════════════════════════════════════════════════════════════════════

async function loadUnifiedCandidates(prospectId, tags, pushCategoryId) {
    const listBox = document.getElementById('unifiedCandidateList');
    const section = document.getElementById('candidateMatchSection');
    if (!listBox) return;

    const hasTags = tags && tags.length > 0;
    const hasCat = pushCategoryId && String(pushCategoryId).trim() !== '';

    if (!hasTags && !hasCat) {
        listBox.innerHTML = '<span class="muted">Ajoutez des compétences ou une catégorie push pour voir les candidats recommandés.</span>';
        return;
    }

    listBox.innerHTML = '<span class="muted">🔍 Recherche de candidats…</span>';

    try {
        // Piste 5: one API call with tags + optional push_category_id (backend merges category keywords)
        const qs = pushCategoryId ? `?push_category_id=${encodeURIComponent(pushCategoryId)}` : '';
        const res = await fetch(`/api/prospect/${prospectId}/best-candidates${qs}`);
        let tagCandidates = [];
        let prospectTags = [];
        if (res.ok) {
            const j = await res.json();
            if (j.ok && j.candidates) {
                tagCandidates = j.candidates;
                prospectTags = j.prospect_tags || [];
            }
        }

        if (tagCandidates.length === 0) {
            listBox.innerHTML = '<span class="muted">Aucun candidat correspondant trouvé</span>';
            return;
        }

        // Limiter à 4 candidats maximum (v25.9)
        const limitedCandidates = tagCandidates.slice(0, 4);
        
        // Render with bestmatch cards (pct may be capped; relevance_pct = score-based)
        listBox.innerHTML = limitedCandidates.map((c, idx) => {
            const skills = Array.isArray(c.skills) ? c.skills : [];
            const matchedLower = (c.matched_tags || []).map(t => t.toLowerCase());

            const skillsHtml = skills.slice(0, 10).map(s => {
                const isMatched = matchedLower.includes(s.toLowerCase());
                return `<span class="tag-pill${isMatched ? ' tag-pill-matched' : ''}" style="font-size:10px;padding:2px 7px;">${escapeHtml(s)}</span>`;
            }).join(' ');

            const linkedinBtn = c.linkedin
                ? `<a href="${escapeHtml(c.linkedin)}" target="_blank" class="bestmatch-link" title="Voir LinkedIn" onclick="event.stopPropagation()">🔗</a>`
                : '';
            const phone = (c.phone || '').trim();
            const telBtn = phone
                ? `<a href="tel:${escapeHtml(phone)}" class="bestmatch-tel" title="Appeler" onclick="event.stopPropagation()">📞</a>`
                : '';
            const viewFicheUrl = `/candidate?id=${c.id}`;
            const scoreDetails = [];
            if (c.tag_score) scoreDetails.push(`Tags: ${c.tag_score}`);
            if (c.sector_score) scoreDetails.push(`Secteur: ${c.sector_score}`);
            if (c.exp_score) scoreDetails.push(`XP: ${c.exp_score}`);
            if (c.geo_score) scoreDetails.push(`Géo: ${c.geo_score}`);
            if (c.relevance_pct != null) scoreDetails.push(`Pertinence globale: ${c.relevance_pct}%`);

            return `
                <a href="${viewFicheUrl}" class="bestmatch-card bestmatch-card-link${idx === 0 ? ' bestmatch-top' : ''}" title="Ouvrir la fiche candidat">
                    <div class="bestmatch-header">
                        <div class="bestmatch-name">
                            ${idx === 0 ? '<span class="bestmatch-crown">👑</span>' : ''}
                            <strong>${escapeHtml(c.name)}</strong>
                            ${linkedinBtn}
                            ${telBtn}
                        </div>
                        <span class="bestmatch-score" title="${scoreDetails.join(' · ')}">${c.pct}%</span>
                    </div>
                    <div class="bestmatch-role">${escapeHtml(c.role || '')}${c.location ? ' · 📍 ' + escapeHtml(c.location) : ''}${c.tech ? ' · ' + escapeHtml(c.tech) : ''}</div>
                    <div class="bestmatch-skills">${skillsHtml || '<span class="muted">Aucune compétence renseignée</span>'}</div>
                    <div class="bestmatch-matched">${(c.matched_tags || []).length} compétence${(c.matched_tags || []).length > 1 ? 's' : ''} en commun : ${(c.matched_tags || []).map(t => escapeHtml(t)).join(', ')}</div>
                    <div class="bestmatch-actions"><span class="bestmatch-action-label">Voir la fiche →</span></div>
                </a>`;
        }).join('');
    } catch (e) {
        console.error('unified-candidates error', e);
        listBox.innerHTML = '<span class="muted">Erreur de chargement</span>';
    }
}

// Backward compat
async function loadBestMatchCandidates(prospectId) {
    const prospect = data.prospects.find(p => p.id === prospectId);
    if (prospect) {
        await loadUnifiedCandidates(prospectId, prospect.tags, prospect.push_category_id);
    }
}

// ════════════════════════════════════════════════════════════════════
// RDV Checklist – grille de qualification prospect
// ════════════════════════════════════════════════════════════════════

let _rdvThemes = null;        // cache des thèmes (chargé une fois)
let _rdvData   = {};          // données courantes par key
let _rdvProspectId = null;    // prospect courant
let _rdvSaveTimer = null;     // debounce save

async function _ensureRdvThemes() {
    if (_rdvThemes) return _rdvThemes;
    try {
const res = await fetch('/api/rdv-checklist/themes');
const j = await res.json();
if (j.ok) _rdvThemes = j.themes;
    } catch (e) { console.error('rdv themes error', e); }
    return _rdvThemes || [];
}

async function loadRdvChecklist(prospectId) {
    _rdvProspectId = prospectId;
    const themes = await _ensureRdvThemes();
    try {
const res = await fetch(`/api/rdv-checklist?prospect_id=${prospectId}`);
const j = await res.json();
if (j.ok) _rdvData = j.data || {};
    } catch (e) {
console.error('rdv load error', e);
_rdvData = {};
    }
    _renderRdvChecklist(themes);
    // Charger et afficher les réunions précédentes
    await loadMeetings(prospectId);
    // Afficher le bouton "Enregistrer réunion" si on est sur l'onglet RDV
    const rdvTab = document.getElementById('tab-rdv');
    const saveMeetingBtn = document.getElementById(`btnSaveMeeting_${prospectId}`);
    if (rdvTab && rdvTab.classList.contains('active') && saveMeetingBtn) {
        saveMeetingBtn.style.display = '';
    }
    // Par défaut, afficher la grille actuelle (pas une réunion)
    switchMeetingTab(null, prospectId);
}

function _renderRdvChecklist(themes) {
    const body = document.getElementById('rdvChecklistBody');
    if (!body) return;

    let html = '<table class="rdv-table">';
    html += `<thead><tr>
<th class="rdv-th-check"></th>
<th class="rdv-th-theme">Thème</th>
<th class="rdv-th-question">Question / Info à collecter</th>
<th class="rdv-th-reponse">Notes / Réponses</th>
    </tr></thead><tbody>`;

    themes.forEach(t => {
const d = _rdvData[t.key] || { reponse: '', checked: false };
const checkedClass = d.checked ? ' rdv-row-done' : '';
html += `<tr class="rdv-row${checkedClass}" id="rdvRow_${t.key}">
    <td class="rdv-cell-check">
        <input type="checkbox" class="rdv-checkbox" ${d.checked ? 'checked' : ''}
            onchange="toggleRdvCheck('${t.key}', this.checked)">
    </td>
    <td class="rdv-cell-theme">${escapeHtml(t.theme)}</td>
    <td class="rdv-cell-question">${escapeHtml(t.question)}</td>
    <td class="rdv-cell-reponse">
        <textarea class="rdv-textarea" placeholder="…"
            oninput="updateRdvReponse('${t.key}', this.value)"
            onblur="saveRdvChecklist()">${escapeHtml(d.reponse || '')}</textarea>
    </td>
</tr>`;
    });
    html += '</tbody></table>';
    body.innerHTML = html;
    _updateRdvProgress(themes);
}

function toggleRdvCheck(key, checked) {
    if (!_rdvData[key]) _rdvData[key] = { reponse: '', checked: false };
    _rdvData[key].checked = checked;
    const row = document.getElementById(`rdvRow_${key}`);
    if (row) row.classList.toggle('rdv-row-done', checked);
    _updateRdvProgress(_rdvThemes);
    saveRdvChecklist();
}

function updateRdvReponse(key, val) {
    if (!_rdvData[key]) _rdvData[key] = { reponse: '', checked: false };
    _rdvData[key].reponse = val;
    // debounce auto-save
    clearTimeout(_rdvSaveTimer);
    _rdvSaveTimer = setTimeout(() => saveRdvChecklist(), 1500);
}

async function saveRdvChecklist() {
    if (!_rdvProspectId) return;
    try {
await fetch('/api/rdv-checklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prospect_id: _rdvProspectId, data: _rdvData })
});
    } catch (e) {
console.error('rdv save error', e);
    }
}

function _updateRdvProgress(themes) {
    if (!themes) return;
    const total = themes.length;
    const done = themes.filter(t => _rdvData[t.key]?.checked).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const el = document.getElementById('rdvProgress');
    if (el) el.textContent = `${done} / ${total}`;
    const bar = document.getElementById('rdvProgressBar');
    if (bar) {
bar.style.width = pct + '%';
bar.className = 'rdv-checklist-bar' + (pct === 100 ? ' complete' : '');
    }
}

async function copyRdvChecklist(prospectId) {
    const themes = await _ensureRdvThemes();
    // Build prospect name for header
    const prospect = (data?.prospects || []).find(p => p.id === prospectId);
    const company = prospect ? (data?.companies || []).find(c => c.id === prospect.company_id) : null;
    const header = prospect
? `📋 RDV – ${prospect.name}${company ? ' (' + company.groupe + ')' : ''}`
: '📋 RDV – Grille de qualification';
    const date = new Date().toLocaleDateString('fr-FR');

    let lines = [header, `Date : ${date}`, '─'.repeat(50), ''];
    themes.forEach(t => {
const d = _rdvData[t.key] || {};
const check = d.checked ? '✅' : '⬜';
lines.push(`${check} ${t.theme}`);
lines.push(`   Q: ${t.question}`);
lines.push(`   R: ${d.reponse || '—'}`);
lines.push('');
    });
    const done = themes.filter(t => _rdvData[t.key]?.checked).length;
    lines.push('─'.repeat(50));
    lines.push(`Progression : ${done} / ${themes.length}`);

    try {
await navigator.clipboard.writeText(lines.join('\n'));
showToast('📋 Checklist copiée !');
    } catch (e) {
// fallback
const ta = document.createElement('textarea');
ta.value = lines.join('\n');
document.body.appendChild(ta);
ta.select();
document.execCommand('copy');
document.body.removeChild(ta);
showToast('📋 Checklist copiée !');
    }
}

// ═══ Meetings — historique des réunions ═══
let _meetingsList = [];
let _currentMeetingId = null;

async function loadMeetings(prospectId) {
    try {
        const res = await fetch(`/api/meetings?prospect_id=${prospectId}`);
        const j = await res.json();
        if (j.ok) {
            _meetingsList = j.meetings || [];
            renderMeetingsTabs(prospectId);
        }
    } catch (e) {
        console.error('loadMeetings error', e);
        _meetingsList = [];
    }
}

function renderMeetingsTabs(prospectId) {
    const container = document.getElementById('meetingsTabsContainer');
    const tabsList = document.getElementById('meetingsTabsList');
    if (!container || !tabsList) return;
    
    if (_meetingsList.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    tabsList.innerHTML = _meetingsList.map(m => 
        `<button class="btn btn-secondary btn-sm meeting-tab-btn" onclick="switchMeetingTab(${m.id}, ${prospectId})" id="meetingTab_${m.id}" title="${escapeHtml(m.title)} — ${escapeHtml(m.date)}">
            📅 ${escapeHtml(m.date)} — ${escapeHtml(m.title.length > 30 ? m.title.substring(0, 30) + '…' : m.title)}
        </button>`
    ).join('');
}

function switchMeetingTab(meetingId, prospectId) {
    _currentMeetingId = meetingId;
    
    // Update tab buttons
    document.querySelectorAll('.meeting-tab-btn, #meetingTab_current').forEach(btn => {
        btn.style.background = '';
        btn.style.color = '';
    });
    
    if (meetingId === null) {
        // Show current checklist
        const currentBtn = document.getElementById('meetingTab_current');
        if (currentBtn) {
            currentBtn.style.background = 'var(--color-primary)';
            currentBtn.style.color = '#fff';
        }
        document.getElementById('rdvChecklistContainer').style.display = '';
        document.getElementById('meetingDetailView').style.display = 'none';
    } else {
        // Show meeting detail
        const btn = document.getElementById(`meetingTab_${meetingId}`);
        if (btn) {
            btn.style.background = 'var(--color-primary)';
            btn.style.color = '#fff';
        }
        document.getElementById('rdvChecklistContainer').style.display = 'none';
        document.getElementById('meetingDetailView').style.display = '';
        displayMeetingDetail(meetingId);
    }
}

async function displayMeetingDetail(meetingId) {
    const meeting = _meetingsList.find(m => m.id === meetingId);
    if (!meeting) return;
    
    const container = document.getElementById('meetingDetailContent');
    if (!container) return;
    
    const themes = await _ensureRdvThemes();
    const themesDict = {};
    themes.forEach(t => { themesDict[t.key] = t; });
    
    let html = `
        <div style="padding:16px;background:var(--color-surface);border-radius:12px;border:1px solid var(--color-border);margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;">
                <div>
                    <h3 style="margin:0 0 8px 0;color:var(--color-primary);">${escapeHtml(meeting.title)}</h3>
                    <div style="color:var(--color-text-secondary);font-size:13px;">📅 ${escapeHtml(meeting.date)}</div>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="exportMeetingPDF(${meetingId})" title="Exporter en PDF">📄 PDF</button>
            </div>
        </div>
    `;
    
    if (meeting.checklist_data) {
        html += '<div style="margin-top:20px;"><h4 style="color:var(--color-primary);margin-bottom:12px;">📋 Grille de qualification</h4>';
        for (const [key, data] of Object.entries(meeting.checklist_data)) {
            if (!data || !data.reponse || !data.reponse.trim()) continue;
            const theme = themesDict[key];
            if (!theme) continue;
            html += `
                <div style="margin-bottom:20px;padding:14px;background:var(--color-surface-2);border-radius:10px;border-left:4px solid var(--color-primary);">
                    <div style="font-weight:700;color:var(--color-primary);margin-bottom:6px;font-size:14px;">${escapeHtml(theme.theme)}</div>
                    <div style="color:var(--color-text-secondary);font-size:12px;margin-bottom:10px;font-style:italic;">${escapeHtml(theme.question)}</div>
                    <div style="color:var(--color-text);white-space:pre-wrap;line-height:1.6;">${escapeHtml(data.reponse)}</div>
                </div>
            `;
        }
        html += '</div>';
    }
    
    if (meeting.notes) {
        html += `
            <div style="margin-top:20px;padding:14px;background:var(--color-surface-2);border-radius:10px;border-left:4px solid #f59e0b;">
                <h4 style="color:#f59e0b;margin:0 0 10px 0;">📝 Notes complémentaires</h4>
                <div style="color:var(--color-text);white-space:pre-wrap;line-height:1.6;">${escapeHtml(meeting.notes)}</div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

function exportMeetingPDF(meetingId) {
    window.open(`/api/meetings/${meetingId}/pdf`, '_blank');
}

async function saveMeeting(prospectId) {
    if (!_rdvData || !_rdvProspectId || _rdvProspectId !== prospectId) {
        showToast('⚠️ Veuillez d\'abord remplir la grille de qualification', 'warning');
        return;
    }
    
    // Vérifier qu'il y a au moins un champ rempli
    const hasData = Object.values(_rdvData).some(d => d && d.reponse && d.reponse.trim());
    if (!hasData) {
        showToast('⚠️ La grille est vide. Remplissez au moins un champ avant d\'enregistrer.', 'warning');
        return;
    }
    
    // Demander le titre
    const title = prompt('Titre de la réunion :', `Réunion ${new Date().toLocaleDateString('fr-FR')}`);
    if (!title || !title.trim()) {
        return;
    }
    
    const btn = document.getElementById(`btnSaveMeeting_${prospectId}`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = '💾 Enregistrement...';
    }
    
    try {
        const res = await fetch('/api/meetings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prospect_id: prospectId,
                title: title.trim(),
                checklist_data: _rdvData,
                notes: ''
            })
        });
        const j = await res.json();
        if (j.ok) {
            showToast('✅ Réunion enregistrée !', 'success', 3000);
            // Recharger les réunions
            await loadMeetings(prospectId);
            // Optionnel : vider la grille après enregistrement
            if (confirm('Réunion enregistrée. Voulez-vous réinitialiser la grille pour une nouvelle réunion ?')) {
                await resetRdvChecklist(prospectId);
            }
        } else {
            showToast('❌ Erreur : ' + (j.error || 'Impossible d\'enregistrer'), 'error');
        }
    } catch (e) {
        showToast('❌ Erreur réseau', 'error');
        console.error(e);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '💾 Enregistrer réunion';
        }
    }
}

// Copy RDV summary for Teams (v22.1)
async function copyRdvForTeams(prospectId) {
    const prospect = (data?.prospects || []).find(p => p.id === prospectId);
    if (!prospect) return;
    const company = (data?.companies || []).find(c => c.id === prospect.company_id);
    const prefix = typeof getTeamsPrefix === 'function' ? getTeamsPrefix() : '???';
    const companyName = company ? (company.groupe || '') : '';
    let text = `RDV Prospection — ${companyName}`;
    text += `\nContact : ${prospect.name || '—'}${prospect.fonction ? ' — ' + prospect.fonction : ''}`;
    if (prospect.rdvDate) text += `\nDate : ${prospect.rdvDate}`;
    text += `\nConsultant : ${prefix}`;
    if (prospect.notes) text += `\nNotes : ${prospect.notes.length > 150 ? prospect.notes.slice(0, 150) + '…' : prospect.notes}`;
    if (typeof copyForTeams === 'function') copyForTeams(text, 'RDV copié');
}

async function resetRdvChecklist(prospectId) {
    if (!confirm('Réinitialiser toutes les réponses de la checklist ?')) return;
    const themes = await _ensureRdvThemes();
    _rdvData = {};
    themes.forEach(t => { _rdvData[t.key] = { reponse: '', checked: false }; });
    await saveRdvChecklist();
    _renderRdvChecklist(themes);
}

// ════════════════════════════════════════════════════════════════════
// POST-MEETING IA — Compte-rendu automatique après EC / RDV
// ════════════════════════════════════════════════════════════════════

/** Retourne le prompt "après réunion" pour Ollama ou copie. */
async function getPostMeetingPrompt(prospectId) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return;
    const company = data.companies.find(c => c.id === p.company_id);
    const companyName = company ? `${company.groupe || ''} (${company.site || ''})` : '';
    const themes = await _ensureRdvThemes();

    // Build checklist summary from filled answers
    let checklistSummary = '';
    themes.forEach(t => {
        const d = _rdvData[t.key] || {};
        if (d.reponse && d.reponse.trim()) {
            checklistSummary += `• ${t.theme} — ${t.question}\n  → ${d.reponse.trim()}\n`;
        }
    });

    const tags = Array.isArray(p.tags) ? p.tags.join(', ') : '';
    const notes = (p.notes || '').trim();
    const callNotes = (() => {
        try {
            const arr = typeof p.callNotes === 'string' ? JSON.parse(p.callNotes) : (Array.isArray(p.callNotes) ? p.callNotes : []);
            return arr.slice(-3).map(n => `[${n.date}] ${n.content}`).join('\n');
        } catch(e) { return ''; }
    })();

    const promptText = `Tu es un assistant de prospection B2B spécialisé en ingénierie (systèmes embarqués, électronique, robotique, logiciel). Je viens de terminer un RDV / entretien client avec un prospect. Aide-moi à rédiger un compte-rendu structuré et à pré-remplir mon CRM.

══════ CONTEXTE PROSPECT ══════
• Nom : ${p.name || 'Inconnu'}
• Entreprise : ${companyName}
• Fonction : ${p.fonction || 'Non renseignée'}
• Statut actuel : ${p.statut || 'Non renseigné'}
• Compétences/Tags : ${tags || 'Aucun'}
• Notes existantes : ${notes || 'Aucune'}
${callNotes ? `• Dernières notes d'appel :\n${callNotes}` : ''}

══════ NOTES DE RÉUNION (Grille de qualification) ══════
${checklistSummary || '(Aucune note saisie dans la grille)'}

══════ CE QUE JE VEUX ══════

À partir des notes ci-dessus, génère un JSON avec les champs suivants. Remplis UNIQUEMENT les champs pour lesquels tu as des informations. Laisse null les champs sans info.

{
  "compte_rendu": "[Résumé structuré de la réunion en 5-10 lignes : contexte, points clés discutés, besoins identifiés, opportunités]",
  "next_action": "[Prochaine action concrète : ex. 'Envoyer 2 profils C/C++ embarqué', 'Planifier RT technique', 'Relancer dans 2 semaines']",
  "next_follow_up": "[Date YYYY-MM-DD de la prochaine relance, basée sur ce qui a été convenu]",
  "statut": "[Nouveau statut parmi : Appelé, À rappeler, Rendez-vous, Rencontré, Messagerie, Pas intéressé — ou null si inchangé]",
  "tags": ["tag1", "tag2", "..."],
  "pertinence": [1-5 ou null],
  "notes_enrichies": "[Informations clés à ajouter aux notes : taille équipe, projets, technos, besoins, budget, process achat — en complément des notes existantes]",
  "profils_a_proposer": "[Description des profils à envoyer : compétences, séniorité, techno, durée mission]",
  "besoins_identifies": "[Liste des besoins concrets identifiés pendant la réunion]"
}

IMPORTANT : Retourne UNIQUEMENT le JSON, sans texte autour. Le JSON doit être valide et parsable.`;
    return promptText;
}

async function copyPostMeetingPrompt(prospectId) {
    const promptText = await getPostMeetingPrompt(prospectId);
    if (!promptText) return;
    try { await navigator.clipboard.writeText(promptText); } catch(e) {
        const ta = document.createElement('textarea');
        ta.value = promptText; ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
    }
    showToast('Prompt "Après réunion" copié. Collez dans votre IA ou utilisez le bouton pour Ollama.', 'success', 5000);
}

function handlePostMeetingIA(prospectId) {
    openPostMeetingImportModal(prospectId);
}

// ─── Post-meeting import modal ───

function _ensurePostMeetingModal() {
    if (document.getElementById('modalPostMeetingIA')) return;
    const div = document.createElement('div');
    div.innerHTML = `
    <div id="modalPostMeetingIA" class="modal">
        <div class="modal-content">
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                <span>📥 Import compte-rendu de réunion</span>
                <button class="btn btn-secondary" onclick="closePostMeetingModal()" style="font-size:14px;padding:4px 10px;">✕</button>
            </div>
            <div id="pmStep1" style="margin-top:16px;">
                <p class="muted" style="font-size:12px;margin-bottom:12px;">Déposez votre compte-rendu de réunion (PDF, Word, Excel) ou collez le texte ci-dessous.</p>
                <div style="margin-bottom:12px;">
                    <input type="file" id="pmFileInput" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt" style="display:none;" onchange="handlePostMeetingFile(event)">
                    <button class="btn btn-primary" onclick="document.getElementById('pmFileInput').click()" style="width:100%;padding:12px;font-size:14px;">📎 Déposer un fichier (PDF, Word, Excel...)</button>
                    <div id="pmFileInfo" style="margin-top:8px;font-size:12px;color:var(--color-text-secondary);display:none;"></div>
                </div>
                <div style="text-align:center;margin:12px 0;color:var(--color-text-secondary);font-size:12px;">OU</div>
                <textarea id="pmImportTextarea" style="width:100%;min-height:200px;font-family:monospace;font-size:12px;" placeholder="Collez ici le texte du compte-rendu ou le JSON retourné par l'IA..." oninput="checkAndAutoParseJSON()"></textarea>
                <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
                    <button class="btn btn-secondary" onclick="closePostMeetingModal()">Annuler</button>
                    <button class="btn btn-secondary" id="pmParseBtn" onclick="parsePostMeetingImport()" style="display:none;">📋 Analyser le JSON</button>
                    <button class="btn btn-primary" id="pmAnalyzeBtn" onclick="processPostMeetingContent()">🤖 Analyser avec Ollama</button>
                </div>
            </div>
            <div id="pmStep2" style="margin-top:16px;display:none;">
                <p class="muted" style="font-size:12px;margin-bottom:8px;">Vérifiez les champs détectés :</p>
                <div id="pmFieldsPreview"></div>
                <div style="display:flex;gap:8px;margin-top:16px;justify-content:space-between;">
                    <button class="btn btn-secondary" onclick="pmBackToStep1()">← Modifier</button>
                    <button class="btn btn-primary" onclick="applyPostMeetingImport()">💾 Appliquer</button>
                </div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(div.firstElementChild);
}

let _pmProspectId = null;
let _pmParsedData = null;
let _pmFieldAccepted = {};
let _pmChecklistResponses = null;
let _pmChecklistAccepted = {}; // Pour stocker les réponses acceptées/refusées de la grille

function openPostMeetingImportModal(prospectId) {
    _ensurePostMeetingModal();
    _pmProspectId = prospectId;
    _pmParsedData = null;
    _pmFieldAccepted = {};
    _pmChecklistResponses = null;
    _pmChecklistAccepted = {};
    const textarea = document.getElementById('pmImportTextarea');
    if (textarea) textarea.value = '';
    const parseBtn = document.getElementById('pmParseBtn');
    if (parseBtn) parseBtn.style.display = 'none';
    document.getElementById('pmFileInput').value = '';
    document.getElementById('pmFileInfo').style.display = 'none';
    document.getElementById('pmFileInfo').textContent = '';
    document.getElementById('pmStep1').style.display = '';
    document.getElementById('pmStep2').style.display = 'none';
    const modal = document.getElementById('modalPostMeetingIA');
    if (modal) {
        if (window.openModal) {
            window.openModal(modal, { focusElement: 'textarea' });
        } else {
            modal.classList.add('active');
        }
    }
}

function updateChecklistTextarea(textareaId, enabled) {
    const textarea = document.getElementById(textareaId);
    if (textarea) {
        textarea.disabled = !enabled;
        textarea.style.opacity = enabled ? '1' : '0.5';
    }
}

async function handlePostMeetingFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const fileInfo = document.getElementById('pmFileInfo');
    fileInfo.style.display = 'block';
    fileInfo.textContent = `📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB) — Analyse en cours...`;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const res = await fetch('/api/rdv-checklist/parse-file', {
            method: 'POST',
            body: formData
        });
        const json = await res.json();
        if (json.ok && json.text) {
            document.getElementById('pmImportTextarea').value = json.text;
            fileInfo.textContent = `✅ ${file.name} — Texte extrait (${json.text.length} caractères)`;
            // v26: Vérifier si le texte extrait contient déjà un JSON valide
            checkAndAutoParseJSON();
            showToast('Fichier analysé. Si un JSON est détecté, utilisez "Analyser le JSON", sinon "Analyser avec Ollama".', 'success', 5000);
        } else {
            fileInfo.textContent = `❌ Erreur : ${json.error || 'Impossible d\'extraire le texte'}`;
            showToast('Erreur lors de l\'extraction du texte du fichier', 'error', 5000);
        }
    } catch (e) {
        fileInfo.textContent = `❌ Erreur réseau`;
        showToast('Erreur lors de l\'upload du fichier', 'error', 5000);
        console.error(e);
    }
}

async function processPostMeetingContent() {
    const textarea = document.getElementById('pmImportTextarea');
    const content = (textarea?.value || '').trim();
    if (!content) {
        showToast('⚠️ Veuillez déposer un fichier ou coller le texte du compte-rendu.', 'warning');
        return;
    }
    
    // v26: Vérifier si c'est déjà un JSON valide — si oui, parser directement
    const jsonStr = extractJSONFromText(content);
    if (jsonStr) {
        try {
            JSON.parse(jsonStr);
            showToast('✅ JSON valide détecté. Analyse en cours...', 'success', 2000);
            // Parser directement sans passer par Ollama
            await parsePostMeetingImport();
            return;
        } catch (e) {
            // JSON invalide, continuer avec Ollama
        }
    }
    
    const btn = document.getElementById('pmAnalyzeBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '🤖 Analyse en cours...';
    }
    
    try {
        const prospectId = _pmProspectId;
        const promptText = await getPostMeetingPromptFromContent(prospectId, content);
        if (!promptText) {
            showToast('Erreur : impossible de générer le prompt', 'error');
            return;
        }
        // v26: Timeout augmenté pour les prompts longs (post-meeting)
        const text = await callOllama(promptText, { timeoutMs: 300000 }); // 5 minutes au lieu de 3
        if (text) {
            document.getElementById('pmImportTextarea').value = text;
            // Vérifier si le résultat est déjà un JSON valide
            const resultJson = extractJSONFromText(text);
            if (resultJson) {
                await parsePostMeetingImport();
            } else {
                showToast('⚠️ Réponse Ollama reçue mais format JSON non détecté. Vérifiez le contenu.', 'warning', 5000);
            }
        }
    } catch (e) {
        if (e.message === 'Timeout') {
            showToast('⏱️ Ollama a pris trop de temps. Le JSON peut être partiel — essayez de l\'analyser manuellement avec le bouton "Analyser le JSON".', 'warning', 8000);
        } else {
            showToast('Ollama indisponible. Si vous avez déjà un JSON, utilisez le bouton "Analyser le JSON".', 'warning', 6000);
        }
        console.error('Ollama error:', e);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🤖 Analyser avec Ollama';
        }
    }
}

async function getPostMeetingPromptFromContent(prospectId, meetingContent) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return null;
    const company = data.companies.find(c => c.id === p.company_id);
    const companyName = company ? `${company.groupe || ''} (${company.site || ''})` : '';
    const themes = await _ensureRdvThemes();
    
    // Build checklist structure for extraction
    let checklistStructure = '';
    themes.forEach(t => {
        checklistStructure += `• ${t.key} (${t.theme}): ${t.question}\n`;
    });
    
    const tags = Array.isArray(p.tags) ? p.tags.join(', ') : '';
    const notes = (p.notes || '').trim();
    
    const promptText = `Tu es un assistant de prospection B2B spécialisé en ingénierie (systèmes embarqués, électronique, robotique, logiciel). Je viens de terminer un RDV / entretien client avec un prospect. J'ai un compte-rendu de réunion et je veux que tu extraies les informations pertinentes pour remplir automatiquement ma grille de qualification RDV.

══════ CONTEXTE PROSPECT ══════
• Nom : ${p.name || 'Inconnu'}
• Entreprise : ${companyName}
• Fonction : ${p.fonction || 'Non renseignée'}
• Statut actuel : ${p.statut || 'Non renseigné'}
• Compétences/Tags : ${tags || 'Aucun'}
• Notes existantes : ${notes || 'Aucune'}

══════ COMPTE-RENDU DE RÉUNION ══════
${meetingContent}

══════ GRILLE DE QUALIFICATION (PRIORITÉ ABSOLUE) ══════
Voici les thèmes de ma grille de qualification. Pour CHAQUE thème, cherche dans le compte-rendu les informations correspondantes et extrais-les :

${themes.map(t => `• ${t.key} — ${t.theme} : ${t.question}`).join('\n')}

══════ CE QUE JE VEUX ══════

Génère un JSON avec DEUX parties. La PARTIE 1 (checklist_responses) est LA PRIORITÉ ABSOLUE car elle remplit automatiquement la grille de qualification.

**PARTIE 1 — GRILLE DE QUALIFICATION (OBLIGATOIRE) :**
Pour chaque thème de la grille ci-dessus, si tu trouves des informations correspondantes dans le compte-rendu, ajoute-les dans "checklist_responses" avec la clé exacte du thème. Extrais le texte directement du compte-rendu, reformule si nécessaire mais garde toutes les informations pertinentes.

**PARTIE 2 — CHAMPS GÉNÉRAUX (COMPLÉMENTAIRES) :**
Les autres informations qui ne rentrent pas dans la grille vont dans les champs généraux.

Format JSON attendu :

{
  "checklist_responses": {
    "metiers_equipe": "[Extrait du compte-rendu : quels métiers/équipes ont été mentionnés ? Ex: 'Équipe web marketing de 3 personnes, équipe IT en modernisation, prestataire historique pour ColdFusion']",
    "outils": "[Extrait du compte-rendu : quels outils/technologies ont été mentionnés ? Ex: 'Adobe ColdFusion, PHP, MySQL, MariaDB, Punchout/cXML, SAP, Google Ads, Analytics, VS Code, outils IA']",
    "taille_equipe": "[Extrait du compte-rendu : nombre de personnes, internes/externes ? Ex: 'Environ 200 collaborateurs, équipe web marketing de 3 personnes, équipe IT']",
    "projets_actuels": "[Extrait du compte-rendu : projets en cours mentionnés ? Ex: 'Refonte des outils internes en PHP/MySQL, maintenance site e-commerce ColdFusion']",
    "projets_a_venir": "[Extrait du compte-rendu : projets/roadmap à venir ? Ex: 'Refonte complète du site e-commerce écartée pour l'instant, hypothèse future refonte non prioritaire']",
    "societe": "[Extrait du compte-rendu : taille société, CA, effectifs ? Ex: 'Environ 200 collaborateurs pour 50 M€ de CA, siège à Valence, Quart Sud-Est']",
    "produits": "[Extrait du compte-rendu : produits/systèmes principaux ? Ex: 'Distribution composants pour systèmes industriels (pneumatique, hydraulique, automatisme), site e-commerce B2B']",
    "profils_recherches": "[Extrait du compte-rendu : profils recherchés mentionnés ? Ex: 'Développeur expert Adobe ColdFusion avec Punchout/cXML, développeurs PHP/SQL, profils Data/Web marketing']",
    "besoin_identifie": "[Extrait du compte-rendu : besoins ouverts/à venir ? Ex: 'Besoin urgent compétences ColdFusion/Punchout, renforts équipe IT PHP/SQL, recherche profil expert']",
    "profils_a_proposer": "[Extrait du compte-rendu : quels profils à proposer ? Ex: 'Profils PHP/SQL pour refonte interne, expert ColdFusion/Punchout à rechercher']",
    "next_step": "[Extrait du compte-rendu : prochaine étape mentionnée ? Ex: 'Envoyer email récapitulatif + présentation + profils PHP/SQL, démarrer recherche profil ColdFusion/Punchout']",
    ...
  },
  "compte_rendu": "[Résumé structuré de la réunion en 5-10 lignes]",
  "next_action": "[Prochaine action concrète]",
  "next_follow_up": "[Date YYYY-MM-DD si mentionnée]",
  "statut": "[Nouveau statut si changement nécessaire, sinon null]",
  "tags": ["tags techniques extraits du compte-rendu"],
  "pertinence": [1-5 ou null],
  "notes_enrichies": "[Informations complémentaires qui ne rentrent pas dans la grille]"
}

RÈGLES IMPORTANTES :
1. **PRIORITÉ 1** : Remplis "checklist_responses" avec TOUTES les informations trouvées dans le compte-rendu qui correspondent aux thèmes de la grille.
2. Utilise les clés EXACTES des thèmes (metiers_equipe, outils, taille_equipe, projets_actuels, etc.) — voir la liste complète ci-dessus.
3. Pour chaque thème, extrais le texte du compte-rendu qui répond à la question. Si plusieurs informations correspondent, combine-les.
4. Ne laisse PAS de champs vides dans checklist_responses si tu as trouvé des infos correspondantes dans le compte-rendu.
5. Les champs généraux (compte_rendu, next_action, etc.) sont complémentaires et peuvent être null si pas d'info.
6. Retourne UNIQUEMENT le JSON valide, sans texte autour.`;
    return promptText;
}

function closePostMeetingModal() {
    const modal = document.getElementById('modalPostMeetingIA');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
}

function pmBackToStep1() {
    // v26: Réinitialiser le bouton parse lors du retour à l'étape 1
    const parseBtn = document.getElementById('pmParseBtn');
    if (parseBtn) parseBtn.style.display = 'none';
    checkAndAutoParseJSON(); // Vérifier si le JSON est toujours valide
    document.getElementById('pmStep1').style.display = '';
    document.getElementById('pmStep2').style.display = 'none';
}

// v26: Fonction pour détecter et parser automatiquement le JSON
function checkAndAutoParseJSON() {
    const textarea = document.getElementById('pmImportTextarea');
    const parseBtn = document.getElementById('pmParseBtn');
    if (!textarea || !parseBtn) return;
    
    const raw = (textarea.value || '').trim();
    if (!raw) {
        parseBtn.style.display = 'none';
        return;
    }
    
    // Essayer de détecter un JSON valide
    const jsonStr = extractJSONFromText(raw);
    if (jsonStr) {
        try {
            JSON.parse(jsonStr);
            // JSON valide détecté — afficher le bouton
            parseBtn.style.display = '';
            parseBtn.textContent = '📋 Analyser le JSON détecté';
        } catch (e) {
            parseBtn.style.display = 'none';
        }
    } else {
        parseBtn.style.display = 'none';
    }
}

// v26: Extraction robuste du JSON depuis un texte (tolérant aux formats)
function extractJSONFromText(text) {
    if (!text || !text.trim()) return null;
    
    // 1. Essayer de parser directement
    try {
        JSON.parse(text.trim());
        return text.trim();
    } catch (e) {}
    
    // 2. Chercher dans des blocs markdown ```json ... ```
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        try {
            const extracted = jsonMatch[1].trim();
            JSON.parse(extracted);
            return extracted;
        } catch (e) {}
    }
    
    // 3. Chercher un objet JSON entre { } (même avec du texte avant/après)
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        try {
            const extracted = objectMatch[0];
            JSON.parse(extracted);
            return extracted;
        } catch (e) {}
    }
    
    // 4. Chercher un objet JSON qui commence par { et se termine par } (multiligne)
    const lines = text.split('\n');
    let startIdx = -1;
    let braceCount = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (startIdx === -1 && line.includes('{')) {
            startIdx = i;
        }
        if (startIdx !== -1) {
            braceCount += (line.match(/\{/g) || []).length;
            braceCount -= (line.match(/\}/g) || []).length;
            if (braceCount === 0 && startIdx !== i) {
                const extracted = lines.slice(startIdx, i + 1).join('\n');
                try {
                    JSON.parse(extracted);
                    return extracted;
                } catch (e) {}
            }
        }
    }
    
    return null;
}

async function parsePostMeetingImport() {
    const raw = (document.getElementById('pmImportTextarea')?.value || '').trim();
    if (!raw) { showToast('⚠️ Collez le JSON retourné par l\'IA.', 'warning'); return; }

    // v26: Utiliser la fonction d'extraction robuste
    const jsonStr = extractJSONFromText(raw);
    if (!jsonStr) {
        showToast('❌ JSON invalide ou introuvable. Vérifiez le format ou utilisez "Analyser avec Ollama" pour extraire depuis du texte brut.', 'error', 6000);
        return;
    }

    let parsed;
    try { 
        parsed = JSON.parse(jsonStr); 
    } catch(e) {
        showToast('❌ JSON invalide : ' + (e.message || 'Erreur de parsing'), 'error', 5000);
        console.error('JSON parsing error:', e, 'Extracted:', jsonStr);
        return;
    }
    _pmParsedData = parsed;
    
    // Si checklist_responses est présent, on le stocke séparément
    if (parsed.checklist_responses) {
        _pmChecklistResponses = parsed.checklist_responses;
    }

    // Build preview
    const FIELD_LABELS = {
        compte_rendu: '📝 Compte-rendu',
        next_action: '🎯 Prochaine action',
        next_follow_up: '📅 Prochaine relance',
        statut: '📊 Statut',
        tags: '🏷️ Tags',
        pertinence: '⭐ Pertinence',
        notes_enrichies: '📋 Notes enrichies',
        profils_a_proposer: '👤 Profils à proposer',
        besoins_identifies: '💡 Besoins identifiés'
    };

    _pmFieldAccepted = {};
    let html = '';
    
    // Champs généraux
    for (const [key, label] of Object.entries(FIELD_LABELS)) {
        const val = parsed[key];
        if (val === null || val === undefined || val === '') continue;
        _pmFieldAccepted[key] = true;
        const display = Array.isArray(val) ? val.join(', ') : String(val);
        html += `
        <div style="border:1px solid var(--color-border);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--color-surface-2);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <input type="checkbox" checked onchange="_pmFieldAccepted['${key}']=this.checked" id="pmCheck_${key}">
                <label for="pmCheck_${key}" style="font-weight:700;font-size:13px;">${label}</label>
            </div>
            <div style="font-size:12px;white-space:pre-wrap;color:var(--color-text-secondary);">${escapeHtml(display)}</div>
        </div>`;
    }
    
    // Réponses de la grille
    if (_pmChecklistResponses && Object.keys(_pmChecklistResponses).length > 0) {
        html += `<div style="margin-top:16px;padding-top:16px;border-top:2px solid var(--color-border);">
            <div style="font-weight:700;font-size:14px;margin-bottom:8px;">📋 Grille de qualification</div>`;
        const themes = await _ensureRdvThemes();
        _pmChecklistAccepted = {}; // Réinitialiser les acceptations
        for (const [key, value] of Object.entries(_pmChecklistResponses)) {
            if (!value || String(value).trim() === '') continue;
            const theme = themes.find(t => t.key === key);
            if (theme) {
                _pmChecklistAccepted[key] = true; // Par défaut accepté
                const responseId = `pmChecklist_${key}`;
                const textareaId = `pmChecklistText_${key}`;
                html += `
                <div style="border:1px solid var(--color-border);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--color-surface-2);">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <input type="checkbox" checked onchange="_pmChecklistAccepted['${key}']=this.checked; updateChecklistTextarea('${textareaId}', this.checked)" id="${responseId}">
                        <label for="${responseId}" style="font-weight:600;font-size:12px;color:var(--color-primary);cursor:pointer;">${escapeHtml(theme.theme)} — ${escapeHtml(theme.question)}</label>
                    </div>
                    <textarea id="${textareaId}" style="width:100%;min-height:60px;padding:8px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface);color:var(--color-text);font-size:12px;font-family:inherit;resize:vertical;white-space:pre-wrap;" oninput="_pmChecklistResponses['${key}']=this.value">${escapeHtml(String(value))}</textarea>
                </div>`;
            }
        }
        html += `</div>`;
    }

    if (!html) {
        showToast('⚠️ Aucun champ détecté dans le JSON.', 'warning');
        return;
    }

    document.getElementById('pmFieldsPreview').innerHTML = html;
    document.getElementById('pmStep1').style.display = 'none';
    document.getElementById('pmStep2').style.display = '';
}

async function applyPostMeetingImport() {
    if (!_pmParsedData || !_pmProspectId) return;
    const p = data.prospects.find(x => x.id === _pmProspectId);
    if (!p) return;
    const d = _pmParsedData;

    // Apply accepted fields
    if (_pmFieldAccepted.next_action && d.next_action) {
        p.nextAction = d.next_action;
    }
    if (_pmFieldAccepted.next_follow_up && d.next_follow_up) {
        p.nextFollowUp = d.next_follow_up;
    }
    if (_pmFieldAccepted.statut && d.statut) {
        p.statut = d.statut;
    }
    if (_pmFieldAccepted.pertinence && d.pertinence) {
        p.pertinence = String(d.pertinence);
    }
    if (_pmFieldAccepted.tags && Array.isArray(d.tags) && d.tags.length) {
        const existing = Array.isArray(p.tags) ? p.tags : [];
        const merged = [...new Set([...existing, ...d.tags])];
        p.tags = merged;
    }

    // Append notes
    const notesParts = [];
    if (_pmFieldAccepted.compte_rendu && d.compte_rendu) notesParts.push(`[CR ${todayISO()}] ${d.compte_rendu}`);
    if (_pmFieldAccepted.notes_enrichies && d.notes_enrichies) notesParts.push(d.notes_enrichies);
    if (_pmFieldAccepted.profils_a_proposer && d.profils_a_proposer) notesParts.push(`Profils à proposer : ${d.profils_a_proposer}`);
    if (_pmFieldAccepted.besoins_identifies && d.besoins_identifies) notesParts.push(`Besoins identifiés : ${d.besoins_identifies}`);

    if (notesParts.length) {
        const newNote = notesParts.join('\n\n');
        p.notes = p.notes ? (p.notes + '\n\n' + newNote) : newNote;
    }

    // Apply checklist responses if present (seulement ceux acceptés)
    if (_pmChecklistResponses && Object.keys(_pmChecklistResponses).length > 0) {
        // Ensure RDV data is loaded for this prospect
        if (!_rdvData || _rdvProspectId !== _pmProspectId) {
            await loadRdvChecklist(_pmProspectId);
        }
        const themes = await _ensureRdvThemes();
        let appliedCount = 0;
        for (const [key, value] of Object.entries(_pmChecklistResponses)) {
            // Ne remplir que si accepté et non vide
            if (!_pmChecklistAccepted[key] || !value || String(value).trim() === '') continue;
            const theme = themes.find(t => t.key === key);
            if (theme) {
                if (!_rdvData[key]) _rdvData[key] = { reponse: '', checked: false };
                _rdvData[key].reponse = String(value).trim();
                _rdvData[key].checked = true;
                appliedCount++;
            }
        }
        // Save checklist seulement si des champs ont été remplis
        if (appliedCount > 0) {
            await saveRdvChecklist();
            // Re-render checklist if we're on the RDV tab
            const rdvTab = document.getElementById('tab-rdv');
            if (rdvTab && rdvTab.classList.contains('active')) {
                _renderRdvChecklist(themes);
            }
        }
    }

    // Add a callNote entry for the meeting summary
    if (_pmFieldAccepted.compte_rendu && d.compte_rendu) {
        if (!Array.isArray(p.callNotes)) {
            try { p.callNotes = JSON.parse(p.callNotes || '[]'); } catch(e) { p.callNotes = []; }
        }
        p.callNotes.push({ date: todayISO(), content: `[Réunion IA] ${d.compte_rendu}` });
    }

    // Update lastContact to today
    p.lastContact = todayISO();

    try {
        await saveToServerAsync();

        // Log as event in timeline
        await fetch('/api/ia-enrichment-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'prospect',
                id: _pmProspectId,
                fields: Object.keys(_pmFieldAccepted).filter(k => _pmFieldAccepted[k]),
                source: 'post_meeting_ia'
            })
        });

        closePostMeetingModal();
        showToast('✅ Compte-rendu appliqué ! Fiche mise à jour.', 'success', 5000);
        viewDetail(_pmProspectId); // refresh the detail modal
    } catch(e) {
        console.error(e);
        showToast('❌ Erreur lors de la sauvegarde.', 'error');
    }
}

// ═══ v8 Quick Actions (inline table buttons) ═══

function callProspect(id) {
    const p = data.prospects.find(x => x.id === id);
    if (!p) return;
    const tel = (p.telephone || '').trim();
    if (!tel) { showToast('⚠️ Aucun numéro renseigné', 'warning'); return; }
    const clean = tel.replace(/[^\d+]/g, '');
    window.location.href = 'tel:' + clean;
    showToast('📞 Appel de ' + (p.name || ''), 'info', 2000);
}

function pushEmail(id) {
    const p = data.prospects.find(x => x.id === id);
    if (!p) return;
    if (!(p.email || '').trim()) { showToast('⚠️ Aucun email renseigné', 'warning'); return; }
    viewDetail(id);
    // Auto-scroll to push section after detail opens
    setTimeout(function() {
        const pushBtn = document.querySelector('[onclick*="sendPushEmail"]') || document.querySelector('.detail-push-actions button');
        if (pushBtn) pushBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 500);
}

function bumpFollowup(id, days) {
    const p = data.prospects.find(x => x.id === id);
    if (!p) return;
    const oldDate = p.nextFollowUp || '';
    const d = new Date();
    d.setDate(d.getDate() + (days || 2));
    const newDate = d.toISOString().slice(0, 10);
    p.nextFollowUp = newDate;
    p.lastContact = new Date().toISOString().slice(0, 10);

    // Undo support
    if (typeof window.pushUndo === 'function') {
        window.pushUndo('Relance ' + (p.name || ''), function() {
            p.nextFollowUp = oldDate;
            renderProspects();
            saveToServer();
        });
    }

    saveToServer();
    renderProspects();
    showToast('📅 Relance +' + days + 'j pour ' + (p.name || ''), 'success', 2500);
}

// ═══ Expose data for v8 global search ═══
// Update _v8Data reference after each data load
(function _exposeData() {
    const origFetch = window.fetch;
    var pending = false;
    function _syncData() {
        if (pending) return;
        pending = true;
        setTimeout(function() {
            window._v8Data = data;
            pending = false;
        }, 100);
    }
    setInterval(_syncData, 3000);
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(_syncData, 500);
        if (typeof applyProspectColumnWidths === 'function') applyProspectColumnWidths();
        if (typeof initProspectTableResize === 'function') initProspectTableResize();
    });
})();

// ─── Personnalisation largeurs colonnes tableau prospects (localStorage + resize) ───
var PROSPECT_COL_STORAGE_KEY = 'prospup_prospect_col_widths';
var PROSPECT_COL_DEFAULT_WIDTHS = { 1: 36, 2: 44, 3: 120, 4: 140, 5: 100, 6: 80, 7: 52, 8: 100, 9: 115, 10: 150, 11: 70, 12: 90, 13: 60 };

function applyProspectColumnWidths() {
    var wrapper = document.getElementById('tableView');
    if (!wrapper) return;
    var saved;
    try { saved = JSON.parse(localStorage.getItem(PROSPECT_COL_STORAGE_KEY) || 'null'); } catch (e) { saved = null; }
    var widths = saved && typeof saved === 'object' ? saved : PROSPECT_COL_DEFAULT_WIDTHS;
    for (var c = 1; c <= 13; c++) {
        var w = widths[c];
        if (typeof w !== 'number' || w < 24) w = PROSPECT_COL_DEFAULT_WIDTHS[c];
        var th = wrapper.querySelector('th[data-col="' + c + '"]');
        if (th) th.style.width = w + 'px';
    }
}

function initProspectTableResize() {
    var wrapper = document.getElementById('tableView');
    if (!wrapper) return;
    var handles = wrapper.querySelectorAll('.col-resize-handle');
    var resizing = null;
    function onMove(e) {
        if (!resizing) return;
        var col = resizing.col;
        var th = wrapper.querySelector('th[data-col="' + col + '"]');
        if (!th) return;
        var dx = e.clientX - resizing.startX;
        var newW = Math.max(24, resizing.startWidth + dx);
        th.style.width = newW + 'px';
        resizing.currentW = newW;
    }
    function onUp() {
        if (resizing) {
            var saved;
            try { saved = JSON.parse(localStorage.getItem(PROSPECT_COL_STORAGE_KEY) || '{}'); } catch (e) { saved = {}; }
            saved[resizing.col] = resizing.currentW;
            try { localStorage.setItem(PROSPECT_COL_STORAGE_KEY, JSON.stringify(saved)); } catch (e) {}
        }
        resizing = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    }
    handles.forEach(function (h) {
        h.addEventListener('mousedown', function (e) {
            e.preventDefault();
            var col = parseInt(h.getAttribute('data-col'), 10);
            var th = wrapper.querySelector('th[data-col="' + col + '"]');
            if (!th) return;
            var w = th.offsetWidth;
            resizing = { col: col, startX: e.clientX, startWidth: w, currentW: w };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
}

function resetProspectColumnWidths() {
    try { localStorage.removeItem(PROSPECT_COL_STORAGE_KEY); } catch (e) {}
    applyProspectColumnWidths();
    if (typeof showToast === 'function') showToast('Largeurs des colonnes réinitialisées.', 'success', 3000);
}

