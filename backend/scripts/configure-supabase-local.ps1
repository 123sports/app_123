$ErrorActionPreference = "Stop"

function Read-RequiredValue {
  param([string]$Prompt)

  $value = (Read-Host $Prompt).Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$Prompt is required."
  }

  return $value
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$environmentPath = Join-Path $repositoryRoot "frontend\.env.local"

$supabaseUrl = (Read-RequiredValue "SUPABASE_URL").TrimEnd("/")
$publishableKey = Read-RequiredValue "SUPABASE_PUBLISHABLE_KEY"
$secretSecure = Read-Host "SUPABASE_SECRET_KEY" -AsSecureString

$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretSecure)
try {
  $secretKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}

if ($supabaseUrl -notmatch "^https://([a-z0-9]+)\.supabase\.co$") {
  throw "SUPABASE_URL must use the format https://PROJECT_REFERENCE.supabase.co."
}

$projectReference = $Matches[1]

if (-not $publishableKey.StartsWith("sb_publishable_")) {
  throw "SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_."
}

if ([string]::IsNullOrWhiteSpace($secretKey) -or -not $secretKey.StartsWith("sb_secret_")) {
  throw "SUPABASE_SECRET_KEY must start with sb_secret_."
}

$environment = @(
  "VITE_SUPABASE_URL=$supabaseUrl"
  "VITE_SUPABASE_PUBLISHABLE_KEY=$publishableKey"
  "VITE_ENABLE_LOCAL_MODE=false"
  "VITE_PAYMENT_PROVIDER=local"
  ""
  "SUPABASE_URL=$supabaseUrl"
  "SUPABASE_PUBLISHABLE_KEY=$publishableKey"
  "SUPABASE_SECRET_KEY=$secretKey"
  ""
  "PAYMENT_PROVIDER=local"
  "ALLOW_LOCAL_PAYMENT_SIMULATION=true"
  "APP_BASE_URL=http://127.0.0.1:4173"
) -join [Environment]::NewLine

[IO.File]::WriteAllText(
  $environmentPath,
  $environment + [Environment]::NewLine,
  [Text.UTF8Encoding]::new($false)
)

Write-Host ""
Write-Host "Local Supabase environment configured."
Write-Host "Project reference: $projectReference"
Write-Host "Environment file: $environmentPath"
Write-Host "Database password was not stored."
