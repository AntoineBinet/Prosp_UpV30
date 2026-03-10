#!/usr/bin/env python3
"""
Test du flux de mise à jour (deploy) : login admin, déclenchement du pull, lecture du stream,
vérification que l'app répond après redémarrage.

À lancer manuellement ou en CI avec des identifiants admin :
  PROSPUP_DEPLOY_TEST_URL=https://prospup.work PROSPUP_DEPLOY_TEST_USER=admin PROSPUP_DEPLOY_TEST_PASS=... python -m tests.test_deploy_flow

Sans PROSPUP_DEPLOY_TEST_USER/PASS, le test est ignoré (skip).
"""
from __future__ import annotations

import os
import sys
import time
import json
import urllib.request
import urllib.error
import http.cookiejar

def main() -> int:
    base_url = (os.environ.get("PROSPUP_DEPLOY_TEST_URL") or "https://prospup.work").rstrip("/")
    user = os.environ.get("PROSPUP_DEPLOY_TEST_USER", "").strip()
    password = os.environ.get("PROSPUP_DEPLOY_TEST_PASS", "").strip()

    if not user or not password:
        print("SKIP: PROSPUP_DEPLOY_TEST_USER et PROSPUP_DEPLOY_TEST_PASS requis pour ce test.")
        return 0

    cookie_jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))

    # Login
    try:
        login_data = json.dumps({"username": user, "password": password}).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url}/api/auth/login",
            data=login_data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = opener.open(req, timeout=10)
        if resp.getcode() != 200:
            print("FAIL: login returned", resp.getcode())
            return 1
        data = json.loads(resp.read().decode("utf-8"))
        if not data.get("ok"):
            print("FAIL: login not ok", data)
            return 1
    except Exception as e:
        print("FAIL: login error", e)
        return 1

    # POST deploy/pull (stream)
    try:
        req = urllib.request.Request(
            f"{base_url}/api/deploy/pull",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = opener.open(req, timeout=60)
        if resp.getcode() != 200:
            print("FAIL: deploy/pull returned", resp.getcode())
            return 1
        # Read SSE stream
        chunk_size = 4096
        buffer = ""
        final_event = None
        while True:
            chunk = resp.read(chunk_size).decode("utf-8", errors="replace")
            if not chunk:
                break
            buffer += chunk
            while "\n\n" in buffer:
                part, buffer = buffer.split("\n\n", 1)
                for line in part.splitlines():
                    if line.startswith("data: "):
                        try:
                            ev = json.loads(line[6:])
                            if ev.get("step") == "error":
                                print("FAIL: stream error", ev.get("error"))
                                return 1
                            if ev.get("step") == "done":
                                final_event = ev
                                break
                        except json.JSONDecodeError:
                            pass
                if final_event:
                    break
            if final_event:
                break
        if not final_event:
            print("FAIL: no 'done' event received")
            return 1
    except urllib.error.HTTPError as e:
        print("FAIL: deploy/pull HTTP", e.code, e.read().decode("utf-8", errors="replace")[:200])
        return 1
    except Exception as e:
        print("FAIL: deploy/pull error", e)
        return 1

    if final_event.get("restarting"):
        time.sleep(18)
    else:
        time.sleep(2)

    # Vérifier que l'app répond
    try:
        req = urllib.request.Request(base_url + "/", method="GET")
        r = opener.open(req, timeout=15)
        if r.getcode() != 200:
            print("FAIL: GET / returned", r.getcode())
            return 1
    except Exception as e:
        print("FAIL: GET / error", e)
        return 1

    try:
        req = urllib.request.Request(base_url + "/api/app-version", method="GET")
        r = opener.open(req, timeout=10)
        if r.getcode() != 200:
            print("FAIL: GET /api/app-version returned", r.getcode())
            return 1
        data = json.loads(r.read().decode("utf-8"))
        if not data.get("ok"):
            print("FAIL: app-version not ok", data)
            return 1
    except Exception as e:
        print("FAIL: GET /api/app-version error", e)
        return 1

    print("OK: deploy flow and app response verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
