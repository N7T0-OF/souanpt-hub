# Images hors du localStorage — T4

Suite de `backup-unification.md` (T1+T2) et `github-source-de-verite.md` (T3).
Le stockage des données était déjà sur GitHub ; il restait **le poids des
images dans le navigateur**, seul obstacle au quota.

## 1. Le constat

Le quota de `localStorage` plafonne à ~5 MiB (5 242 880 octets) et il est
**partagé par toutes les données du hub** (`js/ui.js` → jauge `stor-bar`).
Une couverture importée pèse 50 à 300 Ko en base64 :

| Élément | Avant | Après |
|---|---|---|
| 3 couvertures test (1400×900, 1200×800, 1000×700) | 331 471 octets | **37 152 octets** |
| Poids par couverture | 79 379 – 138 363 | **10 679 – 13 007** (miniature) |
| Quota consommé | 6,3 % pour 3 images | 0,7 % |

≈ 40 projets et le quota est épuisé : `localStorage.setItem` lève alors une
`QuotaExceededError` **silencieusement absorbée par les `catch` existants** —
la sauvegarde (`autoBackup`), l'import et la création de projet cessent de
s'enregistrer sans message. Le découpage `.partN` de la sauvegarde
(`HubData.MAX_CHARS`) déplaçait le problème vers `data/projects.json`, il ne
le résolvait pas.

## 2. Contrat de stockage

```
AVANT   p.cover      = base64 complet (50–300 Ko) dans localStorage
APRÈS   p.cover      = miniature inline (≤ ~13 Ko) → affichage immédiat
        p.coverFile  = media/<empreinte SHA-256>.jpg → dépôt privé GitHub
```

Pourquoi **aucun affichage n'a bougé** : `p.cover` reste une chaîne
utilisable dans `<img src>` / `background:url(…)`. Les quatre familles de
consommateurs lisent exactement le même champ :

| Consommateur | Emplacement | Format reçu |
|---|---|---|
| Site publié | `js/core.js:1031`, `:1161`, `:1564` | **plein format** (résolu) |
| Aperçu de l'éditeur | `js/ui.js:423` | plein format (résolu) |
| Aperçu nouvel onglet | `js/ui.js:475` | plein format (résolu) |
| Export `index.html` autonome | `js/ui.js:491` | plein format (résolu) |
| Cartes Behance (44×30 px) | `app.html:2624` | miniature |
| Éditeur (aperçu, cadrage, duplication) | `js/canvas.js`, `app.html:2550` | miniature |

Le plein format est **remis à la volée uniquement là où il compte**, par
`HubImages.resolveProjects()` (`js/hub-images.js:216`) et
`resolveCfg()` (`:234`) — copie en mémoire, jamais réécrit dans le
localStorage.

## 3. Où vivent les images

| | |
|---|---|
| Dépôt | `{login}-hub-data` (le même que la sauvegarde), **privé** |
| Dossier | `media/`, jamais `data/` |
| Nom | `media/<sha256 des octets sur 20 car.>.<ext>` |
| Métadonnées | `hub_files` (`visibility:'private'`, `kind:'image'`) → la bibliothèque Fichiers les listent, les compte et permet de les ouvrir (`js/storage-ui.js`) |
| Miniature | 420 px de large, WebP q0.70 (`HubImages.THUMB_W/THUMB_Q`) |
| Seuil | images ≥ 32 Ko (`MIN_OFFLOAD`) : en dessous, le local coûte moins cher qu'un commit |

**Pourquoi pas `data/`** : `autoBackup` supprime sous `data/` tout fichier
absent du manifeste (`GH.dataPaths` ne liste que `data/`, `js/core.js:108`).
Des images y seraient effacées au cycle suivant. `media/` est hors de sa
portée et n'entre dans aucun manifeste.

**Pourquoi privé** : une couverture non publiée ne doit pas devenir
accessible à n'importe qui par une URL brute. Le plein format ne sort du
dépôt privé qu'au moment de la publication, **inliné dans le HTML** — c'est
exactement le comportement d'avant, mais sans peser sur le navigateur.

## 4. Cycle de vie

| Moment | Porte d'entrée | Ce qui se passe |
|---|---|---|
| Ajout d'un projet (éditeur) | `js/canvas.js:1321` | `HubImages.offloadProject(id)` en arrière-plan |
| Ajout/édition (formulaire projet) | `app.html:2480` | idem, après `resetProjectForm()` (cible mémorisée avant) |
| Couverture remplacée | `app.html:2466` | `coverFile = ''` → l'ancien fichier est invalidé, le nouveau est envoyé |
| Couverture inchangée | `app.html:2466` | `coverFile` conservé — pas de renvoi inutile |
| Duplication de projet | `js/canvas.js:1300` | `coverFile` copié avec la couverture |
| Migration | `app.html:2515` → `migrate()` (`:262`) | analyse → **1 commit groupé** → réécriture locale → `autoBackup({force:true})` |
| Publication | `js/core.js:1696` | résolution avant `generateSite` ; `site-config.json` reçoit la copie **non résolue** |
| Hors ligne / token absent | `HubImages.full()` → `null` | la miniature sert, aucune erreur |

## 5. Concurrence d'écriture : le verrou de dépôt

Sauvegarde (`autoBackup`) et envoi d'images écrivent **sur la même branche**
`refs/heads/main`. Deux PATCH concurrents perdent le second
(« Update is not a fast forward ») : l'image serait envoyée mais jamais
référencée.

`withRepoLock()` (`js/core.js:2233`) mutualise les deux : les écritures
d'`autoBackup` sont enveloppées (`js/core.js:2317`), et `HubImages.put()`
(`:140`) / `migrate()` (`:308`) aussi. Attente bornée (60 s), libération en
`finally`. Les dépôts du site ne sont pas concernés (branche distincte).

## 6. Binaire dans un commit groupé

`GH.commitFiles` n'acceptait que du texte (`content` de l'API des arbres) :
un octet hors UTF-8 y serait corrompu. Le support `{ path, b64 }` a été ajouté
(`js/core.js:135`) : chaque binaire devient d'abord un **blob Git dédié**
(`POST …/git/blobs`, `encoding:'base64'`, création séquentielle pour ne pas
déclencher la limite de requêtes simultanées), puis l'arbre référence son
sha. Un seul commit final pour tout le lot.

## 7. Déduplication

L'empreinte est le SHA-256 **des octets** — la même que `HubFiles.hash`. Un
visuel déjà présent sur le dépôt n'est ni renvoyé ni réenregistré : seules les
miniatures sont regénérées. Conséquence : relancer la migration ne coûte
**aucune requête d'écriture**, et un projet dupliqué ne double pas l'image.

## 8. Ce qui a changé

| Fichier | Changement |
|---|---|
| `js/hub-images.js` | **nouveau** — `put`, `offloadProject`, `full`, `resolveProjects`, `resolveCfg`, `migrate`, `stats` |
| `js/core.js` | `commitFiles` binaire ; `withRepoLock` ; verrou sur `autoBackup` ; résolution avant `generateSite` |
| `js/hub-data.js` | commentaire `mirror:'github'` de `hub_projects` mis à jour (les miniatures restent sous la limite Firestore) |
| `app.html` | `<script src="js/hub-images.js">` ; carte « Images & espace navigateur » (2 boutons) ; `offloadImages()` ; hooks de création/édition |
| `js/ui.js` | aperçus + export async et résolus ; astuce de performance recomptée (`HubImages.stats()`) |
| `js/canvas.js` | `coverFile` propagé (duplication) + offload après création |
| `js/storage-ui.js` | `media/` : bascule de visibilité bloquée, avertissement à la suppression |
| `docs/audits/backup-unification.md` | T4 coché |

## 9. Tests exécutés (serveur statique local, `GH`/`fetch`/`Auth` simulés)

| Scénario | Résultat |
|---|---|
| Chargement vierge | **0 message console** (ni erreur ni avertissement) |
| Migration de 3 couvertures | `moved:3`, `freed:295 776`, localStorage 331 471 → 37 152 (−89 %) |
| Écriture | 1 commit `media: 3 image(s)`, 3 blobs, 3 fichiers `media/…` dans l'arbre |
| Métadonnées | 3 entrées `hub_files` (`visibility:private`, sha = empreinte) |
| Re-lancement de la migration | `moved:0`, 0 commit supplémentaire |
| Résolution plein format | octets **identiques** à l'original (138 363 / 106 347 / 86 347), localStorage inchangé |
| Cache de session | 1er appel 32 ms, 2e appel **0 requête** |
| Hors ligne (token absent, cache vidé) | retour aux miniatures, aucune exception |
| Déduplication (mêmes octets renvoyés) | 0 blob, 0 commit, 0 doublon de métadonnées |
| Offload à la création (1300×850) | 117 847 → 11 907 octets |
| UI (bouton « Sortir les images ») | progression « 3 image(s) sortie(s) · 278 Ko libérés », bouton réarmé, jauge 311 → **34 Ko** |
| Publication `deployPortfolio` | `index.html` 472 916 octets contenant les 4 images **complètes** ; `site-config.json` 959 octets **sans base64** ; localStorage toujours en miniatures |
| Aperçu éditeur | 340 654 octets, images complètes, 0 console |
| `optimizeAllCovers` | ignore les couvertures déjà sorties (`!p.coverFile`) |
| `autoBackup` après le verrou | 13 fichiers → 2e appel `pushed:0, skipped:true` → modification locale `pushed:2` |

Artéfact connu des tests : un `401` sur `data/manifest.json`, dû au token
**fictif** utilisé contre l'API réelle lors du boot — inexistant avec un token
valide.

## 10. Limites assumées

1. **Hors ligne, la miniature sert.** Un site publié depuis un appareil
   déconnecté de ses fichiers publicierait des miniatures ? Non : la
   publication exige un token (`deployPortfolio` échoue sinon) — mais la
   résolution reste **silencieusement best effort** : si un fichier manque,
   la miniature part, le site reste cohérent.
2. **Suppression d'une image `media/`** depuis la bibliothèque Fichiers
   retombe en miniature à la publication (avertissement affiché).
3. **Miniature = perte de définition dans l'éditeur** (le carrousel Behance
   affiche 44×30 px, l'éditeur un aperçu réduit). Le site publié, lui, reçoit
   le fichier d'origine — vérifié octet à octet.
4. **`hub_projects` n'est toujours pas miroité vers Firestore**
   (`mirror:'github'`) : 40 miniatures ≈ 800 Ko, à la limite du document de
   1 Mo.
5. **`media/` n'a pas de politique de purge** : remplacer une couverture
   laisse l'ancien fichier sur le dépôt (il reste référencable et devient un
   orphelin). Accepté : purger demanderait de savoir quel appareil a encore
   besoin de lui.
