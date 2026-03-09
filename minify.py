#!/usr/bin/env python3
"""Minify CSS and JS static assets for ProspUp.

Usage:
    python minify.py          # Minify all assets
    python minify.py --check  # Report size savings without writing

Requires: pip install rjsmin csscompressor
"""
from __future__ import annotations

import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
CSS_DIR = APP_DIR / "static" / "css"
JS_DIR = APP_DIR / "static" / "js"


def _minify_css(src: str) -> str:
    import csscompressor
    return csscompressor.compress(src)


def _minify_js(src: str) -> str:
    import rjsmin
    return rjsmin.jsmin(src)


def main():
    check_only = "--check" in sys.argv
    total_before = 0
    total_after = 0

    # CSS files
    for css_file in sorted(CSS_DIR.glob("*.css")):
        if css_file.name.endswith(".min.css"):
            continue
        src = css_file.read_text(encoding="utf-8")
        minified = _minify_css(src)
        before = len(src.encode("utf-8"))
        after = len(minified.encode("utf-8"))
        total_before += before
        total_after += after
        pct = (1 - after / before) * 100 if before else 0
        out = css_file.with_suffix(".min.css")
        print(f"  CSS {css_file.name}: {before:,}B -> {after:,}B (-{pct:.0f}%)")
        if not check_only:
            out.write_text(minified, encoding="utf-8")

    # JS files
    for js_file in sorted(JS_DIR.glob("*.js")):
        if js_file.name.endswith(".min.js"):
            continue
        src = js_file.read_text(encoding="utf-8")
        minified = _minify_js(src)
        before = len(src.encode("utf-8"))
        after = len(minified.encode("utf-8"))
        total_before += before
        total_after += after
        pct = (1 - after / before) * 100 if before else 0
        out = js_file.with_suffix(".min.js")
        print(f"  JS  {js_file.name}: {before:,}B -> {after:,}B (-{pct:.0f}%)")
        if not check_only:
            out.write_text(minified, encoding="utf-8")

    pct_total = (1 - total_after / total_before) * 100 if total_before else 0
    print(f"\nTotal: {total_before:,}B -> {total_after:,}B (-{pct_total:.0f}%)")
    if check_only:
        print("(dry run — no files written)")
    else:
        print("Minified files written (.min.css / .min.js)")


if __name__ == "__main__":
    main()
