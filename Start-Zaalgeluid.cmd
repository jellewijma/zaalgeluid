@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Zaalgeluid - lokale server

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is niet gevonden.
    echo Installeer Node.js LTS via https://nodejs.org/ en start dit bestand opnieuw.
    pause
    exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo npm is niet gevonden. Installeer Node.js LTS opnieuw en probeer het nogmaals.
    pause
    exit /b 1
)

if not exist "package.json" (
    echo package.json ontbreekt. Plaats dit startbestand in de map van Zaalgeluid.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Benodigde pakketten installeren. Hiervoor is internet nodig.
    call npm.cmd install
    if errorlevel 1 (
        echo Installeren is niet gelukt. Controleer de melding hierboven.
        pause
        exit /b 1
    )
)

echo Zaalgeluid voorbereiden...
call npm.cmd run build
if errorlevel 1 (
    echo Bouwen is niet gelukt. Controleer de melding hierboven.
    pause
    exit /b 1
)

if not defined PORT set "PORT=3000"
echo.
echo Houd dit venster open zolang je Zaalgeluid gebruikt.
echo Open na het starten op deze pc: http://localhost:%PORT%/player
echo Gebruik de QR-code op de afspeler om je tablet te verbinden.
echo Stoppen kan met Ctrl+C.
echo.
call npm.cmd start
if errorlevel 1 (
    echo.
    echo De server is gestopt met een fout. Controleer de melding hierboven.
    pause
    exit /b 1
)
endlocal
