# SeaBridge ERP - PowerShell Deployment Script
# Usage: .\deploy.ps1 [reset|stop|logs|status]

param(
    [string]$Action = "deploy"
)

$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  SeaBridge Founder OS - Deployment" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Working directory: $ProjectRoot" -ForegroundColor Gray

# Check Docker
Write-Host ""
Write-Host "[1/7] Checking Docker..." -ForegroundColor Yellow
$dockerCheck = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker is not running. Start Docker Desktop first." -ForegroundColor Red
    Write-Host $dockerCheck -ForegroundColor Red
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

# Check project files
Write-Host ""
Write-Host "[2/7] Checking project files..." -ForegroundColor Yellow

$envExample = Join-Path $ProjectRoot ".env.example"
$envFile = Join-Path $ProjectRoot ".env"
$dockerCompose = Join-Path $ProjectRoot "docker-compose.yml"

if (-not (Test-Path $dockerCompose)) {
    Write-Host "ERROR: docker-compose.yml not found at $dockerCompose" -ForegroundColor Red
    exit 1
}
Write-Host "      [OK] docker-compose.yml found" -ForegroundColor Green

if (-not (Test-Path $envExample)) {
    Write-Host "ERROR: .env.example not found at $envExample" -ForegroundColor Red
    exit 1
}
Write-Host "      [OK] .env.example found" -ForegroundColor Green

# Check/Create .env
Write-Host ""
Write-Host "[3/7] Checking configuration (.env)..." -ForegroundColor Yellow

if (-not (Test-Path $envFile)) {
    Write-Host "      Creating .env with secure credentials..." -ForegroundColor Yellow
    
    # Generate secure passwords
    $chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    $dbPass = -join (1..32 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    $jwtSecret = -join (1..48 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    
    # Read template
    $content = [System.IO.File]::ReadAllText($envExample)
    
    # Replace placeholders
    $content = $content -replace 'POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$dbPass"
    $content = $content -replace 'JWT_SECRET=.*', "JWT_SECRET=$jwtSecret"
    $content = $content -replace 'DATABASE_URL=.*', "DATABASE_URL=postgresql://seabridge:$dbPass@localhost:5432/seabridge_erp"
    
    # Write without BOM
    [System.IO.File]::WriteAllText($envFile, $content, [System.Text.UTF8Encoding]::new($false))
    
    Write-Host "      [OK] Created .env with secure credentials" -ForegroundColor Green
    Write-Host "      Database Password: $dbPass" -ForegroundColor Gray
} else {
    # Check for placeholder values
    $envContent = [System.IO.File]::ReadAllText($envFile)
    if ($envContent -match "CHANGE_ME") {
        Write-Host "      ERROR: .env contains CHANGE_ME placeholders" -ForegroundColor Red
        Write-Host "      Delete .env and run again to generate secure values" -ForegroundColor Red
        exit 1
    }
    Write-Host "      [OK] .env exists with valid values" -ForegroundColor Green
}

# Build
Write-Host ""
Write-Host "[4/7] Building images (this may take a few minutes)..." -ForegroundColor Yellow
docker compose build 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "      [OK] Images built" -ForegroundColor Green

# Start PostgreSQL
Write-Host ""
Write-Host "[5/7] Starting PostgreSQL..." -ForegroundColor Yellow
docker compose up -d postgres 2>&1
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
    Write-Host "      Attempt $attempts/$maxAttempts..." -ForegroundColor Gray
}
if ($attempts -ge $maxAttempts) {
    Write-Host "ERROR: PostgreSQL did not become ready" -ForegroundColor Red
    exit 1
}
Write-Host "      [OK] PostgreSQL is ready" -ForegroundColor Green

# Run migrations
Write-Host ""
Write-Host "[6/7] Running database migrations..." -ForegroundColor Yellow
$migrateResult = docker compose run --rm --no-deps api sh -c "cd /app/packages/database && npx prisma migrate deploy" 2>&1
Write-Host $migrateResult
if ($LASTEXITCODE -ne 0) {
    Write-Host "      Migration failed, trying db push..." -ForegroundColor Yellow
    docker compose run --rm --no-deps api sh -c "cd /app/packages/database && npx prisma db push" 2>&1
}
Write-Host "      [OK] Database schema ready" -ForegroundColor Green

# Seed
Write-Host ""
Write-Host "[6b/7] Seeding initial data..." -ForegroundColor Yellow
$seedResult = docker compose run --rm --no-deps api sh -c "cd /app/packages/database && npx ts-node prisma/seed.ts" 2>&1
Write-Host $seedResult
Write-Host "      [OK] Seed complete" -ForegroundColor Green

# Start all services
Write-Host ""
Write-Host "[7/7] Starting all services..." -ForegroundColor Yellow
docker compose up -d 2>&1
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
    } catch {
        # Ignore errors, keep trying
    }
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
