# Correctif Dashboard Widgets — V27.0

**Date** : 13 mars 2026  
**Problème** : Le panneau "gamification" (objectifs) disparaissait de temps en temps, et le système de gestion des cartes/widgets sur le dashboard était bugué.

---

## 🐛 Bugs identifiés

### 1. **Widgets qui disparaissent** (CRITIQUE)
- **Cause** : `applyDashboardDisplayPrefs()` masquait les widgets si `getDisplayPref()` retournait `undefined` ou `null`
- **Impact** : Le widget "Objectifs" (gamification) disparaissait aléatoirement

### 2. **Ordre des widgets perdu**
- **Cause** : `saveDashboardWidgetOrder()` excluait les widgets masqués de l'ordre sauvegardé
- **Impact** : Si un widget était masqué temporairement, il perdait sa position dans l'ordre

### 3. **Conflits de timing**
- **Cause** : Bloc en double qui appliquait l'ordre au chargement, en conflit avec le `DOMContentLoaded` principal
- **Impact** : Les widgets étaient réorganisés plusieurs fois, causant des incohérences

### 4. **Adaptatif qui force l'affichage**
- **Cause** : `renderAdaptiveDashboard()` masquait/affichait des widgets sans respecter les préférences utilisateur
- **Impact** : Les préférences d'affichage étaient ignorées par l'adaptatif

### 5. **Widgets non gérés dans l'ordre**
- **Cause** : `applyDashboardWidgetOrder()` ne gérait pas les nouveaux widgets non présents dans l'ordre sauvegardé
- **Impact** : Les nouveaux widgets (Priorités, Analytics) n'apparaissaient pas à la bonne position

---

## ✅ Corrections apportées

### 1. **`applyDashboardDisplayPrefs()` — Gestion robuste**
```javascript
// AVANT : masquait si getDisplayPref() retournait undefined
var on = window.getDisplayPref(item.pref);
(wrapper || el).style.display = on ? '' : 'none';

// APRÈS : valeur par défaut true si préférence non définie
var on = window.getDisplayPref(item.pref);
if (on === undefined || on === null) on = true; // Par défaut visible
target.setAttribute('data-display-pref', on ? '1' : '0');
target.style.display = on ? '' : 'none';
```

**Améliorations** :
- Valeur par défaut `true` si la préférence n'existe pas
- Marqueur `data-display-pref` pour distinguer masquage par préférence vs masquage adaptatif
- Gestion du cas où `getDisplayPref` n'est pas disponible (affiche tous les widgets)

---

### 2. **`saveDashboardWidgetOrder()` — Sauvegarde complète**
```javascript
// AVANT : excluait les widgets masqués
if (id && w.style.display !== 'none') order.push(id);

// APRÈS : sauvegarde TOUS les widgets, même masqués
if (id) {
    order.push(id); // Inclure même si masqué par préférence
}
```

**Améliorations** :
- Préserve l'ordre même si un widget est temporairement masqué
- Permet de réafficher un widget à sa position d'origine

---

### 3. **`applyDashboardWidgetOrder()` — Gestion des nouveaux widgets**
```javascript
// AVANT : ne gérait que les widgets dans l'ordre sauvegardé
order.forEach(function (id) {
    if (byId[id]) container.appendChild(byId[id]);
});

// APRÈS : ajoute les nouveaux widgets à la fin
order.forEach(function (id) {
    if (byId[id]) {
        container.appendChild(byId[id]);
        delete byId[id]; // Marquer comme traité
    }
});
// Ajouter les widgets non dans l'ordre sauvegardé à la fin
Object.keys(byId).forEach(function (id) {
    if (byId[id]) container.appendChild(byId[id]);
});
```

**Améliorations** :
- Gère les nouveaux widgets (Priorités, Analytics) qui ne sont pas dans l'ordre sauvegardé
- Les ajoute à la fin pour ne pas perturber l'ordre existant

---

### 4. **`renderAdaptiveDashboard()` — Respect des préférences**
```javascript
// AVANT : forçait le masquage/affichage
widgetsToHide.forEach(widgetKey => {
    const widget = document.querySelector(`[data-widget-id="${widgetId}"]`);
    if (widget) widget.style.display = 'none';
});

// APRÈS : ne force plus rien, respecte les préférences
// L'adaptatif ne fait que suggérer via les priorités, pas forcer l'affichage
```

**Améliorations** :
- Ne force plus le masquage/affichage des widgets
- Les préférences utilisateur ont toujours la priorité
- L'adaptatif ne fait que suggérer via les priorités du jour

---

### 5. **`renderGoals()` — Vérification avant rendu**
```javascript
// AJOUTÉ : vérifie que le widget n'est pas masqué par préférence
const widget = card.closest('.dash-widget');
if (widget) {
    const isHiddenByPref = widget.getAttribute('data-display-pref') === '0';
    if (isHiddenByPref) {
        return; // Ne pas rendre si masqué intentionnellement
    }
}
```

**Améliorations** :
- Évite de rendre le contenu si le widget est masqué par préférence
- Économise des ressources et évite des erreurs

---

### 6. **Ordre d'exécution corrigé**
```javascript
// AVANT : conflits de timing
// - Bloc en double qui appliquait l'ordre immédiatement
// - DOMContentLoaded qui appliquait aussi l'ordre
// - renderDashboard() qui appliquait les préférences

// APRÈS : ordre séquentiel clair
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Appliquer colonnes et ordre AVANT chargement
    applyDashboardColumns();
    applyDashboardWidgetOrder();
    
    // 2. Charger les données
    await Promise.all([loadDashboard(), loadDashTasks(), loadAdaptiveDashboard()]);
    
    // 3. Appliquer préférences APRÈS chargement (avec timeout pour laisser le DOM se stabiliser)
    setTimeout(function() {
        applyDashboardDisplayPrefs();
        applyDashboardWidgetOrder(); // Réorganiser après préférences
        initDashboardWidgetDragDrop();
    }, 200);
});
```

**Améliorations** :
- Suppression du bloc en double qui causait des conflits
- Ordre séquentiel clair : colonnes → ordre → données → préférences → drag & drop
- Timeout pour laisser le DOM se stabiliser

---

### 7. **Fonction de réinitialisation ajoutée**
```javascript
function resetDashboardWidgets() {
    // Réafficher tous les widgets
    // Réappliquer les préférences
    // Réorganiser selon l'ordre par défaut
    // Réinitialiser le drag & drop
}
window.resetDashboardWidgets = resetDashboardWidgets;
```

**Utilité** : Permet de réinitialiser les widgets en cas de problème (accessible via console : `resetDashboardWidgets()`)

---

## 🧪 Tests effectués

1. ✅ **Widget gamification** : reste visible même après rechargement
2. ✅ **Ordre des widgets** : préservé même si un widget est masqué puis réaffiché
3. ✅ **Drag & drop** : fonctionne correctement sans conflits
4. ✅ **Préférences d'affichage** : respectées même après chargement adaptatif
5. ✅ **Nouveaux widgets** : apparaissent correctement même s'ils ne sont pas dans l'ordre sauvegardé

---

## 📝 Notes techniques

- **Marqueur `data-display-pref`** : permet de distinguer un masquage par préférence utilisateur d'un masquage temporaire
- **Ordre sauvegardé** : inclut maintenant TOUS les widgets, même masqués, pour préserver l'ordre
- **Timing** : les préférences sont appliquées après le chargement des données avec un timeout de 200ms pour laisser le DOM se stabiliser

---

## 🚀 Résultat

Le système de widgets du dashboard est maintenant **stable et fiable** :
- ✅ Le panneau gamification ne disparaît plus
- ✅ L'ordre des widgets est préservé
- ✅ Les préférences d'affichage sont respectées
- ✅ Le drag & drop fonctionne sans conflits
- ✅ Les nouveaux widgets sont gérés correctement

**Version** : 27.0  
**Statut** : ✅ Corrigé et testé
