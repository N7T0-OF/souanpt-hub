# GitHub = source de vérité — T3 (synchro à la connexion)

Suite de `backup-unification.md` (T1+T2). Jusqu'ici le hub **sauvegardait**
sur GitHub mais ne **tirait** que sur clic manuel (« Restaurer »), pendant que
le miroir Firestore tirait de son côté : deux sources qui se marchaient dessus
selon l'ordre des promesses.

## 1. Ordre imposé

```
Cloud.syncPull()   →   HubSync.boot()   →   autoBackup()
 (1. Firestore)        (2. GitHub gagne)     (3. pousse le local)
```

Le chaînage est **explicite** (`app.html` → `finishLogin`) : la promesse
Firestore doit être résolue avant le tirage GitHub, sinon le temps réel
écraserait la source de vérité. `autoBackup()` attend `HubSync.pending` en
tête de son corps — règle unique d'ordonnancement, un seul commentaire
explique pourquoi.

Points d'entrée de `HubSync.boot()` :

| Situation | Déclencheur |
|---|---|
| Google connecté | `finishLogin()`, après `Cloud.syncPull()` |
| GitHub seul, Firebase configuré | callback `Cloud.onAuth(u => …)` avec `u = null` |
| Pas de Firebase du tout | `DOMContentLoaded` |
| Nouveau token collé | `connectGitHub()` (`force: true`) |
| Bouton « ↓ Récupérer depuis GitHub » | `intPullNow()` (`force: true`) |

`boot()` est inévitable (single-flight) : un appel déjà en cours est retourné
tel quel, `_done` empêche un second tirage automatique dans la session.

## 2. Résolution en 3 voies

Baseline : `souanpt_sync_hashes` = `{ "data/clients.json": "<sha256>", … }`,
c'est-à-dire l'état **au dernier accord** local ↔ distant.

| État local | Distant | Baseline | Décision |
|---|---|---|---|
| == distant | == local | — | rien |
| == baseline | ≠ baseline | présente | **ON TIRE** (GitHub a bougé ailleurs) |
| ≠ baseline | == baseline | présente | **ON POUSSE** (`autoBackup`) |
| ≠ baseline | ≠ baseline | présente | **CONFLIT** → le local gagne, baseline **conservée**, avertissement |
| rempli | rempli, différent | absente (1re fois) | **CONFLIT** → local gagne |
| vide | rempli | absente | **ON TIRE** (rien à perdre) |

Détails qui font la différence :

- les conflits **conservent leur ancienne baseline** (`record(files, true)`) :
  sans ça, la prochaine session verrait « local == baseline » et écraserait les
  données locales par le distant ;
- `autoBackup`, lui, enregistre la baseline **après** une poussée ou un skip
  (`record(files, false)`) : c'est là que l'accord est réellement rétabli, et
  `_conflicted` est vidé ;
- le tirage n'appelle `applyFiles()` qu'une fois, avec les fichiers distants
  des collections retenues : si le distant a moins de `.partN` que le local,
  c'est que la collection a rétréci côté distant — la bonne décision est de le
  suivre, pas de garder les morceaux orphelins.

## 3. Garde-fous

- **Séquentiel** : le manifeste puis les fichiers sont tirés un par un
  (`Accept: raw`). Un `Promise.all` de 15 requêtes se prend le rate-limit
  GitHub (5 000 requêtes/h) dans la figure pour rien — le tirage ne se fait
  qu'une fois par session de toute façon.
- **Repli** : dépôt vierge ou manifeste illisible → `{ none: true }`, on ne
  touche à rien et `autoBackup` initialise le dépôt au tour suivant.
- **Baseline hors ligne** : si la poussée échoue, la baseline n'est pas
  écrite → le conflit revient au prochain démarrage au lieu d'être tranché
  à tort.
- **Rendu** : si un tirage a écrit quelque chose, `reloadAllData()` est appelé
  avant les toasts, pour que l'écran reflète la donnée venue d'un autre
  appareil.

## 4. UI

Carte **Intégrations → Sauvegarde & données** :

- « dernier tirage : … » (`int-pull-time`) à côté de « dernière : … » ;
- **↓ Récupérer depuis GitHub** : tirage ciblé du bouton (ne remplace que ce
  qui a changé ailleurs) ;
- **☁ Restaurer la sauvegarde complète** : l'ancien « Restaurer (V1) »,
  qui, lui, **remplace tout** par la sauvegarde — utile après une réinstallation.

Les deux se distinguent nettement : le tirage est prudent, la restauration
est totale.

## 5. Vérifié (bac à sable, `GH` et `Auth` remplacés par des faux en mémoire)

| Scénario | Résultat |
|---|---|
| 1re synchro, local = distant | 0 tirage, 0 conflit |
| distant modifié, local inchangé | **clients tiré**, local à jour |
| accord déjà établi | 0 requête d'écriture |
| seul le local change | 0 tirage (la poussée s'en charge) |
| les 2 changent | **conflit, local conservé**, 2e run = même conflit (baseline préservée) |
| après poussée | accord rétabli, run suivant = rien à tirer |
| `autoBackup` pendant un tirage | ordre garanti `tirage → sauvegarde` |
| console | 0 erreur, 0 avertissement |

## 6. Reste à faire

- **T4** — sortir les images du localStorage : c'est ce qui fait peser
  `projects.json`, dépasser le quota 5 MiB de `localStorage` et imposer le
  découpage `.partN`.
- **T5** — OAuth App / GitHub App à la création du compte : le dépôt de
  stockage se crée tout seul, la PAT collée disparaît.
- **P0 sécurité** — e-mails publics dans `firestore.rules`, mot de passe de
  portail en clair, relais `functions/u/[pseudo].js` (XSS same-origin).
