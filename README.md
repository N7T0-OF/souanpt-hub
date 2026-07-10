# souanpt.hub — Creator OS

Dashboard tout-en-un : Portfolio · Behance Sync · Éditeur de site · Avis visiteurs · Facturation · Clients · QR · Backup GitHub — 100% gratuit, zéro serveur.

## Architecture V2 — Cloudflare est la plateforme principale

```
SOUANPT.HUB V2

Cloudflare  ★ PLATEFORME PRINCIPALE
├── Pages    → héberge le hub (frontend)
├── Workers  → API & fonctions serveur (relais Discord, Stripe Premium…)
├── DNS      → domaine personnalisé (hub.souanpt.fr, souanpt.app…)
└── CDN/SSL  → cache, performances, sécurité

Firebase (projet : souanpt-hub)  ★ BACKEND
├── Authentication → comptes (Google, Discord via Worker)
├── Firestore      → données temps réel (profils, portails, clients, factures, avis, classement)
└── Storage        → petites images (Phase 3)

GitHub  (optionnel)
├── Sauvegarde du code source + historique Git
├── Sites générés & portails fallback (GitHub Pages, repo souanpt-folio/stock)
└── Sauvegarde privée des données ({user}-hub-data)
```

## Déployer le hub — 2 modes

**Mode A — Déploiement direct Cloudflare (officiel, sans GitHub)**
Double-clique sur `deploy-cloudflare.ps1` → le site part directement sur Cloudflare Pages.
Prérequis une seule fois : installer Node.js LTS (nodejs.org) + autoriser l'outil au
premier lancement. ⚠ Nécessite un projet Pages en mode **Direct Upload** (un projet
Pages « connecté à Git » n'accepte pas l'upload direct — crée un nouveau projet
« Upload assets » si besoin, l'URL .pages.dev change alors).

**Mode B — Via GitHub (automatique si le projet Pages est connecté au repo)**
`git push` → Cloudflare détecte le commit → rebuild automatique. Simple et sans
installation ; GitHub sert alors de déclencheur, pas d'hébergeur.

Dans les deux cas, garder GitHub à jour reste recommandé : c'est la sauvegarde du code.

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
