# Sécurité

Ne jamais versionner jetons, clés, données clients ou sauvegardes privées. Les noms de dossiers importés restent dans le navigateur ; aucun contenu de fichier n'est ouvert par `ClientImport`. Les projets professionnels importés restent privés et ne deviennent pas des cartes de portfolio.

Avant toute écriture de sauvegarde, une lecture GitHub incertaine ou un conflit doit bloquer l'opération. Les fonctions publiques Cloudflare doivent contrôler identité, autorisation et portée par propriétaire. Les clés Firebase de configuration Web ne sont pas des secrets d'administration, mais leur association au bon projet doit être vérifiée avant utilisation.

Mode aperçu (`js/preview-mode.js`, code admin sur la porte) : ce n'est PAS un accès administrateur. Il remplace `localStorage` par une mémoire volatile de données FICTIVES, force `FIREBASE_CONFIG` à `null` (aucune session, aucune lecture Firestore) et bloque tout appel de l'app vers un autre domaine (fetch/XHR/sendBeacon ; l'iframe Behance reste permise). Aucune donnée réelle n'est lue ni écrite, rien n'est publié. Le code (hash cyrb53 dans la source, `souanpt-apercu` par défaut, modifiable par `HubPreview.setCode`) n'est PAS un secret : il filtre seulement l'accès à la démo. La vraie sécurité reste les règles Firestore liées au compte connecté. Le test `preview-mode` vérifie que la constante de hash correspond à la fonction et que le mode est bien isolé.

Pour une modification de synchronisation, vérifier les tests `hub-sync-data-loss`, les règles Firestore et les déploiements exacts. Pour un import, vérifier la sélection explicite du dossier, les doublons, le point de récupération et l'absence de publication involontaire.
