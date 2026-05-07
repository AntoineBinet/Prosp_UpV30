"""ProspUp — génération d'emails de prospection (push).

Personnalisation de templates .msg Outlook + génération de brouillons :
- Lecture/parsing du template .msg (HTML + RTF compressé LZFu).
- Substitution des placeholders (salutation, candidats, signature).
- Sortie via Outlook (win32com, brouillon Exchange/M365 sync) ou .eml
  (RFC 2822) en fallback si Outlook absent.

Importé par les routes push d'app.py. Dépend de utils/candidates.py
(_build_candidate_descriptions) — la dépendance circulaire candidates ↔
push qui passait par app.py est ainsi rompue.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from config import APP_DIR, DATA_DIR
from utils.candidates import _build_candidate_descriptions

logger = logging.getLogger("prospup")


# ─────────────────────────────────────────────────────────────────
# Substitutions HTML (template .msg → email personnalisé)
# ─────────────────────────────────────────────────────────────────
def _apply_salutation(html_body: str, civilite: str, nom: str) -> str:
    """Remplace les placeholders de salutation dans le HTML du template.

    Accepte les placeholders [titre], [genre], [civilite] (interchangeables)
    pour le genre et [Nom], [nom], [prenom] pour le nom du prospect.
    """
    new_salutation = f"Bonjour {civilite} {nom},"
    # Pattern 1: "Bonjour [titre|genre|civilite] [Nom]," (avec ou sans virgule finale)
    html_body = re.sub(
        r'Bonjour\s*\[(?:titre|genre|civilit[eé])\]\s*\[(?:Nom|prenom|pr[eé]nom)\]\s*,?',
        new_salutation, html_body, count=1, flags=re.IGNORECASE
    )
    # Pattern 2: "Bonjour M. [Nom prospect]," ou variantes
    html_body = re.sub(
        r'Bonjour\s+(?:M\.|Mme\.|Dr\.?|Mme|M)?\s*\[?[Nn]om\s*(?:prospect)?\]?\s*,?',
        new_salutation, html_body, count=1, flags=re.IGNORECASE
    )
    # Pattern 3: "Bonjour M. [...]," générique
    html_body = re.sub(
        r'Bonjour\s+M\.\s+\[.*?\]\s*,?',
        new_salutation, html_body, count=1, flags=re.IGNORECASE
    )
    return html_body


def _apply_candidates(html_body: str, cand_lines: list) -> str:
    """Remplace le bloc candidats dans le HTML du template.

    Stratégie 1 : placeholders [Prénom candidat N]
    Stratégie 2 : remplacer le contenu entre l'ancre "consultants disponibles" et "Si ces profils"
    Stratégie 3 : insérer avant "Cordialement" en fallback
    """
    if not cand_lines:
        return html_body

    new_block_html = "\n".join(
        f'<p style="margin:5px 0 5px 20px;">&#8203;&ndash;&nbsp;{line}</p>' for line in cand_lines
    )

    # Stratégie 1 : placeholders explicites [Prénom 1], [Prénom 2], [Prénom candidat N]
    placeholder_pat = re.compile(
        r'<li\b[^>]*>(?:\s*\*[\t\s]*)?(.*?\[Pr[ée]nom(?:\s+candidat)?\s*\d*\].*?)</li>',
        re.IGNORECASE | re.DOTALL
    )
    matches = list(placeholder_pat.finditer(html_body))
    if matches:
        new_lis = '\n'.join(f'<li>{line}</li>' for line in cand_lines)
        start = matches[0].start()
        end = matches[-1].end()
        html_body = html_body[:start] + new_lis + html_body[end:]
        return html_body

    # Stratégie 2 : remplacer le bloc entre "consultants disponibles :" et "Si ces profils"
    anchor_start_pat = re.compile(
        r'(?:consultants\s+disponibles\s*:?\s*|dossiers\s+de\s+comp[eé]tences\s+de\s+consultants[^<\n]*:?\s*)',
        re.IGNORECASE
    )
    anchor_end_pat = re.compile(r'Si\s+ces\s+profils', re.IGNORECASE)
    m_start = anchor_start_pat.search(html_body)
    m_end = anchor_end_pat.search(html_body)

    if m_start and m_end and m_start.end() < m_end.start():
        after_anchor = html_body[m_start.end():]
        tag_close = re.search(r'(?:</(?:p|span|div|td)[^>]*>|<br\s*/?>)\s*', after_anchor, re.IGNORECASE)
        if tag_close:
            insert_from = m_start.end() + tag_close.end()
        else:
            insert_from = m_start.end()
        before = html_body[:insert_from]
        after = html_body[m_end.start():]
        html_body = before + "\n" + new_block_html + "\n" + after
        return html_body

    # Stratégie 3 : insérer avant la signature
    for sig in (r'Si\s+ces\s+profils', r'Cordialement', r'Bien\s+cordialement', r'Je\s+vous\s+remercie'):
        m = re.search(sig, html_body, re.IGNORECASE)
        if m:
            html_body = html_body[:m.start()] + new_block_html + "\n" + html_body[m.start():]
            return html_body

    # Stratégie 4 : ajouter à la fin
    html_body += "\n" + new_block_html
    return html_body


def _remove_signature(html_body: str) -> str:
    """Supprime tout depuis 'Bien cordialement' / 'Cordialement' jusqu'à la fin.

    Conserve les balises fermantes </body></html> si présentes.
    """
    m = re.search(r'(?:Bien\s+cordialement|Cordialement)', html_body, re.IGNORECASE)
    if not m:
        return html_body
    before = html_body[:m.start()]
    block_start = re.search(r'<(?:p|div|td|tr)[^>]*>\s*$', before, re.IGNORECASE)
    cut = block_start.start() if block_start else m.start()
    closing = re.search(r'((?:</(?:body|html)>\s*)+)$', html_body, re.IGNORECASE | re.DOTALL)
    if closing:
        return html_body[:cut] + '\n' + closing.group(1)
    return html_body[:cut]


def _apply_call_note(html_body: str, call_note: str) -> str:
    """Injecte la phrase d'accroche 'appel manqué' juste après la salutation."""
    if not call_note or not call_note.strip():
        return html_body
    note_html = f'<p style="margin:10px 0;">{call_note.strip()}</p>'
    m = re.search(r'Bonjour[^<,]*,?', html_body, re.IGNORECASE)
    if m:
        after_sal = html_body[m.end():]
        tag_close = re.search(r'</(?:p|div|td|span)[^>]*>', after_sal, re.IGNORECASE)
        if tag_close:
            insert_pos = m.end() + tag_close.end()
        else:
            insert_pos = m.end()
        return html_body[:insert_pos] + '\n' + note_html + '\n' + html_body[insert_pos:]
    return note_html + '\n' + html_body


# ─────────────────────────────────────────────────────────────────
# Lecture du template .msg (HTML direct + RTF compressé LZFu)
# ─────────────────────────────────────────────────────────────────
def _read_msg_body(template_path: Path) -> tuple:
    """Lit le corps HTML et le sujet d'un fichier .msg, .html, .htm ou .eml.

    Pour les fichiers HTML/EML : lecture directe du corps.
    Pour les fichiers .msg/.oft : parsing OLE2 via olefile + RTFDE.
    Retourne (html_body: str, subject: str).
    """
    subject = "Candidats disponibles"
    ext = template_path.suffix.lower()

    # Fichiers HTML et EML : lecture directe sans olefile
    if ext in ('.html', '.htm'):
        html_body = template_path.read_text(encoding='utf-8', errors='replace')
        return html_body, subject

    if ext == '.eml':
        import email as _email_lib
        raw = template_path.read_bytes()
        msg_eml = _email_lib.message_from_bytes(raw)
        subject = msg_eml.get('Subject', subject) or subject
        html_body = ""
        for part in msg_eml.walk():
            ct = part.get_content_type()
            if ct == 'text/html':
                cs = part.get_content_charset() or 'utf-8'
                html_body = part.get_payload(decode=True).decode(cs, errors='replace')
                break
        if not html_body:
            for part in msg_eml.walk():
                if part.get_content_type() == 'text/plain':
                    cs = part.get_content_charset() or 'utf-8'
                    txt = part.get_payload(decode=True).decode(cs, errors='replace')
                    html_body = "<html><body>" + txt.replace("\n", "<br>") + "</body></html>"
                    break
        return html_body, subject

    import struct
    try:
        import olefile  # type: ignore
    except ImportError:
        raise ValueError(
            "La librairie 'olefile' est requise pour lire les fichiers .msg. "
            "Installez-la via : pip install olefile"
        )

    html_body = ""

    # 1. Sujet — via extract-msg (gère parfaitement l'encodage)
    try:
        import extract_msg  # type: ignore
        msg = extract_msg.Message(str(template_path))
        subject = msg.subject or subject
        msg.close()
    except Exception as e:
        logger.debug("extract_msg pour le sujet échoué: %s", e)

    # 2. Corps HTML — via olefile + RTFDE pour le RTF→HTML
    try:
        ole = olefile.OleFileIO(str(template_path), raise_defects=olefile.DEFECT_POTENTIAL)
    except Exception as e:
        raise ValueError(f"Impossible d'ouvrir le fichier .msg: {e}")

    try:
        # 2a. HTML direct — PT_BINARY (0102) puis PT_UNICODE (001F)
        if ole.exists('__substg1.0_10130102'):
            raw = ole.openstream('__substg1.0_10130102').read()
            for enc in ('utf-8', 'cp1252', 'latin-1'):
                try:
                    html_body = raw.decode(enc)
                    break
                except (UnicodeDecodeError, LookupError):
                    continue
            else:
                html_body = raw.decode('utf-8', errors='replace')
        elif ole.exists('__substg1.0_1013001F'):
            raw = ole.openstream('__substg1.0_1013001F').read()
            html_body = raw.decode('utf-16-le', errors='replace').rstrip('\x00')

        # 2b. RTF compressé — décompression LZFu + extraction HTML via RTFDE
        if not html_body.strip() and ole.exists('__substg1.0_10090102'):
            try:
                rtf_raw = ole.openstream('__substg1.0_10090102').read()
                cb_raw = struct.unpack_from('<I', rtf_raw, 4)[0]
                magic = rtf_raw[8:12]
                if magic == b'MELA':
                    rtf_bytes = rtf_raw[16:]
                elif magic == b'LZFu':
                    PREBUF = (
                        b'{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}'
                        b'{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript '
                        b'\\fdecor MS Sans SerifSymbolArialTimes New RomanCourier'
                        b'{\\colortbl\\red0\\green0\\blue0\r\n'
                        b'\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx'
                    )
                    d = bytearray(4096)
                    d[:len(PREBUF)] = PREBUF
                    wpos = len(PREBUF)
                    out = bytearray()
                    pos = 16
                    while pos < len(rtf_raw) and len(out) < cb_raw:
                        ctrl = rtf_raw[pos]; pos += 1
                        for bit in range(8):
                            if pos >= len(rtf_raw) or len(out) >= cb_raw:
                                break
                            if ctrl & (1 << bit):
                                ref = (rtf_raw[pos] << 8) | rtf_raw[pos + 1]; pos += 2
                                off = (ref >> 4) & 0xFFF
                                ln = (ref & 0xF) + 2
                                for i in range(ln):
                                    c = d[(off + i) & 0xFFF]
                                    out.append(c)
                                    d[wpos & 0xFFF] = c
                                    wpos = (wpos + 1) & 0xFFF
                            else:
                                c = rtf_raw[pos]; pos += 1
                                out.append(c)
                                d[wpos & 0xFFF] = c
                                wpos = (wpos + 1) & 0xFFF
                    rtf_bytes = bytes(out)
                else:
                    raise ValueError(f"Signature LZFu inconnue: {magic!r}")

                from RTFDE.deencapsulate import DeEncapsulator  # type: ignore
                de = DeEncapsulator(rtf_bytes)
                de.deencapsulate()
                raw_html = de.html
                if isinstance(raw_html, bytes):
                    html_body = raw_html.decode('utf-8', errors='replace')
                else:
                    html_body = raw_html

                # Nettoyer les artefacts RTF résiduels laissés par RTFDE
                html_body = re.sub(r'\\par\b\s*', '', html_body)
                html_body = re.sub(r'(<li\b[^>]*>)\s*\*\t', r'\1', html_body)
            except Exception as rtf_err:
                logger.warning("Extraction HTML depuis RTF (RTFDE) échouée: %s", rtf_err)

        # 2c. Dernier recours : corps texte brut PT_UNICODE (0x1000)
        if not html_body.strip() and ole.exists('__substg1.0_1000001F'):
            raw = ole.openstream('__substg1.0_1000001F').read()
            txt = raw.decode('utf-16-le', errors='replace').rstrip('\x00')
            if txt.strip():
                html_body = (
                    "<html><body>"
                    + txt.replace("\r\n", "\n").replace("\n", "<br>")
                    + "</body></html>"
                )
    finally:
        ole.close()

    return html_body, subject


def _resolve_dc_path(cand: dict, uid: int) -> Path | None:
    """Résout le chemin du dossier de compétence PDF d'un candidat (variante push).

    Cherche dans cet ordre :
    1. Le champ dossier_competence_pdf en DB (chemin absolu ou relatif).
    2. Le dossier data/dossiers_candidats/{uid}/{cand_id}/ (glob *.pdf).

    Note : `utils/candidates._resolve_dc_pdf_path` fait quasiment la même
    chose pour la génération de description IA. Les deux sont conservés
    car la logique de fallback diffère légèrement — dédoublonnage à
    envisager dans une future PR.
    """
    dc_path_str = (cand.get("dossier_competence_pdf") or "").strip()
    cand_id = cand.get("id")

    candidates_paths: list[Path] = []

    # 1) Champ DB (chemin absolu ou relatif) — logique identique à /api/candidates/<id>/dossier-competence
    if dc_path_str:
        primary = Path(dc_path_str)
        if not primary.is_absolute():
            primary = APP_DIR / "dossiers_competence" / primary
        candidates_paths.append(primary)

        # Fallback : fichier déplacé vers le nouveau dossier user_id/cand_id
        if cand_id:
            candidates_paths.append(
                DATA_DIR / "dossiers_candidats" / str(uid) / str(cand_id) / Path(dc_path_str).name
            )

    # 2) Dossier par convention (toujours essayé en dernier)
    if cand_id:
        dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cand_id)
        if dc_dir.is_dir():
            for pdf in sorted(dc_dir.glob("*.pdf")):
                candidates_paths.append(pdf)

    for p in candidates_paths:
        try:
            if p.is_file() and p.suffix.lower() == ".pdf":
                logger.info("DC résolu: cand=%s path=%s", cand_id, p)
                return p
        except Exception as e:
            logger.warning("DC: erreur check %s: %s", p, e)
            continue

    logger.info("DC introuvable: cand=%s uid=%s field=%r", cand_id, uid, dc_path_str)
    return None


def _personalize_html_body(template_path: Path, prospect_data: dict, candidates_data: list,
                           call_note: str = '') -> tuple[str, str]:
    """Lit un template .msg et applique les substitutions (salutation, candidats, signature).

    Retourne (html_body, subject).
    """
    nom_complet = prospect_data.get("name", "")
    parts = nom_complet.split()
    civilite = prospect_data.get("civilite", "M.")
    nom = parts[-1] if parts else nom_complet

    html_body, subject = _read_msg_body(template_path)
    if not html_body.strip():
        raise ValueError("Le template .msg ne contient pas de corps HTML exploitable")

    html_body = _apply_salutation(html_body, civilite, nom)
    if call_note:
        html_body = _apply_call_note(html_body, call_note)
    if candidates_data:
        cand_lines = _build_candidate_descriptions(candidates_data)
        html_body = _apply_candidates(html_body, cand_lines)
    html_body = _remove_signature(html_body)

    return html_body, subject


# ─────────────────────────────────────────────────────────────────
# Sortie : Outlook (win32com) ou .eml fallback
# ─────────────────────────────────────────────────────────────────
def _save_to_outlook_drafts(template_path: Path, prospect_data: dict,
                            candidates_data: list, attachment_paths: list[Path] | None = None,
                            call_note: str = '') -> dict:
    """Crée l'email dans les Brouillons Outlook du serveur via win32com.

    Le brouillon se synchronise via Exchange/M365 sur tous les appareils.
    L'utilisateur retrouve l'email prêt à envoyer dans ses Brouillons.
    """
    import win32com.client  # type: ignore
    import pythoncom  # type: ignore

    pythoncom.CoInitialize()
    try:
        to_email = prospect_data.get("email", "")
        html_body, subject = _personalize_html_body(template_path, prospect_data, candidates_data, call_note=call_note)

        outlook = win32com.client.Dispatch("Outlook.Application")
        mail = outlook.CreateItem(0)  # olMailItem = 0
        mail.To = to_email
        mail.Subject = subject
        mail.HTMLBody = html_body

        pj_count = 0
        pj_errors = []
        if attachment_paths:
            for att_path in attachment_paths:
                try:
                    abs_path = str(att_path.resolve())
                    mail.Attachments.Add(abs_path)
                    pj_count += 1
                    logger.info("PJ ajoutée: %s", att_path.name)
                except Exception as e:
                    pj_errors.append(att_path.name)
                    logger.warning("Erreur ajout PJ %s: %s", att_path.name, e)

        mail.Save()
        logger.info("Brouillon Outlook créé: To=%s, Subject=%s, PJ=%d", to_email, subject, pj_count)

        return {
            "ok": True,
            "method": "outlook_drafts",
            "to": to_email,
            "subject": subject,
            "pj_count": pj_count,
            "pj_errors": pj_errors
        }
    finally:
        pythoncom.CoUninitialize()


def _generate_eml_file(template_path: Path, prospect_data: dict,
                       candidates_data: list, attachment_paths: list[Path] | None = None,
                       call_note: str = '') -> bytes:
    """Génère un .eml (RFC 2822) avec PJ intégrées.

    Fallback quand Outlook n'est pas disponible.
    """
    import email as email_lib
    import email.mime.multipart
    import email.mime.text
    import email.mime.base
    import email.encoders

    to_email = prospect_data.get("email", "")
    html_body, subject = _personalize_html_body(template_path, prospect_data, candidates_data, call_note=call_note)

    msg_eml = email_lib.mime.multipart.MIMEMultipart("mixed")
    msg_eml["From"] = ""
    msg_eml["To"] = to_email
    msg_eml["Subject"] = subject
    msg_eml["X-Unsent"] = "1"  # Indique au client mail que c'est un brouillon non-envoyé
    msg_eml.attach(email_lib.mime.text.MIMEText(html_body, "html", "utf-8"))

    pj_added = 0
    if attachment_paths:
        for att_path in attachment_paths:
            try:
                att_data = att_path.read_bytes()
                part = email_lib.mime.base.MIMEBase("application", "pdf")
                part.set_payload(att_data)
                email_lib.encoders.encode_base64(part)
                # RFC 2231 encoding pour gérer les caractères non-ASCII (ex: "Antoine Baïges.pdf")
                part.add_header(
                    "Content-Disposition",
                    "attachment",
                    filename=("utf-8", "", att_path.name),
                )
                msg_eml.attach(part)
                pj_added += 1
                logger.info("PJ .eml ajoutée: %s (%d bytes)", att_path.name, len(att_data))
            except Exception as e:
                logger.warning("Erreur ajout PJ .eml %s: %s", att_path.name, e)
    logger.info("_generate_eml_file: %d PJ intégrées sur %d candidat(s)",
                pj_added, len(attachment_paths or []))

    return msg_eml.as_bytes()
