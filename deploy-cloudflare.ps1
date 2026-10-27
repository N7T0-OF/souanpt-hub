# ══════════════════════════════════════════════════════════════════
#  souanpt.hub — Déploiement DIRECT sur Cloudflare Pages (sans GitHub)
#  Usage : clic droit → « Exécuter avec PowerShell »   (ou : .\deploy-cloudflare.ps1)
#  Prérequis (une seule fois) :
#    1. Installer Node.js LTS → https://nodejs.org (bouton vert, installation par défaut)
#    2. Au premier lancement, une page Cloudflare s'ouvrira pour autoriser l'outil.
# ══════════════════════════════════════════════════════════════════
param([string]$Project = "souanpthub")  # nom du projet Pages (le domaine reste souanptjub.pages.dev)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "  Node.js n'est pas installe." -ForegroundColor Yellow
  Write-Host "  1. Va sur https://nodejs.org et installe la version LTS (bouton vert)."
  Write-Host "  2. Ferme puis rouvre cette fenetre, et relance ce script."
  Write-Host ""
  pause
  exit 1
}

# Artefact à liste blanche identique au workflow GitHub Actions. Le dossier est
# unique afin de ne jamais supprimer un artefact temporaire préexistant.
$dist = Join-Path $env:TEMP "souanpt-hub-dist-$([guid]::NewGuid().ToString('N'))"
$build = node (Join-Path $PSScriptRoot "scripts/prepare-deploy.mjs") --channel=cloudflare "--output=$dist"
if ($LASTEXITCODE -ne 0) { throw "La préparation de l'artefact a échoué." }
$buildInfo = $build | ConvertFrom-Json

Write-Host ""
Write-Host "  Deploiement de souanpt.hub vers Cloudflare Pages (projet: $Project)..." -ForegroundColor Green
Write-Host "  (au premier lancement, autorise l'outil dans la page qui s'ouvre)"
Write-Host ""

npx --yes wrangler pages deploy $dist --project-name $Project

if ($LASTEXITCODE -ne 0) { throw "Cloudflare Wrangler a échoué ; aucune publication n'est confirmée." }

$verified = $false
foreach ($url in @("https://$Project.pages.dev/build-info.json", "https://souanptjub.pages.dev/build-info.json")) {
  try {
    $published = Invoke-RestMethod -Uri $url -TimeoutSec 20
    if ($published.commit -eq $buildInfo.commit) {
      Write-Host "  Commit vérifié : $($published.commit) ($url)" -ForegroundColor Green
      $verified = $true
      break
    }
  } catch { }
}
if (-not $verified) { throw "L'upload a été tenté, mais aucune URL de production n'a servi le commit $($buildInfo.commit)." }

Write-Host ""
Write-Host "  Termine. Le site est en ligne sur https://$Project.pages.dev" -ForegroundColor Green
pause
