# Changelog

Historique des versions significatives. Incrément dans [app.py:38](app.py).

## [29.7] — 2026-04-18

### Nettoyage
- Suppression de 13 docs obsolètes dans `docs/` (plans non implémentés, audits historiques, rapports ponctuels).
- Suppression du duplicata `Template_DC/` (la vraie template vit dans `sample/template_dc.docx`).
- Suppression de fichiers accidentels (`nul`, logs root non gitignored).
- `node_modules/` retiré du git tracking (559 fichiers ~14 MB, ajouté à `.gitignore`).

### .gitignore
- Ajout : `node_modules/`, `.supervisor_pid`, `snapshots/`, `backups/`, `*.log`, `Thumbs.db`, `.claude/settings.local.json`.
- Réorganisation par section (Python, Node, Secrets, DB, Runtime, Logs, Outputs, Misc).

### Docs
- `README.md` réécrit (version 29.6, structure à jour, commandes, liens valides).
- `CLAUDE.md` réécrit — tailles de fichiers actualisées, sections simplifiées, liens vers les nouveaux docs workflow.
- Nouveaux : `.claude/WORKFLOW.md` (règles non-négociables) + `.claude/CHEATSHEET.md` (patterns récurrents).
- Nouveau : `CHANGELOG.md` (ce fichier).

## [29.5] — 2026-04 (non taggé)

- Stats : ajout `topPushedConsultants` (top 6 consultants pushés, historique complet).
- Stats : ajout `urgencyDistribution` (Priorités IA — répartition overdue/today/week/later).

## [29.4] — avril 2026

- Bouton « Ajouter » disponible dans tous les onglets candidats (PR #211).
- Fix dropdown téléphone décalé (suppression classe animation après `animationend`, PR #210).

## [29.x] — mars-avril 2026

- Mode Prosp v6 : redesign deck 3D premium (b15e222, d95df8b).
- Sourcing : onglet LinkedIn avec statuts exclusifs (f751d67).
- Support CV/LinkedIn dans l'assistant d'ajout candidat (1b323e0).
- Sessions Mode Prosp persistées en DB (bcef4fd).
- Push : grille 3 colonnes au lieu de liste verticale (71dc33d).

## Historique plus ancien

Voir `git log --oneline`. Versions antérieures (21.x à 28.x) documentaient les grands chantiers :
- v21.0 : restructuration racine, multi-user owner_id strict.
- v23.5 : soft delete (colonne `deleted_at`).
- v25.1 : sécurisation users + JWT mobile.
- v27.x : cohérence UI.
- v28.0 : IA Ollama + Tavily unifiée.
