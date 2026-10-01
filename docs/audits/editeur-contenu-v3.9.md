# Section Contenu / Éditeur de site — bannière, sections, raccourcis, états grises (v3.9.0)

> Demande : travailler seul sur « griser les parties non disponibles + amélioration
> de la section Contenu / Éditeur de site » : bannière principale, ajout de sections
> dans la colonne (donc raccourci), défilement fluide, section réseau + section stats
> (auto ou API publique : *35 k téléchargements, 65 clients, 146 miniatures* —
> une vitrine stats), puis suggestions / améliorations / optimisations.

## 1. Livraison

| Demande | Livré | Repère |
|---|---|---|
| Bannière principale | Fenêtre `🖼 Bannière` : accroche, image (import / URL / retrait), action (lien, section, projet), afficher/masquer | `js/canvas.js:1147`, `app.html:1452` |
| Image de bannière sur **tous** les thèmes | Le thème **Flottante** reçoit le fond image + voile sombre (jusqu'ici réservé à la Latérale) | `js/core.js:1595` (CSS), gabarit du hero |
| Ajout de sections dans la colonne | Colonne « Blocs » : `Chiffres clés` et `Réseaux` ajoutées à la liste | `js/ui.js:279` (`ED_SECTIONS`), rendu `js/ui.js:399` |
| … donc raccourci | Nom de section **cliquable** → ouvre `☰ Sections` ciblée ; groupe « Sections » dans la palette `＋` ; touches `S B T E ?` | `js/ui.js:406` (`edOpenSections`), `js/canvas.js:1560`, `js/canvas.js:1606` |
| Défilement fluide | `html{scroll-behavior:smooth;scroll-padding-top:92px}`, coupé si `animLevel:'none'`, `prefers-reduced-motion` respecté | `js/core.js:1577` |
| Section réseau | Section `Réseaux` : les liens du profil, enfin rendus **hors thème Bento** (les blocs Lien y étaient ignorés) | `js/core.js` — `secHtml.socials` (~`:1514`) |
| Section stats (vitrine) | Section `Chiffres clés` : cartes de compteurs, 3 sources — **auto**, **valeur saisie**, **API publique** | `js/core.js` — `secHtml.stats` (`:1507`), panneau `js/canvas.js:1015` |
| Griser les parties non disponibles | `setNa` + `refreshAvail` : publier, sync Behance, déposer / aperçus / sortir les images, optimiser, publier un portail | `js/ui.js:679`, `js/ui.js:690`, CSS `app.html:828` |

## 2. Les deux nouvelles sections

- **Masquées par défaut** (`stats:false, socials:false` posés *avant* la config
  utilisateur dans `sec`, `edSecVis()` et `_edVis`) : un site publié avant v3.9
  ne change **pas** d'apparence tant qu'on ne les active pas. C'est la règle
  constante du générateur.
- Elles n'ont **pas de bloc** : `placeExtra()` (`js/core.js:1546-1553`) les insère
  dans le corps des thèmes Flottante / Latérale **à leur rang dans l'ordre**
  (colonne « Blocs » ou `☰ Sections`). En thème **Bento**, la grille reste
  intacte : elles passent entre la grille et le pied de page (`extraSections`).
- **Contenu vide ⇒ invisible** : ni section, ni entrée de navigation
  (`secLive`, `js/core.js:1299`).
- `☰ Sections` active `Chiffres clés` **avec des chiffres déjà remplis**
  (`edEnsureStats`, `js/canvas.js:975`) : une section activée mais vide
  donnerait l'impression que le bouton « ne fait rien ».

## 3. Chiffres clés : auto, saisi, API publique

| Source | Valeur | Exemple |
|---|---|---|
| `auto` | calculée **chez toi**, à la génération, depuis le localStorage du Hub | Projets, Clients, Fichiers en ligne, Vidéos, Images, Miniatures créées, Avis, Factures, CA encaissé |
| `value` | saisie à la main | `Téléchargements : 35 k` |
| `api` | **URL JSON publique** relue à chaque visite | `…/TOTAL.json` + chemin `views` |

- Sources : `STAT_SOURCES` (`js/core.js:914`), `statValues()` (`js/core.js:920`),
  `statItems()` (`js/core.js:943`).
- **Pourquoi figer les valeurs auto ?** Le site publié est un fichier statile :
  il ne lit pas le localStorage du Hub (origin différente). Le calcul se fait
  donc au moment de générer (aperçu ou publication) et la valeur est gravée
  dans le HTML. « Miniatures créées » = `HubImages.stats().offloaded`, c'est-à-dire
  les couvertures sorties du navigateur (miniature locale + fichier GitHub).
- **API publique** : la carte porte `data-kpi-url` / `data-kpi-path` /
  `data-kpi-pre` / `data-kpi-suf` et un script de 14 lignes
  (`js/core.js:1900`) tente l'URL en direct, puis deux relais CORS gratuits,
  puis **garde la valeur gravée** (aucune erreur affichée, page lisible sans
  réseau). Aucun compte, aucun service payant.
- Panneau de configuration : liste des chiffres (valeur + étiquette `auto` /
  `saisi` / `API`), `＋ Source`, `＋ Valeur`, `＋ API` (`js/canvas.js:1015`).

## 4. Bannière principale

- `🖼 Bannière` dans la barre d'outils de l'éditeur (`app.html:1452`) : accroche
  (`heroText`), image (`heroImage` : import fichier, URL, retrait), action
  (`heroLink` : aucun / lien / section / projet + libellé + nouvel onglet),
  bouton masquer/afficher (bloc `b_profile`).
- **Thème Flottante** : le hero reçoit le fond image, un voile en dégradé et un
  titre en blanc — lisibilité garantie sur n'importe quelle photo — et devient
  cliquable si une action est configurée. La règle « **jamais d'<a> dans un <a>** »
  est tenue : l'action remplace les deux boutons d'accroche.
- **Thème Latérale** : image et action déjà prises en charge (inchangé).
- **Thème Bento** : la carte Profil garde son dégradé ; la fenêtre l'indique
  explicitement et renvoie aux thèmes Flottante / Latérale (une photo en fond de
  grille rendrait le texte illisible).
- Astuce de performance mise à jour : « Bannière sans image » pour tous les
  thèmes concernés, au lieu du conseil réservé à la Latérale (`js/ui.js`).

## 5. Une seule voie pour l'activation d'une section

`edSetSectionVisible(k, on)` (`js/ui.js:435`) est appelée par la **colonne**,
la **palette** et **`☰ Sections`**. Correction : auparavant chaque surface
tenait son propre état et `edGetConfig()` laissait la colonne gagner
(`{...cfg.sections, ..._edVis}`) — l'œil de `☰ Sections` pouvait donc ne rien
changer à l'aperçu.

## 6. Défilement fluide

- `js/core.js:1577` : `scroll-behavior:smooth` + `scroll-padding-top:92px`
  (la barre est collante, sinon le titre visé passe dessous).
- Absent si `animLevel:'none'`, et neutralisé par `prefers-reduced-motion:reduce`.

## 7. Boutons « non disponibles » grises

`setNa(el, ok, raison)` pose `.na` (gris + `grayscale` + `not-allowed`),
`disabled`, `aria-disabled` et **la raison dans l'infobulle**, puis restaure
l'infobulle d'origine quand l'action redevient possible.

`refreshAvail()` est rappelé au chargement (`app.html:3350`), à chaque
navigation (`showPage`) et à chaque changement de session (événement `hub-auth`
émis par `Auth.save` / `Auth.clear`, `js/core.js:238`), ainsi qu'après le
rendu des portails.

| Bouton | Grisé quand | Raison affichée |
|---|---|---|
| `🚀 Publier` (`app.html:1371`) | GitHub non connecté | « Connecte GitHub pour publier ton site » |
| `↻ Sync Behance` | aucun pseudo Behance | « Ajoute ton pseudo Behance dans Paramètres → Intégrations » |
| `＋ Déposer des fichiers` (`app.html:1709`), `🖼 Aperçus manquants`, `📤 Sortir les images` | GitHub non connecté | « Connecte GitHub pour … » |
| `🗜 Optimiser` | aucune image locale à optimiser | « Aucune image locale à optimiser » |
| `🚀 Publier` (portail) | ni cloud ni GitHub | « Connecte Google (Paramètres) ou GitHub pour publier ce portail » |

## 8. Optimisations et corrections livrées en même temps

1. **Plus de liens d'ancre morts.** La navigation listait `sec[k]` : masquer le
   bloc Contact, ne plus avoir de projet ou ne pas de texte À propos laissait un
   lien qui ne menait nulle part. `secLive(k)` (`js/core.js:1299`) teste le
   contenu **réellement rendu** et sert à la nav flottante, au menu mobile, à la
   nav latérale, aux catégories (`js/core.js:1828`), au bouton `Me contacter`
   de la barre (`js/core.js:1830`), à l'action de bannière et aux sections
   nouvelles.
2. **Nav du thème Bento remplie** : elle était `<div class="nl"></div>` vide.
   Elle ne propose maintenant que des ancres **qui existent** sur cette page
   (`js/core.js:1561`) — la grille n'a pas d'identifiant de section.
3. **Un seul registre d'icônes** : `platIconOf()` (`js/core.js:893`) partagé
   par la grille Bento et la section Réseaux → même lien, même icône, à deux
   endroits.

## 9. Vérifications

| Suite | Résultat |
|---|---|
| Générateur (`generateSite`) : rendu par défaut, ordres, 3 sources de chiffres, réseaux, bannière (image / action / sans lien imbriqué), nav sans ancre morte, `animLevel:'none'`, Bento, Latérale | **47 / 47** |
| Interface : colonne, `S`, panneau de stats (activation + ajout + retrait), `B`, `T`/`E`, `Ctrl+S` ignoré, états grises sur 3 pages, absence d'erreur JS | **31 / 32** (le seul écart = une assertion de casse sur le titre « Animations & effets », la fenêtre s'ouvre bien) |
| Aperçu de l'éditeur : sections rendues dans l'iframe, activation/désactivation, retour à l'état d'origine, clic sur le nom de section | **11 / 11** |

Les tests s'exécutent en production de données réelles mais **restaurent la
configuration complète** (`SiteConfig.save(snap)`) en fin d'exécution, et les
fichiers de test sont supprimés avant le commit.

## 10. Volontairement hors périmètre

- **Firebase : suspendu à la demande** (« pour le moment touche pas ; mais juste
  en suspend »). L'étape « règles Firestore P0 » reste **non traitée**, comme
  l'étape manuelle **T5** (`GH_CLIENT_ID` à poser dans Cloudflare Pages). Rien
  n'a été modifié côté `functions/`, `cloud.js` ou `cloud-firestore.rules`.
- **Numérotation** : v3.9.0 porte ce chantier (demande prioritaire). La réserve
  « suppression des jointures par nom » passe à **v3.10.0**.
- Posture produit « gratuit » conservée : ni compte, ni service payant, ni
  mention « open source ».

## 11. Livraison

- **Commit** `3dcf30e` poussé sur `origin/main` (6 fichiers, +732 / −57) :
  `app.html`, `js/core.js`, `js/canvas.js`, `js/ui.js`, `js/quote.js`,
  `docs/audits/editeur-contenu-v3.9.md`. Les fichiers de test ont été supprimés
  avant le commit ; `.freebuff/` reste le seul dossier non suivi.
- **Tag + release** : `v3.9.0` → <https://github.com/N7T0-OF/souanpt-hub/releases/tag/v3.9.0>.
- **Check-runs sur `3dcf30e`** : `Cloudflare Pages` → `success`,
  `deploy` (GitHub Pages) → `success` ×2 ; déploiement `github-pages` → `success`.
- **Sites revérifiés après déploiement** :
  - `souanptjub.pages.dev/app` : `HUB_VERSION = 3.9.0`, 19 scripts, boutons
    `🖼 Bannière` et `☰ Sections` présents, **0 erreur console** ;
  - `n7t0-of.github.io/souanpt-hub/app.html` : mêmes marqueurs v3.9.0 ;
  - `js/quote.js` des deux origines contient la ligne `['3.9.0', …]` →
    l'annonce « 📦 Nouvelle version v3.9.0 » (catégorie **Générale**) se pose
    seule au premier affichage (`Notify.checkVersion`, `js/quote.js:1401`).
    Vérifié en page : note `sys-v3.9.0 · general`, cloche = 1, `#nt-ver` = `v3.9.0`.
- **Relais** : `souanptjub.pages.dev/api/gh` répond `401` (fonction déployée,
  authentification requise) — il n'existe pas d'endpoint `/api/health`
  (`functions/api/` ne contient que `auth.js` et `gh.js`).
- **Console locale** (`localhost:8766`) : seuls les messages **préexistants**
  `api/auth?op=status` (404 / CORS sur `souanpthub.pages.dev`), imputables à T5
  et hors périmètre de ce chantier.
- **Toujours en attente** : `GH_CLIENT_ID` (étape manuelle T5) et les règles
  Firestore P0 (suspendues à la demande).
