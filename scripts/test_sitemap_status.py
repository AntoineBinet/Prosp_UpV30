"""Test HTTP automatique pour la toile d'araignée.

Parcourt toutes les routes pages + endpoints API GET safes, mesure status code
et durée, et persiste les résultats dans data/sitemap_status.json.

Lancement :
    PORT=8765 python scripts/test_sitemap_status.py

Le serveur Flask doit déjà tourner (admin/admin).
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

BASE = os.environ.get("PROSPUP_BASE", f"http://127.0.0.1:{os.environ.get('PORT', '8765')}")
USERNAME = os.environ.get("PROSPUP_USER", "admin")
PASSWORD = os.environ.get("PROSPUP_PASS", "admin")
APP_DIR = Path(__file__).resolve().parents[1]
OUT = APP_DIR / "data" / "sitemap_status.json"

# ──────────────────────────────────────────────────────────────────────────
# Cibles à tester
# ──────────────────────────────────────────────────────────────────────────
PAGES: dict[str, str] = {
    "dashboard": "/v30/dashboard",
    "focus": "/v30/focus",
    "calendar": "/v30/calendrier",
    "stats": "/v30/stats",
    "prospects": "/v30/prospects",
    "entreprises": "/v30/entreprises",
    "candidats": "/v30/sourcing",
    "push": "/v30/push",
    "actus": "/v30/actus",
    "carte": "/v30/carte",
    "transcription": "/v30/transcription",
    "besoins": "/v30/besoins",
    "collab": "/v30/collab",
    "duplicates": "/v30/duplicates",
    "dc": "/v30/dc",
    "users": "/v30/users",
    "snapshots": "/v30/snapshots",
    "activity": "/v30/activity",
    "metiers": "/v30/metiers",
    "help": "/v30/help",
    "mode-prosp": "/v30/mode-prosp",
    "parametres": "/v30/parametres",
    "sitemap": "/v30/sitemap",
    "prospects-archives": "/v30/prospects/archives",
}

API_GETS: list[str] = [
    "/api/auth/me",
    "/api/health",
    "/api/app-version",
    "/api/settings",
    "/api/users",
    "/api/users/for-push",
    "/api/audit-log?limit=10",
    "/api/activity?limit=10",
    "/api/snapshots",
    "/api/admin/backups",
    "/api/system/check-deployment",
    "/api/system/logs?limit=10",
    "/api/views",
    "/api/dashboard",
    "/api/dashboard/stats",
    "/api/dashboard/pipeline-stages",
    "/api/dashboard/adaptive",
    "/api/dashboard/assistant/history",
    "/api/dashboard/assistant/suggestions",
    "/api/tasks",
    "/api/tasks/rules",
    "/api/tasks/optimize",
    "/api/focus_queue",
    "/api/manual-kpi",
    "/api/calendar_events?from=2026-01-01&to=2026-12-31",
    "/api/calendar_events_external",
    "/api/holidays?from=2026-01-01&to=2026-12-31",
    "/api/stats",
    "/api/stats/charts",
    "/api/stats/data",
    "/api/stats/predictions",
    "/api/stats/export",
    "/api/stats/export_weekly_xlsx",
    "/api/rapport-hebdo",
    "/api/data",
    "/api/search?q=test",
    "/api/prospect/upcoming-rdvs",
    "/api/prospects/quick-filter",
    "/api/prospects/tags-count",
    "/api/companies/list",
    "/api/candidates",
    "/api/candidates/source-from-folder",
    "/api/candidate-push",
    "/api/candidate-tabs",
    "/api/linkedin-inmails",
    "/api/candidates/fiche-entretien-template",
    "/api/duplicates",
    "/api/templates",
    "/api/push-categories",
    "/api/push-logs",
    "/api/push-logs/relance-reminders",
    "/api/push-campaigns",
    "/api/push/optimal-time",
    "/api/push/analytics",
    "/api/map/markers",
    "/api/map/stats",
    "/api/actus/status",
    "/api/actus/articles?region=national&limit=5",
    "/api/actus/jobs?region=national&limit=5",
    "/api/actus/favoris",
    "/api/transcription",
    "/api/transcription/preflight",
    "/api/besoins",
    "/api/collab/collaborators",
    "/api/collab/shared-companies",
    "/api/collab/shared-prospects",
    "/api/dc/history",
    "/api/custom_metiers",
    "/api/metiers/integrations-cache",
    "/api/mode-prosp/data",
    "/api/ai/config",
    "/api/ollama/models",
    "/api/ollama/recommended",
    "/api/deploy/health",
    "/api/deploy/remote",
    "/api/deploy/check-deps",
    "/api/deploy/update-check",
    "/api/deploy/validation-status",
    "/api/deploy/portfolio/health",
    "/api/deploy/install-torch-cuda/status",
    "/api/ec1-checklist/themes",
    "/api/rdv-checklist/themes",
    "/api/rdv-checklist?prospect_id=1",
    "/api/ec1-checklist?candidate_id=1",
    "/api/export/day",
    "/api/export/xlsx",
    "/api/push-logs/export.xlsx",
    "/api/candidates/export.csv",
]


def status_label(status: int) -> str:
    if status in (200, 201, 204, 302, 303, 304):
        return "ok"
    if status in (401, 403):
        return "warn"  # auth-related
    if status == 404:
        return "ko"
    if 400 <= status < 500:
        return "warn"  # endpoint OK but missing params
    if status == 0:
        return "ko"
    return "ko"


def fetch(s: requests.Session, url: str, method: str = "GET") -> dict:
    full = f"{BASE}{url}" if url.startswith("/") else url
    t0 = time.perf_counter()
    try:
        r = s.request(method, full, timeout=20, allow_redirects=False, stream=True)
        size = 0
        try:
            chunk = next(r.iter_content(chunk_size=64_000), b"")
            size = len(chunk) if chunk else 0
        except Exception:
            pass
        r.close()
        return {
            "url": url,
            "method": method,
            "status": r.status_code,
            "ms": round((time.perf_counter() - t0) * 1000, 1),
            "size": size,
            "ok": r.ok,
        }
    except Exception as exc:
        return {
            "url": url,
            "method": method,
            "status": 0,
            "ms": round((time.perf_counter() - t0) * 1000, 1),
            "size": 0,
            "ok": False,
            "error": str(exc),
        }


def main():
    s = requests.Session()
    # Login
    try:
        r = s.post(
            f"{BASE}/api/auth/login",
            json={"username": USERNAME, "password": PASSWORD},
            timeout=10,
        )
        if r.status_code != 200:
            print(f"Login failed: {r.status_code} {r.text[:200]}", file=sys.stderr)
            sys.exit(1)
        print(f"[login] OK ({USERNAME}, role={r.json().get('role')})")
    except Exception as exc:
        print(f"Login error: {exc}", file=sys.stderr)
        sys.exit(1)

    # Le cookie Flask est Secure (HTTPS prod). En HTTP local on force son
    # ré-injection sur chaque requête sinon requests le rejette silencieusement.
    session_cookie = s.cookies.get("session")
    if session_cookie:
        s.headers["Cookie"] = f"session={session_cookie}"

    results: dict = {
        "ts": datetime.now().isoformat(timespec="seconds"),
        "base": BASE,
        "pages": {},
        "endpoints": {},
        "summary": {"ok": 0, "warn": 0, "ko": 0},
    }

    print(f"\n=== Pages ({len(PAGES)}) ===")
    for pid, path in PAGES.items():
        r = fetch(s, path)
        r["label"] = status_label(r["status"])
        results["pages"][pid] = r
        results["summary"][r["label"]] += 1
        flag = {"ok": "🟢", "warn": "🟠", "ko": "🔴"}[r["label"]]
        print(f"  {flag} {path:40} → {r['status']} ({r['ms']:.0f}ms)")

    print(f"\n=== Endpoints API ({len(API_GETS)}) ===")
    for url in API_GETS:
        r = fetch(s, url)
        r["label"] = status_label(r["status"])
        results["endpoints"][url] = r
        results["summary"][r["label"]] += 1
        flag = {"ok": "🟢", "warn": "🟠", "ko": "🔴"}[r["label"]]
        print(f"  {flag} {url:55} → {r['status']} ({r['ms']:.0f}ms)")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n→ {OUT.relative_to(APP_DIR)}  {results['summary']}")


if __name__ == "__main__":
    main()
