# Éditeur et publication

`EdCanvas` dans `js/canvas.js` ajoute les interactions dans l'iframe de l'éditeur. Les commandes de sections, blocs, tags et barre latérale sont insérées dans la navigation du site en mode édition et ne sont pas produites par `generateSite()`. Les réglages restent dans `SiteConfig`; `sidebarPrefs` ne concerne que le thème latéral et garde le rendu antérieur par défaut. Les autres thèmes gardent leurs contrôles existants.

`edWinSections` gère ordre, titres et visibilité. `edWinBrand` gère logo et favicon. `edWinSidebar` regroupe largeur, position, couleurs, densité et visibilité de la barre latérale. Les boutons utilisent `SiteAutoPublish.queue()` et rafraîchissent l'aperçu. La publication manuelle passe par `deployPortfolio()` et `PublishUI` ; les sites clients ne sont pas publiés par le workflow qui livre le dashboard.

Avant livraison, vérifier thème flottant, latéral et Bento, les aperçus desktop/tablette/mobile, la sauvegarde, le rendu généré et la publication d'un site de test. Les GIF, tags, audio et effets restent dans les chemins existants.
