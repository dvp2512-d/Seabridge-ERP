@echo off
setlocal enabledelayedexpansion

:: ============================================================================
:: SeaBridge ERP Database Backup Script
:: ============================================================================
:: Creates timestamped PostgreSQL backups with optional S3 upload
::
:: Usage:
::   backup.cmd              - Create local backup
::   backup.cmd s3           - Create backup and upload to S3
::   backup.cmd restore FILE - Restore from a backup file
::   backup.cmd list         - List available backups
::   backup.cmd clean DAYS   - Remove backups older than DAYS
:: ============================================================================

set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%.."
set "BACKUP_DIR=%ROOT_DIR%\backups"
set "TIMESTAMP=%DATE:~10,4%%DATE:~4,2%%DATE:~7,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"
set "TIMESTAMP=%TIMESTAMP: =0%"

:: Load environment from .env if it exists
if exist "%ROOT_DIR%\.env" (
    for /f "usebackq tokens=1,2 delims==" %%a in ("%ROOT_DIR%\.env") do (
        if not "%%a"=="" if not "%%a:~0,1%"=="#" (
            set "%%a=%%b"
        )
    )
)

:: Default values
if "%POSTGRES_USER%"=="" set "POSTGRES_USER=seabridge"
if "%POSTGRES_DB%"=="" set "POSTGRES_DB=seabridge_erp"
if "%BACKUP_RETENTION_DAYS%"=="" set "BACKUP_RETENTION_DAYS=30"
if "%S3_BUCKET%"=="" set "S3_BUCKET="

:: Create backup directory if it doesn't exist
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

:: Parse command
set "COMMAND=%~1"
if "%COMMAND%"=="" set "COMMAND=backup"

if /i "%COMMAND%"=="s3" goto :backup_s3
if /i "%COMMAND%"=="restore" goto :restore
if /i "%COMMAND%"=="list" goto :list
if /i "%COMMAND%"=="clean" goto :clean
goto :backup

:: ============================================================================
:backup
:: ============================================================================
echo.
echo ============================================
echo   SeaBridge ERP Database Backup
echo ============================================
echo.

set "BACKUP_FILE=%BACKUP_DIR%\seabridge_%TIMESTAMP%.sql.gz"

echo [1/3] Checking database connection...
docker exec seabridge-db pg_isready -U %POSTGRES_USER% -d %POSTGRES_DB% >nul 2>&1
if errorlevel 1 (
    echo ERROR: Database is not running. Start with: docker compose up -d postgres
    exit /b 1
)
echo      Database is ready.

echo [2/3] Creating backup...
docker exec seabridge-db pg_dump -U %POSTGRES_USER% -d %POSTGRES_DB% --no-owner --no-acl | gzip > "%BACKUP_FILE%" 2>nul
if errorlevel 1 (
    :: Try without gzip if gzip not available
    set "BACKUP_FILE=%BACKUP_DIR%\seabridge_%TIMESTAMP%.sql"
    docker exec seabridge-db pg_dump -U %POSTGRES_USER% -d %POSTGRES_DB% --no-owner --no-acl > "!BACKUP_FILE!"
    if errorlevel 1 (
        echo ERROR: Backup failed.
        exit /b 1
    )
)

:: Get file size
for %%A in ("%BACKUP_FILE%") do set "SIZE=%%~zA"
set /a "SIZE_KB=%SIZE% / 1024"

echo [3/3] Backup complete!
echo.
echo      File: %BACKUP_FILE%
echo      Size: %SIZE_KB% KB
echo.
echo To restore: backup.cmd restore "%BACKUP_FILE%"
goto :eof

:: ============================================================================
:backup_s3
:: ============================================================================
:: First create local backup
call :backup
if errorlevel 1 exit /b 1

echo.
echo [4/4] Uploading to S3...

if "%S3_BUCKET%"=="" (
    echo WARNING: S3_BUCKET not set in .env - skipping S3 upload
    echo          Set S3_BUCKET=your-bucket-name to enable cloud backup
    goto :eof
)

aws s3 cp "%BACKUP_FILE%" "s3://%S3_BUCKET%/seabridge-erp/backups/" --storage-class STANDARD_IA
if errorlevel 1 (
    echo WARNING: S3 upload failed. Local backup is still available.
) else (
    echo      Uploaded to s3://%S3_BUCKET%/seabridge-erp/backups/
)
goto :eof

:: ============================================================================
:restore
:: ============================================================================
set "RESTORE_FILE=%~2"

if "%RESTORE_FILE%"=="" (
    echo Usage: backup.cmd restore ^<backup-file^>
    echo.
    echo Available backups:
    call :list
    exit /b 1
)

if not exist "%RESTORE_FILE%" (
    :: Try looking in backup directory
    set "RESTORE_FILE=%BACKUP_DIR%\%~2"
    if not exist "!RESTORE_FILE!" (
        echo ERROR: Backup file not found: %~2
        exit /b 1
    )
)

echo.
echo ============================================
echo   SeaBridge ERP Database Restore
echo ============================================
echo.
echo WARNING: This will OVERWRITE the current database!
echo File: %RESTORE_FILE%
echo.
set /p "CONFIRM=Type DELETE to confirm: "
if /i not "%CONFIRM%"=="DELETE" (
    echo Restore cancelled.
    exit /b 0
)

echo.
echo [1/3] Stopping API to prevent writes...
docker compose stop api >nul 2>&1

echo [2/3] Restoring database...
:: Check if file is gzipped
echo %RESTORE_FILE% | findstr /i ".gz" >nul
if errorlevel 1 (
    :: Plain SQL file
    docker exec -i seabridge-db psql -U %POSTGRES_USER% -d %POSTGRES_DB% < "%RESTORE_FILE%"
) else (
    :: Gzipped file
    gzip -dc "%RESTORE_FILE%" | docker exec -i seabridge-db psql -U %POSTGRES_USER% -d %POSTGRES_DB%
)

if errorlevel 1 (
    echo ERROR: Restore failed.
    docker compose start api >nul 2>&1
    exit /b 1
)

echo [3/3] Restarting API...
docker compose start api >nul 2>&1

echo.
echo Restore complete!
goto :eof

:: ============================================================================
:list
:: ============================================================================
echo.
echo Available backups in %BACKUP_DIR%:
echo.
if exist "%BACKUP_DIR%\*.sql*" (
    for %%F in ("%BACKUP_DIR%\*.sql*") do (
        set "FNAME=%%~nxF"
        set "FSIZE=%%~zF"
        set /a "FSIZE_KB=!FSIZE! / 1024"
        echo   !FNAME! ^(!FSIZE_KB! KB^)
    )
) else (
    echo   No backups found.
)
echo.
goto :eof

:: ============================================================================
:clean
:: ============================================================================
set "DAYS=%~2"
if "%DAYS%"=="" set "DAYS=%BACKUP_RETENTION_DAYS%"

echo.
echo Removing backups older than %DAYS% days...
echo.

:: Use PowerShell for date comparison
powershell -Command "Get-ChildItem '%BACKUP_DIR%\*.sql*' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-%DAYS%) } | ForEach-Object { Write-Host ('Removing: ' + $_.Name); Remove-Item $_.FullName }"

echo.
echo Cleanup complete.
goto :eof
