# T5 — GitHub sans aucun jeton dans le navigateur

*Version : v3.5.0 · Statut : **livré** · Tests : **105/105***

## 1. Le problème

Jusqu'ici, la connexion GitHub stockait une **PAT classique en clair** dans
`localStorage['souanpt_auth_v2']` (`Auth`, `js/core.js`) :

- créée **à la main** par l'utilisateur (aller-retour sur github.com, scopes à
  cocher, copier-coller) ;
- **jamais expirée, jamais rotée** : un jeton valable des années ;
- portée **maximale** (`repo`, donc l'intégralité des dépôts privés) ;
- **lisible par tout script exécuté sur l'origine du hub** : XSS, page relayée,
  extension ou simple lecture de `localStorage`.

Le P0 (v3.4.0) a fermé la porte la plus grossière — le relais `/u/<pseudo>`
n'exécute plus le HTML d'autrui dans notre origine (`CSP: sandbox` sans
`allow-same-origin`), donc ce HTML ne lit plus `localStorage`. Il restait à
supprimer **la cause racine** : le secret lui-même ne devait plus exister côté
client.

**Objectif T5** : le navigateur ne contient plus aucun secret GitHub, et le
mode token reste disponible en repli (zéro régression si le relais est absent).

## 2. Ce que GitHub autorise — faits vérifiés

| Fait | Source |
|---|---|
| Le device flow réclame **seulement** un `client_id` : « The `client_secret` is not needed for the device flow » | docs GitHub, *Authorizing OAuth apps* |
| `POST github.com/login/device/code` puis polling `POST github.com/login/oauth/access_token` | idem |
| Ces endpoints **refusent le CORS navigateur** (pas de `Access-Control-Allow-Origin`, preflight non supporté) | communauté GitHub (discussion #40077, #169674) → **un relais serveur est obligatoire** |
| Créer une OAuth App / GitHub App est **impossible via API** : manipulation manuelle sur github.com | contrainte produit, inchangée |
| Un jeton OAuth (`gho_…`) s'utilise exactement comme une PAT sur l'API REST | idem |

Conséquence : T5 = **un relais Cloudflare Pages** (déjà présent dans ce projet
via `functions/`) + un `client_id` à monter une seule fois.

## 3. Architecture

```
Navigateur (hub)                     Relais Cloudflare (functions/api/)        GitHub
─────────────────                    ───────────────────────────────────        ──────
GhSession.deviceFlow()  ── POST ───▶ /api/auth?op=device   ──▶ /login/device/code
   affiche « ABCD-EFGH »             /api/auth?op=poll      ──▶ /login/oauth/access_token
   + sondage toutes les 5 s               │                       │
                                          │◀── access_token ───────┘  (JAMAIS renvoyé)
                                          ▼
                                   cookie hub_gh  (HttpOnly, Secure,
                                                   SameSite=None, 90 j)
Auth.setSession(profil)  ── GET ───▶ /api/gh?path=/repos/…
GH.req()  (aucun header               │  ajoute Authorization à partir
 Authorization côté client)           │  du cookie, puis relaie la réponse
                                     └──────────────▶ api.github.com
```

- **Aucun secret côté client** : le JavaScript ne reçoit que le profil
  (`login`, `name`, `avatar_url`), jamais le jeton — ni dans le corps, ni dans
  un en-tête lisible.
- **Deux entrées vers la même session** :
  1. **device flow** (1 clic, requiert `GH_CLIENT_ID`) ;
  2. **migration d'une PAT existante** (`op=import`) : le jeton part une fois,
     devient cookie, le `localStorage` est vidé. Aucun `client_id` nécessaire →
     disponible **dès le déploiement du relais**.
- **État = le cookie lui-même** : le relais est sans état, pas de base, pas de
  secret d'application (aucun `client_secret` à gérer ni à fuit).
- **Liste blanche d'origines** : `corsHeaders()` n'émet
  `Access-Control-Allow-Credentials` que pour les origines déclarées
  (`GH_AUTH_ORIGINS` + défauts). Sans cela, n'importe quel site pourrait
  appeler le relais « avec les cookies de la victime ».

### Endpoints

| Endpoint | Rôle |
|---|---|
| `GET /api/auth?op=status` | présence du relais, `configured`, session encore valide → profil |
| `POST /api/auth?op=device` | obtient `user_code` / `device_code` (501 si `GH_CLIENT_ID` absent) |
| `POST /api/auth?op=poll` | sondage → `{pending,interval}` ou `{user}` + cookie |
| `POST /api/auth?op=import` | vérifie une PAT reçue → cookie (401 sinon) |
| `POST /api/auth?op=logout` | efface le cookie |
| `ANY /api/gh?path=/…` | proxy : fabrique `Authorization` depuis le cookie, relaie `api.github.com` |

## 4. Changements

| Fichier | Changement |
|---|---|
| `functions/api/auth.js` | **nouveau** — device flow, import, logout, statut, cookies, CORS |
| `functions/api/gh.js` | **nouveau** — proxy GitHub avec cookie (SSRF impossible : cible reconstruite depuis un chemin) |
| `_routes.json` | `"/api/*"` ajouté aux routes qui invoquent les Functions |
| `js/gh-auth.js` | **nouveau** — `GhSession` : sondage du relais, device flow, migration, logout |
| `js/core.js` | `GH.relayBase/relayMode/authHeaders/req` (transport unique), `Auth.setSession/isRelay/ok` étendu, `connectGitHubRelay()` + `afterGithubConnect()` partagés, **tous les tests `!Auth.token()` convertis en `!Auth.ok()`** (13 dans `core.js`) |
| `js/hub-images.js` | `ready()` repose sur `Auth.ok()` ; lecture du plein format via `GH.req` |
| `js/hub-sync.js` | garde `!token` → `!Auth.ok()` |
| `js/ui.js` | gardes `!token` → `!Auth.ok()` ; le bouton « Sécuriser ma connexion » apparaît après une connexion PAT |
| `app.html` | porte de connexion et carte Intégrations : bouton **« Continuer avec GitHub »** (code à 8 caractères), **« 🔒 Sécuriser ma connexion »**, panneau de code + compte à rebours, `renderGhConnectState()`, script `js/gh-auth.js` |

Pourquoi convertir les gardes : en mode relais `Auth.token()` est **vide** alors
que la connexion est bonne. `Auth.ok()` est devenu le seul test de connexion
(`token` présent **ou** session relais ouverte) ; `GH.api()` ignore le jeton
reçu et passe par `/api/gh`.

## 5. Tests — 105/105

Exécutés dans le navigateur (`t5-tests.html`, retirée avant le commit comme
pour P0), en important **les vrais modules** `functions/api/*.js` et le vrai
`js/core.js` / `js/gh-auth.js`, avec un `fetch` stubé :

1. **cookie HttpOnly** (12) — `HttpOnly`, `Secure`, `SameSite=None`, `Max-Age`,
   relecture par `readSession`, expiration, valeur corrompue, effacement ;
2. **`/api/auth?op=status`** (8) — détection, `configured`, profil renvoyé,
   absence du jeton dans la réponse, cookie à plat = `user:null`, cookie révoqué ;
3. **device flow** (12) — 501 sans `GH_CLIENT_ID`, `client_id` + `scope`
   transmis, **aucun `client_secret`**, `pending`, `slow_down` (+5 s), succès,
   code expiré, refus, device flow désactivé ;
4. **import PAT** (6) — 400/401/200, le jeton n'apparaît jamais dans la réponse,
   logout ;
5. **CORS** (8) — origine connue exacte + `credentials`, origine inconnue sans
   `allow-origin` (auth **et** proxy), OPTIONS, op inconnue ;
6. **proxy `/api/gh`** (14) — 401 sans cookie, `path` absente ou relative,
   `Authorization` fabriqué côté serveur, corps PUT relayé, ETag relayé,
   **SSRF impossible** (`//evil.com` reste sur `api.github.com`), méthode
   inconnue → 405, aucun jeton dans les en-têtes de sortie ;
7. **`Auth` / `GH` côté client** (26) — `ok/token/isRelay`, `relayMode` sans et
   avec base, **bases fantômes rejetées** (`« undefined »`, non-http), URL du
   relais + `credentials:'include'` + **zéro `Authorization`**, mode token
   inchangé (`api.github.com` + en-tête) ;
8. **`GhSession`** (19) — sonde avec/sans relais, base mémorisée, migration
   (jeton envoyé, puis **vidé** du `localStorage`), migration refusée = tout est
   conservé, device flow complet (`code → pending → connecté`), dépôt
   `{user}-hub-data` créé via le relais, message explicite sans `GH_CLIENT_ID`,
   repli token annoncé quand il n'y a pas de relais.

Contrôles d'interface en plus (page réelle) : bouton « 1 clic » masqué sans
relais, affiché avec ; bouton « Sécuriser » affiché uniquement en mode PAT ;
badge « Session sécurisée — aucun token dans ce navigateur » en mode relais ;
`GH.relayMode()` cohérent.

## 6. Sans relais : régression nulle

Le hub sur **GitHub Pages** (ou tout hébergeur sans Functions) n'a pas de
relais : le sondage échoue silencieusement → `GhSession.available = false` →
**l'interface et le comportement sont exactement ceux d'avant** (champ PAT,
accès direct `api.github.com`). Aucun code mort bloquant : les boutons n'apparaissent
que si le relais a répondu.

Le sondage essaie, **dans cet ordre et en s'arrêtant au premier succès** :
la base déjà mémorisée (`souanpt_relay_base`) → l'origine courante (sauf sur
GitHub Pages, qui n'exécute jamais de Functions) → l'origine déclarée
(`window.GH_RELAY` puis `GH_RELAY_DEFAULT`) → les variantes du nom de projet
Cloudflare (`souanpt-hub.pages.dev`, `souanpthub.pages.dev`,
`souanptjub.pages.dev`, `souanpt-hub.fr`). Bornes : `AbortController` à 3 s par
essai, **7 s au total** au maximum, résultat mémorisé dans
`souanpt_relay_base`. La page ne fait donc qu'une requête quand le relais est
là — et affiche le bouton « 1 clic » dès qu'il répond.

## 7. Résidus et limites connus

- **Le mode token reste proposé** (champ PAT volontairement conservé) : c'est le
  repli, pas une faille. En revanche il est devenu **migrable** en un clic.
- **Cookie cross-site** : quand le hub est servi depuis une origine différente
  du relais (GitHub Pages → `souanpt-hub.pages.dev`), le cookie est « tiers ».
  Chrome et Firefox l'acceptent ; **Safari (ITP) bloque les cookies tiers** →
  sur Safari, utiliser le hub servi par Cloudflare (origine propre, cookie
  premier ordre) ou le mode token. Le hub Cloudflare est le chemin recommandé.
- **Le relais voit transiter le jeton** (HTTPS, edge Cloudflare) : c'est le
  prix de le sortir du navigateur. Il ne le stocke nulle part — il vit dans le
  cookie du client.
- **Le cookie n'est pas signé** : sa valeur *est* le jeton JSON-encodé. Un
  attaquant qui le fabriquerait ne pourrait utiliser que **son propre** jeton.
- **`/api/gh` relaie tout chemin `api.github.com`** : capacité strictement égale
  à celle du détenteur du cookie, et accessible uniquement depuis les origines
  de la liste blanche (CORS).
- **`GH_CLIENT_ID` est public par conception** (il apparaît dans les URLs
  d'autorisation GitHub) : ce n'est pas un secret, il n'est stocké nulle part
  côté client.
- Un `souanpt_relay_base` périmé (relais déplacé) fait échouer les appels avec
  une erreur claire ; la prochaine connexion réécrit la base.

## 8. Déploiement — ce qui reste à faire à la main

1. **Relais** : le dossier `functions/` n'est déployé que par Cloudflare Pages.
   - *Projet connecté au Git* (mode B du README) : `git push` suffit, tout part
     seul ;
   - *Direct Upload* (`deploy-cloudflare.ps1`) : relancer le script.
   Vérifier que `_routes.json` contient bien `"/api/*"` (versionné ✅).
2. **Créer l'app** (une fois, impossible via API) :
   <https://github.com/settings/developers> → *New OAuth App* (ou GitHub App) →
   *Authorization callback URL* : `https://github.com/login/device` (aucune
   redirection utilisée) → **cocher « Enable device flow »** → noter le **Client ID**.
3. **Monter le Client ID** : Cloudflare → *Workers & Pages* → projet →
   *Settings → Environment variables* → `GH_CLIENT_ID` = `Iv1.…` → Save →
   redéployer. Aucun secret à gérer.
4. Optionnel : `GH_AUTH_ORIGINS` (CSV) pour autoriser un domaine supplémentaire.
5. **Vérification** — remplace le domaine par celui de **ton** projet Pages\n   (`souanpt-hub.pages.dev`, `souanpthub.pages.dev`, `souanptjub.pages.dev`…) :

   ```bash
   curl -s "https://souanpt-hub.pages.dev/api/auth?op=status"
   # → {"relay":true,"configured":true,"user":null}
   curl -si "https://souanpt-hub.pages.dev/api/gh?path=/user" | head -1
   # → HTTP/2 401  {"error":"session"}
   ```
6. **Côté hub** : *Intégrations → GitHub* → **« 🔒 Sécuriser ma connexion »**
   pour les comptes déjà en PAT (le token quitte le `localStorage`), ou se
   reconnecter avec un code.

> ⚠ Les règles Firestore du P0 restent également à publier manuellement
> (`firebase/FIREBASE.md` § étape 7) : ce sont deux déploiements indépendants.

## 9. Rollback

Retirer `GH_CLIENT_ID` (les boutons disparaissent, `configured:false`) suffit à
désactiver le device flow sans toucher au code. Pour un retour complet au mode
PAT : retirer la balise `<script src="js/gh-auth.js">` de `app.html` — `GH`
retombe sur `api.github.com` dès que `Auth` porte un token, aucune autre
dépendance.
