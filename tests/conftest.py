import datetime as dt
import importlib
import sqlite3
import sys

import pytest


def _seed_minimal_data(db_path: str) -> None:
    today = dt.date.today()
    overdue = (today - dt.timedelta(days=2)).isoformat()
    due_today = today.isoformat()
    now = dt.datetime.now().isoformat(timespec="seconds")
    call_notes = '[{"date":"%sT09:00:00","content":"Premier appel"}]' % due_today

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO companies (id, groupe, site, owner_id, tags)
            VALUES (?, ?, ?, ?, ?)
            """,
            (1, "UpTech Group", "Lyon", 1, '["embarque"]'),
        )
        conn.execute(
            """
            INSERT INTO companies (id, groupe, site, owner_id, tags)
            VALUES (?, ?, ?, ?, ?)
            """,
            (2, "Robotik Corp", "Grenoble", 1, '["robotique"]'),
        )

        conn.execute(
            """
            INSERT INTO prospects
            (id, name, company_id, fonction, email, statut, nextFollowUp, callNotes, owner_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                1,
                "Alice Martin",
                1,
                "CTO",
                "alice@example.com",
                "Rendez-vous",
                overdue,
                call_notes,
                1,
            ),
        )
        conn.execute(
            """
            INSERT INTO prospects
            (id, name, company_id, fonction, email, statut, nextFollowUp, callNotes, owner_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                2,
                "Bob Dupont",
                2,
                "Engineering Manager",
                "bob@example.com",
                "A rappeler",
                due_today,
                "[]",
                1,
            ),
        )

        conn.execute(
            """
            INSERT INTO push_logs
            (prospect_id, sentAt, channel, to_email, subject, body, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (1, f"{due_today}T10:30:00", "email", "alice@example.com", "Intro", "Bonjour", now),
        )


@pytest.fixture()
def app_module(tmp_path, monkeypatch):
    db_path = tmp_path / "phase1_test.db"
    monkeypatch.setenv("PROSPECTION_DB", str(db_path))

    if "app" in sys.modules:
        del sys.modules["app"]

    module = importlib.import_module("app")
    module.DATA_DIR.mkdir(exist_ok=True)
    module.init_db()
    _seed_minimal_data(str(db_path))

    try:
        yield module
    finally:
        if "app" in sys.modules:
            del sys.modules["app"]


@pytest.fixture()
def client(app_module):
    app_module.app.config.update(TESTING=True)
    with app_module.app.test_client() as test_client:
        yield test_client


@pytest.fixture()
def authenticated_client(client):
    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert response.status_code == 200
    return client
