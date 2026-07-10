# ══════════════════════════════════════════════════════════════════
#  souanpt.hub — Déploiement DIRECT sur Cloudflare Pages (sans GitHub)
#  Usage : clic droit → « Exécuter avec PowerShell »   (ou : .\deploy-cloudflare.ps1)
#  Prérequis (une seule fois) :
#    1. Installer Node.js LTS → https://nodejs.org (bouton vert, installation par défaut)
#    2. Au premier lancement, une page Cloudflare s'ouvrira pour autoriser l'outil.
# ══════════════════════════════════════════════════════════════════
param([string]$Project = "souanptjub")

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

# Dossier de publication propre (on exclut ce qui ne doit pas partir en ligne)
$src  = $PSScriptRoot
$dist = Join-Path $env:TEMP "souanpt-hub-dist"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory $dist | Out-Null

robocopy $src $dist /E `
  /XD .git _legacy .github cloudflare node_modules `
  /XF deploy-cloudflare.ps1 | Out-Null

Write-Host ""
Write-Host "  Deploiement de souanpt.hub vers Cloudflare Pages (projet: $Project)..." -ForegroundColor Green
Write-Host "  (au premier lancement, autorise l'outil dans la page qui s'ouvre)"
Write-Host ""

npx --yes wrangler pages deploy $dist --project-name $Project

Write-Host ""
Write-Host "  Termine. Le site est en ligne sur https://$Project.pages.dev" -ForegroundColor Green
pause
