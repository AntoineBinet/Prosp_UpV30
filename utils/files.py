"""ProspUp — uploads, MIME sniffing, miniatures, extraction de texte PDF.

Centralise la logique fichiers utilisée par les routes d'upload (pièces
jointes prospects, photos, dossiers de compétence) et par les pipelines
d'enrichissement IA.

Note v32.26 : il existait deux définitions concurrentes de `_extract_pdf_text`
dans app.py (l. 716 PyMuPDF / max_chars=50000 et l. 6928 pdfminer+pypdf /
max_chars=6000). La seconde écrasait silencieusement la première lors du
parsing Python — donc seule la version pdfminer+pypdf était réellement
utilisée. C'est cette version qu'on garde ici.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Dict

logger = logging.getLogger("prospup")


# ═══════════════════════════════════════════════════════════════════
# Validation centralisée des uploads (B4 — sécurité)
# ═══════════════════════════════════════════════════════════════════
_UPLOAD_RULES: Dict[str, Dict] = {
    "image": {
        "extensions": {".jpg", ".jpeg", ".png", ".webp", ".gif"},
        "mimes": {"image/jpeg", "image/png", "image/webp", "image/gif"},
        "max_bytes": 5 * 1024 * 1024,   # 5 Mo
        "label": "jpg, png, webp, gif",
    },
    "document": {
        "extensions": {".pdf", ".doc", ".docx"},
        "mimes": {
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        "max_bytes": 20 * 1024 * 1024,  # 20 Mo
        "label": "pdf, doc, docx",
    },
    "document_or_excel": {
        "extensions": {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt"},
        "mimes": {
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/plain",
        },
        "max_bytes": 20 * 1024 * 1024,  # 20 Mo
        "label": "pdf, doc, docx, xls, xlsx, txt",
    },
    "csv": {
        "extensions": {".csv"},
        "mimes": {"text/csv", "text/plain", "application/csv", "application/octet-stream"},
        "max_bytes": 10 * 1024 * 1024,  # 10 Mo
        "label": "csv",
    },
    "mail_template": {
        "extensions": {".msg", ".eml", ".oft", ".htm", ".html"},
        "mimes": {
            "application/vnd.ms-outlook",
            "message/rfc822",
            "text/html",
            "text/plain",
            "application/octet-stream",
        },
        "max_bytes": 10 * 1024 * 1024,  # 10 Mo
        "label": "msg, eml, oft, htm, html",
    },
    "prospect_attachment": {
        "extensions": {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".pptx", ".ppt", ".odt", ".ods"},
        "mimes": {
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.oasis.opendocument.text",
            "application/vnd.oasis.opendocument.spreadsheet",
            "text/plain",
            "image/jpeg", "image/png", "image/webp",
        },
        "max_bytes": 50 * 1024 * 1024,  # 50 Mo
        "label": "pdf, doc, docx, xls, xlsx, pptx, txt, jpg, png…",
    },
}

# Magic bytes (premiers octets) pour vérification MIME indépendante du Content-Type déclaré
_MAGIC_BYTES: list = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"RIFF", "image/webp"),   # WebP : RIFF....WEBP
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"%PDF-", "application/pdf"),
    (b"PK\x03\x04", None),     # ZIP container → docx / xlsx / odt (None = accepté si ext valide)
    (b"\xd0\xcf\x11\xe0", None),  # OLE2 compound → doc / xls / msg / oft
]


def _sniff_mime(header: bytes) -> str | None:
    """Retourne le MIME détecté à partir des magic bytes (premier 8 octets)."""
    for magic, mime in _MAGIC_BYTES:
        if header[:len(magic)] == magic:
            return mime  # peut être None pour les containers ZIP/OLE
    return None


def _attachment_dir(owner_id: int, prospect_id: int) -> Path:
    """Retourne (et crée) le dossier de pièces jointes isolé par user et prospect."""
    p = Path("data") / f"user_{owner_id}" / "attachments" / f"prospect_{prospect_id}"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _thumb_dir(owner_id: int, prospect_id: int) -> Path:
    """Sous-dossier pour les miniatures."""
    p = _attachment_dir(owner_id, prospect_id) / ".thumbs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _candidate_attachment_dir(owner_id: int, candidate_id: int) -> Path:
    """Retourne (et crée) le dossier de pièces jointes isolé par user et candidat."""
    p = Path("data") / f"user_{owner_id}" / "candidate_attachments" / f"candidate_{candidate_id}"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _generate_thumbnail(src_path: Path, mime_type: str, target_path: Path) -> bool:
    """Génère une miniature 320x240 PNG. Retourne True si succès.

    Supporte : PDF (1ère page via PyMuPDF), images (via Pillow).
    Échec silencieux si lib non dispo ou format non supporté.
    """
    try:
        m = (mime_type or "").lower()
        if m == "application/pdf":
            try:
                import fitz  # PyMuPDF
            except ImportError:
                return False
            try:
                doc = fitz.open(str(src_path))
                if doc.page_count == 0:
                    doc.close()
                    return False
                page = doc.load_page(0)
                mat = fitz.Matrix(1.5, 1.5)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                pix.save(str(target_path))
                doc.close()
                return True
            except Exception as e:
                logger.warning("[thumb] PDF render failed: %s", e)
                return False
        if m.startswith("image/"):
            try:
                from PIL import Image
            except ImportError:
                return False
            try:
                with Image.open(str(src_path)) as img:
                    img = img.convert("RGB")
                    img.thumbnail((480, 360))
                    img.save(str(target_path), "PNG", optimize=True)
                    return True
            except Exception as e:
                logger.warning("[thumb] image render failed: %s", e)
                return False
    except Exception as e:
        logger.warning("[thumb] unexpected error: %s", e)
    return False


def _extract_pdf_text(pdf_path: Path, max_chars: int = 6000) -> str:
    """Extrait le texte d'un fichier PDF sur disque. Retourne chaîne vide en cas d'échec.

    Tente d'abord pdfminer (qualité supérieure pour PDF complexes), fallback
    pypdf (plus tolérant aux PDF mal formés).
    """
    if not pdf_path.is_file():
        return ""
    try:
        import io as _io
        pdf_bytes = pdf_path.read_bytes()
        pdf_text = ""
        try:
            from pdfminer.high_level import extract_text as _pdfminer_extract  # type: ignore
            pdf_text = _pdfminer_extract(_io.BytesIO(pdf_bytes), maxpages=8) or ""
        except ImportError:
            pass
        if not pdf_text.strip():
            try:
                import pypdf  # type: ignore
                reader = pypdf.PdfReader(_io.BytesIO(pdf_bytes))
                for page in reader.pages[:8]:
                    pdf_text += page.extract_text() or ""
            except ImportError:
                pass
        return pdf_text[:max_chars].strip()
    except Exception as e:
        logger.warning("_extract_pdf_text(%s) error: %s", pdf_path, e)
        return ""


def _validate_upload(file_storage, rule_name: str):
    """Valide un FileStorage Werkzeug (extension, MIME, taille).

    Retourne (True, None) si tout est OK, (False, (message, http_code)) sinon.
    Lit les premiers octets puis seek(0) pour ne pas consommer le flux.
    """
    rules = _UPLOAD_RULES[rule_name]

    ext = os.path.splitext(file_storage.filename or "")[1].lower()
    if ext not in rules["extensions"]:
        return False, (f"Extension non autorisée. Formats acceptés : {rules['label']}", 400)

    data = file_storage.read()
    file_storage.seek(0)
    if len(data) > rules["max_bytes"]:
        limit_mb = rules["max_bytes"] // (1024 * 1024)
        return False, (f"Fichier trop volumineux (max {limit_mb} Mo)", 413)

    sniffed = _sniff_mime(data[:8])
    if sniffed is not None and sniffed not in rules["mimes"]:
        return False, ("Type de fichier non autorisé (contenu invalide)", 415)

    return True, None
