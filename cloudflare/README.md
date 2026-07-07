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

### b) Déployer le Worker
1. Cloudflare → **Workers & Pages → Create → Worker** → colle le contenu de
   `discord-auth-worker.js` → **Deploy**. Note son URL (ex :
   `https://souanpt-discord.toncompte.workers.dev`).
2. Onglet **Settings → Variables and Secrets** du Worker → ajoute (en **Secret**) :
   - `DISCORD_CLIENT_ID` = `1523719456768135229`
   - `DISCORD_CLIENT_SECRET` = *(depuis le portail Discord → OAuth2)*
   - `FIREBASE_CLIENT_EMAIL` = le `client_email` du service account
   - `FIREBASE_PRIVATE_KEY` = la `private_key` (colle-la telle quelle, avec les `\n`)
   - `APP_URL` = `https://souanpt-hub.pages.dev/app.html`
   - `WORKER_URL` = l'URL du Worker (sans `/` final)

### c) Portail Discord
https://discord.com/developers → ton app → **OAuth2 → Redirects** → ajoute :
`https://souanpt-discord.toncompte.workers.dev/callback`
*(remplace par ton vraie URL de Worker + `/callback`)*.

### d) Allumer le bouton côté site
Dans `firebase/firebase-config.js`, renseigne :
```js
window.DISCORD_LOGIN_URL = "https://souanpt-discord.toncompte.workers.dev/login";
```
Push → le bouton **« Continuer avec Discord »** apparaît sur la page de connexion.

> 🔒 Les secrets (client secret Discord, clé privée Firebase) vivent **uniquement** dans
> Cloudflare, jamais dans le code du site. Ne les colle jamais ailleurs.

Quand tout est en place, préviens-moi : on teste le flux ensemble et je corrige si besoin.

## 3. Premium — 2 modes d'attribution

Un lien **PayPal.me ne peut PAS** débloquer le Premium automatiquement (aucun serveur
n'est prévenu de « qui a payé »). Deux solutions :

### Mode A — Codes cadeaux (marche aujourd'hui, zéro backend) 🎁
1. L'acheteur paie via PayPal (bouton « Passer à Premium »).
2. Tu crées un **code** dans Firebase → Firestore → collection `codes` → nouveau document :
   ID = `SOUANPT-XXXX` (ce que tu veux), champ `used` (boolean) = `false`.
3. Tu envoies le code à l'acheteur (ou il l'offre à qui il veut).
4. Il l'entre dans **Paramètres → Premium → J'ai un code** → Premium activé instantanément.
   Les règles Firestore empêchent la réutilisation d'un code.

> ⚠ Ce mode n'est pas infalsifiable (un utilisateur technique pourrait forcer son plan).
> Suffisant pour lancer ; passe au mode B pour verrouiller.

### Mode B — Stripe automatique & sécurisé (100% auto)
Déploie `premium-stripe-worker.js` (même méthode que le Worker Discord) :
1. Stripe → crée un **Payment Link** « Premium 4 € ».
2. Sur ta page tarifs, redirige vers ce lien en ajoutant `?client_reference_id={UID}`
   (l'UID Firebase de l'acheteur connecté).
3. Stripe → Developers → Webhooks → `checkout.session.completed` → URL du Worker.
4. Secrets du Worker : `STRIPE_WEBHOOK_SECRET`, `FIREBASE_PROJECT_ID`,
   `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
5. Résultat : dès qu'un paiement réussit, le Worker passe `users/{uid}.plan = "pro"`
   tout seul. Pour verrouiller, on ajoutera une règle empêchant l'utilisateur de
   modifier `plan` lui-même (seul le Worker le peut).
