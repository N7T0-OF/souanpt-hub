# Audit P0 — sécurité (v3.4.0)

Trois failles de priorité **P0** relevées lors de l'audit `github-source-de-verite.md`
(§ « à faire ») et corrigées dans cette version. Elles ont un même point commun :
**de l'écriture destinée à un propriétaire s'est retrouvée lisible par n'importe qui.**

- Sortie : `v3.4.0` — commit `8dbf89f`, Pages run `36616075362` (succès, vérifié en ligne)
- Tests : **59 / 59** (page de test locale, non publiée — détail § Tests)
- Déploiement GitHub Pages (`app.html`, `js/*.js`) : **automatique** ✓ vérifié
- Déploiement Cloudflare (le relais `/u/`) : **à vérifier** — voir § Déploiement
- Déploiement des règles Firestore : **MANUEL** — voir § Déploiement

---

## Menace de référence

Toute la chaîne d'authentification GitHub du Hub repose sur un jeton PAT stocké
en clair dans `localStorage['souanpt_auth_v2']` (`js/core.js:189-199`). Ce jeton
donne accès au dépôt privé de l'utilisateur (`{login}-hub-data`, toutes ses
données) et à son site. **Toute exécution de code sur l'origine `souanpt-hub.fr`
ou `n7t0-of.github.io/souanpt-hub` = vol de ce jeton = compromission totale du
compte et des données.** C'est la barre à franchir pour juger d'une faille.

---

## 1. E-mails des utilisateurs en lecture publique

### Constat

| | |
|---|---|
| Écriture | `app.html:3343-3346` (avant correctif, `app.html:3311` : `email: u.email \|\| ''`) dans `users/{uid}` |
| Lecture | `firebase/firestore.rules:49` — `allow read: if true` |
| Exploitation | 1 requête, **sans authentification**, avec la clé Web publique déjà présente dans le code |

```http
GET https://firestore.googleapis.com/v1/projects/souanpt-hub/databases/(default)/documents/users/<uid>?key=<clé Web>
```

Ou, pour tous les profils d'un coup, une `runQuery` sur `users` — c'est
exactement ce que fait déjà `classement.html:167` et `functions/u/[pseudo].js:114`,
deux lectures **légitimes** de la même collection : rien ne distingue une
récolte d'e-mails d'une consultation du classement.

Le champ n'était utilisé nulle part côté serveur (`cloudflare/notify-worker.js`
travaille sur `src.contact.email`, jamais sur le profil) et la page Compte
possède déjà un repli sur Auth : `app.html:2091` lit `p.email || g?.email`.

### Correctif

- `app.html:3343-3346` — l'e-mail n'est **plus jamais écrit** dans le profil ;
  `name` et `avatar` restent. Le repli `Cloud.user().email` (`app.html:2091`,
  `:2112`) assure l'affichage sur la page Compte.
- `js/cloud.js:240` — `Cloud.scrubPublicSecrets()` supprime le champ des
  documents déjà écrits (`FieldValue.delete()`), appelé **à chaque connexion**
  depuis `app.html:3256`, en tâche de fond (plafond 8 s, jamais bloquant).
- `firebase/firestore.rules:30-52` — `users/{uid}` refuse d'**ajouter** un
  `email` non vide ; une valeur héritée reste modifiable *in situ* et sa
  suppression est acceptée (c'est ce qui rend la purge possible).

### Résidu

Aucun : l'e-mail reste consultable côté Auth Google pour son propriétaire, et
nulle part ailleurs. Un e-mail déjà public dans l'ancien corpus est effacé au
premier login de son propriétaire (pas avant — il faudrait connaître l'UID, ce
qui est justement le sens de la collecte qu'on empêche).

---

## 2. Mot de passe de portail en clair

### Constat

Trois endroits publics, tous avec le **clair** :

| Endroit | Avant | Après |
|---|---|---|
| Doc Firestore `portals/{id}` (`allow read: if true`) | `js/cloud.js:203` → `password: p.password \|\| ''` | `js/cloud.js:211` → `FieldValue.delete()` + `passwordHash`/`passwordSalt` |
| Page publiée sur GitHub Pages (`generatePortal`) | `js/core.js:1997` → `JSON.stringify(String(p.password))` dans le HTML | `js/core.js:2051` / `:2107-2109` → `{salt, hash, rounds}` uniquement |
| Formulaire d'édition (navigateur du propriétaire) | clair, conservé | clair, **conservé** — c'est la seule copie de travail |

Le document Firestore est le plus grave : la page `portal.html:40` le lit sans
compte, mais n'importe qui pouvait le lire aussi, y compris en listant la
collection entière (`:runQuery`, aucune auth).

### Correctif

- **Hachage** : SHA-256 implémenté en local, synchrone et autonome
  (`js/core.js:1877`), **4096 itérations** salées par tour
  (`js/core.js:1944`, constante `PORTAL_HASH_ROUNDS` à `js/core.js:1870`),
  sel aléatoire de 16 octets par portail (`js/core.js:1935`).
  Synchrone parce que `generatePortal()` rend une chaîne (deployPortal,
  `document.write` de `portal.html`) : impossible d'attendre `crypto.subtle`.
- **Écriture** : `portalSave()` (`app.html:3005-3015`) calcule le couple
  sel + hachage à l'enregistrement ; effacer le mot de passe efface aussi le
  hachage. `Cloud.savePortalDoc()` (`js/cloud.js:193-220`) n'écrit jamais le
  clair et **efface** l'éventuel `password` hérité (un `set(merge)` ne supprime
  rien — d'où `FieldValue.delete()`).
- **Lecture** : `portalGate()` (`js/core.js:1953`) fabrique les données du
  verrou ; la page publiée embarque `String(sha256hex)` (même source, aucune
  duplication) et recalcule les 4096 tours à la saisie
  (`js/core.js:2109`). Ni `portal.html` ni la page publiée ne contiennent le clair.
- **Purge** : `js/cloud.js:240-290` remplace le `password` des documents déjà
  publiés, une fois (marqueur local `secretScrubbedAt`, idempotent).
- **Ancien lien** : `portalRegen()` (`app.html:3056-3064`) supprimait l'ancien
  document Firestore en gardant le lien actif — il le supprime maintenant,
  conformément à ce que promet son `confirm()`.
- **Règles** : `firebase/firestore.rules:37-65` — `portals/{id}` refuse d'ajouter
  un `password` non vide (création) et toute modification qui le changerait
  (mise à jour) ; la valeur héritée peut être conservée ou supprimée.

### Pages GitHub publiées avant la correction

Le HTML déjà déposé sur GitHub Pages contient encore le clair : la purge
Firestore ne peut pas l'atteindre. `scrubPublicSecrets()` les détecte
(`stale`) et `app.html:3260-3263` affiche un bandeau invitant à **republier** —
chaque publication régénère la page (`js/core.js:2137`) avec le hachage.

### Résidu assumé

- Le hachage et le sel sont publics : un mot de passe **faible** peut être
  retenu hors ligne (4096 tours = quelques secondes pour un mot de passe à 4
  caractères). C'est le coût structurel d'un verrou que le navigateur doit
  vérifier sans serveur ; le remède est un mot de passe correct de 8+
  caractères, pas un autre algorithme.
- Le clair reste dans `localStorage['hub_portals']` et dans les copies privées
  (`users/{uid}/data`, dépôt `{login}-hub-data`) — même statut que le PAT,
  traité en T5.

---

## 3. Relais `/u/<pseudo>` : HTML tiers exécuté sur notre origine

### Constat

`functions/u/[pseudo].js` **relaie** la page du créateur (et non une simple
redirection) pour que l'adresse reste `souanpt-hub.fr/u/<pseudo>` :

1. un créateur publie sur son propre GitHub Pages un HTML d'attaque ;
2. il déclare cette adresse dans son profil (`siteUrl` — champ libre,
   `js/core.js` le pousse depuis la config) ;
3. toute victime qui ouvre `/u/<pseudo>` exécute ce HTML **sur l'origine du
   Hub**, avec accès à `localStorage` → **vol du PAT de la victime**.

C'est la faille la plus grave des trois : elle transforme le relais en
générateur d'attaques, et un pseudo se crée gratuitement.

### Correctif

- **`Content-Security-Policy: sandbox …`** en tête de réponse
  (`functions/u/[pseudo].js:33-34` et `:166`) — **sans `allow-same-origin`**.
  Le document reçoit une **origine opaque** : aucun `localStorage`, aucun
  cookie, aucun service worker de notre domaine, aucun accès au `parent`.
  Restent autorisés `allow-scripts allow-popups allow-forms allow-modals
  allow-top-navigation allow-downloads` : le site du créateur s'utilise
  normalement.
- **Validation de schéma** : `safeUrl()` (`:54-60`) n'accepte que `http:`/`https:`,
  après normalisation par le parseur d'URL. `javascript:`, `data:` et les formes
  invalides tombent sur la page « Site non publié » **sans requête sortante**.
- **`<base>` échappée et normalisée** : `esc()` (`:46-49`) + URL finale du
  fetch (`:153-158`) → une valeur de profil ne peut plus casser hors de
  l'attribut, et les liens relatifs restent pointés vers l'origine réelle.
- **Redirections sûres** : `redirectTo()` (`:83-86`) attrape le `TypeError` de
  `Response.redirect` au lieu de laisser la fonction tomber en 500.
- En-têtes `x-content-type-options: nosniff` et
  `referrer-policy: strict-origin-when-cross-origin` (`:167-168`).

Les autres pages de `functions/` (`estimate/`, `c/`, `request/`) rendent du HTML
**côté serveur depuis Firestore, avec `esc()`** : elles ne relayent pas de HTML
tiers, aucune correction n'y était nécessaire.

### Compromis connu : l'analytics du site relayé

Le bloc de mesure du site généré stocke son identifiant visiteur dans
`localStorage` (`js/core.js:1660`) — dans une origine opaque, cette lecture
lève et le `try/catch` l'absorbe : la page est toujours comptée comme visiteur
unique. **Uniquement pour les pages servies sous `/u/<pseudo>`** : un créateur
qui partage son adresse `*.github.io` ou son domaine perso (le cas normal) n'est
pas affecté.

---

## Déploiement

| Élément | Déploiement | Statut |
|---|---|---|
| `app.html`, `js/*.js` | GitHub Pages (`main` → build) | ✅ **automatique** — run `36616075362`, `success` ; les 3 fichiers vérifiés en ligne (contiennent `sha256hex`, `scrubPublicSecrets`, le bloc P0) |
| `functions/u/[pseudo].js` | Cloudflare Pages Functions | ⚠ **à vérifier** (voir ci-dessous) |
| `firebase/firestore.rules` | **Rien ne le déploie** (pas de `firebase.json`, pas de CI Firebase) | ⚠ **manuel** |

### ⚠ Le relais `/u/` est le seul correctif pas encore vérifié en ligne

`cloudflare/README.md` §1 décrit un projet Pages **connecté au repo** (chaque
push redéploie) — dans ce cas, `functions/u/[pseudo].js` part automatiquement.
Mais `deploy-cloudflare.ps1` décrit un déploiement **direct via wrangler**
(« sans GitHub »), qui demande Node.js : ni l'un ni l'autre n'est vérifiable
depuis cette machine (DNS de `souanpt-hub.fr` / `souanpt*.pages.dev` non
résoluble ici, pas de CLI Cloudflare).

**À faire une fois** : ouvrir le site en production et contrôler qu'une page
`/u/<pseudo>` renvoie bien

```
content-security-policy: sandbox allow-scripts allow-popups allow-forms allow-modals allow-top-navigation allow-downloads
x-content-type-options: nosniff
```

Si le projet Pages n'est pas connecté au repo, lancer `.\deploy-cloudflare.ps1`
(Node requis) : le dossier `functions/` n'est **pas** exclu de la copie publiée
(`robocopy`, `deploy-cloudflare.ps1:29-31`) — mais rien ne prouve ici que
`wrangler pages deploy` en embarque la construction. En cas de doute, appliquer
la configuration de `cloudflare/README.md` §1 (projet **Connect to Git**) : c'est
la seule qui garantisse que `functions/` part à chaque push.

Tant que ce n'est pas déployé, la faille 3 reste ouverte **sur le domaine de
production** : les failles 1 et 2, elles, sont closes par le client GitHub Pages
(déjà en ligne).

### ⚠ Action manuelle requise

Les correctifs **client suffisent** à fermer les trois failles : le code n'écrit
plus d'e-mail ni de mot de passe en clair, et la purge nettoie ce qui existait.
Les règles sont la **seconde couche** (elles protègent contre un client obsolète
ou un écrit malveillant).

Pour l'activer : **Firebase console → Firestore → Règles → coller le contenu de
`firebase/firestore.rules` → Publier** (procédure déjà décrite dans
`firebase/FIREBASE.md` § étape 7, mise à jour pour insister sur le caractère
manuel).

Effet de bord possible une fois les règles déposées : un visiteur ayant un
`app.html` **en cache** (durée `max-age=600`) et qui crée son profil pour la
première fois sera refusé, avec message d'erreur — il lui suffit de recharger.
Les écritures suivantes (pseudo, siteUrl, opt-in classement) ne portent aucun
`email` et ne sont pas concernées.

---

## Tests

Page locale `p0-tests.html` + `sandbox-probe.html` (supprimées avant commit,
non publiées sur Pages), serveur statique `localhost:8766` — **59/59 verts** :

| Bloc | Vérifié |
|---|---|
| SHA-256 (10) | vecteurs officiels `''`/`abc` ; comparaison octet à octet avec `crypto.subtle` sur 8 chaînes (UTF-8 multibyte, emoji, longueurs 55/56/64 = frontières de bourrage) |
| Hachage (4) | sel 32 hex, déterminisme, sensibilité au sel et au mot de passe |
| Page du portail (15) | aucun `Secret123` dans le HTML ; verrou présent ; `{"salt":…,"hash":…,"rounds":4096}` embarqué ; le hash **authentifie** le bon mot de passe et **refuse** un autre ; réutilisation du couple sel+hachage ; pas de verrou sans mot de passe |
| Document public (4) | `password` = `FieldValue.delete()`, hachage + sel écrits, réutilisation du couple existant, écrit dans `portals/{id}` |
| Purge (9) | 1 e-mail + 1 portail nettoyés, ancien lien GitHub signalé, `AncienMdp` nulle part dans les écritures, marqueur posé, **2ᵉ exécution = 0 écriture**, portail jamais publié intact |
| Relais (11) | source chargée, CSP posée sur la réponse et **sans `allow-same-origin`**, `nosniff` + `referrer-policy`, `<base>` injectée, HTML relayé intact, `javascript:` → 404 sans requête, injection d'attribut encodée (`%22%3E%3Cscript%3E`) |
| Sandbox (6) | iframe `sandbox="allow-scripts …"` : scripts **toujours exécutés**, `self.origin === "null"` et `event.origin === "null"` (origine opaque), `localStorage` / `document.cookie` / `parent.localStorage` / `parent.document` → **`SecurityError`** |
| Console | `app.html` : **0 message** au niveau warning/error |

Le test du sandbox passe par l'attribut `sandbox` d'une iframe, de sémantique
identique à la directive CSP `sandbox` : le header HTTP lui-même ne peut pas être
exercé localement (le serveur statique ne l'envoie pas), il est vérifié par
inspection de la source du relais + présence de l'en-tête dans la `Response`.

---

## Hors périmètre (volontairement)

- ~~**T5** — le PAT reste en clair dans `localStorage`~~ → **livré en v3.5.0** :
  device flow via relais Cloudflare, jeton déplacé dans un cookie `HttpOnly`,
  migration en un clic des PAT existantes — voir `docs/audits/t5-github-auth.md`.
- **`estimates/{code}` et `requests/{token}`** sont publics en lecture *par
  conception* (lien client sans compte) et ne contiennent ni prix plancher, ni
  taux horaire, ni marge — vérifié dans `firebase/firestore.rules:82` (estimates)
  et `:125` (requests).
  Le `contact.email` du client y figure **volontairement** : c'est la donnée que
  le créateur doit voir.
- **`cfg.email` dans le site publié** : c'est l'adresse de contact que le
  créateur saisit dans Contact (`js/canvas.js:1147`) et qu'un portfolio doit
  afficher en `mailto:` — publiée volontairement, contrairement à l'e-mail du
  compte Google.
- **Domaines codés en dur** (`souanpt-hub.pages.dev`, etc.) : sujet de confort,
  pas de sécurité.
