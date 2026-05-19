"""ProspUp — Blueprint Carte géographique (v32.26).

Pages :
  GET  /v30/carte                — Carte interactive Leaflet/OSM

API :
  GET    /api/map/markers        — Marqueurs (entreprises + prospects géocodés)
  GET    /api/map/stats          — Compteurs (geocodés / total)
  POST   /api/map/geocode        — Géocoder une entité (entity=company|prospect, id)
  GET    /api/map/geocode/bulk   — Géocoder en masse (SSE)

Le geocoding utilise Nominatim (OSM, gratuit). Politique d'usage :
  - max 1 req/s en fair use
  - User-Agent personnalisé requis
  - cache lat/long en base pour ne jamais rejouer une requête
"""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from flask import Blueprint, Response, jsonify, render_template, request, stream_with_context

from app import APP_VERSION, _conn, _get_current_user, _uid, logger
from utils.db import _sidebar_counts

map_bp = Blueprint("map", __name__)


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_NOMINATIM_LOCK = threading.Lock()
_NOMINATIM_LAST_CALL: dict = {"t": 0.0}
_NOMINATIM_MIN_INTERVAL = 1.05  # 1 req / sec + petite marge


# ─── Helpers ──────────────────────────────────────────────────────────


def _nominatim_user_agent() -> str:
    return f"ProspUp/{APP_VERSION} (+https://prospup.work)"


def _geocode(query: str, *, timeout: float = 15.0) -> tuple[float, float] | None:
    """Géocode une adresse via Nominatim. Throttle global 1 req/s.

    Retourne (lat, lon) ou None si pas de résultat / erreur réseau.
    """
    q = (query or "").strip()
    if not q:
        return None
    params = urllib.parse.urlencode({
        "q": q,
        "format": "json",
        "limit": 1,
        "addressdetails": 0,
    })
    url = f"{NOMINATIM_URL}?{params}"
    req = urllib.request.Request(url, headers={
        "User-Agent": _nominatim_user_agent(),
        "Accept-Language": "fr",
    })
    with _NOMINATIM_LOCK:
        elapsed = time.monotonic() - _NOMINATIM_LAST_CALL["t"]
        if elapsed < _NOMINATIM_MIN_INTERVAL:
            time.sleep(_NOMINATIM_MIN_INTERVAL - elapsed)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = resp.read().decode("utf-8")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            logger.warning("[map] nominatim error for %r: %s", q, e)
            _NOMINATIM_LAST_CALL["t"] = time.monotonic()
            return None
        except Exception as e:
            logger.warning("[map] nominatim unexpected error for %r: %s", q, e)
            _NOMINATIM_LAST_CALL["t"] = time.monotonic()
            return None
        _NOMINATIM_LAST_CALL["t"] = time.monotonic()
    try:
        data = json.loads(payload)
    except Exception:
        return None
    if not isinstance(data, list) or not data:
        return None
    first = data[0]
    try:
        return float(first["lat"]), float(first["lon"])
    except (KeyError, TypeError, ValueError):
        return None


def _clean_part(value) -> str:
    """Nettoie une portion d'adresse : retire sauts de ligne, espaces multiples."""
    if value is None:
        return ""
    s = str(value).strip()
    if not s:
        return ""
    # Sauts de ligne / tabs -> virgule + espace (cas champ multi-ligne)
    s = re.sub(r"[\r\n\t]+", ", ", s)
    # Espaces multiples -> un seul
    s = re.sub(r"\s+", " ", s)
    # Virgules consécutives ", , " -> ", "
    s = re.sub(r"(\s*,\s*){2,}", ", ", s)
    return s.strip(" ,")


def _build_query(*parts) -> str:
    """Concatène des fragments d'adresse non vides séparés par ', '."""
    cleaned = [_clean_part(p) for p in parts]
    return ", ".join(p for p in cleaned if p)


def _company_queries(row: dict) -> list[str]:
    """Liste ordonnée de requêtes Nominatim à tenter pour une entreprise,
    de la plus précise à la plus générique. La première qui répond gagne.

    Permet de géocoder même quand l'adresse contient un nom de bâtiment ou
    un campus (ex. « Tour EDF, La Défense ») que Nominatim n'indexe pas.
    """
    address = row.get("address")
    city = row.get("city")
    country = row.get("country")
    site = row.get("site")
    groupe = row.get("groupe")
    candidates: list[str] = []

    def _add(q: str) -> None:
        if q and q not in candidates:
            candidates.append(q)

    # 1) Variante historique : adresse + ville + pays
    _add(_build_query(address, city, country))
    # 2) Adresse seule (contient souvent déjà code postal + ville)
    _add(_build_query(address))
    # 3) Site + ville + pays (bâtiments/campus connus de Nominatim)
    _add(_build_query(site, city, country))
    # 4) Nom de la société + ville + pays (grands groupes type EDF, Total…)
    _add(_build_query(groupe, city, country))
    # 5) Ville + pays — dernier recours pour au moins poser le marqueur
    #    sur la bonne ville plutôt que de remonter une erreur.
    _add(_build_query(city, country))
    return candidates


def _company_query(row: dict) -> str:
    """Compat : retourne la requête principale (1re variante)."""
    qs = _company_queries(row)
    return qs[0] if qs else ""


def _prospect_queries(row: dict) -> list[str]:
    """Idem mais pour un prospect, avec fallback sur l'entreprise rattachée."""
    candidates: list[str] = []

    def _add(q: str) -> None:
        if q and q not in candidates:
            candidates.append(q)

    address = row.get("address")
    city = row.get("city")
    country = row.get("country")
    company_address = row.get("company_address")
    company_city = row.get("company_city")
    company_country = row.get("company_country")
    company_name = row.get("company_name")

    # Adresse propre du prospect
    _add(_build_query(address, city, country))
    _add(_build_query(address))
    # Repli sur la boîte
    _add(_build_query(company_address, company_city, company_country))
    _add(_build_query(company_address))
    _add(_build_query(company_name, company_city, company_country))
    # Repli ville/pays prospect puis société
    _add(_build_query(city, country))
    _add(_build_query(company_city, company_country))
    return candidates


def _prospect_query(row: dict) -> str:
    """Compat : retourne la requête principale (1re variante)."""
    qs = _prospect_queries(row)
    return qs[0] if qs else ""


def _geocode_with_fallbacks(
    queries: list[str], *, timeout: float = 15.0
) -> tuple[float, float, str] | None:
    """Tente plusieurs requêtes dans l'ordre. Retourne (lat, lon, used_query)
    dès le premier hit, sinon None. Chaque requête respecte le throttle 1 req/s
    via le verrou global de _geocode().
    """
    for q in queries:
        coords = _geocode(q, timeout=timeout)
        if coords:
            lat, lon = coords
            return lat, lon, q
    return None


def _now_iso() -> str:
    import datetime as _dt
    return _dt.datetime.now().isoformat(timespec="seconds")


# ─── Page ─────────────────────────────────────────────────────────────


@map_bp.get("/v30/carte")
def page_carte():
    uid = _uid()
    if not uid:
        return Response(status=302, headers={"Location": "/login"})
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "").strip()
    parts = [p for p in dn.split() if p]
    user_initials = "".join(p[0].upper() for p in parts[:2]) or "AB"
    return render_template(
        "v30/carte.html",
        active="carte",
        crumbs=["Prosp'Up", "Carte"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


# ─── API ──────────────────────────────────────────────────────────────


@map_bp.get("/api/map/markers")
def api_map_markers():
    """Retourne les marqueurs entreprises + prospects qui ont des coordonnées.
    Filtre côté client pour rester simple (volumes typiques ~hundreds).
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    companies: list = []
    prospects: list = []
    try:
        with _conn() as conn:
            cur = conn.execute(
                "SELECT id, groupe, site, address, city, country, industry, size, "
                "       latitude, longitude "
                "FROM companies "
                "WHERE owner_id=? AND deleted_at IS NULL "
                "  AND latitude IS NOT NULL AND longitude IS NOT NULL;",
                (uid,)
            )
            for r in cur.fetchall():
                d = dict(r)
                companies.append({
                    "id": int(d["id"]),
                    "name": d.get("groupe") or "—",
                    "site": d.get("site") or "",
                    "city": d.get("city") or "",
                    "country": d.get("country") or "",
                    "address": d.get("address") or "",
                    "industry": d.get("industry") or "",
                    "size": d.get("size") or "",
                    "lat": float(d["latitude"]),
                    "lon": float(d["longitude"]),
                })
            # Prospects geocodés directement (convention v30 : statut, telephone, pertinence)
            cur2 = conn.execute(
                "SELECT p.id, p.name, p.fonction, p.email, p.telephone, p.linkedin, "
                "       p.statut, p.pertinence, p.tags, p.rdvDate, p.nextFollowUp, "
                "       p.address, p.city, p.country, p.latitude, p.longitude, "
                "       c.groupe AS company_name, c.id AS company_id "
                "FROM prospects p "
                "LEFT JOIN companies c ON c.id = p.company_id AND c.owner_id = p.owner_id "
                "WHERE p.owner_id=? "
                "  AND (p.deleted_at IS NULL OR p.deleted_at='') "
                "  AND (p.is_archived IS NULL OR p.is_archived=0) "
                "  AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL;",
                (uid,)
            )
            for r in cur2.fetchall():
                d = dict(r)
                prospects.append({
                    "id": int(d["id"]),
                    "name": d.get("name") or "—",
                    "fonction": d.get("fonction") or "",
                    "email": d.get("email") or "",
                    "phone": d.get("telephone") or "",
                    "linkedin": d.get("linkedin") or "",
                    "status": d.get("statut") or "",
                    "priority": d.get("pertinence") or 0,
                    "tags": d.get("tags") or "",
                    "rdvDate": d.get("rdvDate") or "",
                    "nextFollowUp": d.get("nextFollowUp") or "",
                    "city": d.get("city") or "",
                    "country": d.get("country") or "",
                    "company_id": d.get("company_id"),
                    "company_name": d.get("company_name") or "",
                    "lat": float(d["latitude"]),
                    "lon": float(d["longitude"]),
                })
    except Exception as e:
        logger.exception("[map] markers query failed: %s", e)
        return jsonify(ok=False, error=str(e)), 500
    return jsonify(ok=True, companies=companies, prospects=prospects)


@map_bp.get("/api/map/stats")
def api_map_stats():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    try:
        with _conn() as conn:
            co_total = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=? AND deleted_at IS NULL;",
                (uid,)
            ).fetchone()[0]
            co_geo = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=? AND deleted_at IS NULL "
                "  AND latitude IS NOT NULL AND longitude IS NOT NULL;",
                (uid,)
            ).fetchone()[0]
            co_addr = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=? AND deleted_at IS NULL "
                "  AND ((address IS NOT NULL AND address<>'') "
                "       OR (city IS NOT NULL AND city<>'') "
                "       OR (country IS NOT NULL AND country<>''));",
                (uid,)
            ).fetchone()[0]
            pr_total = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "  AND (deleted_at IS NULL OR deleted_at='') "
                "  AND (is_archived IS NULL OR is_archived=0);",
                (uid,)
            ).fetchone()[0]
            pr_geo = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "  AND (deleted_at IS NULL OR deleted_at='') "
                "  AND (is_archived IS NULL OR is_archived=0) "
                "  AND latitude IS NOT NULL AND longitude IS NOT NULL;",
                (uid,)
            ).fetchone()[0]
            pr_self_addr = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "  AND (deleted_at IS NULL OR deleted_at='') "
                "  AND (is_archived IS NULL OR is_archived=0) "
                "  AND ((address IS NOT NULL AND address<>'') "
                "       OR (city IS NOT NULL AND city<>'') "
                "       OR (country IS NOT NULL AND country<>''));",
                (uid,)
            ).fetchone()[0]
    except Exception as e:
        logger.exception("[map] stats failed: %s", e)
        return jsonify(ok=False, error=str(e)), 500
    return jsonify(ok=True,
                   companies={"total": co_total, "geocoded": co_geo, "with_address": co_addr},
                   prospects={"total": pr_total, "geocoded": pr_geo, "with_address": pr_self_addr})


@map_bp.post("/api/map/geocode")
def api_map_geocode_one():
    """Géocode une entité unique. Body : {entity: "company"|"prospect", id: int}."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(silent=True) or {}
    entity = (payload.get("entity") or "").strip().lower()
    try:
        ent_id = int(payload.get("id") or 0)
    except Exception:
        ent_id = 0
    if entity not in ("company", "prospect") or ent_id <= 0:
        return jsonify(ok=False, error="Paramètres invalides"), 400
    with _conn() as conn:
        if entity == "company":
            row = conn.execute(
                "SELECT id, groupe, site, address, city, country FROM companies "
                "WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
                (ent_id, uid)
            ).fetchone()
            if not row:
                return jsonify(ok=False, error="Entreprise introuvable"), 404
            queries = _company_queries(dict(row))
        else:
            row = conn.execute(
                "SELECT p.id, p.name, p.address, p.city, p.country, "
                "       c.groupe AS company_name, "
                "       c.address AS company_address, c.city AS company_city, "
                "       c.country AS company_country "
                "FROM prospects p "
                "LEFT JOIN companies c ON c.id=p.company_id AND c.owner_id=p.owner_id "
                "WHERE p.id=? AND p.owner_id=? "
                "  AND (p.deleted_at IS NULL OR p.deleted_at='');",
                (ent_id, uid)
            ).fetchone()
            if not row:
                return jsonify(ok=False, error="Prospect introuvable"), 404
            queries = _prospect_queries(dict(row))
        if not queries:
            return jsonify(ok=False, error="Aucune adresse exploitable"), 422
        result = _geocode_with_fallbacks(queries)
        if not result:
            return jsonify(
                ok=False,
                error="Adresse non trouvée",
                tried=queries,
            ), 404
        lat, lon, used_query = result
        ts = _now_iso()
        if entity == "company":
            conn.execute(
                "UPDATE companies SET latitude=?, longitude=?, geocoded_at=? "
                "WHERE id=? AND owner_id=?;",
                (lat, lon, ts, ent_id, uid)
            )
        else:
            conn.execute(
                "UPDATE prospects SET latitude=?, longitude=?, geocoded_at=? "
                "WHERE id=? AND owner_id=?;",
                (lat, lon, ts, ent_id, uid)
            )
        conn.commit()
    return jsonify(ok=True, lat=lat, lon=lon, query=used_query, tried=queries)


@map_bp.get("/api/map/geocode/bulk")
def api_map_geocode_bulk():
    """SSE stream qui géocode toutes les entités sans coordonnées.

    Query :
      entity = companies | prospects | all (défaut: all)
      limit  = nombre max d'entités à traiter (défaut: 200, max 1000)
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    entity = (request.args.get("entity") or "all").strip().lower()
    if entity not in ("companies", "prospects", "all"):
        entity = "all"
    try:
        limit = max(1, min(1000, int(request.args.get("limit") or 200)))
    except Exception:
        limit = 200

    # On capture les enregistrements à traiter AVANT le stream pour éviter
    # de tenir une connexion ouverte pendant les requêtes HTTP réseau.
    co_targets: list = []
    pr_targets: list = []
    with _conn() as conn:
        if entity in ("companies", "all"):
            rows = conn.execute(
                "SELECT id, groupe, site, address, city, country FROM companies "
                "WHERE owner_id=? AND deleted_at IS NULL "
                "  AND (latitude IS NULL OR longitude IS NULL) "
                "  AND ((address IS NOT NULL AND address<>'') "
                "       OR (city IS NOT NULL AND city<>'') "
                "       OR (country IS NOT NULL AND country<>'')) "
                "ORDER BY id LIMIT ?;",
                (uid, limit)
            ).fetchall()
            for r in rows:
                d = dict(r)
                co_targets.append({"id": int(d["id"]), "name": d.get("groupe") or "—",
                                   "queries": _company_queries(d)})
        remaining = max(0, limit - len(co_targets)) if entity == "all" else limit
        if entity in ("prospects", "all") and remaining > 0:
            rows = conn.execute(
                "SELECT p.id, p.name, p.address, p.city, p.country, "
                "       c.groupe AS company_name, "
                "       c.address AS company_address, c.city AS company_city, "
                "       c.country AS company_country "
                "FROM prospects p "
                "LEFT JOIN companies c ON c.id=p.company_id AND c.owner_id=p.owner_id "
                "WHERE p.owner_id=? "
                "  AND (p.deleted_at IS NULL OR p.deleted_at='') "
                "  AND (p.is_archived IS NULL OR p.is_archived=0) "
                "  AND (p.latitude IS NULL OR p.longitude IS NULL) "
                "  AND ((p.address IS NOT NULL AND p.address<>'') "
                "       OR (p.city IS NOT NULL AND p.city<>'') "
                "       OR (p.country IS NOT NULL AND p.country<>'') "
                "       OR (c.address IS NOT NULL AND c.address<>'') "
                "       OR (c.city IS NOT NULL AND c.city<>'') "
                "       OR (c.country IS NOT NULL AND c.country<>'')) "
                "ORDER BY p.id LIMIT ?;",
                (uid, remaining)
            ).fetchall()
            for r in rows:
                d = dict(r)
                pr_targets.append({"id": int(d["id"]), "name": d.get("name") or "—",
                                   "queries": _prospect_queries(d)})

    total = len(co_targets) + len(pr_targets)

    def _emit(ev: dict) -> str:
        return "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"

    @stream_with_context
    def generate():
        yield _emit({"type": "start", "total": total,
                     "companies": len(co_targets), "prospects": len(pr_targets)})
        ok_count = 0
        skip_count = 0
        err_count = 0
        idx = 0
        for kind, target in (
            *(("company", t) for t in co_targets),
            *(("prospect", t) for t in pr_targets),
        ):
            idx += 1
            queries = target.get("queries") or []
            if not queries:
                skip_count += 1
                yield _emit({"type": "progress", "i": idx, "total": total,
                             "kind": kind, "id": target["id"], "name": target["name"],
                             "status": "skip", "reason": "no_address"})
                continue
            result = _geocode_with_fallbacks(queries)
            if not result:
                err_count += 1
                yield _emit({"type": "progress", "i": idx, "total": total,
                             "kind": kind, "id": target["id"], "name": target["name"],
                             "status": "error", "reason": "not_found",
                             "tried": queries})
                continue
            lat, lon, used_query = result
            ts = _now_iso()
            try:
                with _conn() as conn:
                    table = "companies" if kind == "company" else "prospects"
                    conn.execute(
                        f"UPDATE {table} SET latitude=?, longitude=?, geocoded_at=? "
                        f"WHERE id=? AND owner_id=?;",
                        (lat, lon, ts, target["id"], uid)
                    )
                    conn.commit()
                ok_count += 1
                # On signale au front quand on a dû tomber sur un repli moins
                # précis (ex. ville seule) — utile pour distinguer un marqueur
                # "à l'adresse" d'un marqueur "centre-ville approximatif".
                fallback = used_query != queries[0]
                yield _emit({"type": "progress", "i": idx, "total": total,
                             "kind": kind, "id": target["id"], "name": target["name"],
                             "status": "ok", "lat": lat, "lon": lon,
                             "query": used_query, "fallback": fallback})
            except Exception as e:
                err_count += 1
                logger.warning("[map] persist failed kind=%s id=%s: %s",
                               kind, target["id"], e)
                yield _emit({"type": "progress", "i": idx, "total": total,
                             "kind": kind, "id": target["id"], "name": target["name"],
                             "status": "error", "reason": "db"})
        yield _emit({"type": "done", "ok": ok_count, "errors": err_count,
                     "skipped": skip_count, "total": total})

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })
