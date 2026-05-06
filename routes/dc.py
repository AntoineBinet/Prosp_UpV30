"""ProspUp — Blueprint DC Generator (génération dossiers de compétences PDF/DOCX)."""
from __future__ import annotations

import datetime
import io
import json
import os
import re
from io import BytesIO
from pathlib import Path

from flask import Blueprint, Response, jsonify, request, send_file, stream_with_context

from app import _audit_log, log_activity, logger
from config import APP_DIR, DATA_DIR
from utils.ai_helpers import _call_ai, _load_ai_config, _stream_ai_sse
from utils.auth import _uid, login_required, role_required
from utils.common import _now_iso
from utils.db import _conn
from utils.files import _validate_upload
from utils.validation import _safe_row_to_dict

dc_bp = Blueprint("dc", __name__)


@dc_bp.route('/dc-generator')
@login_required
def dc_generator():
    """Redirige vers l'UI v30. ?candidate=X conservé via segment /v30/dc/<X>."""
    cid = (request.args.get("candidate") or "").strip()
    if cid.isdigit():
        return redirect(f"/v30/dc/{cid}", code=302)
    return redirect("/v30/dc", code=302)


@dc_bp.route('/candidates/<int:candidate_id>/dc-generator')
@login_required
def dc_generator_candidate(candidate_id):
    return redirect(f"/v30/dc/{candidate_id}", code=302)


@dc_bp.route('/dc-generator/template')
@login_required
def dc_generator_template():
    """Téléchargement du template vide template_dc.docx"""
    template_path = os.path.join(APP_DIR, 'sample', 'template_dc.docx')
    if not os.path.exists(template_path):
        abort(404)
    return send_file(
        template_path,
        as_attachment=True,
        download_name='template_dc.docx',
        mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )


@dc_bp.route('/dc-generator/upload-template', methods=['POST'])
@login_required
@role_required('admin')
def dc_generator_upload_template():
    """Remplace le template template_dc.docx (admin uniquement)"""
    import shutil as _shutil
    if 'template_file' not in request.files:
        return jsonify({'success': False, 'error': 'Aucun fichier fourni'}), 400
    f = request.files['template_file']
    if not f.filename.lower().endswith('.docx'):
        return jsonify({'success': False, 'error': 'Fichier .docx requis'}), 400

    template_dir  = os.path.join(APP_DIR, 'sample')
    template_path = os.path.join(template_dir, 'template_dc.docx')
    os.makedirs(template_dir, exist_ok=True)

    # Sauvegarde de l'ancien template
    if os.path.exists(template_path):
        _shutil.copy2(template_path, template_path + '.bak')
    try:
        f.save(template_path)
        # Vérifier que c'est un docx valide
        from docx import Document as _Docx
        _Docx(template_path)
        return jsonify({'success': True})
    except Exception as e:
        # Restaurer le backup si le fichier est invalide
        bak = template_path + '.bak'
        if os.path.exists(bak):
            _shutil.copy2(bak, template_path)
        return jsonify({'success': False, 'error': f'Fichier invalide : {e}'}), 400


@dc_bp.route('/dc-generator/generate', methods=['POST'])
@login_required
def dc_generator_generate():
    """Génère le dossier de compétences Word (.docx)"""
    uid = _uid()
    tmp_cv = None
    try:
        from utils.cv_parser import CVParser
        from utils.dossier_generator import DossierGenerator

        candidate_id = request.form.get('candidate_id')
        use_ollama   = request.form.get('use_ollama', 'auto')  # 'auto'|'yes'|'no'
        ollama_available = False

        # Données de base depuis la DB si candidat fourni
        base_data = {}
        if candidate_id:
            with _conn() as conn:
                row = conn.execute(
                    "SELECT * FROM candidates WHERE id=? AND owner_id=?", (candidate_id, uid)
                ).fetchone()
            if row:
                base_data = _safe_row_to_dict(row) or {}

        # ── Extraction du CV ──────────────────────────────────────────────────
        cv_data = {}
        cv_text = ''
        ollama_ok = False

        if 'cv_file' in request.files and request.files['cv_file'].filename:
            cv_file = request.files['cv_file']
            ext = os.path.splitext(cv_file.filename)[1].lower()
            import tempfile as _tempfile
            fd, tmp_cv = _tempfile.mkstemp(suffix=ext, prefix='cv_upload_')
            os.close(fd)
            cv_file.save(tmp_cv)

            # Extraire le texte brut pour Ollama
            if ext == '.pdf':
                # Tentative 1 : PyMuPDF (fitz) — meilleure extraction, préserve la structure
                try:
                    import fitz as _fitz
                    _doc = _fitz.open(tmp_cv)
                    cv_text = '\n'.join(page.get_text() for page in _doc)
                    _doc.close()
                    logger.info("DC Generator: PDF extrait via PyMuPDF (%d chars)", len(cv_text))
                except Exception as _e1:
                    logger.warning("DC Generator: PyMuPDF échoué (%s), essai pypdf", _e1)
                # Tentative 2 : pypdf — fallback fiable
                if not cv_text.strip():
                    try:
                        from pypdf import PdfReader as _PdfReader
                        _reader = _PdfReader(tmp_cv)
                        cv_text = '\n'.join(
                            page.extract_text() or ''
                            for page in _reader.pages
                        )
                        logger.info("DC Generator: PDF extrait via pypdf (%d chars)", len(cv_text))
                    except Exception as _e2:
                        logger.warning("DC Generator: pypdf échoué aussi (%s)", _e2)
                if not cv_text.strip():
                    logger.error("DC Generator: impossible d'extraire le texte du PDF — aucune lib disponible")
            elif ext in ('.docx', '.doc'):
                try:
                    from docx import Document as _Docx
                    _doc = _Docx(tmp_cv)
                    cv_text = '\n'.join(p.text for p in _doc.paragraphs if p.text.strip())
                except Exception:
                    pass

            # ── Essayer l'IA locale si texte disponible ───────────────────────
            # Utilise _load_ai_config() — source unique de config (UI Paramètres > IA).
            # Pas de ping préalable : qwen2.5:7b peut mettre 15-30s à charger à froid,
            # un ping avec timeout court déclarerait l'IA indisponible à tort.
            # On tente l'extraction directement avec le timeout configuré (≥120s).
            ollama_ok = False
            ollama_available = True  # optimiste — on ne sait pas avant d'essayer
            if cv_text.strip() and use_ollama != 'no':
                try:
                    ai_cfg = _load_ai_config()
                    ollama_url     = ai_cfg.get('ollama_url', OLLAMA_URL)
                    ollama_model   = ai_cfg.get('ollama_model', OLLAMA_MODEL)
                    ollama_timeout = max(300, int(ai_cfg.get('ollama_timeout') or OLLAMA_TIMEOUT))

                    from utils.ollama_extractor import extract as _ollama_extract
                    extracted = _ollama_extract(cv_text, ollama_url, ollama_model, ollama_timeout)
                    if extracted and (extracted.get('competences') or extracted.get('nom') or extracted.get('experiences')):
                        cv_data = extracted
                        ollama_ok = True
                        logger.info("DC Generator: extraction IA OK (missing=%s)",
                                    extracted.get('_missing', []))
                    else:
                        logger.warning("DC Generator: extraction IA retournée vide (modèle=%s)", ollama_model)
                except Exception as _oe:
                    logger.warning("DC Generator: extraction IA échouée: %s", _oe)
                    ollama_available = False

            # ── Fallback : extraction basique si Ollama indisponible ──────────
            # N'utilise PAS CVParser (calibré pour tableaux Up Tech uniquement).
            # Extrait uniquement nom/titre depuis les premières lignes du texte.
            if not ollama_ok and cv_text.strip():
                import re as _re2
                _lines = [l.strip() for l in cv_text.split('\n') if l.strip()][:20]
                _nom = _prenom = _titre = _annees = ''
                _caps = _re2.compile(r'^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ\s\-/–]{7,}$')
                for _l in _lines[:8]:
                    if _caps.match(_l) and len(_l.split()) >= 2:
                        _titre = _l; break
                _name_re = _re2.compile(
                    r'^([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][a-zàâäéèêëîïôùûüç]+(?:-[A-Za-zÀ-ÿ]+)*)'
                    r'\s+([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][A-Za-zÀ-ÿ\-]+)$')
                for _l in _lines[:12]:
                    _m = _name_re.match(_l)
                    if _m:
                        _prenom, _nom = _m.group(1), _m.group(2).upper(); break
                _ym = _re2.search(r"(\d+)\s*ans?\s+d['’]expérience", cv_text[:2000], _re2.IGNORECASE)
                if _ym:
                    _annees = _ym.group(1) + " ans d'expérience"
                cv_data = {
                    'nom': _nom, 'prenom': _prenom,
                    'titre_poste': _titre, 'annees_experience': _annees,
                    'competences': [], 'experiences': [], 'formations': [],
                    'langues': [], 'certifications': [],
                }

            # Merge identité depuis la DB (nom/prenom/titre prioritaires si renseignés)
            if base_data:
                for _k in ('nom', 'prenom', 'titre_poste', 'email', 'telephone'):
                    _v = base_data.get(_k, '')
                    if _v and str(_v).strip() and not cv_data.get(_k):
                        cv_data[_k] = str(_v).strip()
                if not cv_data.get('annees_experience'):
                    _yrs = base_data.get('annees_experience') or base_data.get('years_experience')
                    if _yrs:
                        cv_data['annees_experience'] = f"{_yrs} ans d'expérience"
        else:
            # Pas de CV — utiliser les données DB uniquement
            cv_data = {
                'nom':               base_data.get('nom', base_data.get('name', '')),
                'prenom':            base_data.get('prenom', ''),
                'titre_poste':       base_data.get('titre', base_data.get('role', '')),
                'annees_experience': '',
                'competences': [], 'experiences': [],
                'formations':  [], 'langues': [], 'certifications': []
            }

        # ── Générer le fichier Word ───────────────────────────────────────────
        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        cid_str   = str(candidate_id) if candidate_id else 'standalone'
        nom_raw   = f"{cv_data.get('nom','candidat')} {cv_data.get('prenom','')}".strip()
        nom_clean = re.sub(r'[^\w\-]', '_', nom_raw)
        output_path = os.path.join(
            str(APP_DIR), 'outputs', 'dossiers',
            f'{cid_str}_{nom_clean}_{timestamp}.docx'
        )
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        gen = DossierGenerator()
        gen.generate(cv_data, output_path)

        # ── Sauvegarder en DB ─────────────────────────────────────────────────
        nom_dl = f"Dossier_Up_{cv_data.get('nom','')}_{cv_data.get('prenom','')}.docx"
        gen_iso = datetime.datetime.now().isoformat()
        gen_id = None
        with _conn() as conn:
            if candidate_id:
                conn.execute(
                    "UPDATE candidates SET dossier_path=?, dossier_generated_at=? WHERE id=? AND owner_id=?",
                    (output_path, gen_iso, candidate_id, uid)
                )
            try:
                cur = conn.execute(
                    "INSERT INTO dc_generations (candidate_id, filename, file_path, used_ollama, generated_at, owner_id) "
                    "VALUES (?, ?, ?, ?, ?, ?);",
                    (
                        int(candidate_id) if candidate_id else None,
                        nom_dl,
                        output_path,
                        1 if ollama_ok else 0,
                        gen_iso,
                        uid,
                    )
                )
                gen_id = cur.lastrowid
            except Exception as _e:
                logger.warning("DC Generator: insert dc_generations failed: %s", _e)
            conn.commit()

        import urllib.parse as _urlparse
        missing_fields = cv_data.pop('_missing', []) if isinstance(cv_data, dict) else []
        return jsonify({
            'success':         True,
            'id':              gen_id,
            'download_url':    '/dc-generator/download?path=' + _urlparse.quote(output_path, safe=''),
            'filename':        nom_dl,
            'generated_at':    datetime.datetime.now().strftime('%d/%m/%Y à %H:%M'),
            'used_ollama':     bool(ollama_ok),
            'ollama_available': bool(ollama_available),
            'missing_fields':  missing_fields,
        })
    except Exception as e:
        logger.error("DC Generator error: %s", e, exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if tmp_cv:
            try:
                os.remove(tmp_cv)
            except Exception:
                pass


@dc_bp.route('/dc-generator/generate-stream', methods=['POST'])
@login_required
def dc_generator_generate_stream():
    """Génère le DC en streamant les étapes via SSE pour un retour en direct."""
    import queue as _queue
    import threading as _threading
    import json as _json

    uid = _uid()

    # Lire le fichier AVANT de déléguer au thread (le contexte request ne sera plus dispo)
    candidate_id = request.form.get('candidate_id')
    use_ollama   = request.form.get('use_ollama', 'auto')

    tmp_cv = None
    cv_filename = ''
    cv_ext = ''
    cv_size = 0
    if 'cv_file' in request.files and request.files['cv_file'].filename:
        cv_file = request.files['cv_file']
        cv_filename = cv_file.filename
        cv_ext = os.path.splitext(cv_filename)[1].lower()
        import tempfile as _tempfile
        fd, tmp_cv = _tempfile.mkstemp(suffix=cv_ext, prefix='cv_upload_')
        os.close(fd)
        cv_file.save(tmp_cv)
        cv_size = os.path.getsize(tmp_cv)

    q = _queue.Queue()
    _app_ctx = app.app_context()

    def do_work():
        _app_ctx.push()
        try:
            from utils.dossier_generator import DossierGenerator

            def log(msg, level='info'):
                q.put({'type': 'log', 'msg': msg, 'level': level})

            base_data = {}
            if candidate_id:
                with _conn() as conn:
                    row = conn.execute(
                        "SELECT * FROM candidates WHERE id=? AND owner_id=?", (candidate_id, uid)
                    ).fetchone()
                if row:
                    base_data = _safe_row_to_dict(row) or {}
                    _cname = base_data.get('name') or (
                        (base_data.get('prenom','') + ' ' + base_data.get('nom','')).strip()
                    ) or f'#{candidate_id}'
                    log(f"Candidat chargé : {_cname}")

            cv_data = {}
            cv_text = ''
            ollama_ok = False
            ollama_available = True

            if tmp_cv:
                size_ko = max(1, cv_size // 1024)
                log(f"Fichier reçu : {cv_filename} ({size_ko} ko)")

                if cv_ext == '.pdf':
                    log("Extraction texte PDF (PyMuPDF)…")
                    try:
                        import fitz as _fitz
                        _doc = _fitz.open(tmp_cv)
                        cv_text = '\n'.join(page.get_text() for page in _doc)
                        _doc.close()
                        log(f"✓ PDF extrait via PyMuPDF : {len(cv_text)} caractères")
                    except Exception as _e1:
                        log(f"⚠ PyMuPDF échoué : {_e1}", 'warn')

                    if not cv_text.strip():
                        log("Tentative extraction via pypdf…")
                        try:
                            from pypdf import PdfReader as _PdfReader
                            _reader = _PdfReader(tmp_cv)
                            cv_text = '\n'.join(page.extract_text() or '' for page in _reader.pages)
                            log(f"✓ PDF extrait via pypdf : {len(cv_text)} caractères")
                        except Exception as _e2:
                            log(f"✗ pypdf échoué : {_e2}", 'error')

                    if not cv_text.strip():
                        log("✗ Impossible d'extraire le texte du PDF", 'error')
                        q.put({'type': 'error', 'msg': "Impossible de lire le contenu du PDF. Essayez de convertir en DOCX."})
                        return

                elif cv_ext in ('.docx', '.doc'):
                    log("Extraction texte DOCX…")
                    try:
                        from docx import Document as _Docx
                        _doc = _Docx(tmp_cv)
                        cv_text = '\n'.join(p.text for p in _doc.paragraphs if p.text.strip())
                        log(f"✓ DOCX extrait : {len(cv_text)} caractères")
                    except Exception as _e:
                        log(f"✗ Extraction DOCX échouée : {_e}", 'error')

                if cv_text.strip() and use_ollama != 'no':
                    ai_cfg   = _load_ai_config()
                    ol_url   = ai_cfg.get('ollama_url', OLLAMA_URL)
                    ol_model = ai_cfg.get('ollama_model', OLLAMA_MODEL)
                    ol_timeout = max(300, int(ai_cfg.get('ollama_timeout') or OLLAMA_TIMEOUT))
                    log(f"Envoi à l'IA locale ({ol_model}, timeout={ol_timeout}s)… peut prendre 1-3 min")

                    try:
                        from utils.ollama_extractor import extract as _ollama_extract
                        extracted = _ollama_extract(cv_text, ol_url, ol_model, ol_timeout)
                        if extracted and (extracted.get('competences') or extracted.get('nom') or extracted.get('experiences')):
                            cv_data  = extracted
                            ollama_ok = True
                            missing  = extracted.get('_missing', [])
                            nc = len(extracted.get('competences') or [])
                            ne = len(extracted.get('experiences') or [])
                            log(f"✓ Extraction IA OK : {nc} compétences, {ne} expériences" +
                                (f" — champs manquants : {', '.join(missing)}" if missing else ""))
                        else:
                            log("⚠ L'IA a retourné une réponse vide ou illisible", 'warn')
                    except Exception as _oe:
                        log(f"✗ IA échouée : {_oe}", 'error')
                        ollama_available = False
                elif not cv_text.strip():
                    log("⚠ Pas de texte extrait — génération sans IA", 'warn')

                if not ollama_ok and cv_text.strip():
                    log("Extraction basique (nom/titre depuis premières lignes)…", 'warn')
                    import re as _re2
                    _lines = [l.strip() for l in cv_text.split('\n') if l.strip()][:20]
                    _nom = _prenom = _titre = _annees = ''
                    _caps = _re2.compile(r'^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ\s\-/–]{7,}$')
                    for _l in _lines[:8]:
                        if _caps.match(_l) and len(_l.split()) >= 2:
                            _titre = _l; break
                    _name_re = _re2.compile(
                        r'^([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][a-zàâäéèêëîïôùûüç]+(?:-[A-Za-zÀ-ÿ]+)*)'
                        r'\s+([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][A-Za-zÀ-ÿ\-]+)$')
                    for _l in _lines[:12]:
                        _m = _name_re.match(_l)
                        if _m:
                            _prenom, _nom = _m.group(1), _m.group(2).upper(); break
                    _ym = _re2.search(r"(\d+)\s*ans?\s+d['']expérience", cv_text[:2000], _re2.IGNORECASE)
                    if _ym:
                        _annees = _ym.group(1) + " ans d'expérience"
                    cv_data = {
                        'nom': _nom, 'prenom': _prenom,
                        'titre_poste': _titre, 'annees_experience': _annees,
                        'competences': [], 'experiences': [], 'formations': [],
                        'langues': [], 'certifications': [],
                    }
            else:
                log("Pas de CV fourni — données candidat uniquement")
                cv_data = {
                    'nom':               base_data.get('nom', base_data.get('name', '')),
                    'prenom':            base_data.get('prenom', ''),
                    'titre_poste':       base_data.get('titre', base_data.get('role', '')),
                    'annees_experience': '',
                    'competences': [], 'experiences': [],
                    'formations': [], 'langues': [], 'certifications': []
                }

            if base_data:
                for _k in ('nom', 'prenom', 'titre_poste', 'email', 'telephone'):
                    _v = base_data.get(_k, '')
                    if _v and str(_v).strip() and not cv_data.get(_k):
                        cv_data[_k] = str(_v).strip()
                if not cv_data.get('annees_experience'):
                    _yrs = base_data.get('annees_experience') or base_data.get('years_experience')
                    if _yrs:
                        cv_data['annees_experience'] = f"{_yrs} ans d'expérience"

            log("Génération du fichier DOCX…")
            timestamp   = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
            cid_str     = str(candidate_id) if candidate_id else 'standalone'
            nom_raw     = f"{cv_data.get('nom','candidat')} {cv_data.get('prenom','')}".strip()
            nom_clean   = re.sub(r'[^\w\-]', '_', nom_raw)
            output_path = os.path.join(
                str(APP_DIR), 'outputs', 'dossiers',
                f'{cid_str}_{nom_clean}_{timestamp}.docx'
            )
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            gen = DossierGenerator()
            gen.generate(cv_data, output_path)
            log("✓ DOCX généré")

            nom_dl  = f"Dossier_Up_{cv_data.get('nom','')}_{cv_data.get('prenom','')}.docx"
            gen_iso = datetime.datetime.now().isoformat()
            gen_id  = None
            with _conn() as conn:
                if candidate_id:
                    conn.execute(
                        "UPDATE candidates SET dossier_path=?, dossier_generated_at=? WHERE id=? AND owner_id=?",
                        (output_path, gen_iso, candidate_id, uid)
                    )
                try:
                    cur = conn.execute(
                        "INSERT INTO dc_generations (candidate_id, filename, file_path, used_ollama, generated_at, owner_id) "
                        "VALUES (?, ?, ?, ?, ?, ?);",
                        (int(candidate_id) if candidate_id else None,
                         nom_dl, output_path, 1 if ollama_ok else 0, gen_iso, uid)
                    )
                    gen_id = cur.lastrowid
                except Exception as _e:
                    logger.warning("DC stream: insert dc_generations failed: %s", _e)
                conn.commit()

            import urllib.parse as _urlparse
            missing_fields = cv_data.pop('_missing', []) if isinstance(cv_data, dict) else []
            q.put({
                'type':             'result',
                'success':          True,
                'id':               gen_id,
                'download_url':     '/dc-generator/download?path=' + _urlparse.quote(output_path, safe=''),
                'filename':         nom_dl,
                'generated_at':     datetime.datetime.now().strftime('%d/%m/%Y à %H:%M'),
                'used_ollama':      bool(ollama_ok),
                'ollama_available': bool(ollama_available),
                'missing_fields':   missing_fields,
            })

        except Exception as _ex:
            logger.error("DC stream error: %s", _ex, exc_info=True)
            q.put({'type': 'error', 'msg': str(_ex)})
        finally:
            if tmp_cv:
                try: os.remove(tmp_cv)
                except Exception: pass
            _app_ctx.pop()
            q.put(None)  # sentinelle fin de stream

    _threading.Thread(target=do_work, daemon=True).start()

    def _sse_generator():
        while True:
            item = q.get()
            if item is None:
                break
            yield f"data: {_json.dumps(item, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(_sse_generator()),
        content_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


@dc_bp.route('/api/dc/history', methods=['GET'])
@login_required
def api_dc_history():
    """Liste des DC générés par l'utilisateur (filtre optionnel par candidate_id)."""
    uid = _uid()
    cid_arg = request.args.get('candidate_id')
    limit = max(1, min(int(request.args.get('limit') or 50), 200))
    sql = (
        "SELECT g.id, g.candidate_id, g.filename, g.file_path, g.used_ollama, g.generated_at, "
        "       c.name AS candidate_name, c.role AS candidate_role "
        "FROM dc_generations g "
        "LEFT JOIN candidates c ON c.id = g.candidate_id AND c.owner_id = g.owner_id "
        "WHERE g.owner_id=? AND g.deleted_at IS NULL"
    )
    params = [uid]
    if cid_arg:
        try:
            sql += " AND g.candidate_id=?"
            params.append(int(cid_arg))
        except ValueError:
            pass
    sql += " ORDER BY g.generated_at DESC LIMIT ?"
    params.append(limit)
    items = []
    with _conn() as conn:
        for row in conn.execute(sql, tuple(params)).fetchall():
            d = dict(row)
            # File missing on disk → flag it but keep entry
            try:
                d['exists'] = bool(d.get('file_path')) and os.path.exists(d['file_path'])
            except Exception:
                d['exists'] = False
            d['used_ollama'] = bool(d.get('used_ollama'))
            # Format human date
            iso = d.get('generated_at') or ''
            try:
                _dt = datetime.datetime.fromisoformat(iso)
                d['generated_at_human'] = _dt.strftime('%d/%m/%Y à %H:%M')
            except Exception:
                d['generated_at_human'] = iso
            d['download_url'] = f"/api/dc/{d['id']}/download"
            items.append(d)
    return jsonify({'data': items, 'error': None})


@dc_bp.route('/api/dc/<int:gen_id>/download', methods=['GET'])
@login_required
def api_dc_download(gen_id):
    """Télécharge un DC généré par son id (sécurise via owner_id)."""
    uid = _uid()
    with _conn() as conn:
        row = conn.execute(
            "SELECT file_path, filename FROM dc_generations "
            "WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (gen_id, uid)
        ).fetchone()
    if not row:
        abort(404)
    file_path = row['file_path']
    if not file_path or '..' in file_path:
        abort(404)
    abs_path = os.path.abspath(file_path)
    allowed_dir = os.path.abspath(os.path.join(APP_DIR, 'outputs', 'dossiers'))
    if not abs_path.startswith(allowed_dir):
        abort(403)
    if not os.path.exists(abs_path):
        abort(404)
    nom = row['filename'] or os.path.basename(abs_path).replace('_', ' ')
    mime = ('application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            if abs_path.endswith('.docx') else 'application/pdf')
    return send_file(abs_path, as_attachment=True, download_name=nom, mimetype=mime)


@dc_bp.route('/api/dc/<int:gen_id>', methods=['DELETE'])
@login_required
def api_dc_delete(gen_id):
    """Soft-delete d'un DC généré + suppression du fichier physique si présent."""
    uid = _uid()
    now = datetime.datetime.now().isoformat()
    file_to_remove = None
    with _conn() as conn:
        row = conn.execute(
            "SELECT file_path FROM dc_generations WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (gen_id, uid)
        ).fetchone()
        if not row:
            return jsonify({'data': None, 'error': 'not_found'}), 404
        file_to_remove = row['file_path']
        conn.execute(
            "UPDATE dc_generations SET deleted_at=? WHERE id=? AND owner_id=?;",
            (now, gen_id, uid)
        )
        conn.commit()
    if file_to_remove:
        try:
            abs_path = os.path.abspath(file_to_remove)
            allowed_dir = os.path.abspath(os.path.join(APP_DIR, 'outputs', 'dossiers'))
            if abs_path.startswith(allowed_dir) and os.path.exists(abs_path):
                os.remove(abs_path)
        except Exception as _e:
            logger.warning("DC delete: physical remove failed: %s", _e)
    return jsonify({'data': {'id': gen_id, 'deleted': True}, 'error': None})


@dc_bp.route('/dc-generator/download')
@login_required
def dc_generator_download():
    import urllib.parse as _urlparse
    path = _urlparse.unquote(request.args.get('path', ''))
    if not path or '..' in path:
        abort(404)
    # Sécurité : le fichier doit être dans outputs/dossiers/
    abs_path = os.path.abspath(path)
    allowed_dir = os.path.abspath(os.path.join(APP_DIR, 'outputs', 'dossiers'))
    if not abs_path.startswith(allowed_dir):
        abort(403)
    if not os.path.exists(abs_path):
        abort(404)
    nom = os.path.basename(abs_path).replace('_', ' ')
    mime = ('application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            if abs_path.endswith('.docx') else 'application/pdf')
    return send_file(abs_path, as_attachment=True, download_name=nom, mimetype=mime)


@dc_bp.route('/candidates/<int:candidate_id>/dossier/download')
@login_required
def candidate_dossier_download(candidate_id):
    uid = _uid()
    with _conn() as conn:
        row = conn.execute(
            "SELECT dossier_path, nom, prenom, name FROM candidates WHERE id=? AND owner_id=?",
            (candidate_id, uid)
        ).fetchone()
    if not row or not row['dossier_path']:
        abort(404)
    abs_path = os.path.abspath(row['dossier_path'])
    if not os.path.exists(abs_path):
        abort(404)
    nom = row['nom'] or row['name'] or 'Candidat'
    prenom = row['prenom'] or ''
    ext = '.docx' if abs_path.endswith('.docx') else '.pdf'
    nom_dl = f"Dossier_Compétences_Up_{nom}_{prenom}{ext}"
    mime = ('application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            if ext == '.docx' else 'application/pdf')
    return send_file(abs_path, as_attachment=True, download_name=nom_dl, mimetype=mime)
