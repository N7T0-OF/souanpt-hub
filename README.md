# souanpt.hub — Creator OS

Dashboard tout-en-un : Portfolio · Behance Sync · Éditeur de site · Avis visiteurs · Facturation · Clients · QR · Backup GitHub — 100% gratuit, zéro serveur.

## Architecture V2 — qui fait quoi

```
SOUANPT.HUB V2

Cloudflare
├── Pages    → héberge le hub (frontend), rebuild auto à chaque push GitHub
├── Workers  → relais Discord (souanpt-discord), Stripe Premium (optionnel)
├── Domaine personnalisé (plus tard)
└── CDN / SSL

Firebase (projet : souanpt-hub)
├── Authentication → comptes (Google, Discord via Worker)
├── Firestore      → données (profils, portails, clients, factures, avis, classement)
└── Storage        → petites images (plus tard, Phase 3)

GitHub
├── Code source + historique
├── Déclencheur des déploiements Cloudflare Pages (push → rebuild)
├── Sites générés + portails fallback (GitHub Pages, repo souanpt-folio/stock)
└── Sauvegarde privée des données ({user}-hub-data)
```

**Règle d'or : toute modification doit être poussée sur GitHub** — c'est le push qui
déclenche la reconstruction du site sur Cloudflare Pages. GitHub n'héberge plus le hub,
mais il reste le point de départ de la chaîne de déploiement.

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
│   ├── core.js     # GitHub API, Auth PAT, SiteConfig, Générateur, Deploy, Behance RSS, Avis
│   └── ui.js       # GHPage, Éditeur, BubbleWidget, navigation
├── scripts/sync-behance.js   # sync RSS optionnelle (Node, sans clé API)
└── _legacy/        # anciens fichiers non chargés (archive)
```

Navigation : la racine (`/`) affiche la vitrine publique ; le bouton **Tableau de bord** ouvre `app.html`. Dans le dashboard, cliquer le logo souanpt.hub ramène à la vitrine.

## Connexion GitHub (PAT)

1. Génère un token sur [github.com/settings/tokens](https://github.com/settings/tokens/new?scopes=repo,workflow&description=souanpt.hub) — scope `repo`
2. **GitHub & Deploy** → colle le token → Se connecter
3. Le repo privé `{user}-hub-data` (backup) est créé automatiquement

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
