# Livraison corrective Souanpt Hub — 3.10.1

Date : 21 octobre 2026
État : PR #1 ouverte, CI et aperçu de branche validés; aucun merge, tag ni déploiement de production effectué.

## Correctifs de cette livraison

- Analytics valide l'existence du profil Firestore, son association au propriétaire, sa publication HTTPS et le consentement `analyticsEnabled` avant toute écriture.
- L'ingestion est fermée tant que le flag explicite, le rate-limit binding Cloudflare, le Durable Object, le sel IP et les secrets Firebase ne sont pas configurés.
- Les requêtes sont bornées (4 Kio, champs et tailles autorisés), limitées par IP et UID, dédupliquées, et protégées par des quotas journaliers au niveau Durable Object. Un plafond global de 3 000 tentatives par jour est réservé avant toute lecture Firestore.
- Les événements par projet ne peuvent cibler que les IDs d'un manifeste de 40 projets maximum enregistré par le propriétaire lors de la publication. Les anciens sites doivent être republiés pour compter les projets; leurs pages vues restent possibles.
- L'activation Analytics attend que GitHub Pages ait construit le commit exact du site publié et que le manifeste soit enregistré avant d'activer le consentement.
- OAuth Discord relie le `state` à un nonce cryptographique en cookie `HttpOnly`, expire après dix minutes, et efface le cookie sur annulation, réponse incomplète et succès. Les erreurs internes ne sont pas renvoyées au navigateur.
- Les artefacts de site proviennent d'une liste autorisée; chaque build contient `build-info.json` (version, SHA, date et canal). Les chemins `docs`, `scripts`, `tests` et `.freebuff` sont exclus.
- La CI vérifie la syntaxe JavaScript, les tests et les artefacts Pages/Cloudflare. Les workflows de production attendent la CI et valident le SHA servi après publication.

## Analytics Cloudflare : activation contrôlée

Le fichier `cloudflare/wrangler.analytics.toml` est volontairement désactivé. L'absence de configuration ne doit pas autoriser des écritures non limitées.

1. Déployer `souanpt-analytics` avec `ANALYTICS_INGEST_ENABLED = "false"`.
2. Ajouter les secrets `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` et un `ANALYTICS_IP_SALT` aléatoire propre à cette fonction. Ne pas réutiliser ni versionner la valeur du sel.
3. Dans Cloudflare, choisir un `namespace_id` positif unique et libre pour le binding Rate Limiting `ANALYTICS_RATE_LIMITER`. Le fichier suggère une limite de 100 requêtes par clé par minute; les clés IP et UID partagent ce binding.
4. Configurer le Durable Object `ANALYTICS_GUARD` tel que défini par le fichier Wrangler; vérifier la migration SQLite avant d'activer les écritures.
5. Republier le site des profils qui veulent les compteurs par projet : l'activation attend une publication confirmée et l'enregistrement du manifeste `analyticsProjects`. Elle refuse les portfolios de plus de 40 projets publiés ou des IDs de projet invalides/dupliqués.
6. Dans une PR distincte, remplacer la variable `ANALYTICS_INGEST_ENABLED` par `"true"` et adapter le contrôle de déploiement qui exige actuellement `enabled: false`. Après revue et déploiement, vérifier `GET /status` (`enabled: true`). Tester avec un profil synthétique ayant `analyticsEnabled: true`; tester ensuite un profil sans consentement et confirmer qu'aucune écriture n'est créée.
7. Si une étape échoue, conserver le flag à `false`. Les pages publiques doivent rester consultables même lorsque l'ingestion renvoie `503`.

Le compte de service Firebase doit être limité au projet cible. Avant production, vérifier les rôles IAM accordés à ce compte et ne lui accorder que l'accès Datastore/Firestore requis. Les tentatives consomment les quotas avant la lecture du profil et le commit Firestore; un échec temporaire de Firestore peut donc perdre cet événement, sans exposer de données ni permettre un dépassement de quota. Le plafond global protège les coûts mais peut suspendre les statistiques pour tous jusqu'au lendemain s'il est épuisé; surveiller les réponses `429` lors de l'activation.

## Publication et release

- Le workflow GitHub Actions est le mécanisme automatisé principal pour Pages; le workflow Cloudflare inscrit le SHA du commit dans la configuration du Worker Analytics, le déploie, puis attend que son `/status` public rende ce SHA et le JSON de protection (`enabled: false`, `reason: security_setup_required`) avant de déployer Pages. Il échoue si `CLOUDFLARE_API_TOKEN` manque ou si l'ancien Worker reste servi.
- Donner au secret un token Cloudflare limité au compte et aux ressources nécessaires (déploiement Worker/Pages). Ne jamais le placer dans un fichier ou une variable publique.
- Le projet Cloudflare Pages est connecté à Git. Avant d'ajouter le secret ou de fusionner, désactiver **Enable automatic production branch deployments** dans Cloudflare Workers & Pages → `souanpthub` → Build → Branch control. Le workflow vérifie ce réglage via l'API Cloudflare avant de déployer le Worker ou les Pages; il échoue si le réglage ne peut pas être confirmé.
- La publication Cloudflare ne peut pas réussir sans le secret GitHub ci-dessus. `deploy-cloudflare.ps1` reste un outil de téléversement Pages manuel; il ne déploie pas le Worker Analytics et n'est pas le canal de release vérifié.
- La procédure `.github/workflows/release.yml` attend un tag `v*` correspondant à la version `HUB_VERSIONS`, exige que son commit soit déjà dans `main`, puis génère les archives Pages/Cloudflare et `SHA256SUMS.txt`. Juste avant publication, elle exige aussi que les deux sites servent ce SHA et que le déploiement canonique Cloudflare corresponde au même commit. Créer le tag `v3.10.1` uniquement après revue/merge et CI verte.
- Retour arrière : redéployer un artefact d'une release antérieure vérifiée et contrôler son `build-info.json`. Garder Analytics désactivé jusqu'à ce que l'ancien Worker soit remplacé par la version protégée.

## État de production et critères de clôture

À ce stade, le code et les workflows sont proposés dans la [PR #1](https://github.com/N7T0-OF/souanpt-hub/pull/1), et la CI de la branche de revue est verte. Aucun correctif n'est effectif en production. Le workflow de production n'est déclenché que par `main`; la branche de revue fournit un aperçu Cloudflare. La clôture opérationnelle nécessite ensuite : revue humaine/merge, configuration du secret Cloudflare, déploiement du Worker et des Pages, vérification du marqueur de commit servi et contrôles smoke non destructifs. La release taguée vient après le merge validé.
