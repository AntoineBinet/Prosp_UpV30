// ═══════════════════════════════════════════════════════════════════
// Aide : raccourci Ctrl+Shift+H (ou F1) + texte au survol long
// Un seul raccourci pour tout le site : le bouton survolé détermine
// la section d'aide vers laquelle rediriger.
// ═══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var HELP_SECTION_LABELS = {
        'demarrage': 'Démarrage rapide',
        'acces-distance': 'Accès à distance',
        'dashboard': 'Dashboard',
        'prospects': 'Prospects',
        'fiche-prospect': 'Fiche prospect',
        'scrapping-ia': 'Scrapping IA',
        'ajout-ia': 'Ajout IA',
        'entreprises': 'Entreprises',
        'fiche-entreprise': 'Fiche entreprise',
        'focus': 'Focus & relances',
        'calendrier': 'Calendrier',
        'sourcing': 'Sourcing',
        'fiche-candidat': 'Fiche candidat',
        'push': 'Push & emails',
        'categories-push': 'Catégories Push',
        'recherche': 'Recherche globale',
        'stats': 'Statistiques',
        'rapport': 'Rapport hebdo',
        'kpi': 'KPI & Excel',
        'metiers': 'Référentiel métiers',
        'doublons': 'Doublons',
        'snapshots': 'Snapshots',
        'parametres': 'Paramètres',
        'mises-a-jour': 'Mises à jour',
        'raccourcis': 'Raccourcis',
        'bonnes-pratiques': 'Bonnes pratiques',
        'archived': 'Archivés'
    };

    var HELP_HINT = "Aide: Ctrl+Shift+H ouvre l'aide (section pointée)";

    // Section du bouton/élément actuellement survolé (pour le raccourci)
    window._helpSection = null;

    function getLabel(sectionId) {
        return HELP_SECTION_LABELS[sectionId] || sectionId;
    }

    function appendHelpHintToElement(el) {
        var sectionId = el.getAttribute('data-help-section');
        if (!sectionId) return;
        var existingTitle = el.getAttribute('title') || '';
        if (existingTitle.indexOf('Ctrl+Shift+H') !== -1) return; // déjà décoré
        var label = getLabel(sectionId);
        var suffix = (existingTitle ? "\n" : "") + "Aide: Ctrl+Shift+H → section \"" + label + "\"";
        el.setAttribute('title', existingTitle + suffix);
    }

    function decorateAllHelpSections() {
        document.querySelectorAll('[data-help-section]').forEach(appendHelpHintToElement);
    }

    // Exposer pour que le contenu dynamique (ex. app.js) puisse être décoré après rendu
    window.decorateHelpSections = decorateAllHelpSections;

    // Survol : mémoriser la section de l'élément sous le curseur
    document.addEventListener('mouseover', function (e) {
        var el = e.target.closest('[data-help-section]');
        window._helpSection = el ? el.getAttribute('data-help-section') : null;
    });
    document.addEventListener('mouseout', function (e) {
        if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('[data-help-section]')) {
            window._helpSection = null;
        }
    });

    // Raccourci clavier : Ctrl+Shift+H ou F1 → ouvrir l'aide (avec ancre si bouton pointé)
    document.addEventListener('keydown', function (e) {
        var isF1 = e.key === 'F1';
        var isCtrlShiftH = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'H' || e.key === 'h');
        if (!isF1 && !isCtrlShiftH) return;
        e.preventDefault();
        var hash = window._helpSection ? '#' + window._helpSection : '';
        window.location.href = '/v30/help' + hash;
    });

    // Au chargement : décorer tous les éléments ayant data-help-section (après construction sidebar)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(decorateAllHelpSections, 600);
        });
    } else {
        setTimeout(decorateAllHelpSections, 600);
    }
})();
