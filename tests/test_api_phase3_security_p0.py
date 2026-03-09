import datetime as dt
import sqlite3

import pytest


def _login(client, username: str, password: str) -> None:
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.get_json()


def _logout(client) -> None:
    client.post("/api/auth/logout")


def _owned_counts(app_module, owner_id: int) -> tuple[int, int]:
    with sqlite3.connect(app_module.DB_PATH) as conn:
        companies_n = conn.execute(
            "SELECT COUNT(*) FROM companies WHERE owner_id=?;",
            (owner_id,),
        ).fetchone()[0]
        prospects_n = conn.execute(
            "SELECT COUNT(*) FROM prospects WHERE owner_id=?;",
            (owner_id,),
        ).fetchone()[0]
    return int(companies_n), int(prospects_n)


def _minimal_save_payload() -> dict:
    return {
        "companies": [
            {
                "id": 1,
                "groupe": "Phase3 Company",
                "site": "Lyon",
            }
        ],
        "prospects": [
            {
                "id": 1,
                "name": "Phase3 Prospect",
                "company_id": 1,
            }
        ],
    }


@pytest.fixture()
def isolated_snapshots_dir(app_module, tmp_path, monkeypatch):
    snap_dir = tmp_path / "snapshots"
    snap_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(app_module, "SNAPSHOT_DIR", snap_dir)
    return snap_dir


@pytest.fixture()
def seeded_roles(app_module):
    now = dt.datetime.now().isoformat(timespec="seconds")
    with app_module._auth_conn() as conn:
        conn.execute(
            """
            INSERT INTO users (username, display_name, password_hash, role, is_active, createdAt)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            ("editor", "Editor", app_module.generate_password_hash("editor"), "editor", 1, now),
        )
        conn.execute(
            """
            INSERT INTO users (username, display_name, password_hash, role, is_active, createdAt)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            ("reader", "Reader", app_module.generate_password_hash("reader"), "reader", 1, now),
        )


@pytest.mark.parametrize(
    ("endpoint", "payload", "expected"),
    [
        ("/api/save", _minimal_save_payload(), {"admin": 200, "editor": 200, "reader": 403, "anon": 401}),
        ("/api/reset", None, {"admin": (200, 500), "editor": 403, "reader": 403, "anon": 401}),
        (
            "/api/snapshots/create",
            {"label": "phase3"},
            {"admin": 200, "editor": 403, "reader": 403, "anon": 401},
        ),
        (
            "/api/snapshots/restore",
            {"filename": "missing.db"},
            {"admin": 404, "editor": 403, "reader": 403, "anon": 401},
        ),
        (
            "/api/users/save",
            {"username": "x_user", "display_name": "X User", "role": "reader", "password": "passw0rd"},
            {"admin": 200, "editor": 403, "reader": 403, "anon": 401},
        ),
        (
            "/api/users/delete",
            {"id": 999999},
            {"admin": 200, "editor": 403, "reader": 403, "anon": 401},
        ),
    ],
)
def test_security_role_matrix_on_critical_endpoints(
    client,
    seeded_roles,
    isolated_snapshots_dir,
    endpoint,
    payload,
    expected,
):
    _logout(client)
    anon_response = client.post(endpoint, json=payload) if payload is not None else client.post(endpoint)
    assert anon_response.status_code == expected["anon"]

    _login(client, "admin", "admin")
    admin_response = client.post(endpoint, json=payload) if payload is not None else client.post(endpoint)
    expected_admin = expected["admin"]
    if isinstance(expected_admin, tuple):
        assert admin_response.status_code in expected_admin, admin_response.get_json()
    else:
        assert admin_response.status_code == expected_admin, admin_response.get_json()
    _logout(client)

    _login(client, "editor", "editor")
    editor_response = client.post(endpoint, json=payload) if payload is not None else client.post(endpoint)
    assert editor_response.status_code == expected["editor"]
    _logout(client)

    _login(client, "reader", "reader")
    reader_response = client.post(endpoint, json=payload) if payload is not None else client.post(endpoint)
    assert reader_response.status_code == expected["reader"]


def test_api_save_transaction_success_minimal_payload(client, isolated_snapshots_dir):
    _login(client, "admin", "admin")
    response = client.post("/api/save", json=_minimal_save_payload())
    assert response.status_code == 200
    assert response.get_json()["ok"] is True

    data_response = client.get("/api/data")
    assert data_response.status_code == 200
    data = data_response.get_json()
    assert any(c["groupe"] == "Phase3 Company" for c in data["companies"])
    assert any(p["name"] == "Phase3 Prospect" for p in data["prospects"])


def test_api_save_transaction_failure_keeps_state_consistent(client, app_module, isolated_snapshots_dir):
    _login(client, "admin", "admin")
    before_counts = _owned_counts(app_module, owner_id=1)

    invalid_payload = {
        "companies": [{"id": 1, "groupe": "Should Rollback", "site": "Paris"}],
        "prospects": [{"id": 1, "name": "Broken Prospect", "company_id": "not-an-int"}],
    }
    response = client.post("/api/save", json=invalid_payload)

    assert response.status_code == 400
    assert response.get_json()["ok"] is False
    after_counts = _owned_counts(app_module, owner_id=1)
    assert after_counts == before_counts


def test_snapshots_read_create_restore_delete_and_reset_safely(
    client,
    app_module,
    isolated_snapshots_dir,
):
    _login(client, "admin", "admin")

    read_before = client.get("/api/snapshots")
    assert read_before.status_code == 200
    assert read_before.get_json()["ok"] is True

    create_response = client.post("/api/snapshots/create", json={"label": "phase3_manual"})
    assert create_response.status_code == 200
    created_filename = create_response.get_json()["filename"]

    save_response = client.post("/api/save", json=_minimal_save_payload())
    assert save_response.status_code == 200

    reset_response = client.post("/api/reset")
    assert reset_response.status_code in (200, 500)
    if reset_response.status_code == 200:
        assert reset_response.get_json()["ok"] is True
    else:
        payload = reset_response.get_json()
        assert payload["ok"] is False
        assert "cannot delete db" in payload["error"]

    restore_response = client.post("/api/snapshots/restore", json={"filename": created_filename})
    assert restore_response.status_code == 200
    assert restore_response.get_json()["ok"] is True

    delete_response = client.post("/api/snapshots/delete", json={"filename": created_filename})
    assert delete_response.status_code == 200
    assert delete_response.get_json()["ok"] is True

    read_after = client.get("/api/snapshots")
    assert read_after.status_code == 200
    items = read_after.get_json()["items"]
    assert all(item["filename"] != created_filename for item in items)

    assert isolated_snapshots_dir.exists()
