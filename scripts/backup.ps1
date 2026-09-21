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
if(-not (Get-Command supabase -ErrorAction SilentlyContinue)){throw "Supabase CLI is required."}
New-Item -ItemType Directory -Force backups | Out-Null
$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
supabase link --project-ref $env:SUPABASE_PROJECT_REF
python scripts/recovery.py export --env $EnvFile --output "backups/firmsgeotools-recovery-$stamp.json"
supabase db dump --linked --data-only --use-copy -f "backups/firmsgeotools-data-$stamp.sql"
Write-Host "Backup complete: backups/*-$stamp.*"
