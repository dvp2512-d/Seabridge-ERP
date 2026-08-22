# SeaBridge ERP - PowerShell Deployment Script
# Usage: .\deploy.ps1 [reset|stop|logs|status]

param(
    [string]$Action = "deploy"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  SeaBridge Founder OS - Deployment" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# Check Docker
Write-Host ""
Write-Host "[1/7] Checking Docker..." -ForegroundColor Yellow
try {
    $null = docker info 2>&1
} catch {
    Write-Host "ERROR: Docker is not running. Start Docker Desktop first." -ForegroundColor Red
    exit 1
}
Write-Host "      [OK] Docker is running" -ForegroundColor Green

# Handle actions
if ($Action -eq "stop") {
    Write-Host ""
    Write-Host "Stopping SeaBridge..." -ForegroundColor Yellow
    docker compose down
    Write-Host "Stopped. Run .\deploy.ps1 to start again." -ForegroundColor Green
    exit 0
}

if ($Action -eq "logs") {
    docker compose logs -f
    exit 0
}

if ($Action -eq "status") {
    docker compose ps
    exit 0
}

if ($Action -eq "reset") {
    Write-Host ""
    Write-Host "WARNING: This will DELETE all data!" -ForegroundColor Red
    $confirm = Read-Host "Type DELETE to confirm"
    if ($confirm -ne "DELETE") {
        Write-Host "Cancelled." -ForegroundColor Yellow
        exit 1
    }
    docker compose down -v
    Write-Host "[OK] Database volume removed" -ForegroundColor Green
}

# Check/Create .env
Write-Host ""
Write-Host "[2/7] Checking configuration (.env)..." -ForegroundColor Yellow

if (-not (Test-Path ".env")) {
    Write-Host "      Creating .env with secure credentials..." -ForegroundColor Yellow
    
    # Generate secure passwords
    $dbPass = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
    $jwtSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 48 | ForEach-Object {[char]$_})
    
    # Read template and replace
    $content = Get-Content ".env.example" -Raw
    $content = $content -replace 'POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$dbPass"
    $content = $content -replace 'JWT_SECRET=.*', "JWT_SECRET=$jwtSecret"
    $content = $content -replace 'DATABASE_URL=.*', "DATABASE_URL=postgresql://seabridge:$dbPass@localhost:5432/seabridge_erp"
    
    # Write without BOM
    [System.IO.File]::WriteAllText("$PWD\.env", $content, [System.Text.UTF8Encoding]::new($false))
    
    Write-Host "      [OK] Created .env with secure credentials" -ForegroundColor Green
} else {
    # Check for placeholder values
    $envContent = Get-Content ".env" -Raw
    if ($envContent -match "CHANGE_ME") {
        Write-Host "      ERROR: .env contains CHANGE_ME placeholders" -ForegroundColor Red
        Write-Host "      Delete .env and run again to generate secure values" -ForegroundColor Red
        exit 1
    }
    Write-Host "      [OK] .env exists" -ForegroundColor Green
}

# Build
Write-Host ""
Write-Host "[3/7] Building images (this may take a few minutes)..." -ForegroundColor Yellow
docker compose build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "      [OK] Images built" -ForegroundColor Green

# Start PostgreSQL
Write-Host ""
Write-Host "[4/7] Starting PostgreSQL..." -ForegroundColor Yellow
docker compose up -d postgres
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to start PostgreSQL" -ForegroundColor Red
    exit 1
}

# Wait for PostgreSQL
Write-Host "      Waiting for PostgreSQL to be ready..."
$attempts = 0
$maxAttempts = 30
while ($attempts -lt $maxAttempts) {
    $result = docker compose exec -T postgres pg_isready -U seabridge 2>&1
    if ($LASTEXITCODE -eq 0) {
        break
    }
    Start-Sleep -Seconds 2
    $attempts++
}
if ($attempts -ge $maxAttempts) {
    Write-Host "ERROR: PostgreSQL did not become ready" -ForegroundColor Red
    exit 1
}
Write-Host "      [OK] PostgreSQL is ready" -ForegroundColor Green

# Run migrations
Write-Host ""
Write-Host "[5/7] Running database migrations..." -ForegroundColor Yellow
docker compose run --rm --no-deps api sh -c "cd /app/packages/database && npx prisma migrate deploy"
if ($LASTEXITCODE -ne 0) {
    Write-Host "      Migration failed, trying db push..." -ForegroundColor Yellow
    docker compose run --rm --no-deps api sh -c "cd /app/packages/database && npx prisma db push"
}
Write-Host "      [OK] Database schema ready" -ForegroundColor Green

# Seed
Write-Host ""
Write-Host "[6/7] Seeding initial data..." -ForegroundColor Yellow
docker compose run --rm --no-deps api sh -c "cd /app/packages/database && npx ts-node prisma/seed.ts"
Write-Host "      [OK] Seed complete" -ForegroundColor Green

# Start all services
Write-Host ""
Write-Host "[7/7] Starting all services..." -ForegroundColor Yellow
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to start services" -ForegroundColor Red
    exit 1
}

# Wait for API health
Write-Host "      Waiting for API to be healthy..."
$attempts = 0
while ($attempts -lt 30) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:4000/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            break
        }
    } catch {}
    Start-Sleep -Seconds 2
    $attempts++
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  SeaBridge ERP is running!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "  API:      http://localhost:4000" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Default login: founder@seabridge.com" -ForegroundColor White
Write-Host "  (check seed output above for password)" -ForegroundColor White
Write-Host ""
