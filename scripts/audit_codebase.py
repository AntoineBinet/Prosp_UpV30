#!/usr/bin/env python3
"""
Script d'audit complet du codebase — détecte les erreurs potentielles introduites récemment.
Vérifie la cohérence du code, les imports, les routes API, les processus de déploiement, etc.
"""
from __future__ import annotations

import os
import sys
import re
import ast
import json
import subprocess
from pathlib import Path
from typing import Dict, List, Tuple, Any
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ISSUES: List[Dict[str, Any]] = []


def log_issue(severity: str, category: str, file: str, line: int | None, message: str, code: str | None = None):
    """Enregistre un problème détecté."""
    ISSUES.append({
        "severity": severity,  # error, warning, info
        "category": category,
        "file": file,
        "line": line,
        "message": message,
        "code": code,
    })


def check_python_syntax(file_path: Path) -> bool:
    """Vérifie la syntaxe Python d'un fichier."""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            ast.parse(f.read(), filename=str(file_path))
        return True
    except SyntaxError as e:
        log_issue("error", "syntax", str(file_path.relative_to(PROJECT_ROOT)), e.lineno, f"Erreur de syntaxe: {e.msg}", str(e.text))
        return False
    except Exception as e:
        log_issue("error", "syntax", str(file_path.relative_to(PROJECT_ROOT)), None, f"Erreur lors de la vérification: {e}")
        return False


def check_imports(file_path: Path):
    """Vérifie que les imports sont valides."""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            tree = ast.parse(content, filename=str(file_path))
        
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    try:
                        __import__(alias.name.split(".")[0])
                    except ImportError:
                        # Ne pas échouer sur les imports optionnels ou spécifiques au projet
                        pass
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    try:
                        __import__(node.module.split(".")[0])
                    except ImportError:
                        pass
    except Exception:
        pass  # Ignorer les erreurs d'import pour l'audit


def check_app_routes():
    """Vérifie la cohérence des routes API dans app.py."""
    app_file = PROJECT_ROOT / "app.py"
    if not app_file.exists():
        log_issue("error", "routes", "app.py", None, "Fichier app.py introuvable")
        return
    
    with open(app_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")
    
    # Vérifier que toutes les routes @app.route ont une fonction correspondante
    route_pattern = re.compile(r'@app\.(route|get|post|put|delete|patch)\s*\(["\']([^"\']+)["\']')
    function_pattern = re.compile(r'^def\s+(\w+)\s*\(')
    
    routes = {}
    functions = {}
    
    for i, line in enumerate(lines, 1):
        route_match = route_pattern.search(line)
        if route_match:
            route_path = route_match.group(2)
            # Chercher la fonction suivante
            for j in range(i, min(i + 10, len(lines))):
                func_match = function_pattern.search(lines[j])
                if func_match:
                    func_name = func_match.group(1)
                    routes[route_path] = (i, func_name)
                    functions[func_name] = (j + 1, route_path)
                    break
    
    # Vérifier les routes critiques
    critical_routes = [
        "/api/system/verify",
        "/api/deploy/pull",
        "/api/deploy/pull-from-404",
        "/api/deploy/rollback",
        "/api/ollama/generate",
    ]
    
    for route in critical_routes:
        if route not in routes:
            log_issue("warning", "routes", "app.py", None, f"Route critique non trouvée: {route}")


def check_deploy_processes():
    """Vérifie la cohérence des processus de déploiement."""
    app_file = PROJECT_ROOT / "app.py"
    if not app_file.exists():
        return
    
    with open(app_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")
    
    # Vérifier que les routes de déploiement font bien un checkout main
    deploy_routes = [
        "/api/deploy/pull",
        "/api/deploy/pull-from-404",
    ]
    
    for route in deploy_routes:
        # Chercher la fonction correspondante et son contenu
        pattern = rf'@app\.(route|post|get)\s*\(["\']{re.escape(route)}["\']'
        match = re.search(pattern, content)
        if match:
            # Extraire le contenu de la fonction (approximatif)
            start_pos = match.start()
            # Chercher la définition de fonction suivante
            func_start = content.find("def ", start_pos)
            if func_start != -1:
                # Chercher la fin de la fonction (prochaine fonction ou fin de fichier)
                next_func = content.find("\ndef ", func_start + 1)
                func_content = content[func_start:next_func] if next_func != -1 else content[func_start:]
                
                # Vérifier qu'il y a un checkout main dans cette fonction
                if "checkout main" not in func_content and "checkout -B main" not in func_content:
                    log_issue("warning", "deploy", "app.py", None, f"Route {route} pourrait ne pas faire checkout main automatiquement")
                else:
                    # Vérifier aussi le fallback
                    if "git reset --hard origin/main" not in func_content:
                        log_issue("info", "deploy", "app.py", None, f"Route {route} n'utilise pas git reset --hard en fallback (peut être normal)")
    
    # Vérifier globalement que git reset --hard est présent quelque part
    if "git reset --hard origin/main" not in content:
        log_issue("info", "deploy", "app.py", None, "Fallback git reset --hard origin/main non trouvé globalement (peut être normal)")


def check_verify_script():
    """Vérifie que le script verify_all.py est cohérent."""
    verify_file = PROJECT_ROOT / "scripts" / "verify_all.py"
    if not verify_file.exists():
        log_issue("error", "scripts", "scripts/verify_all.py", None, "Script verify_all.py introuvable")
        return
    
    with open(verify_file, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Vérifier que les exit codes sont bien définis
    exit_codes = ["EXIT_GIT", "EXIT_OLLAMA", "EXIT_FLASK", "EXIT_API_OLLAMA", "EXIT_SCRIPTS", "EXIT_ENV"]
    for code in exit_codes:
        if code not in content:
            log_issue("warning", "scripts", "scripts/verify_all.py", None, f"Exit code {code} non trouvé")


def check_git_state():
    """Vérifie l'état Git du projet."""
    try:
        # Branche actuelle
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=5,
        )
        branch = result.stdout.strip() if result.returncode == 0 else "unknown"
        
        # Statut
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=5,
        )
        status = result.stdout.strip() if result.returncode == 0 else ""
        
        if status:
            log_issue("warning", "git", ".", None, f"Worktree non propre: {status[:100]}")
        
        # Vérifier si on peut fetch
        result = subprocess.run(
            ["git", "fetch", "--dry-run", "origin", "main"],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            log_issue("warning", "git", ".", None, f"Impossible de faire fetch: {result.stderr[:100]}")
        
        return branch, status
    except Exception as e:
        log_issue("warning", "git", ".", None, f"Erreur lors de la vérification Git: {e}")
        return "unknown", ""


def check_file_structure():
    """Vérifie la structure des fichiers critiques."""
    critical_files = [
        "app.py",
        "scripts/verify_all.py",
        "scripts/supervise_prospup.py",
        "static/js/app.js",
        "static/js/page-settings.js",
    ]
    
    for file_path in critical_files:
        full_path = PROJECT_ROOT / file_path
        if not full_path.exists():
            log_issue("error", "structure", file_path, None, "Fichier critique manquant")
        elif full_path.suffix == ".py":
            if not check_python_syntax(full_path):
                pass  # Erreur déjà loggée


def check_api_consistency():
    """Vérifie la cohérence entre les routes API et les appels frontend."""
    app_file = PROJECT_ROOT / "app.py"
    if not app_file.exists():
        return
    
    # Routes API définies dans app.py
    with open(app_file, "r", encoding="utf-8") as f:
        app_content = f.read()
    
    api_routes = set(re.findall(r'@app\.(?:route|get|post|put|delete|patch)\s*\(["\']([^"\']+)["\']', app_content))
    
    # Chercher les appels fetch dans les fichiers JS
    js_files = list((PROJECT_ROOT / "static" / "js").glob("*.js"))
    for js_file in js_files:
        with open(js_file, "r", encoding="utf-8") as f:
            js_content = f.read()
        
        # Chercher les appels fetch('/api/...')
        fetch_calls = re.findall(r"fetch\s*\(\s*['\"]([^'\"]+)['\"]", js_content)
        for call in fetch_calls:
            if call.startswith("/api/"):
                # Vérifier si la route existe
                if call not in api_routes and not call.endswith("/"):
                    # Certaines routes peuvent avoir des paramètres, c'est normal
                    if "/" not in call.split("/api/")[1] or call.split("/api/")[1].count("/") == 1:
                        log_issue("info", "api", str(js_file.relative_to(PROJECT_ROOT)), None, f"Appel API potentiellement non défini: {call}")


def main():
    """Exécute tous les audits."""
    print("🔍 Audit du codebase en cours...")
    print("=" * 60)
    
    # Vérifications
    print("\n1. Structure des fichiers...")
    check_file_structure()
    
    print("2. Syntaxe Python...")
    for py_file in PROJECT_ROOT.rglob("*.py"):
        if "node_modules" in str(py_file) or ".git" in str(py_file):
            continue
        check_python_syntax(py_file)
    
    print("3. Routes API...")
    check_app_routes()
    
    print("4. Processus de déploiement...")
    check_deploy_processes()
    
    print("5. Scripts de vérification...")
    check_verify_script()
    
    print("6. État Git...")
    branch, status = check_git_state()
    print(f"   Branche: {branch}")
    if status:
        print(f"   Statut: {status[:50]}...")
    
    print("7. Cohérence API...")
    check_api_consistency()
    
    # Résumé
    print("\n" + "=" * 60)
    print("📊 RÉSUMÉ DE L'AUDIT")
    print("=" * 60)
    
    errors = [i for i in ISSUES if i["severity"] == "error"]
    warnings = [i for i in ISSUES if i["severity"] == "warning"]
    infos = [i for i in ISSUES if i["severity"] == "info"]
    
    print(f"\n❌ Erreurs: {len(errors)}")
    print(f"⚠️  Avertissements: {len(warnings)}")
    print(f"ℹ️  Informations: {len(infos)}")
    
    if errors:
        print("\n❌ ERREURS:")
        for issue in errors:
            print(f"  [{issue['category']}] {issue['file']}:{issue['line'] or '?'} - {issue['message']}")
    
    if warnings:
        print("\n⚠️  AVERTISSEMENTS:")
        for issue in warnings[:10]:  # Limiter à 10
            print(f"  [{issue['category']}] {issue['file']}:{issue['line'] or '?'} - {issue['message']}")
        if len(warnings) > 10:
            print(f"  ... et {len(warnings) - 10} autres")
    
    # Sauvegarder le rapport
    report_file = PROJECT_ROOT / "tests" / "audit_reports" / f"audit_codebase_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    report_file.parent.mkdir(parents=True, exist_ok=True)
    
    report = {
        "timestamp": datetime.now().isoformat(),
        "branch": branch,
        "status": status,
        "summary": {
            "errors": len(errors),
            "warnings": len(warnings),
            "infos": len(infos),
        },
        "issues": ISSUES,
    }
    
    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    
    print(f"\n📄 Rapport sauvegardé: {report_file.relative_to(PROJECT_ROOT)}")
    
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
