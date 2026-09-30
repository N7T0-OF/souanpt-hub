# Déploiement Cloudflare Pages — pourquoi le site ne changeait pas (v3.8.2)

> Symptôme rapporté : « le release n'est pas appliqué, sur `pages.dev/app` il n'y
> a pas de changement. »

## 1. Diagnostic

Il y a **deux** sites, et seuls l'un d'eux suivait les pushs.

| Site | Origine | État constaté le 30/09/2026 |
|---|---|---|
| `n7t0-of.github.io/souanpt-hub` | GitHub Actions (`deploy.yml`) | **v3.8.1** — `HUB_VERSIONS` en `js/quote.js:1326`, filtre `Générale` et `nt-ver` en `app.html:1325/1331`, `Notify.init()` en `:3733` ✓ |
| **`souanptjub.pages.dev/app`** | **upload manuel** `deploy-cloudflare.ps1` | **antérieur à v3.1.0** (voir §2) |

Preuves sur `souanptjub.pages.dev` :

- `js/hub-data.js` → **404** (fichier créé par `8a5f187` = T1+T2 → v3.1.0) ;
- `js/client-workspace.js` → **404** (crée en v3.7.0) ;
- `js/quote.js` servi = 83 266 caractères, contre 87 163 à **chaque** tag
  v3.1.0…v3.8.0 (dernier changement réel en v3.8.1 : 91 735) ;
- `app.html` servi = 225 275 octets, sans `cw-root`, sans `cw-val`, sans
  `nt-ver`.

Conclusion : **toute la série T1→T5, la fusion v3.6, ClientWorkspace v3.7 et
les versions v3.8.0/v3.8.1 sont absentes du site que tu regardes.** Le
déploiement GitHub Pages, lui, a toujours suivi (runs #36731612039, #36752375515
→ success).

Cause : le projet Pages Cloudflare (`souanpthub`) n'est **connecté à aucun
dépôt** — il n'est alimenté que par la commande manuelle, et celle-ci n'avait
plus été lancée depuis avant v3.1.0.

## 2. Ce qui a été livré

1. **`.github/workflows/deploy-cloudflare.yml`** (nouveau) : publie
   `souanptjub.pages.dev` à **chaque push sur `main`**, avec les mêmes
   exclusions que `deploy-cloudflare.ps1` (mais `.freebuff` en plus) et
   `functions/` conservé (relais `/u/` et `/api/`).
   - **Tant que le secret `CLOUDFLARE_API_TOKEN` n'existe pas, l'étape est
     ignorée** : le workflow reste vert et GitHub Pages continue.
   - Déclenchement manuel possible : onglet Actions → *Deploy hub to
     Cloudflare Pages* → *Run workflow*.
2. **README § Pipeline de déploiement** : les deux cibles et l'étape unique à
   faire une fois.
3. `deploy-cloudflare.ps1` : `.freebuff` ajouté aux exclusions (uniquement des
   fichiers locaux non versionnés).

## 3. L'étape à faire UNE fois (au choix)

> ✅ **FAIT le 30/09/2026 — option A choisie** : la connexion Git a été établie
> depuis le dashboard Cloudflare (projet `souanpthub` ← repo
> `N7T0-OF/souanpt-hub`, branche `main`, framework *None*, build command vide,
> output `/`). Vérifications en §4.
> L'option **B** (secret `CLOUDFLARE_API_TOKEN`) est donc **à ne pas
> configurer** : elle ferait déployer deux fois en parallèle.

### Option A — connexion Git (recommandée, aucun jeton)

Cloudflare dashboard → **Workers & Pages** → projet **souanpthub** →
**Settings → Builds & deployments → Connect to Git** → repo `N7T0-OF/souanpt-hub`
→ branche **main** → framework **None**, build command **vide**, output
directory **/** → **Save and Deploy**.

→ Plus jamais de publication manuelle : chaque push (et donc chaque release)
publie `souanptjub.pages.dev`.

### Option B — jeton dans GitHub (garantit que C'EST MOI qui déploie)

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token** →
   modèle *Cloudflare Pages — Edit* → créer ;
2. GitHub → repo **souanpt-hub → Settings → Secrets and variables → Actions →
   New repository secret** → nom `CLOUDFLARE_API_TOKEN`, valeur du jeton ;
3. onglet Actions → *Deploy hub to Cloudflare Pages* → *Run workflow* (ou le
   prochain push).

### Option C — immédiat (ce qui existait déjà)

Installer Node.js LTS puis double-cliquer sur `deploy-cloudflare.ps1` : le site
est mis à jour sur-le-champ, mais **uniquement quand on y pense**.

## 4. Vérification — ✅ faite le 30/09/2026 (après l'option A)

```text
https://souanptjub.pages.dev/js/hub-data.js       → 200  (404 avant)
https://souanptjub.pages.dev/js/client-workspace.js → 200  (404 avant)
```

Contrôles effectués depuis la machine de travail :

| Contrôle | Résultat |
|---|---|
| `js/quote.js`, `js/hub-data.js`, `js/clients.js`, `js/client-workspace.js` | **identiques** au dépôt (SHA/lenghts) |
| `app.html` servi | marqueurs v3.8.x tous présents : `cw-root`, `cw-val` (15), `nt-ver`, `setFilter('general')`, `client-workspace.js`, `Notify.init` |
| `HUB_VERSIONS` | première ligne **`['3.8.2', …]`** |
| check-run GitHub du commit `677049c` | **[Cloudflare Workers and Pages] Cloudflare Pages : completed/success** (+ les 2 GitHub Actions) |
| **Functions** (relais) | `/api/auth?op=status` → **200**, `/api/gh?path=/user` → **401** (exécution confirmée, refus sans session), `/u/<pseudo inconnu>` → 404 |

Puis dans l'app : cloche 🔔 → « 📦 Nouvelle version v3.8.2 » (catégorie
**Générale**).

## 5. Ce qui reste manuel — relevé du 30/09/2026 après la connexion Git

### ✅ Réglé par cette connexion (n'est plus manuel)

- **Relais `/u/` et `/api/`** : déployés avec le site. Vérifié sur
  `souanptjub.pages.dev` → `/api/auth?op=status` → **200**,
  `/api/gh?path=/user` → **401** (la fonction tourne et refuse sans session),
  `/u/<pseudo inconnu>` → 404. Les correctifs P0 et T5 de `functions/` sont
  donc en production — l'ancienne réserve « ils ne prennent effet qu'après un
  redéploiement Cloudflare » ne s'applique plus.

### ⏳ Toujours manuel

1. **Règles Firestore P0** — la CI ne déploie pas Firebase.
   Firebase console → Firestore → **Règles** → coller
   `firebase/firestore.rules` → **Publier** (voir `firebase/FIREBASE.md` § 7).
   Les correctifs côté client (v3.4.0) sont déjà en ligne ; les règles sont la
   seconde couche, contre un client obsolète ou une écriture malveignable.

2. **`GH_CLIENT_ID` (T5)** — état **vérifié : non configuré**.
   `GET https://souanptjub.pages.dev/api/auth?op=status` renvoie
   `{"relay":true,"configured":false,"user":null}` (`configured` = présence de
   la variable d'environnement, `functions/api/auth.js:159`).
   1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App
      avec **« Enable device flow »** (obligatoire) → copier le *Client ID* ;
   2. Cloudflare → Workers & Pages → `souanpthub` → **Settings → Environment
      variables** → Production → `GH_CLIENT_ID` = valeur → Save ;
   3. **Redéployer** : *Deployments → Retry deployment* (ou tout simple push
      du dépôt, l'intégration Git reconstruit) ;
   4. Contrôle : le même appel doit renvoyer `"configured":true`.

Aucun autre point d'exploitation n'est en attente : GitHub Pages et
`souanptjub.pages.dev` sont tous deux déployés automatiquement à chaque push.
