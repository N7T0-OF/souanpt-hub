# Livraison corrective Souanpt Hub — 3.10.1

Date : 21 octobre 2026
État : changements préparés pour revue; aucun merge, tag ni déploiement de production effectué.

## Correctifs de cette livraison

- Analytics valide l'existence du profil Firestore, son association au propriétaire, sa publication HTTPS et le consentement `analyticsEnabled` avant toute écriture.
- L'ingestion est fermée tant que le flag explicite, le rate-limit binding Cloudflare, le Durable Object, le sel IP et les secrets Firebase ne sont pas configurés.
- Les requêtes sont bornées (4 Kio, champs et tailles autorisés), limitées par IP et UID, dédupliquées, et protégées par des quotas journaliers au niveau Durable Object.
- OAuth Discord relie le `state` à un nonce cryptographique en cookie `HttpOnly`, expire après dix minutes, et efface le cookie sur annulation, réponse incomplète et succès. Les erreurs internes ne sont pas renvoyées au navigateur.
- Les artefacts de site proviennent d'une liste autorisée; chaque build contient `build-info.json` (version, SHA, date et canal). Les chemins `docs`, `scripts`, `tests` et `.freebuff` sont exclus.
- La CI vérifie la syntaxe JavaScript, les tests et les artefacts Pages/Cloudflare. Les workflows de production attendent la CI et valident le SHA servi après publication.

## Analytics Cloudflare : activation contrôlée

Le fichier `cloudflare/wrangler.analytics.toml` est volontairement désactivé. L'absence de configuration ne doit pas autoriser des écritures non limitées.

1. Déployer `souanpt-analytics` avec `ANALYTICS_INGEST_ENABLED = "false"`.
2. Ajouter les secrets `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` et un `ANALYTICS_IP_SALT` aléatoire propre à cette fonction. Ne pas réutiliser ni versionner la valeur du sel.
3. Dans Cloudflare, choisir un `namespace_id` positif unique et libre pour le binding Rate Limiting `ANALYTICS_RATE_LIMITER`. Le fichier suggère une limite de 100 requêtes par clé par minute; les clés IP et UID partagent ce binding.
4. Configurer le Durable Object `ANALYTICS_GUARD` tel que défini par le fichier Wrangler; vérifier la migration SQLite avant d'activer les écritures.
5. Remplacer la variable `ANALYTICS_INGEST_ENABLED` par `"true"`, redéployer, puis vérifier `GET /status` (`enabled: true`). Tester avec un profil synthétique ayant `analyticsEnabled: true`; tester ensuite un profil sans consentement et confirmer qu'aucune écriture n'est créée.
6. Si une étape échoue, conserver le flag à `false`. Les pages publiques doivent rester consultables même lorsque l'ingestion renvoie `503`.

Le compte de service Firebase doit être limité au projet cible. Avant production, vérifier les rôles IAM accordés à ce compte et ne lui accorder que l'accès Datastore/Firestore requis. Les événements consomment une place dans les quotas et leur réservation est faite avant le commit Firestore; un échec temporaire de Firestore peut donc perdre cet événement, sans exposer de données ni permettre un dépassement de quota.

## Publication et release

- Le workflow GitHub Actions est le mécanisme automatisé principal pour Pages; le workflow Cloudflare déploie le Worker Analytics puis les Pages, et échoue explicitement si `CLOUDFLARE_API_TOKEN` manque.
- Donner au secret un token Cloudflare limité au compte et aux ressources nécessaires (déploiement Worker/Pages). Ne jamais le placer dans un fichier ou une variable publique.
- Ne pas activer en parallèle l'intégration Git native Cloudflare qui publierait le même projet; cela créerait deux déclencheurs concurrents.
- La publication Cloudflare ne peut pas réussir sans le secret GitHub ci-dessus. `deploy-cloudflare.ps1` reste un outil de téléversement Pages manuel; il ne déploie pas le Worker Analytics et n'est pas le canal de release vérifié.
- La procédure `.github/workflows/release.yml` attend un tag `v*` correspondant à la version `HUB_VERSIONS`, exige que son commit soit déjà dans `main`, puis génère les archives Pages/Cloudflare et `SHA256SUMS.txt`. Créer le tag `v3.10.1` uniquement après revue/merge et CI verte.
- Retour arrière : redéployer un artefact d'une release antérieure vérifiée et contrôler son `build-info.json`. Garder Analytics désactivé jusqu'à ce que l'ancien Worker soit remplacé par la version protégée.

## État de production et critères de clôture

À ce stade, le code et les workflows sont prêts à être soumis en PR, mais aucun correctif n'est effectif en production. Le workflow de production n'est déclenché que par `main`; la branche de revue ne publie rien. La clôture opérationnelle nécessite ensuite : PR et CI verte, revue/merge, configuration du secret Cloudflare, déploiement du Worker et des Pages, vérification du marqueur de commit servi et contrôles smoke non destructifs. La release taguée vient après le merge validé.
