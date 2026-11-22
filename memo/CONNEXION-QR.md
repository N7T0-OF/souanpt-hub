# Connexion du téléphone par QR code (3.23.0)

Objectif : être connecté sur le téléphone en scannant un QR code affiché par l'ordinateur déjà connecté, sans saisir de clé ni de jeton.

## Déroulé

1. **Ordinateur connecté** : Paramètres → Compte → Connexions → « 📱 Téléphone ou tablette — Connecter ». `POST /api/pair?op=create` (identité : cookie de session du relais, ou jeton local en en-tête `x-hub-token` pour le mode historique, vérifié auprès de GitHub). Le relais crée un appairage de 120 s : `{ st:'waiting', login, sh: SHA-256(secret), exp }` — **aucun jeton stocké**.
2. Le QR (généré **localement**, `js/vendor/qrcode.min.js`) contient `https://<relais>/app.html#pair=<id>.<secret>` : le secret est après `#`, il n'est jamais envoyé au serveur dans une URL ni journalisé ; le téléphone l'efface aussitôt de la barre d'adresse.
3. **Téléphone** : `op=claim` (id + secret + libellé d'appareil « iPhone · Safari ») → reçoit un nonce privé ; un second scan répond « déjà utilisé ».
4. **Ordinateur** (sondage `op=status`) : « iPhone · Safari veut se connecter — Autoriser / Refuser ». Seule l'autorisation (`op=approve`, même compte uniquement) dépose le jeton du PC dans l'appairage, pour 60 s au plus.
5. **Téléphone** (sondage `op=redeem` avec le nonce) : reçoit son propre cookie `hub_gh` (HttpOnly, Secure, SameSite=None) ; l'appairage est supprimé (usage unique) ; `connectGitHubRelay` ouvre l'espace.

Le jeton n'apparaît jamais dans un QR, une URL, une réponse JSON ni à l'écran. Comparaisons d'empreintes à temps constant ; libellé d'appareil nettoyé ; origine de la liste blanche obligatoire.

## Mise en service (à faire lors de la mise en production)

Le relais a besoin de l'espace **KV Cloudflare** `HUB_PAIR` (id `136c3216c64349b2a98904667f0c151a`). Depuis 3.27.0, il est lié par la configuration du projet Pages : `cloudflare/pages.wrangler.toml` est un modèle que `scripts/write-pages-config.mjs <dossier>` écrit en `wrangler.toml` à la **racine du dépôt** (ignoré par Git, jamais dans le dossier publié, donc jamais servi) ; `wrangler pages deploy <dossier>` est lancé depuis cette racine, comme dans `deploy-cloudflare.yml`. Wrangler lit `functions/` dans le dossier d'où il est lancé : le 22/11/2026, un déploiement lancé depuis le dossier parent de l'artefact a publié le site sans Functions (`/api/auth` en 404) pendant quelques minutes, corrigé par un redéploiement depuis la racine. Le script refuse désormais un dossier sans `functions/`. Ce fichier devient la source unique des liaisons et variables du projet : avant de l'adopter, le tableau de bord ne contenait ni variable ni secret (`/api/auth?op=status` → `configured: false`, `wrangler pages secret list` vide). Toute variable future se déclare dans le modèle (`[vars]`) ou en secret (`wrangler pages secret put`), pas dans le tableau de bord. Sans liaison (serveur local, déploiement sans la config), `/api/pair` répond `501 { code: 'NO_KV' }` ou 404/405 et la fenêtre propose GitHub ou souanptjub.pages.dev. Contrôle après déploiement : `POST /api/pair?op=create` sans session doit répondre `401 AUTH`, pas `501 NO_KV`.

Cohérence : KV est cohérent en quelques secondes dans un même lieu, jusqu'à ~60 s entre lieux éloignés ; les deux côtés sondent toutes les 2 s, ce qui absorbe ce délai.

## Bonus confidentialité

Le QR de partage existant (`showQR` : portfolio, site, portail) passait par `api.qrserver.com`, qui recevait chaque lien. Il est désormais généré localement (PNG exporté depuis le SVG, sans service tiers).

## Vérifications

`tests/device-pair.test.mjs` : sans KV / autre origine / PC déconnecté → refus ; parcours complet ; mauvais secret, second scan, autre compte, nonce volé, rejeu, refus, expiration ; mode jeton local. QR relus à l'identique par jsQR (outil de vérification hors projet).
