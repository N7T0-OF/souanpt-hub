# Audit de contenu — OpenBento → Souanpt Hub

Source analysée : `G:\2_Logiciel\CLAUDE CODE\EXEMPLE\openbento-main`
(React / TypeScript / Vite / Tailwind — MIT © 2025 Yoan Bernabeu).
Licence et crédits : voir `THIRD_PARTY_LICENSES.md`.

Cet audit répond à la demande §1 du cahier des charges V3. Il n'est PAS théorique :
chaque ligne a été vérifiée dans le code, pas seulement dans le README.

---

## Vue d'ensemble

| Sujet | Fichier OpenBento | Constat vérifié |
|---|---|---|
| Types de blocs | `types.ts` | **7 types seulement** : LINK, TEXT, MEDIA, SOCIAL, SOCIAL_ICON, MAP, SPACER |
| Grille | `components/Builder.tsx` | CSS Grid **9 colonnes**, rangées **fixes 64 px**. Aucune bibliothèque. |
| Placement | `types.ts` + `Builder.tsx` | **Absolu** : `gridColumn`/`gridRow` (1-based) + `colSpan`/`rowSpan` |
| Déplacement | `Builder.tsx` | **Drag HTML5 natif** (`draggable`, onDragStart/onDrop) = échange de 2 blocs |
| Redimensionnement | `Builder.tsx` | **Pointer Events** sur window, spans recalculés en direct |
| Collisions | `Builder.tsx` | AABB + Set de cellules + findNextAvailablePosition. **Chevauchements TOLÉRÉS** (z-index par ordre du tableau) |
| Responsive | `utils/mobileLayout.ts` | **Dérivation** desktop→mobile (colSpan≥5 → 2 col, sinon 1). Pas 3 layouts. |
| Sauvegarde | `services/storageService.ts` | **100 % localStorage** (`openbento_bentos`, assets base64) |
| Historique | `hooks/useHistory.ts` | past/future bornés à 50 + dédup JSON |
| Médias / GIF | `components/Block.tsx` | `<img>`/`<video>` + `object-position: X% Y%` → **jamais ré-encodé** |
| Recadrage | `components/ImageCropModal.tsx` | canvas → JPEG 512 px, **UNIQUEMENT pour l'avatar** |
| Registre social | `socialPlatforms.ts` | `{id,label,icon,color,placeholder,buildUrl}`, ~26 plateformes |
| Analytics | `supabase/functions/*`, `ANALYTICS.md` | 2 Edge Functions Supabase + Postgres. **C'est le SEUL rôle de Supabase.** |
| YouTube dynamique | — | **N'EXISTE PAS** dans ce dépôt (un bloc MEDIA peut intégrer une URL vidéo, rien de dynamique) |

---

## Détail par fonctionnalité

### 1. Moteur de grille
- **Fichier** : `components/Builder.tsx` (`GRID_COLS=9`, `getGridCellFromPointer`, `resizeBlockAndResolve`, `findNextAvailablePosition`, `reflowGrid`).
- **Fonctionnement** : grille CSS 9 colonnes, rangées fixes 64 px ; chaque bloc a `gridColumn/gridRow/colSpan/rowSpan`.
- **Réutilisable directement** : les MATHS (AABB, Set d'occupation, recherche de place, px→cellule).
- **À réécrire** : tout le React ; le drag HTML5.
- **Destination Souanpt Hub** : ✅ **DÉJÀ FAIT** — `js/core.js` (`blocksOverlap`, `occupiedCells`, `findFreeSpot`, `placeBlocks`) adapté en JS natif, grille **4 colonnes** / rangées **150 px**, **chevauchements INTERDITS** (amélioration vs OpenBento).

### 2. Déplacement
- **Fichier** : `Builder.tsx` (handleDragStart/handleDrop).
- **Constat** : drag HTML5 natif → aperçu rigide, simple permutation. **Point faible.**
- **Décision** : **NON repris.** Souanpt Hub utilise Pointer Events + maintien + fantôme + FLIP (`js/canvas.js`), déjà supérieur.

### 3. Redimensionnement
- **Fichier** : `Builder.tsx` (`handleResizeStart`, Pointer Events).
- **Réutilisable** : la logique (poignée, spans en direct, userSelect off).
- **Destination** : ✅ déjà adapté (`js/canvas.js` `_resize`, aimantation 3 tailles).

### 4. Médias & GIF (la pièce maîtresse)
- **Fichier** : `components/Block.tsx` (bloc MEDIA), `mediaPosition {x,y}` 0-100.
- **Fonctionnement** : le média est rendu tel quel avec `object-position` = point focal ; jamais recadré destructivement → **le GIF reste animé**.
- **Destination** : ✅ **DÉJÀ REPRIS** — `bFocal`/`focalCss` (core.js) + curseurs de cadrage (canvas.js). Corrige notre défaut (`compressImageSrc` figeait les GIF).

### 5. Registre social
- **Fichier** : `socialPlatforms.ts` — `{id, label, icon, color, placeholder, buildUrl(input)}`.
- **Réutilisable** : la STRUCTURE (les icônes sont Lucide/simple-icons → à remplacer par emoji/SVG).
- **Destination** : ✅ **DÉJÀ REPRIS** — `SOCIAL_PLATFORMS` (core.js), 13 plateformes en JS natif.

### 6. Historique / sauvegarde / export
- **Fichiers** : `hooks/useHistory.ts`, `services/storageService.ts`.
- **Constat** : localStorage-only (même limite que nous), export/import JSON, `gridVersion` + migration.
- **Destination** : historique ✅ déjà équivalent (EdCanvas `_hist/_redo` bornés). Export/import JSON + snapshot = **À FAIRE** (V3 restant).

### 7. Analytics
- **Fichiers** : `supabase/functions/openbento-analytics-{track,admin}`, `ANALYTICS.md`.
- **Constat** : endpoint public d'écriture + service_role côté serveur + lecture admin protégée.
- **Décision** : **NE PAS migrer.** Notre Worker Cloudflare + Firestore est déjà l'équivalent exact. Aucun gain.

### 8. Widgets dynamiques (YouTube, Twitch, Instagram, GitHub, Modrinth, Discord…)
- **Constat** : **ABSENTS d'OpenBento.** Le cahier des charges V3 (§6-§18) les décrit comme une évolution PROPRE à Souanpt Hub.
- **Implication** : ce n'est pas un « import » depuis OpenBento — c'est un développement neuf :
  adaptateurs par plateforme, cache serveur (Workers), OAuth (Instagram/Twitch),
  quotas d'API. Chantier multi-sessions, plusieurs décisions requises (voir plan).

---

## Ce que Souanpt Hub a DÉJÀ (au-delà d'OpenBento)
- Placement absolu **sans chevauchement** (OpenBento tolère les chevauchements).
- Drag Pointer Events + maintien + fantôme + FLIP (OpenBento = drag HTML5).
- Backend réel (Firebase Auth + Firestore) — OpenBento n'a **aucune** auth.
- Analytics serveur (Worker + Firestore) — OpenBento délègue à Supabase.
- Clients, Facturation, Portails, Avis, Classement, Premium — hors périmètre OpenBento.

## Reste à faire (issu de cet audit + §25 du cahier des charges)
1. **Généraliser le rendu par blocs aux 3 styles** (Flottante & Latérale rendent
   encore des sections fixes, pas le modèle de blocs). ← le vrai point dur.
2. Palette « + » + sélection disponibles dans les 3 styles (dépend du point 1).
3. Widgets dynamiques (piste NEUVE) — commencer par YouTube et GitHub (données
   publiques, sans OAuth), via un Worker de cache `stale-while-revalidate`.
4. Export/import JSON + snapshot avant publication.
5. Registre de blocs unifié (comme le registre social) pour supprimer les `if/switch`.
