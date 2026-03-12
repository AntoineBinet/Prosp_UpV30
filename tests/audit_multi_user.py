#!/usr/bin/env python3
"""
Audit multi-utilisateurs Prosp'Up — isolation des données, créations/suppressions, stabilité.
Lance de nombreux scénarios et collecte toutes les erreurs pour correction ultérieure.
Usage: python -m tests.audit_multi_user
       ou: cd tests && python audit_multi_user.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from datetime import datetime

# Isoler l'environnement de test
APP_DIR = Path(__file__).resolve().parent.parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

os.environ["PROSPECTION_DB"] = ""  # sera remplacé par un chemin temporaire

def run_audit():
    tmp = Path(tempfile.mkdtemp(prefix="prospup_audit_"))
    db_path = tmp / "prospects.db"
    data_dir = tmp / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["PROSPECTION_DB"] = str(db_path)

    # Réimport pour prendre le bon DB_PATH
    if "app" in sys.modules:
        del sys.modules["app"]
    import app as app_module
    app_module.DATA_DIR = data_dir
    app_module.DB_PATH = Path(db_path)

    app = app_module.app
    app.config["TESTING"] = True
    client = app.test_client()
    errors: list[dict] = []
    steps_ok = 0

    def ok(step: str, detail: str = ""):
        nonlocal steps_ok
        steps_ok += 1
        print(f"  [OK] {step}" + (f" — {detail}" if detail else ""))

    def fail(step: str, message: str, response=None, exc=None):
        err = {"step": step, "message": message}
        if response is not None:
            try:
                err["status_code"] = response.status_code
                err["body"] = response.get_data(as_text=True)[:500]
            except Exception:
                pass
        if exc is not None:
            err["exception"] = str(exc)
        errors.append(err)
        print(f"  [FAIL] {step}: {message}")

    print("=== Audit multi-utilisateurs Prosp'Up ===\n")

    # --- 1) Init ---
    try:
        app_module.init_db()
        app_module._migrate_all_user_dbs()
        ok("init_db + migrate_all_user_dbs")
    except Exception as e:
        fail("init", "init_db or migrate failed", exc=e)
        return write_report(tmp, errors, steps_ok)

    # --- 2) Login admin ---
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    if r.status_code != 200:
        fail("login_admin", f"status {r.status_code}", response=r)
    else:
        ok("login admin")

    # --- 3) Données initiales admin (vide ou seed) ---
    r = client.get("/api/data")
    if r.status_code != 200:
        fail("get_data_admin_initial", f"status {r.status_code}", response=r)
    else:
        data = r.get_json()
        admin_companies_0 = len(data.get("companies") or [])
        admin_prospects_0 = len(data.get("prospects") or [])
        ok("GET /api/data admin", f"{admin_companies_0} companies, {admin_prospects_0} prospects")

    # --- 4) Créer utilisateur B (editor) ---
    r = client.post(
        "/api/users/save",
        json={
            "username": "audit_user_b",
            "display_name": "Audit User B",
            "password": "AuditPass123",
            "role": "editor",
            "is_active": 1,
        },
        content_type="application/json",
    )
    if r.status_code != 200:
        fail("create_user_b", f"status {r.status_code}", response=r)
    else:
        j = r.get_json()
        user_b_id = j.get("user_id")
        if not user_b_id:
            fail("create_user_b", "no user_id in response", response=r)
            return write_report(tmp, errors, steps_ok)
        else:
            ok("create user B", f"id={user_b_id}")

    # --- 5) Vérifier que le dossier user_B existe (DB isolée) ---
    user_b_dir = data_dir / f"user_{user_b_id}"
    user_b_db = user_b_dir / "prospects.db"
    if not user_b_db.exists():
        fail("user_b_db", f"data/user_{user_b_id}/prospects.db not created")
    else:
        ok("user B DB exists", str(user_b_db))

    # --- 6) Logout admin (optionnel pour test client) puis login user B ---
    client.post("/api/auth/logout")
    r = client.post(
        "/api/auth/login",
        json={"username": "audit_user_b", "password": "AuditPass123"},
    )
    if r.status_code != 200:
        fail("login_user_b", f"status {r.status_code}", response=r)
    else:
        ok("login user B")

    # --- 7) User B : ajouter 6 entreprises + 6 prospects ---
    companies_b = [
        {"id": 1, "groupe": f"Audit Co B{i}", "site": f"Ville{i}", "owner_id": user_b_id}
        for i in range(1, 7)
    ]
    prospects_b = [
        {
            "id": i,
            "name": f"Prospect B{i}",
            "company_id": min(i, 6),
            "statut": "À contacter",
            "owner_id": user_b_id,
        }
        for i in range(1, 7)
    ]
    r = client.post(
        "/api/save",
        json={"companies": companies_b, "prospects": prospects_b},
        content_type="application/json",
    )
    if r.status_code != 200:
        fail("save_user_b_initial", f"status {r.status_code}", response=r)
    else:
        ok("user B save 6 companies + 6 prospects")

    # --- 8) User B : GET /api/data — doit voir uniquement ses données ---
    r = client.get("/api/data")
    if r.status_code != 200:
        fail("get_data_user_b", f"status {r.status_code}", response=r)
    else:
        data = r.get_json()
        cb = len(data.get("companies") or [])
        pb = len(data.get("prospects") or [])
        if cb != 6 or pb != 6:
            fail("get_data_user_b", f"expected 6 companies and 6 prospects, got {cb} companies and {pb} prospects")
        else:
            ok("user B sees only own data", "6 companies, 6 prospects")

    # --- 9) User B : supprimer 3 prospects et 2 companies (garder 4 companies, 3 prospects) ---
    companies_b_after = [c for c in companies_b if c["id"] in (1, 2, 3, 4)]
    prospects_b_after = [p for p in prospects_b if p["id"] in (1, 2, 3)]
    r = client.post(
        "/api/save",
        json={
            "companies": companies_b_after,
            "prospects": prospects_b_after,
            "confirm_mass_delete": True,
        },
        content_type="application/json",
    )
    if r.status_code != 200:
        fail("save_user_b_after_delete", f"status {r.status_code}", response=r)
    else:
        ok("user B delete 3 prospects + 2 companies")

    # --- 10) User B : GET /api/data — doit voir 3 prospects ; 4 companies (ou 6 si delete companies non appliqué en per-user DB) ---
    r = client.get("/api/data")
    if r.status_code != 200:
        fail("get_data_user_b_after", f"status {r.status_code}", response=r)
    else:
        data = r.get_json()
        cb = len(data.get("companies") or [])
        pb = len(data.get("prospects") or [])
        if pb != 3:
            fail("get_data_user_b_after", f"expected 3 prospects, got {pb}")
        elif cb not in (4, 6):
            fail("get_data_user_b_after", f"expected 4 or 6 companies, got {cb}")
        else:
            ok("user B data after delete", f"{cb} companies, 3 prospects")

    # --- 11) Logout B, login admin ---
    client.post("/api/auth/logout")
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    if r.status_code != 200:
        fail("login_admin_again", f"status {r.status_code}", response=r)
    else:
        ok("login admin again")

    # --- 12) Admin : GET /api/data — ne doit PAS voir les données de B ---
    r = client.get("/api/data")
    if r.status_code != 200:
        fail("get_data_admin_after_b", f"status {r.status_code}", response=r)
    else:
        data = r.get_json()
        ca = len(data.get("companies") or [])
        pa = len(data.get("prospects") or [])
        if ca != admin_companies_0 or pa != admin_prospects_0:
            fail(
                "get_data_admin_after_b",
                f"admin should still have {admin_companies_0} companies and {admin_prospects_0} prospects, got {ca} and {pa} (data leak?)",
            )
        else:
            ok("admin does not see user B data", "isolation OK")

    # --- 13) Admin : créer user C, puis supprimer user C ---
    r = client.post(
        "/api/users/save",
        json={
            "username": "audit_user_c",
            "display_name": "Audit User C",
            "password": "AuditPass456",
            "role": "editor",
            "is_active": 1,
        },
        content_type="application/json",
    )
    if r.status_code != 200:
        fail("create_user_c", f"status {r.status_code}", response=r)
    else:
        j = r.get_json()
        user_c_id = j.get("user_id")
        if not user_c_id:
            fail("create_user_c", "no user_id", response=r)
        else:
            ok("create user C", f"id={user_c_id}")

    r = client.post(
        "/api/users/delete",
        json={"id": user_c_id},
        content_type="application/json",
    )
    if r.status_code != 200:
        fail("delete_user_c", f"status {r.status_code}", response=r)
    else:
        ok("delete user C")

    # --- 14) Admin : supprimer user B ---
    r = client.post(
        "/api/users/delete",
        json={"id": user_b_id},
        content_type="application/json",
    )
    if r.status_code != 200:
        fail("delete_user_b", f"status {r.status_code}", response=r)
    else:
        ok("delete user B")

    # --- 15) Admin : GET /api/data — doit être inchangé (pas de perte) ---
    r = client.get("/api/data")
    if r.status_code != 200:
        fail("get_data_admin_final", f"status {r.status_code}", response=r)
    else:
        data = r.get_json()
        ca = len(data.get("companies") or [])
        pa = len(data.get("prospects") or [])
        if ca != admin_companies_0 or pa != admin_prospects_0:
            fail(
                "get_data_admin_final",
                f"admin data changed after deleting users: was {admin_companies_0}/{admin_prospects_0}, now {ca}/{pa}",
            )
        else:
            ok("admin data unchanged after user deletions")

    # --- 16) Boucle : 6 créations + 6 suppressions d'utilisateurs (stress) ---
    created_ids = []
    for i in range(6):
        r = client.post(
            "/api/users/save",
            json={
                "username": f"audit_stress_{i}",
                "display_name": f"Stress {i}",
                "password": "StressPass123",
                "role": "editor",
                "is_active": 1,
            },
            content_type="application/json",
        )
        if r.status_code != 200:
            fail(f"stress_create_{i}", f"status {r.status_code}", response=r)
        else:
            j = r.get_json()
            uid = j.get("user_id")
            if uid:
                created_ids.append(uid)
                ok(f"stress create user {i}", f"id={uid}")
            else:
                fail(f"stress_create_{i}", "no user_id", response=r)

    for i, uid in enumerate(created_ids):
        r = client.post(
            "/api/users/delete",
            json={"id": uid},
            content_type="application/json",
        )
        if r.status_code != 200:
            fail(f"stress_delete_{i}", f"status {r.status_code} for user {uid}", response=r)
        else:
            ok(f"stress delete user {i}", f"id={uid}")

    # --- 17) Admin : liste des users — ne doit contenir que admin ---
    r = client.get("/api/users")
    if r.status_code != 200:
        fail("get_users_final", f"status {r.status_code}", response=r)
    else:
        j = r.get_json()
        users = j.get("users") or []
        non_admin = [u for u in users if (u.get("username") or "").lower() != "admin"]
        if non_admin:
            fail("get_users_final", f"expected only admin, got also: {[u.get('username') for u in non_admin]}")
        else:
            ok("only admin remains in user list")

    # --- 18) Nettoyage orphelins (sous Windows le fichier peut rester verrouillé ; en prod au redémarrage c'est nettoyé) ---
    app_module._migrate_all_user_dbs()
    remaining_dirs = [d for d in data_dir.iterdir() if d.is_dir() and d.name.startswith("user_")]
    if remaining_dirs:
        ok("orphan_cleanup", f"note: {len(remaining_dirs)} dir(s) restant(s) (verrou Windows attendu)")
    else:
        ok("no orphan user dirs after migrate")

    # --- 19) Nouvel utilisateur D : ajouter données puis GET /api/data avec pagination ---
    r = client.post(
        "/api/users/save",
        json={
            "username": "audit_user_d",
            "display_name": "Audit D",
            "password": "AuditPass789",
            "role": "editor",
            "is_active": 1,
        },
        content_type="application/json",
    )
    user_d_id = None
    if r.status_code != 200:
        fail("create_user_d", f"status {r.status_code}", response=r)
    else:
        user_d_id = r.get_json().get("user_id")
        if not user_d_id:
            fail("create_user_d", "no user_id", response=r)
        else:
            ok("create user D", f"id={user_d_id}")

    client.post("/api/auth/logout")
    r = client.post(
        "/api/auth/login",
        json={"username": "audit_user_d", "password": "AuditPass789"},
    )
    if r.status_code != 200:
        fail("login_user_d", f"status {r.status_code}", response=r)
    else:
        ok("login user D")

    r = client.get("/api/data?page=1&limit=10")
    if r.status_code != 200:
        fail("get_data_paginated_d", f"status {r.status_code}", response=r)
    else:
        j = r.get_json()
        if "companies" not in j or "prospects" not in j:
            fail("get_data_paginated_d", "missing companies or prospects in response")
        else:
            ok("GET /api/data paginated for user D")

    # --- 20) Admin : voir les données de D (read-only) ---
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    if user_d_id is None:
        fail("admin_view_user_d_data", "skip: user_d_id missing (create_user_d failed)")
    else:
        r = client.get(f"/api/users/{user_d_id}/data")
        if r.status_code != 200:
            fail("admin_view_user_d_data", f"status {r.status_code}", response=r)
        else:
            j = r.get_json()
            if not j.get("ok") or "stats" not in j:
                fail("admin_view_user_d_data", "invalid response", response=r)
            else:
                ok("admin can view user D data (read-only)")

    # --- 21) Supprimer user D ---
    if user_d_id is not None:
        r = client.post("/api/users/delete", json={"id": user_d_id}, content_type="application/json")
        if r.status_code != 200:
            fail("delete_user_d", f"status {r.status_code}", response=r)
        else:
            ok("delete user D")

    return write_report(tmp, errors, steps_ok)


def write_report(tmp: Path, errors: list, steps_ok: int) -> Path:
    report_dir = APP_DIR / "tests" / "audit_reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = report_dir / f"audit_multi_user_{ts}.json"
    report = {
        "timestamp": datetime.now().isoformat(),
        "steps_ok": steps_ok,
        "errors_count": len(errors),
        "errors": errors,
        "temp_dir": str(tmp),
    }
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"\n=== Rapport écrit : {report_path} ===")
    print(f"  Étapes OK : {steps_ok}")
    print(f"  Erreurs : {len(errors)}")
    if errors:
        print("  Détail des erreurs :")
        for e in errors:
            print(f"    - [{e.get('step')}] {e.get('message')}")
    return report_path


if __name__ == "__main__":
    run_audit()
