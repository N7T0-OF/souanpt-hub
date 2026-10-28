# GitHub et releases

1. Partir de `origin/main` actualisé et créer une branche `codex/...`; conserver les changements locaux.
2. Sous PowerShell, exécuter `$tests = Get-ChildItem tests -File | Where-Object Name -Match '\.test\.(mjs|cjs)$' | ForEach-Object FullName; node --test $tests`, puis `git diff --check`. Vérifier les contrôles de `.github/workflows/ci.yml` sur la PR.
3. Fusionner une PR validée ; `.github/workflows/deploy.yml` publie alors `main` sur GitHub Pages. Vérifier son `head_sha`, sa conclusion et le marqueur public `build-info.json` via `scripts/verify-site-deploy.mjs`.
4. Le déploiement Cloudflare est séparé et manuel ; il faut un jeton correctement restreint et le contrôle de `.github/workflows/deploy-cloudflare.yml`. Ne pas supposer qu'une fusion GitHub Pages met Cloudflare à jour.
5. `.github/workflows/release.yml` démarre sur un tag `v*`, exige un tag correspondant à `HUB_VERSIONS` et des déploiements de production réussis pour le même SHA, y compris Cloudflare. Ne pas créer de tag tant que ces prérequis ne sont pas réunis. Contrôler archives, sommes et SHA avant d'annoncer la release.

Rollback : rétablir par un nouveau commit ou redéployer un artefact identifié ; préserver l'historique. Pour les données privées, utiliser les branches de récupération et les commits de sauvegarde, jamais un `push --force` improvisé.
