@echo off
title Piket Gerbang Guru (Port 3333) - SDN 1 Rejoso
color 0b

cd /d "%~dp0"

echo ====================================================================
echo   APLIKASI PIKET GERBANG GURU MANDIRI (PORT 3333)
echo   SD NEGERI 1 REJOSO
echo   Fitur: Dokumentasi Foto Piket, Jadwal Rotasi 2-3 Hari,
echo          Rekap Bulanan (.xlsx), Sinkron Google Drive, WhatsApp Fonnte
echo ====================================================================
echo.

set "NODE_EXE=node"
if exist "E:\RESTU DIGITAL\nodejs\node.exe" set "NODE_EXE=E:\RESTU DIGITAL\nodejs\node.exe"
if exist "%~dp0..\nodejs\node.exe" set "NODE_EXE=%~dp0..\nodejs\node.exe"

if exist "E:\RESTU DIGITAL\nodejs\node.exe" set "PATH=E:\RESTU DIGITAL\nodejs;%PATH%"

"%NODE_EXE%" -v >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js belum ditemukan di E:\RESTU DIGITAL\nodejs.
    pause
    exit /b 1
)

echo [1/3] Memeriksa kompilasi aplikasi...
if not exist "dist\index.html" (
    echo   Menyiapkan aplikasi frontend pertama kali...
    call "%~dp0..\nodejs\npm.cmd" run build
)

echo [2/3] Membuka browser ke http://localhost:3333 ...
start "" http://localhost:3333

echo [3/3] Menjalankan server mandiri Piket Gerbang...
echo.
call "%~dp0..\nodejs\npm.cmd" start

echo.
pause

