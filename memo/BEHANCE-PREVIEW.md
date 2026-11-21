# Fenêtre Behance (aperçu des projets sur le site)

Un projet Behance du portfolio s'ouvre, sur le site publié, dans une fenêtre au-dessus de la page au lieu d'envoyer le visiteur sur Behance. Désactivée par défaut : un site publié ne change pas tant que `SiteConfig.behancePreview.enabled` n'est pas vrai.

## Fichiers

- `js/behance-viewer.js` — `BehanceViewer` : validation, réglages bornés, CSS, code navigateur (`runtime`). Chargé par `app.html` avant `js/core.js`.
- `js/core.js` — `generateSite()` insère `BehanceViewer.css()`, le bloc `<script type="application/json" id="bv-data">` et `BehanceViewer.scriptTag()` **seulement** si la fenêtre est activée et qu'un projet visible s'y prête. `projectOpenAttr()` câble les cartes (Bento et grille) : `bvOpen(data-p)` pour un projet Behance, sinon `window.open(url, '_blank', 'noopener,noreferrer')`.
- `js/behance-editor.js` — `EdBehance` : fenêtre « 🅱 Behance » de l'éditeur et section « Aperçu Behance » de la fiche projet.
- Le site publié et l'aperçu de l'éditeur exécutent le **même** `runtime()` (inséré tel quel par `generateSite()`) : aucun rendu divergent.

## Intégration Behance

- Format officiel vérifié le 20 novembre 2026 sur le projet public 241392957 : `https://www.behance.net/embed/project/<id>?ilo0=1` — réponse 200, sans `X-Frame-Options` ni `frame-ancestors`. La page de galerie (`/gallery/…`) refuse l'affichage et n'est jamais utilisée.
- L'identifiant vient de l'URL du projet (`behance.net/gallery/<id>/…`, déjà enregistrée par l'import RSS `behanceSyncNow`) ou d'un code d'intégration collé (Partager → Intégrer). `idFromEmbedCode()` n'en garde que le numéro (5 à 12 chiffres) après contrôle du domaine `behance.net`, du chemin, du protocole et de l'absence d'identifiants ou de port. Le HTML collé n'est jamais conservé ni injecté.
- La source de l'iframe est reconstruite à partir de l'identifiant validé, avec `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"` (Behance ne peut pas naviguer la page du créateur) et `referrerpolicy="strict-origin-when-cross-origin"`.
- L'intégration Behance présente le projet sous forme de diaporama de ses images, avec un bandeau titre : c'est ce que Behance autorise hors de son site, pas la page complète. Le recadrage permet de masquer le bandeau.
- Un projet supprimé renvoie aussi 200 (Behance affiche son propre message) : la fenêtre ne peut pas le détecter. Le bouton « Voir sur Behance » reste donc toujours disponible.

## Fenêtre et effets (PSD de référence)

Source analysée : `apercu projet.psd`, fourni par le propriétaire et conservé hors du dépôt (1830 × 973, lu avec la bibliothèque ag-psd ; Photoshop absent du poste). Calques, de bas en haut : page en perspective (« Calque 1 », « Calque 1 copie »), rectangle noir, deux dégradés noir → transparent depuis les bords gauche et droit (« Fond en dégradé 1 » et copie, ~47 et 54 % de la largeur), traînées horizontales floues (« Calque 2 copie 24 »), colonne centrale nette et sa copie floue (profondeur), deux copies avec ombre portée noire (taille 29 px × 1,33, contraction 33 %), grain « Fond 1 » en lumière tamisée 30 %, réglage Vibrance +100, puis deux calques masqués (déformation en barillet et vignettage radial) et la capture d'écran d'origine en objet dynamique.

Reproduction (CSS/SVG natifs, aucune image exportée nécessaire) :

| PSD | Web |
|---|---|
| perspective | `.bv-stage{perspective:1700px}` + `.bv-screen{transform:rotateX(--tilt)}` |
| dégradés latéraux | `.bv-sides` (linear-gradient noir 0→30 % / 70→100 %) |
| traînées | `.bv-streak` : couverture du projet, flou SVG horizontal `#bv-blur-x` (σ 56 × 1,5), masquée au centre |
| profondeur | `.bv-dof.t/.b` : `backdrop-filter: blur()` masqué en dégradé |
| ombre portée | `box-shadow: 0 0 39px 13px #000` |
| grain | `.bv-grain` : bruit SVG `feTurbulence`, `mix-blend-mode: soft-light`, opacité 0,43 × intensité (0,30 à 70 %) |
| Vibrance | `filter: saturate()` sur l'iframe ou l'image |
| barillet + vignettage (masqués) | style « Écran incurvé » : arrondis, ombre interne, vignettage radial |

Limite : un navigateur ne peut pas déformer les pixels d'une iframe d'une autre origine ; le barillet est donc approché, jamais appliqué au contenu Behance. Tous les calques décoratifs ont `pointer-events: none` : clics et défilement atteignent l'iframe (vérifié au centre et sur les bords).

Couches, dans l'ordre : 1. iframe Behance ; 2. `.bv-crop` (recadrage) ; 3. `.bv-fx`, `.bv-grain`, `.bv-streak`, `.bv-sides` (décor) ; 4. `.bv-bar` (commandes).

## Recadrage

`.bv-crop` a `overflow: hidden`. L'iframe garde la largeur du cadre (Behance se met en page normalement) puis est agrandie : `transform: translate(x·(z−1) %, −y px) scale(z)`, origine en haut au centre, hauteur `(100 % + y) / z` pour remplir le cadre. `zoom` 1 → 3, `x` −50 → 50 (% du débord latéral), `y` 0 → 600 px rognés en haut. Réglages distincts ordinateur / téléphone (`max-width: 760px`). 

## Un seul mode : Behance en direct

Le mode « Aperçu PNG » et l'export de composition ont été retirés le 21 novembre 2026 (3.13.1) à la demande du propriétaire. Un ancien réglage `mode: 'png'` ou une image `p.preview.png` déjà enregistrée sont ignorés et ne sont plus publiés. La couverture RSS ne sert qu'au décor (traînées latérales).

Limite constatée : l'intégration officielle de Behance est une **carte de projet** (couvertures du projet, `projects/…`), pas le contenu complet (`project_modules/…`). Le contenu déroulant d'un projet n'est disponible que sur behance.net : la page de galerie refuse les accès non navigateur (403) et ne s'affiche pas dans un cadre d'un autre site. Récupérer ce contenu en contournant ces protections (relais, extraction) est exclu. Pour un contenu déroulant dans la fenêtre, les images doivent venir du créateur lui-même (fichiers du projet hébergés par le hub).

## Réglages (`SiteConfig.behancePreview`)

`enabled`, `display` (window | page), `showLink`, `style` (perspective | curved | flat), `width`, `height` (% d'écran), `radius`, `border`, `tilt`, `backdrop`, `effects { on, intensity, grain, streaks, depth, vignette, glow, shadow, saturate, anim }`, `crop { desk, mob }` par défaut. Tout passe par `sanitizeConfig()` (valeurs connues, bornées ; aucun CSS libre). Par projet : `p.preview = { beId?, png?, crop?: { desk, mob } }`.

Dans l'éditeur, chaque changement est enregistré puis envoyé à la fenêtre ouverte dans l'aperçu via `window.bvLive()` (sans recharger). Si l'aperçu ne contient pas encore la fenêtre, il est régénéré et la fenêtre rouverte (`EdBehance.afterPreview`, appelé par `edRefreshPreview`). Les clics dans `#bv` passent à travers la couche d'édition (`EdCanvas._ui`).

## Performance et robustesse

Aucune iframe n'est créée avant l'ouverture ; une seule à la fois, détruite à la fermeture. L'événement `load` d'une intégration Behance n'est pas fiable (il peut n'arriver qu'une fois toutes les images chargées, ou jamais) : au bout de 8 s, le cadre est découvert et une barre discrète propose le lien Behance ; elle disparaît si `load` arrive ensuite. Téléphone : pas d'inclinaison, de traînées ni de flou de profondeur. `prefers-reduced-motion` : pas d'animation. Échap ferme, la tabulation reste dans la fenêtre, le focus revient à la carte (cartes Behance accessibles au clavier).

Sous le relais `/u/<pseudo>`, la page reçoit une CSP `sandbox` sans `allow-same-origin` : ces restrictions s'étendent aux iframes intégrées et l'intégration Behance peut y être dégradée. Sur GitHub Pages, rien ne s'applique.

## Tests

`tests/behance-viewer.test.mjs` : adresses valides et hostiles, format d'intégration, code collé, bornes des réglages, échappement du bloc de données (`</script>` dans un titre), sources d'image refusées (`javascript:`, `data:text/html`), décor sans interception des clics, contraste du texte sur cinq accents. Vérifié dans le navigateur le 20 novembre 2026 : ouverture réelle du projet 241392957, recadrage (valeurs calculées), modes Live/PNG, import d'image, export PNG, barre de repli (adresse injoignable simulée), styles perspective et incurvé, téléphone 375 px, accents citron, violet, cyan, orange, bleu.
