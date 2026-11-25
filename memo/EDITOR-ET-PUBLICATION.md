# Éditeur et publication

`EdCanvas` dans `js/canvas.js` ajoute les interactions dans l'iframe de l'éditeur. Les commandes de sections, blocs, tags et barre latérale sont insérées dans la navigation du site en mode édition et ne sont pas produites par `generateSite()`. Les réglages restent dans `SiteConfig`; `sidebarPrefs` ne concerne que le thème latéral et garde le rendu antérieur par défaut. Les autres thèmes gardent leurs contrôles existants.

`edWinSections` gère ordre, titres et visibilité. `edWinBrand` gère logo et favicon. `edWinSidebar` regroupe largeur, position, couleurs, densité et visibilité de la barre latérale. Les boutons utilisent `SiteAutoPublish.queue()` et rafraîchissent l'aperçu. La publication manuelle passe par `deployPortfolio()` et `PublishUI` ; les sites clients ne sont pas publiés par le workflow qui livre le dashboard.

La fenêtre Behance (projets Behance en direct sur le site, effets du PSD, recadrage) est décrite dans [BEHANCE-PREVIEW.md](BEHANCE-PREVIEW.md) ; ses réglages sont dans la fenêtre « 🅱 Behance » et dans la fiche de chaque projet.

Couleurs : le site publié n'a qu'une source d'accent, `cfg.accentColor`. `accentTokens()` (`js/core.js`) en dérive `--on-a` (texte posé sur l'accent, sombre ou clair selon le contraste), `--a-soft`, `--a-border`, `--a-glow` ; le portail client fait de même. Le tableau de bord n'a que `--accent` (avec `--on-accent` et des mélanges `color-mix`) ; `HubAccent.apply(hex)` le change en recalculant le texte. La couche d'édition injectée dans l'aperçu reçoit cet accent (`--ed-a`). `--green` reste une couleur sémantique (succès, payé, actif) et ne suit pas l'accent. Les valeurs `#C8FF00` restantes sont des définitions ou des valeurs par défaut (sélecteurs, `SiteConfig`).

Avant livraison, vérifier thème flottant, latéral et Bento, les aperçus desktop/tablette/mobile, la sauvegarde, le rendu généré et la publication d'un site de test. Les GIF, tags, audio et effets restent dans les chemins existants.

## Barre de l'éditeur (3.19.0)

Menus groupés (`js/editor-toolbar.js`, `EdMenu`) : 🎨 Design (Thème, Bannière, Identité, Effets, Ambiance, Son), 🧱 Contenu (Sections, Bloc, Tags, Fenêtre projet), 🚀 Visibilité (SEO, haunt.gg). Puis Auto-publication, ↶ ↷, Édition/Aperçu, et 💾 ↗ ⬇ en icônes seules (infobulles). La jauge de performance est un bouton compact : temps et conseils dans une fenêtre au clic (point jaune s'il y a des conseils). `EdMenu.run('chemin.fonction', withAnchor)` résout la fonction au clic et passe le bouton du menu aux fenêtres qui se positionnent. Échap ferme, flèches ↑↓ naviguent. Les raccourcis T/E/B/S restent. Même composant pour « ＋ Ajouter » de Clients & Projets. En-têtes de page : retour à la ligne propre, jamais de mot coupé ; `.sr-only` défini (il manquait). « Vérification des dossiers » repliée quand tout est cohérent.

## Un seul espace d’édition (3.28.0)

Le sélecteur ✎ Édition / 👁 Aperçu a disparu : l’aperçu est toujours éditable ET vivant. Simple clic sur un bloc = sélection (barre du bloc, déplacement, menu clic droit). Double-clic, Ctrl/⌘+clic ou « ↗ Ouvrir comme un visiteur » (clic droit) = geste du visiteur (fenêtre projet, lien, bouton) ; la barre du bloc se referme. Hors des blocs, les commandes publiques répondent au simple clic : filtres de tags, catégories de la barre latérale, liens d’ancre de la navigation. Un lien externe sans `target=_blank` s’ouvre dans un nouvel onglet : l’iframe ne quitte jamais le site édité. `EdCanvas.setMode` reste pour compatibilité, plus aucun bouton ne l’appelle.

## Tags (3.28.0)

🏷 Tags ouvre un vrai gestionnaire (`edWinTags`, fenêtre large `.edwin.xl`) : liste des tags à gauche (↑↓ = ordre de la barre de filtres du site), à droite le tag choisi : renommer (Entrée), supprimer, présentation (◫ barre de filtres et cartes, ▤ barre seule, ▣ cartes seules) et projets rangés dedans (clic sur la couverture, filtre, tout ajouter / tout retirer). Données : `cfg.projectTags` (ordre), `cfg.tagDisplay[tag en minuscules]` (`bar` / `card`, absent = les deux), `project.tags`. Site publié : `barTags()` (ordre du catalogue, sans les « cartes seules », orthographe du catalogue) alimente la barre de filtres et les catégories de la barre latérale ; `cardTags()` retire des cartes les « barre seule ». `data-tags` garde tous les tags pour que le filtre fonctionne.

## Zones de dépôt (3.28.0)

`js/hub-drop.js` habille tout `<input type="file">` visible (pas `hidden`, pas déjà dans une étiquette) d’une zone « Dépose un fichier ici ou clique pour parcourir » avec formats et taille max (`data-max` en Mo, `data-label`). Le dépôt remplit `input.files` puis déclenche `change` : les gestionnaires existants (envoi du logo, du favicon, de la musique, du son de clic) n’ont pas changé. Fichier refusé si hors `accept`.

## Édition rapide sur téléphone (3.29.0)

Sous 820 px, `edRefreshPreview` ne génère plus l’aperçu (`EdLite.active()`) : l’iframe avec tout le site, ses images et ses effets pesait trop en mémoire sur un téléphone. `js/editor-lite.js` (`EdLite`) affiche à la place une page façon Linktree, en sections repliables : 🔗 Liens (ajout avec détection de la plateforme, modification, ↑↓ = ordre des blocs Lien, retrait avec son bloc), 📁 Projets (＋ Nouveau projet, 🅱 Depuis Behance, liste), 🏷 Tags (créer ; toucher un tag ouvre le gestionnaire), 🎵 Musique & son (lien ou fichier, retirer la musique), ✳ Profil (nom, bio, e-mail). Mêmes données que l’éditeur complet (`hub_links` + `placeBlocks(getBlocks())`, `hub_projects`, `SiteConfig`), publication automatique selon son réglage. « Éditeur complet » le force pour la session (`sessionStorage.hub_ed_full`) ; un aperçu chargé sur grand écran est libéré (`about:blank`) en passant sur petit écran. Mise en page, thème, effets : sur ordinateur.

## Tags : état de publication (3.29.2)

Un réglage de tag (présentation, projets) change l’aperçu tout de suite mais le site en ligne seulement à la publication. Sans publication automatique, la fenêtre Tags le dit et propose « 🚀 Publier ». Les clés de `tagDisplay` sont normalisées (NFC) : un « Vidéo » à accent décomposé ne crée plus un tag fantôme. Les pages projet (`projets/<slug>/`) n’affichent plus les tags « barre de filtres seulement ».
