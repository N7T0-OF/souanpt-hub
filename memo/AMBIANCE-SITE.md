# Ambiance du site (3.16.0)

Inspirée de la page profil haunt.gg du propriétaire (écran d'entrée, fond animé, curseur, compteur en coin, indicateur de défilement). Le tableau de bord haunt.gg est derrière une connexion et une vérification Cloudflare : il n'a pas été consulté.

## Fichiers

- `js/site-ambiance.js` : `SiteAmbiance.sanitize / active / css / html / dataScript / runtime / scriptTag / inject`.
- `js/core.js` : `generateSite` appelle `SiteAmbiance.inject(cfg.ambiance, { editor })` ; CSS en fin de `<style>`, décor + données + runtime avant `</body>`.
- `js/canvas.js` : fenêtre `edWinAmbiance` (bouton 🌌 Ambiance de la barre de l'éditeur).
- `js/preview-mode.js` : la démo du mode aperçu active l'ambiance (braises, anneau, machine à écrire, grain, badge, écran d'entrée).
- `tests/site-ambiance.test.mjs`.

## Réglages (`SiteConfig.ambiance`)

`enter { on, text ≤40, sub ≤60 }`, `particles` (none · snow · stars · embers · rain · dust · bubbles), `density` 1–3, `pColor` (accent · white · mix), `cursor` (none · dot · ring · trail), `typewriter { on, lines[≤6, ≤80 car.], speed 1–3 }`, `progress`, `grain`, `corner { on, text ≤40 }`. Tout est désactivé par défaut : `inject()` renvoie du vide et un site déjà publié ne change pas.

## Règles

- Textes : caractères de contrôle et U+2028/2029 retirés, publiés dans un bloc JSON où `<` est échappé, posés en `textContent` (le runtime n'utilise jamais `innerHTML`). Les séparateurs sont construits avec `String.fromCharCode` : l'outil d'écriture de fichiers transforme les échappements ` ` en caractères bruts, qui cassent les expressions régulières.
- Décor (`#amb-fx`, `#amb-grain`, `#amb-prog`, `#amb-corner`) en `pointer-events: none`.
- Écran d'entrée : clic, Entrée, Espace ou Échap ; il clique le bouton son du site (`#site-sound`) s'il existe, ce qui lance la musique (geste du visiteur, autorisé par les navigateurs). Masqué dans l'aperçu de l'éditeur ; « ▶ Tester » appelle `ambEnter()` dans l'aperçu.
- Machine à écrire : remplace `.hero .hsub` (ou la bannière latérale/Bento) ; `aria-label` porte toutes les phrases.
- Mouvement réduit : pas de particules, pas de grain animé, première phrase fixe. Écran tactile : pas de curseur personnalisé ; téléphone : ~55 % des particules. Animation en pause quand l'onglet est caché.
- Pas de compteur de vues public : la collecte des statistiques est désactivée, un chiffre serait inventé. Le badge en coin est un texte libre (ex. « 📍 FR · disponible »).

## Reste à faire

Grandes tuiles-liens en image (comme « Shop / Contact / Folio » sur haunt.gg) : il faut d'abord une image par lien dans l'éditeur de liens.

## Barre classique masquée sur téléphone (3.29.1)

Safari iOS et certains navigateurs Android ignorent `scrollbar-width` / `::-webkit-scrollbar` pour le défilement de la page elle-même : l’indicateur natif restait visible à côté de la barre lumineuse. Avec la barre lumineuse, sur écran tactile (`(hover:none) and (pointer:coarse)`), `html` est figé et c’est `body` qui défile (`overflow-y:auto`, barre masquée, `scroll-behavior` et `scroll-padding-top` hérités de `html`) : ces navigateurs respectent le masquage sur un élément. La barre lumineuse suit le défilement de `body` (`scroller()`), la fenêtre projet bloque aussi `body`. Ordinateur : inchangé. Effet secondaire assumé : sur téléphone, la barre d’adresse ne se replie plus au défilement quand la barre lumineuse est active.
