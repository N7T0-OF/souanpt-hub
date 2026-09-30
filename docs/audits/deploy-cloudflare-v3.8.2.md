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

## 4. Vérification après l'une des options

```text
https://souanptjub.pages.dev/js/hub-data.js     → 200 (404 = toujours ancien)
https://souanptjub.pages.dev/js/quote.js        → contient « HUB_VERSIONS »
```

puis, dans l'app : cloche 🔔 → « 📦 Nouvelle version v3.8.1 » (catégorie
**Générale**).

## 5. Ce qui reste manuel (inchangé)

- règles Firestore P0 (Firebase console) ;
- `GH_CLIENT_ID` + redéploiement des Functions (T5) ;
- relais `/u/` et `/api/` : ils ne prennent effet qu'après un redéploiement
  Cloudflare — **l'option A ou B règle aussi ça**.
