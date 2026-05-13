"""ProspUp — Actus (news marché du travail + offres d'emploi).

Service autonome qui agrège :
- Articles RSS depuis une liste curatée de sources tech FR (Usine Nouvelle,
  L'Usine Digitale, JDN, ZDNet…) avec un filtre thématique
  robotique/embarqué/informatique et un classement régional automatique.
- Offres d'emploi via une couche d'adaptation (`JobSource`) ; la stratégie
  par défaut tente plusieurs sources publiques (Adzuna si clés env présentes,
  sinon scraping HelloWork best-effort, sinon flux statique de démo).

Stockage : tables `actus_articles`, `actus_jobs`, `actus_favoris` créées dans
la DB centrale (`DB_PATH`). Le cache est partagé entre tous les utilisateurs
(données publiques) ; seuls les favoris sont per-user via `owner_id`.

Rafraîchissement : déclenché toutes les 6 h par APScheduler, ou à la demande
via `POST /api/actus/refresh`. Idempotent (dédup par URL).

Note Jobfly : aucun service public connu sous ce nom n'expose d'API/RSS
documentée. L'adapter pattern permet de brancher une vraie source Jobfly
plus tard sans toucher au reste du code — voir `JobflyAdapter` en bas du
fichier.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import logging
import os
import re
import sqlite3
import threading
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Iterable

from config import DB_PATH

logger = logging.getLogger("prospup")

# ────────────────────────────────────────────────────────────────────
#  Config — sources & filtres
# ────────────────────────────────────────────────────────────────────

# Mots-clés thématiques (insensible à la casse, sans accent). Un article
# doit matcher au moins un mot-clé pour être conservé dans le cache.
TOPIC_KEYWORDS = (
    "robot", "robotique", "robotic",
    "embarqu", "embedded", "firmware", "microcontroleur", "stm32", "fpga",
    "iot", "objet connecte", "objets connectes",
    "intelligence artificielle", " ia ", " ai ", "machine learning",
    "informatique", "logiciel", "software", "developpeur", "developer",
    "ingenieur", "engineer", "tech ",
    "automate", "automatisme", "mecatronique",
    "drone", "vehicule autonome", "edge computing",
)

# Régions et leurs alias (pour le matching de localisation). La clé est l'ID
# stable utilisé côté UI ; la valeur est la liste de chaînes à rechercher
# dans le titre/résumé/localisation (insensible à la casse, sans accent).
REGIONS = {
    "national": {"label": "France entière", "aliases": []},
    "idf": {"label": "Île-de-France", "aliases": ["ile-de-france", "ile de france", "idf", "paris", "92", "93", "94", "95", "78", "77", "91"]},
    "ara": {"label": "Auvergne-Rhône-Alpes", "aliases": ["auvergne-rhone-alpes", "rhone-alpes", "ara", "lyon", "grenoble", "saint-etienne", "clermont-ferrand"]},
    "occitanie": {"label": "Occitanie", "aliases": ["occitanie", "toulouse", "montpellier", "midi-pyrenees"]},
    "paca": {"label": "PACA", "aliases": ["paca", "provence-alpes-cote-d'azur", "marseille", "nice", "sophia antipolis", "sophia-antipolis"]},
    "bretagne": {"label": "Bretagne", "aliases": ["bretagne", "rennes", "brest", "lannion"]},
    "hdf": {"label": "Hauts-de-France", "aliases": ["hauts-de-france", "lille", "amiens", "nord-pas-de-calais"]},
    "ge": {"label": "Grand Est", "aliases": ["grand-est", "grand est", "strasbourg", "metz", "nancy", "reims"]},
    "naq": {"label": "Nouvelle-Aquitaine", "aliases": ["nouvelle-aquitaine", "bordeaux", "poitiers", "limoges"]},
}

# Flux RSS pour les actus marché du travail / tech. Le flag `topic_filter`
# = True applique le filtre thématique ; sur les flux déjà spécialisés
# (Usine Digitale, JDN solutions/emploi) on peut le désactiver pour
# conserver plus de contenu.
NEWS_FEEDS = [
    {"name": "L'Usine Digitale", "url": "https://www.usine-digitale.fr/rss/", "topic_filter": False},
    {"name": "L'Usine Nouvelle", "url": "https://www.usinenouvelle.com/rss/", "topic_filter": True},
    {"name": "JDN Emploi", "url": "https://www.journaldunet.com/solutions/emploi-rh/rss/", "topic_filter": False},
    {"name": "JDN Tech", "url": "https://www.journaldunet.com/solutions/dsi/rss/", "topic_filter": True},
    {"name": "ZDNet France", "url": "https://www.zdnet.fr/feeds/rss/actualites/", "topic_filter": True},
    {"name": "Frenchweb", "url": "https://www.frenchweb.fr/feed", "topic_filter": True},
]

# Durée de validité du cache avant rafraîchissement automatique (heures).
CACHE_TTL_HOURS = 6
# Timeout HTTP par requête sortante (secondes).
HTTP_TIMEOUT = 12
# User-Agent : se présenter explicitement pour éviter d'être bloqué.
USER_AGENT = "ProspUp-Actus/1.0 (+https://prospup.work)"

# Lock pour sérialiser les refresh concurrents (scheduler + clic manuel
# simultané).
_REFRESH_LOCK = threading.Lock()


# ────────────────────────────────────────────────────────────────────
#  DB — schéma & accès
# ────────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS actus_articles (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    url           TEXT NOT NULL UNIQUE,
    title         TEXT NOT NULL,
    source        TEXT NOT NULL,
    summary       TEXT,
    published_at  TEXT,
    region_hint   TEXT,
    tags          TEXT,
    fetched_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actus_articles_published ON actus_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_actus_articles_region ON actus_articles(region_hint);

CREATE TABLE IF NOT EXISTS actus_jobs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id    TEXT NOT NULL UNIQUE,
    url            TEXT NOT NULL,
    title          TEXT NOT NULL,
    company        TEXT,
    location       TEXT,
    region_hint    TEXT,
    contract_type  TEXT,
    description    TEXT,
    salary         TEXT,
    source         TEXT NOT NULL,
    posted_at      TEXT,
    tags           TEXT,
    fetched_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actus_jobs_posted ON actus_jobs(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_actus_jobs_region ON actus_jobs(region_hint);
CREATE INDEX IF NOT EXISTS idx_actus_jobs_contract ON actus_jobs(contract_type);

CREATE TABLE IF NOT EXISTS actus_favoris (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL,
    job_id      INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE(owner_id, job_id),
    FOREIGN KEY(job_id) REFERENCES actus_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_actus_favoris_owner ON actus_favoris(owner_id);

CREATE TABLE IF NOT EXISTS actus_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT
);
"""


def _conn() -> sqlite3.Connection:
    """Connexion à la DB centrale (cache partagé inter-users)."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 20000;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def init_schema() -> None:
    """Crée les tables si absentes. Appelé une fois au boot."""
    with _conn() as conn:
        conn.executescript(SCHEMA_SQL)


# ────────────────────────────────────────────────────────────────────
#  Helpers — normalisation texte, dédoublonnage, région
# ────────────────────────────────────────────────────────────────────

_ACCENTS = str.maketrans(
    "àâäãåçèéêëìîïñòôöõùûüÿœæÀÂÄÃÅÇÈÉÊËÌÎÏÑÒÔÖÕÙÛÜŸŒÆ",
    "aaaaaceeeeiiinoooouuuyoaAAAAACEEEEIIINOOOOUUUYOA",
)


def _norm(text: str) -> str:
    """Lowercase + suppression d'accents pour matching insensible."""
    if not text:
        return ""
    return text.translate(_ACCENTS).lower()


def _strip_html(html: str) -> str:
    """Suppression naïve de tags HTML pour les résumés RSS."""
    if not html:
        return ""
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"&quot;", '"', text)
    text = re.sub(r"&#39;", "'", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _matches_topic(title: str, summary: str) -> bool:
    """True si l'un des mots-clés thématiques apparaît dans titre/résumé."""
    haystack = " " + _norm(title) + " " + _norm(summary) + " "
    return any(k in haystack for k in TOPIC_KEYWORDS)


def _detect_region(*texts: str) -> str:
    """Inspecte les textes fournis et retourne l'ID de région détectée.
    Retourne 'national' si aucun match (fallback non discriminant)."""
    haystack = " ".join(_norm(t or "") for t in texts)
    for rid, info in REGIONS.items():
        if rid == "national":
            continue
        for alias in info["aliases"]:
            if alias in haystack:
                return rid
    return "national"


def _now_iso() -> str:
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _parse_rss_date(raw: str | None) -> str | None:
    """Convertit un date RSS (RFC822 ou ISO) en ISO UTC. Retourne None si
    le format est inconnu."""
    if not raw:
        return None
    raw = raw.strip()
    fmts = (
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    )
    for f in fmts:
        try:
            dt = datetime.datetime.strptime(raw, f)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            return dt.astimezone(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        except ValueError:
            continue
    return None


def _http_get(url: str) -> bytes:
    """GET HTTP simple avec UA + timeout. Lève en cas d'erreur."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        return r.read()


# ────────────────────────────────────────────────────────────────────
#  RSS parsing (stdlib XML — pas de dépendance feedparser)
# ────────────────────────────────────────────────────────────────────

# Namespaces fréquents dans les flux RSS/Atom français.
_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
}


def _rss_items(xml_bytes: bytes) -> list[dict]:
    """Parse un flux RSS 2.0 ou Atom et retourne une liste de dicts
    normalisés {title, url, summary, published}."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        logger.warning("RSS parse error: %s", exc)
        return []

    items: list[dict] = []
    # RSS 2.0 : <rss><channel><item>...
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        url = (it.findtext("link") or "").strip()
        desc = it.findtext("description") or it.findtext(f"{{{_NS['content']}}}encoded") or ""
        pub = it.findtext("pubDate") or it.findtext(f"{{{_NS['dc']}}}date")
        items.append({
            "title": title,
            "url": url,
            "summary": _strip_html(desc)[:600],
            "published": _parse_rss_date(pub),
        })

    # Atom : <feed><entry>...
    for it in root.iter(f"{{{_NS['atom']}}}entry"):
        title = (it.findtext(f"{{{_NS['atom']}}}title") or "").strip()
        url = ""
        link_el = it.find(f"{{{_NS['atom']}}}link")
        if link_el is not None:
            url = link_el.get("href", "")
        desc = it.findtext(f"{{{_NS['atom']}}}summary") or it.findtext(f"{{{_NS['atom']}}}content") or ""
        pub = it.findtext(f"{{{_NS['atom']}}}published") or it.findtext(f"{{{_NS['atom']}}}updated")
        items.append({
            "title": title,
            "url": url,
            "summary": _strip_html(desc)[:600],
            "published": _parse_rss_date(pub),
        })

    return [it for it in items if it["title"] and it["url"]]


# ────────────────────────────────────────────────────────────────────
#  Refresh — articles
# ────────────────────────────────────────────────────────────────────

def _fetch_one_feed(feed: dict) -> list[dict]:
    """Récupère et filtre un flux RSS. Retourne une liste d'articles
    normalisés prêts à insertion."""
    try:
        raw = _http_get(feed["url"])
    except Exception as exc:
        logger.warning("Actus — flux %s indisponible : %s", feed["name"], exc)
        return []
    raw_items = _rss_items(raw)
    out: list[dict] = []
    for it in raw_items:
        if feed.get("topic_filter") and not _matches_topic(it["title"], it["summary"]):
            continue
        out.append({
            "url": it["url"],
            "title": it["title"][:400],
            "source": feed["name"],
            "summary": it["summary"],
            "published_at": it["published"],
            "region_hint": _detect_region(it["title"], it["summary"]),
            "tags": json.dumps(_extract_tags(it["title"], it["summary"]), ensure_ascii=False),
        })
    return out


def _extract_tags(title: str, summary: str) -> list[str]:
    """Génère une petite liste de tags thématiques (≤3) à partir du
    contenu, pour catégoriser visuellement les cartes."""
    text = _norm(title + " " + summary)
    rules = (
        ("Robotique", ("robot",)),
        ("Embarqué", ("embarqu", "firmware", "microcontroleur", "stm32", "fpga")),
        ("IoT", ("iot", "objet connecte")),
        ("IA", ("intelligence artificielle", " ia ", " ai ", "machine learning")),
        ("Logiciel", ("logiciel", "software", "developpeur", "developer")),
        ("Drone", ("drone",)),
    )
    tags: list[str] = []
    for label, keys in rules:
        if any(k in text for k in keys):
            tags.append(label)
        if len(tags) >= 3:
            break
    return tags


def refresh_articles() -> dict:
    """Récupère tous les flux d'actus, déduplique, insère/met-à-jour le
    cache. Retourne un résumé {sources_ok, sources_ko, inserted, skipped}."""
    now = _now_iso()
    sources_ok = 0
    sources_ko = 0
    inserted = 0
    skipped = 0
    all_items: list[dict] = []
    for feed in NEWS_FEEDS:
        items = _fetch_one_feed(feed)
        if items:
            sources_ok += 1
            all_items.extend(items)
        else:
            sources_ko += 1

    if not all_items:
        return {"sources_ok": sources_ok, "sources_ko": sources_ko, "inserted": 0, "skipped": 0}

    with _conn() as conn:
        for art in all_items:
            try:
                cur = conn.execute(
                    """INSERT OR IGNORE INTO actus_articles
                       (url, title, source, summary, published_at, region_hint, tags, fetched_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?);""",
                    (art["url"], art["title"], art["source"], art["summary"],
                     art["published_at"], art["region_hint"], art["tags"], now),
                )
                if cur.rowcount:
                    inserted += 1
                else:
                    skipped += 1
            except sqlite3.Error as exc:
                logger.warning("Actus insert article failed: %s", exc)
        conn.execute("INSERT OR REPLACE INTO actus_meta(key, value) VALUES('articles_last_refresh', ?);", (now,))
        conn.commit()

    logger.info("Actus articles refresh: %s ok / %s ko, %s nouveaux / %s déjà connus",
                sources_ok, sources_ko, inserted, skipped)
    return {"sources_ok": sources_ok, "sources_ko": sources_ko, "inserted": inserted, "skipped": skipped}


# ────────────────────────────────────────────────────────────────────
#  Refresh — offres d'emploi (adapter pattern)
# ────────────────────────────────────────────────────────────────────

class JobSource:
    """Interface minimale d'une source d'offres d'emploi.

    `fetch(queries, region)` doit retourner une liste de dicts contenant
    au minimum : external_id, url, title, company, location, contract_type,
    description, posted_at, source.
    """

    name: str = "base"

    def fetch(self, queries: Iterable[str], region: str) -> list[dict]:  # pragma: no cover
        raise NotImplementedError


class AdzunaSource(JobSource):
    """Adapter Adzuna (https://developer.adzuna.com/). Free tier 1000 calls/mois.

    Requiert deux variables d'environnement :
    - ADZUNA_APP_ID
    - ADZUNA_APP_KEY

    Si absentes, la source se déclare inutilisable (cf. `available`).
    """

    name = "Adzuna"
    BASE = "https://api.adzuna.com/v1/api/jobs/fr/search/1"

    @property
    def available(self) -> bool:
        return bool(os.environ.get("ADZUNA_APP_ID") and os.environ.get("ADZUNA_APP_KEY"))

    def fetch(self, queries: Iterable[str], region: str) -> list[dict]:
        if not self.available:
            return []
        app_id = os.environ["ADZUNA_APP_ID"]
        app_key = os.environ["ADZUNA_APP_KEY"]
        out: list[dict] = []
        for q in queries:
            params = {
                "app_id": app_id,
                "app_key": app_key,
                "results_per_page": "30",
                "what": q,
                "content-type": "application/json",
            }
            if region != "national":
                params["where"] = REGIONS[region]["label"]
            url = self.BASE + "?" + urllib.parse.urlencode(params)
            try:
                raw = _http_get(url)
                data = json.loads(raw)
            except Exception as exc:
                logger.warning("Adzuna fetch failed (%s): %s", q, exc)
                continue
            for r in data.get("results", []):
                rid = r.get("id")
                if not rid:
                    continue
                out.append({
                    "external_id": f"adzuna:{rid}",
                    "url": r.get("redirect_url") or "",
                    "title": (r.get("title") or "").strip()[:300],
                    "company": ((r.get("company") or {}).get("display_name") or "").strip()[:200],
                    "location": ((r.get("location") or {}).get("display_name") or "").strip()[:200],
                    "contract_type": (r.get("contract_type") or "").upper() or _infer_contract(r.get("title")),
                    "description": _strip_html(r.get("description") or "")[:1200],
                    "salary": _format_salary(r.get("salary_min"), r.get("salary_max")),
                    "source": self.name,
                    "posted_at": _parse_rss_date(r.get("created")),
                })
        return out


class FranceTravailRSSSource(JobSource):
    """Adapter France Travail (ex-Pôle Emploi) — variante RSS publique
    qui ne requiert pas d'OAuth.

    Les URLs ci-dessous pointent vers la page de recherche publique
    avec export RSS désormais routé via /candidat/. Si le format change,
    le parseur retourne simplement une liste vide — le UI dégrade
    proprement vers les autres sources.
    """

    name = "France Travail"

    QUERIES_URLS = {
        # Patterns en best-effort. Si la source casse, on log et on
        # bascule sur l'adapter suivant.
        "robotique": "https://candidat.francetravail.fr/offres/recherche.rss?motsCles=robotique",
        "informatique embarquee": "https://candidat.francetravail.fr/offres/recherche.rss?motsCles=informatique+embarquee",
        "systeme embarque": "https://candidat.francetravail.fr/offres/recherche.rss?motsCles=systeme+embarque",
    }

    def fetch(self, queries: Iterable[str], region: str) -> list[dict]:
        out: list[dict] = []
        for q in queries:
            url = self.QUERIES_URLS.get(_norm(q).replace("é", "e"))
            if not url:
                continue
            try:
                raw = _http_get(url)
            except Exception as exc:
                logger.info("France Travail RSS indisponible (%s): %s", q, exc)
                continue
            for it in _rss_items(raw):
                # Extraction best-effort : "Titre — Entreprise (Localisation)"
                title, company, location = _split_ft_title(it["title"])
                if region != "national" and _detect_region(location, it["title"]) != region:
                    continue
                rid = hashlib.md5(it["url"].encode("utf-8")).hexdigest()[:16]
                out.append({
                    "external_id": f"ft:{rid}",
                    "url": it["url"],
                    "title": title[:300],
                    "company": company[:200],
                    "location": location[:200],
                    "contract_type": _infer_contract(title + " " + it["summary"]),
                    "description": it["summary"][:1200],
                    "salary": "",
                    "source": self.name,
                    "posted_at": it["published"],
                })
        return out


class DemoSource(JobSource):
    """Fallback en cas d'indisponibilité totale des sources externes —
    quelques offres statiques pour que l'UI ne soit jamais vide et que
    l'on puisse vérifier le rendu hors-ligne. Marquées comme `Démo` pour
    transparence."""

    name = "Démo"

    SAMPLES = [
        {"title": "Ingénieur·e logiciel embarqué C/C++", "company": "Aldebaran Robotics", "location": "Issy-les-Moulineaux (92)", "contract": "CDI", "tags": "robotique,embarqué"},
        {"title": "Software Engineer — Drones autonomes", "company": "Parrot", "location": "Paris (75)", "contract": "CDI", "tags": "drone,IA"},
        {"title": "Stage : Vision par ordinateur (ROS2)", "company": "ENSTA Paris", "location": "Palaiseau (91)", "contract": "STAGE", "tags": "robotique,IA"},
        {"title": "Tech Lead Firmware STM32", "company": "Sigfox", "location": "Labège (31)", "contract": "CDI", "tags": "embarqué,IoT"},
        {"title": "Ingénieur·e mécatronique", "company": "Soben", "location": "Lyon (69)", "contract": "CDI", "tags": "robotique"},
    ]

    def fetch(self, queries: Iterable[str], region: str) -> list[dict]:
        now = _now_iso()
        out: list[dict] = []
        for i, s in enumerate(self.SAMPLES):
            rh = _detect_region(s["location"])
            if region != "national" and rh != region:
                continue
            out.append({
                "external_id": f"demo:{i}",
                "url": "#",
                "title": s["title"],
                "company": s["company"],
                "location": s["location"],
                "contract_type": s["contract"],
                "description": "Offre de démonstration. Configurez une source réelle (ADZUNA_APP_ID/KEY) pour des données live.",
                "salary": "",
                "source": self.name,
                "posted_at": now,
            })
        return out


class JobflyAdapter(JobSource):
    """Placeholder pour brancher une vraie source Jobfly si jamais elle
    devient disponible. À ce jour, aucun service public clair n'expose
    d'API/RSS sous ce nom. Implémenter `fetch()` ci-dessous quand on aura
    la doc/URL/clé.
    """

    name = "Jobfly"

    @property
    def available(self) -> bool:
        # Activable via une variable d'env quand la doc Jobfly sera connue.
        return bool(os.environ.get("JOBFLY_API_URL"))

    def fetch(self, queries: Iterable[str], region: str) -> list[dict]:
        if not self.available:
            return []
        base = os.environ["JOBFLY_API_URL"].rstrip("/")
        token = os.environ.get("JOBFLY_TOKEN", "")
        out: list[dict] = []
        for q in queries:
            params = {"q": q}
            if region != "national":
                params["region"] = REGIONS[region]["label"]
            url = f"{base}?{urllib.parse.urlencode(params)}"
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json",
                    "Authorization": f"Bearer {token}" if token else "",
                })
                with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
                    data = json.loads(r.read())
            except Exception as exc:
                logger.warning("Jobfly fetch failed (%s): %s", q, exc)
                continue
            # Mapping à ajuster selon la forme réelle de la réponse Jobfly.
            for r in data.get("results") or data.get("jobs") or []:
                rid = r.get("id") or hashlib.md5(json.dumps(r, sort_keys=True).encode()).hexdigest()[:16]
                out.append({
                    "external_id": f"jobfly:{rid}",
                    "url": r.get("url") or r.get("link") or "",
                    "title": (r.get("title") or "").strip()[:300],
                    "company": (r.get("company") or "").strip()[:200],
                    "location": (r.get("location") or "").strip()[:200],
                    "contract_type": (r.get("contract") or _infer_contract(r.get("title"))).upper(),
                    "description": _strip_html(r.get("description") or "")[:1200],
                    "salary": r.get("salary") or "",
                    "source": self.name,
                    "posted_at": _parse_rss_date(r.get("posted_at") or r.get("created_at")),
                })
        return out


# Sources actives par ordre de préférence. La 1ère qui renvoie des
# résultats non vides gagne ; on agrège ensuite avec les suivantes.
DEFAULT_SOURCES: list[JobSource] = [
    JobflyAdapter(),
    AdzunaSource(),
    FranceTravailRSSSource(),
    DemoSource(),
]

# Requêtes par défaut. La page peut en ajouter d'autres via le paramètre
# `q` de l'API de refresh.
DEFAULT_QUERIES = ("robotique", "informatique embarquee", "systeme embarque")


# ────────────────────────────────────────────────────────────────────
#  Heuristiques contrat / salaire / titre
# ────────────────────────────────────────────────────────────────────

def _infer_contract(text: str | None) -> str:
    """Devine le type de contrat à partir du titre/description.
    Retourne CDI / CDD / STAGE / ALTERNANCE / FREELANCE / INDÉFINI."""
    if not text:
        return ""
    t = _norm(text)
    if "stage" in t or "stagiaire" in t:
        return "STAGE"
    if "alternan" in t or "apprenti" in t:
        return "ALTERNANCE"
    if "freelance" in t or "independant" in t or "consultant" in t:
        return "FREELANCE"
    if "cdd" in t:
        return "CDD"
    if "cdi" in t:
        return "CDI"
    return ""


def _format_salary(smin, smax) -> str:
    try:
        smin_i = int(smin) if smin is not None else None
        smax_i = int(smax) if smax is not None else None
    except (TypeError, ValueError):
        return ""
    if smin_i and smax_i:
        return f"{smin_i:,}–{smax_i:,} €".replace(",", " ")
    if smin_i:
        return f"≥ {smin_i:,} €".replace(",", " ")
    if smax_i:
        return f"≤ {smax_i:,} €".replace(",", " ")
    return ""


_FT_TITLE_RE = re.compile(r"^(?P<title>.+?)\s+[—-]\s+(?P<company>[^()]+?)(?:\s*\((?P<loc>[^)]+)\))?$")


def _split_ft_title(raw: str) -> tuple[str, str, str]:
    """Parse un titre France Travail type 'Titre — Société (Ville)'."""
    if not raw:
        return ("", "", "")
    m = _FT_TITLE_RE.match(raw)
    if not m:
        return (raw.strip(), "", "")
    return (m.group("title").strip(), m.group("company").strip(), (m.group("loc") or "").strip())


def refresh_jobs(queries: Iterable[str] | None = None, region: str = "national") -> dict:
    """Récupère les offres depuis toutes les sources actives, déduplique
    par external_id, insère/met-à-jour le cache."""
    qs = list(queries) if queries else list(DEFAULT_QUERIES)
    now = _now_iso()
    sources_ok = 0
    sources_ko = 0
    inserted = 0
    skipped = 0
    seen: dict[str, dict] = {}

    for src in DEFAULT_SOURCES:
        try:
            items = src.fetch(qs, region)
        except Exception as exc:
            logger.warning("Actus job source %s a échoué : %s", src.name, exc)
            sources_ko += 1
            continue
        if items:
            sources_ok += 1
            for it in items:
                # Premier vu gagne — préserve l'ordre de préférence des sources.
                seen.setdefault(it["external_id"], it)
        else:
            sources_ko += 1

    if not seen:
        return {"sources_ok": sources_ok, "sources_ko": sources_ko, "inserted": 0, "skipped": 0}

    with _conn() as conn:
        for job in seen.values():
            region_hint = _detect_region(job.get("location", ""), job.get("title", ""))
            tags = json.dumps(_extract_tags(job.get("title", ""), job.get("description", "")), ensure_ascii=False)
            try:
                cur = conn.execute(
                    """INSERT OR REPLACE INTO actus_jobs
                       (external_id, url, title, company, location, region_hint, contract_type,
                        description, salary, source, posted_at, tags, fetched_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);""",
                    (job["external_id"], job["url"], job["title"], job.get("company", ""),
                     job.get("location", ""), region_hint, job.get("contract_type", ""),
                     job.get("description", ""), job.get("salary", ""), job["source"],
                     job.get("posted_at"), tags, now),
                )
                if cur.rowcount:
                    inserted += 1
                else:
                    skipped += 1
            except sqlite3.Error as exc:
                logger.warning("Actus insert job failed: %s", exc)
        conn.execute("INSERT OR REPLACE INTO actus_meta(key, value) VALUES('jobs_last_refresh', ?);", (now,))
        conn.commit()

    logger.info("Actus jobs refresh: %s ok / %s ko, %s nouveaux/màj",
                sources_ok, sources_ko, inserted)
    return {"sources_ok": sources_ok, "sources_ko": sources_ko, "inserted": inserted, "skipped": skipped}


def refresh_all(force: bool = False) -> dict:
    """Rafraîchit articles + jobs en respectant le TTL si `force=False`.
    Sérialisé via un lock pour éviter les exécutions concurrentes."""
    if not _REFRESH_LOCK.acquire(blocking=False):
        return {"ok": False, "skipped": True, "reason": "refresh déjà en cours"}
    try:
        last_articles = _get_meta("articles_last_refresh")
        last_jobs = _get_meta("jobs_last_refresh")
        cutoff = (datetime.datetime.utcnow() - datetime.timedelta(hours=CACHE_TTL_HOURS)).isoformat() + "Z"
        result = {"ok": True, "articles": None, "jobs": None}
        if force or not last_articles or last_articles < cutoff:
            result["articles"] = refresh_articles()
        if force or not last_jobs or last_jobs < cutoff:
            result["jobs"] = refresh_jobs()
        return result
    finally:
        _REFRESH_LOCK.release()


# ────────────────────────────────────────────────────────────────────
#  Lecture (queries pour l'API HTTP)
# ────────────────────────────────────────────────────────────────────

def _get_meta(key: str) -> str | None:
    with _conn() as conn:
        row = conn.execute("SELECT value FROM actus_meta WHERE key=?;", (key,)).fetchone()
    return row["value"] if row else None


def list_articles(region: str = "national", limit: int = 30) -> list[dict]:
    """Retourne les articles cachés filtrés par région. La région
    'national' renvoie tous les articles (avec ceux régionalisés inclus)."""
    with _conn() as conn:
        if region == "national":
            rows = conn.execute(
                """SELECT * FROM actus_articles
                   ORDER BY COALESCE(published_at, fetched_at) DESC
                   LIMIT ?;""",
                (limit,),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM actus_articles
                   WHERE region_hint IN (?, 'national')
                   ORDER BY COALESCE(published_at, fetched_at) DESC
                   LIMIT ?;""",
                (region, limit),
            ).fetchall()
    return [_row_to_article(r) for r in rows]


def list_jobs(region: str = "national", q: str = "", contract: list[str] | None = None,
              sort: str = "date", limit: int = 60, offset: int = 0,
              owner_id: int | None = None) -> list[dict]:
    """Retourne les offres cachées filtrées."""
    where = []
    params: list = []
    if region != "national":
        where.append("region_hint = ?")
        params.append(region)
    if q:
        where.append("(title LIKE ? OR company LIKE ? OR description LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    if contract:
        placeholders = ",".join("?" * len(contract))
        where.append(f"contract_type IN ({placeholders})")
        params.extend([c.upper() for c in contract])
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    order_sql = "ORDER BY COALESCE(posted_at, fetched_at) DESC" if sort != "title" else "ORDER BY title COLLATE NOCASE ASC"

    fav_ids: set[int] = set()
    if owner_id:
        with _conn() as conn:
            fav_rows = conn.execute(
                "SELECT job_id FROM actus_favoris WHERE owner_id=?;",
                (owner_id,),
            ).fetchall()
        fav_ids = {int(r["job_id"]) for r in fav_rows}

    with _conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM actus_jobs {where_sql} {order_sql} LIMIT ? OFFSET ?;",
            (*params, int(limit), int(offset)),
        ).fetchall()
    return [_row_to_job(r, fav_ids) for r in rows]


def list_favoris(owner_id: int, limit: int = 100) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            """SELECT j.* FROM actus_jobs j
               JOIN actus_favoris f ON f.job_id = j.id
               WHERE f.owner_id = ?
               ORDER BY f.created_at DESC LIMIT ?;""",
            (owner_id, limit),
        ).fetchall()
    return [_row_to_job(r, set()) | {"is_favori": True} for r in rows]


def toggle_favori(owner_id: int, job_id: int) -> dict:
    """Toggle ON/OFF un favori. Retourne {"on": bool}."""
    now = _now_iso()
    with _conn() as conn:
        existing = conn.execute(
            "SELECT id FROM actus_favoris WHERE owner_id=? AND job_id=?;",
            (owner_id, job_id),
        ).fetchone()
        if existing:
            conn.execute("DELETE FROM actus_favoris WHERE id=?;", (existing["id"],))
            conn.commit()
            return {"on": False}
        conn.execute(
            "INSERT INTO actus_favoris(owner_id, job_id, created_at) VALUES(?, ?, ?);",
            (owner_id, job_id, now),
        )
        conn.commit()
        return {"on": True}


def status() -> dict:
    """État du cache (pour debug + bandeau UI)."""
    with _conn() as conn:
        a = conn.execute("SELECT COUNT(*) FROM actus_articles;").fetchone()[0]
        j = conn.execute("SELECT COUNT(*) FROM actus_jobs;").fetchone()[0]
    return {
        "articles_count": a,
        "jobs_count": j,
        "articles_last_refresh": _get_meta("articles_last_refresh"),
        "jobs_last_refresh": _get_meta("jobs_last_refresh"),
        "regions": [{"id": rid, "label": r["label"]} for rid, r in REGIONS.items()],
    }


# ────────────────────────────────────────────────────────────────────
#  Sérialisation (row → dict pour JSON API)
# ────────────────────────────────────────────────────────────────────

def _row_to_article(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "url": r["url"],
        "title": r["title"],
        "source": r["source"],
        "summary": r["summary"] or "",
        "published_at": r["published_at"],
        "region_hint": r["region_hint"],
        "tags": json.loads(r["tags"]) if r["tags"] else [],
        "fetched_at": r["fetched_at"],
    }


def _row_to_job(r: sqlite3.Row, fav_ids: set[int]) -> dict:
    return {
        "id": r["id"],
        "external_id": r["external_id"],
        "url": r["url"],
        "title": r["title"],
        "company": r["company"] or "",
        "location": r["location"] or "",
        "region_hint": r["region_hint"],
        "contract_type": r["contract_type"] or "",
        "description": r["description"] or "",
        "salary": r["salary"] or "",
        "source": r["source"],
        "posted_at": r["posted_at"],
        "tags": json.loads(r["tags"]) if r["tags"] else [],
        "is_favori": int(r["id"]) in fav_ids,
    }
