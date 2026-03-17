"""
audit_prospup.py — Audit automatisé de ProspUp CRM
====================================================
Crawl toutes les pages, teste les boutons, vérifie la cohérence UI,
génère un rapport HTML complet.

# REQUIREMENTS (pip install) :
#   playwright        >= 1.40
#   After install: python -m playwright install chromium
#
# USAGE :
#   python audit_prospup.py
#   python audit_prospup.py --url http://localhost:8000
#   python audit_prospup.py --url http://localhost:8000 --user admin --pass admin
"""

import sys
import os
import re
import json
import time
import asyncio
import argparse
import datetime
from dataclasses import dataclass, field
from typing import Optional

try:
    from playwright.async_api import async_playwright, Page, BrowserContext, TimeoutError as PWTimeout
except ImportError:
    print("❌  Playwright non installé. Lancez : pip install playwright && python -m playwright install chromium")
    sys.exit(1)

# ─── Configuration ────────────────────────────────────────────────────────────

DEFAULT_BASE_URL  = "http://localhost:8000"
DEFAULT_USER      = os.getenv("PROSPUP_USER", "admin")
DEFAULT_PASS      = os.getenv("PROSPUP_PASS", "admin")
ACTION_TIMEOUT    = 5_000     # ms
NAV_TIMEOUT       = 10_000    # ms
REPORT_FILE       = "audit_report.html"

# Pages HTML à auditer (route → page_id attendu dans data-page)
HTML_PAGES = [
    ("/dashboard",  "dashboard"),
    ("/",           "prospects"),
    ("/entreprises","companies"),
    ("/focus",      "focus"),
    ("/sourcing",   "sourcing"),
    ("/calendrier", "calendar"),
    ("/collab",     "collab"),
    ("/push",       "push"),
    ("/templates",  "templates"),
    ("/stats",      "stats"),
    ("/rapport",    "rapport"),
    ("/metiers",    "metiers"),
    ("/duplicates", "duplicates"),
    ("/snapshots",  "snapshots"),
    ("/parametres", "settings"),
    ("/help",       "help"),
]

# API GET rapides à vérifier (status 200 attendu)
API_GET_PROBES = [
    "/api/auth/me",
    "/api/dashboard",
    "/api/data",
    "/api/tasks",
    "/api/views?page=prospects",
    "/api/focus_queue",
    "/api/duplicates",
    "/api/snapshots",
    "/api/stats",
    "/api/templates",
    "/api/push-categories",
    "/api/calendar_events",
    "/api/settings",
    "/api/ai/config",
    "/api/users",
    "/api/deploy/health",
    "/api/app-version",
]

# Boutons à ignorer (déclenchent des destructions irréversibles en test)
SKIP_BUTTON_TEXTS = {
    "supprimer", "delete", "réinitialiser", "reset", "rollback",
    "purger", "purge", "restaurer snapshot", "restore snapshot",
    "redémarrer", "restart", "mettre à jour et redémarrer",
}

# ─── Structures de données ────────────────────────────────────────────────────

@dataclass
class PageResult:
    url: str
    page_id: str = ""
    http_status: int = 0
    sidebar_ok: bool = False
    cache_buster_ok: bool = False
    title: str = ""
    favicon_ok: bool = False
    buttons_tested: int = 0
    buttons_skipped: int = 0
    js_errors: list = field(default_factory=list)
    http_errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    broken_links: list = field(default_factory=list)
    load_ms: float = 0

    @property
    def has_error(self):
        return bool(self.js_errors or self.http_errors or self.http_status >= 400)

    @property
    def has_warning(self):
        return bool(self.warnings or self.broken_links
                    or not self.sidebar_ok or not self.cache_buster_ok)

@dataclass
class ApiResult:
    url: str
    method: str
    status: int
    ok: bool
    error: str = ""
    latency_ms: float = 0

@dataclass
class AuditReport:
    base_url: str
    started_at: datetime.datetime
    page_results: list = field(default_factory=list)
    api_results: list  = field(default_factory=list)
    login_ok: bool = False

    @property
    def ended_at(self):
        return datetime.datetime.now()

    @property
    def total_errors(self):
        return sum(1 for r in self.page_results if r.has_error) \
             + sum(1 for r in self.api_results  if not r.ok)

    @property
    def total_warnings(self):
        return sum(1 for r in self.page_results if r.has_warning and not r.has_error)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _norm(text: str) -> str:
    return text.strip().lower()

def _should_skip(text: str) -> bool:
    t = _norm(text)
    return any(kw in t for kw in SKIP_BUTTON_TEXTS)

async def _safe_click(page: Page, locator, timeout: int = ACTION_TIMEOUT) -> Optional[str]:
    """Clique sur un élément, retourne un message d'erreur ou None."""
    try:
        await locator.click(timeout=timeout, force=False)
        await page.wait_for_timeout(400)
        return None
    except PWTimeout:
        return "timeout"
    except Exception as e:
        return str(e)[:120]

async def _fetch_status(context: BrowserContext, url: str) -> tuple[int, float]:
    """Fait un GET et retourne (status, latency_ms)."""
    t0 = time.monotonic()
    try:
        resp = await context.request.get(url, timeout=ACTION_TIMEOUT)
        return resp.status, (time.monotonic() - t0) * 1000
    except Exception:
        return 0, 0

# ─── Étape 1 : Authentification ───────────────────────────────────────────────

async def do_login(page: Page, base_url: str, username: str, password: str) -> bool:
    print(f"  → Login avec {username}…")
    try:
        await page.goto(f"{base_url}/login", timeout=NAV_TIMEOUT)
        await page.fill("#username", username, timeout=ACTION_TIMEOUT)
        await page.fill("#password", password, timeout=ACTION_TIMEOUT)
        await page.click("button[type=submit], input[type=submit]", timeout=ACTION_TIMEOUT)
        await page.wait_for_url(lambda u: "/login" not in u, timeout=NAV_TIMEOUT)
        print("  ✓ Authentifié")
        return True
    except Exception as e:
        # Essai via API directe
        try:
            resp = await page.request.post(
                f"{base_url}/api/auth/login",
                data=json.dumps({"username": username, "password": password}),
                headers={"Content-Type": "application/json"},
                timeout=ACTION_TIMEOUT,
            )
            if resp.ok:
                print("  ✓ Authentifié via API")
                return True
        except Exception:
            pass
        print(f"  ✗ Login échoué : {e}")
        return False

# ─── Étape 2 : Audit d'une page HTML ──────────────────────────────────────────

async def audit_page(page: Page, base_url: str, route: str, expected_page_id: str) -> PageResult:
    url = base_url + route
    result = PageResult(url=url, page_id=expected_page_id)
    js_errors = []
    http_errors = []

    # Collecter erreurs JS console
    page.on("console", lambda msg: js_errors.append(msg.text) if msg.type == "error" else None)
    # Collecter réponses HTTP >= 400
    page.on("response", lambda r: http_errors.append(f"{r.status} {r.url}") if r.status >= 400 else None)

    t0 = time.monotonic()
    try:
        resp = await page.goto(url, timeout=NAV_TIMEOUT, wait_until="domcontentloaded")
        result.http_status = resp.status if resp else 0
        result.load_ms = (time.monotonic() - t0) * 1000
    except PWTimeout:
        result.http_status = 0
        result.warnings.append("Timeout au chargement de la page")
        return result
    except Exception as e:
        result.http_status = 0
        result.warnings.append(f"Erreur navigation : {e}")
        return result

    await page.wait_for_timeout(800)  # JS init

    # ── Titre
    result.title = await page.title()

    # ── Favicon
    favicon = await page.query_selector("link[rel~='icon']")
    result.favicon_ok = favicon is not None

    # ── Sidebar présente
    sidebar = await page.query_selector("aside.sidebar, .sidebar, #sidebar")
    result.sidebar_ok = sidebar is not None

    # ── Cache busters sur <link> et <script>
    cb_links   = await page.eval_on_selector_all(
        "link[href*='?v='], script[src*='?v=']", "els => els.length"
    )
    cb_missing = await page.eval_on_selector_all(
        "link[rel='stylesheet']:not([href*='?v=']):not([href*='cdn']):not([href*='http'])",
        "els => els.map(e => e.getAttribute('href'))"
    )
    result.cache_buster_ok = cb_links > 0
    if cb_missing:
        result.warnings.append(f"Feuilles CSS sans cache buster : {cb_missing[:3]}")

    # ── Data-page cohérence
    actual_page = await page.eval_on_selector("body", "el => el.dataset.page || ''")
    if expected_page_id and actual_page.lower() != expected_page_id.lower():
        result.warnings.append(
            f"data-page attendu '{expected_page_id}', trouvé '{actual_page}'"
        )

    # ── Liens internes brisés (check asynchrone rapide)
    internal_hrefs = await page.eval_on_selector_all(
        "a[href^='/']:not([href^='/static']):not([href^='/?'])",
        "els => [...new Set(els.map(e => e.getAttribute('href')))].slice(0, 15)"
    )
    broken = []
    for href in internal_hrefs:
        if href in ("/login", "/offline.html"):
            continue
        status, _ = await _fetch_status(page.context, base_url + href)
        if status == 404:
            broken.append(href)
    result.broken_links = broken

    # ── Test des boutons visibles
    await _test_buttons(page, result)

    # Consolider erreurs
    result.js_errors   = [e for e in js_errors   if not _is_noise(e)][:10]
    result.http_errors = [e for e in http_errors  if "/static/" not in e][:10]

    return result

def _is_noise(msg: str) -> bool:
    """Filtre les erreurs JS non-critiques (extensions browser, SW, etc.)."""
    noise = ["favicon", "chrome-extension", "moz-extension",
             "net::ERR_BLOCKED", "serviceworker", "sw.js",
             "Failed to load resource: net::ERR_ABORTED",
             "Uncaught (in promise) AbortError"]
    return any(n.lower() in msg.lower() for n in noise)

async def _test_buttons(page: Page, result: PageResult):
    """Clique sur chaque bouton visible non-destructif, note les erreurs."""
    # Sélectionner boutons/inputs visibles hors modales cachées
    buttons = await page.query_selector_all(
        "button:visible:not([disabled]):not([style*='display: none']), "
        "input[type=button]:visible:not([disabled]), "
        "input[type=submit]:visible:not([disabled])"
    )

    for btn in buttons[:25]:  # limiter à 25 par page
        try:
            text = (await btn.inner_text()).strip()
        except Exception:
            text = ""

        if _should_skip(text):
            result.buttons_skipped += 1
            continue

        # Ignorer boutons dans modales non-ouvertes
        in_modal = await btn.evaluate(
            "el => !!el.closest('.modal:not(.active), [aria-hidden=\"true\"], [style*=\"display: none\"]')"
        )
        if in_modal:
            continue

        err = await _safe_click(page, btn)
        result.buttons_tested += 1

        if err and err not in ("timeout",):
            result.warnings.append(f"Bouton '{text[:40]}' → {err}")

        # Fermer toute modale qui aurait pu s'ouvrir
        await _close_open_modals(page)

async def _close_open_modals(page: Page):
    """Ferme les modales ouvertes via Escape ou bouton close."""
    try:
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)
    except Exception:
        pass
    for sel in [".modal.active .modal-close",
                ".modal.active [data-dismiss]",
                ".modal.active button.close"]:
        try:
            btn = await page.query_selector(sel)
            if btn:
                await btn.click(timeout=1000)
        except Exception:
            pass

# ─── Étape 3 : Audit des endpoints API ────────────────────────────────────────

async def audit_api_endpoints(context: BrowserContext, base_url: str) -> list[ApiResult]:
    results = []
    print(f"\n{'─'*50}")
    print(f"📡  Test des endpoints API ({len(API_GET_PROBES)} GET probes)…")

    for path in API_GET_PROBES:
        url = base_url + path
        t0  = time.monotonic()
        try:
            resp = await context.request.get(url, timeout=ACTION_TIMEOUT)
            latency = (time.monotonic() - t0) * 1000
            ok  = resp.status < 400
            err = "" if ok else f"HTTP {resp.status}"
            sym = "✓" if ok else "✗"
            print(f"  {sym} {resp.status}  {path}  ({latency:.0f} ms)")
            results.append(ApiResult(url=url, method="GET", status=resp.status,
                                     ok=ok, error=err, latency_ms=latency))
        except Exception as e:
            latency = (time.monotonic() - t0) * 1000
            print(f"  ✗   0  {path}  → {str(e)[:60]}")
            results.append(ApiResult(url=url, method="GET", status=0,
                                     ok=False, error=str(e)[:120], latency_ms=latency))
    return results

# ─── Génération du rapport HTML ───────────────────────────────────────────────

def _status_badge(ok: bool, label: str = "") -> str:
    color = "#22c55e" if ok else "#ef4444"
    sym   = "✓" if ok else "✗"
    lbl   = label or (sym)
    return f'<span style="color:{color};font-weight:600">{sym} {lbl}</span>'

def _http_badge(status: int) -> str:
    if status == 200:
        return f'<span style="color:#22c55e;font-weight:600">{status}</span>'
    if status == 0:
        return '<span style="color:#ef4444;font-weight:600">ERR</span>'
    if status < 400:
        return f'<span style="color:#f59e0b;font-weight:600">{status}</span>'
    return f'<span style="color:#ef4444;font-weight:600">{status}</span>'

def _row_class(r: PageResult) -> str:
    if r.has_error:   return "row-error"
    if r.has_warning: return "row-warn"
    return "row-ok"

def generate_html_report(report: AuditReport) -> str:
    now_str = report.started_at.strftime("%d/%m/%Y à %H:%M:%S")
    duration = (report.ended_at - report.started_at).total_seconds()

    total_pages   = len(report.page_results)
    total_ok      = sum(1 for r in report.page_results if not r.has_error and not r.has_warning)
    total_errors  = report.total_errors
    total_warnings= report.total_warnings
    api_ok        = sum(1 for r in report.api_results if r.ok)
    api_err       = sum(1 for r in report.api_results if not r.ok)

    # ── Lignes du tableau pages
    page_rows = ""
    for r in report.page_results:
        cls = _row_class(r)
        all_issues = []
        for e in r.js_errors:   all_issues.append(f'<li class="err">JS: {e}</li>')
        for e in r.http_errors: all_issues.append(f'<li class="err">HTTP: {e}</li>')
        for w in r.warnings:    all_issues.append(f'<li class="warn">⚠ {w}</li>')
        for b in r.broken_links:all_issues.append(f'<li class="warn">🔗 404: {b}</li>')
        issues_html = f'<ul class="issues">{"".join(all_issues)}</ul>' if all_issues else '<span style="color:#22c55e">—</span>'
        title_short = (r.title[:40] + "…") if len(r.title) > 40 else r.title

        page_rows += f"""
        <tr class="{cls}">
          <td><a href="{r.url}" target="_blank">{r.url.replace(report.base_url,'')}</a></td>
          <td style="text-align:center">{_http_badge(r.http_status)}</td>
          <td style="text-align:center">{_status_badge(r.sidebar_ok)}</td>
          <td style="text-align:center">{_status_badge(r.cache_buster_ok)}</td>
          <td style="text-align:center">{_status_badge(r.favicon_ok)}</td>
          <td style="text-align:center">{r.buttons_tested} <small style="color:#888">(+{r.buttons_skipped} skip)</small></td>
          <td style="text-align:center">{r.load_ms:.0f} ms</td>
          <td style="font-size:11px;max-width:300px">{title_short}</td>
          <td style="font-size:11px">{issues_html}</td>
        </tr>"""

    # ── Lignes du tableau API
    api_rows = ""
    for r in report.api_results:
        cls = "" if r.ok else "row-error"
        api_rows += f"""
        <tr class="{cls}">
          <td><code>{r.url.replace(report.base_url,'')}</code></td>
          <td style="text-align:center">{r.method}</td>
          <td style="text-align:center">{_http_badge(r.status)}</td>
          <td style="text-align:center">{r.latency_ms:.0f} ms</td>
          <td style="font-size:11px;color:#ef4444">{r.error}</td>
        </tr>"""

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audit ProspUp — {now_str}</title>
<style>
  :root {{
    --bg: #0f1117; --surface: #1a1f2e; --border: rgba(255,255,255,.08);
    --text: #e5e7eb; --text2: #9ca3af; --primary: #f36f21;
    --ok: #22c55e; --warn: #f59e0b; --err: #ef4444;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.5; padding: 24px; }}
  h1 {{ font-size: 24px; font-weight: 800; color: var(--primary); margin-bottom: 4px; }}
  h2 {{ font-size: 16px; font-weight: 700; color: var(--text); margin: 28px 0 10px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }}
  .meta {{ color: var(--text2); font-size: 12px; margin-bottom: 20px; }}
  .summary {{ display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 28px; }}
  .stat {{ background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 20px; min-width: 120px; text-align: center; }}
  .stat-value {{ font-size: 28px; font-weight: 800; }}
  .stat-label {{ color: var(--text2); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }}
  .stat.ok  .stat-value {{ color: var(--ok); }}
  .stat.err .stat-value {{ color: var(--err); }}
  .stat.warn .stat-value {{ color: var(--warn); }}
  table {{ width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 12px; overflow: hidden; margin-bottom: 24px; }}
  th {{ background: rgba(255,255,255,.04); padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--text2); white-space: nowrap; }}
  td {{ padding: 7px 10px; border-top: 1px solid var(--border); vertical-align: top; }}
  tr.row-error {{ background: rgba(239,68,68,.08); }}
  tr.row-warn  {{ background: rgba(245,158,11,.06); }}
  tr.row-ok:hover, tr:not(.row-error):not(.row-warn):hover {{ background: rgba(255,255,255,.03); }}
  a {{ color: var(--primary); text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  code {{ font-family: 'Fira Code', monospace; font-size: 11.5px; background: rgba(255,255,255,.06); padding: 1px 5px; border-radius: 4px; }}
  ul.issues {{ list-style: none; padding: 0; }}
  ul.issues li {{ padding: 1px 0; }}
  ul.issues li.err  {{ color: var(--err); }}
  ul.issues li.warn {{ color: var(--warn); }}
  .badge-login {{ display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }}
  .badge-ok  {{ background: rgba(34,197,94,.15); color: var(--ok); }}
  .badge-err {{ background: rgba(239,68,68,.15); color: var(--err); }}
  @media (max-width: 900px) {{ body {{ padding: 12px; }} table {{ font-size: 11px; }} }}
</style>
</head>
<body>
<h1>🔍 Audit ProspUp</h1>
<p class="meta">
  URL : <a href="{report.base_url}" target="_blank">{report.base_url}</a> &nbsp;·&nbsp;
  Exécuté le {now_str} &nbsp;·&nbsp;
  Durée : {duration:.1f} s &nbsp;·&nbsp;
  Login : <span class="badge-login {'badge-ok' if report.login_ok else 'badge-err'}">{'✓ admin' if report.login_ok else '✗ échoué'}</span>
</p>

<div class="summary">
  <div class="stat"><div class="stat-value">{total_pages}</div><div class="stat-label">Pages testées</div></div>
  <div class="stat ok"><div class="stat-value">{total_ok}</div><div class="stat-label">Pages OK</div></div>
  <div class="stat err"><div class="stat-value">{total_errors}</div><div class="stat-label">Erreurs</div></div>
  <div class="stat warn"><div class="stat-value">{total_warnings}</div><div class="stat-label">Avertissements</div></div>
  <div class="stat"><div class="stat-value">{api_ok}/{api_ok+api_err}</div><div class="stat-label">API OK</div></div>
  <div class="stat"><div class="stat-value">{sum(r.buttons_tested for r in report.page_results)}</div><div class="stat-label">Boutons testés</div></div>
</div>

<h2>📄 Pages HTML</h2>
<table>
  <thead>
    <tr>
      <th>URL</th><th>HTTP</th><th>Sidebar</th><th>Cache ?v=</th>
      <th>Favicon</th><th>Boutons</th><th>Temps</th><th>Titre</th><th>Problèmes</th>
    </tr>
  </thead>
  <tbody>{page_rows}</tbody>
</table>

<h2>📡 Endpoints API</h2>
<table>
  <thead><tr><th>Endpoint</th><th>Méthode</th><th>HTTP</th><th>Latence</th><th>Erreur</th></tr></thead>
  <tbody>{api_rows}</tbody>
</table>

<p class="meta" style="margin-top:20px;text-align:center">
  Généré par audit_prospup.py · {now_str}
</p>
</body>
</html>"""
    return html

# ─── Main ─────────────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="Audit ProspUp")
    parser.add_argument("--url",  default=DEFAULT_BASE_URL,  help="URL de base (défaut: http://localhost:8000)")
    parser.add_argument("--user", default=DEFAULT_USER,      help="Username (défaut: admin)")
    parser.add_argument("--pass", dest="password", default=DEFAULT_PASS, help="Password (défaut: admin)")
    parser.add_argument("--headed", action="store_true",     help="Mode visible (non-headless)")
    args = parser.parse_args()

    base_url = args.url.rstrip("/")
    report = AuditReport(base_url=base_url, started_at=datetime.datetime.now())

    print("=" * 60)
    print(f"🔍  AUDIT PROSPUP")
    print(f"    URL    : {base_url}")
    print(f"    User   : {args.user}")
    print(f"    Démarré: {report.started_at.strftime('%d/%m/%Y %H:%M:%S')}")
    print("=" * 60)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not args.headed)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            ignore_https_errors=True,
        )
        page = await context.new_page()

        # ── Étape 1 : Login
        print(f"\n{'─'*50}")
        print("🔐  Authentification…")
        report.login_ok = await do_login(page, base_url, args.user, args.password)

        if not report.login_ok:
            print("  ⚠  Impossible de se connecter — les pages protégées seront en erreur 302/401.")

        # ── Étape 2 : Audit des pages HTML
        print(f"\n{'─'*50}")
        print(f"📄  Audit des pages HTML ({len(HTML_PAGES)} pages)…")

        for route, page_id in HTML_PAGES:
            print(f"  → {route} …", end=" ", flush=True)
            result = await audit_page(page, base_url, route, page_id)
            report.page_results.append(result)

            # Résumé en ligne
            status_sym = "✓" if result.http_status == 200 else f"✗ {result.http_status}"
            sidebar_sym = "S✓" if result.sidebar_ok else "S✗"
            issues = len(result.js_errors) + len(result.http_errors) + len(result.warnings)
            print(f"[{status_sym}] [{sidebar_sym}] {result.load_ms:.0f}ms  {issues} problème(s)")

            # Re-login si session expirée (page redirigée vers /login)
            if "/login" in page.url and route != "/login":
                print("  ⚠  Session expirée, re-login…")
                await do_login(page, base_url, args.user, args.password)

        # ── Étape 3 : Audit API
        report.api_results = await audit_api_endpoints(context, base_url)

        await browser.close()

    # ── Étape 4 : Rapport HTML
    print(f"\n{'─'*50}")
    print("📊  Génération du rapport…")
    html = generate_html_report(report)
    report_path = os.path.join(os.path.dirname(__file__), REPORT_FILE)
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(html)

    duration = (report.ended_at - report.started_at).total_seconds()
    print(f"\n{'='*60}")
    print(f"✅  AUDIT TERMINÉ en {duration:.1f}s")
    print(f"   Pages testées  : {len(report.page_results)}")
    print(f"   Erreurs        : {report.total_errors}")
    print(f"   Avertissements : {report.total_warnings}")
    print(f"   API OK/Total   : {sum(1 for r in report.api_results if r.ok)}/{len(report.api_results)}")
    print(f"   Rapport        : {report_path}")
    print("=" * 60)

    return 0 if report.total_errors == 0 else 1

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
