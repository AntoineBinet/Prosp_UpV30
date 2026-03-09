"""v23.5 feature tests: audit log, soft delete, pagination, bulk status/tags, search offset."""
import json


# ────── Audit Log ──────

def test_audit_log_requires_admin(authenticated_client):
    """Non-admin users should not access audit logs."""
    # authenticated_client is admin, so this should work
    r = authenticated_client.get("/api/audit-log")
    assert r.status_code == 200
    data = r.get_json()
    assert data["ok"] is True
    assert "logs" in data
    assert "pagination" in data


def test_audit_log_created_on_company_update(authenticated_client):
    """Updating a company should create an audit log entry."""
    # Update company
    r = authenticated_client.post("/api/company/update", json={"id": 1, "notes": "audit test"})
    assert r.status_code == 200

    # Check audit log
    r = authenticated_client.get("/api/audit-log?entity=company&entity_id=1")
    data = r.get_json()
    assert data["ok"] is True
    assert len(data["logs"]) >= 1
    assert data["logs"][0]["action"] == "update"
    assert data["logs"][0]["entity"] == "company"


# ────── Soft Delete ──────

def test_soft_delete_candidate(authenticated_client, app_module):
    """Deleting a candidate should soft-delete (set deleted_at) not hard delete."""
    # First create a candidate
    import sqlite3
    import os
    db_path = os.environ.get("PROSPECTION_DB")
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO candidates (id, name, role, owner_id) VALUES (?, ?, ?, ?)",
            (99, "Test Candidate", "Dev", 1)
        )

    # Delete it
    r = authenticated_client.post("/api/candidates/delete", json={"id": 99})
    assert r.status_code == 200
    assert r.get_json()["ok"] is True

    # Check it's soft deleted (still in DB but with deleted_at)
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM candidates WHERE id=99").fetchone()
        assert row is not None
        assert row["deleted_at"] is not None

    # Should not appear in listing
    r = authenticated_client.get("/api/candidates")
    candidates = r.get_json()
    assert not any(c["id"] == 99 for c in candidates)


def test_soft_delete_restore(authenticated_client, app_module):
    """Restoring a soft-deleted entity should clear deleted_at."""
    import sqlite3, os
    db_path = os.environ.get("PROSPECTION_DB")
    # Soft delete a candidate
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO candidates (id, name, role, owner_id, deleted_at) VALUES (?, ?, ?, ?, ?)",
            (98, "Deleted Candidate", "QA", 1, "2026-01-01T00:00:00")
        )

    r = authenticated_client.post("/api/soft-deleted/restore", json={"entity": "candidate", "id": 98})
    assert r.status_code == 200
    assert r.get_json()["ok"] is True

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT deleted_at FROM candidates WHERE id=98").fetchone()
        assert row["deleted_at"] is None


# ────── Pagination ──────

def test_data_pagination(authenticated_client):
    """GET /api/data?page=1&limit=1 should return paginated results."""
    r = authenticated_client.get("/api/data?page=1&limit=1")
    assert r.status_code == 200
    data = r.get_json()
    assert "pagination" in data
    assert data["pagination"]["page"] == 1
    assert data["pagination"]["limit"] == 1
    assert data["pagination"]["total"] >= 1
    assert len(data["prospects"]) <= 1


def test_data_pagination_lazy(authenticated_client):
    """GET /api/data?page=1&limit=10&lazy=1 should exclude callNotes and notes."""
    r = authenticated_client.get("/api/data?page=1&limit=10&lazy=1")
    assert r.status_code == 200
    data = r.get_json()
    for p in data["prospects"]:
        assert "callNotes" not in p
        assert "notes" not in p


def test_candidates_pagination(authenticated_client, app_module):
    """GET /api/candidates?page=1&limit=1 should return paginated results."""
    import sqlite3, os
    db_path = os.environ.get("PROSPECTION_DB")
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO candidates (id, name, role, owner_id) VALUES (?, ?, ?, ?)", (50, "Cand A", "Dev", 1))
        conn.execute("INSERT INTO candidates (id, name, role, owner_id) VALUES (?, ?, ?, ?)", (51, "Cand B", "QA", 1))

    r = authenticated_client.get("/api/candidates?page=1&limit=1")
    assert r.status_code == 200
    data = r.get_json()
    assert data["ok"] is True
    assert len(data["candidates"]) == 1
    assert data["pagination"]["total"] >= 2


# ────── Search with offset ──────

def test_search_with_offset(authenticated_client):
    """GET /api/search?q=alice&offset=0 should include offset in response."""
    r = authenticated_client.get("/api/search?q=alice&offset=0&limit=10")
    assert r.status_code == 200
    data = r.get_json()
    assert data["offset"] == 0


# ────── Bulk Status & Tags ──────

def test_bulk_status_update(authenticated_client):
    """POST /api/prospects/bulk-status-tags should update prospect status."""
    r = authenticated_client.post("/api/prospects/bulk-status-tags", json={
        "ids": [1],
        "statut": "Gagné"
    })
    assert r.status_code == 200
    data = r.get_json()
    assert data["ok"] is True
    assert data["updated"] == 1


def test_bulk_tags_add(authenticated_client):
    """POST /api/prospects/bulk-status-tags should add tags to prospects."""
    r = authenticated_client.post("/api/prospects/bulk-status-tags", json={
        "ids": [1],
        "add_tags": ["premium", "urgent"]
    })
    assert r.status_code == 200
    assert r.get_json()["ok"] is True


def test_bulk_requires_ids(authenticated_client):
    """POST /api/prospects/bulk-status-tags without ids should return 400."""
    r = authenticated_client.post("/api/prospects/bulk-status-tags", json={
        "statut": "Gagné"
    })
    assert r.status_code == 400
