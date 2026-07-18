# Audit de nettoyage — V3

Branche `v3-cleanup`. Objectif : réduire le poids du dépôt, supprimer le code
mort, et retirer tout ce qui relève d'une logique payante ou de démonstration.

**Résultat global : 693 Ko → 619 Ko** (−74 Ko, −11 %) hors historique git, et
**−47 Ko de CSS jamais chargé** dans ce qui était déployé à chaque publication.

Tout ce qui est supprimé ci-dessous reste **récupérable via l'historique git**
(`git show <commit>:<chemin>`). Rien n'a été effacé définitivement.

---

## 1. Suppressions certaines (aucune référence, vérifié)

| Fichier / dossier | Taille | Utilisation réelle | Vérification | Action |
|---|---|---|---|---|
| `css/` (5 fichiers) | **47 Ko** | **Aucune** — tout le CSS est en ligne dans les HTML | `grep` sur `.css` + `stylesheet` dans tout le dépôt : 0 balise `<link>` | Supprimé |
| `_legacy/` (7 fichiers) | 160 Ko | Archive de l'ancienne version, jamais chargée | Aucun `<script src>` ne les référence | Supprimé |
| `tarifs.html` | 8 Ko | Page de plans payants | Plus aucun lien après refonte | Supprimé |
| `cloudflare/premium-stripe-worker.js` | 6 Ko | Webhook Stripe pour débloquer le Premium | Jamais déployé ; le Premium n'existe plus | Supprimé |
| `cloudflare/r2-storage-worker.js` + `wrangler.r2.toml` | 8 Ko | Stockage R2 | **R2 abandonné** : nécessite une carte bancaire. Le stockage passe par GitHub | Supprimé |
| `docs/STORAGE-R2.md` | 4 Ko | Doc d'activation R2 | **Contredisait activement** l'architecture retenue → piège pour plus tard | Supprimé |
| `assets/behance-projects.json` | 4 octets | Fichier vide (`[]`) | Écrit — pas lu — par `scripts/sync-behance.js` | Supprimé + script corrigé (`mkdirSync`) |

> ⚠️ Le dossier `css/` était **copié à chaque déploiement** par `deploy-cloudflare.ps1`.
> 47 Ko partaient en ligne à chaque publication sans qu'aucune page ne les charge.

## 2. Code mort supprimé dans les fichiers conservés

| Emplacement | Ce qui partait | Pourquoi |
|---|---|---|
| `app.html` | `isPremium()`, `renderPremium()`, `redeemCode()`, `premAwaitCode()`, onglet `set-tab-premium` | Plus d'offre payante |
| `js/analytics.js` | `toggleDemo()`, `_demoData()`, `_refIcons`, champ `demo` | Fausses statistiques et section Sources |
| `index.html` | Section Témoignages + son CSS (`.rg .rc .rh .rav .rn .rs .rt .rempty`) + son JS | Voir §4 |
| `index.html` | Section Roadmap | Rarement à jour ; annonçait le Premium |
| `classement.html` | `scoreLabel()`, `sortValue()`, `souanptScore()`, `renderFromCache()`, CSS `.controls`/`.sel` | Sélecteur de score retiré |
| `js/cloud.js` | Lecture du document `referrers` | **−1 lecture Firestore par rafraîchissement** (quota gratuit Spark) |

## 3. À vérifier manuellement (non touché)

| Élément | Question ouverte |
|---|---|
| `.github/workflows/deploy.yml` | Déploie le hub sur **GitHub Pages**, alors que la plateforme principale est **Cloudflare Pages**. Deux chemins de déploiement coexistent. Conservé : c'est un repli légitime, mais il faudra choisir. |
| `portal.html` (2 Ko) | Semble actif (portails clients) — conservé. |
| `firebase/firebase-config.js` | **Volontairement versionné.** Les clés Web Firebase sont publiques par conception (elles partent dans le navigateur de chaque visiteur) ; la sécurité vient des règles Firestore. Documenté dans `.gitignore`. |
| `app.html` (199 Ko) | Le plus gros fichier du projet, très au-delà des autres. Découpage à envisager, mais c'est un chantier à part entière (aucun build : le découper implique d'ajouter des `<script>`). |

---

## 4. Décisions qui méritent une explication

### La section « Témoignages » ne montrait rien à personne

Elle lisait `localStorage.hub_reviews`, c'est-à-dire **le stockage du navigateur
du visiteur**. Conséquence : un visiteur qui découvrait le site ne voyait jamais
aucun avis — seul l'auteur voyait les siens. Une vitrine d'avis invisible aux
visiteurs n'a aucune utilité, et la remplir de faux avis était exclu.

Remplacée par **« Pourquoi souanpt.hub »** : trois colonnes de faits vérifiables
dans le produit (gratuité, portabilité, respect de la vie privée).

### Le classement était truquable en un champ

`souanptScore()` commençait par `if (typeof u.score === 'number' && u.score > 0)
return u.score;` — or ce champ vit dans `users/{uid}`, un document que
**l'utilisateur peut écrire lui-même** (`allow write: if owns(uid)`). Écrire
`score: 999999999` suffisait pour occuper la 1re place définitivement.

De plus, la formule pondérait les **vues brutes** (`views * 1`), la seule
métrique gonflable en rechargeant une page — alors que son propre commentaire
annonçait « anti-triche : les vues seules ne suffisent pas ».

Corrigé : le champ `score` n'est plus lu, et les vues brutes sont exclues du
calcul. Vérifié avec des données de test :

| Avant | Après |
|---|---|
| #1 Bob (5 000 vues, 80 uniques, 1 projet) | #1 Cléo (250 uniques, 9 projets, 8 avis) |
| #3 Cléo | #3 Bob |
| — | Un `score` forcé à 999 999 999 → **0 pt, dernier** |

> ⚠️ **Limite restante, à traiter.** Les champs `views`, `visitors`, `projects`…
> du classement sont toujours écrits par le client dans son propre document, donc
> déclarables librement. Pire : **rien ne les met à jour aujourd'hui** — ils
> restent à 0 pour tout le monde depuis la création du compte. Le classement est
> donc actuellement vide de sens. Le correctif est de faire écrire ces champs par
> le Worker statistiques (compte de service) et de les interdire au client dans
> les règles Firestore. À faire avant toute mise en avant du classement.

### Le référent des visiteurs n'est plus collecté du tout

La section « Sources » a été retirée de l'interface. Plutôt que de continuer à
stocker une donnée que plus rien n'affiche, la collecte a été coupée **à la
source** : le traqueur injecté dans les sites publiés n'envoie plus
`document.referrer`, et le Worker ne le classe ni ne l'écrit.

C'est la donnée la plus sensible du lot — elle révèle le parcours de navigation.
Une donnée non collectée n'a besoin ni d'être protégée ni d'être déclarée.

Vérifié sur un site généré : `S({t:'pv',u:uq?1:0,ua:navigator.userAgent})`.

Les anciens documents `referrers` restent en base ; ils ne sont plus ni
alimentés ni lus (pas de migration destructrice).

### La politique de confidentialité était fausse

Elle annonçait « les statistiques de visite (**GoatCounter**) » alors que
GoatCounter a été remplacé par un compteur interne il y a deux versions. Une
déclaration de confidentialité inexacte est un problème en soi : réécrite pour
décrire ce qui est réellement collecté (totaux anonymes : vues, pays, type
d'appareil, projets consultés) et ce qui ne l'est pas (IP jamais stockée,
référent non transmis, aucun profil individuel).

---

## 5. Ce qui n'a **pas** été fait, et pourquoi

| Demandé | Statut | Raison |
|---|---|---|
| `useDismissableLayer()` avec **Radix Popover/Dialog** | Reporté | Radix est une bibliothèque **React**. Le projet est en HTML/JS sans build. À écrire en JS natif (~40 lignes) — prévu au prochain lot. |
| Miniatures : « ne jamais stocker en base64 dans **PostgreSQL** » | Sans objet | Il n'y a pas de PostgreSQL. Les données sont dans Firestore, les fichiers sur GitHub. |
| `SELF_HOSTING.md`, `docker-compose.example.yml`, doc **Supabase/R2** | **Non fait** | Ce serait de la fiction : il n'y a ni Docker, ni Supabase, ni R2 dans ce projet. Écrire une doc d'auto-hébergement pour une architecture inexistante induirait en erreur. |
| Affichage « open source » partout | **Non fait** | Le dépôt principal n'a pas de licence open source. Voir §6. |
| Lazy loading / tree shaking / Brotli / source maps | Sans objet | Aucun bundler : les fichiers sont servis tels quels. Le gain réel était ailleurs — les 47 Ko de CSS mort (§1). |
| Suppression des colonnes `referrers` en base | Volontairement non fait | Suppression de données en production sans sauvegarde. La collecte est arrêtée, c'est ce qui compte. |

## 6. Positionnement : « gratuit » oui, « open source » pas encore

Le cahier des charges demandait d'afficher « gratuit, open source et
auto-hébergeable » partout (§16-22), **puis**, plus loin dans le même document,
de ne **pas** annoncer « entièrement open source » tant que le dépôt principal
n'a pas de licence open source claire.

La seconde consigne l'emporte : elle est postérieure, et surtout elle est
exacte. Le dépôt `souanpt-hub` n'a **aucun fichier LICENSE**. Annoncer « open
source » sans licence est faux — sans licence, tous les droits sont réservés par
défaut, et personne ne peut légalement réutiliser le code.

Formulation retenue partout dans le produit :

- ✅ « gratuit », « aucune fonctionnalité réservée à un paiement »
- ✅ « tes données restent les tiennes », « portable », « exportable »
- ✅ « technologies et formats ouverts »
- ❌ pas de « open source », pas de « auto-hébergeable »

Ces affirmations sont toutes vérifiables aujourd'hui. Le jour où une licence est
ajoutée, le vocabulaire pourra évoluer — pas avant.
