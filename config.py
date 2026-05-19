"""ProspUp — configuration centrale (chemins, env vars, détection Outlook).

Ce module est importé en haut de app.py et expose les constantes globales
utilisées dans tout le code. Aucun import de symboles applicatifs ici pour
éviter les dépendances circulaires.
"""
from __future__ import annotations

import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
APP_VERSION = "32.67"


def _resolve_db_path() -> Path:
    """
    Resolve database path in this order:
      1) PROSPECTION_DB env var
      2) db_path.txt file at project root
      3) local ./prospects.db
    """
    env = os.environ.get("PROSPECTION_DB")
    if env:
        p = env.strip().strip('"')
        return Path(p)

    cfg = APP_DIR / "db_path.txt"
    if cfg.exists():
        try:
            p = cfg.read_text(encoding="utf-8").strip().strip('"')
        except Exception:
            p = cfg.read_text().strip().strip('"')
        if p:
            return Path(p)

    return APP_DIR / "prospects.db"


DB_PATH = _resolve_db_path()
DATA_DIR = APP_DIR / "data"
INITIAL_JSON = APP_DIR / "initial_data.json"
TEMPLATE_PATH = APP_DIR / "excel_template.xlsx"
SNAPSHOT_DIR = APP_DIR / "snapshots"
PHOTOS_DIR = DATA_DIR / "photos"
AVATARS_DIR = DATA_DIR / "avatars"

# Ollama (IA locale) — proxy backend vers 127.0.0.1:11434
OLLAMA_URL = (os.environ.get("OLLAMA_URL") or "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL") or "llama3.2"
OLLAMA_TIMEOUT = int(os.environ.get("OLLAMA_TIMEOUT") or "120")

# Tavily (recherche web cloud) — enrichit Ollama avec des données web
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY") or ""
TAVILY_URL = "https://api.tavily.com/search"


def _detect_outlook() -> bool:
    """Tente d'importer win32com.client pour détecter la présence d'Outlook."""
    try:
        import win32com.client  # type: ignore
        app = win32com.client.Dispatch("Outlook.Application")
        del app
        return True
    except Exception:
        return False


OUTLOOK_AVAILABLE: bool = _detect_outlook()
