"""Seed johndoe + données de test pour tests UI de la toile.

Lancement : python scripts/seed_johndoe.py
"""
from __future__ import annotations

import datetime
import sqlite3
from pathlib import Path
from werkzeug.security import generate_password_hash

DB = Path(__file__).resolve().parents[1] / "prospects.db"
NOW = datetime.datetime.now().isoformat(timespec="seconds")
TODAY = datetime.date.today().isoformat()


def main():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    pw_hash = generate_password_hash("johndoe")
    cur.execute("""INSERT OR IGNORE INTO users
        (username, password_hash, role, display_name, is_active, createdAt)
        VALUES (?, ?, ?, ?, 1, ?);""",
        ("johndoe", pw_hash, "editor", "John Doe (Test)", NOW))
    uid = cur.execute("SELECT id FROM users WHERE username='johndoe';").fetchone()[0]
    print(f"johndoe id={uid}")

    # ── Companies ───────────────────────────────────────────
    companies = [
        ("Stellantis", "https://stellantis.com", "Velizy"),
        ("Capgemini",  "https://capgemini.com",  "Paris"),
        ("Thales",     "https://thalesgroup.com","Massy"),
        ("Airbus",     "https://airbus.com",     "Toulouse"),
    ]
    cmap = {}
    for name, site, city in companies:
        # Skip si déjà présent
        existing = cur.execute("SELECT id FROM companies WHERE owner_id=? AND groupe=?;", (uid, name)).fetchone()
        if existing:
            cmap[name] = existing["id"]
            continue
        cur.execute("INSERT INTO companies (groupe, site, city, owner_id) VALUES (?, ?, ?, ?);",
                    (name, site, city, uid))
        cmap[name] = cur.lastrowid

    # ── Prospects ──────────────────────────────────────────
    prospects = [
        ("Alice Martin",   "Stellantis", "Lead C++",    "Premier contact", "haute",   TODAY,         "C++,embedded", "alice@stellantis.com"),
        ("Bruno Dupont",   "Stellantis", "Tech Lead",   "Rendez-vous",     "haute",   None,          "java,cloud",   "bruno@stellantis.com"),
        ("Camille Leroy",  "Capgemini",  "DSI",         "Propale",         "moyenne", TODAY,         "management",   "camille@capgemini.com"),
        ("David Bernard",  "Capgemini",  "Recruteur",   "Premier contact", "haute",   None,          "rh",           "david@capgemini.com"),
        ("Elise Petit",    "Thales",     "Architecte",  "A relancer",      "haute",   "2026-04-15",  "C++,radar",    "elise@thales.fr"),
        ("Fabrice Roux",   "Thales",     "PMO",         "Premier contact", "moyenne", None,          "pmo",          "fabrice@thales.fr"),
        ("Geraldine Noir", "Airbus",     "Manager",     "Rendez-vous",     "haute",   None,          "aero",         "geraldine@airbus.com"),
        ("Hugo Blanc",     "Airbus",     "DevOps",      "Gagne",           "haute",   None,          "devops,k8s",   "hugo@airbus.com"),
        ("Ines Vert",      "Stellantis", "QA Lead",     "Perdu",           "basse",   None,          "qa",           "ines@stellantis.com"),
        ("Julien Rouge",   "Capgemini",  "Consultant",  "A relancer",      "moyenne", "2026-04-10",  "agile",        "julien@capgemini.com"),
        ("Karine Bleu",    "Thales",     "Sec. Eng.",   "Premier contact", "haute",   None,          "cybersec",     "karine@thales.fr"),
        ("Lucas Or",       "Airbus",     "ML Eng.",     "Rendez-vous",     None,      None,          "ml,python",    "lucas@airbus.com"),
    ]
    for name, comp, fct, statut, pert, fup, tags, email in prospects:
        existing = cur.execute("SELECT id FROM prospects WHERE owner_id=? AND name=?;", (uid, name)).fetchone()
        if existing:
            continue
        cur.execute("""INSERT INTO prospects
            (name, company_id, fonction, statut, pertinence, nextFollowUp, tags, email, owner_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);""",
            (name, cmap[comp], fct, statut, pert, fup, tags, email, uid))

    # RDV : poser une date sur les "Rendez-vous"
    cur.execute("UPDATE prospects SET rdvDate=? WHERE owner_id=? AND statut='Rendez-vous' AND rdvDate IS NULL;",
                (TODAY + "T14:00:00", uid))

    # ── Candidates ─────────────────────────────────────────
    candidates = [
        ("Martin Devops", "qualified", "DevOps senior, AWS/K8s",      "AWS,K8s,Terraform"),
        ("Lina Frontend", "screening", "React/TypeScript 5 ans",      "React,TS,Next.js"),
        ("Theo Backend",  "shortlist", "Python/Go, microservices",    "Python,Go,gRPC"),
        ("Sara Data",     "qualified", "Data engineer Spark/Airflow", "Spark,Airflow,SQL"),
        ("Karim ML",      "rejected",  "ML Engineer, NLP fine-tuning","PyTorch,LLM,NLP"),
        ("Pauline QA",    "screening", "Test automation Cypress",     "Cypress,QA,Jest"),
    ]
    for name, status, notes, skills in candidates:
        existing = cur.execute("SELECT id FROM candidates WHERE owner_id=? AND name=?;", (uid, name)).fetchone()
        if existing:
            continue
        cur.execute("""INSERT INTO candidates (name, status, notes, skills, owner_id, createdAt)
                       VALUES (?, ?, ?, ?, ?, ?);""",
                    (name, status, notes, skills, uid, NOW))

    # ── Besoins ────────────────────────────────────────────
    besoins = [
        ("Lead C++ embedded", "Stellantis", "Velizy", "Bruno Dupont", "Mission lead C++ embarque automotive", "ouvert",  "haute"),
        ("Architecte radar",  "Thales",     "Massy",  "Elise Petit",  "Architecte logiciel embarque radars",  "en_cours", "moyenne"),
    ]
    for intitule, client, loc, contact, descriptif, statut, prio in besoins:
        existing = cur.execute("SELECT id FROM besoins WHERE owner_id=? AND intitule=?;", (uid, intitule)).fetchone()
        if existing:
            continue
        cur.execute("""INSERT INTO besoins
            (intitule, client, localisation, contact, descriptif, statut, priority,
             company_id, owner_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);""",
            (intitule, client, loc, contact, descriptif, statut, prio,
             cmap.get(client), uid, NOW))

    # ── Push logs ──────────────────────────────────────────
    pid_first = cur.execute("SELECT id FROM prospects WHERE owner_id=? ORDER BY id LIMIT 3;", (uid,)).fetchall()
    for row in pid_first:
        cur.execute("""INSERT INTO push_logs (prospect_id, channel, sentAt, createdAt) VALUES (?, ?, ?, ?);""",
                    (row["id"], "email", NOW, NOW))

    # ── Tasks ──────────────────────────────────────────────
    tasks = [
        ("Preparer rdv Stellantis (Bruno)", TODAY),
        ("Relancer Capgemini (Camille)",    TODAY),
        ("Appeler Elise Thales",            TODAY),
    ]
    for title, due in tasks:
        existing = cur.execute("SELECT id FROM tasks WHERE owner_id=? AND title=?;", (uid, title)).fetchone()
        if existing:
            continue
        cur.execute("""INSERT INTO tasks (owner_id, title, due_date, status, createdAt)
                       VALUES (?, ?, ?, 'pending', ?);""",
                    (uid, title, due, NOW))

    con.commit()

    # Recap
    print("=== Recap johndoe ===")
    for tbl in ("prospects", "companies", "candidates", "besoins", "tasks", "push_logs"):
        try:
            n = cur.execute(f"SELECT COUNT(*) FROM {tbl} WHERE owner_id=?;", (uid,)).fetchone()[0]
        except sqlite3.OperationalError:
            n = cur.execute(f"SELECT COUNT(*) FROM {tbl};").fetchone()[0]
        print(f"  {tbl}: {n}")
    print("login: johndoe / johndoe")


if __name__ == "__main__":
    main()
