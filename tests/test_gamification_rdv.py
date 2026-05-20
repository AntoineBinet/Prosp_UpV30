"""Régression gamification : l'event rdv_taken doit être créé dès le passage
au statut "Rendez-vous".

La gamification (« Prendre 1 RDV Prosp ») et la carte Performance « RDV »
comptent les events `rdv_taken`. Deux bugs empêchaient leur création via
`/api/prospects/bulk-edit` (fiche prospect, kanban, statut en masse) :
  1. `routes/bulk.py` n'importait pas `datetime` — l'INSERT, encapsulé dans
     un `try/except`, échouait silencieusement (NameError) ;
  2. l'event n'était logué que si une `rdvDate` était renseignée — déplacer
     un prospect en « Rendez-vous » sans date n'était pas comptabilisé.
"""
import datetime
import importlib
import os
import sqlite3
import sys

import pytest

# /api/prospects/bulk-edit applique un contrôle CSRF same-origin : le client
# de test doit fournir un header Origin correspondant à l'hôte (localhost).
ORIGIN = {"Origin": "http://localhost"}


def _seed(db_path):
    """Insère une entreprise et deux prospects (owner_id=1)."""
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO companies (id, groupe, site, owner_id, tags) "
            "VALUES (1, 'UpTech', 'Lyon', 1, '[]');"
        )
        # Prospect 1 : déjà au statut "Rendez-vous", sans rdvDate.
        conn.execute(
            "INSERT INTO prospects (id, name, company_id, statut, owner_id) "
            "VALUES (1, 'Alice Martin', 1, 'Rendez-vous', 1);"
        )
        # Prospect 2 : statut "A rappeler", sans rdvDate.
        conn.execute(
            "INSERT INTO prospects (id, name, company_id, statut, owner_id) "
            "VALUES (2, 'Bob Dupont', 1, 'A rappeler', 1);"
        )


@pytest.fixture()
def app_module(tmp_path, monkeypatch):
    """Importe l'app sur une DB temporaire isolée.

    Surcharge le fixture homonyme de conftest.py : on évince aussi `config`
    et les sous-paquets (`routes.*`, `utils.*`, `services.*`) du cache, car
    `config.DB_PATH` / `utils.db.DB_PATH` sont figés à l'import — sans cette
    éviction, un second test réutiliserait le chemin DB du premier.
    """
    db_path = tmp_path / "gamif_rdv_test.db"
    monkeypatch.setenv("PROSPECTION_DB", str(db_path))
    for name in list(sys.modules):
        if name in ("app", "config") or name.startswith(("routes.", "utils.", "services.")):
            del sys.modules[name]
    module = importlib.import_module("app")
    module.DATA_DIR.mkdir(exist_ok=True)
    module.init_db()
    _seed(str(db_path))
    try:
        yield module
    finally:
        if "app" in sys.modules:
            del sys.modules["app"]


@pytest.fixture()
def authed_client(app_module):
    app_module.app.config.update(TESTING=True)
    client = app_module.app.test_client()
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    assert resp.status_code == 200
    return client


def _count_rdv_taken(prospect_id):
    with sqlite3.connect(os.environ["PROSPECTION_DB"]) as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM prospect_events WHERE prospect_id=? AND type='rdv_taken';",
            (prospect_id,),
        ).fetchone()[0]


def test_rdv_taken_logged_when_moving_to_rdv_without_date(authed_client):
    """Passer un prospect en 'Rendez-vous' sans rdvDate doit loguer rdv_taken."""
    resp = authed_client.post(
        "/api/prospects/bulk-edit",
        json={"ids": [2], "field": "statut", "value": "Rendez-vous"},
        headers=ORIGIN,
    )
    assert resp.status_code == 200 and resp.get_json()["ok"] is True

    with sqlite3.connect(os.environ["PROSPECTION_DB"]) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT date FROM prospect_events WHERE prospect_id=2 AND type='rdv_taken';"
        ).fetchall()
    assert len(rows) == 1
    # L'event est daté du jour de la prise de RDV (jour de l'action).
    assert rows[0]["date"] == datetime.date.today().isoformat()


def test_no_rdv_taken_when_status_and_date_unchanged(authed_client):
    """Éditer un prospect déjà 'Rendez-vous' sans toucher statut/date ne loge rien."""
    resp = authed_client.post(
        "/api/prospects/bulk-edit",
        json={"ids": [1], "field": "notes", "value": "note sans rapport"},
        headers=ORIGIN,
    )
    assert resp.status_code == 200
    assert _count_rdv_taken(1) == 0


def test_rdv_taken_logged_on_rdv_date_change(authed_client):
    """Changer la rdvDate d'un prospect déjà 'Rendez-vous' doit loguer rdv_taken."""
    resp = authed_client.post(
        "/api/prospects/bulk-edit",
        json={"ids": [1], "fields": {"rdvDate": "2026-10-15T10:00"}},
        headers=ORIGIN,
    )
    assert resp.status_code == 200
    assert _count_rdv_taken(1) == 1
