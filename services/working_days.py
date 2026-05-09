"""Helpers ProspUp pour les jours ouvrés (exclu sam/dim et jours fériés FR).

L'utilisateur ne travaille pas le weekend ni les jours fériés métropole France.
Ce module est la source unique de vérité pour :
  - savoir si une date est un jour travaillé,
  - compter le nombre de jours ouvrés sur une plage,
  - obtenir le nom des JF pour une plage (utilisé par /api/holidays
    et par le calendrier front pour griser/tooltiper les cases).

Source des JF : package `holidays` (offline, à jour, listé dans requirements.txt).
Si le package est absent, le helper retombe sur weekday-only (samedi/dimanche
exclus) pour ne pas casser l'app. Voir CLAUDE.md § "User working schedule".
"""
from __future__ import annotations

import datetime
from functools import lru_cache
from typing import Union

DateLike = Union[datetime.date, str]

try:
    import holidays as _holidays_pkg  # type: ignore
    _HAS_HOLIDAYS = True
except Exception:
    _holidays_pkg = None
    _HAS_HOLIDAYS = False


def _coerce(d: DateLike) -> datetime.date | None:
    if isinstance(d, datetime.date):
        return d
    if isinstance(d, str):
        try:
            return datetime.date.fromisoformat(d[:10])
        except Exception:
            return None
    return None


@lru_cache(maxsize=16)
def _fr_holidays_for_year(year: int) -> dict[datetime.date, str]:
    """Mapping {date → nom du JF} pour une année donnée (cache process)."""
    if not _HAS_HOLIDAYS:
        return {}
    try:
        return dict(_holidays_pkg.France(years=year))
    except Exception:
        return {}


def is_holiday(d: DateLike) -> bool:
    dd = _coerce(d)
    if dd is None:
        return False
    return dd in _fr_holidays_for_year(dd.year)


def holiday_name(d: DateLike) -> str:
    """Nom du JF si la date en est un, sinon chaîne vide."""
    dd = _coerce(d)
    if dd is None:
        return ""
    return _fr_holidays_for_year(dd.year).get(dd, "")


def is_working_day(d: DateLike) -> bool:
    """True si lundi-vendredi non férié."""
    dd = _coerce(d)
    if dd is None:
        return False
    if dd.weekday() >= 5:
        return False
    return dd not in _fr_holidays_for_year(dd.year)


def count_working_days(start: DateLike, end: DateLike) -> int:
    """Jours ouvrés dans [start, end] inclusive. 0 si plage invalide."""
    s, e = _coerce(start), _coerce(end)
    if s is None or e is None or s > e:
        return 0
    n = 0
    d = s
    while d <= e:
        if is_working_day(d):
            n += 1
        d += datetime.timedelta(days=1)
    return n


def working_day_iso_set(start: DateLike, end: DateLike) -> set[str]:
    """Set d'ISO dates ouvrées dans [start, end]."""
    s, e = _coerce(start), _coerce(end)
    out: set[str] = set()
    if s is None or e is None or s > e:
        return out
    d = s
    while d <= e:
        if is_working_day(d):
            out.add(d.isoformat())
        d += datetime.timedelta(days=1)
    return out


def get_holidays(start: DateLike, end: DateLike) -> dict[str, str]:
    """Retourne {YYYY-MM-DD → nom du JF} sur [start, end]."""
    s, e = _coerce(start), _coerce(end)
    if s is None or e is None or s > e:
        return {}
    out: dict[str, str] = {}
    for year in range(s.year, e.year + 1):
        for d, name in _fr_holidays_for_year(year).items():
            if s <= d <= e:
                out[d.isoformat()] = name
    return out


def has_holidays_package() -> bool:
    """Permet aux callers (ex: /api/holidays) de signaler que le package
    n'est pas installé, plutôt que de retourner silencieusement {}."""
    return _HAS_HOLIDAYS
