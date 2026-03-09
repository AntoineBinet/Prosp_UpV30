def test_api_data_requires_authentication(client):
    response = client.get("/api/data")
    assert response.status_code == 401
    payload = response.get_json()
    assert payload["ok"] is False


def test_api_data_returns_seeded_payload(authenticated_client):
    response = authenticated_client.get("/api/data")
    assert response.status_code == 200
    payload = response.get_json()

    assert isinstance(payload["companies"], list)
    assert isinstance(payload["prospects"], list)
    assert payload["maxCompanyId"] >= 2
    assert payload["maxProspectId"] >= 2
    assert any(prospect["name"] == "Alice Martin" for prospect in payload["prospects"])


def test_api_dashboard_returns_kpi_structure(authenticated_client):
    response = authenticated_client.get("/api/dashboard")
    assert response.status_code == 200
    payload = response.get_json()

    assert payload["ok"] is True
    assert "data" in payload
    assert "today" in payload["data"]
    assert "week" in payload["data"]
    assert "pipeline" in payload["data"]
    assert payload["data"]["pipeline"]["total"] >= 2


def test_api_search_returns_matching_prospects(authenticated_client):
    response = authenticated_client.get("/api/search?q=Alice")
    assert response.status_code == 200
    payload = response.get_json()

    assert "prospects" in payload
    assert payload["counts"]["prospects"] >= 1
    assert any(prospect["name"] == "Alice Martin" for prospect in payload["prospects"])


def test_api_stats_days_mode(authenticated_client):
    response = authenticated_client.get("/api/stats?days=7")
    assert response.status_code == 200
    payload = response.get_json()

    assert payload["ok"] is True
    assert payload["range"]["mode"] == "days"
    assert payload["totals"]["prospects"] >= 2
    assert "hotCompanies" in payload


def test_api_stats_custom_date_range(authenticated_client):
    response = authenticated_client.get("/api/stats?start=2026-01-01&end=2026-01-31")
    assert response.status_code == 200
    payload = response.get_json()

    assert payload["ok"] is True
    assert payload["range"]["mode"] == "custom"
    assert payload["range"]["from"] == "2026-01-01"
    assert payload["range"]["to"] == "2026-01-31"


def test_api_focus_queue_returns_items(authenticated_client):
    response = authenticated_client.get("/api/focus_queue")
    assert response.status_code == 200
    payload = response.get_json()

    assert payload["ok"] is True
    assert isinstance(payload["items"], list)
    assert any(item["name"] == "Alice Martin" for item in payload["items"])


def test_api_prospect_timeline_contains_call_note_and_push(authenticated_client):
    response = authenticated_client.get("/api/prospect/timeline?id=1")
    assert response.status_code == 200
    payload = response.get_json()

    assert payload["ok"] is True
    types = {event["type"] for event in payload["events"]}
    assert "call_note" in types
    assert "push" in types
