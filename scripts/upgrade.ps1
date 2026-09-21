param([string]$EnvFile=".env.local")
$ErrorActionPreference="Stop"
if(!(Test-Path $EnvFile)){throw "Missing $EnvFile"}
Get-Content $EnvFile | ForEach-Object {
  $line=$_.Trim()
  if($line -and !$line.StartsWith("#") -and $line.Contains("=")){
    $p=$line.Split("=",2);[Environment]::SetEnvironmentVariable($p[0],$p[1],"Process")
  }
}
if(-not $env:SUPABASE_PROJECT_REF){throw "Missing SUPABASE_PROJECT_REF"}
if(-not $env:INSTALL_TOKEN){throw "Missing INSTALL_TOKEN"}
if(-not (Get-Command supabase -ErrorAction SilentlyContinue)){throw "Supabase CLI is required."}
if(-not (Get-Command python -ErrorAction SilentlyContinue)){throw "Python is required."}

Write-Host "[1/5] Link project"
supabase link --project-ref $env:SUPABASE_PROJECT_REF
Write-Host "[2/5] Apply migrations"
supabase db push
Write-Host "[3/5] Deploy Edge Functions"
@("firewatch-firms","firewatch-telegram","firewatch-setup","firewatch-doctor","firewatch-admin","firewatch-geo-integrity","firewatch-dashboard") | ForEach-Object {
  supabase functions deploy $_ --no-verify-jwt
}
Write-Host "[4/5] Finalize runtime configuration"
$headers=@{"Content-Type"="application/json";"x-install-token"=$env:INSTALL_TOKEN}
Invoke-RestMethod -Method Post -Uri "https://$($env:SUPABASE_PROJECT_REF).supabase.co/functions/v1/firewatch-setup" -Headers $headers -Body '{"mode":"upgrade"}' | ConvertTo-Json -Depth 10
Write-Host "[5/5] Validate"
& .\scripts\validate.ps1 -EnvFile $EnvFile
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
