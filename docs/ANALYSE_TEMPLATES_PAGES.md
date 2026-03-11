# Analyse des pages index.html et dashboard.html pour extraction des blocs Jinja2

## Vue d'ensemble

Cette analyse identifie le contenu spécifique à chaque page qui doit être extrait dans des blocs Jinja2 :
- `{% block content %}` : contenu principal dans `<main class="content">`
- `{% block modals %}` : modales spécifiques à la page
- `{% block page_scripts %}` : scripts JavaScript spécifiques à la page
- Différences dans le `<head>` : scripts externes, styles, etc.

---

## index.html (Page Prospects)

### 1. {% block content %} — Contenu principal

**Localisation** : lignes 25-286 (tout ce qui est dans `<main class="content">`)

```html
<div id="viewProspects" style="display: block;">
    <!-- Bannière alerte relances -->
    <div id="relanceAlertBannerProspects" class="relance-alert-banner" style="display:none; margin-bottom:12px;" aria-live="polite">
        <span id="relanceAlertBannerProspectsText"></span>
        <a href="/focus" class="relance-alert-banner-link">Voir Focus →</a>
        <button type="button" class="relance-alert-banner-close" onclick="document.getElementById('relanceAlertBannerProspects').style.display='none'; sessionStorage.setItem('relanceAlertDismissed', Date.now());" title="Masquer">×</button>
    </div>
    
    <!-- Header avec titre, recherche, filtres -->
    <div class="content-header">
        <div class="content-title" id="viewTitle">👥 Tous les prospects</div>
        
        <div class="controls" id="mainControls">
            <input type="text" id="searchInput" placeholder="🔍 Rechercher (nom, entreprise…)">
            <button class="btn btn-secondary filter-toggle-btn" id="btnToggleFilters" type="button" title="Afficher les filtres" data-help-section="prospects">⚙️ Filtres</button>
            <div id="activeFilterChips" class="filter-chips-bar"></div>
        </div>

        <!-- Panel de filtres complet (lignes 41-151) -->
        <div id="filterPanel" class="filter-panel" style="display:none;">
            <!-- ... tous les filtres (entreprise, statut, pertinence, téléphone, email, LinkedIn, push email, relance, priorité, compétences) ... -->
        </div>

        <!-- Toolbar avec vues, export, import, etc. -->
        <div class="toolbar-row">
            <select id="savedViewSelect" title="Vues enregistrées"><option value="">Vues…</option></select>
            <button class="btn btn-secondary" id="btnSaveView" type="button" title="Enregistrer la vue courante">💾 Vue</button>
            <button class="btn btn-secondary" id="btnDeleteView" type="button" title="Supprimer la vue sélectionnée">🗑️ Suppr.</button>
            <button class="btn btn-secondary" onclick="openStatsModal()" aria-label="Statistiques">📊 Stats</button>
            <div class="export-dropdown" id="exportDropdown">
                <!-- Menu export -->
            </div>
            <button class="btn btn-secondary" onclick="openImportListModal()" title="Importer Excel ou CSV" data-help-section="parametres">📥 Importer ma liste</button>
            <button class="btn btn-primary" onclick="openQuickAddModal()" title="Ajouter via IA" data-help-section="ajout-ia" style="padding:6px 14px;font-size:13px;">🚀 Ajout IA</button>
            <div class="view-toggle" id="viewToggle">
                <!-- Boutons vue tableau/Kanban/Prosp -->
            </div>
        </div>

        <!-- Actions en masse -->
        <div class="bulk-actions" id="bulkActions" style="display:none;">
            <!-- ... actions bulk (statut, pertinence, relance, export, IA, suppression) ... -->
        </div>

        <!-- Stats cards -->
        <div class="stats">
            <div class="stat-card" onclick="quickFilterStat('total')" title="Afficher tous les prospects">
                <div class="stat-number" id="totalCount">0</div>
                <div class="stat-label">TOTAL</div>
            </div>
            <!-- ... autres stat-cards (appelables, rdv, interactions) ... -->
        </div>
    </div>

    <!-- CTA mobile Mode Prosp -->
    <div class="prosp-cta-mobile" id="prospCtaMobile">
        <button class="btn btn-primary prosp-cta-btn" type="button" onclick="switchTableKanban('prosp')" title="Défiler les prospects un par un">🃏 Mode Prosp</button>
    </div>
    
    <!-- Bannière reprise session Prosp -->
    <div id="prospResumeBanner" class="prosp-resume-banner" aria-live="polite">
        <span class="prosp-resume-text">Mode Prosp interrompu.</span>
        <button type="button" class="btn btn-primary btn-sm" onclick="resumeProspSession()">Reprendre</button>
        <button type="button" class="prosp-resume-dismiss" onclick="dismissProspResumeBanner()" title="Fermer">×</button>
    </div>

    <!-- Tableau des prospects -->
    <div class="table-toolbar" style="display:flex;justify-content:flex-end;margin-bottom:6px;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="resetProspectColumnWidths()" title="Réinitialiser les largeurs des colonnes du tableau">↺ Réinitialiser colonnes</button>
    </div>
    <div class="table-wrapper" id="tableView">
        <table>
            <thead>
                <tr>
                    <!-- Colonnes : checkbox, #, Nom, Entreprise, Fonction, Pertinence, Score, Statut, Dernier Contact, Email, Push, Relance, Actions -->
                </tr>
            </thead>
            <tbody id="tableBody">
            </tbody>
        </table>
    </div>
    <div id="paginationControls"></div>

    <!-- Vue Kanban -->
    <div class="kanban-board" id="kanbanView" style="display:none;"></div>
</div>
```

**Note** : Le FAB (Floating Action Button) pour ajouter un prospect (lignes 497-500) est aussi spécifique à cette page.

---

### 2. {% block modals %} — Modales spécifiques

**Localisation** : lignes 289-490 (toutes les modales après la fermeture de `</main>`)

```html
<!-- Modal Prospect (ajout/édition) -->
<div class="modal" role="dialog" aria-modal="true" id="modalProspect">
    <div class="modal-content">
        <div class="modal-header">
            <span id="modalTitle">Ajouter Prospect</span>
            <button class="modal-close" onclick="closeModal()" aria-label="Fermer">&times;</button>
        </div>
        <form id="prospectForm" onsubmit="saveProspect(event)">
            <!-- Champs : Nom, Entreprise, Fonction, Téléphone, Email, LinkedIn, Pertinence, Statut, Notes -->
        </form>
    </div>
</div>

<!-- Modal Détail Prospect -->
<div class="modal" role="dialog" aria-modal="true" id="modalDetail">
    <div class="modal-content">
        <div class="modal-header">
            <span>Détail du Prospect</span>
            <button class="modal-close" onclick="closeDetail()">&times;</button>
        </div>
        <div id="detailContent"></div>
    </div>
</div>

<!-- Modal Statistiques -->
<div class="modal" role="dialog" aria-modal="true" id="modalStats">
    <div class="modal-content">
        <div class="modal-header">
            <span>📊 Statistiques</span>
            <button class="modal-close" onclick="closeStatsModal()">&times;</button>
        </div>
        <div id="statsContent"></div>
    </div>
</div>

<!-- Modal Entreprise -->
<div class="modal" role="dialog" aria-modal="true" id="modalCompany">
    <div class="modal-content">
        <div class="modal-header">
            <span id="companyModalTitle">Ajouter Entreprise</span>
            <button class="modal-close" onclick="closeCompanyModal()">&times;</button>
        </div>
        <form id="companyForm" onsubmit="saveCompany(event)">
            <!-- Champs : Nom Groupe, Site, Téléphone, Notes, Tags, Section IA -->
        </form>
    </div>
</div>

<!-- Modal Choix numéro (appel) -->
<div class="modal" role="dialog" aria-modal="true" id="modalCallChoice">
    <div class="modal-content" style="max-width: 420px;">
        <div class="modal-header">
            <span>Choisir un numéro</span>
            <button class="modal-close" onclick="closeCallChoice()">×</button>
        </div>
        <div class="modal-body">
            <div id="callChoiceList" style="display: flex; flex-direction: column; gap: 10px;"></div>
        </div>
    </div>
</div>

<!-- Modal Quick Add IA -->
<div class="modal" role="dialog" aria-modal="true" id="modalQuickAdd">
    <div class="modal-content" style="max-width:560px;position:relative;">
        <!-- Overlay Ollama -->
        <div id="qaOllamaOverlay" style="display:none;...">
            <!-- Message de chargement -->
        </div>
        <div class="modal-header">
            <span>➕ Ajouter via IA</span>
            <button class="modal-close" onclick="closeQuickAddModal()">&times;</button>
        </div>
        <!-- Étape 1 : Type + Contexte -->
        <div id="qaStep1" style="padding:16px 0 0;">
            <!-- Choix type (Prospect/Entreprise/Candidat) -->
            <!-- Contexte pour l'IA -->
            <!-- Boutons génération -->
        </div>
        <!-- Étape 2 : Coller retour IA -->
        <div id="qaStep3Paste" style="display:none;...">
            <!-- Textarea pour coller JSON -->
        </div>
        <!-- Étape 3 : Aperçu -->
        <div id="qaStep4Preview" style="display:none;...">
            <!-- Liste d'aperçu -->
        </div>
    </div>
</div>

<!-- Styles spécifiques Quick Add -->
<style>
    .qa-card:hover, .qa-card.active { ... }
    .qa-card.active::after { ... }
</style>

<!-- FAB Ajouter prospect -->
<button class="fab" id="fabAdd" onclick="openAddModal()" title="Ajouter un prospect">
    <span class="fab-icon">+</span>
    <span class="fab-label">Prospect</span>
</button>
```

**Note** : Les modales d'import de liste et bulk IA sont probablement gérées par `app.js` et ne sont pas dans le HTML statique.

---

### 3. {% block page_scripts %} — Scripts spécifiques

**Localisation** : lignes 502-509 (avant `</body>`)

```html
<script defer src="/static/js/metiers-data.js?v=2000"></script>
<script defer src="/static/js/sidebar.js?v=2000"></script>
<script defer src="/static/js/v8-features.js?v=2100"></script>
<script defer src="/static/js/help-shortcut.js?v=2000"></script>
<script defer src="/static/js/notifications.js?v=2000"></script>
<script defer src="/static/js/app.js?v=2104"></script>
<script defer src="/static/js/page-prospects.js?v=2000"></script>
<script defer src="/static/js/page-quickadd.js?v=2000"></script>
```

**Scripts spécifiques à la page Prospects** :
- `page-prospects.js` — logique spécifique prospects
- `page-quickadd.js` — logique Quick Add IA
- `metiers-data.js` — données métiers (utilisé pour les tags/compétences)

**Scripts communs** (peuvent être dans le template de base) :
- `sidebar.js` — sidebar
- `v8-features.js` — features transversales
- `help-shortcut.js` — aide
- `notifications.js` — notifications push
- `app.js` — logique globale

---

### 4. Différences dans le <head>

**Ligne 15** : Script externe XLSX (pour import/export Excel)

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.min.js"></script>
```

**Autres éléments du head** (communs) :
- Meta tags (charset, viewport, apple-mobile-web-app, theme-color, description)
- Links (manifest, apple-touch-icon, favicon)
- Title : "Prosp'Up — Gestion Prospects"
- CSS : `/static/css/style.css?v=2104`

**Attribut body** : `data-page="prospects"` (ligne 17)

---

## dashboard.html (Page Dashboard)

### 1. {% block content %} — Contenu principal

**Localisation** : lignes 26-164 (tout ce qui est dans `<main class="content">`)

```html
<!-- Bannière alerte relances -->
<div id="relanceAlertBanner" class="relance-alert-banner" style="display:none;" aria-live="polite">
    <span id="relanceAlertBannerText"></span>
    <a href="/focus" class="relance-alert-banner-link">Voir Focus →</a>
    <button type="button" class="relance-alert-banner-close" onclick="document.getElementById('relanceAlertBanner').style.display='none'; sessionStorage.setItem('relanceAlertDismissed', Date.now());" title="Masquer">×</button>
</div>

<!-- KPI Cards row -->
<div class="dash-kpi-row" id="dashKpiRow">
    <div class="skeleton skeleton-kpi" style="flex:1"></div>
    <div class="skeleton skeleton-kpi" style="flex:1"></div>
    <div class="skeleton skeleton-kpi" style="flex:1"></div>
    <div class="skeleton skeleton-kpi" style="flex:1"></div>
</div>
<div class="dash-kpi-actions" id="dashKpiActionsRow">
    <button class="kpi-manual-btn" onclick="openManualKpiModal()" title="Ajouter manuellement une action KPI">➕ Ajout KPI manuel</button>
</div>

<!-- Zone widgets réorganisables -->
<div id="dashWidgetsContainer" class="dash-widgets-container">
    <!-- Widget Premier coup d'œil -->
    <div class="dash-widget" data-widget-id="dashFirstGlance">
        <span class="dash-widget-handle" draggable="true" title="Glisser pour réorganiser">⋮⋮</span>
        <div class="card dash-first-glance" id="dashFirstGlance" style="margin-bottom:0;">
            <div class="dash-first-glance-title">👀 Premier coup d'œil</div>
            <div id="dashFirstGlanceItems" class="dash-first-glance-items"></div>
            <div class="dash-first-glance-links">
                <a href="/rapport" class="dash-first-glance-link">📋 Rapport hebdo (cette semaine)</a>
                <button type="button" class="btn btn-secondary btn-sm" id="btnExportDay" onclick="exportDayRecap()" title="Télécharger le récap du jour (JSON)">📥 Ma journée</button>
            </div>
        </div>
    </div>
    
    <!-- Widget Objectifs -->
    <div class="dash-widget" data-widget-id="dashGoalsCard">
        <span class="dash-widget-handle" draggable="true" title="Glisser pour réorganiser">⋮⋮</span>
        <div class="card dash-card dash-goals-card" id="dashGoalsCard">
            <div class="dash-confetti-layer" id="dashGoalsConfetti"></div>
            <div class="dash-goals-head">
                <div>
                    <div class="dash-card-title">🎮 Objectifs (Jour & Semaine)</div>
                    <div class="dash-card-sub muted">XP, progression & animation quand c'est validé</div>
                </div>
                <a class="dash-card-link" href="/parametres#goals" title="Configurer les objectifs">⚙️</a>
            </div>
            <div class="dash-goals-body">
                <div class="dash-goals-skeleton muted">Chargement des objectifs…</div>
            </div>
        </div>
    </div>
    
    <!-- Widget Activité du jour -->
    <div class="dash-widget" data-widget-id="dashFeedCard">
        <span class="dash-widget-handle" draggable="true" title="Glisser pour réorganiser">⋮⋮</span>
        <div class="card dash-card" id="dashFeedCard">
            <div class="dash-card-title">🕐 Activité du jour</div>
            <div id="dashFeed"></div>
        </div>
    </div>
    
    <!-- Widget Tâches -->
    <div class="dash-widget" data-widget-id="dashTasksCard">
        <span class="dash-widget-handle" draggable="true" title="Glisser pour réorganiser">⋮⋮</span>
        <div class="card dash-card" id="dashTasksCard">
            <div class="dash-card-head-row">
                <div class="dash-card-title">✅ Tâches</div>
                <a href="/focus" class="btn btn-primary btn-sm" style="text-decoration:none;font-size:11px;">➕ Ajouter</a>
            </div>
            <div id="dashTasks"><div class="muted" style="padding:12px;text-align:center;">Chargement…</div></div>
        </div>
    </div>
    
    <!-- Widget Activité de la semaine -->
    <div class="dash-widget" data-widget-id="dashWeekChartCard">
        <span class="dash-widget-handle" draggable="true" title="Glisser pour réorganiser">⋮⋮</span>
        <div class="card dash-card" id="dashWeekChartCard">
            <div class="dash-card-title">📅 Activité de la semaine</div>
            <div id="dashWeekChart" class="dash-week-chart"></div>
            <div id="dashWeekSummary" class="dash-week-summary muted"></div>
        </div>
    </div>
    
    <!-- Widget Relances en retard -->
    <div class="dash-widget" data-widget-id="dashOverdueCard">
        <span class="dash-widget-handle" draggable="true" title="Glisser pour réorganiser">⋮⋮</span>
        <div class="card dash-card" id="dashOverdueCard">
            <div class="dash-card-title">⚠️ Relances en retard</div>
            <div id="dashOverdue"></div>
        </div>
    </div>
    
    <!-- Widget Prochains RDV -->
    <div class="dash-widget" data-widget-id="dashRdvCard">
        <span class="dash-widget-handle" draggable="true" title="Glisser pour réorganiser">⋮⋮</span>
        <div class="card dash-card" id="dashRdvCard">
            <div class="dash-card-title">🤝 Prochains RDV</div>
            <div id="dashUpcomingRdv"></div>
        </div>
    </div>
    
    <!-- Widget Pipeline -->
    <div class="dash-widget" data-widget-id="dashPipelineCard">
        <span class="dash-widget-handle" draggable="true" title="Glisser pour réorganiser">⋮⋮</span>
        <div class="card dash-card" id="dashPipelineCard">
            <div class="dash-card-title">🎯 Pipeline</div>
            <div id="dashPipeline"></div>
        </div>
    </div>
</div>
```

---

### 2. {% block modals %} — Modales spécifiques

**Localisation** : lignes 125-162 (dans `<main class="content">`, juste avant la fermeture de `</main>`)

```html
<!-- Manual KPI Modal -->
<div class="modal" role="dialog" aria-modal="true" id="manualKpiModal" style="display:none;">
    <div class="modal-content" style="max-width:440px;">
        <div class="modal-header">
            <span>➕ Ajouter une action KPI manuellement</span>
            <button class="modal-close" onclick="closeManualKpiModal()">×</button>
        </div>
        <div style="padding:16px 0;">
            <p class="muted" style="font-size:13px;margin-bottom:14px;">Enregistrer une action effectuée hors de l'application.</p>
            <div class="form-group" style="margin-bottom:12px;">
                <label style="font-weight:600;font-size:13px;">Type d'action</label>
                <select id="manualKpiType" class="filter-select" style="width:100%;margin-top:4px;">
                    <option value="contact">📞 Contact / Appel</option>
                    <option value="rdv">🤝 Rendez-vous</option>
                    <option value="push_email">✉️ Push Email</option>
                    <option value="push_linkedin">📋 Push LinkedIn</option>
                    <option value="sourcing">🧲 Sourcing</option>
                    <option value="note">📝 Note / Action</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom:12px;">
                <label style="font-weight:600;font-size:13px;">Date</label>
                <input type="date" id="manualKpiDate" class="filter-select" style="width:100%;margin-top:4px;">
            </div>
            <div class="form-group" style="margin-bottom:12px;">
                <label style="font-weight:600;font-size:13px;">Quantité</label>
                <input type="number" id="manualKpiCount" value="1" min="1" max="50" class="filter-select" style="width:100%;margin-top:4px;">
            </div>
            <div class="form-group" style="margin-bottom:16px;">
                <label style="font-weight:600;font-size:13px;">Description (optionnel)</label>
                <input type="text" id="manualKpiDesc" placeholder="Ex: RDV chez client X" class="filter-select" style="width:100%;margin-top:4px;">
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button class="btn btn-secondary" onclick="closeManualKpiModal()">Annuler</button>
                <button class="btn btn-primary" onclick="saveManualKpi()">✅ Enregistrer</button>
            </div>
        </div>
    </div>
</div>
```

**Note** : Cette modale est la seule modale spécifique au dashboard. Elle est placée à l'intérieur de `<main class="content">` dans le HTML actuel, mais devrait être dans `{% block modals %}` pour la cohérence.

---

### 3. {% block page_scripts %} — Scripts spécifiques

**Localisation** : lignes 167-173 (avant `</body>`)

```html
<script defer src="/static/js/sidebar.js?v=2000"></script>
<script defer src="/static/js/v8-features.js?v=2100"></script>
<script defer src="/static/js/help-shortcut.js?v=2000"></script>
<script defer src="/static/js/notifications.js?v=2000"></script>
<script defer src="/static/js/app.js?v=2103"></script>
<script defer src="/static/js/page-dashboard.js?v=2000"></script>
```

**Scripts spécifiques à la page Dashboard** :
- `page-dashboard.js` — logique spécifique dashboard

**Scripts communs** (peuvent être dans le template de base) :
- `sidebar.js` — sidebar
- `v8-features.js` — features transversales
- `help-shortcut.js` — aide
- `notifications.js` — notifications push
- `app.js` — logique globale

**Note** : Pas de `metiers-data.js` ni `page-quickadd.js` sur le dashboard.

---

### 4. Différences dans le <head>

**Pas de script externe XLSX** (contrairement à index.html)

**Autres éléments du head** (communs) :
- Meta tags (charset, viewport, apple-mobile-web-app, theme-color, description)
- Links (manifest, apple-touch-icon, favicon)
- Title : "ProspUp — dashboard"
- CSS : `/static/css/style.css?v=2103` (version différente de index.html)

**Attribut body** : `data-page="dashboard"` (ligne 16)

---

## Résumé des différences

### Head
| Élément | index.html | dashboard.html |
|---------|------------|----------------|
| Script XLSX | ✅ Oui (ligne 15) | ❌ Non |
| Version CSS | `v=2104` | `v=2103` |
| Title | "Prosp'Up — Gestion Prospects" | "ProspUp — dashboard" |

### Body
| Attribut | index.html | dashboard.html |
|----------|------------|----------------|
| `data-page` | `"prospects"` | `"dashboard"` |

### Scripts spécifiques
| Script | index.html | dashboard.html |
|--------|------------|----------------|
| `page-prospects.js` | ✅ | ❌ |
| `page-quickadd.js` | ✅ | ❌ |
| `metiers-data.js` | ✅ | ❌ |
| `page-dashboard.js` | ❌ | ✅ |

### Modales spécifiques
| Modale | index.html | dashboard.html |
|--------|------------|----------------|
| `modalProspect` | ✅ | ❌ |
| `modalDetail` | ✅ | ❌ |
| `modalStats` | ✅ | ❌ |
| `modalCompany` | ✅ | ❌ |
| `modalCallChoice` | ✅ | ❌ |
| `modalQuickAdd` | ✅ | ❌ |
| `manualKpiModal` | ❌ | ✅ |

### FAB (Floating Action Button)
| Élément | index.html | dashboard.html |
|---------|------------|----------------|
| FAB Ajouter prospect | ✅ | ❌ |

---

## Recommandations pour le template de base

### Structure proposée

```html
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="theme-color" content="#0f172a">
    <meta name="description" content="ProspUp — CRM Prospection B2B par Up Technologies. Gestion de prospects, suivi des relances et pilotage commercial.">
    <link rel="manifest" href="/static/manifest.json">
    <link rel="apple-touch-icon" href="/static/icon-192.png">
    <link rel="icon" href="/static/favicon.ico">
    <title>{% block title %}ProspUp{% endblock %}</title>
    <link rel="stylesheet" href="/static/css/style.css?v={{ css_version }}">
    {% block head_scripts %}{% endblock %}
</head>
<body data-page="{% block page_name %}default{% endblock %}">
    <div class="container">
        <header>
            <h1><img src="/static/logo-up-technologies.png" alt="Up Technologies" class="header-logo-app"> {% block header_title %}ProspUp{% endblock %}</h1>
            <p class="header-subtitle">{% block header_subtitle %}{% endblock %}</p>
        </header>
        <div class="main-layout">
            <aside class="sidebar"></aside>
            <main class="content">
                {% block content %}{% endblock %}
            </main>
        </div>
    </div>
    {% block modals %}{% endblock %}
    {% block page_scripts %}{% endblock %}
</body>
</html>
```

### Blocs à définir dans chaque page

1. **`{% block title %}`** : Titre de la page (dans `<title>`)
2. **`{% block head_scripts %}`** : Scripts externes dans le head (ex: XLSX pour index.html)
3. **`{% block page_name %}`** : Valeur de `data-page` (ex: "prospects", "dashboard")
4. **`{% block header_title %}`** : Titre dans le header (ex: "Prosp'Up — Gestion Prospects")
5. **`{% block header_subtitle %}`** : Sous-titre dans le header
6. **`{% block content %}`** : Contenu principal dans `<main class="content">`
7. **`{% block modals %}`** : Modales spécifiques à la page
8. **`{% block page_scripts %}`** : Scripts JavaScript spécifiques à la page
