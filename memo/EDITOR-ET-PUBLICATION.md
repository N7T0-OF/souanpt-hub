# Éditeur et publication

`EdCanvas` dans `js/canvas.js` ajoute les interactions dans l'iframe de l'éditeur. Les commandes de sections, blocs, tags et barre latérale sont insérées dans la navigation du site en mode édition et ne sont pas produites par `generateSite()`. Les réglages restent dans `SiteConfig`; `sidebarPrefs` ne concerne que le thème latéral et garde le rendu antérieur par défaut. Les autres thèmes gardent leurs contrôles existants.

`edWinSections` gère ordre, titres et visibilité. `edWinBrand` gère logo et favicon. `edWinSidebar` regroupe largeur, position, couleurs, densité et visibilité de la barre latérale. Les boutons utilisent `SiteAutoPublish.queue()` et rafraîchissent l'aperçu. La publication manuelle passe par `deployPortfolio()` et `PublishUI` ; les sites clients ne sont pas publiés par le workflow qui livre le dashboard.

La fenêtre Behance (projets Behance en direct sur le site, effets du PSD, recadrage) est décrite dans [BEHANCE-PREVIEW.md](BEHANCE-PREVIEW.md) ; ses réglages sont dans la fenêtre « 🅱 Behance » et dans la fiche de chaque projet.

Couleurs : le site publié n'a qu'une source d'accent, `cfg.accentColor`. `accentTokens()` (`js/core.js`) en dérive `--on-a` (texte posé sur l'accent, sombre ou clair selon le contraste), `--a-soft`, `--a-border`, `--a-glow` ; le portail client fait de même. Le tableau de bord n'a que `--accent` (avec `--on-accent` et des mélanges `color-mix`) ; `HubAccent.apply(hex)` le change en recalculant le texte. La couche d'édition injectée dans l'aperçu reçoit cet accent (`--ed-a`). `--green` reste une couleur sémantique (succès, payé, actif) et ne suit pas l'accent. Les valeurs `#C8FF00` restantes sont des définitions ou des valeurs par défaut (sélecteurs, `SiteConfig`).

Avant livraison, vérifier thème flottant, latéral et Bento, les aperçus desktop/tablette/mobile, la sauvegarde, le rendu généré et la publication d'un site de test. Les GIF, tags, audio et effets restent dans les chemins existants.
