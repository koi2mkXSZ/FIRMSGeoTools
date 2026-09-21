param(
  [string]$EnvFile=".env.local",
  [switch]$TelegramTest,
  [switch]$Strict
)
$ErrorActionPreference="Stop"
$argsList=@("scripts/validate.py","--env",$EnvFile)
if($TelegramTest){$argsList+="--telegram-test"}
if($Strict){$argsList+="--strict"}
python @argsList
exit $LASTEXITCODE
