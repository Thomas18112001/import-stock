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

Write-Host "[1/5] Verification .env"
if (!(Test-Path $EnvFile)) {
  throw "Le fichier $EnvFile est introuvable. Cree-le d'abord (copie de .env.example)."
}

Write-Host "[2/5] Basculer l'environnement en local (development)"
Set-EnvValue -FilePath $EnvFile -Key "NODE_ENV" -Value "development"
Set-EnvValue -FilePath $EnvFile -Key "PORT" -Value "3001"

Write-Host "[3/5] Selection de l'app Shopify DEV"
shopify app config use shopify.app.import-stock-boutique.toml

Write-Host "[4/5] Nettoyage preview DEV"
shopify app dev clean -c shopify.app.import-stock-boutique.toml

Write-Host "[5/5] Demarrage local avec la config DEV"
shopify app dev --reset
