# Sankai Life unifié — audit initial P0

Date : 21 octobre 2026
Périmètre inspecté : checkout courant de `souanpt-hub` (`main`, dépôt web).
Hors périmètre : dépôt Android `sankai-life` et moteur `harvey`, absents de ce workspace. Les constats ci-dessous ne prétendent pas auditer ces deux dépôts.

Révision locale vérifiée : `ee41a3f963bdd717f8fc0b62b0839b63133eee3c` (`main`, 1er octobre 2026). La révision correspond à celle indiquée pour Souanpt Hub dans les notes fournies.

## Inventaire d'implémentation observé

| Domaine | État | Preuve dans le checkout |
|---|---|---|
| Dashboard et éditeur de portfolio web | Implémenté, non exécuté dans cet audit | `app.html`, `js/canvas.js`, `js/core.js` |
| Données utilisateur locales + manifeste de sauvegarde GitHub versionné | Implémenté, partiellement vérifié | `js/hub-data.js` (schéma sauvegarde v3), `js/hub-sync.js` (conflits décrits et implémentés) |
| Authentification GitHub par relais/cookie ou PAT de repli | Implémenté, non vérifié sur services réels | `functions/api/auth.js`, `functions/api/gh.js`, `js/gh-auth.js`; scopes historiques `repo workflow pages` |
| Comptes classiques et profils Firestore | Implémenté, règles à déployer manuellement | `js/cloud.js`, `firebase/firestore.rules`; aucune preuve d'application des règles distantes disponible localement |
| Publication de profil public | Implémenté comme génération/publication du site existant | `js/core.js`, `functions/u/[pseudo].js`; route cible `/@username` du cahier des charges absente |
| Analytics | Correctif local fail-closed; production à vérifier après PR/déploiement | `cloudflare/analytics-worker.js`, `js/core.js` |
| Notifications, demandes, clients, devis et portails | Implémentés dans le produit web | `js/client-workspace.js`, `js/quote.js`, `cloudflare/notify-worker.js`, `functions/` |
| Contrat partagé `userId` et `StorageAdapter` hybride | Documenté seulement | cahier des charges fourni; aucun contrat de ce nom dans le checkout |
| Application Android, Room/DataStore, publication Play, AdMob | Non audité / absent de ce checkout | aucun Gradle, manifeste Android ou source Kotlin dans le dépôt courant |
| Intégration Harvey | Documentée seulement | aucun code Python/adapter Harvey dans le dépôt courant |
| Tests | Tests natifs Node ajoutés pour Analytics, OAuth et artefacts de publication | `tests/*.test.mjs`; `node --test tests/*.test.mjs` |
| Déploiement et versions en production | Non effectués dans cette mission | workflows et marqueur `build-info.json` préparés; Cloudflare exige un secret absent |

Les workflows GitHub Actions observés publient GitHub Pages et Cloudflare Pages (si le secret est défini). Ils ne déploient pas les règles Firestore et ne publient pas le Worker Analytics/Discord. Les licences et dépendances Android/Harvey restent à vérifier sur leurs dépôts respectifs.

## Résumé

| Gravité | Constat | État |
|---|---|---|
| P0 | Le callback OAuth Discord ne vérifiait aucun `state` lié au navigateur qui avait démarré la connexion. | Corrigé dans les changements locaux : nonce aléatoire, cookie `HttpOnly`, `SameSite=Lax`, expiration 10 min, rejet des callbacks sans correspondance, annulation et erreurs sans cookie résiduel. Pas encore publié. |
| P0 | Le Worker Analytics accepte des hits anonymes pour tout UID arbitraire et écrit avec un compte de service. Aucun contrôle de profil, preuve d'origine, plafond par IP/UID ni limitation du corps n'est présent. | Corrigé dans le code local et fermé par défaut : profil propriétaire existant + consentement explicite, validation stricte, rate limiting requis, quotas DO et déduplication. Production non corrigée tant que le Worker nouveau n'est pas déployé; l'ingestion reste fermée tant que le binding Cloudflare et les secrets ne sont pas configurés. |
| P0 | Le relais `/api/gh` exécutait toute requête portant le cookie `hub_gh` (`SameSite=None`), sans contrôle d'origine, vers n'importe quel chemin de l'API GitHub avec les droits `repo workflow pages`. | Corrigé localement (23 octobre 2026) : origine obligatoire pour toute écriture, liste blanche des opérations du hub, sessions `/api/auth` modifiables uniquement en POST d'une origine autorisée. Pas encore déployé. |
| P0 | Un `match /{col}/{id}` générique des règles Firestore s'ajoutait (OU logique) aux règles spécifiques : un document portant `owner == uid` contournait les protections de `users`, `portals`, `notifications` et `notification_jobs`. | Corrigé localement : règle générique supprimée, `list` propriétaire explicite par collection. Tests émulateur ajoutés à la CI; non exécutés localement (Java absent). Règles non publiées. |
| P0 | Profils publics : `verified` et les compteurs du classement étaient modifiables par leur propriétaire (faux badge « Vérifié », rang gonflé), et l'unicité du pseudo n'était vérifiée que côté client — deux comptes pouvaient porter le même pseudo et `/u/<pseudo>` servir l'un ou l'autre. | Corrigé localement (23 octobre 2026) : champs protégés, réservation `handles/{pseudo}`, résolveur sans ambiguïté. Tests émulateur passés localement. Voir `03-inventory-and-identity.md`. Règles non publiées. |
| P1 | Le cookie `hub_gh` contient le jeton GitHub (et le refresh token éventuel) en clair, 90 jours, sans registre serveur : la déconnexion efface le cookie mais ne révoque pas le jeton, et aucune « déconnexion de tous les appareils » n'existe. | À traiter avec la migration GitHub App (sessions serveur, révocation). |
| P1 | Les règles Storage autorisent les dépôts anonymes sans borne de nombre, sans taille de nom/jeton et avec presque tous les types MIME sous 20 Mo. | À traiter avant une ouverture publique à grande échelle ; les références ne sont pas vérifiées par le serveur. |
| P1 | Le modèle actuel répartit identité et données entre Firebase Auth/Firestore, `localStorage`, dépôt privé GitHub de sauvegarde et une projection publique. Il n'existe pas encore de contrat commun `userId`/version de schéma ni de migration hybride vérifiée. | Architecture cible documentée dans le cahier des charges; implémentation non commencée dans ce dépôt. |

## Détail des constats

### P0 — liaison OAuth Discord absente

- **Preuve :** avant le correctif, `cloudflare/discord-auth-worker.js` copiait le paramètre `return` directement dans OAuth `state`, puis le callback ne validait pas ce champ. Un callback lancé dans un autre navigateur pouvait donc échanger un code et connecter un compte Discord sans prouver qu'il appartenait à la demande initiale.
- **Fichiers :** `cloudflare/discord-auth-worker.js`.
- **Reproduction sûre :** lancer `/login`, puis appeler `/callback` depuis un client isolé sans le cookie de la demande; avant correction, l'absence de `state` n'était pas rejetée. Ne pas utiliser le compte d'un tiers.
- **Correctif :** state JSON encodé avec nonce cryptographique aléatoire de 256 bits et destination de retour validée; nonce séparé dans un cookie `HttpOnly; SameSite=Lax`, limité au chemin callback et expirant après dix minutes. Callback sans cookie/state correspondant refusé avant l'échange du code. Le cookie est supprimé après validation.
- **Vérification :** `node --test tests/*.test.mjs` couvre l'émission, l'absence, l'inadéquation, la correspondance, l'annulation et le cookie supprimé sur erreur sans code.

### P0 — ingestion Analytics publique et non bornée

- **Preuve :** `cloudflare/analytics-worker.js` traite tout `POST */hit`; `handleHit()` accepte l'UID fourni dans le JSON (après simple nettoyage de caractères), puis `commit()` écrit dans `users/{uid}/analytics/*` avec le compte de service. Le Worker n'authentifie pas le profil, ne vérifie pas que l'analytics est activé, n'applique aucune limite de débit/quotas, et le corps est lu sans limite (`request.text()`). L'URL est intégrée aux pages générées dans `js/core.js`.
- **Impact :** falsification des vues/clics de n'importe quel créateur et consommation non bornée de la capacité d'écriture/service Google par un tiers. CORS `*` est attendu pour un pixel public et ne constitue pas une protection d'autorisation.
- **Fichiers :** `cloudflare/analytics-worker.js`, `js/core.js` (génération du collecteur), `cloudflare/wrangler.analytics.toml`.
- **Reproduction sûre :** en environnement local de test avec un compte de service de test, envoyer un JSON `{"uid":"uid-de-test","t":"pv"}` à `/hit`, puis constater l'écriture agrégée. Ne pas tester avec un UID tiers ou contre la production.
- **Correctif proposé :** ajouter une limite de débit Cloudflare par IP et par UID, un plafond de taille de corps et d'événements; n'accepter que les UIDs de profils publiés avec analytics activé; surveiller les dépassements. Restreindre aussi le compte de service à l'écriture nécessaire. Une signature statique incorporée à la page publiée ne résoudrait pas l'abus, car elle est publique.
- **Tests nécessaires :** UID inconnu/non publié refusé; profil désactivé refusé; corps excessif refusé avant parsing; plafond de débit vérifié; champs et compteurs hors schéma rejetés; aucun événement ne crée un document pour un UID absent.
- **Limite du correctif immédiat :** le nouveau code n'est pas encore déployé. Le fichier Wrangler garde l'ingestion désactivée et n'inclut volontairement aucun namespace ID d'exemple. Avant de l'activer, configurer un namespace Cloudflare unique, `ANALYTICS_IP_SALT` et les secrets Firebase; vérifier ensuite `/status` et un profil synthétique. Tant que cela n'est pas fait, cette branche ne doit pas être décrite comme un correctif déjà effectif en production.

### P0 — CSRF et proxy générique sur le relais GitHub

- **Preuve :** `functions/api/auth.js` pose `hub_gh` en `SameSite=None` (nécessaire : le hub GitHub Pages appelle le relais `pages.dev` en cross-site). `functions/api/gh.js` vérifiait seulement la présence du cookie, puis transmettait méthode, chemin et corps à `api.github.com`. CORS empêche un site tiers de *lire* la réponse, pas d'*exécuter* la requête. Un formulaire ou un `fetch` `no-cors` d'un autre site (ou d'un site créateur relayé par `/u/<pseudo>`, servi sur le même domaine que le relais) pouvait donc faire un POST authentifié au nom du visiteur. Avec `repo`, GitHub autorise notamment l'ajout de clés de déploiement et de webhooks. De même, `op=import` permettait de connecter un visiteur au compte GitHub d'un attaquant (ses sauvegardes partaient alors vers ce compte), et `op=logout` acceptait un simple GET.
- **Fichiers :** `functions/api/gh.js`, `functions/api/auth.js`.
- **Reproduction sûre :** `tests/gh-relay-security.test.mjs` appelle les handlers avec un `fetch` simulé; aucun appel réel à GitHub. Contre l'ancien code, une requête PUT d'origine `https://evil.example` atteint le `fetch` sortant. L'acceptation par GitHub d'un corps `text/plain` n'a pas été vérifiée : elle n'est pas nécessaire pour considérer le relais vulnérable.
- **Correctif :** `originAllowed()` exige un en-tête Origin de la liste blanche (ou la même origine que le relais) pour toute écriture, et refuse toute origine étrangère même en lecture; une origine opaque (`null`, page sandboxée) est refusée. `operationAllowed()` limite le relais aux 14 opérations utilisées par `js/core.js`, contrôlées sur le chemin **normalisé** (`..` et `%2e%2e` résolus). `/api/auth` n'accepte `device`, `poll`, `import` et `logout` qu'en POST d'une origine autorisée. Les méthodes `PUT/PATCH/DELETE` sont ajoutées aux en-têtes CORS : sans elles, le preflight du hub GitHub Pages bloquait les publications et suppressions en mode relais.
- **Limites :** le relais ne vérifie pas encore que le dépôt visé appartient au compte connecté; GitHub applique les permissions du jeton de l'utilisateur, mais la restriction aux dépôts Sankai relève de la GitHub App. Toute nouvelle opération GitHub du hub devra être ajoutée à `ALLOWED`, sinon elle reçoit un 403.
- **Tests :** écriture cross-site, sans Origin et depuis une origine opaque refusées sans appel sortant; opérations du hub acceptées; clés, webhooks, collaborateurs, secrets, dispatch de workflow et traversée de chemin refusés; import/logout forgés sans `Set-Cookie`.

### P0 — règle Firestore générique contournant les règles spécifiques

- **Preuve :** `match /{col}/{id}` autorisait `create` si `owner == request.auth.uid`. Firestore combine les règles par OU : un utilisateur pouvait écrire `users/<autre-uid>` avec un champ `owner` à son UID, un portail avec mot de passe en clair, un avis `accepted` ou une fausse notification.
- **Correctif :** règle supprimée; `allow list: if isOwner()` ajouté à `portals`, `estimates`, `requests` et `public_links`, seules collections racines listées par le code (requêtes filtrées sur `owner`). Toutes les collections utilisées par `js/` disposent d'un `match` explicite.
- **Tests :** `tests/firestore-emulator/rules.test.mjs` (CI, Java 21), exécuté aussi localement le 23 octobre 2026 avec un JDK 21 portable : 6/6.

### P1 — dépôts de fichiers de demandes anonymes permissifs

- **Preuve :** `firebase/storage.rules` autorise sans authentification `write` sur `requests/{token}/{fileId}/{fileName}` jusqu'à 20 MiB, et ne rejette que quelques types MIME exécutables. Les règles n'imposent ni compteur, ni quota, ni validation de la référence `token` dans Firestore.
- **Impact :** stockage abusif et dépôt de contenus arbitraires, même si le chemin est difficile à deviner.
- **Correctif proposé :** quotas et limitation de débit au niveau de l'upload, contrôle du jeton et du nombre de pièces jointes côté serveur, allowlist de types réellement requis, vérification de signature de fichier; supprimer les objets à l'expiration de la demande.
- **Tests nécessaires :** upload non autorisé, jeton inconnu/expiré, MIME falsifié, quota dépassé et suppression à expiration.

## État architecture identité/stockage

Le web existant utilise Firebase Auth pour les comptes classiques, des profils Firestore, `localStorage` comme espace de travail, et GitHub facultatif pour sauvegarder/synchroniser les données. Les chemins de données ne sont pas encore la cible hybride décrite dans `Cahier des charges technique V1.0` : dépôt privé par utilisateur GitHub + stockage privé géré pour compte classique, identifiant interne stable, projection publique contrôlée et migrations versionnées. La connexion GitHub actuelle emploie OAuth/device flow et scopes historiques `repo workflow pages`; elle n'est pas encore la GitHub App à permissions minimales prévue par la cible.

Avant d'ajouter le profil Sankai public ou de fusionner les données Android : définir le schéma commun/versionné et les correspondances UID Firebase ↔ GitHub, produire une sauvegarde vérifiable, et tester une migration réversible avec comptes synthétiques. Aucun déplacement ou écrasement de données n'est effectué par cet audit.

## Suite P0

1. Déployer et vérifier le correctif OAuth sur le Worker Discord.
2. Protéger l'ingestion Analytics avec rate limiting/quotas et validation du profil avant toute réactivation à grande échelle.
3. Auditer le dépôt Android sur un checkout correspondant à la révision demandée; vérifier sa chaîne de signature, son `targetSdk`, les mises à jour et les anciennes dépendances AdMob.
4. Valider les contrats d'identité et de stockage avant les premiers écrits de migration.
