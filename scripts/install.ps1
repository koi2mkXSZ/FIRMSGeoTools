param([string]$EnvFile=".env.local")
$ErrorActionPreference="Stop"

if (!(Test-Path $EnvFile)) { throw "Missing $EnvFile. Copy .env.example and fill it first." }
Get-Content $EnvFile | ForEach-Object {
  $line=$_.Trim()
  if ($line -and !$line.StartsWith("#") -and $line.Contains("=")) {
    $p=$line.Split("=",2)
    [Environment]::SetEnvironmentVariable($p[0],$p[1],"Process")
  }
}

$required=@("SUPABASE_PROJECT_REF","FIRMS_MAP_KEY","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","INSTALL_TOKEN")
foreach($v in $required){ if(-not [Environment]::GetEnvironmentVariable($v,"Process")){ throw "Missing required variable: $v" } }
if(-not (Get-Command supabase -ErrorAction SilentlyContinue)){ throw "Supabase CLI is required." }
if(-not (Get-Command python -ErrorAction SilentlyContinue)){ throw "Python is required." }

$ref=$env:SUPABASE_PROJECT_REF
$aoi=if($env:AOI_FILE){$env:AOI_FILE}else{"config/aoi.geojson"}
$regions=if($env:REGIONS_FILE){$env:REGIONS_FILE}else{""}
$config=if($env:CONFIG_FILE){$env:CONFIG_FILE}else{"config/monitoring.json"}

if(!(Test-Path $aoi)){throw "AOI file not found: $aoi"}
if(!(Test-Path $config)){throw "Config file not found: $config"}

Write-Host "[1/7] Linking Supabase project..."
supabase link --project-ref $ref

Write-Host "[2/7] Applying database migrations..."
supabase db push

Write-Host "[3/7] Installing Edge secrets..."
supabase secrets set "FIRMS_MAP_KEY=$env:FIRMS_MAP_KEY" "TELEGRAM_BOT_TOKEN=$env:TELEGRAM_BOT_TOKEN" "TELEGRAM_CHAT_ID=$env:TELEGRAM_CHAT_ID" "INSTALL_TOKEN=$env:INSTALL_TOKEN"
if($env:TELEGRAM_ADMIN_CHAT_ID -and $env:TELEGRAM_ADMIN_WEBHOOK_SECRET){
  supabase secrets set "TELEGRAM_ADMIN_CHAT_ID=$env:TELEGRAM_ADMIN_CHAT_ID" "TELEGRAM_ADMIN_WEBHOOK_SECRET=$env:TELEGRAM_ADMIN_WEBHOOK_SECRET"
}

Write-Host "[4/7] Deploying Core Edge Functions..."
supabase functions deploy firewatch-firms --no-verify-jwt
supabase functions deploy firewatch-telegram --no-verify-jwt
supabase functions deploy firewatch-setup --no-verify-jwt
supabase functions deploy firewatch-doctor --no-verify-jwt
supabase functions deploy firewatch-admin --no-verify-jwt

Write-Host "[5/7] Configuring geography and cron..."
python scripts/build_setup_payload.py $aoi $regions $config | Set-Content -Encoding utf8 ".setup-payload.json"
$headers=@{"Content-Type"="application/json";"x-install-token"=$env:INSTALL_TOKEN}
$body=Get-Content ".setup-payload.json" -Raw
Invoke-RestMethod -Method Post -Uri "https://$ref.supabase.co/functions/v1/firewatch-setup" -Headers $headers -Body $body | ConvertTo-Json -Depth 10
Remove-Item ".setup-payload.json" -ErrorAction SilentlyContinue

Write-Host "[6/7] Core install completed."
Write-Host "The first scheduled FIRMS run will finish bootstrap automatically."
Write-Host "[7/7] Running installation doctor..."
& .\scripts\validate.ps1 -EnvFile $EnvFile
if($LASTEXITCODE -ne 0){ exit $LASTEXITCODE }
