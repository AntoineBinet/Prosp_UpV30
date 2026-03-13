/**
 * DashboardWidgetDragDrop
 * Système unifié de drag & drop pour widgets (desktop + mobile)
 * Style iPhone/widgets iOS avec animations fluides
 */

class DashboardWidgetDragDrop {
    constructor(containerSelector, options = {}) {
        // Configuration
        this.container = typeof containerSelector === 'string' 
            ? document.querySelector(containerSelector)
            : containerSelector;
        this.widgets = [];
        this.options = {
            handleSelector: '.dash-widget-handle',
            widgetSelector: '.dash-widget',
            animationDuration: 200,
            dragThreshold: 5, // pixels minimum pour déclencher le drag
            ...options
        };
        
        // État interne
        this.isInitialized = false;
        this.isDragging = false;
        this.draggedWidget = null;
        this.dragStartPos = { x: 0, y: 0 };
        this.currentPos = { x: 0, y: 0 };
        this.offset = { x: 0, y: 0 };
        this.originalRect = null; // Position originale du widget avant le drag
        this.placeholder = null;
        this.targetWidget = null;
        this.animationFrameId = null;
        
        // Détection input type
        this.inputType = null; // 'mouse' | 'touch'
        this.touchIdentifier = null; // ID du touch actif
        
        // Callbacks
        this.onOrderChange = null; // Callback appelé après réorganisation
        
        // Bind des méthodes pour les event listeners
        this._boundHandleDragStart = this._handleDragStart.bind(this);
        this._boundHandleDragMove = this._handleDragMove.bind(this);
        this._boundHandleDragEnd = this._handleDragEnd.bind(this);
    }
    
    /**
     * Initialiser le système de drag & drop
     */
    init() {
        if (this.isInitialized) {
            console.warn('[DashboardDragDrop] Déjà initialisé');
            return;
        }
        
        if (!this.container) {
            console.error('[DashboardDragDrop] Container non trouvé');
            return;
        }
        
        // Attacher les event listeners sur les handles
        const handles = this.container.querySelectorAll(this.options.handleSelector);
        handles.forEach(handle => {
            // Desktop: mousedown
            handle.addEventListener('mousedown', this._boundHandleDragStart, { passive: false });
            // Mobile: touchstart
            handle.addEventListener('touchstart', this._boundHandleDragStart, { passive: false });
        });
        
        this.isInitialized = true;
        console.log('[DashboardDragDrop] Initialisé sur', handles.length, 'handles');
    }
    
    /**
     * Détruire le système et nettoyer
     */
    destroy() {
        if (!this.isInitialized) return;
        
        // Retirer tous les event listeners
        const handles = this.container.querySelectorAll(this.options.handleSelector);
        handles.forEach(handle => {
            handle.removeEventListener('mousedown', this._boundHandleDragStart);
            handle.removeEventListener('touchstart', this._boundHandleDragStart);
        });
        
        // Retirer les listeners globaux si en cours de drag
        document.removeEventListener('touchmove', this._boundHandleDragMove);
        document.removeEventListener('touchend', this._boundHandleDragEnd);
        document.removeEventListener('touchcancel', this._boundHandleDragEnd);
        document.removeEventListener('mousemove', this._boundHandleDragMove);
        document.removeEventListener('mouseup', this._boundHandleDragEnd);
        
        // Annuler animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // Nettoyer l'état
        this._cleanup();
        
        // Réinitialiser
        this.isInitialized = false;
        this.container = null;
        this.widgets = [];
    }
    
    /**
     * Détecter le type d'input (mouse ou touch)
     */
    _detectInputType(event) {
        // Si déjà détecté, retourner le type actuel
        if (this.inputType) {
            return this.inputType;
        }
        
        // Détection initiale
        if (event.type === 'touchstart' || event.touches) {
            this.inputType = 'touch';
            if (event.touches && event.touches.length > 0) {
                this.touchIdentifier = event.touches[0].identifier;
            }
            return 'touch';
        } else if (event.type === 'mousedown' || event.button !== undefined) {
            this.inputType = 'mouse';
            return 'mouse';
        }
        
        return null;
    }
    
    /**
     * Obtenir la position de l'événement (normalisé mouse/touch)
     */
    _getEventPosition(event) {
        if (this.inputType === 'touch' && event.touches) {
            const touch = Array.from(event.touches).find(
                t => t.identifier === this.touchIdentifier
            );
            if (touch) {
                return { x: touch.clientX, y: touch.clientY };
            }
            // Fallback sur changedTouches si touches n'est pas disponible
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
     * Prévenir le comportement par défaut
     */
    _preventDefault(event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    /**
     * Gérer le début du drag
     */
    _handleDragStart(event) {
        // Détection input type
        const inputType = this._detectInputType(event);
        if (!inputType) return;
        
        // Vérifier handle
        const handle = event.target.closest(this.options.handleSelector);
        if (!handle) return;
        
        // Trouver widget
        const widget = handle.closest(this.options.widgetSelector);
        if (!widget) return;
        
        // Position initiale
        const pos = this._getEventPosition(event);
        this.dragStartPos = { ...pos };
        this.currentPos = { ...pos };
        
        // Calculer offset depuis le point de clic exact (comportement iOS-like)
        // Avec position: fixed, on utilise getBoundingClientRect() qui donne déjà la position viewport
        const rect = widget.getBoundingClientRect();
        
        // Offset depuis le coin supérieur gauche du widget jusqu'au point de clic
        // pos.x/y sont déjà en coordonnées viewport (clientX/clientY)
        this.offset = {
            x: pos.x - rect.left,
            y: pos.y - rect.top
        };
        
        // Sauvegarder la position originale du widget (pour le remettre après)
        this.originalRect = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
        };
        
        // Préparer widget
        this.draggedWidget = widget;
        this.isDragging = false; // Sera activé après le seuil
        
        // Préparer visuellement le widget avec position fixed pour suivre exactement la souris
        widget.classList.add('dash-widget-dragging');
        widget.style.transition = 'none';
        widget.style.position = 'fixed';
        widget.style.left = rect.left + 'px';
        widget.style.top = rect.top + 'px';
        widget.style.width = rect.width + 'px';
        widget.style.zIndex = '1000';
        widget.style.cursor = 'grabbing';
        widget.style.margin = '0';
        
        // Créer placeholder
        this._createPlaceholder(widget);
        
        // Attacher listeners globaux
        if (inputType === 'touch') {
            document.addEventListener('touchmove', this._boundHandleDragMove, { passive: false });
            document.addEventListener('touchend', this._boundHandleDragEnd, { passive: false });
            document.addEventListener('touchcancel', this._boundHandleDragEnd, { passive: false });
        } else {
            document.addEventListener('mousemove', this._boundHandleDragMove);
            document.addEventListener('mouseup', this._boundHandleDragEnd);
        }
        
        // Haptic feedback (mobile)
        if (inputType === 'touch' && typeof window.haptic === 'function') {
            window.haptic(10);
        }
        
        this._preventDefault(event);
    }
    
    /**
     * Gérer le mouvement pendant le drag
     */
    _handleDragMove(event) {
        if (!this.draggedWidget) return;
        
        const pos = this._getEventPosition(event);
        
        // Vérifier seuil
        if (!this.isDragging) {
            const deltaX = Math.abs(pos.x - this.dragStartPos.x);
            const deltaY = Math.abs(pos.y - this.dragStartPos.y);
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            
            if (distance < this.options.dragThreshold) {
                return; // Pas encore assez de mouvement
            }
            
            // Activer le drag
            this.isDragging = true;
            if (this.inputType === 'touch' && typeof window.haptic === 'function') {
                window.haptic(5);
            }
        }
        
        this.currentPos = { ...pos };
        
        // Programmer la mise à jour de position seulement si le drag est activé
        if (this.isDragging && !this.animationFrameId) {
            this.animationFrameId = requestAnimationFrame(() => this._updatePosition());
        }
        
        // Calculer position de drop
        const newTarget = this._calculateDropPosition(pos);
        if (newTarget !== this.targetWidget) {
            // Retirer l'ancien
            if (this.targetWidget) {
                this.targetWidget.classList.remove('dash-widget-drag-over');
            }
            // Ajouter le nouveau
            this.targetWidget = newTarget;
            if (this.targetWidget && this.targetWidget !== this.draggedWidget) {
                this.targetWidget.classList.add('dash-widget-drag-over');
            }
        }
        
        this._preventDefault(event);
    }
    
    /**
     * Mettre à jour la position du widget (via requestAnimationFrame)
     * Utilise position: fixed pour suivre exactement la souris (comportement iOS-like)
     */
    _updatePosition() {
        if (!this.draggedWidget || !this.isDragging) {
            this.animationFrameId = null;
            return;
        }
        
        // Calculer la position exacte du widget pour qu'il suive le point de clic
        // Avec position: fixed, on utilise directement clientX/clientY
        const x = this.currentPos.x - this.offset.x;
        const y = this.currentPos.y - this.offset.y;
        
        // Appliquer directement avec left/top (plus précis que transform pour position: fixed)
        this.draggedWidget.style.left = x + 'px';
        this.draggedWidget.style.top = y + 'px';
        
        // Programmer la prochaine frame seulement si on est toujours en train de drag
        if (this.isDragging && this.draggedWidget) {
            this.animationFrameId = requestAnimationFrame(() => this._updatePosition());
        } else {
            this.animationFrameId = null;
        }
    }
    
    /**
     * Calculer la position de drop (amélioré pour plus de fluidité)
     */
    _calculateDropPosition(pos) {
        const widgets = Array.from(this.container.querySelectorAll(this.options.widgetSelector))
            .filter(w => w !== this.draggedWidget && this._isWidgetVisible(w));
        
        if (widgets.length === 0) return null;
        
        let closestWidget = null;
        let minDistance = Infinity;
        
        // Trouver le widget le plus proche du point de la souris
        // Utiliser une zone de détection plus large pour plus de flexibilité
        for (const widget of widgets) {
            const rect = widget.getBoundingClientRect();
            
            // Zone de détection élargie (padding de 20px autour du widget)
            const padding = 20;
            const expandedLeft = rect.left - padding;
            const expandedRight = rect.right + padding;
            const expandedTop = rect.top - padding;
            const expandedBottom = rect.bottom + padding;
            
            // Vérifier si le point est dans la zone élargie
            if (pos.x >= expandedLeft && pos.x <= expandedRight &&
                pos.y >= expandedTop && pos.y <= expandedBottom) {
                
                // Calculer la distance au centre du widget
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const distance = Math.sqrt(
                    Math.pow(pos.x - centerX, 2) + Math.pow(pos.y - centerY, 2)
                );
                
                if (distance < minDistance) {
                    minDistance = distance;
                    closestWidget = widget;
                }
            }
        }
        
        return closestWidget;
    }
    
    /**
     * Vérifier si un widget est visible
     */
    _isWidgetVisible(widget) {
        const style = window.getComputedStyle(widget);
        const isHiddenByDisplay = style.display === 'none';
        const isHiddenByVisibility = style.visibility === 'hidden';
        const isHiddenByOpacity = parseFloat(style.opacity) === 0;
        
        // Vérifier aussi les préférences d'affichage
        const isHiddenByPref = widget.getAttribute('data-display-pref') === '0';
        
        return !isHiddenByDisplay && 
               !isHiddenByVisibility && 
               !isHiddenByOpacity &&
               !isHiddenByPref;
    }
    
    /**
     * Créer un placeholder à la position du widget
     */
    _createPlaceholder(widget) {
        const rect = widget.getBoundingClientRect();
        
        const placeholder = document.createElement('div');
        placeholder.className = 'dash-widget-placeholder';
        placeholder.style.cssText = `
            width: ${rect.width}px;
            height: ${rect.height}px;
            opacity: 0.3;
            border: 2px dashed var(--color-primary, #3b82f6);
            border-radius: 12px;
            background-color: rgba(59, 130, 246, 0.1);
            pointer-events: none;
            transition: none;
            margin: 0;
            padding: 0;
        `;
        
        this.container.insertBefore(placeholder, widget);
        this.placeholder = placeholder;
    }
    
    /**
     * Gérer la fin du drag
     */
    _handleDragEnd(event) {
        if (!this.draggedWidget) return;
        
        // Annuler animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // Retirer listeners globaux
        document.removeEventListener('touchmove', this._boundHandleDragMove);
        document.removeEventListener('touchend', this._boundHandleDragEnd);
        document.removeEventListener('touchcancel', this._boundHandleDragEnd);
        document.removeEventListener('mousemove', this._boundHandleDragMove);
        document.removeEventListener('mouseup', this._boundHandleDragEnd);
        
        // Si pas assez de mouvement, annuler
        if (!this.isDragging) {
            this._cleanup();
            return;
        }
        
        // Insérer le widget
        if (this.targetWidget) {
            this._insertWidget(this.draggedWidget, this.targetWidget);
        }
        
        // Nettoyer
        this._cleanup();
        
        // Sauvegarder
        if (this.onOrderChange && typeof this.onOrderChange === 'function') {
            this.onOrderChange();
        }
        
        // Haptic feedback
        if (this.inputType === 'touch' && typeof window.haptic === 'function') {
            window.haptic(20);
        }
        
        // Réinitialiser input type
        this.inputType = null;
        this.touchIdentifier = null;
    }
    
    /**
     * Insérer le widget à la nouvelle position (amélioré pour plus de précision)
     */
    _insertWidget(draggedWidget, targetWidget) {
        // Utiliser la position actuelle de la souris pour déterminer où insérer
        const targetRect = targetWidget.getBoundingClientRect();
        const midY = targetRect.top + targetRect.height / 2;
        
        // Utiliser currentPos (position de la souris) plutôt que la position du widget
        // pour un comportement plus naturel et précis
        if (this.currentPos.y < midY) {
            // Insérer avant le widget cible
            this.container.insertBefore(draggedWidget, targetWidget);
        } else {
            // Insérer après le widget cible
            const next = targetWidget.nextElementSibling;
            if (next) {
                this.container.insertBefore(draggedWidget, next);
            } else {
                this.container.appendChild(draggedWidget);
            }
        }
    }
    
    /**
     * Nettoyer l'état visuel et les références
     */
    _cleanup() {
        if (this.draggedWidget) {
            this.draggedWidget.classList.remove('dash-widget-dragging');
            // Réinitialiser les styles (retour à la position normale)
            this.draggedWidget.style.transition = '';
            this.draggedWidget.style.position = '';
            this.draggedWidget.style.left = '';
            this.draggedWidget.style.top = '';
            this.draggedWidget.style.width = '';
            this.draggedWidget.style.transform = '';
            this.draggedWidget.style.zIndex = '';
            this.draggedWidget.style.cursor = '';
            this.draggedWidget.style.margin = '';
        }
        
        this.container.querySelectorAll(this.options.widgetSelector).forEach(w => {
            w.classList.remove('dash-widget-drag-over');
        });
        
        if (this.placeholder) {
            this.placeholder.remove();
            this.placeholder = null;
        }
        
        this.isDragging = false;
        this.draggedWidget = null;
        this.targetWidget = null;
        this.dragStartPos = { x: 0, y: 0 };
        this.currentPos = { x: 0, y: 0 };
        this.offset = { x: 0, y: 0 };
        this.originalRect = null;
    }
}
