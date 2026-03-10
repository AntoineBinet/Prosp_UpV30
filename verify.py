#!/usr/bin/env python3
"""
Point d'entrée unique pour vérification complète.
À utiliser par l'agent local Cursor pour vérifier que tout fonctionne.

Usage:
  python verify.py           # Vérification unique
  python verify.py --loop    # Vérification continue (toutes les 5 min)
"""
from __future__ import annotations

import sys
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
VERIFY_SCRIPT = PROJECT_ROOT / "scripts" / "verify_all.py"

if __name__ == "__main__":
    if "--loop" in sys.argv:
        # Mode continu
        import time
        interval = 300  # 5 minutes
        while True:
            proc = subprocess.run([sys.executable, str(VERIFY_SCRIPT)])
            if proc.returncode != 0:
                sys.exit(proc.returncode)
            time.sleep(interval)
    else:
        # Mode unique
        proc = subprocess.run([sys.executable, str(VERIFY_SCRIPT)])
        sys.exit(proc.returncode)
