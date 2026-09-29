# souanpt.hub — Creator OS

Dashboard tout-en-un : Portfolio · Behance Sync · Éditeur de site · Avis visiteurs · Facturation · Clients · QR · Backup GitHub — 100% gratuit, zéro serveur.

## Architecture V2 — Cloudflare est la plateforme principale

```
SOUANPT.HUB V2

Cloudflare  ★ PLATEFORME PRINCIPALE
├── Pages    → héberge le hub (frontend)
├── Workers  → API & fonctions serveur (relais Discord, statistiques…)
├── DNS      → domaine personnalisé (hub.souanpt.fr, souanpt.app…)
└── CDN/SSL  → cache, performances, sécurité

Firebase (projet : souanpt-hub)  ★ BACKEND
├── Authentication → comptes (Google, Discord via Worker)
├── Firestore      → données temps réel (profils, portails, clients, factures, avis, classement)
└── Storage        → petites images (Phase 3)

GitHub  (optionnel)
├── Sauvegarde du code source + historique Git
├── Sites générés & portails fallback (GitHub Pages, repo souanpt-folio/stock)
└── Sauvegarde privée des données ({user}-hub-data)
```

## Déployer le hub — 2 modes

**Mode A — Déploiement direct Cloudflare (officiel, sans GitHub)**
Double-clique sur `deploy-cloudflare.ps1` → le site part directement sur Cloudflare Pages.
Prérequis une seule fois : installer Node.js LTS (nodejs.org) + autoriser l'outil au
premier lancement. ⚠ Nécessite un projet Pages en mode **Direct Upload** (un projet
Pages « connecté à Git » n'accepte pas l'upload direct — crée un nouveau projet
« Upload assets » si besoin, l'URL .pages.dev change alors).

**Mode B — Via GitHub (automatique si le projet Pages est connecté au repo)**
`git push` → Cloudflare détecte le commit → rebuild automatique. Simple et sans
installation ; GitHub sert alors de déclencheur, pas d'hébergeur.

Dans les deux cas, garder GitHub à jour reste recommandé : c'est la sauvegarde du code.

## Architecture (2 repos)

| Repo | Rôle |
|---|---|
| `souanpt-hub` | **Ce dashboard** (ne jamais déployer le site dessus — protection intégrée) |
| `souanpt-folio` (ou autre) | **Le site public généré**, déployé par le pipeline |
| `{user}-hub-data` | Backup privé automatique de tes données |

```
hub/
├── index.html      # Landing page publique (vitrine, style haunt.gg)
├── app.html        # SPA complète du dashboard (espace privé)
├── js/
│   ├── core.js     # GitHub API, Auth (token OU session relais), SiteConfig, Générateur, Deploy, Behance RSS, Avis
│   ├── gh-auth.js  # T5 : connexion GitHub SANS jeton dans le navigateur (relais + device flow)
│   ├── hub-data.js # registre unique des collections (export, sauvegarde, miroir)
│   ├── hub-sync.js # GitHub = source de vérité : tirage incrémental à la connexion
│   ├── hub-images.js # images hors du localStorage (miniature locale + plein format sur GitHub)
│   └── ui.js       # GHPage, Éditeur, BubbleWidget, navigation
├── functions/
│   ├── api/auth.js # relais d'auth : device flow, import de PAT, cookie HttpOnly
│   ├── api/gh.js   # proxy GitHub : l'Authorization est fabriqué ici, jamais côté client
│   └── u/…         # relais de partage /u/<pseudo> (page publiée en origine opaque)
└── scripts/sync-behance.js   # sync RSS optionnelle (Node, sans clé API)
```

Navigation : la racine (`/`) affiche la vitrine publique ; le bouton **Tableau de bord** ouvre `app.html`. Dans le dashboard, cliquer le logo souanpt.hub ramène à la vitrine.

## Connexion GitHub — 2 façons

**Sans token (recommandé, v3.5.0)** — voir `docs/audits/t5-github-auth.md` :

1. **Intégrations → GitHub → « Se connecter avec un code »** : GitHub affiche un
   code à 8 caractères à saisir une fois sur
   [github.com/login/device](https://github.com/login/device) ;
2. le jeton est déposé dans le **cookie `HttpOnly` du relais** (`functions/api/`) :
   il n'est jamais écrit dans `localStorage`, et toutes les requêtes API partent
   de `/api/gh` ;
3. un compte déjà en PAT migre en un clic : **« 🔒 Sécuriser ma connexion »**
   vide le navigateur de son token.

**Avec un token (repli, fonctionne partout — y compris sans relais)** :

1. Génère un token sur [github.com/settings/tokens](https://github.com/settings/tokens/new?scopes=repo,workflow&description=souanpt.hub) — scope `repo`
2. **Intégrations → GitHub** → colle le token → Se connecter
3. Le repo privé `{user}-hub-data` (backup) est créé automatiquement

Dans les deux cas le dépôt `{user}-hub-data` est créé automatiquement et le
comportement de l'app est identique.

## Sauvegarde des données — registre unique

La liste des collections vit **une seule fois**, dans `js/hub-data.js` : elle
alimente l'export JSON, la sauvegarde GitHub **et** le miroir Firestore (avant,
trois tableaux divergents laissaient `hub_portals`, `hub_catalog`, `hub_media`,
`hub_files` et `hub_pricing` sans aucune sauvegarde).

Dépôt `{user}-hub-data` :

```
data/manifest.json     table des matières (version, comptes, sha256 de chaque fichier)
data/projects.json     clients, factures, catalogue, portails, avis, liens, médias,
…                      fichiers, devis, grille tarifaire, config du site, réglages
data/*.partN.json      découpé automatiquement au-delà de ~440 Ko (limite API GitHub)
media/<empreinte>.jpg  couvertures pleine taille (hors data/ → jamais purgées par la sauvegarde)
backup.json            ancien format : plus écrit, toujours lu (restauration)
```

- **Rien ne change → 0 requête d'écriture** (comparaison `sha256` contre le
  manifeste distant, 1 lecture) ;
- **sinon 1 seul commit atomique**, uniquement pour les fichiers différents ;
- 30 s minimum entre deux écritures, 1 jeu de timers par session ;
- **GitHub = source de vérité** : à chaque connexion, le hub *tire* ce qui a
  changé depuis un autre appareil (résolution en 3 voies sur la baseline
  `souanpt_sync_hashes` — en cas de conflit, la version de l'appareil en main
  est conservée et un avertissement s'affiche) ;
- bouton **Paramètres → Intégrations → Sauvegarder maintenant** : force le
  passage et affiche le résultat réel ; **↓ Récupérer depuis GitHub** fait le
  tirage ciblé à la demande ;
- bouton **☁ Restaurer la sauvegarde complète** : remplace *tout* par la
  sauvegarde (réinstallation) — avec repli automatique sur l'ancien
  `backup.json` ;
- **les images sortent du navigateur** (`js/hub-images.js`) : le quota de
  5 MiB du `localStorage` ne porte plus que des miniatures 420 px, les
  couvertures pleine taille vivent en `media/` sur le dépôt privé et sont
  réinjectées à la volée à la publication, dans l'aperçu et dans l'export
  autonome. Bouton **Stockage → Sortir les images du navigateur** pour
  migrer l'existant (voir `docs/audits/images-out-of-localstorage.md`).

Détails : `docs/audits/backup-unification.md` (T1+T2) et
`docs/audits/github-source-de-verite.md` (T3).

## Sécurité (P0)

Trois failles corrigées en **v3.4.0** — détail, tests (59/59) et résidus dans
`docs/audits/security-p0.md` :

- **l'e-mail du compte n'est plus écrit en clair** dans `users/{uid}`, un
  document lisible par tous (annuaire, `/u/<pseudo>`) : il reste dans Auth
  Google, et une purge automatique le retire des documents déjà écrits ;
- **le mot de passe d'un portail n'est plus écrit en clair** : ni dans
  `portals/{id}` (lien du client, sans compte), ni dans la page publiée —
  seul un SHA-256 itéré 4096× avec sel de 16 octets y figure ; le clair ne
  quitte que le navigateur du propriétaire et les copies privées ;
- **le relais `/u/<pseudo>` sert la page d'un créateur dans une origine
  opaque** (`Content-Security-Policy: sandbox`) : son JavaScript ne peut plus
  lire `localStorage`, donc plus voler le jeton GitHub du visiteur.

⚠ Les règles Firestore ne sont **pas** déployées par la CI. Après chaque
modification de `firebase/firestore.rules` : Firebase console → Firestore →
**Règles** → coller → **Publier** (voir `firebase/FIREBASE.md` § étape 7).
Les correctifs client ferment les trois failles sans elles ; les règles sont la
seconde couche, contre un client obsolète ou une écriture malveillante.

⚠ Le correctif du relais `/u/` vit dans `functions/` : il ne prend effet qu'une
fois Cloudflare Pages redéployé (projet connecté au repo, ou
`deploy-cloudflare.ps1`). Vérification et configuration :
`docs/audits/security-p0.md` § Déploiement.

## Sécurité — le jeton quitte le navigateur (T5, v3.5.0)

Le hub ne stocke plus aucun secret GitHub quand le relais est présent :

- **connexion par code** (device flow GitHub) : `github.com/login/device`,
  aucun `client_secret` à gérer — le relais n'a besoin que de `GH_CLIENT_ID` ;
- **le jeton vit dans un cookie `HttpOnly`** (90 j, `Secure`, `SameSite=None`)
  tenu par `functions/api/auth.js` : `localStorage` ne contient plus que
  l'identité (`login`, `avatar`) ;
- **`/api/gh` fabrique l'en-tête `Authorization` côté serveur** : le navigateur
  appelle le relais en `credentials:'include'`, jamais `api.github.com`
  directement (transport unique `GH.req`) ;
- **liste blanche d'origines** (`GH_AUTH_ORIGINS` + défauts) : un autre site ne
  peut pas jouer des cookies de la victime ;
- **migration des PAT existantes** en un clic (« Sécuriser ma connexion »).

Sans relais (hub servi par GitHub Pages seul), le sondage échoue silencieusement
et **tout reste en mode token, inchangé**. Tests 105/105, résidus (cookies
tiers refusés par Safari, mode PAT volontairement conservé) et étapes de
déploiement manuelles : `docs/audits/t5-github-auth.md`.

## Pipeline de déploiement

1 clic 🚀 Publier :
1. Récupère projets + avis approuvés
2. Génère le site (navbar flottante, folios cliquables, section avis)
3. **1 seul commit atomique** (index.html + config + .nojekyll) — évite les builds Pages concurrents
4. Active GitHub Pages puis **vérifie le build** (retry auto si erreur)

## Behance — sans clé API

L'API Behance est fermée (Adobe). La sync passe par le **flux RSS public** :
- Page **Behance Sync** → pseudo → Importer
- Chaque projet arrive avec **titre + lien cliquable + couverture + tags**
- Sync auto toutes les 30 min quand le hub est ouvert

## Avis visiteurs

- Sur le site publié : bouton « ✎ Laisser un avis » (nom, étoiles, texte) → crée une issue GitHub `[AVIS]` sur le repo du site
- Dans le hub : page **Avis** → 📥 Relever les avis (auto toutes les 5 min) → **Approuver / Refuser**
- Les avis approuvés apparaissent sur le site au prochain déploiement
