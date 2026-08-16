<#
.SYNOPSIS
    Post-deployment smoke test for SeaBridge Founder OS.

.DESCRIPTION
    Exercises the full business flow against a running instance:
    login -> buyer -> product -> quotation -> order -> invoice -> payment,
    plus PDF generation and the security checks.

    Run this after .\deploy.ps1 to confirm the deployment actually works.
    It creates real records, so prefer running it on a fresh/test database.

.EXAMPLE
    .\scripts\smoke-test.ps1

.EXAMPLE
    .\scripts\smoke-test.ps1 -BaseUrl http://localhost:4000 -Password admin123
#>
[CmdletBinding()]
param(
    [string]$BaseUrl  = 'http://localhost:4000',
    [string]$Email    = 'founder@seabridge.com',
    [string]$Password = 'admin123'
)

$ErrorActionPreference = 'Stop'
$API = "$BaseUrl/api"
$script:Failures = 0

function Write-Pass { param($m) Write-Host "  [PASS] $m" -ForegroundColor Green }
function Write-Fail { param($m) $script:Failures++; Write-Host "  [FAIL] $m" -ForegroundColor Red }
function Write-Head { param($m) Write-Host ""; Write-Host $m -ForegroundColor Cyan }

Write-Host ""
Write-Host "SeaBridge smoke test against $BaseUrl" -ForegroundColor White
Write-Host "=======================================================" -ForegroundColor White

# ---------------------------------------------------------------- health
Write-Head "Health"
try {
    $h = Invoke-RestMethod "$BaseUrl/health" -TimeoutSec 10
    if ($h.status -eq 'ok') { Write-Pass "API healthy" } else { Write-Fail "unexpected health payload" }
} catch { Write-Fail "API unreachable at $BaseUrl - is it running?"; Write-Host ""; exit 1 }

# ---------------------------------------------------------------- auth
Write-Head "Authentication"
try {
    $body  = @{ email = $Email; password = $Password } | ConvertTo-Json
    $login = Invoke-RestMethod "$API/auth/login" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 15
    $token = $login.data.token
    if ($token) { Write-Pass "logged in as $($login.data.user.email) ($($login.data.user.role))" }
    else { Write-Fail "no token returned"; exit 1 }
} catch { Write-Fail "login failed - was the database seeded?"; Write-Host ""; exit 1 }

$H = @{ Authorization = "Bearer $token" }
function ApiGet  { param($p) Invoke-RestMethod "$API$p" -Headers $H -TimeoutSec 20 }
function ApiPost { param($p,$o) Invoke-RestMethod "$API$p" -Method Post -Headers $H -Body ($o | ConvertTo-Json -Depth 8) -ContentType 'application/json' -TimeoutSec 20 }

try {
    Invoke-WebRequest "$API/buyers" -UseBasicParsing -TimeoutSec 10 | Out-Null
    Write-Fail "unauthenticated request was ACCEPTED - security problem"
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 401) { Write-Pass "unauthenticated requests rejected with 401" }
    else { Write-Fail "expected 401, got $($_.Exception.Response.StatusCode.value__)" }
}

# ---------------------------------------------------------------- reference data
Write-Head "Master data"
$d = (ApiGet "/master/dropdowns").data
$country  = $d.countries        | Select-Object -First 1
$currency = $d.currencies       | Where-Object { $_.code -eq 'USD' } | Select-Object -First 1
$incoterm = $d.incoterms        | Select-Object -First 1
$category = $d.productCategories| Select-Object -First 1
if ($country -and $currency -and $incoterm -and $category) {
    Write-Pass "countries/currencies/incoterms/categories present"
} else { Write-Fail "master data incomplete - run the seed"; exit 1 }

# ---------------------------------------------------------------- flow
$stamp = Get-Date -Format 'HHmmss'

Write-Head "Business flow"
$buyer = (ApiPost "/buyers" @{
    companyName = "Smoke Test Buyer $stamp"
    countryId   = $country.id
    currencyId  = $currency.id
    email       = "smoke$stamp@example.test"
    city        = "Dubai"
}).data
if ($buyer.code) { Write-Pass "buyer created: $($buyer.code)" } else { Write-Fail "buyer not created" }

$product = (ApiPost "/products" @{
    name       = "Smoke Test Product $stamp"
    categoryId = $category.id
    unit       = "MT"
}).data
if ($product.code) { Write-Pass "product created: $($product.code)" } else { Write-Fail "product not created" }

$quote = (ApiPost "/quotations" @{
    buyerId = $buyer.id; currencyId = $currency.id; incotermId = $incoterm.id
    validUntil = (Get-Date).AddDays(30).ToString('yyyy-MM-dd')
    items = @(@{ productId = $product.id; quantity = 10; unit = "MT"; unitCost = 800; unitPrice = 1000 })
    costs = @(@{ costType = "CHA"; description = "Customs clearance"; amount = 500 })
}).data

# 10 x 1000 = 10000 revenue; cost 10 x 800 + 500 = 8500; margin = 15%
if ([math]::Abs([double]$quote.subtotal - 10000) -lt 0.01) { Write-Pass "quotation subtotal correct (10000)" }
else { Write-Fail "quotation subtotal was $($quote.subtotal), expected 10000" }
if ([math]::Abs([double]$quote.totalCost - 8500) -lt 0.01) { Write-Pass "quotation cost includes additional costs (8500)" }
else { Write-Fail "quotation cost was $($quote.totalCost), expected 8500" }
if ([math]::Abs([double]$quote.marginPercent - 15) -lt 0.05) { Write-Pass "margin calculated correctly (15%)" }
else { Write-Fail "margin was $($quote.marginPercent)%, expected 15%" }

Invoke-RestMethod "$API/quotations/$($quote.id)/status" -Method Patch -Headers $H `
    -Body '{"status":"ACCEPTED"}' -ContentType 'application/json' -TimeoutSec 20 | Out-Null
Write-Pass "quotation accepted"

$order = (ApiPost "/quotations/$($quote.id)/convert-to-order" @{
    expectedDeliveryDate = (Get-Date).AddDays(45).ToString('yyyy-MM-dd')
    poNumber             = "PO-SMOKE-$stamp"
}).data
if ($order.orderNumber) { Write-Pass "order created: $($order.orderNumber)" } else { Write-Fail "order not created" }
if ($order.currency -eq $currency.code) { Write-Pass "order kept the quotation currency ($($order.currency))" }
else { Write-Fail "order currency was '$($order.currency)', expected '$($currency.code)'" }
if ($order.documents.Count -ge 5) { Write-Pass "document checklist created ($($order.documents.Count) items)" }
else { Write-Fail "expected >=5 checklist documents, got $($order.documents.Count)" }

try {
    ApiPost "/quotations/$($quote.id)/convert-to-order" @{} | Out-Null
    Write-Fail "a second order was allowed from the same quotation"
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 409) { Write-Pass "duplicate order conversion blocked (409)" }
    else { Write-Fail "expected 409, got $($_.Exception.Response.StatusCode.value__)" }
}

$invoice = (ApiPost "/invoices" @{
    orderId = $order.id
    dueDate = (Get-Date).AddDays(30).ToString('yyyy-MM-dd')
    type    = "EXPORT"
}).data
if ($invoice.invoiceNumber) { Write-Pass "invoice created: $($invoice.invoiceNumber)" } else { Write-Fail "invoice not created" }

ApiPost "/invoices/$($invoice.id)/payments" @{
    amount = 4000; paymentDate = (Get-Date).ToString('yyyy-MM-dd')
    paymentMode = "WIRE_TRANSFER"; reference = "TT-SMOKE-$stamp"
} | Out-Null
$after = (ApiGet "/invoices/$($invoice.id)").data
if ($after.status -eq 'PARTIALLY_PAID') { Write-Pass "partial payment set status PARTIALLY_PAID" }
else { Write-Fail "status was '$($after.status)', expected PARTIALLY_PAID" }
if ([math]::Abs([double]$after.balanceAmount - 6000) -lt 0.01) { Write-Pass "balance reduced correctly (6000)" }
else { Write-Fail "balance was $($after.balanceAmount), expected 6000" }

try {
    ApiPost "/invoices/$($invoice.id)/payments" @{
        amount = 9999999; paymentDate = (Get-Date).ToString('yyyy-MM-dd'); paymentMode = "WIRE_TRANSFER"
    } | Out-Null
    Write-Fail "overpayment was accepted"
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 400) { Write-Pass "overpayment rejected (400)" }
    else { Write-Fail "expected 400, got $($_.Exception.Response.StatusCode.value__)" }
}

# ---------------------------------------------------------------- pdfs
Write-Head "PDF generation"
foreach ($item in @(@{n='quotation';u="/quotations/$($quote.id)/pdf"}, @{n='invoice';u="/invoices/$($invoice.id)/pdf"})) {
    $r = Invoke-WebRequest "$API$($item.u)" -Headers $H -UseBasicParsing -TimeoutSec 30
    $bytes = $r.Content
    if ($r.StatusCode -eq 200 -and $bytes.Length -gt 1000 -and $bytes[0] -eq 0x25 -and $bytes[1] -eq 0x50) {
        Write-Pass "$($item.n) PDF generated ($($bytes.Length) bytes)"
    } else { Write-Fail "$($item.n) PDF invalid" }
}

# ---------------------------------------------------------------- read endpoints
Write-Head "Read endpoints"
foreach ($ep in @('/auth/me','/buyers','/products','/suppliers','/cha','/transporters','/inquiries','/quotations','/orders','/invoices','/dashboard')) {
    try { ApiGet $ep | Out-Null; Write-Pass "GET $ep" } catch { Write-Fail "GET $ep -> $($_.Exception.Message)" }
}

# ---------------------------------------------------------------- result
Write-Host ""
Write-Host "=======================================================" -ForegroundColor White
if ($script:Failures -eq 0) {
    Write-Host "ALL CHECKS PASSED - the deployment is working" -ForegroundColor Green
    Write-Host ""
    Write-Host "Note: this created test records (buyer/product/quotation/order/invoice)." -ForegroundColor DarkGray
    Write-Host "Reset with:  deploy.cmd reset" -ForegroundColor DarkGray
    Write-Host ""
    exit 0
} else {
    Write-Host "$($script:Failures) CHECK(S) FAILED" -ForegroundColor Red
    Write-Host ""
    exit 1
}
