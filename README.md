# souanpt.hub — Creator OS

Portfolio · Links · Analytics · Facturation · QR · Backup GitHub

## Déploiement

```bash
git clone https://github.com/Sankaiii/souanpt-hub repo
cd repo
# Copier les fichiers du ZIP ici
git add . && git commit -m "init" && git push origin main
```

## Connexion GitHub (Device Flow)

1. Ouvre le hub sur GitHub Pages
2. Va dans **GitHub & Déploiement**
3. Clique **Se connecter avec GitHub**
4. Un code apparaît — il s'ouvre automatiquement sur github.com/login/device
5. Colle le code → Autoriser → retour automatique ✓

## Architecture

```
hub/
├── index.html      # SPA complète
├── js/
│   ├── core.js     # GitHub API, DeviceFlow, Auth, SiteConfig, Generator, Deploy
│   └── ui.js       # GHPage, Éditeur, BubbleWidget, navigation
├── css/            # Styles (depuis ZIP original)
├── scripts/
│   └── sync-behance.js
└── .github/workflows/
    ├── deploy.yml
    └── behance-sync.yml
```
