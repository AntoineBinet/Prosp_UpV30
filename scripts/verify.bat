@echo off
REM Script de vérification complète pour agent local Cursor
REM Usage: verify.bat
REM Exit code: 0 si tout OK, 1-6 si erreur

python scripts\verify_all.py
exit /b %ERRORLEVEL%
