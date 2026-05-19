"""ProspUp — équivalences techniques pour le matching prospect/candidat.

Remplace l'ancien `_get_text_embedding_simple` (comptage de caractères + 28
mots-clés hardcodés) qui ne capturait aucune sémantique. Ici on encode
explicitement les équivalences courantes en ingénierie : synonymes,
abréviations, écosystèmes liés.

Utilisé par `utils.ai_helpers._compute_semantic_similarity` (best-candidates
scoring) — quand un tag prospect (ex: "JEE") ne matche pas exactement les
skills d'un candidat (ex: "Java"), on regarde si le tag et un skill
appartiennent au même groupe d'équivalence.
"""
from __future__ import annotations

import unicodedata
from typing import Iterable


# ── Groupes d'équivalence (tous les termes d'un même set se "matchent" entre eux)
# Garder les termes en minuscules, sans accents (la normalisation est faite à la lecture).
# Quand un terme appartient à plusieurs groupes (ex: "c" → langage ET embarqué), c'est OK :
# on parcourt tous les groupes contenant le terme à la recherche d'un overlap.
_SYNONYM_GROUPS: tuple[frozenset[str], ...] = (
    # Langages & écosystèmes JVM
    frozenset({"java", "jee", "j2ee", "jakarta ee", "spring", "spring boot", "springboot", "jakarta"}),
    frozenset({"kotlin", "ktor", "spring kotlin"}),
    frozenset({"scala", "akka", "play framework"}),
    # Python & data
    frozenset({"python", "django", "flask", "fastapi", "py", "pyspark"}),
    frozenset({"data science", "machine learning", "ml", "ia", "ai", "deep learning", "dl",
               "tensorflow", "pytorch", "scikit-learn", "sklearn", "pandas", "numpy"}),
    # Web frontend
    frozenset({"javascript", "js", "typescript", "ts", "node", "nodejs", "node.js"}),
    frozenset({"react", "reactjs", "react.js", "next", "nextjs", "next.js"}),
    frozenset({"vue", "vuejs", "vue.js", "nuxt", "nuxtjs"}),
    frozenset({"angular", "angularjs", "angular.js"}),
    # C / C++ / embarqué
    frozenset({"c", "c++", "cpp", "c/c++", "embarque", "embedded", "firmware", "bare-metal",
               "microcontroleur", "microcontroller", "mcu", "stm32", "arm", "cortex"}),
    frozenset({"rtos", "freertos", "vxworks", "zephyr", "threadx", "embedded os"}),
    frozenset({"fpga", "vhdl", "verilog", "systemverilog", "hdl", "xilinx", "altera", "intel fpga", "lattice"}),
    frozenset({"autosar", "classic autosar", "adaptive autosar", "automotive software", "can",
               "lin", "flexray", "ethernet automotive", "doip", "uds"}),
    # Mobile
    frozenset({"android", "kotlin android", "java android", "jetpack compose"}),
    frozenset({"ios", "swift", "swiftui", "objective-c", "objc"}),
    frozenset({"flutter", "dart"}),
    frozenset({"react native", "rn"}),
    # DevOps / Cloud
    frozenset({"docker", "containers", "containerd", "podman"}),
    frozenset({"kubernetes", "k8s", "rancher", "openshift", "helm"}),
    frozenset({"aws", "amazon web services", "ec2", "s3", "lambda", "rds"}),
    frozenset({"azure", "microsoft azure", "azure devops", "aks"}),
    frozenset({"gcp", "google cloud", "google cloud platform", "gke", "bigquery"}),
    frozenset({"terraform", "iac", "infrastructure as code", "pulumi", "cloudformation"}),
    frozenset({"ansible", "puppet", "chef", "salt", "configuration management"}),
    frozenset({"ci/cd", "ci cd", "jenkins", "gitlab ci", "github actions", "argo cd", "circleci",
               "azure pipelines", "tekton", "drone"}),
    frozenset({"git", "gitlab", "github", "bitbucket", "version control", "scm"}),
    # Bases de données
    frozenset({"sql", "postgresql", "postgres", "mysql", "mariadb", "oracle", "sql server",
               "mssql", "sqlite", "sgbd", "rdbms"}),
    frozenset({"nosql", "mongodb", "mongo", "cassandra", "couchdb", "dynamodb", "redis", "elasticsearch", "elastic"}),
    # Messaging / streaming
    frozenset({"kafka", "confluent", "rabbitmq", "activemq", "nats", "pulsar", "mq", "messaging"}),
    # Cybersécurité
    frozenset({"cybersecurite", "cybersecurity", "security", "pentest", "appsec", "soc",
               "edr", "siem", "iam", "owasp", "ssi", "rssi"}),
    # Tests / qualité
    frozenset({"test", "tests", "testing", "qa", "qualification", "validation", "junit", "pytest",
               "cypress", "selenium", "playwright", "tdd", "bdd"}),
    # Méthodes
    frozenset({"agile", "scrum", "kanban", "safe", "lean", "xp", "extreme programming"}),
    # Secteurs (réutilisé aussi côté SECTOR_KEYWORDS dans app.py — on garde la cohérence)
    frozenset({"automobile", "auto", "automotive", "oem", "tier 1", "tier1", "constructeur automobile"}),
    frozenset({"aeronautique", "aero", "aviation", "aerospace", "aerospatial", "do-178", "do178"}),
    frozenset({"ferroviaire", "rail", "railway", "sncf", "alstom", "cenelec", "en50128"}),
    frozenset({"defense", "militaire", "armement", "dga", "naval defense"}),
    frozenset({"spatial", "space", "satellites", "cnes", "esa"}),
    frozenset({"medical", "medtech", "dispositif medical", "iso 13485", "iec 62304"}),
    frozenset({"energie", "energy", "nucleaire", "nuclear", "edf", "framatome", "orano",
               "renewable", "renouvelable", "photovoltaique", "eolien"}),
    frozenset({"telecom", "telecoms", "5g", "4g", "lte", "radio", "rf", "iot",
               "nb-iot", "lora", "lorawan", "sigfox", "zigbee"}),
    frozenset({"banque", "banking", "finance", "fintech", "assurance", "insurance",
               "trading", "marche financier"}),
    frozenset({"retail", "ecommerce", "e-commerce", "distribution"}),
    # Gestion de projet / PMO
    frozenset({"chef de projet", "project manager", "pm", "pmo", "directeur de projet",
               "program manager", "scrum master", "product owner", "po"}),
    # Achat / industrialisation (vu dans fixedMetier "Project Manager > Achat / Industrialisation")
    frozenset({"achat", "achats", "purchasing", "procurement", "sourcing", "buyer"}),
    frozenset({"industrialisation", "industrialization", "industrial engineering",
               "production engineering", "manufacturing engineering"}),
    # Systèmes
    frozenset({"linux", "ubuntu", "debian", "rhel", "centos", "fedora", "unix"}),
    frozenset({"windows", "win32", ".net", "dotnet", "c#", "csharp"}),
    frozenset({"macos", "darwin", "mac os"}),
    # Big data
    frozenset({"big data", "hadoop", "spark", "hive", "hdfs", "data lake", "data warehouse",
               "snowflake", "databricks"}),
    # Observabilité
    frozenset({"monitoring", "observability", "prometheus", "grafana", "datadog", "new relic",
               "elastic stack", "elk", "loki", "tempo", "splunk", "tracing", "metrics", "logs"}),
)


def _norm(text: str) -> str:
    """Normalise un terme : minuscule, sans accents, espaces normalisés."""
    if not text:
        return ""
    t = unicodedata.normalize("NFD", str(text).strip().lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    # Espaces multiples → simple ; mais on conserve les espaces internes (autosar adaptive ≠ autosar)
    t = " ".join(t.split())
    return t


def are_synonyms(term_a: str, term_b: str) -> bool:
    """Retourne True si les deux termes appartiennent au même groupe d'équivalence
    technique, OU si l'un est strictement contenu dans l'autre (avec frontière de
    mot). Insensible à la casse et aux accents.
    """
    a, b = _norm(term_a), _norm(term_b)
    if not a or not b:
        return False
    if a == b:
        return True
    # Inclusion bidirectionnelle avec frontière mot (évite "java" dans "javascript" → True non voulu)
    # → on regarde les groupes plutôt que l'inclusion brute.
    for group in _SYNONYM_GROUPS:
        if a in group and b in group:
            return True
    return False


def find_synonym_for(term: str, candidates: Iterable[str]) -> str | None:
    """Retourne le premier candidat qui est synonyme de `term`, ou None."""
    a = _norm(term)
    if not a:
        return None
    for cand in candidates:
        if are_synonyms(a, cand):
            return cand
    return None


def expand_terms(terms: Iterable[str], max_total: int = 60) -> list[str]:
    """Étend une liste de termes avec leurs synonymes connus (utile pour élargir
    une recherche). Conserve l'ordre des termes d'origine en tête, puis ajoute
    les synonymes du même groupe. Capé à `max_total` pour éviter d'inonder.
    """
    out: list[str] = []
    seen: set[str] = set()
    for t in terms:
        nt = _norm(t)
        if nt and nt not in seen:
            seen.add(nt)
            out.append(nt)
    for t in list(out):
        for group in _SYNONYM_GROUPS:
            if t in group:
                for syn in group:
                    if syn not in seen:
                        seen.add(syn)
                        out.append(syn)
                        if len(out) >= max_total:
                            return out
    return out
