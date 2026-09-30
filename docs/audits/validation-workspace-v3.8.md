# Validation des rattachements — tranche 2 du dossier client (v3.8.0)

> Suite de `client-workspace-v3.7.md` (couche canonique). v3.7 a introduit le
> modèle **sans toucher aux données** ; v3.8 fournit l'**observatoire** qui
> permet de le valider sur des données réelles avant toute suppression d'ancienne
> jointure. Aucune écriture destructive.

## 1. Le problème traité

Une migration qu'on ne peut pas observer ne peut pas être validée. Or les
données réelles ne sont pas accessibles depuis un dépôt : elles vivent dans le
`localStorage` et le dépôt de sauvegarde de chacun. Il fallait donc livrer
l'outil qui les expose, chez l'utilisateur, en trois gestes.

Second point relevé en revue : **les lectures par nom ne doivent pas devenir la
logique permanente**. Elles existent encore, volontairement, et sont désormais
*mesurées* (voir §4).

## 2. Ce qui a été ajouté

| Élément | Rôle | Emplacement |
|---|---|---|
| `audit()` | État ACTUEL, non destructif : dossiers, pièces rattachées/libres, et les 4 familles d'incohérence | `js/client-workspace.js:405` |
| `resync()` | Réparation **additive** : complète les `refs` manquantes, restaure les `workspaceId` manquants | `js/client-workspace.js:492` |
| `dropRef()` | Retrait **explicite** d'une référence cassée — la seule suppression possible, toujours déclenchée par un clic | `js/client-workspace.js:529` |
| `_pushRun()` / `runs()` | Journal des passages (20 max) : ce que la migration a **fait**, opposé à l'état **actuel** | `js/client-workspace.js:267` |
| `valPanel()` / `_valInner()` | Panneau « 🔍 Validation des rattachements » | `js/client-workspace.js:545` |
| Panneau en tête de la vue *Clients* | `js/clients.js:183` | CSS `app.html:1094` |
| `hub_ws_runs` | Journal sauvé sur GitHub (`data/wsruns.json`), **sans** miroir Firestore | `js/hub-data.js:62` |

### Les 4 familles d'incohérence (`audit().refs`)

| Nom | Sens | Traitement |
|---|---|---|
| `cassees` | `refs` pointe vers une pièce qui n'existe plus | bouton **retirer** (délibéré) |
| `manquantes` | pièce rattachée (`workspaceId`) mais absente de `refs` | bouton **Compléter les références** |
| `sansWorkspaceId` | pièce référencée mais sans `workspaceId` | idem |
| `conflits` | `refs` dit A, la pièce dit B | **signalé, jamais corrigé seul** |
| `fantomes` | pièce marquée d'un dossier absent | signalé (hors `refs`) |

Plus les cas métier qui ne sont pas des erreurs mais « à traiter » :
**orphelines** (le client n'a aucun dossier) et **ambigues** (plusieurs dossiers
portent ce nom — c'est précisément ce qui empêche le rattachement automatique).

`audit().ok` = `cassees === conflits === fantomes === 0`.

### Lecture désormais faite par référence

`build()` lit les factures par **`workspaceId` ∪ `refs`** et le portail par
`id === token || workspaceId` (`js/client-workspace.js:298`) ; le filtre par nom
n'attrape plus que les pièces **encore libres**, avec commentaire explicitant
que c'est la voie de transition appelée à disparaître en v3.9.

## 3. Comment valider sur tes données (3 gestes)

1. Ouvre **Clients & Projets → vue Clients**.
2. Lis le panneau **🔍 Validation des rattachements** : statut `✔ cohérent` ou
   `⚠ à vérifier`, puis la liste ligne à ligne (orphelines, ambiguës,
   références cassées/manquantes/conflites).
3. Clique **📋 Copier le rapport** et colle-le : il contient `audit` + les 20
   derniers passages de migration — c'est ce qui permet d'analyser les cas
   réels sans jamais manipuler les données.

Actions disponibles sur place : **↻ Relancer la migration** (recalcule tout,
idempotent), **🧩 Compléter les références** (additif), **retirer** à côté de
chaque référence cassée.

## 4. Où en sont les jointures par nom (état exact)

**Déjà par référence** : factures (`workspaceId` ∪ `refs`), portails
(`id`/`workspaceId`), devis (`code` = jeton), pivot `public_links`.

**Encore par nom** (toléré jusqu'en v3.9, maintenant *mesuré* par l'audit) :

1. `candidates` dans `build()` — factures libres de même nom, listées sous
   « À rattacher » ;
2. `bindByClient()` à la création d'une facture/portail ;
3. `bind()` dans `migrate()` ;
4. l'annuaire `hub_clients` (identité partagée, pas une pièce : `build()`
   le joint par nom — cible v3.9 : `refs.client = hub_clients[].id`, qui existe
   déjà) ;
5. le regroupement d'affichage par `clientName` dans la vue *Clients*.

Cible v3.9 : `workspaceId` + `refs` comme **seule** voie de lecture ; les
jointures 1 à 3 disparaissent, la 4 passe par identifiant, la 5 reste un choix
d'affichage.

## 5. Vérifié

- **76/76 assertions** (page de test locale, supprimée avant le commit) :
  les 41 de la tranche 1 + 35 sur la validation (une injection de défaut par
  catégorie : orpheline, ambiguë, à rattacher, manquante, sans `workspaceId`,
  cassée, conflit, fantôme — puis `resync`, `dropRef`, `ok=true` une fois tout
  résolu, plafonnement du journal à 20, rapport JSON copiable, panneau absent
  s'il n'y a aucun dossier).
- **Parcours UI** (`localhost:8766`, jeu de données réaliste) : panneau affiché
  avec statut `⚠ à vérifier`, les 5 lignes d'anomalie et les 4 boutons ;
  pied du dossier avec l'avertissement de référence cassée **et** son bouton
  « retirer » (la référence reste présente — jamais supprimée seule) ;
  **🧩 Compléter** → `manquantes 0`, bouton disparu, statut toujours `⚠`
  (la cassée reste) ; **retirer** → `✔ cohérent` ; **↻ Relancer** → toast
  récapitulatif + panneau repeint ; **0 erreur JS**.
- **Échappement du panneau** : un défaut d'échappement sur les noms de
  factures affichés a été corrigé APRÈS la passe de 76 tests, puis revérifié
  en navigateur sur `<img src=x onerror=…>`, `&<b>bold</b>` et un nom de
  client HTML — tout sort échappé (`&lt;img …&gt;`), 0 erreur.
- Original de test : données d'exemple effacées de `localhost:8766` après les
  vérifications.
- Captures non prises (fenêtre desktop non visible pendant la session) — le
  DOM a été interrogé point par point à la place.

## 6. Ce qui ne change pas

- Aucune collection déplacée ni supprimée ; `resync()` n'ajoute que,
  `dropRef()` est le **seul** retrait et il est explicitement déclenché.
- `hub_invoices` / `hub_portals` / `hub_clients` / `public_links` : mêmes clés,
  mêmes lectures côté page.
- Le journal `hub_ws_runs` n'est pas miroir Firestore (rien à synchroniser).

## 7. Ensuite

1. **v3.9 — suppression progressive des jointures par nom** : lecture
   `workspaceId`/`refs` seule, annuaire via `refs.client = hub_clients[].id`,
   disparition de `candidates` / `bindByClient` / `bind`.
2. **v4.x — dossier complet** (identité/historique, brief/questions/fichiers,
   lignes/négociation/acceptation, échéances/messages, validation/clôture).
3. Puis nettoyage physique, absorption de **Portails** et de
   **Demandes & Devis** — jamais l'inverse : le dossier doit d'abord pouvoir
   remplacer les pages.
