# souanpt.hub V2 — Fondation Firebase

Ce dossier prépare la migration vers le cloud. **Rien n'est encore activé** : le Hub
continue de fonctionner en localStorage tant que tu n'as pas créé ton projet Firebase.

## Pourquoi Firebase

GitHub Pages sait seulement **afficher des fichiers**. Il ne sait pas gérer des comptes,
une base de données instantanée, une messagerie ou des notifications. Firebase apporte ce
« cerveau » manquant, **gratuitement** (plan Spark) jusqu'à un usage important.

Répartition des rôles (architecture cible) :

| Service | Rôle |
|---|---|
| **GitHub** | Code source + versions (plus jamais utilisé comme base de données) |
| **Firebase** | Comptes, données, portails, avis, clients, facturation, paramètres |
| **Cloudflare** | *Optionnel, plus tard* : DNS, cache, domaine perso, protection |

Un **seul projet Firebase** héberge **tous** les utilisateurs — chacun isolé par son UID
via `firestore.rules`. Tes utilisateurs ne verront jamais Firebase : pour eux, il n'existe
que souanpt.hub.

## Étapes (≈ 10 min, une seule fois)

1. Va sur https://console.firebase.google.com → **Ajouter un projet** (nom : `souanpt-hub`).
2. Dans le projet → **Build → Authentication → Commencer → Sign-in method** → active
   **Google** (aucune config à faire, un simple interrupteur). *(GitHub et Discord pourront
   être ajoutés plus tard ; Google est la porte d'entrée principale.)*
3. **Build → Firestore Database → Créer** (mode production) → région Europe.
4. **Build → Storage → Créer** (facultatif, pour avatars/logos).
5. **Paramètres du projet → Tes applis → </> (Web)** → copie les 6 valeurs.
6. Copie `firebase-config.example.js` en `firebase-config.js` et colle tes valeurs.
7. Onglet **Règles** de Firestore → colle le contenu de `firestore.rules`.
   Onglet **Règles** de Storage → colle `storage.rules`.

Quand `firebase-config.js` contient de vraies valeurs, dis-le moi : j'activerai alors
l'authentification GitHub et la synchronisation Firestore (mode CLOUD), avec import
automatique de tes données actuelles (via l'export JSON déjà en place).

## Plan de migration (par étapes, sans jamais casser l'existant)

- **Phase 0 — Fondation** *(fait)* : règles de sécurité, config template, export/import
  complet du Hub.
- **Phase 1 — Auth** : connexion GitHub via Firebase, création auto du profil `users/{uid}`,
  réservation du pseudo (`souanpt.hub/@pseudo`).
- **Phase 2 — Données** : Firestore comme source de vérité (clients, factures, avis,
  portails, paramètres). localStorage devient un simple cache → tout devient **instantané,
  sans commit ni rebuild**.
- **Phase 3 — Publication & réseau** : publier le site/portail (Firebase Hosting), puis
  domaine personnalisé + Cloudflare en option.
- **Phase 4 — Offres** : structure Free / Pro / Business pilotée par Firestore (quotas),
  activable plus tard sans refonte.

## Rester gratuit

Le plan **Spark** couvre des centaines/milliers d'utilisateurs en usage raisonnable
(Auth gratuite, Firestore et Storage gratuits jusqu'à un quota, SSL inclus). On ne passe au
plan payant (Blaze) que si le trafic explose — et il y a une grande marge avant ça.
