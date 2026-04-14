#!/usr/bin/env python3
"""
Extrait les logos Up Technologies depuis un dossier de compétences PDF existant.
Usage : python3 utils/extract_up_assets.py <chemin_vers_dossier_up.pdf>
"""
import sys, os
import pypdfium2 as pdfium

ASSETS_DIR = os.path.join(os.path.dirname(__file__), '..', 'static', 'up_assets')

def extract_logo_region(pdf_path, page_idx, crop_box, out_path):
    """crop_box = (x0_frac, y0_frac, x1_frac, y1_frac) fractions de la page"""
    pdf = pdfium.PdfDocument(pdf_path)
    pg  = pdf[page_idx]
    bm  = pg.render(scale=4)
    img = bm.to_pil()
    w, h = img.size
    x0, y0, x1, y1 = crop_box
    cropped = img.crop((int(w*x0), int(h*y0), int(w*x1), int(h*y1)))
    cropped.save(out_path)
    return os.path.getsize(out_path)

def main():
    if len(sys.argv) < 2:
        print("Usage : python3 utils/extract_up_assets.py <chemin_pdf>")
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print(f"Erreur : fichier introuvable : {pdf_path}")
        sys.exit(1)

    os.makedirs(ASSETS_DIR, exist_ok=True)

    header_path = os.path.join(ASSETS_DIR, 'up_logo_header.png')
    footer_path = os.path.join(ASSETS_DIR, 'up_logo_footer.png')

    # Coordonnées validées sur dossiers Up Technologies réels.
    # Header : serre bien le logo pour éviter d'attraper le texte sous le bandeau
    # (ex. « … génie électrique » du titre de document).
    size_h = extract_logo_region(pdf_path, 0, (0.55, 0.00, 1.00, 0.065), header_path)
    size_f = extract_logo_region(pdf_path, 0, (0.18, 0.882, 0.82, 1.000), footer_path)

    print(f"Logo header extrait : {header_path} ({size_h} octets)")
    print(f"Logo footer extrait : {footer_path} ({size_f} octets)")
    print(f"Assets prêts dans : {os.path.abspath(ASSETS_DIR)}")

if __name__ == '__main__':
    main()
