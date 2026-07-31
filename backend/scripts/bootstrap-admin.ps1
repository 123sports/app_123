param(
  [string]$SupabaseUrl,
  [string]$Email,
  [string]$FullName,
  [string]$EnvironmentPath
)

$ErrorActionPreference = "Stop"

function Read-RequiredText([string]$Prompt) {
  do {
    $value = (Read-Host $Prompt).Trim()
  } while (-not $value)
  return $value
}

function ConvertFrom-SecureValue([Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

if (-not $EnvironmentPath) {
  $repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
  $EnvironmentPath = Join-Path $repositoryRoot "frontend\.env.local"
}

$environment = @{}
if (Test-Path -LiteralPath $EnvironmentPath) {
  foreach ($line in Get-Content -LiteralPath $EnvironmentPath -Encoding utf8) {
    if ($line -match "^([^#=]+)=(.*)$") {
      $environment[$Matches[1].Trim()] = $Matches[2].Trim()
    }
  }
}

if (-not $SupabaseUrl -and $environment["SUPABASE_URL"]) {
  $SupabaseUrl = $environment["SUPABASE_URL"]
}
if (-not $SupabaseUrl) {
  $SupabaseUrl = Read-RequiredText "SUPABASE_URL"
}
$SupabaseUrl = $SupabaseUrl.Trim().TrimEnd("/")
if ($SupabaseUrl -notmatch "^https://[a-z0-9-]+\.supabase\.co$") {
  throw "SUPABASE_URL invalida."
}

if (-not $Email) {
  $Email = Read-RequiredText "E-mail do primeiro administrador"
}
$Email = $Email.Trim().ToLowerInvariant()
if ($Email -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
  throw "E-mail invalido."
}

if (-not $FullName) {
  $FullName = Read-RequiredText "Nome completo"
}

$secret = $environment["SUPABASE_SECRET_KEY"]
if (-not $secret) {
  $secretSecure = Read-Host "SUPABASE_SECRET_KEY (entrada oculta)" -AsSecureString
  $secret = ConvertFrom-SecureValue $secretSecure
}
if ($secret -notmatch "^(sb_secret_|eyJ)") {
  throw "Use a Secret key atual ou a service_role legada."
}

$headers = @{
  apikey = $secret
  "User-Agent" = "123sports-server-bootstrap/1.0"
}
if ($secret.StartsWith("eyJ")) {
  $headers["Authorization"] = "Bearer $secret"
}

try {
  $usersResponse = Invoke-RestMethod `
    -Method Get `
    -Uri "$SupabaseUrl/auth/v1/admin/users?page=1&per_page=1000" `
    -Headers $headers
  $existing = @($usersResponse.users) |
    Where-Object { $_.email -and $_.email.ToLowerInvariant() -eq $Email } |
    Select-Object -First 1

  if ($existing) {
    $userId = $existing.id
    Write-Host "Usuario existente encontrado. Apenas o papel sera promovido."
  }
  else {
    do {
      $passwordSecure = Read-Host "Senha inicial (minimo 12 caracteres, entrada oculta)" -AsSecureString
      $password = ConvertFrom-SecureValue $passwordSecure
    } while ($password.Length -lt 12)

    $body = @{
      email = $Email
      password = $password
      email_confirm = $true
      user_metadata = @{ full_name = $FullName }
    } | ConvertTo-Json -Depth 4

    $created = Invoke-RestMethod `
      -Method Post `
      -Uri "$SupabaseUrl/auth/v1/admin/users" `
      -Headers $headers `
      -ContentType "application/json" `
      -Body $body
    $userId = $created.id
    $password = $null
  }

  $roleHeaders = $headers.Clone()
  $roleHeaders["Prefer"] = "resolution=merge-duplicates,return=minimal"
  $roleBody = @{
    user_id = $userId
    role = "admin"
  } | ConvertTo-Json

  Invoke-RestMethod `
    -Method Post `
    -Uri "$SupabaseUrl/rest/v1/user_roles?on_conflict=user_id,role" `
    -Headers $roleHeaders `
    -ContentType "application/json" `
    -Body $roleBody | Out-Null

  Invoke-RestMethod `
    -Method Delete `
    -Uri "$SupabaseUrl/rest/v1/user_roles?user_id=eq.$userId&role=neq.admin" `
    -Headers $headers | Out-Null

  Write-Host ""
  Write-Host "Administrador configurado com sucesso: $Email"
  Write-Host "Teste o login pela opcao Professor / Admin."
}
finally {
  $secret = $null
  $password = $null
  $headers = $null
}
