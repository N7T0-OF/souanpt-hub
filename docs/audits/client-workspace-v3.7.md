# ClientWorkspace — tranche 1 : la couche canonique (v3.7.0)

> Suite directe de `nav-business-v3.md` (v3.6.0, navigation fusionnée) et du
> chantier 1 de `fusion-workspaces-v3.md` §4. Cette version introduit le modèle
> **sans rien supprimer** : les collections existantes restent la source de
> lecture de leur page.

## 1. Constat : un projet, cinq clés de jointure différentes

Inventaire réel avant chantier (`hub_data`, `registry`, `quote`, `app.html`) :

| Bloc | Stockage | Clé de jointure | État |
|---|---|---|---|
| Pivot lien unique | Firestore `public_links/<token>` | jeton | ✅ `js/registry.js` |
| Demande | `requests/<token>` + `questions` | jeton | ✅ |
| Devis | `estimates/<code>` + cache `hub_estimates[].code` | jeton | ✅ |
| Portail créé depuis un devis | `portals/<id>`, `id === token` | jeton | ✅ `js/quote.js:1173` |
| **Portail créé dans l'app** | `hub_portals[].id = randomId(16)` | **aucun** | ❌ `app.html:3176` |
| **Facturation** | `hub_invoices[]` | **nom de client** | ❌ `app.html:2810` |
| Annuaire | `hub_clients[]` | nom (partagé) | ⚠️ volontairement commun |
| `hub_links[]` | liens portfolio / réseaux | — | ⚠️ **hors sujet**, hors modèle |

Résultat : impossible d'ouvrir « le dossier d'un projet » — il fallait aller
chercher la facture dans Facturation, le portail dans Portails, le devis dans
Demandes & Devis, et la seule chose qui les reliait était une **chaîne de nom
de client** (casse, accents, oublis compris).

## 2. Arbitrages validés

1. **Portée de la tranche 1** → modèle + migration **et** dossier consultable
   dans l'UI dès v3.7.0 (la couche canonique ne doit pas être invisible).
2. **Rattachement des pièces sans jeton** → seulement si le nom de client est
   **non ambigu** (un seul dossier porte ce nom), avec trace `linkVia`. Jamais
   d'attribution au hasard ; sinon la pièce reste « à rattacher » et un bouton
   manuel fait le travail.

## 3. Le modèle

**`hub_workspaces`** — un document par projet, dont l'id EST le jeton :

```js
{ token, stage:'request|estimate|mission|done', status:'active|inactive|archived|trashed',
  clientName, projectName, total, currency,
  refs: { estimate, portal, invoices:[] },   // des RÉFÉRENCES, jamais des copies
  createdAt, updatedAt, closedAt, lastStage,  // lastStage = étape avant clôture
  linkVia, _cloudSig }                        // provenance + ce qui est déjà poussé
```

Rôles (règle de `js/hub-data.js`) :

| Endroit | Rôle |
|---|---|
| `localStorage hub_workspaces` | cache local = ce que le dossier lit (hors-ligne compris) |
| GitHub `data/workspaces.json` | **source de vérité** (sauvegarde, multi-appareil) |
| Firestore `users/{uid}/data/workspaces` | miroir temps réel (privé) |
| Firestore `public_links/<token>` | pivot **public** (`/c/`, `Registry`) — pas de copie : on y pousse l'étape/statut via `Registry.register` |

Règles :

- **Mono-entrée / mono-sortie** : toute écriture lit la liste UNE fois, la
  mute, l'écrit UNE fois (`_ensureIn`, `js/client-workspace.js:77`). Deux
  relectures successives perdraient les mutations intermédiaires.
- **Étape monotone** (comme `Registry`) : jamais de régression automatique.
  La **seule** exception est `reopen()` — action explicite de l'utilisateur
  (`js/client-workspace.js:351`).
- **Rattachement** : `workspaceId` + `linkVia ∈ {token, name, manual}` écrits
  **en plus** de ce qui existe (jamais à la place), réversibles.
- **Quota Spark** : `migrate()` ne renvoie vers `public_links` que les dossiers
  dont l'empreinte `_cloudSig` a changé (`js/client-workspace.js:245`).
- **Clôture logique** : `closeMission()` pose `stage:'done'` + `closedAt` et
  mémorise `lastStage` — **aucune suppression** (`js/client-workspace.js:334`).

## 4. Implémentation

| Fichier | Rôle |
|---|---|
| `js/client-workspace.js` (nouveau) | modèle, `migrate()` :166, `build()` :266, `render()` :383, `closeMission()` :334, `bindByClient()` :126, `attach()` :146 |
| `js/hub-data.js:58` | entrée `workspaces` → sauv. GitHub + miroir Firestore |
| `app.html:1036-1090` | CSS du tiroir `.cw-*` (responsive ≤560 px) |
| `app.html:1098` | conteneur `#cw-root` |
| `app.html:2140` | `<script>` du module |
| `app.html:2831` | `addInvoice()` rattache la facture à la création |
| `app.html:3169` | `portalSave()` rattache le portail créé à la main |
| `app.html:2788` | bouton **📁 Dossier** sur chaque fiche annuaire (fonctionne hors-ligne) |
| `js/clients.js:55,72` | `migrate()` lancé à l'ouverture de Clients & Projets (1×/session, cloud et hors-ligne) |
| `js/clients.js:175` | pastille de projet → dossier (repli `CP.openLink` sans le module) |
| `js/clients.js:221` | `CP.manage()` (⚙) → dossier ; l'ancien routage reste le repli |

**Entrées dans le dossier** : ⚙ d'une carte / pastille de la vue *Clients*,
bouton 📁 d'une fiche annuaire. **Actions internes** : copier/ouvrir le lien,
+ lien de demande, ouvrir Devis, modifier/créer le portail, + facture, aller
dans l'annuaire, rattacher une facture, terminer / rouvrir la mission — chaque
bloc a un renvoi vers l'outil détaillé existant (rien n'est retiré).

## 5. Vérifié

- **41/41 assertions** sur page de test locale (création + monotonie,
  migration, ambiguïté, idempotence, rattachement à la création, totaux,
  échappement XSS du rendu, clôture sans suppression, rétro-compat) —
  le fichier de test a été supprimé avant le commit, comme `t5-tests.html`.
- **Navigateur** (`localhost:8766`) : annuaire avec 📁 Dossier (2 projets),
  dossier ouvert avec ses 6 sections, factures rattachées `via:'name'`
  (casse différente `ATELIER MARTIN` résolue), totaux Payé/Reste, section
  « À rattacher » cliquable → `via:'manual'`, clôture → `✅ Terminé` +
  « Rouvrir », navigation depuis le tiroir (Facturation + formulaire,
  Annuaire, Portails + édition pré-remplie) — **0 erreur JS** (`window.onerror`).
- **Sauvegarde** : `HubData.buildFiles()` produit bien `data/workspaces.json`
  (14 fichiers au total).
- **Smoke** : les 9 pages du dashboard s'ouvrent sans erreur.

Origine de test : les données d'exemple ont été effacées de `localhost:8766`
après les captures (origin de développement uniquement).

## 6. Ce qui ne change PAS

- `hub_invoices`, `hub_portals`, `hub_clients`, `hub_estimates`,
  `public_links`, `requests`, `estimates` : **mêmes clés, mêmes lectures**,
  aucun déplacement, aucune suppression.
- Les pages Facturation / Portails / Demandes & Devis lisent toujours leurs
  propres collections ; le dossier ne fait que les **recouper**.
- `hub_links` reste hors modèle (liens portfolio/réseaux).
- Étapes manuelles inchangées : règles Firestore P0, `GH_CLIENT_ID` (T5),
  relais `/u/` et `/api/` non vérifiables depuis cette machine.

## 7. Prochaines tranches

1. **Validation sur données réelles** ~~du rattachement~~ → **fait (v3.8.0)** :
   panneau « 🔍 Validation des rattachements » + rapport copiable
   (`docs/audits/validation-workspace-v3.8.md`). À exécuter sur les données
   réelles, puis à recopier ici pour analyse.
2. **Suppression des doublons** : les lectures « par nom » partent, `refs` et
   `workspaceId` deviennent la seule voie.
3. **Les 7 blocs complets** : brief, questions, fichiers, messages, échéances,
   négociation.
4. **Nettoyage physique** en fin de mission (aujourd'hui logique uniquement).
5. Absorption de **Portails** et **Demandes & Devis** dans le dossier —
   possible maintenant que la couche canonique existe.
