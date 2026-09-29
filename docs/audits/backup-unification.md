# Sauvegarde unifiée — T1 + T2 (registre unique + backup complet)

## 1. Le problème, constaté avant le chantier

La liste des collections du hub vivait à **trois endroits qui ne concordaient
pas** :

| Endroit | Fichier | Clés couvertes |
|---|---|---|
| Export JSON (téléchargé) | `app.html` → `HUB_COLLECTIONS` | projects, links, clients, invoices, catalog, reviews, portals, media (**8**) |
| Sauvegarde GitHub (`backup.json`) | `js/core.js` → `autoBackup()` | siteConfig, projects, links, clients, invoices, reviews (**6**) |
| Miroir Firestore | `js/cloud.js` → `SYNC_KEYS` | clients, invoices, catalog, reviews, links, media, portals, files, pricing (**9**) |

**Conséquence** : `hub_portals`, `hub_catalog`, `hub_media`, `hub_files` et
`hub_pricing` ne figuraient dans **aucune** sauvegarde — un problème disque ou
un nouveau navigateur les faisait disparaître. `hub_projects` n'était ni dans
Firestore ni, en pratique, sauvegardé en entier. Aucun des trois ne disait lequel
était la vérité.

Deux défauts aggravants :

- le commit Git avait lieu **toutes les 5 min** quel que soit le contenu
  → ~288 commits/jour, croissance infinie de l'historique ;
- `GHPage.showConnected()` enregistrait `setInterval(autoBackup, …)` **à chaque
  ouverture de l'onglet Intégrations** → N sauvegardes simultanées après N
  ouvertures (`js/ui.js:48-52`).

## 2. Ce qui a été fait

### `js/hub-data.js` — le registre unique (nouveau fichier)

Une seule liste décrit chaque collection :

```js
{ key:'invoices', ls:'hub_invoices', file:'invoices.json', sync:'invoices', type:'array' }
```

| Champ | Rôle |
|---|---|
| `key` | nom dans l'export JSON |
| `ls` | clé localStorage (cache local, lu/écrit par l'UI) |
| `file` | chemin dans le dépôt privé `{login}-hub-data` |
| `sync` | sous-collection Firestore `users/{uid}/data/<sync>` (miroir), `null` si hors miroir |
| `type` | `array` (découpe possible) · `raw` (objet) · `value` (scalaire type `hub_img_quality`) |
| `mirror` | présent ⇒ exclu du miroir `items` de Firestore (config = poussée par `pushConfig`, projects = couvertures base64 > limite 1 Mo d'un doc Firestore) |

`exportMap()` alimente l'export/import JSON, `syncMap()` alimente
`Cloud.SYNC_KEYS` : les 3 tableaux dérivent désormais du même endroit.

**Volontairement hors registre** : `hub_neg_seen`, `hub_q_added`,
`hub_notified` (anti-doublon volatils — les sauvegarder créerait un commit à
chaque notification), `souanpt_auth_v2` (PAT), les horodatages et le journal de
connexion (données d'appareil).

### Dépôt `{login}-hub-data` — nouveau schéma

```
data/manifest.json        table des matières : version, comptes, {path, bytes, sha256}
data/projects.json        (+ projects.part2.json… si > 480 Ko)
data/clients.json  · data/invoices.json · data/catalog.json · data/portals.json
data/reviews.json  · data/links.json    · data/media.json    · data/files.json
data/estimates.json · data/pricing.json · data/config.json   · data/settings.json
backup.json               ancien format — PLUS ÉCRIT, mais TOUJOURS LU (repli)
```

### `autoBackup()` — réécrite (`js/core.js`)

1. **Lecture** du `data/manifest.json` distant (1 GET) — c'est la source de
  vérité, pas un cache local : un changement fait depuis un autre appareil ou
  un dépôt vidé entre-temps est détecté sans état à désynchroniser.
2. **Comparaison** `sha256` fichier par fichier → seuls les différences partent.
3. **1 commit atomique** (Git Data API, déjà utilisée par `deployPortfolio`).
4. **Suppression** des fichiers devenus inutiles, *après* le commit : si elle
   échoue on perd de la place, jamais des données.
5. Rien n'a changé → **0 requête d'écriture**, la boucle s'arrête là.
6. Throttle 30 s (`BACKUP_MIN_INTERVAL`) + garde anti-exécution concurrente
   (`_backupRunning`).

Le `data/manifest.json` est **déterministe** : aucun horodatage dedans (il n'y
a qu'un `exportedAt` dans le *message* du commit). Sans cette règle, la moindre
différence de métadonnée aurait forcé un commit à chaque appel.

### Restauration — `restoreFromGitHub()`

Lit le manifeste, tire chaque fichier en `Accept: raw` (**séquentiellement** :
15 requêtes d'affilée tombent en rate-limit bien plus vite qu'en parallèle),
réassemble les `.partN.json` via `HubData.applyFiles()`. Repli automatique sur
l'ancien `backup.json` si le dépôt n'a jamais été migré.

### Corrections associées

- Fuite d'`setInterval` plombée (`js/ui.js`) : un seul jeu de timers par session.
- Export JSON typé (l'ancien `JSON.parse(localStorage.getItem('hub_img_quality'))`
  échouait sur une string) et import qui accepte désormais objets et scalaires.
- Le retour du bouton « Sauvegarder maintenant » affiche le réel :
  `3 fichiers sauvegardés` / `rien n'avait changé`.
- `HubData` ajouté aux `<script>` de `app.html` **avant** `cloud.js`
  (il construit `SYNC_KEYS` au chargement).

## 3. Vérifié

| Test | Résultat |
|---|---|
| 1re sauvegarde (dépôt vierge) | création du dépôt + commit initial complet |
| 2e sauvegarde sans changement | 0 écriture, `souanpt_last_backup` mise à jour |
| modification d'une collection | 1 commit, 1 seul fichier + manifeste |
| collection qui rétrécit (part2 disparaît) | suppression du fichier obsolète après le commit |
| restauration | toutes les clés réappliquées, `.partN` réassemblés |
| dépôt ancien (format `backup.json`) | repli lu, 5 collections restaurées |

## 4. Ce qui reste (T3 → T5)

1. ~~**T3** — faire de GitHub la source de vérité au login~~ → **fait**,
   voir `docs/audits/github-source-de-verite.md` (tirage incrémental en 3 voies
   à chaque connexion).
2. ~~**T4** — sortir les images du localStorage (couvertures de projets, hero)~~
   → **fait**, voir `docs/audits/images-out-of-localstorage.md` (miniature locale
   + plein format sur le dépôt privé ; c'est ce qui libérait le quota 5 MiB).
3. **T5** — remplacer la PAT collée par une vraie connexion GitHub
   (OAuth App / GitHub App, token à durée limitée + `refresh_token`),
   pour que la création du compte crée automatiquement le dépôt de stockage
   de l'utilisateur.
