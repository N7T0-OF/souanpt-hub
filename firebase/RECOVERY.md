# Rétablissement Firebase — souanpt.hub

## État vérifié le 26 octobre 2026

- La clé Web versionnée dans `firebase-config.js` renvoie `API_KEY_INVALID` sur Identity Toolkit.
- L'API Firestore renvoie `CONSUMER_INVALID` pour `souanpt-hub`.
- Ces réponses ne permettent pas à elles seules de distinguer une clé supprimée, un projet supprimé ou une perte d'accès.
- Le 26 octobre, les deux comptes Google connectés dans Codex ne listent pas `souanpt-hub` parmi leurs projets actifs ni parmi les ressources en attente de suppression. L'ouverture directe du projet affiche `resourcemanager.projects.get` manquante pour les deux comptes. Ce message d'autorisation ne prouve pas que le projet a été supprimé : il faut retrouver un compte propriétaire ou demander une récupération d'accès avant de conclure.
- Le dépôt privé `N7T0-OF/n7t0-of-hub-data` contient une sauvegarde du 26 octobre 2026, commit `d91042f`. Son manifeste recense 10 projets, 22 clients, 4 avis, 5 factures, ainsi que la configuration du site. Les collections `portals`, `workspaces` et `estimates` y sont vides à cette date. Préserver ce dépôt et son historique.

## 1. Rechercher l'ancien projet avant toute migration

Dans [Google Cloud → Gérer les ressources](https://console.cloud.google.com/cloud-resource-manager), vérifier chaque compte propriétaire potentiel et ouvrir **Ressources en attente de suppression**. Si `souanpt-hub` y apparaît, restaurer le projet dans sa fenêtre de récupération, puis vérifier Auth, Firestore, Storage et les clés API. Google documente une période de restauration de 30 jours ; certains services peuvent mettre plus longtemps à revenir. Si le projet existe dans Google Cloud mais manque dans Firebase, vérifier le label `firebase:enabled` et les autorisations IAM.

Si aucun compte ne voit la ressource, récupérer l'identifiant exact du projet et la preuve du compte qui le voit, puis utiliser [l'aide Firebase pour un projet perdu](https://firebase.google.com/support/troubleshooter/access/project/lost) ou la demande officielle de récupération de compte et de ressource Google Cloud. Ne pas lancer une restauration, modifier les droits IAM, ni importer la sauvegarde dans un autre projet sur la seule base d'une URL contenant `project=souanpt-hub`.

Sources : [restauration des projets Google Cloud](https://docs.cloud.google.com/resource-manager/docs/delete-restore-projects), [aide Firebase pour un projet introuvable](https://firebase.google.com/support/troubleshooter/access/project/lost).

## 2. Si le projet est irrécupérable

Créer **un nouveau projet Firebase** sous le compte qui en assurera la propriété durable. L'ancien ID `souanpt-hub` ne pourra pas être réutilisé si le projet a été définitivement supprimé. Activer Google Authentication, Firestore et, si nécessaire, Storage. Ajouter les domaines réels du Hub et ses domaines d'aperçu aux domaines autorisés d'Authentication.

Avant toute publication :

1. Récupérer la nouvelle **configuration Web** depuis Paramètres du projet → Général. Mettre à jour `firebase/firebase-config.js` et `firebase/edge-config.js` ensemble. Retirer `disabled: true` de `firebase-config.js` seulement après validation de la nouvelle clé. Ces clés Web identifient le projet ; elles ne donnent pas, à elles seules, accès aux données privées.
2. Publier et vérifier `firebase/firestore.rules` et `firebase/storage.rules` dans le nouveau projet. Les fichiers versionnés ne se déploient pas automatiquement.
3. Reconfigurer les secrets `FIREBASE_CLIENT_EMAIL` et `FIREBASE_PRIVATE_KEY` des Workers Discord, notifications et analytics. Ne jamais les placer dans Git, dans un commentaire de PR ou dans une capture.
4. Tester la connexion Google et Discord sur le domaine de production et sur un aperçu autorisé. Tester les lectures publiques `/c/<token>` et `/u/<pseudo>` après création de données de test non sensibles.
5. Reconnecter GitHub dans le Hub pour restaurer la sauvegarde privée. Comparer les comptes du manifeste avant de réactiver les écritures automatiques vers le nouveau Firestore. Les liens publics et les données qui n'existent que dans l'ancien Firestore ne sont pas garantis par cette sauvegarde.

La PR doit rester en brouillon tant que la nouvelle configuration, les règles et les vérifications d'accès ne sont pas prêtes.
