# Audit — Refonte de l'Éditeur de site · v3.10.0

> Chantier livré le 01/10/2026 · commit `7851648` · tag `v3.10.0` ·
> release https://github.com/N7T0-OF/souanpt-hub/releases/tag/v3.10.0
> Produit **gratuit** (posture produit, cf. `docs/audits/project-cleanup-v3.md` §6).

## 1. Direction

Rendre l'éditeur **plus compact, plus clair et cohérent d'un builder visuel** :

* la **colonne « Blocs » devient le centre de structure** (elle seule configure les sections),
* la **topbar ne porte que les réglages globaux** (thème, effets, bannière, historique, modes, sauvegarde, export),
* la **bannière est une vraie partie du site**, systématiquement représentée par `b_profile`,
* les **Chiffres clés** deviennent réellement éditables,
* les **Réseaux** deviennent un vrai gestionnaire, adossé au registre existant.

Règle tenue : **aucun système parallèle** — `SiteConfig`, `getBlocks()`, `SOCIAL_PLATFORMS`,
`STAT_SOURCES`, `EdWin`, `hub_links` et `generateSite()` sont réutilisés tels quels.

## 2. Barre supérieure (`app.html`)

* `☰ Sections` **retiré** de la topbar (aucun appel `edWinSections` ne reste dans la barre).
* Conservés : `🎨 Thème · ⚡ Effets · 🖼 Bannière · ↶ ↷ · ✎ Édition · 👁 Aperçu · ↑ Sauver · ⬚ Ouvrir · ⬇ Exporter`
  (10 boutons, statut du canvas, jauge de performance).
* Marqueurs `.edtb`, `.edtb-cmds`, `.edtb-sep` (3 séparateurs de groupes), `.edtb-b`, `.edtb-t` (libellés).
* **Compactage** :
  * espacements resserrés (`gap:5px`, padding 5×9 px) ;
  * sous 1280 px : `.edtb-t` (libellés) et `.edperf-times` masqués → icônes + infobulles ;
  * sous 980 px : jauge limitée à 130 px, statut canvas masqué ;
  * `.edperf{min-width:0}` : la jauge rétrécit au lieu d'écraser les commandes.

## 3. Colonne « Blocs » (`app.html`, `js/ui.js` inchangé)

* En-tête remplacé par `Blocs   ✏️` (`.ed-blocks-h` + `.ed-blocks-go`).
* Le `✏️` appelle `edWinSections(this)` : **accès unique** à la configuration des sections
  (titre de l'infobulle : « nom, ordre, Chiffres clés, Réseaux — raccourci S »).
* Le raccourci `S` et l'ouverture par le nom d'une section (`.ed-sec-go`) restent valides.

## 4. Bannière — correction critique (`js/core.js` → `getBlocks()`)

**Constat (reproductible)** : `getBlocks()` réutilisait `cfg.blocks` dès qu'il existait, **sans
garantir la présence de `b_profile`**. Résultat : projets et liens en place, mais bannière
disparue (`heroHidden` interprète « absent » comme « masqué ») et bouton « Masquer la
bannière » de 🖼 Bannière silencieux (`bn-vis` exige `i >= 0`).

**Correction** — la fonction garantit désormais, à chaque appel :

| Cas | Traitement |
|---|---|
| `b_profile` absent | recréé **en tête** (`{id:'b_profile', type:'profile', w:2, h:2}`), visibilité d'une configuration ancienne reprise |
| `b_profile` ailleurs dans la liste | déplacé en **première position** |
| visibilité ancienne (`hidden` OU `visibility.public === false`) | **lue AVANT normalisation** (un bloc « informe » perdait ce champ au passage par `normalizeBlock`) puis réappliquée |
| autres blocs | **jamais touchés** |

**Chaîne vérifiée** : `edWinBanner()` → `SiteConfig.heroImage` → `getBlocks()` → `generateSite()`
→ iframe d'aperçu → publication. Le bloc Profil est présent dans le HTML généré
(`data-b="b_profile"`) y compris depuis une `cfg.blocks` incomplète ; `edWinBanner` (`bn-vis`,
`bn-href`, `bn-file`, `bn-url`, suppression) bascule désormais toujours sur un bloc existant.
Les images lourdes passent par `HubImages` (`resolveCfg`/`migrate` : original conservé sur
GitHub + miniature locale).

## 5. Chiffres clés — véritable éditeur (`js/canvas.js` → `edStatsPanel()`)

Chaque carte affiche `valeur · libellé · badge (auto|saisi|API) · ↑ ↓ · ✎ · ✕` :

* **✎** ouvre un formulaire en ligne (micro-fenêtre dans la carte) : `Type`, `Source`
  (automatique), `Libellé`, `Valeur`, `URL JSON` + `Chemin` + `Valeur de repli` (API),
  `Préfixe`, `Suffixe`, `Annuler / Enregistrer` ;
* changer de **type** réécrit l'item avec des valeurs valides puis rouvre le bon formulaire
  (pas d'état incohérent « valeur saisie → automatique sans source ») ;
* **↑↓** réordonnent (`stWrite` déplace les items) — l'ordre public suit exactement l'ordre
  de la liste ;
* **✕** retire le chiffre (inchangé) ; les trois ajouts (Source / Valeur / API) sont conservés ;
* **nouveauté** : le couple `prefix`/`suffix` fonctionne aussi pour les **sources automatiques**
  (`statItems`, `js/core.js`) — `+` / `3` / `projets` se configure partout de la même façon.

## 6. Réseaux — gestionnaire (`js/canvas.js` → `edSocialsPanel()`)

Panneau intégré à la carte « Réseaux » de ☰ Sections (entrée unique avec le `✏️`).

**Stockage** : `hub_links` + blocs Lien (`b_link_*`) — exactement ce que consomment la grille
Bento, la section Réseaux et la zone Contact. Aucune structure parallèle.

* **Liste** : `icône · nom · identifiant/URL · ↑ ↓ · 👁/◌ · ✎ · ⧉ · ✕` (ordre = ordre des blocs
  = ordre public).
* **＋ Ajouter** : sélecteur des **15 plateformes du registre** (`SOCIAL_PLATFORMS` étendu de
  `WhatsApp` et `Telegram`) → identifiant (+ nom affiché facultatif, `☑ Afficher dans Contact`)
  → **URL construite automatiquement par `buildUrl()`** + icône + couleur issues du registre.
* **Détection** : champ « … ou colle une URL » → `socialDetect()` lit le domaine
  (`SOCIAL_HOSTS` : instagram, tiktok, youtube, behance, github, linkedin, twitch, modrinth,
  ko-fi, x, discord, wa.me, t.me…) et propose la plateforme + le pseudo
  (`instagram.com/souanpt` → `Instagram — @souanpt`, invitation Discord, `mailto:`, LinkedIn `/in/…`).
* **Édition** : identifiant/URL (recalculé par `buildUrl`), nom affiché, `☑ Contact`.
* **👁/◌** : bascule la visibilité du bloc Lien (un réseau masqué disparaît partout).
* **⧉ Dupliquer**, **✕** retire le lien **et** son bloc (aucun orphelin).
* **Présentation** (`cfg.socialsStyle`) : `icône + texte` (défaut), `icônes seules`, `boutons`,
  `cartes`, `barre` — rendu public + CSS dédiés dans `js/core.js`.
* **Résolution unique** : `socialOfLink()` (id enregistré → titre → URL) est utilisée par la
  section Réseaux, la zone Contact et la grille Bento ; `platIconOf()` étendu (X, Modrinth,
  WhatsApp, Telegram).

## 7. Réseaux ⇄ Contact (`js/core.js` → `contactList()`)

* Un réseau marqué `inContact` rejoint la zone « Me contacter » **sans changer de système** :
  lu depuis les blocs Lien **visibles** (un lien masqué ne fuite jamais), sans doublon d'adresse
  et avec l'icône/couleur du registre.
* Contact et Réseaux restent deux listes distinctes : `contactMethods` (email, téléphone…)
  n'est pas modifié, les réseaux viennent le **compléter**.

## 8. Compatibilité / migration

* **Idempotent** : `getBlocks()` appelé deux fois donne la même liste (testé).
* Configurations sans `sectionMeta` / `stats` / `socials` / `blocks` : inchangées (test).
* **Aucun site publié ne change d'apparence** : présentation par défaut = ancien rendu
  (`soc soc-ic-texte`), sections Chiffres clés / Réseaux toujours masquées par défaut.
* `SiteConfig.defaults()` : ajout documenté `socialsStyle: 'ic-texte'`.

## 9. Tests (fichiers temporaires supprimés avant commit)

| Suite | Résultat | Couverture |
|---|---|---|
| `_test-v310-gen.js` (générateur) | **55/55** | `b_profile` recréé/en tête/idempotent/visibilité legacy, bannière dans le HTML (URL, data, Latérale, retrait), section Réseaux + 5 présentations, icônes/couleurs du registre, lien masqué absent, aucun lien vide, `socialDetect` (10 cas), `buildUrl` (6 cas), 15 plateformes, Contact (présent, sans doublon, masqué absent), Chiffres (4 cartes, valeur gravée, préfixe/suffixe auto, libellé, API, ordre), non-régression du rendu par défaut |
| `_test-ui-v310.js` (interface) | **56/56** | topbar sans ☰ Sections (10 boutons, 3 séparateurs), ✏️ présent, activation des 2 sections, fenêtre (6 cartes + 2 panneaux + 15 plateformes), édition ✎ (libellé enregistré, formulaire refermé), ↓ réordonner, ajout d'une valeur, changement de type, suppression, ajout Instagram (URL auto + bloc créé), détection GitHub depuis une URL, édition (URL recalculée + Contact), 👁 masquer/afficher, duplication, réordonnancement, présentation « cartes », suppression sans orphelin, raccourci `B` (bannière), aperçu généré (stats + réseaux + bannière), **0 erreur JS** |
| Console (local + Cloudflare) | **0 erreur** | — |
| Console (GitHub Pages) | erreurs **prévues T5** | `souanpthub.pages.dev/api/auth?op=status` (404/CORS préexistant) |

## 10. Hors périmètre / reporté

* **« Suppression des jointures par nom »** (réservée pour v3.10) → reportée en **v3.11.0**
  (v3.10.0 ayant été prise par ce chantier).
* Suggestions non retenues pour l'instant (à re-proposer) : recherche dans les réseaux,
  favoris/réseau principal, compteur de clics (le champ `clicks` existe déjà côté modèle),
  glisser-déposer des réseaux (flèches ↑↓ livrées), import/export de section, « tout
  masquer/afficher », état brouillon/publié.
* Firebase / règles Firestore : **suspendues à la demande** (non relancées).
* T5 (OAuth GitHub / `GH_CLIENT_ID`) : hors périmètre, étapes manuelles inchangées.

## 11. Livraison

| Élément | Référence |
|---|---|
| Fichiers modifiés | `app.html` (+88/−30 lignes… au total : 4 fichiers, **+496 / −30**), `js/canvas.js` (+284), `js/core.js` (+153), `js/quote.js` (+1) |
| Tests supprimés | `_test-v310-gen.js`, `_test-ui-v310.js` (avant commit) |
| Commit | `7851648` (UTF-8 sans BOM) poussé sur `origin/main` |
| Tag | `v3.10.0` → `7851648` (même SHA que `HEAD` et `origin/main`) |
| Release | https://github.com/N7T0-OF/souanpt-hub/releases/tag/v3.10.0 (publiée) |
| Check-runs | **3/3 `success`** sur `7851648` : Cloudflare Pages, deploy, deploy |
| Cloudflare Pages | https://souanptjub.pages.dev/app → **v3.10.0**, 10 boutons, ☰ absent, ✏️, 6 cartes, panneaux Chiffres/Réseaux, 15 plateformes, **0 erreur** |
| GitHub Pages | https://n7t0-of.github.io/souanpt-hub/app.html → **v3.10.0**, mêmes marqueurs, erreurs = CORS T5 préexistant |
| Annonce | `sys-v3.10.0` · catégorie `general` · « 📦 Nouvelle version v3.10.0 » · non lue · `#nt-ver = v3.10.0` · cloche = 2 |
| Dépôt | `main` = `origin/main` = `7851648`, tags `v3.1.0`…`v3.10.0`, `.freebuff/` seul non suivi |
