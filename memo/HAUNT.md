# Connexion haunt.gg (3.17.0)

But : héberger images, vidéos et sons sur l'ImageHost haunt.gg du propriétaire et ne garder dans le hub que des adresses. Lève la limite d'environ 3,5 Mo du stockage du navigateur pour la galerie déroulante et les imports.

## Ce que permet l'API (doc : help.haunt.gg/api)

- **ImageHost** (clé de l'utilisateur) : `POST /api/imagehost/upload` (multipart, champ `file` ; réponse `url` page de visualisation, `rawUrl` fichier brut du CDN), `GET /api/imagehost/uploads` (paginé `items/total/limit/offset`, filtres `type`, `search`, `sort`, `order`), `DELETE /api/imagehost/uploads/{id}`. Clé dans `X-API-Key`. Limites : 30 ou 60 requêtes/min par clé, 60/min par IP ; 75 Mo par fichier et 1 Go au total en gratuit.
- **Lookup** (profil, badges, vues sur 30 jours, présence Discord) : permissions `lookup:*` accordées **uniquement par l'équipe haunt.gg**. La clé actuelle ne les a pas → pas de compteur de vues ni de profil importé tant que haunt.gg ne les accorde pas.
- L'API ne renvoie **aucun en-tête CORS** (préflight 204 sans `Access-Control-Allow-Origin`) : un navigateur ne peut pas l'appeler directement.

## Architecture

- `functions/api/haunt.js` : relais Cloudflare. Cible reconstruite côté serveur, trois opérations seulement (`op=uploads` GET avec paramètres filtrés, `op=upload` POST multipart ≤ 75 Mo, `op=delete` DELETE avec id `[A-Za-z0-9._-]{1,80}`). Origine de la liste blanche obligatoire (`originAllowed` de `auth.js`). Clé reçue en `x-haunt-key` (format `haunt_…`), renvoyée en `X-API-Key`, jamais stockée ni journalisée, jamais dans une URL. Réponses `no-store`.
- `js/haunt.js` : `Haunt` (clé, appels, messages d'erreur en français par `code`), `HauntPicker` (fenêtre de choix + envoi), `HauntSettings` (ligne Paramètres → Compte → Connexions). Sur GitHub Pages, le relais utilisé est `https://souanptjub.pages.dev`.
- Clé : `localStorage['souanpt_haunt_v1']` **sur l'appareil seulement**. Absente du registre `HubData` → ni sauvegarde GitHub, ni miroir Firestore, ni site publié (le générateur ne la lit jamais ; test `haunt.test.mjs`). Dans le mode aperçu, le stockage est remplacé par la démo : la clé n'y est pas visible.
- Branchements : galerie du projet (« 👻 Depuis haunt.gg » ; « 📁 Importer » envoie sur haunt.gg quand la clé est enregistrée), fenêtre « 🔊 Son du site » (musique et son de clic). Les adresses gardées sont les `rawUrl` en https.

## Sécurité

La clé a été collée une fois dans la conversation avec l'assistant le 22 novembre 2026 : elle n'est écrite dans aucun fichier du dépôt (test : aucune chaîne `haunt_` réelle). Si elle fuit, la révoquer sur haunt.gg (Compte → Développeur) et en créer une nouvelle, puis « Oublier la clé » et la ressaisir dans Paramètres.
