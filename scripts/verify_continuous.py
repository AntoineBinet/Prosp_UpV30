#!/usr/bin/env python3
"""
Vérification continue : exécute verify_all.py toutes les X minutes.
Utile pour surveiller que tout fonctionne en continu.

Variables d'environnement :
  VERIFY_INTERVAL : Intervalle en secondes (défaut: 300 = 5 min)
  VERIFY_ONCE : Si défini, exécute une seule fois puis sort

Usage :
  python scripts/verify_continuous.py        # Boucle toutes les 5 min
  python scripts/verify_continuous.py --once # Une seule vérification
"""
from __future__ import annotations

import os
import sys
import time
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = PROJECT_ROOT / "scripts" / "verify_all.py"


def main() -> int:
    once = "--once" in sys.argv or os.environ.get("VERIFY_ONCE") == "1"
    interval = max(60, int(os.environ.get("VERIFY_INTERVAL", "300")))
    
    while True:
        # Exécuter la vérification
        proc = subprocess.run(
            [sys.executable, str(SCRIPT)],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
        )
        
        if proc.returncode != 0:
            # Erreur détectée
            sys.exit(proc.returncode)
        
        if once:
            break
        
        time.sleep(interval)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
