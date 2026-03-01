param(
  [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"

function Set-EnvValue {
  param(
    [string]$FilePath,
    [string]$Key,
    [string]$Value
  )

  if (!(Test-Path $FilePath)) {
    throw "Fichier introuvable: $FilePath"
  }

  $lines = Get-Content $FilePath
  $updated = $false

  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^$Key=") {
      $lines[$i] = "$Key=$Value"
      $updated = $true
      break
    }
  }

  if (-not $updated) {
    $lines += "$Key=$Value"
  }

  Set-Content -Path $FilePath -Value $lines
}

Write-Host "[1/4] Verification .env"
if (!(Test-Path $EnvFile)) {
  throw "Le fichier $EnvFile est introuvable. Cree-le d'abord."
}

Write-Host "[2/4] Basculer l'environnement en production VPS"
Set-EnvValue -FilePath $EnvFile -Key "NODE_ENV" -Value "production"
Set-EnvValue -FilePath $EnvFile -Key "PORT" -Value "3001"
Set-EnvValue -FilePath $EnvFile -Key "SHOPIFY_APP_URL" -Value "https://import-stock.woora.fr"

Write-Host "[3/4] Selection de l'app Shopify PROD"
shopify app config use shopify.app.toml

Write-Host "[4/4] Synchronisation config Shopify"
shopify app deploy --config shopify.app.toml

Write-Host "OK: .env est prepare pour le VPS + config Shopify PROD active."
