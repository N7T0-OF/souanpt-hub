# Stockage de fichiers — Cloudflare R2 (mise en route)

Le vrai gestionnaire de fichiers (CV, PDF, vidéos, images publiques/privées, liens
partagés) repose sur **Cloudflare R2** (10 Go gratuits). Voici les étapes pour
l'activer. Le code du Worker (`cloudflare/r2-storage-worker.js`) est déjà prêt ;
il ne reste qu'à brancher R2.

## Ce que tu dois faire (une seule fois)

### 1. Activer R2
1. Va sur **dash.cloudflare.com** → menu de gauche → **R2**.
2. Clique **Enable R2 / Purchase R2**.
3. ⚠️ Cloudflare **demande une carte bancaire** même pour l'offre gratuite.
   **Aucun débit** tant que tu restes sous **10 Go de stockage** et les quotas
   gratuits (c'est une simple empreinte, comme une caution).

Dis-moi quand c'est fait — je m'occupe de tout le reste (bucket + déploiement + test).

### 2. (fait par l'agent, une fois R2 activé)
```powershell
cd "G:\2_Logiciel\CLAUDE CODE\souanpt-hub\cloudflare"
npx wrangler r2 bucket create souanpt-files
npx wrangler deploy -c wrangler.r2.toml
```

## Architecture (rappel)

```
App (Firebase connecté)
   │  jeton Firebase (ID token)
   ▼
Worker souanpt-storage  ── vérifie le jeton (clés PUBLIQUES Firebase, aucun secret)
   │
   ▼
Cloudflare R2 (bucket souanpt-files)
   ├─ pub/<uid>/<id>/<nom>   → public (URL stable, servie ouverte, cache 24 h)
   └─ prv/<uid>/<id>/<nom>   → privé (servi UNIQUEMENT au propriétaire authentifié)
```

- **Privé par défaut** : un upload sans `?v=public` va dans `prv/` → inaccessible
  sans un jeton Firebase du propriétaire. Un CV/contrat n'est jamais public par
  accident, même si son chemin est connu.
- **Métadonnées** (nom d'affichage, dossier, tags, visibilité, usages, versions,
  téléchargements) : stockées dans **Firestore** côté app — le Worker ne gère que
  les octets et le contrôle d'accès.
- **Sécurité serveur** : extensions dangereuses refusées (exe, bat, js…), taille
  plafonnée (60 Mo/fichier en v1), propriétaire vérifié à chaque lecture/suppression
  d'un fichier privé.

## Endpoints du Worker
| Méthode | Route | Auth | Rôle |
|---|---|---|---|
| PUT | `/up?v=public\|private&name=…` | jeton Firebase | upload |
| GET | `/f/<clé>` | ouvert si `pub/`, propriétaire si `prv/` | lecture |
| DELETE | `/f/<clé>` | propriétaire | suppression |

## Suite (après activation)
Une fois R2 en ligne et le Worker déployé/testé, je construis dans l'ordre du cahier :
modèle Firestore `storage_files`, upload multipart + file d'attente, vues grille/
liste + dossiers, visionneuse (PDF/image/GIF/vidéo), public/privé/liens partagés,
corbeille, intégration à l'Éditeur (bloc CV/média relié), versionnement, analytics.
