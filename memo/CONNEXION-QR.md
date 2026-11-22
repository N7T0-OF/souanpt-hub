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

Le relais a besoin d'un espace **KV Cloudflare** lié au projet Pages `souanpthub` sous le nom `HUB_PAIR` (Paramètres du projet → Functions → liaisons KV, ou API). Sans liaison, `/api/pair` répond `501 { code: 'NO_KV' }` et la fenêtre l'explique ; le serveur local répond 404/405 → même message. Ne pas ajouter de `wrangler.toml` au déploiement Pages pour cela : il deviendrait la source unique des variables et ferait perdre celles du tableau de bord (`GH_CLIENT_ID`…).

Cohérence : KV est cohérent en quelques secondes dans un même lieu, jusqu'à ~60 s entre lieux éloignés ; les deux côtés sondent toutes les 2 s, ce qui absorbe ce délai.

## Bonus confidentialité

Le QR de partage existant (`showQR` : portfolio, site, portail) passait par `api.qrserver.com`, qui recevait chaque lien. Il est désormais généré localement (PNG exporté depuis le SVG, sans service tiers).

## Vérifications

`tests/device-pair.test.mjs` : sans KV / autre origine / PC déconnecté → refus ; parcours complet ; mauvais secret, second scan, autre compte, nonce volé, rejeu, refus, expiration ; mode jeton local. QR relus à l'identique par jsQR (outil de vérification hors projet).
