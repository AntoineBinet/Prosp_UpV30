"""Tests pour la fonctionnalité 'Avant réunion IA' - génération PDF fiche RDV."""

import json
import pytest
from io import BytesIO


@pytest.fixture
def sample_prospect():
    """Fixture : prospect de test."""
    return {
        "id": 1,
        "name": "Samir Khoucha",
        "prenom": "Samir",
        "nom": "Khoucha",
        "fonction": "Senior Engineering Project Manager",
        "company_id": 1,
        "linkedin": "https://www.linkedin.com/in/samir-khoucha",
        "statut": "Rendez-vous",
        "owner_id": 1,
    }


@pytest.fixture
def sample_company():
    """Fixture : entreprise de test."""
    return {
        "id": 1,
        "groupe": "Groupe Danieli",
        "site": "Saint-Quentin-Fallavier",
        "owner_id": 1,
    }


@pytest.fixture
def sample_ollama_data():
    """Fixture : données JSON simulées d'Ollama."""
    return {
        "qui_est_il": {
            "resume": "Samir Khoucha est un ingénieur chef de projet international, spécialisé en solutions micro-ondes pour l'industrie.",
            "titre_actuel": "Senior Engineering Project Manager chez Groupe Danieli",
            "parcours": "Plus de 15 ans d'expérience en gestion de projets techniques et service client.",
            "stack_specialites": ["project management", "international projects", "customer support"],
            "activite_complementaire": ""
        },
        "contexte_entreprise": {
            "description": "Groupe Danieli est un grand groupe industriel international, spécialisé dans les équipements pour la sidérurgie.",
            "taille": "Grand groupe international",
            "secteurs": ["Sidérurgie", "Métallurgie"],
            "metiers_autour": [
                "Chefs de projet / project managers",
                "Ingénieurs process / mécaniques / élec / automation",
                "Service / support client"
            ],
            "conclusion_matching": "Ces métiers matchent avec des candidats en systèmes embarqués, automatisation, robotique lourde."
        },
        "besoins_probables": {
            "data_referentiels": [
                "Structurer les référentiels techniques d'équipements"
            ],
            "digital_bi2b": [],
            "automatisation": [
                "Outils internes pour standardiser les offres techniques"
            ],
            "ressources_contraintes": [
                "Besoin de renfort sur ingénierie logicielle industrielle"
            ],
            "candidats_a_positionner": [
                "Ingé embarqué / industrie 4.0",
                "Dev back-end / data",
                "Ingé systèmes / intégration"
            ]
        },
        "interlocuteurs_potentiels": {
            "marketing_digital": [],
            "commerce_technique": [
                "Responsables commerciaux projets internationaux"
            ],
            "technique_projet": [
                "Chefs de projet, responsables d'ingénierie"
            ],
            "conclusion": "Ces personas peuvent avoir besoin d'ingés embarqué pour développer des solutions connectées."
        }
    }


def test_build_ollama_prompt_rdv(sample_prospect, sample_company):
    """Test : build_ollama_prompt_rdv génère un prompt valide."""
    # Import ici pour éviter les erreurs si app.py n'est pas chargé
    import sys
    sys.path.insert(0, '.')
    from app import build_ollama_prompt_rdv
    
    prompt = build_ollama_prompt_rdv(sample_prospect, sample_company)
    
    assert isinstance(prompt, str)
    assert len(prompt) > 100
    assert "Samir" in prompt
    assert "Khoucha" in prompt
    assert "Groupe Danieli" in prompt
    assert "JSON" in prompt
    assert "qui_est_il" in prompt
    assert "contexte_entreprise" in prompt


def test_build_fallback_prompt_rdv(sample_prospect, sample_company):
    """Test : build_fallback_prompt_rdv génère un prompt complet."""
    import sys
    sys.path.insert(0, '.')
    from app import build_fallback_prompt_rdv
    
    prompt = build_fallback_prompt_rdv(sample_prospect, sample_company)
    
    assert isinstance(prompt, str)
    assert len(prompt) > 100
    assert "Samir" in prompt
    assert "Khoucha" in prompt
    assert "JSON" in prompt


def test_build_fiche_rdv_pdf(sample_prospect, sample_company, sample_ollama_data):
    """Test : build_fiche_rdv_pdf génère un PDF valide."""
    import sys
    sys.path.insert(0, '.')
    from app import build_fiche_rdv_pdf
    
    pdf_buffer = build_fiche_rdv_pdf(sample_prospect, sample_company, sample_ollama_data)
    
    assert isinstance(pdf_buffer, BytesIO)
    
    # Vérifier que c'est bien un PDF (commence par %PDF)
    pdf_bytes = pdf_buffer.read()
    assert pdf_bytes.startswith(b'%PDF')
    assert len(pdf_bytes) > 1000  # PDF devrait faire au moins quelques KB
    
    # Le texte dans le PDF est encodé, on vérifie juste la structure
    # Pour vérifier le contenu, il faudrait utiliser PyPDF2 ou pdfplumber


def test_build_fiche_rdv_pdf_without_company(sample_prospect, sample_ollama_data):
    """Test : build_fiche_rdv_pdf fonctionne sans entreprise."""
    import sys
    sys.path.insert(0, '.')
    from app import build_fiche_rdv_pdf
    
    pdf_buffer = build_fiche_rdv_pdf(sample_prospect, None, sample_ollama_data)
    
    assert isinstance(pdf_buffer, BytesIO)
    pdf_bytes = pdf_buffer.read()
    assert pdf_bytes.startswith(b'%PDF')


def test_build_fiche_rdv_pdf_minimal_data():
    """Test : build_fiche_rdv_pdf fonctionne avec des données minimales."""
    import sys
    sys.path.insert(0, '.')
    from app import build_fiche_rdv_pdf
    
    prospect = {"name": "Test Prospect", "fonction": "Test Function"}
    company = {"groupe": "Test Company", "site": "Test City"}
    ollama_data = {
        "qui_est_il": {"resume": "Test resume"},
        "contexte_entreprise": {"description": "Test description"},
        "besoins_probables": {},
        "interlocuteurs_potentiels": {}
    }
    
    pdf_buffer = build_fiche_rdv_pdf(prospect, company, ollama_data)
    
    assert isinstance(pdf_buffer, BytesIO)
    pdf_bytes = pdf_buffer.read()
    assert pdf_bytes.startswith(b'%PDF')
