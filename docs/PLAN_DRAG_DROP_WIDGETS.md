# Plan détaillé : Algorithme de Drag & Drop unifié pour widgets Dashboard

## Vue d'ensemble

Conception d'un système de drag & drop unifié pour les widgets du dashboard Prosp'Up, compatible desktop (mouse) et mobile (touch), avec animations fluides style iOS/widgets.

---

## 1. Architecture générale

### 1.1 Structure de classe/module

```javascript
/**
 * DashboardWidgetDragDrop
 * Système unifié de drag & drop pour widgets (desktop + mobile)
 */
class DashboardWidgetDragDrop {
    constructor(containerSelector, options = {}) {
        // Configuration
        this.container = null;
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
        this.placeholder = null;
        this.targetWidget = null;
        this.animationFrameId = null;
        
        // Détection input type
        this.inputType = null; // 'mouse' | 'touch'
        this.touchIdentifier = null; // ID du touch actif
        
        // Callbacks
        this.onOrderChange = null; // Callback appelé après réorganisation
    }
    
    // Méthodes publiques
    init() { /* ... */ }
    destroy() { /* ... */ }
    
    // Méthodes privées
    _detectInputType(event) { /* ... */ }
    _handleDragStart(event) { /* ... */ }
    _handleDragMove(event) { /* ... */ }
    _handleDragEnd(event) { /* ... */ }
    _updatePosition() { /* ... */ }
    _calculateDropPosition() { /* ... */ }
    _createPlaceholder() { /* ... */ }
    _insertWidget() { /* ... */ }
    _cleanup() { /* ... */ }
}
```

---

## 2. Détection automatique Mouse vs Touch

### 2.1 Stratégie de détection

**Principe** : Détecter le type d'input au premier événement (touchstart ou mousedown), puis utiliser uniquement ce type jusqu'à la fin du drag.

```javascript
_detectInputType(event) {
    // Si déjà détecté, retourner le type actuel
    if (this.inputType) {
        return this.inputType;
    }
    
    // Détection initiale
    if (event.type === 'touchstart' || event.touches) {
        this.inputType = 'touch';
        this.touchIdentifier = event.touches[0].identifier;
        return 'touch';
    } else if (event.type === 'mousedown' || event.button !== undefined) {
        this.inputType = 'mouse';
        return 'mouse';
    }
    
    return null;
}
```

### 2.2 Normalisation des événements

**Unification** : Créer des helpers pour normaliser les coordonnées et les événements entre mouse et touch.

```javascript
_getEventPosition(event) {
    if (this.inputType === 'touch' && event.touches) {
        const touch = Array.from(event.touches).find(
            t => t.identifier === this.touchIdentifier
        );
        if (touch) {
            return { x: touch.clientX, y: touch.clientY };
        }
    } else if (this.inputType === 'mouse') {
        return { x: event.clientX, y: event.clientY };
    }
    return { x: 0, y: 0 };
}

_preventDefault(event) {
    event.preventDefault();
    event.stopPropagation();
}
```

---

## 3. Gestion du drag start

### 3.1 Pseudocode

```
FONCTION handleDragStart(event):
    // 1. Détecter le type d'input
    inputType = detectInputType(event)
    SI inputType == null ALORS retourner
    
    // 2. Vérifier que l'événement vient du handle
    handle = event.target.closest(handleSelector)
    SI handle == null ALORS retourner
    
    // 3. Trouver le widget parent
    widget = handle.closest(widgetSelector)
    SI widget == null ALORS retourner
    
    // 4. Vérifier le seuil de mouvement (éviter les clics accidentels)
    startPos = getEventPosition(event)
    dragThreshold = 5 pixels
    
    // 5. Initialiser l'état de drag
    isDragging = false (sera activé après le seuil)
    draggedWidget = widget
    dragStartPos = startPos
    currentPos = startPos
    
    // 6. Calculer l'offset initial (position du widget dans le viewport)
    widgetRect = widget.getBoundingClientRect()
    offset.x = startPos.x - widgetRect.left
    offset.y = startPos.y - widgetRect.top
    
    // 7. Préparer le widget pour le drag
    widget.classList.add('dash-widget-dragging')
    widget.style.transition = 'none' // Désactiver les transitions CSS
    widget.style.zIndex = '1000'
    widget.style.cursor = 'grabbing'
    
    // 8. Créer un placeholder invisible à la position actuelle
    placeholder = createPlaceholder(widget)
    container.insertBefore(placeholder, widget)
    
    // 9. Attacher les listeners de mouvement et fin
    SI inputType == 'touch' ALORS:
        document.addEventListener('touchmove', handleDragMove, { passive: false })
        document.addEventListener('touchend', handleDragEnd, { passive: false })
        document.addEventListener('touchcancel', handleDragEnd, { passive: false })
    SINON:
        document.addEventListener('mousemove', handleDragMove)
        document.addEventListener('mouseup', handleDragEnd)
    
    // 10. Feedback haptique (mobile)
    SI inputType == 'touch' ET haptic disponible ALORS:
        haptic(10)
    
    // 11. Prévenir le comportement par défaut
    preventDefault(event)
FIN
```

### 3.2 Implémentation

```javascript
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
    
    // Calculer offset
    const rect = widget.getBoundingClientRect();
    this.offset = {
        x: pos.x - rect.left,
        y: pos.y - rect.top
    };
    
    // Préparer widget
    this.draggedWidget = widget;
    widget.classList.add('dash-widget-dragging');
    widget.style.transition = 'none';
    widget.style.zIndex = '1000';
    widget.style.cursor = 'grabbing';
    
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
    
    // Haptic feedback
    if (inputType === 'touch' && typeof window.haptic === 'function') {
        window.haptic(10);
    }
    
    this._preventDefault(event);
}
```

---

## 4. Gestion du drag move (avec requestAnimationFrame)

### 4.1 Pseudocode

```
FONCTION handleDragMove(event):
    // 1. Vérifier que le drag est actif
    SI draggedWidget == null ALORS retourner
    
    // 2. Obtenir la position actuelle
    currentPos = getEventPosition(event)
    
    // 3. Vérifier le seuil de mouvement (pour activer le drag)
    SI isDragging == false ALORS:
        deltaX = abs(currentPos.x - dragStartPos.x)
        deltaY = abs(currentPos.y - dragStartPos.y)
        distance = sqrt(deltaX² + deltaY²)
        
        SI distance < dragThreshold ALORS:
            retourner // Attendre plus de mouvement
        
        // Activer le drag
        isDragging = true
        // Feedback haptique léger
        SI inputType == 'touch' ALORS haptic(5)
    
    // 4. Mettre à jour la position actuelle
    currentPos = currentPos
    
    // 5. Calculer la nouvelle position du widget (avec offset)
    newX = currentPos.x - offset.x
    newY = currentPos.y - offset.y
    
    // 6. Appliquer la transformation via requestAnimationFrame
    SI animationFrameId == null ALORS:
        animationFrameId = requestAnimationFrame(updatePosition)
    
    // 7. Calculer la position de drop potentielle
    targetWidget = calculateDropPosition(currentPos)
    
    // 8. Mettre à jour les classes visuelles
    SI targetWidget != null ET targetWidget != draggedWidget ALORS:
        targetWidget.classList.add('dash-widget-drag-over')
    SINON:
        retirer 'dash-widget-drag-over' de tous les widgets
    
    // 9. Prévenir le comportement par défaut (scroll, sélection)
    preventDefault(event)
FIN

FONCTION updatePosition():
    // Appelé par requestAnimationFrame pour animations fluides
    SI draggedWidget == null ALORS:
        animationFrameId = null
        retourner
    
    // Calculer position absolue
    newX = currentPos.x - offset.x
    newY = currentPos.y - offset.y
    
    // Appliquer transform (plus performant que left/top)
    draggedWidget.style.transform = `translate(${newX}px, ${newY}px)`
    
    // Programmer la prochaine frame
    animationFrameId = requestAnimationFrame(updatePosition)
FIN
```

### 4.2 Implémentation

```javascript
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
    
    // Programmer la mise à jour de position
    if (!this.animationFrameId) {
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

_updatePosition() {
    if (!this.draggedWidget) {
        this.animationFrameId = null;
        return;
    }
    
    const x = this.currentPos.x - this.offset.x;
    const y = this.currentPos.y - this.offset.y;
    
    // Utiliser transform pour performance
    this.draggedWidget.style.transform = `translate(${x}px, ${y}px)`;
    
    // Programmer la prochaine frame
    this.animationFrameId = requestAnimationFrame(() => this._updatePosition());
}
```

---

## 5. Calcul de la position de drop

### 5.1 Pseudocode

```
FONCTION calculateDropPosition(mousePos):
    // 1. Obtenir tous les widgets visibles (sauf celui en drag)
    widgets = container.querySelectorAll(widgetSelector)
    visibleWidgets = []
    POUR CHAQUE widget DANS widgets:
        SI widget != draggedWidget ET widget est visible ALORS:
            visibleWidgets.push(widget)
    
    // 2. Trouver le widget le plus proche du point de la souris
    closestWidget = null
    minDistance = Infinity
    
    POUR CHAQUE widget DANS visibleWidgets:
        rect = widget.getBoundingClientRect()
        
        // Calculer la distance au centre du widget
        centerX = rect.left + rect.width / 2
        centerY = rect.top + rect.height / 2
        distance = sqrt((mousePos.x - centerX)² + (mousePos.y - centerY)²)
        
        // Vérifier si le point est dans les limites du widget
        SI mousePos.x >= rect.left ET mousePos.x <= rect.right ET
           mousePos.y >= rect.top ET mousePos.y <= rect.bottom ALORS:
            SI distance < minDistance ALORS:
                minDistance = distance
                closestWidget = widget
    
    // 3. Si aucun widget trouvé, retourner null
    SI closestWidget == null ALORS:
        retourner null
    
    // 4. Déterminer si on insère avant ou après
    rect = closestWidget.getBoundingClientRect()
    midY = rect.top + rect.height / 2
    
    SI mousePos.y < midY ALORS:
        // Insérer avant
        insertionPoint = 'before'
    SINON:
        // Insérer après
        insertionPoint = 'after'
    
    // 5. Gérer le cas des colonnes multiples (grid)
    // Si le grid a plusieurs colonnes, vérifier aussi la position X
    gridCols = getComputedStyle(container).gridTemplateColumns
    SI gridCols contient plusieurs colonnes ALORS:
        midX = rect.left + rect.width / 2
        SI mousePos.x < midX ALORS:
            insertionPoint = 'before'
        SINON:
            insertionPoint = 'after'
    
    retourner { widget: closestWidget, position: insertionPoint }
FIN
```

### 5.2 Implémentation simplifiée

```javascript
_calculateDropPosition(pos) {
    const widgets = Array.from(this.container.querySelectorAll(this.options.widgetSelector))
        .filter(w => w !== this.draggedWidget && this._isWidgetVisible(w));
    
    if (widgets.length === 0) return null;
    
    let closestWidget = null;
    let minDistance = Infinity;
    
    // Trouver le widget le plus proche
    for (const widget of widgets) {
        const rect = widget.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.sqrt(
            Math.pow(pos.x - centerX, 2) + Math.pow(pos.y - centerY, 2)
        );
        
        // Vérifier si le point est dans les limites
        if (pos.x >= rect.left && pos.x <= rect.right &&
            pos.y >= rect.top && pos.y <= rect.bottom) {
            if (distance < minDistance) {
                minDistance = distance;
                closestWidget = widget;
            }
        }
    }
    
    return closestWidget;
}

_isWidgetVisible(widget) {
    const style = window.getComputedStyle(widget);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0';
}
```

---

## 6. Gestion du drag end et insertion

### 6.1 Pseudocode

```
FONCTION handleDragEnd(event):
    // 1. Vérifier que le drag était actif
    SI draggedWidget == null ALORS retourner
    
    // 2. Annuler l'animation frame en cours
    SI animationFrameId != null ALORS:
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
    
    // 3. Retirer les listeners globaux
    document.removeEventListener('touchmove', handleDragMove)
    document.removeEventListener('touchend', handleDragEnd)
    document.removeEventListener('touchcancel', handleDragEnd)
    document.removeEventListener('mousemove', handleDragMove)
    document.removeEventListener('mouseup', handleDragEnd)
    
    // 4. Si le drag n'a pas été activé (pas assez de mouvement), annuler
    SI isDragging == false ALORS:
        cleanup()
        retourner
    
    // 5. Insérer le widget à la nouvelle position
    SI targetWidget != null ALORS:
        insertWidget(draggedWidget, targetWidget)
    SINON:
        // Pas de position valide, remettre à l'ancienne position
        // (le placeholder est toujours là)
    
    // 6. Nettoyer l'état visuel
    cleanup()
    
    // 7. Sauvegarder le nouvel ordre
    saveOrder()
    
    // 8. Feedback haptique
    SI inputType == 'touch' ALORS haptic(20)
    
    // 9. Réinitialiser le type d'input pour le prochain drag
    inputType = null
    touchIdentifier = null
FIN

FONCTION insertWidget(draggedWidget, targetWidget):
    // 1. Calculer la position d'insertion (avant ou après)
    rect = targetWidget.getBoundingClientRect()
    midY = rect.top + rect.height / 2
    
    // Utiliser la position actuelle du widget dragué
    draggedRect = draggedWidget.getBoundingClientRect()
    draggedCenterY = draggedRect.top + draggedRect.height / 2
    
    SI draggedCenterY < midY ALORS:
        // Insérer avant
        container.insertBefore(draggedWidget, targetWidget)
    SINON:
        // Insérer après
        nextSibling = targetWidget.nextElementSibling
        SI nextSibling != null ALORS:
            container.insertBefore(draggedWidget, nextSibling)
        SINON:
            container.appendChild(draggedWidget)
FIN

FONCTION cleanup():
    // 1. Retirer les classes CSS
    SI draggedWidget != null ALORS:
        draggedWidget.classList.remove('dash-widget-dragging')
        draggedWidget.style.transition = '' // Réactiver les transitions
        draggedWidget.style.transform = '' // Retirer le transform
        draggedWidget.style.zIndex = ''
        draggedWidget.style.cursor = ''
    
    // 2. Retirer les classes de tous les widgets
    container.querySelectorAll(widgetSelector).forEach(w => {
        w.classList.remove('dash-widget-drag-over')
    })
    
    // 3. Supprimer le placeholder
    SI placeholder != null ALORS:
        placeholder.remove()
        placeholder = null
    
    // 4. Réinitialiser l'état
    isDragging = false
    draggedWidget = null
    targetWidget = null
    dragStartPos = { x: 0, y: 0 }
    currentPos = { x: 0, y: 0 }
    offset = { x: 0, y: 0 }
FIN
```

### 6.2 Implémentation

```javascript
_handleDragEnd(event) {
    if (!this.draggedWidget) return;
    
    // Annuler animation frame
    if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }
    
    // Retirer listeners
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
    if (this.onOrderChange) {
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

_insertWidget(draggedWidget, targetWidget) {
    const targetRect = targetWidget.getBoundingClientRect();
    const draggedRect = draggedWidget.getBoundingClientRect();
    const midY = targetRect.top + targetRect.height / 2;
    const draggedCenterY = draggedRect.top + draggedRect.height / 2;
    
    if (draggedCenterY < midY) {
        this.container.insertBefore(draggedWidget, targetWidget);
    } else {
        const next = targetWidget.nextElementSibling;
        if (next) {
            this.container.insertBefore(draggedWidget, next);
        } else {
            this.container.appendChild(draggedWidget);
        }
    }
}

_cleanup() {
    if (this.draggedWidget) {
        this.draggedWidget.classList.remove('dash-widget-dragging');
        this.draggedWidget.style.transition = '';
        this.draggedWidget.style.transform = '';
        this.draggedWidget.style.zIndex = '';
        this.draggedWidget.style.cursor = '';
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
}
```

---

## 7. Création du placeholder

### 7.1 Pseudocode

```
FONCTION createPlaceholder(widget):
    // 1. Obtenir les dimensions du widget
    rect = widget.getBoundingClientRect()
    
    // 2. Créer un élément placeholder invisible
    placeholder = document.createElement('div')
    placeholder.className = 'dash-widget-placeholder'
    placeholder.style.width = rect.width + 'px'
    placeholder.style.height = rect.height + 'px'
    placeholder.style.opacity = '0.3'
    placeholder.style.border = '2px dashed var(--color-primary)'
    placeholder.style.borderRadius = '12px'
    placeholder.style.backgroundColor = 'rgba(var(--color-primary-rgb), 0.1)'
    placeholder.style.pointerEvents = 'none'
    placeholder.style.transition = 'none'
    
    // 3. Insérer le placeholder à la position du widget
    container.insertBefore(placeholder, widget)
    
    retourner placeholder
FIN
```

### 7.2 Implémentation

```javascript
_createPlaceholder(widget) {
    const rect = widget.getBoundingClientRect();
    
    const placeholder = document.createElement('div');
    placeholder.className = 'dash-widget-placeholder';
    placeholder.style.cssText = `
        width: ${rect.width}px;
        height: ${rect.height}px;
        opacity: 0.3;
        border: 2px dashed var(--color-primary);
        border-radius: 12px;
        background-color: rgba(var(--color-primary-rgb, 59, 130, 246), 0.1);
        pointer-events: none;
        transition: none;
        margin: 0;
        padding: 0;
    `;
    
    this.container.insertBefore(placeholder, widget);
    this.placeholder = placeholder;
}
```

---

## 8. Intégration avec le système existant

### 8.1 Remplacement de l'ancien système

```javascript
// Dans page-dashboard.js

// Remplacer initDashboardWidgetDragDrop() par :
function initDashboardWidgetDragDrop() {
    const container = document.getElementById('dashWidgetsContainer');
    if (!container) {
        console.warn('[Dashboard] dashWidgetsContainer non trouvé');
        return;
    }
    
    // Détruire l'ancienne instance si elle existe
    if (window._dashboardDragDropInstance) {
        window._dashboardDragDropInstance.destroy();
    }
    
    // Créer nouvelle instance
    window._dashboardDragDropInstance = new DashboardWidgetDragDrop('#dashWidgetsContainer', {
        handleSelector: '.dash-widget-handle',
        widgetSelector: '.dash-widget',
        dragThreshold: 5,
        animationDuration: 200
    });
    
    // Callback pour sauvegarder l'ordre
    window._dashboardDragDropInstance.onOrderChange = function() {
        saveDashboardWidgetOrder();
        if (typeof window.haptic === 'function') {
            window.haptic(20);
        }
    };
    
    // Initialiser
    window._dashboardDragDropInstance.init();
}
```

### 8.2 Méthode destroy()

```javascript
destroy() {
    if (!this.isInitialized) return;
    
    // Retirer tous les event listeners
    const handles = this.container.querySelectorAll(this.options.handleSelector);
    handles.forEach(handle => {
        handle.removeEventListener('touchstart', this._boundHandleDragStart);
        handle.removeEventListener('mousedown', this._boundHandleDragStart);
    });
    
    // Nettoyer l'état
    this._cleanup();
    
    // Réinitialiser
    this.isInitialized = false;
    this.container = null;
    this.widgets = [];
}
```

---

## 9. Styles CSS supplémentaires

### 9.1 Placeholder

```css
.dash-widget-placeholder {
    opacity: 0.3;
    border: 2px dashed var(--color-primary);
    border-radius: 12px;
    background-color: rgba(var(--color-primary-rgb, 59, 130, 246), 0.1);
    pointer-events: none;
    transition: none;
    margin: 0;
    padding: 0;
}
```

### 9.2 Amélioration du widget en drag

```css
.dash-widget.dash-widget-dragging {
    opacity: 0.9;
    transform: scale(1.02) rotate(0.5deg);
    box-shadow: 0 20px 50px rgba(0,0,0,0.4), 0 0 0 3px var(--color-primary);
    z-index: 1000;
    transition: none !important; /* Important pour override */
    cursor: grabbing !important;
    border-radius: 12px;
    will-change: transform; /* Optimisation performance */
}
```

---

## 10. Gestion des widgets masqués

### 10.1 Respect des préférences

Le système doit **ignorer les widgets masqués** lors du calcul de position, mais **préserver leur ordre** dans localStorage.

```javascript
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
```

---

## 11. Compatibilité avec les colonnes multiples

### 11.1 Calcul adaptatif selon le nombre de colonnes

```javascript
_calculateDropPosition(pos) {
    // ... code existant ...
    
    // Si plusieurs colonnes, prendre en compte aussi la position X
    const gridCols = window.getComputedStyle(this.container).gridTemplateColumns;
    const numCols = gridCols.split(' ').length;
    
    if (numCols > 1 && closestWidget) {
        const rect = closestWidget.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const midY = rect.top + rect.height / 2;
        
        // Déterminer la position d'insertion
        if (pos.y < midY) {
            // Au-dessus
            return closestWidget;
        } else if (pos.y > midY && pos.x < midX) {
            // En dessous, à gauche
            return closestWidget;
        } else {
            // En dessous, à droite
            return closestWidget;
        }
    }
    
    return closestWidget;
}
```

---

## 12. Points d'attention et optimisations

### 12.1 Performance

- ✅ Utiliser `transform` au lieu de `left/top` (GPU-accelerated)
- ✅ Utiliser `requestAnimationFrame` pour animations fluides
- ✅ Éviter les recalculs de layout inutiles
- ✅ Utiliser `will-change: transform` sur le widget en drag

### 12.2 Accessibilité

- ✅ Préserver le `draggable="true"` pour compatibilité
- ✅ Ajouter `aria-grabbed="true"` pendant le drag
- ✅ Gérer le focus keyboard (optionnel, pour future amélioration)

### 12.3 Gestion d'erreurs

- ✅ Vérifier l'existence du container avant initialisation
- ✅ Gérer les cas où le widget est supprimé pendant le drag
- ✅ Nettoyer proprement en cas d'erreur

---

## 13. Structure de fichiers proposée

```
static/js/
  ├── page-dashboard.js (modifié - utilise le nouveau système)
  └── dashboard-widget-dragdrop.js (nouveau - classe unifiée)

static/css/
  └── style.css (ajout styles placeholder + améliorations)
```

---

## 14. Plan d'implémentation

1. **Phase 1** : Créer la classe `DashboardWidgetDragDrop` dans un nouveau fichier
2. **Phase 2** : Implémenter la détection mouse/touch
3. **Phase 3** : Implémenter le drag start avec seuil
4. **Phase 4** : Implémenter le drag move avec requestAnimationFrame
5. **Phase 5** : Implémenter le calcul de position de drop
6. **Phase 6** : Implémenter le drag end et insertion
7. **Phase 7** : Intégrer avec le système existant (remplacer initDashboardWidgetDragDrop)
8. **Phase 8** : Ajouter les styles CSS
9. **Phase 9** : Tests desktop (Chrome, Firefox, Safari)
10. **Phase 10** : Tests mobile (iOS Safari, Chrome Android)
11. **Phase 11** : Vérifier la sauvegarde localStorage
12. **Phase 12** : Vérifier le respect des préférences d'affichage

---

## 15. Tests à effectuer

### Desktop
- [ ] Drag & drop avec souris fonctionne
- [ ] Feedback visuel clair (widget en drag, placeholder, zones de drop)
- [ ] Animations fluides (60fps)
- [ ] Sauvegarde automatique de l'ordre
- [ ] Compatible avec 1, 2, 3 colonnes

### Mobile
- [ ] Drag & drop avec touch fonctionne
- [ ] Pas de scroll accidentel pendant le drag
- [ ] Feedback haptique présent
- [ ] Seuil de mouvement évite les clics accidentels
- [ ] Compatible avec différentes tailles d'écran

### Cas limites
- [ ] Widget supprimé pendant le drag
- [ ] Changement de nombre de colonnes pendant le drag
- [ ] Widget masqué par préférences (ignoré dans le calcul)
- [ ] Drag très rapide (pas de lag)
- [ ] Drag très lent (animations fluides)

---

## Conclusion

Ce plan détaille un système unifié de drag & drop qui :
- ✅ Supporte desktop (mouse) ET mobile (touch)
- ✅ Utilise `requestAnimationFrame` pour animations fluides
- ✅ Ne clone pas les éléments (pas destructif)
- ✅ Gère proprement les événements (pas de doublons)
- ✅ Compatible avec le système de colonnes
- ✅ Sauvegarde automatique dans localStorage
- ✅ Respecte les préférences d'affichage

Le système est modulaire, testable et maintenable.
