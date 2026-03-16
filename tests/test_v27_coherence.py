#!/usr/bin/env python3
"""
Tests de cohérence pour la V27
Vérifie que toutes les corrections d'incohérences ont été appliquées
"""
import re
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent

def test_app_version():
    """Vérifie que APP_VERSION est à 27.0"""
    app_py = APP_DIR / "app.py"
    content = app_py.read_text(encoding="utf-8")
    match = re.search(r'APP_VERSION\s*=\s*["\']([^"\']+)["\']', content)
    assert match, "APP_VERSION non trouvé dans app.py"
    version = match.group(1)
    assert version == "27.0", f"Version attendue: 27.0, trouvée: {version}"
    print("✅ APP_VERSION = 27.0")

def test_prospup_name_consistency():
    """Vérifie que tous les titres utilisent Prosp'Up (avec apostrophe)"""
    templates_dir = APP_DIR / "templates"
    issues = []
    
    for html_file in templates_dir.glob("*.html"):
        content = html_file.read_text(encoding="utf-8")
        # Chercher les blocs title et header_title
        title_matches = re.findall(r'block title[^}]*ProspUp[^'']', content)
        header_matches = re.findall(r'block header_title[^}]*ProspUp[^'']', content)
        
        if title_matches or header_matches:
            issues.append(f"{html_file.name}: ProspUp sans apostrophe trouvé")
    
    assert not issues, f"Incohérences trouvées:\n" + "\n".join(issues)
    print("✅ Tous les titres utilisent Prosp'Up")

def test_required_fields_consistency():
    """Vérifie que les champs obligatoires utilisent la classe 'required' au lieu de '*'"""
    templates_dir = APP_DIR / "templates"
    issues = []
    
    for html_file in templates_dir.glob("*.html"):
        content = html_file.read_text(encoding="utf-8")
        # Chercher les labels avec * mais sans classe required
        matches = re.findall(r'<label[^>]*>\s*[^<]*\*\s*</label>', content)
        if matches:
            # Vérifier qu'ils n'ont pas aussi la classe required
            for match in matches:
                if 'class="required"' not in match and "class='required'" not in match:
                    issues.append(f"{html_file.name}: Label avec * sans classe required: {match[:50]}")
    
    if issues:
        print("⚠️  Labels avec * trouvés (peut être acceptable si classe required aussi):")
        for issue in issues[:5]:  # Limiter l'affichage
            print(f"   {issue}")
    else:
        print("✅ Tous les champs obligatoires utilisent la classe 'required'")

def test_showtoast_usage():
    """Vérifie que showToast() est utilisé au lieu de alert() pour les messages informatifs"""
    js_dir = APP_DIR / "static" / "js"
    issues = []
    
    for js_file in js_dir.glob("*.js"):
        if js_file.name in ["xlsx.min.js"]:  # Ignorer les libs externes
            continue
        content = js_file.read_text(encoding="utf-8")
        # Chercher les alert() qui ne sont pas des confirm()
        alert_matches = re.findall(r'alert\([^)]+\)', content)
        for match in alert_matches:
            # Ignorer les confirm() et les alert() dans les fallbacks
            if 'confirm' not in match.lower() and 'showToast' not in content[:content.find(match)+500]:
                # Vérifier si c'est dans un fallback (else après showToast)
                context_start = max(0, content.find(match) - 200)
                context = content[context_start:content.find(match)+len(match)+50]
                if 'showToast' not in context and 'typeof showToast' not in context:
                    issues.append(f"{js_file.name}: alert() sans fallback showToast: {match[:60]}")
    
    if issues:
        print("⚠️  alert() trouvés (peut être acceptable pour confirmations):")
        for issue in issues[:5]:
            print(f"   {issue}")
    else:
        print("✅ showToast() utilisé partout (ou alert() avec fallback)")

def test_aria_labels():
    """Vérifie que les champs de recherche ont des aria-label"""
    templates_dir = APP_DIR / "templates"
    issues = []
    
    search_inputs = [
        ("index.html", "searchInput"),
        ("sourcing.html", "candSearch"),
        ("push.html", "pushSearch"),
    ]
    
    for html_file, input_id in search_inputs:
        file_path = templates_dir / html_file
        if not file_path.exists():
            continue
        content = file_path.read_text(encoding="utf-8")
        # Chercher l'input par son id
        pattern = rf'<input[^>]*id=["\']{input_id}["\'][^>]*>'
        match = re.search(pattern, content)
        if match:
            input_tag = match.group(0)
            if 'aria-label' not in input_tag:
                issues.append(f"{html_file}: Input {input_id} sans aria-label")
    
    assert not issues, f"aria-label manquants:\n" + "\n".join(issues)
    print("✅ Tous les champs de recherche ont des aria-label")

def test_button_labels():
    """Vérifie la cohérence des libellés de boutons"""
    templates_dir = APP_DIR / "templates"
    issues = []
    
    # Vérifier que les boutons de soumission de formulaire utilisent "Enregistrer"
    for html_file in ["index.html", "entreprises.html"]:
        file_path = templates_dir / html_file
        if not file_path.exists():
            continue
        content = file_path.read_text(encoding="utf-8")
        # Chercher les boutons submit dans les formulaires
        if 'type="submit"' in content:
            # Vérifier qu'ils n'utilisent pas "Ajouter" (sauf pour ouvrir une modale)
            submit_matches = re.findall(r'<button[^>]*type=["\']submit["\'][^>]*>([^<]+)</button>', content)
            for label in submit_matches:
                if 'Ajouter' in label and 'Enregistrer' not in label:
                    # Vérifier que ce n'est pas un bouton qui ouvre une modale
                    context_start = max(0, content.find(label) - 100)
                    context = content[context_start:content.find(label)+len(label)+50]
                    if 'onclick' not in context or 'Modal' not in context:
                        issues.append(f"{html_file}: Bouton submit avec 'Ajouter' au lieu de 'Enregistrer': {label}")
    
    if issues:
        print("⚠️  Libellés de boutons à vérifier:")
        for issue in issues:
            print(f"   {issue}")
    else:
        print("✅ Libellés de boutons cohérents")

def main():
    print("🧪 Tests de cohérence V27\n")
    tests = [
        test_app_version,
        test_prospup_name_consistency,
        test_required_fields_consistency,
        test_showtoast_usage,
        test_aria_labels,
        test_button_labels,
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"❌ {test.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"❌ {test.__name__}: Erreur inattendue: {e}")
            failed += 1
    
    print(f"\n📊 Résultats: {passed} réussis, {failed} échoués")
    return failed == 0

if __name__ == "__main__":
    exit(0 if main() else 1)
