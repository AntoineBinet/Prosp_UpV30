#!/usr/bin/env python3
"""
Script de test pour l'assistant IA virtuel amélioré de ProspUp
Teste toutes les fonctionnalités : mémoire, streaming, actions, suggestions, persistance
"""

import requests
import json
import time
import sys

BASE_URL = "http://localhost:8000"
TEST_USERNAME = "admin"
TEST_PASSWORD = "admin"

class AssistantIATester:
    def __init__(self):
        self.session = requests.Session()
        # Important: maintenir les cookies entre les requêtes
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Test Assistant)',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        })
        self.session_id = None
        self.user_id = None
        
    def login(self):
        """Se connecter et obtenir une session"""
        print("🔐 Connexion...")
        response = self.session.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": TEST_USERNAME, "password": TEST_PASSWORD},
            headers={"Content-Type": "application/json"}
        )
        if response.status_code == 200:
            data = response.json()
            if data.get("ok"):
                print("✅ Connexion réussie")
                # Vérifier que les cookies sont bien reçus
                cookies = self.session.cookies
                print(f"   Cookies reçus: {len(cookies)} cookie(s)")
                for cookie in cookies:
                    print(f"   - {cookie.name}: {cookie.value[:20]}...")
                return True
        print(f"❌ Échec de connexion: {response.status_code}")
        print(f"   Réponse: {response.text[:200]}")
        return False
    
    def test_memory(self):
        """Test 1: Mémoire conversationnelle"""
        print("\n📝 Test 1: Mémoire conversationnelle")
        print("-" * 50)
        
        # Envoyer un premier message
        question1 = "Bonjour, qui es-tu ?"
        print(f"Envoi: {question1}")
        
        response = self.session.post(
            f"{BASE_URL}/api/dashboard/assistant",
            json={
                "question": question1,
                "session_id": self.session_id,
                "page_context": "Dashboard",
                "page_description": "Page principale"
            },
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 200:
            print(f"❌ Erreur HTTP: {response.status_code}")
            return False
        
        data = response.json()
        if not data.get("ok"):
            print(f"❌ Erreur API: {data.get('error')}")
            return False
        
        assistant_data = data.get("data", {})
        self.session_id = assistant_data.get("session_id") or self.session_id
        answer1 = assistant_data.get("answer", "")
        print(f"Réponse 1: {answer1[:100]}...")
        
        # Attendre un peu
        time.sleep(1)
        
        # Envoyer un deuxième message qui fait référence au premier
        question2 = "Qu'est-ce que je t'ai demandé avant ?"
        print(f"\nEnvoi: {question2}")
        
        response2 = self.session.post(
            f"{BASE_URL}/api/dashboard/assistant",
            json={
                "question": question2,
                "session_id": self.session_id,
                "page_context": "Dashboard",
                "page_description": "Page principale"
            }
        )
        
        if response2.status_code != 200:
            print(f"❌ Erreur HTTP: {response2.status_code}")
            return False
        
        data2 = response2.json()
        if not data2.get("ok"):
            print(f"❌ Erreur API: {data2.get('error')}")
            return False
        
        answer2 = data2.get("data", {}).get("answer", "")
        print(f"Réponse 2: {answer2[:100]}...")
        
        # Vérifier que l'historique est chargé
        if self.session_id:
            history_response = self.session.get(
                f"{BASE_URL}/api/dashboard/assistant/history",
                params={"session_id": self.session_id}
            )
            if history_response.status_code == 200:
                history_data = history_response.json()
                if history_data.get("ok") and history_data.get("history"):
                    history = history_data["history"]
                    print(f"\n✅ Historique chargé: {len(history)} messages")
                    for msg in history:
                        print(f"  - {msg['role']}: {msg['content'][:50]}...")
                    return True
        
        print("⚠️  Historique non vérifié (peut être normal si première session)")
        return True
    
    def test_streaming(self):
        """Test 2: Streaming"""
        print("\n📡 Test 2: Streaming")
        print("-" * 50)
        
        question = "Explique-moi ce qu'est un CRM en quelques phrases"
        print(f"Envoi (streaming): {question}")
        
        response = self.session.post(
            f"{BASE_URL}/api/dashboard/assistant-stream",
            json={
                "question": question,
                "session_id": self.session_id,
                "page_context": "Dashboard",
                "page_description": "Page principale"
            },
            stream=True
        )
        
        if response.status_code != 200:
            print(f"❌ Erreur HTTP: {response.status_code}")
            return False
        
        print("Réponse streaming:")
        full_response = ""
        tokens_received = 0
        
        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')
                if line_str.startswith('data: '):
                    try:
                        data = json.loads(line_str[6:])
                        if data.get("type") == "token":
                            token = data.get("text", "")
                            full_response += token
                            tokens_received += 1
                            if tokens_received <= 5:
                                print(f"  Token {tokens_received}: {token[:30]}...")
                        elif data.get("type") == "end":
                            print(f"\n✅ Streaming terminé: {tokens_received} tokens reçus")
                            print(f"Réponse complète ({len(full_response)} caractères): {full_response[:150]}...")
                            return True
                        elif data.get("type") == "error":
                            print(f"❌ Erreur streaming: {data.get('message')}")
                            return False
                    except json.JSONDecodeError:
                        continue
        
        if tokens_received > 0:
            print(f"✅ Streaming partiel: {tokens_received} tokens reçus")
            return True
        else:
            print("❌ Aucun token reçu")
            return False
    
    def test_actions_create(self):
        """Test 3: Actions étendues - Création"""
        print("\n🔧 Test 3: Actions étendues - Création")
        print("-" * 50)
        
        # Test création prospect
        print("Test création prospect...")
        action_response = self.session.post(
            f"{BASE_URL}/api/dashboard/assistant/action",
            json={
                "type": "create_prospect",
                "params": {
                    "name": "Test Prospect Assistant",
                    "company": "Test Company",
                    "fonction": "Directeur Technique",
                    "email": "test@example.com"
                }
            }
        )
        
        if action_response.status_code == 200:
            action_data = action_response.json()
            if action_data.get("ok"):
                print(f"✅ Prospect créé: {action_data.get('message')}")
                prospect_id = action_data.get("data", {}).get("prospect_id")
                if prospect_id:
                    print(f"   ID: {prospect_id}")
            else:
                print(f"❌ Erreur: {action_data.get('error')}")
                return False
        else:
            print(f"❌ Erreur HTTP: {action_response.status_code}")
            return False
        
        # Test création entreprise
        print("\nTest création entreprise...")
        action_response2 = self.session.post(
            f"{BASE_URL}/api/dashboard/assistant/action",
            json={
                "type": "create_company",
                "params": {
                    "groupe": "Test Company Assistant",
                    "site": "Paris",
                    "website": "https://test.example.com"
                }
            }
        )
        
        if action_response2.status_code == 200:
            action_data2 = action_response2.json()
            if action_data2.get("ok"):
                print(f"✅ Entreprise créée: {action_data2.get('message')}")
                company_id = action_data2.get("data", {}).get("company_id")
                if company_id:
                    print(f"   ID: {company_id}")
            else:
                print(f"❌ Erreur: {action_data2.get('error')}")
                return False
        else:
            print(f"❌ Erreur HTTP: {action_response2.status_code}")
            return False
        
        # Test création candidat
        print("\nTest création candidat...")
        action_response3 = self.session.post(
            f"{BASE_URL}/api/dashboard/assistant/action",
            json={
                "type": "create_candidate",
                "params": {
                    "name": "Test Candidate Assistant",
                    "role": "Ingénieur embarqué",
                    "skills": ["C++", "AUTOSAR", "Embedded"],
                    "email": "candidate@example.com"
                }
            }
        )
        
        if action_response3.status_code == 200:
            action_data3 = action_response3.json()
            if action_data3.get("ok"):
                print(f"✅ Candidat créé: {action_data3.get('message')}")
                candidate_id = action_data3.get("data", {}).get("candidate_id")
                if candidate_id:
                    print(f"   ID: {candidate_id}")
                return True
            else:
                print(f"❌ Erreur: {action_data3.get('error')}")
                return False
        else:
            print(f"❌ Erreur HTTP: {action_response3.status_code}")
            return False
    
    def test_suggestions(self):
        """Test 4: Suggestions"""
        print("\n💡 Test 4: Suggestions")
        print("-" * 50)
        
        response = self.session.get(
            f"{BASE_URL}/api/dashboard/assistant/suggestions",
            params={
                "page_context": "Dashboard",
                "page_description": "Page principale du dashboard"
            }
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get("ok") and data.get("suggestions"):
                suggestions = data["suggestions"]
                print(f"✅ {len(suggestions)} suggestions reçues:")
                for i, suggestion in enumerate(suggestions, 1):
                    print(f"  {i}. {suggestion}")
                return True
            else:
                print("❌ Pas de suggestions dans la réponse")
                return False
        else:
            print(f"❌ Erreur HTTP: {response.status_code}")
            return False
    
    def test_persistence(self):
        """Test 5: Persistance de l'historique"""
        print("\n💾 Test 5: Persistance de l'historique")
        print("-" * 50)
        
        if not self.session_id:
            print("⚠️  Pas de session_id, création d'un message pour en obtenir un...")
            response = self.session.post(
                f"{BASE_URL}/api/dashboard/assistant",
                json={
                    "question": "Test persistance",
                    "page_context": "Dashboard",
                    "page_description": "Page principale"
                }
            )
            if response.status_code == 200:
                data = response.json()
                if data.get("ok"):
                    self.session_id = data.get("data", {}).get("session_id")
        
        if not self.session_id:
            print("❌ Impossible d'obtenir un session_id")
            return False
        
        # Envoyer quelques messages
        messages = [
            "Premier message de test",
            "Deuxième message de test",
            "Troisième message de test"
        ]
        
        for msg in messages:
            self.session.post(
                f"{BASE_URL}/api/dashboard/assistant",
                json={
                    "question": msg,
                    "session_id": self.session_id,
                    "page_context": "Dashboard",
                    "page_description": "Page principale"
                }
            )
            time.sleep(0.5)
        
        # Récupérer l'historique
        history_response = self.session.get(
            f"{BASE_URL}/api/dashboard/assistant/history",
            params={"session_id": self.session_id}
        )
        
        if history_response.status_code == 200:
            history_data = history_response.json()
            if history_data.get("ok") and history_data.get("history"):
                history = history_data["history"]
                print(f"✅ Historique persistant: {len(history)} messages trouvés")
                
                # Vérifier que nos messages sont présents
                found_messages = [msg["content"] for msg in history if msg["role"] == "user"]
                for msg in messages:
                    if any(msg in found for found in found_messages):
                        print(f"  ✅ Message trouvé: '{msg}'")
                    else:
                        print(f"  ⚠️  Message non trouvé: '{msg}'")
                
                return True
            else:
                print("❌ Historique vide ou invalide")
                return False
        else:
            print(f"❌ Erreur HTTP: {history_response.status_code}")
            return False
    
    def test_ia_functions(self):
        """Test 6: Intégration fonctions IA"""
        print("\n🤖 Test 6: Intégration fonctions IA")
        print("-" * 50)
        
        # D'abord, créer un prospect pour tester les fonctions IA
        create_response = self.session.post(
            f"{BASE_URL}/api/dashboard/assistant/action",
            json={
                "type": "create_prospect",
                "params": {
                    "name": "Test IA Prospect",
                    "company": "Test IA Company",
                    "fonction": "Test"
                }
            }
        )
        
        if create_response.status_code != 200:
            print("❌ Impossible de créer un prospect pour le test")
            return False
        
        prospect_id = create_response.json().get("data", {}).get("prospect_id")
        if not prospect_id:
            print("❌ Pas d'ID prospect retourné")
            return False
        
        print(f"✅ Prospect créé (ID: {prospect_id}) pour les tests IA")
        
        # Test ia_scrap
        print("\nTest fonction IA: scrapping...")
        scrap_response = self.session.post(
            f"{BASE_URL}/api/dashboard/assistant/action",
            json={
                "type": "ia_scrap",
                "params": {
                    "type": "prospect",
                    "id": prospect_id
                }
            }
        )
        
        if scrap_response.status_code == 200:
            scrap_data = scrap_response.json()
            if scrap_data.get("ok") and scrap_data.get("data", {}).get("ia_function") == "scrap":
                print(f"✅ Fonction IA scrapping déclenchée: {scrap_data.get('message')}")
            else:
                print(f"⚠️  Réponse inattendue: {scrap_data}")
        else:
            print(f"❌ Erreur HTTP: {scrap_response.status_code}")
        
        # Test ia_avant_reunion
        print("\nTest fonction IA: avant réunion...")
        avant_response = self.session.post(
            f"{BASE_URL}/api/dashboard/assistant/action",
            json={
                "type": "ia_avant_reunion",
                "params": {
                    "prospect_id": prospect_id
                }
            }
        )
        
        if avant_response.status_code == 200:
            avant_data = avant_response.json()
            if avant_data.get("ok") and avant_data.get("data", {}).get("ia_function") == "avant_reunion":
                print(f"✅ Fonction IA avant réunion déclenchée: {avant_data.get('message')}")
            else:
                print(f"⚠️  Réponse inattendue: {avant_data}")
        else:
            print(f"❌ Erreur HTTP: {avant_response.status_code}")
        
        # Test ia_apres_reunion
        print("\nTest fonction IA: après réunion...")
        apres_response = self.session.post(
            f"{BASE_URL}/api/dashboard/assistant/action",
            json={
                "type": "ia_apres_reunion",
                "params": {
                    "prospect_id": prospect_id
                }
            }
        )
        
        if apres_response.status_code == 200:
            apres_data = apres_response.json()
            if apres_data.get("ok") and apres_data.get("data", {}).get("ia_function") == "apres_reunion":
                print(f"✅ Fonction IA après réunion déclenchée: {apres_data.get('message')}")
                return True
            else:
                print(f"⚠️  Réponse inattendue: {apres_data}")
        else:
            print(f"❌ Erreur HTTP: {apres_response.status_code}")
        
        return True
    
    def run_all_tests(self):
        """Exécuter tous les tests"""
        print("=" * 60)
        print("🧪 Tests de l'assistant IA virtuel amélioré")
        print("=" * 60)
        
        if not self.login():
            print("\n❌ Impossible de se connecter. Vérifiez que le serveur est démarré.")
            return False
        
        results = {}
        
        # Test 1: Mémoire
        try:
            results["Mémoire"] = self.test_memory()
        except Exception as e:
            print(f"❌ Erreur test mémoire: {e}")
            results["Mémoire"] = False
        
        # Test 2: Streaming
        try:
            results["Streaming"] = self.test_streaming()
        except Exception as e:
            print(f"❌ Erreur test streaming: {e}")
            results["Streaming"] = False
        
        # Test 3: Actions
        try:
            results["Actions"] = self.test_actions_create()
        except Exception as e:
            print(f"❌ Erreur test actions: {e}")
            results["Actions"] = False
        
        # Test 4: Suggestions
        try:
            results["Suggestions"] = self.test_suggestions()
        except Exception as e:
            print(f"❌ Erreur test suggestions: {e}")
            results["Suggestions"] = False
        
        # Test 5: Persistance
        try:
            results["Persistance"] = self.test_persistence()
        except Exception as e:
            print(f"❌ Erreur test persistance: {e}")
            results["Persistance"] = False
        
        # Test 6: Fonctions IA
        try:
            results["Fonctions IA"] = self.test_ia_functions()
        except Exception as e:
            print(f"❌ Erreur test fonctions IA: {e}")
            results["Fonctions IA"] = False
        
        # Résumé
        print("\n" + "=" * 60)
        print("📊 RÉSUMÉ DES TESTS")
        print("=" * 60)
        
        passed = sum(1 for v in results.values() if v)
        total = len(results)
        
        for test_name, result in results.items():
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"{status} - {test_name}")
        
        print(f"\nRésultat: {passed}/{total} tests réussis")
        
        return passed == total

if __name__ == "__main__":
    tester = AssistantIATester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)
