@echo off
echo ========================================
echo   JavaScript Obfuscation Script
echo ========================================
echo.

REM Check if javascript-obfuscator is installed
where javascript-obfuscator >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] javascript-obfuscator is not installed!
    echo.
    echo Installing javascript-obfuscator...
    npm install -g javascript-obfuscator
    echo.
)

echo [1/3] Obfuscating app.js...
javascript-obfuscator static/app.js --output static/app.min.js --compact true --control-flow-flattening true --dead-code-injection true --string-array true --string-array-encoding base64 --self-defending true

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] app.js obfuscated successfully!
    echo Output: static/app.min.js
) else (
    echo [ERROR] Failed to obfuscate app.js
    pause
    exit /b 1
)

echo.
echo [2/3] Checking for other JS files...

if exist static\auth.js (
    echo Obfuscating auth.js...
    javascript-obfuscator static/auth.js --output static/auth.min.js --compact true --control-flow-flattening true --dead-code-injection true --string-array true --string-array-encoding base64
)

if exist static\theme.js (
    echo Obfuscating theme.js...
    javascript-obfuscator static/theme.js --output static/theme.min.js --compact true --control-flow-flattening true --dead-code-injection true --string-array true --string-array-encoding base64
)

echo.
echo [3/3] Creating backup of original files...
if not exist static\backup mkdir static\backup
copy static\app.js static\backup\app.js.bak >nul 2>nul

echo.
echo ========================================
echo   Obfuscation Complete!
echo ========================================
echo.
echo Next steps:
echo 1. Update your HTML files to use .min.js files
echo 2. Test the application
echo 3. Deploy to production
echo.
echo Original files backed up to: static\backup\
echo.
pause
