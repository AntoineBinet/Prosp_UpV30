# Rollback v30 — Restaurer les DB depuis un backup

La v30 introduit des migrations additives (nouvelles tables `push_campaigns`,
`saved_views`, `candidate_skills`, `candidate_availability` et une colonne
`push_logs.campaign_id`). Ces migrations sont **non destructives** : elles ne
suppriment ni ne renomment aucune donnée existante. Un rollback ne devrait donc
pas être nécessaire, mais on garde un filet de sécurité.

## Backups automatiques

Au démarrage d'`app.py`, si la DB ne contient pas encore les nouvelles tables v30,
un backup complet est créé dans :

```
data/backups/v30_migration/<YYYY-MM-DD_HHMMSS>/
  prospects.db
  auth.db                 (si présent)
  user_<id>/prospects.db  (par user)
  manifest.json
```

## Backup manuel

```bash
python -m scripts.v30_backup
```

## Restauration

**Prérequis** : arrêter `app.py` (et le superviseur) avant toute copie pour éviter un
lock SQLite.

```bash
# 1. Identifier le backup à restaurer
ls data/backups/v30_migration/

# 2. Copier (exemple avec le timestamp 2026-04-21_181500)
cp data/backups/v30_migration/2026-04-21_181500/prospects.db data/prospects.db
cp -r data/backups/v30_migration/2026-04-21_181500/user_1 data/user_1

# Windows PowerShell
Copy-Item -Force data\backups\v30_migration\2026-04-21_181500\prospects.db data\prospects.db
Copy-Item -Recurse -Force data\backups\v30_migration\2026-04-21_181500\user_1 data\
```

## Vérifier le backup

Chaque backup contient un `manifest.json` listant les fichiers copiés avec leur
taille. Un backup où un fichier fait 0 octet est invalide et `backup_all_databases()`
lève `RuntimeError` dans ce cas.

## Python depuis le REPL

```python
from scripts.v30_backup import backup_all_databases, latest_backup
backup_all_databases(reason="manual_before_upgrade")
print(latest_backup())
```
