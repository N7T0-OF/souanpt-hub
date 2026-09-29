# Cloudflare — Déploiement du hub + Connexion Discord

## 1. Déployer le hub sur Cloudflare Pages (gratuit, ~5 min)

Cloudflare Pages est plus fiable que GitHub Pages (fini le « Deployment failed »).

1. Va sur https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**.
2. Autorise GitHub, choisis le repo **N7T0-OF/souanpt-hub**.
3. Réglages de build :
   - **Framework preset** : *None*
   - **Build command** : *(laisser vide)*
   - **Build output directory** : `/`
4. **Save and Deploy**. Ton hub sera en ligne sur `https://souanpt-hub.pages.dev`
   (chaque `git push` redéploie automatiquement).

> ⚠ Après le déploiement, ajoute `souanpt-hub.pages.dev` (et ton domaine perso plus tard)
> dans **Firebase → Authentication → Settings → Authorized domains**, sinon la connexion
> Google/Discord sera refusée sur ce domaine.

Le site généré et les portails clients continuent, eux, d'aller sur GitHub Pages
(inchangé). Seul le **hub** (le tableau de bord) passe sur Cloudflare.

## 2. Activer la connexion Discord (Worker gratuit)

Discord n'est pas un fournisseur OpenID → ce Worker fait le pont vers Firebase.

### a) Service account Firebase (pour fabriquer le jeton)
Firebase → ⚙ **Paramètres du projet → Comptes de service → Générer une nouvelle clé privée**.
Tu obtiens un JSON avec `client_email` et `private_key`.

### b) Déployer le Worker — SANS téléverser de fichier ⚠

> ❌ N'utilise PAS « Upload and deploy » (glisser-déposer) : cet écran sert aux sites
> statiques et refuse les fichiers .js (« requires a build process… use wrangler »).
> ✅ Le code d'un Worker se COLLE dans l'éditeur en ligne. Voici le bon chemin :

1. Cloudflare → **Workers & Pages** → **Create** (Créer) → onglet **Workers**
   → **Create Worker** (le modèle « Hello World », pas Pages, pas Upload).
2. Donne-lui un nom clair : `souanpt-discord` → clique **Deploy** (il déploie le
   modèle vide, c'est normal).
3. Sur la page du Worker → bouton **Edit code** (Modifier le code) → l'éditeur s'ouvre :
   **supprime tout** le code d'exemple, puis **colle l'intégralité** de
   `discord-auth-worker.js` → bouton **Deploy** en haut à droite.
4. Ton Worker est en ligne. Note son URL (affichée sur sa page) :
   `https://souanpt-discord.<toncompte>.workers.dev`
5. Onglet **Settings → Variables and Secrets** du Worker → ajoute (en **Secret**) :
   - `DISCORD_CLIENT_ID` = `1523719456768135229`
   - `DISCORD_CLIENT_SECRET` = *(Discord Developer Portal → ton app → OAuth2 → Reset Secret)*
   - `FIREBASE_CLIENT_EMAIL` = le `client_email` du JSON service account
     *(Firebase → ⚙ Paramètres → Comptes de service → Générer une nouvelle clé privée)*
   - `FIREBASE_PRIVATE_KEY` = la `private_key` du même JSON (colle-la telle quelle,
     avec les `\n` — le Worker gère les deux formats)
   - `APP_URL` = l'URL de ton dashboard V2 : `https://souanptjub.pages.dev/app.html`

   *(L'URL du Worker est détectée automatiquement — plus besoin de `WORKER_URL`.)*
   Après chaque ajout de secret, le Worker redémarre tout seul. Tant qu'un secret
   manque, `/login` affiche un message qui te dit **lequel** ajouter.

6. **Test rapide** : ouvre `https://souanpt-discord.<toncompte>.workers.dev` dans le
   navigateur → tu dois voir « souanpt Discord auth — /login ». Puis ouvre `/login` :
   tu dois être redirigé vers l'écran d'autorisation Discord. Si oui, le Worker tourne ✓.

### c) Portail Discord
https://discord.com/developers → ton app → **OAuth2 → Redirects** → ajoute :
`https://souanpt-discord.toncompte.workers.dev/callback`
*(remplace par ta vraie URL de Worker + `/callback`)*.

### d) Allumer le bouton côté site
Dans `firebase/firebase-config.js`, renseigne :
```js
window.DISCORD_LOGIN_URL = "https://souanpt-discord.toncompte.workers.dev/login";
```
Push → le bouton **« Continuer avec Discord »** apparaît sur la page de connexion.

> 🔒 Les secrets (client secret Discord, clé privée Firebase) vivent **uniquement** dans
> Cloudflare, jamais dans le code du site. Ne les colle jamais ailleurs.

Quand tout est en place, préviens-moi : on teste le flux ensemble et je corrige si besoin.

## 3. Connexion GitHub sans token (device flow, ~5 min)

> C'est **le relais d'authentification** : il permet de se connecter à GitHub
> avec un simple code à 8 caractères, et surtout de **ne plus rien stocker dans
> le navigateur** (voir `docs/audits/t5-github-auth.md`).
> Sans lui, la connexion par token classique continue de fonctionner : rien ne
> casse, seule la connexion « 1 clic » reste indisponible.

### a) Déployer les Functions

Deux cas, comme au §1 :

- **Connect to Git** → chaque `git push` redéploie `functions/` automatiquement ;
- **Direct Upload** → relancer `deploy-cloudflare.ps1`.

Vérifier que `_routes.json` contient `"/api/*"` (déjà versionné) : sans ça,
Cloudflare ne facture pas… et n'exécute pas les Functions.

### b) Créer l'app GitHub (une fois, à la main)

1. <https://github.com/settings/developers> → **New OAuth App**
   (*Application name* : `souanpt.hub`, *Homepage* : l'URL du hub,
   *Authorization callback URL* : `https://github.com/login/device` —
   aucune redirection n'est utilisée, seule la page de saisie compte).
2. **Cocher « Enable device flow »** (page des réglages de l'app) — sans ça,
   GitHub répond `device_flow_disabled`.
3. Noter le **Client ID** (`Iv1.…`). ⚠ Il n'y a **pas de secret à conserver** :
   « The client_secret is not needed for the device flow ».

### c) Monter le Client ID dans Cloudflare

Cloudflare → **Workers & Pages** → projet du hub → **Settings → Environment
variables** → *Add variable* :

| Nom | Valeur |
|---|---|
| `GH_CLIENT_ID` | `Iv1.…` (le Client ID) |
| `GH_AUTH_ORIGINS` | *(facultatif)* CSV des origines supplémentaires autorisées, ex. `https://mon-domaine.fr` |

Puis **Save** puis redéployer (une variable d'environnement ne s'applique qu'au
prochain build).

Les origines déjà admises : `https://souanpt-hub.pages.dev`,
`https://souanpt-hub.fr`, `https://n7t0-of.github.io`.

### d) Vérifier

```bash
curl -s "https://souanpt-hub.pages.dev/api/auth?op=status"
# → {"relay":true,"configured":true,"user":null}
curl -si "https://souanpt-hub.pages.dev/api/gh?path=/user" | head -1
# → HTTP/2 401  {"error":"session"}      (normal : pas de cookie)
```

Le hub **détecte seul** le relais (origine courante, puis les variantes du
domaine ci-dessous) : le bouton n'apparaît que s'il répond.

Ouvrir ensuite le hub → **Intégrations → GitHub** : le bloc « 🔗 Connexion sans
token » apparaît avec le bouton **« Se connecter avec un code »**. Sur un compte
déjà connecté par PAT, le bouton **« 🔒 Sécuriser ma connexion »** fait migrer le
token vers le relais et vide le `localStorage`.

Diagnostic : `404` sur la première commande = les Functions ne sont pas
déployées (§ a) ; `configured:false` = `GH_CLIENT_ID` manquant (§ c).

> 🔒 Aucun secret ne vit dans le code du site : ni `client_secret` (inexistant),
> ni jeton (cookie `HttpOnly` côté client). `GH_CLIENT_ID` est une information
> publique.

## 4. Dons — Ko-fi & PayPal

Il n'y a **plus de plan payant** : aucune fonctionnalité n'est réservée à un
paiement, donc rien à débloquer et **aucun backend de paiement à maintenir**.
Les liens de don (Ko-fi, PayPal) sont de simples liens sortants — pas de webhook,
pas de secret, pas de Worker.

> Le Worker `premium-stripe-worker.js` a été supprimé avec le Premium.
> Il reste récupérable dans l'historique git si le besoin revient.

L'intégration **Stripe** conservée dans Paramètres → Intégrations sert à un tout
autre usage : permettre à **tes clients** de régler **tes** factures. Elle ne
concerne pas souanpt.hub.