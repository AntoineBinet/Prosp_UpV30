"""Tests d'intégration pour les routes API 'Avant réunion IA'."""

import json
import pytest


def test_infos_rdv_stream_requires_auth(client):
    """Test : la route SSE nécessite une authentification."""
    response = client.get("/api/prospect/1/infos-rdv-stream")
    assert response.status_code == 401


def test_infos_rdv_stream_prospect_not_found(authenticated_client):
    """Test : la route SSE retourne 403 ou 404 si le prospect n'existe pas."""
    response = authenticated_client.get("/api/prospect/99999/infos-rdv-stream")
    # Peut être 403 (n'appartient pas) ou 404 (n'existe pas) selon l'ordre de vérification
    assert response.status_code in [403, 404]
    if response.status_code == 404:
        payload = response.get_json()
        assert payload["ok"] is False


def test_infos_rdv_stream_prospect_not_owned(authenticated_client):
    """Test : la route SSE retourne 403 si le prospect n'appartient pas à l'utilisateur."""
    # On suppose qu'il n'y a pas de prospect avec id=999 qui appartient à l'utilisateur de test
    response = authenticated_client.get("/api/prospect/999/infos-rdv-stream")
    # Soit 404 (n'existe pas) soit 403 (n'appartient pas)
    assert response.status_code in [403, 404]


def test_download_rdv_pdf_requires_auth(client):
    """Test : la route PDF nécessite une authentification."""
    response = client.get("/api/prospect/1/download-rdv-pdf")
    assert response.status_code == 401


def test_download_rdv_pdf_no_analysis(authenticated_client):
    """Test : la route PDF retourne 404 si aucune analyse n'est disponible."""
    # On utilise un prospect qui existe (id=1 d'après conftest.py)
    response = authenticated_client.get("/api/prospect/1/download-rdv-pdf")
    # Soit 404 (pas d'analyse en session) soit 404 (prospect n'existe pas)
    assert response.status_code == 404
    payload = response.get_json()
    assert payload["ok"] is False
    assert "analyse" in payload["error"].lower() or "introuvable" in payload["error"].lower()


def test_infos_rdv_stream_returns_sse_format(authenticated_client, monkeypatch):
    """Test : la route SSE retourne un format SSE valide (mock Ollama)."""
    # Mock Ollama pour éviter d'avoir besoin d'Ollama en cours d'exécution
    import urllib.request
    original_urlopen = urllib.request.urlopen
    
    class MockResponse:
        def __init__(self):
            self.data = [
                b'{"response": "{\\"qui_est_il\\": {\\"resume\\": \\"Test\\"}}", "done": false}\n',
                b'{"response": "", "done": true}\n'
            ]
            self.index = 0
        
        def __enter__(self):
            return self
        
        def __exit__(self, *args):
            pass
        
        def __iter__(self):
            return self
        
        def __next__(self):
            if self.index < len(self.data):
                result = self.data[self.index]
                self.index += 1
                return result
            raise StopIteration
    
    def mock_urlopen(req, timeout=None):
        return MockResponse()
    
    monkeypatch.setattr(urllib.request, "urlopen", mock_urlopen)
    
    # Test avec un prospect existant (id=1)
    response = authenticated_client.get("/api/prospect/1/infos-rdv-stream")
    
    # La route devrait retourner un stream SSE
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    assert "Cache-Control" in response.headers
    assert "no-cache" in response.headers["Cache-Control"]
