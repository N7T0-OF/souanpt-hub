# Annonces de version dans le centre de notifications — v3.8.1

> Demande : « à partir de maintenant, la nouvelle version dans la notification
> générale ». v3.8.0 (observatoire de validation) était déjà poussée et
> déployée ; cette tranche ajoute le **canal** qui annonce chaque release.

## 1. Principe

Chaque version publiée apparaît **une fois** dans le centre de notifications,
dans une nouvelle catégorie **Générale**.

- **Source unique** : `HUB_VERSIONS` (`js/quote.js:1326`) — une ligne par
  release, **la première fait foi**. `HUB_VERSION` en découle
  (`js/quote.js:1331`) : l'annonce ne peut jamais partir d'un numéro oublié à
  côté de ses notes.
- **Notification locale** : `Notify.checkVersion()` (`js/quote.js:1399`) pose
  un document `sys-v<version>` avec titre, résumé et lien vers la release
  GitHub, dans `hub_sys_notifs` (plafonné à 20 entrées). Idempotent par **id
  déterministe** : un rechargement ne crée rien de nouveau.
- **État lu / archivé** stocké sur l'appareil, comme `hub_notified` — ce sont
  des messages d'information, pas des événements métier : ni sauvegarde
  GitHub, ni miroir Firestore, **ni Worker**. Gratuit, sans configuration,
  même hors connexion et sans compte Google.

## 2. Corrections qui l'accompagnent

| Avant | Maintenant |
|---|---|
| `loadInbox()` s'arrêtait net sans utilisateur Google : la cloche restait muette | les annonces locales sont **toujours** chargées, la boîte cloud Firestore vient s'y **ajouter** (`js/quote.js:1419`), et un échec cloud retombe sur le local |
| `markRead` / `markAllRead` / `archive` écrivaient toujours dans Firestore | branche `n.local` : écriture dans `hub_sys_notifs`, aucun appel réseau (`:1461`, `:1469`, `:1480`) |
| pas de filtre pour les messages système | bouton **Générale** dans le panneau (`app.html:1336`) — le filtre lit `n.category`, qui vaut `general` |
| aucune indication de version | badge **`v3.8.1`** dans l'en-tête du panneau (`app.html:1325`, rempli par `Notify.init()` :1451) |
| item sans destination | bouton **« Voir la release »** (`target=_blank`, marque lu au clic) pour tout notif porteur d'un `link` |

`Notify.init()` est appelé au démarrage (`app.html:3731`) : annonce + peinture
immédiate de la cloche, avant toute connexion.

## 3. Procédure à chaque release

1. Prépendre une ligne à `HUB_VERSIONS` : `['3.9.0', 'Ce que ça change.']`.
2. Rien d'autre : le tag, la release GitHub et le déploiement suivent le
   processus habituel, et l'annonce partira au prochain chargement.

## 4. Vérifié (jeu local `localhost:8766`, 0 erreur JS)

1. **Première charge** : 1 annonce (📦 Nouvelle version v3.8.1), catégorie
   `general`, lien `…/releases/tag/v3.8.1`, badge `v3.8.1`, cloche = **1**.
2. **Rechargement** : toujours 1 (idempotent, `total: 1`).
3. **Filtres** : Générale = 1 item avec « Voir la release » (`_blank`),
   Demandes = 0, Toutes = 1, Non lues = 1.
4. **Lu** : cloche vide, `readAt` persisté, `_inbox[0].local === true`
   (aucun appel Firestore).
5. **Rechargement** : toujours lu.
6. **Archivé** : disparaît de la liste, `archivedAt` persisté.
7. **Rechargement** : toujours archivé.
8. **Hors connexion** (session Google absente — cas réel de cette machine, puis
   `Cloud` neutralisé) : `loadInbox()` rend 1 item, cloche = 1.

## 5. Non couvert / à surveiller

- Les annonces sont **par appareil** (elles ne suivent pas un compte) : c'est
  volontaire, le message est le même partout et rien n'a besoin d'être
  synchronisé.
- Si `localStorage` est plein, l'annonce est perdue sans effet de bord
  (`checkVersion` est enveloppé en `try`).
- Les annonces Firestore (catégories Demandes/Estimations/Missions/Paiements)
  restent strictement inchangées.
