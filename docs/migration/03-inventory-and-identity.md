# Étape 1 — inventaire des dépôts, audit Android et contrat d'identité

Date : 23 octobre 2026
Suite de `00-audit-initial.md` (audit web) et de `02-foundation-roadmap.md` (étapes 1 et 2).

## Inventaire

| Dépôt | Révision examinée | Licence | Pile | Tests / CI | Remarques |
|---|---|---|---|---|---|
| `N7T0-OF/souanpt-hub` | branche `claude/profile-integrity` (sur `9f56d15`) | aucune licence déclarée à la racine | HTML/JS sans bundler, Cloudflare Pages Functions et Workers, Firebase Auth/Firestore/Storage | `node --test tests/*.test.mjs` + émulateur Firestore (`tests/firestore-emulator`, Java 21) | Règles Firestore publiées à la main dans la console |
| `N7T0-OF/sankai-life` | `55fa4c5524f33b351cc138ba2fdb4317804170e2` (`main`, 19 août 2026) | aucun fichier LICENSE ; `THIRD_PARTY_NOTICES.md` présent | Kotlin, Jetpack Compose, Room 2.6.1 (schéma v20), minSdk 26, compile/targetSdk 35, version 1.109.0 (code 109) | `.github/workflows/build-apk.yml` (push `main`, tags `v*`, manuel) | Lu en copie superficielle, aucun build exécuté |
| `ethanplusai/harvey` | `f851026f876dad9ea665f2164b5ef73d01432349` | MIT | Python 3.11+, SQLite, tableau de bord local `127.0.0.1:5555` | `.github/workflows/tests.yml` (pytest) | Intégré par fichiers (`js/harvey-bridge.js`, branche `claude/creator-tools`), aucun code copié |

Un snapshot restaurable de chaque dépôt correspond à ces SHA. Avant toute migration de données, archiver aussi les **données** (export Firestore, sauvegardes GitHub des utilisateurs de test), qui ne sont pas dans les dépôts.

## Audit P0 de l'application Android (`sankai-life`)

Périmètre : manifeste, règles de sauvegarde, mise à jour intégrée, signature, secrets, réseau, workflow. Aucune faille P0 trouvée ; points à traiter :

| Gravité | Constat | Preuve | Correctif proposé |
|---|---|---|---|
| P1 (Play) | `targetSdk = 35` : Google Play exige l'API 36 pour les soumissions depuis le 31 août 2026. | `SankaiLife/app/build.gradle.kts` | Monter compile/targetSdk à 36, vérifier AGP/Kotlin, permissions et alarmes exactes. |
| P1 (Play) | `REQUEST_INSTALL_PACKAGES` + `UpdateManager` (APK depuis GitHub Releases) : la politique Play restreint fortement cette permission. | `AndroidManifest.xml`, `core/update/UpdateManager.kt` | Deux variantes (`flavor`) : `github` garde l'updater, `play` retire la permission et laisse Google Play mettre à jour. Clé de signature commune ou canaux séparés et annoncés. |
| P2 | L'empreinte SHA-256 est vérifiée seulement si `update.json` la fournit : un `update.json` sans `sha256` désactive le contrôle. | `UpdateManager.kt` (`if (maj.sha256.isNotBlank())`) | Refuser l'installation sans empreinte. La signature Android (même certificat qu'à l'installation) reste la protection principale. |
| P2 | `permissions: contents: write` au niveau du workflow entier. | `.github/workflows/build-apk.yml` | Lecture seule par défaut, écriture uniquement sur le job de release. |
| Info | Sauvegarde cloud entièrement exclue (`<exclude domain="root" path="."/>`) ; transfert d'appareil à appareil non restreint. L'app ne stocke aucun jeton ni secret (vérifié par recherche), donc pas de fuite ; mais aucune sauvegarde automatique des progrès. | `res/xml/backup_rules.xml`, `data_extraction_rules.xml` | Garder l'exclusion tant qu'aucun secret n'existe ; prévoir l'export chiffré ou la synchronisation de l'étape 6 avant d'ajouter un compte. |
| Info | Sans compte : `user` est une ligne unique locale (`id = 1`), sans identifiant partageable. | `core/data/db` (`UserEntity`) | Voir le contrat d'identité ci-dessous avant toute liaison web. |

Conforme : composants exportés limités au lanceur, au widget et au `NotificationListenerService` protégé par une permission système ; `FileProvider` non exporté ; mises à jour limitées aux hôtes GitHub, rétrogradation refusée ; keystore hors dépôt (`keystore.properties`, `*.jks` ignorés) et secrets de signature dans GitHub Actions ; aucune clé ni jeton dans les sources.

## Contrat d'identité v1 (implémenté sur le web)

- **`userId`** : l'UID Firebase Auth est l'identifiant interne stable pour l'instant (Google, Discord via jeton personnalisé). La connexion GitHub n'est pas une identité : c'est un accès au stockage, rattaché au profil. Un `userId` indépendant du fournisseur (étape 2 de la feuille de route) pourra remplacer l'UID sans changer les documents publics ci-dessous.
- **Pseudo public** : `handles/{pseudo}` → `{ uid, createdAt }`. Format `^[a-z0-9_-]{2,40}$`, réservation unique, lecture par `get` uniquement (pas d'énumération). `users/{uid}.pseudo` ne peut désigner qu'un pseudo réservé par ce compte ; changer de pseudo libère l'ancien dans le même lot (`Cloud.claimPseudo`). `/u/<pseudo>` résout d'abord la réservation ; pour un pseudo hérité non réservé, deux profils identiques rendent l'adresse ambiguë (409) au lieu de servir l'un des deux.
- **Profil public `users/{uid}`** (lecture publique) : champs du propriétaire — `pseudo`, `name`, `avatar`, `public`, `country`, `siteUrl`, `repo`, `customDomain`, `analyticsEnabled`, `analyticsProjects`, `lastPublishedAt`. Champs **protégés** (création à `false`/`0` uniquement, puis écriture par compte de service seulement) — `verified`, `views`, `visitors`, `projects`, `clicks`, `reviewsCount`, `reviewsAvg`, ainsi que `uid` et `owner`. Jamais d'e-mail.
- **Tests** : `tests/firestore-emulator/rules.test.mjs` (réservation, reprise refusée, pseudo hérité, champs protégés), `tests/firestore-emulator/pseudo-client.test.mjs` (le vrai `js/cloud.js` contre l'émulateur, avec les nouvelles et les anciennes règles) et `tests/profile-resolver.test.mjs` (résolution, réservation périmée, doublons). Résultat local du 23 octobre 2026 : 9/9 émulateur, 50/50 unitaires.

## Avant de publier les règles

1. Publier le code client de cette branche AVANT les règles : l'ancien client écrit `pseudo` sans réservation et serait refusé à l'inscription et au changement de pseudo. Le nouveau client fonctionne avec les deux versions des règles : si la lecture de `handles/` est refusée (règles antérieures), il reprend l'écriture d'origine (`tests/firestore-emulator/pseudo-client.test.mjs`).
2. Inventorier dans la console les profils dont `verified` vaut `true` ou dont les compteurs du classement ne sont pas nuls : aucune procédure ne les écrit, ils ont donc été fixés à la main. Les remettre à `false`/`0` avec un compte administrateur (les règles n'effacent pas une valeur existante).
3. Inventorier les pseudos portés par plusieurs profils : le premier compte qui se connecte réserve le pseudo, les autres sont invités à en choisir un nouveau.
