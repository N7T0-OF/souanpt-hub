# Sankai Life — objectif général et feuille de route

Date : 21 octobre 2026  
État : cadrage uniquement; aucune migration ni intégration n'est implémentée par ce document.

## Objectif général d'automatisation

Rendre les livraisons de Sankai Life reproductibles, traçables et vérifiables de la modification au déploiement : chaque changement doit déclencher automatiquement les contrôles adaptés, produire des artefacts limités aux fichiers publics nécessaires, et relier chaque build à son commit et à sa version.

L'automatisation peut préparer une release et effectuer les déploiements prévus après validation des contrôles. Elle doit s'arrêter avant toute fusion protégée, migration de données réelles, publication de release ou activation d'un service de production lorsque la revue, un secret, une autorisation humaine ou une vérification d'environnement manque. Un état « réussi » doit toujours correspondre à une action réellement exécutée; une étape ignorée doit apparaître comme ignorée ou bloquante, jamais comme un déploiement réussi.

Critères généraux :

- CI sur les branches de travail et les pull requests : syntaxe, tests, contrats, configuration et artefacts.
- Artefacts allowlistés, sans données utilisateur, secrets, clés ou documents internes.
- Provenance vérifiable : version, SHA du commit, date et canal de build.
- Secrets conservés dans le gestionnaire du fournisseur, avec permissions minimales et sans valeur de secours fictive.
- Déploiement et smoke tests non destructifs; résultats et URL rattachés au SHA publié.
- Retour arrière documenté et vérifiable avant toute opération sur les données.
- Revue et validations humaines conservées pour les opérations irréversibles ou sensibles.

## Architecture cible à étudier

Le dépôt Sankai Life est le candidat pour la cible, sous réserve de l'audit de ses sources et de la confirmation de ses accès. La migration doit avancer par composants versionnés et adaptateurs, sans supprimer les dépôts d'origine avant une période de stabilité et une sauvegarde testée.

```text
apps/
  web/             dashboard et profils publics issus de Souanpt Hub
                   (installable sur téléphone et tablette : manifeste + service worker, pas d'APK)
packages/
  schemas/         contrats communs versionnés
  profile/         identité, profil public et portfolio
  business/        clients, projets et devis
  sync/            manifeste, adaptateurs et résolution de conflits
services/
  auth/ profiles/ analytics/ notifications/
integrations/
  harvey/          adaptateur facultatif, moteur maintenu séparément
docs/migration/
```

Cette structure est une proposition à valider; elle ne justifie pas une réorganisation immédiate.

## Étapes et critères d'acceptation

### 1. Inventaire et contrats

- Récupérer des copies de travail de Souanpt Hub, Sankai Life et Harvey, puis consigner les SHA, licences, dépendances, workflows, secrets requis et commandes de test.
- Définir un `userId` stable, indépendant du fournisseur de connexion, et des contrats versionnés pour identité, profils publics, projets, consentements et synchronisation.
- Critère : chaque dépôt possède un snapshot restaurable; les schémas sont documentés et testés avec des données synthétiques.

### 2. Identité et comptes

- Prévoir la connexion GitHub et une connexion classique avec des identités liées au même `userId`.
- Définir récupération de compte, liaison/déliaison, révocation de session, suppression et règles de confidentialité.
- Critère : tests couvrant comptes liés, doublons, perte d'accès au fournisseur, révocation et séparation des données entre utilisateurs.

### 3. Dépôt privé personnel

- Définir le stockage personnel privé, ses quotas, sauvegardes, contrôle d'accès et règles d'export.
- Ne pas rendre un dépôt privé public par défaut; les profils publics ne publient que des champs explicitement choisis.
- Critère : tests d'autorisation croisée démontrant qu'un utilisateur ne peut ni lire ni modifier les données privées d'un autre.

### 4. Premier profil partageable

- Construire un profil public minimal à partir d'un schéma explicite et d'un aperçu avant publication.
- Ajouter consentement, retrait de publication, URL stable, validation des médias et mécanisme de signalement.
- Critère : un compte de test peut publier, modifier et dépublier son profil; les données privées restent exclues de l'artefact public.

### 5. Migration de Souanpt Hub

- Migrer les fonctions web par lots derrière des adaptateurs; conserver les URLs utiles et prévoir la compatibilité des données existantes.
- Faire d'abord une répétition sur snapshot et comptes synthétiques, mesurer les résultats et tester le retour arrière.
- Critère : parité des fonctions convenues, aucune perte détectée sur les jeux de test et restauration démontrée avant une migration réelle.

### 6. Version mobile du site (remplace l'application Android)

Décision du 20 novembre 2026 : Sankai Life / Souanpt Hub reste **uniquement un site**. Pas d'APK, pas de publication Google Play, pas d'AdMob. Sur téléphone et tablette, le site s'installe comme une application web (« Ajouter un raccourci »).

- Manifeste (`manifest.webmanifest`), icônes (`icons/`), service worker minimal (`sw.js` : page hors ligne et icônes seulement, aucune page ni réponse d'API en cache) et bouton `js/install-shortcut.js`, affiché uniquement sur téléphone et tablette.
- Critère : site installable sur Android (fenêtre native du navigateur) et sur iPhone/iPad (instructions Partager → Sur l'écran d'accueil) ; aucune donnée privée dans le cache ; mise en page utilisable à 375 px.

### 7. Intégration ultérieure de Harvey

- Garder le moteur Python séparé et l'intégrer derrière une API/adaptateur versionné avec authentification, limites d'usage et permissions minimales.
- Critère : l'indisponibilité de Harvey ne bloque ni l'identité ni les fonctions principales; aucune donnée privée n'est transmise sans consentement explicite.

### 8. Google Play et AdMob — abandonnés

Retirés de la feuille de route le 20 novembre 2026 avec l'application Android (voir étape 6). Le dépôt `sankai-life` et sa branche `claude/play-readiness` restent en l'état, sans suite prévue ; rien n'a été supprimé.

## Ordre de travail proposé

1. Audit des dépôts et définition des contrats.
2. Prototype d'identité et tests d'isolation.
3. Dépôt privé et premier profil public partageable.
4. Migration incrémentale de Souanpt Hub.
5. Version mobile installable du site.
6. Adaptateur Harvey facultatif.

Chaque étape commence par un périmètre livrable, une branche, une CI verte et un aperçu vérifiable. Les étapes qui touchent à des utilisateurs ou à la production attendent leur approbation et les sauvegardes requises.
