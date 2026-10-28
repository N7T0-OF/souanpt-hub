# Chemins et déploiement

Référence locale fournie par le propriétaire : `G:\2_Logiciel\CLAUDE CODE\souanpt-hub`. Le dépôt partagé est `N7T0-OF/souanpt-hub`. Le dossier facultatif pour l'import manuel est `E:\AA moi\clients` ; l'application ne peut y accéder qu'après sélection dans le navigateur.

Dashboard : GitHub Pages `https://n7t0-of.github.io/souanpt-hub/` est déployé par `.github/workflows/deploy.yml` après CI. Cloudflare Pages `https://souanptjub.pages.dev/` appartient au projet `souanpthub`; `.github/workflows/deploy-cloudflare.yml` est **manuel** et exige `CLOUDFLARE_API_TOKEN`. Le script `deploy-cloudflare.ps1` est une autre entrée locale : toujours vérifier le commit et la cible avant de l'utiliser. `scripts/prepare-deploy.mjs` construit un artefact public autorisé ; `scripts/verify-site-deploy.mjs` et `scripts/verify-analytics-deploy.mjs` comparent les marqueurs au SHA attendu. Voir `docs/migration/02-delivery-and-security.md`.

Portfolios utilisateurs : `generateSite()` génère le HTML ; `deployPortfolio()` publie dans le dépôt configuré du créateur. `SiteAutoPublish` programme les mises à jour autorisées et `PublishUI` affiche la progression. Les sites statiques historiques utilisent GitHub Pages. La projection publique `/u/<pseudo>` dépend des fonctions Cloudflare et de l'accès aux données. Ne jamais confondre son état avec le déploiement du dashboard. Un cache peut retarder l'affichage ; vérifier `build-info.json` ou le commit du site ciblé.

Une URL de production n'est « opérationnelle » qu'après un contrôle réel du marqueur, du SHA et du workflow correspondant ; ce document ne garantit pas sa disponibilité à tout instant.

Contrôle du 28 octobre 2026 : `deploy.yml` #78 a réussi pour la fusion de la PR #8 ; le marqueur de GitHub Pages indiquait `3.12.0`, `0fd455fa66a601bbd7ec40e34f50b3fff64f6fa9` et `github-pages`. L'accès à `app.html` affichait encore la porte de connexion liée à Firebase ; les écrans authentifiés n'ont pas été validés en production.
