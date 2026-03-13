/**
 * DashboardWidgetResize
 * Système de redimensionnement libre pour widgets (style PowerPoint)
 * Compatible avec DashboardWidgetDragDrop
 */

class DashboardWidgetResize {
    constructor(containerSelector, options = {}) {
        this.container = typeof containerSelector === 'string' 
            ? document.querySelector(containerSelector)
            : containerSelector;
        this.options = {
            widgetSelector: '.dash-widget',
            handleSize: 20, // Taille de la poignée de resize
            minWidth: 200,
            minHeight: 150,
            maxWidth: null, // null = pas de limite
            maxHeight: null,
            gridSnap: true, // Snap aux colonnes du grid
            ...options
        };
        
        this.isInitialized = false;
        this.isResizing = false;
        this.resizedWidget = null;
        this.resizeHandle = null;
        this.startPos = { x: 0, y: 0 };
        this.startSize = { width: 0, height: 0 };
        this.currentPos = { x: 0, y: 0 };
        
        // Détection input type
        this.inputType = null;
        this.touchIdentifier = null;
        
        // Bind des méthodes
        this._boundHandleResizeStart = this._handleResizeStart.bind(this);
        this._boundHandleResizeMove = this._handleResizeMove.bind(this);
        this._boundHandleResizeEnd = this._handleResizeEnd.bind(this);
        
        // Clé localStorage
        this.storageKey = 'dashboard_widget_sizes';
    }
    
    /**
     * Initialiser le système de redimensionnement
     */
    init() {
        if (this.isInitialized) return;
        if (!this.container) {
            console.error('[DashboardResize] Container non trouvé');
            return;
        }
        
        // Créer les poignées de resize sur tous les widgets
        this._createResizeHandles();
        
        // Restaurer les tailles sauvegardées
        this._restoreSizes();
        
        this.isInitialized = true;
        console.log('[DashboardResize] Initialisé');
    }
    
    /**
     * Détruire le système
     */
    destroy() {
        if (!this.isInitialized) return;
        
        // Retirer les poignées
        this.container.querySelectorAll('.dash-widget-resize-handle').forEach(handle => {
            handle.removeEventListener('mousedown', this._boundHandleResizeStart);
            handle.removeEventListener('touchstart', this._boundHandleResizeStart);
            handle.remove();
        });
        
        // Retirer listeners globaux
        document.removeEventListener('mousemove', this._boundHandleResizeMove);
        document.removeEventListener('mouseup', this._boundHandleResizeEnd);
        document.removeEventListener('touchmove', this._boundHandleResizeMove);
        document.removeEventListener('touchend', this._boundHandleResizeEnd);
        document.removeEventListener('touchcancel', this._boundHandleResizeEnd);
        
        this.isInitialized = false;
    }
    
    /**
     * Créer les poignées de resize sur tous les widgets
     */
    _createResizeHandles() {
        const widgets = this.container.querySelectorAll(this.options.widgetSelector);
        
        widgets.forEach(widget => {
            // Vérifier si la poignée existe déjà
            if (widget.querySelector('.dash-widget-resize-handle')) return;
            
            const handle = document.createElement('div');
            handle.className = 'dash-widget-resize-handle';
            handle.setAttribute('title', 'Redimensionner');
            handle.innerHTML = '↘'; // Icône de resize
            
            // Ajouter au header du widget
            let header = widget.querySelector('.dash-widget-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'dash-widget-header';
                widget.insertBefore(header, widget.firstChild);
            }
            header.appendChild(handle);
            
            // Attacher les événements
            handle.addEventListener('mousedown', this._boundHandleResizeStart, { passive: false });
            handle.addEventListener('touchstart', this._boundHandleResizeStart, { passive: false });
        });
    }
    
    /**
     * Détecter le type d'input
     */
    _detectInputType(event) {
        if (this.inputType) return this.inputType;
        
        if (event.type === 'touchstart' || event.touches) {
            this.inputType = 'touch';
            if (event.touches && event.touches.length > 0) {
                this.touchIdentifier = event.touches[0].identifier;
            }
            return 'touch';
        } else if (event.type === 'mousedown') {
            this.inputType = 'mouse';
            return 'mouse';
        }
        return null;
    }
    
    /**
     * Obtenir la position de l'événement
     */
    _getEventPosition(event) {
        if (this.inputType === 'touch' && event.touches) {
            const touch = Array.from(event.touches).find(
                t => t.identifier === this.touchIdentifier
            );
            if (touch) return { x: touch.clientX, y: touch.clientY };
            if (event.changedTouches && event.changedTouches.length > 0) {
                const t = event.changedTouches[0];
                return { x: t.clientX, y: t.clientY };
            }
        } else if (this.inputType === 'mouse') {
            return { x: event.clientX, y: event.clientY };
        }
        return { x: 0, y: 0 };
    }
    
    /**
     * Gérer le début du resize
     */
    _handleResizeStart(event) {
        const inputType = this._detectInputType(event);
        if (!inputType) return;
        
        const handle = event.target.closest('.dash-widget-resize-handle');
        if (!handle) return;
        
        const widget = handle.closest(this.options.widgetSelector);
        if (!widget) return;
        
        // Empêcher le drag & drop si on est en train de resize
        event.stopPropagation();
        event.preventDefault();
        
        const pos = this._getEventPosition(event);
        const rect = widget.getBoundingClientRect();
        
        this.isResizing = true;
        this.resizedWidget = widget;
        this.resizeHandle = handle;
        this.startPos = { ...pos };
        this.startSize = {
            width: rect.width,
            height: rect.height
        };
        this.currentPos = { ...pos };
        
        // Préparer le widget
        widget.classList.add('dash-widget-resizing');
        widget.style.transition = 'none';
        document.body.style.cursor = 'nwse-resize';
        document.body.style.userSelect = 'none';
        
        // Attacher listeners globaux
        if (inputType === 'touch') {
            document.addEventListener('touchmove', this._boundHandleResizeMove, { passive: false });
            document.addEventListener('touchend', this._boundHandleResizeEnd, { passive: false });
            document.addEventListener('touchcancel', this._boundHandleResizeEnd, { passive: false });
        } else {
            document.addEventListener('mousemove', this._boundHandleResizeMove);
            document.addEventListener('mouseup', this._boundHandleResizeEnd);
        }
        
        // Haptic feedback
        if (inputType === 'touch' && typeof window.haptic === 'function') {
            window.haptic(10);
        }
    }
    
    /**
     * Gérer le mouvement pendant le resize
     */
    _handleResizeMove(event) {
        if (!this.isResizing || !this.resizedWidget) return;
        
        const pos = this._getEventPosition(event);
        this.currentPos = { ...pos };
        
        // Calculer la nouvelle taille
        const deltaX = pos.x - this.startPos.x;
        const deltaY = pos.y - this.startPos.y;
        
        let newWidth = this.startSize.width + deltaX;
        let newHeight = this.startSize.height + deltaY;
        
        // Appliquer les contraintes min/max
        newWidth = Math.max(this.options.minWidth, newWidth);
        newHeight = Math.max(this.options.minHeight, newHeight);
        
        if (this.options.maxWidth) newWidth = Math.min(this.options.maxWidth, newWidth);
        if (this.options.maxHeight) newHeight = Math.min(this.options.maxHeight, newHeight);
        
        // Calculer les spans grid si snap activé
        if (this.options.gridSnap) {
            const gridCols = this._getGridColumns();
            const colWidth = this._getColumnWidth();
            
            if (colWidth > 0) {
                const spans = Math.max(1, Math.round(newWidth / colWidth));
                newWidth = spans * colWidth - (this.container.style.gap ? parseInt(this.container.style.gap) || 14 : 14);
            }
        }
        
        // Appliquer la nouvelle taille
        this.resizedWidget.style.width = newWidth + 'px';
        this.resizedWidget.style.minWidth = newWidth + 'px';
        this.resizedWidget.style.height = newHeight + 'px';
        this.resizedWidget.style.minHeight = newHeight + 'px';
        
        // Mettre à jour les spans grid si nécessaire
        if (this.options.gridSnap) {
            this._updateGridSpans(this.resizedWidget, newWidth, newHeight);
        }
        
        event.preventDefault();
    }
    
    /**
     * Gérer la fin du resize
     */
    _handleResizeEnd(event) {
        if (!this.isResizing) return;
        
        // Retirer listeners globaux
        document.removeEventListener('mousemove', this._boundHandleResizeMove);
        document.removeEventListener('mouseup', this._boundHandleResizeEnd);
        document.removeEventListener('touchmove', this._boundHandleResizeMove);
        document.removeEventListener('touchend', this._boundHandleResizeEnd);
        document.removeEventListener('touchcancel', this._boundHandleResizeEnd);
        
        // Nettoyer
        if (this.resizedWidget) {
            this.resizedWidget.classList.remove('dash-widget-resizing');
            this.resizedWidget.style.transition = '';
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        // Sauvegarder la taille
        if (this.resizedWidget) {
            this._saveSize(this.resizedWidget);
        }
        
        // Haptic feedback
        if (this.inputType === 'touch' && typeof window.haptic === 'function') {
            window.haptic(20);
        }
        
        // Réinitialiser
        this.isResizing = false;
        this.resizedWidget = null;
        this.resizeHandle = null;
        this.inputType = null;
        this.touchIdentifier = null;
    }
    
    /**
     * Obtenir le nombre de colonnes du grid
     */
    _getGridColumns() {
        const style = window.getComputedStyle(this.container);
        const gridTemplate = style.gridTemplateColumns;
        if (!gridTemplate || gridTemplate === 'none') return 1;
        return gridTemplate.split(' ').length;
    }
    
    /**
     * Obtenir la largeur d'une colonne
     */
    _getColumnWidth() {
        const containerRect = this.container.getBoundingClientRect();
        const cols = this._getGridColumns();
        const gap = parseInt(window.getComputedStyle(this.container).gap) || 14;
        return (containerRect.width - (gap * (cols - 1))) / cols;
    }
    
    /**
     * Mettre à jour les spans grid d'un widget
     */
    _updateGridSpans(widget, width, height) {
        const colWidth = this._getColumnWidth();
        const rowHeight = 100; // Estimation, peut être amélioré
        
        if (colWidth > 0) {
            const colSpans = Math.max(1, Math.round(width / colWidth));
            widget.style.gridColumn = `span ${colSpans}`;
        }
        
        // Pour les lignes, on peut aussi calculer si nécessaire
        // Pour l'instant, on laisse le grid gérer automatiquement
    }
    
    /**
     * Sauvegarder la taille d'un widget
     */
    _saveSize(widget) {
        const widgetId = widget.getAttribute('data-widget-id') || widget.id;
        if (!widgetId) return;
        
        const rect = widget.getBoundingClientRect();
        const sizes = this._loadSizes();
        
        sizes[widgetId] = {
            width: rect.width,
            height: rect.height,
            gridColumnSpan: this._getGridColumns(),
            lastModified: Date.now()
        };
        
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(sizes));
        } catch (e) {
            console.warn('[DashboardResize] Impossible de sauvegarder:', e);
        }
    }
    
    /**
     * Charger les tailles sauvegardées
     */
    _loadSizes() {
        try {
            const data = localStorage.getItem(this.storageKey);
            return data ? JSON.parse(data) : {};
        } catch (e) {
            return {};
        }
    }
    
    /**
     * Restaurer les tailles sauvegardées
     */
    _restoreSizes() {
        const sizes = this._loadSizes();
        const widgets = this.container.querySelectorAll(this.options.widgetSelector);
        
        widgets.forEach(widget => {
            const widgetId = widget.getAttribute('data-widget-id') || widget.id;
            if (!widgetId || !sizes[widgetId]) return;
            
            const size = sizes[widgetId];
            if (size.width) {
                widget.style.width = size.width + 'px';
                widget.style.minWidth = size.width + 'px';
            }
            if (size.height) {
                widget.style.height = size.height + 'px';
                widget.style.minHeight = size.height + 'px';
            }
            if (size.gridColumnSpan) {
                widget.style.gridColumn = `span ${size.gridColumnSpan}`;
            }
        });
    }
}
