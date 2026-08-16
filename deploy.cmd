@echo off
setlocal EnableDelayedExpansion

REM ===========================================================================
REM  SeaBridge Founder OS - single-file deployment
REM
REM  The only requirement is Docker Desktop. Node.js, npm and Prisma are NOT
REM  needed - every build, migration and seed step runs inside a container.
REM
REM    deploy.cmd              deploy or update (safe to re-run)
REM    deploy.cmd reset        wipe the database and redeploy from scratch
REM    deploy.cmd noseed       deploy without inserting starter data
REM    deploy.cmd stop         stop the stack, keep all data
REM    deploy.cmd logs         follow container logs
REM    deploy.cmd status       show what is running
REM    deploy.cmd help
REM ===========================================================================

cd /d "%~dp0"

set "TMPOUT=%TEMP%\seabridge_deploy_%RANDOM%.log"
set "DO_SEED=1"
set "DO_RESET=0"
set "ACTION=deploy"

REM ------------------------------------------------------------- arguments
:parseargs
if "%~1"=="" goto argsdone
set "ARG=%~1"
REM strip a leading dash or slash so -reset, /reset and reset all work
if "!ARG:~0,1!"=="-" set "ARG=!ARG:~1!"
if "!ARG:~0,1!"=="-" set "ARG=!ARG:~1!"
if "!ARG:~0,1!"=="/" set "ARG=!ARG:~1!"
if /i "!ARG!"=="reset"  set "DO_RESET=1"      & goto nextarg
if /i "!ARG!"=="noseed" set "DO_SEED=0"       & goto nextarg
if /i "!ARG!"=="no-seed" set "DO_SEED=0"      & goto nextarg
if /i "!ARG!"=="stop"   set "ACTION=stop"     & goto nextarg
if /i "!ARG!"=="down"   set "ACTION=stop"     & goto nextarg
if /i "!ARG!"=="logs"   set "ACTION=logs"     & goto nextarg
if /i "!ARG!"=="status" set "ACTION=status"   & goto nextarg
if /i "!ARG!"=="ps"     set "ACTION=status"   & goto nextarg
if /i "!ARG!"=="help"   set "ACTION=help"     & goto nextarg
if /i "!ARG!"=="h"      set "ACTION=help"     & goto nextarg
if /i "!ARG!"=="?"      set "ACTION=help"     & goto nextarg
echo.
echo ERROR: unknown option "%~1"
echo Run "deploy.cmd help" to see the available options.
echo.
exit /b 1
:nextarg
shift
goto parseargs
:argsdone

if /i "%ACTION%"=="help" goto showhelp

REM ------------------------------------------------------------- docker checks
where docker >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: Docker is not installed.
  echo.
  echo Install Docker Desktop, then run this script again:
  echo   https://www.docker.com/products/docker-desktop/
  echo.
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: Docker is installed but the daemon is not running.
  echo.
  echo Start Docker Desktop and wait until the whale icon reports "Running",
  echo then run this script again.
  echo.
  exit /b 1
)

docker compose version >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: The Docker Compose v2 plugin is missing.
  echo Update Docker Desktop to a current version.
  echo.
  exit /b 1
)

REM ------------------------------------------------------------- side actions
if /i "%ACTION%"=="stop" (
  echo.
  echo Stopping SeaBridge...
  docker compose down
  echo.
  echo Stopped. Your data is preserved - run deploy.cmd to start again.
  echo.
  exit /b 0
)

if /i "%ACTION%"=="logs" (
  echo Following logs. Press Ctrl+C to stop.
  docker compose logs -f
  exit /b 0
)

if /i "%ACTION%"=="status" (
  echo.
  docker compose ps
  echo.
  exit /b 0
)

REM ------------------------------------------------------------- banner
echo.
echo ================================================
echo   SeaBridge Founder OS - Deployment
echo ================================================

REM ------------------------------------------------------------- 1. files
echo.
echo [1/7] Checking project files
for %%F in (docker-compose.yml .env.example) do (
  if not exist "%%F" (
    echo       ERROR: "%%F" not found.
    echo       Run deploy.cmd from inside the project folder.
    exit /b 1
  )
)
if not exist "apps\api\Dockerfile" (
  echo       ERROR: apps\api\Dockerfile not found - project folder looks incomplete.
  exit /b 1
)
echo       [OK] project files present

REM ------------------------------------------------------------- 2. .env
echo.
echo [2/7] Preparing configuration (.env)

if exist ".env" (
  echo       [OK] .env already exists - leaving it untouched
) else (
  REM Generate cryptographically strong secrets. PowerShell ships with Windows,
  REM so this keeps the script to a single file without needing Node.js.
  for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "$b=[byte[]]::new(32);[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b);$c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';-join($b^|%%{$c[$_ %% 62]})"`) do set "DBPASS=%%S"
  for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "$b=[byte[]]::new(64);[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b);$c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';-join($b^|%%{$c[$_ %% 62]})"`) do set "JWTSEC=%%S"

  if "!DBPASS!"=="" (
    echo       ERROR: could not generate a secure password.
    exit /b 1
  )

  REM Write .env as UTF-8 without BOM - a BOM breaks Compose variable parsing.
  powershell -NoProfile -Command ^
    "$t=Get-Content '.env.example' -Raw;" ^
    "$t=$t -replace '(?m)^POSTGRES_PASSWORD=.*','POSTGRES_PASSWORD=!DBPASS!';" ^
    "$t=$t -replace '(?m)^JWT_SECRET=.*','JWT_SECRET=!JWTSEC!';" ^
    "$t=$t -replace '(?m)^DATABASE_URL=.*','DATABASE_URL=postgresql://seabridge:!DBPASS!@localhost:5432/seabridge_erp';" ^
    "[System.IO.File]::WriteAllText((Join-Path $PWD '.env'),$t,(New-Object System.Text.UTF8Encoding($false)))"
  if errorlevel 1 (
    echo       ERROR: failed to create .env
    exit /b 1
  )
  echo       [OK] created .env with a random database password and JWT secret
  echo            stored only in .env, which is gitignored
)

REM ------------------------------------------------------------- 3. reset
echo.
echo [3/7] Checking existing data
if "%DO_RESET%"=="1" (
  echo       WARNING: this will PERMANENTLY DELETE the database and all its data.
  set /p "CONFIRM=      Type DELETE to confirm: "
  if /i not "!CONFIRM!"=="DELETE" (
    echo.
    echo       Cancelled - nothing was changed.
    echo.
    exit /b 1
  )
  docker compose down -v
  echo       [OK] database volume removed
) else (
  echo       [OK] keeping any existing data ^(use "deploy.cmd reset" to wipe^)
)

REM ------------------------------------------------------------- 4. build
echo.
echo [4/7] Building application images
echo       First run downloads base images - this can take 5-10 minutes.
docker compose build
if errorlevel 1 (
  echo.
  echo ERROR: image build failed. Scroll up for the compiler output.
  echo.
  exit /b 1
)
echo       [OK] images built

REM ------------------------------------------------------------- 5. database
echo.
echo [5/7] Starting the database
docker compose up -d postgres
if errorlevel 1 (
  echo ERROR: could not start PostgreSQL.
  exit /b 1
)

set "DBREADY=0"
<nul set /p "=      waiting for PostgreSQL"
for /l %%i in (1,1,60) do (
  if "!DBREADY!"=="0" (
    for /f "usebackq delims=" %%H in (`docker inspect --format "{{.State.Health.Status}}" seabridge-db 2^>nul`) do (
      if "%%H"=="healthy" set "DBREADY=1"
    )
    if "!DBREADY!"=="0" (
      <nul set /p "=."
      timeout /t 2 /nobreak >nul
    )
  )
)
echo.
if "!DBREADY!"=="0" (
  echo       ERROR: PostgreSQL did not become healthy within 120 seconds.
  echo       Check the logs with:  docker compose logs postgres
  exit /b 1
)
echo       [OK] PostgreSQL is accepting connections

REM The health check only proves the server is up, not that our password works.
REM A Postgres volume keeps the password it was created with, so changing
REM POSTGRES_PASSWORD in .env later causes confusing auth failures.
REM The $VARS below expand inside the container, so nothing is parsed here.
docker compose exec -T postgres sh -c "PGPASSWORD=$POSTGRES_PASSWORD psql -h 127.0.0.1 -U $POSTGRES_USER -d $POSTGRES_DB -c 'select 1'" >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: PostgreSQL is running but rejected the password in .env.
  echo.
  echo This happens when POSTGRES_PASSWORD was changed after the database
  echo volume was created - the volume keeps its original password.
  echo.
  echo Pick one:
  echo   1^) restore the original password in .env, or
  echo   2^) wipe the database and start fresh ^(DELETES ALL DATA^):
  echo          deploy.cmd reset
  echo.
  exit /b 1
)
echo       [OK] database credentials verified

REM ------------------------------------------------------------- 6. schema
echo.
echo [6/7] Applying the database schema

docker compose run --rm --no-deps -T api sh -c "cd /app/packages/database && npx prisma migrate deploy" >"%TMPOUT%" 2>&1
if not errorlevel 1 (
  echo       [OK] migrations applied
  goto seedstep
)

findstr /c:"P3005" /c:"schema is not empty" "%TMPOUT%" >nul 2>&1
if not errorlevel 1 (
  echo       [!] database has tables but no migration history
  echo           falling back to "prisma db push" ^(no data loss^)
  docker compose run --rm --no-deps -T api sh -c "cd /app/packages/database && npx prisma db push --skip-generate" >"%TMPOUT%" 2>&1
  if errorlevel 1 (
    type "%TMPOUT%"
    echo.
    echo ERROR: could not apply the schema.
    del "%TMPOUT%" >nul 2>&1
    exit /b 1
  )
  echo       [OK] schema synchronised with db push
  goto seedstep
)

findstr /c:"P3009" /c:"failed migrations" "%TMPOUT%" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo ERROR: a previous migration is recorded as FAILED, so Prisma stopped.
  echo This usually means an earlier deployment was interrupted.
  echo.
  echo If the database holds no data you need ^(DELETES ALL DATA^):
  echo     deploy.cmd reset
  echo.
  del "%TMPOUT%" >nul 2>&1
  exit /b 1
)

type "%TMPOUT%"
echo.
echo ERROR: migration failed. Output above.
del "%TMPOUT%" >nul 2>&1
exit /b 1

:seedstep
if "%DO_SEED%"=="1" (
  echo       seeding starter data ^(users, countries, currencies, Incoterms^)...
  docker compose run --rm --no-deps -T api sh -c "cd /app/packages/database && npx ts-node prisma/seed.ts" >"%TMPOUT%" 2>&1
  if errorlevel 1 (
    type "%TMPOUT%"
    echo       [!] seeding failed - the app will start but have no login user
  ) else (
    echo       [OK] seed complete ^(safe to re-run - it upserts^)
  )
) else (
  echo       skipped seeding ^(noseed^)
)
del "%TMPOUT%" >nul 2>&1

REM ------------------------------------------------------------- 7. start
echo.
echo [7/7] Starting the application
docker compose up -d
if errorlevel 1 (
  echo ERROR: could not start the application containers.
  exit /b 1
)
echo       [OK] containers started

set "APIUP=0"
<nul set /p "=      waiting for the API"
for /l %%i in (1,1,45) do (
  if "!APIUP!"=="0" (
    curl -fsS -m 3 http://localhost:4000/health >nul 2>&1
    if not errorlevel 1 (
      set "APIUP=1"
    ) else (
      <nul set /p "=."
      timeout /t 2 /nobreak >nul
    )
  )
)
echo.
if "!APIUP!"=="1" (
  echo       [OK] API is responding on /health
) else (
  echo       [!] API did not answer in 90s. Check with:  deploy.cmd logs
)

REM ------------------------------------------------------------- summary
echo.
echo ================================================
echo   Deployment complete
echo ================================================
echo.
echo   Open the app:   http://localhost:3000
echo   API health:     http://localhost:4000/health
echo.
if "%DO_SEED%"=="1" (
  echo   Sign in with:
  echo     founder@seabridge.com  /  admin123   ^(Founder - full access^)
  echo     hiren@seabridge.com    /  admin123   ^(Sales^)
  echo.
  echo   IMPORTANT: change BOTH passwords now - Settings -^> Profile -^> Change Password
  echo              These credentials are public in the source code.
  echo.
)
echo   Commands
echo     deploy.cmd            start / update
echo     deploy.cmd stop       stop, keeps data
echo     deploy.cmd status     what is running
echo     deploy.cmd logs       follow logs
echo     deploy.cmd reset      wipe data and start over
echo.

REM Keep the window open if launched by double-click.
echo %CMDCMDLINE% | find /i "/c" >nul
if not errorlevel 1 pause
exit /b 0

REM ------------------------------------------------------------- help
:showhelp
echo.
echo SeaBridge Founder OS - deployment
echo.
echo Usage:
echo   deploy.cmd              deploy or update (safe to re-run)
echo   deploy.cmd reset        wipe the database and redeploy from scratch
echo   deploy.cmd noseed       deploy without inserting starter data
echo   deploy.cmd stop         stop the stack, keep all data
echo   deploy.cmd logs         follow container logs
echo   deploy.cmd status       show what is running
echo   deploy.cmd help         this message
echo.
echo Requires only Docker Desktop. Node.js is not needed.
echo.
exit /b 0
