# Rapports d'audit multi-utilisateurs

Les rapports `audit_multi_user_*.json` sont générés par `python -m tests.audit_multi_user`.

## Lancer l'audit

```bash
cd "c:\Users\binet\Desktop\Prosp_UpV25"
set PYTHONIOENCODING=utf-8
python -m tests.audit_multi_user
```

## Problèmes connus (à corriger en priorité)

1. **save_user_b_after_delete (500)**  
   Lorsqu'un utilisateur envoie un payload avec moins de prospects et moins d'entreprises (suppression partielle), le `COMMIT` lève `FOREIGN KEY constraint failed`.  
   Cause probable : vérification FK différée au commit alors que l'ordre DELETE prospects → DELETE companies est correct dans la transaction ; à investiguer (schéma per-user, DEFERRABLE, etc.).

2. **orphan_cleanup**  
   Les dossiers `data/user_X` des utilisateurs supprimés ne sont pas toujours supprimés immédiatement sous Windows (fichier DB verrouillé par SQLite). Au redémarrage de l'app, `_migrate_all_user_dbs()` nettoie les orphelins.

## Ce qui est validé

- Isolation des données : l'admin ne voit pas les données de l'utilisateur B et réciproquement.
- Création / suppression d'utilisateurs (6 créations + 6 suppressions en stress).
- Données admin inchangées après suppression d'utilisateurs.
- Vue admin en lecture seule sur les données d'un autre utilisateur.
- Pagination GET /api/data.
- DB utilisateur créée avec `deleted_at` et pas de mélange avec la DB principale.
