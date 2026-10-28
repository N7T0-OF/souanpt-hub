# Données et synchronisation

`HubData.LIST` dans `js/hub-data.js` décrit chaque collection, sa clé `localStorage`, son fichier privé `data/*.json` et son éventuel miroir Firestore. Modifier cette liste avant d'ajouter une collection persistante. `localStorage` sert de cache et de mode local ; le dépôt privé GitHub conserve l'historique. Firestore ne doit recevoir que les miroirs explicitement configurés.

`HubSync.boot()` compare les versions au chargement. En cas de conflit ou d'échec de lecture distante, `HubSync` et `autoBackup()` bloquent l'écriture pour éviter qu'un appareil vide écrase la sauvegarde. Le correctif a été ajouté en octobre 2026 après un incident réel. Ne jamais convertir une erreur de lecture en « dépôt vide ». Tester chaque reprise multi-appareils avec des collections non vides et des contrôles de SHA.

Une restauration doit vérifier l'identité du compte et du dépôt, prendre un point de récupération, puis comparer les collections. Ne jamais transférer les données Souanpt Hub vers le projet Firebase `sankai-life` sans vérification et décision explicite.
