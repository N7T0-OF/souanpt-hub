# v3.6.0 — Sections Contenu & Business : fusion, UI, rendu différé

Périmètre validé : **fusion de navigation** (données intactes), **UI des
sections Contenu / Business**, **pages Business**, **performance de chargement**.
La fusion des *données* (modèle `ClientWorkspace`) reste ouverte —
`docs/audits/fusion-workspaces-v3.md` §4.

## 1. Fusion — la page « Clients » disparaît du menu

| Avant | Après |
|---|---|
| Entrée **Clients** (page `page-clients`, annuaire `hub_clients`) + entrée **Clients & Projets** | Une seule entrée : **Clients & Projets**, vue *Clients* |

- Le bloc complet (compteur, formulaire *Nom / Type*, grille `#clients-list`) a
  été déplacé dans `CP._clients()` (`js/clients.js`) : annuaire et projets
  regroupés par client cohabitent en un seul écran.
- `showPage('clients')` **redirige** vers la vue Clients (`js/ui.js`), comme
  `media → storage` et `portfolio → editor` : aucun raccourci enregistré ne
  casse, y compris le bouton « Créer un client » de la vue d'ensemble.
- **Aucune donnée n'a bougé** : `hub_clients`, `addClient()`, `deleteClient()`,
  `renderClients()` et le datalist de Facturation sont inchangés.
- L'annuaire reste utilisable **sans connexion Google** (comme avant) : la vue
  Clients s'affiche même quand `Cloud` est déconnecté.
- Le compteur « N fiches · M avec projet » se met à jour à chaque ajout
  (`renderClients()`).

## 2. Sidebar — Contenu resserrée, Business lisible

```
Dashboard   Vue d'ensemble
Contenu     Éditeur de site · Stockage        ← section « Outils » fusionnée (1 entrée)
Business    Clients & Projets · Demandes & Devis · Portails · Facturation · Avis
Système     Paramètres
```

- **Ordre Business = cycle de vie du client** : acquisition (demande/devis) →
  suivi (portail) → paiement (facturation) → preuve (avis).
- Chaque entrée a un `title` explicite ; la section **Facturation** reçoit son
  **badge** (`fac-badge`, or) — les factures à relancer se voient sans ouvrir la
  page, comme pour Devis / Avis / Portails. Les badges « à traiter » passent en
  classe `.nb-warn`.
- `#login-gate` reste tel quel ; `.nav-label` gagne un filet après l'intitulé,
  les icônes s'éclaircissent au survol, état actif teinté, `:focus-visible`.
- **La barre devient scrollable** (`.nav-scroll`) : sur un écran court, les
  dernières sections n'étaient plus atteignables (`.sidebar{overflow:hidden}`).

## 3. Pages Business — mêmes grilles partent

Nouvelles classes partagées (`app.html`) :

| Classe | Rôle | Avant |
|---|---|---|
| `.biz-kpis` | 4 cartes KPI (Facturation, Portails) | `repeat(4,1fr)` en inline, écrasé sous ~700 px |
| `.biz-2col` | listes 2 colonnes (Avis, annuaire) | inline |
| `.biz-form` | formulaires de saisie | `2fr 1fr 100px`, `1fr 1fr 80px`, `1fr 90px 1fr`… |

- Media queries : `.biz-kpis` → 2 colonnes sous 820 px, `.biz-2col` → 1 colonne
  sous 560 px, `#clients-list` → 1 colonne sous 640 px, `.fac-row` (tableau des
  prestations) → 2 colonnes sous 760 px.
- Les boutons « + » ouvrent via `toggleForm()` : le formulaire **défile vers
  l'écran** au lieu de s'ouvrir hors champ. `openClientForm()` réessaie
  l'ouverture (rendu asynchrone du registre).
- États vides enrichis (Aucun client / Aucun avis) avec l'action suivante, en
  `grid-column:1/-1` (marche avec n'importe quel nombre de colonnes).

## 4. Performance — les pages secondières n'attendent plus le chargement

Avant : le `DOMContentLoaded` construisait **11 rendus** (clients, factures,
avis, catalogue, datalists, portails, médias, projets, liens, Behance…), tous
invisibles : la seule page affichée est la vue d'ensemble.

Après :

1. **immédiat** — `syncKPIs()`, `renderActivity()`, `Analytics.refresh()`,
   `renderIntegrations()`, `renderLoginLog()`, `renderGoat()`,
   `refreshRealStats()` ;
2. **au repos** — `renderBackgroundPages()` via `requestIdleCallback`
   (`timeout` 1500 ms, repli `setTimeout`) ;
3. **à la première visite** — `renderOnce(page, …)` dans `showPage()` : si
   l'utilisateur ouvre Facturation avant le passage en arrière-plan, la page se
   peint quand même.

`syncKPIs()` lit `localStorage` (pas le DOM) : les compteurs de la vue
d'ensemble ne dépendent d'aucun rendu différé.

## 5. Vérifié (navigateur, `localhost:8766`)

| Contrôle | Résultat |
|---|---|
| Sections sidebar | 4 sections, Contenu 2 entrées, Business 5, plus d'entrée « Clients » ni de section « Outils » |
| `showPage('clients')` | `page-cp` active, `CP._view==='clients'`, nav active `cp` |
| Annuaire fusionné | création d'un client → fiche affichée, `hub_clients` mis à jour, KPI `ov-clients` / `fac-clients-count` à 1 |
| Vue Clients sans projet | annuaire + message « Aucun projet rattaché » (au lieu de la page vide) |
| Badges | facture en attente → `fac-badge` « 1 » puis masqué après suppression |
| Pages | overview, editor, cp, devis, portals, facturation, avis, storage, settings s'ouvrent toutes (contenu non vide) |
| Rendu différé | `#invoices-list`, `#reviews-list`, `#portals-list` remplis après le chargement ; `renderOnce`/`toggleForm`/`openClientForm` exposés |
| Console | **0 erreur JS** (seules les sondes réseau du relais échouent en local) |

## 6. Ce qui reste

- **Fusion des données** : modèle `ClientWorkspace`, portail rendu par le même
  moteur, absorption de *Portails* et *Demandes & Devis* dans la vue unifiée
  (`fusion-workspaces-v3.md` §4).
- Rendu paresseux des *pages* (onglets) et chargement conditionnel des scripts —
  chantier plus large, hors de cette passe.
- Étapes manuelles en attente : règles Firestore (P0, v3.4.0) et `GH_CLIENT_ID`
  du relais (T5, v3.5.0).
