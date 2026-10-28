# Sécurité

Ne jamais versionner jetons, clés, données clients ou sauvegardes privées. Les noms de dossiers importés restent dans le navigateur ; aucun contenu de fichier n'est ouvert par `ClientImport`. Les projets professionnels importés restent privés et ne deviennent pas des cartes de portfolio.

Avant toute écriture de sauvegarde, une lecture GitHub incertaine ou un conflit doit bloquer l'opération. Les fonctions publiques Cloudflare doivent contrôler identité, autorisation et portée par propriétaire. Les clés Firebase de configuration Web ne sont pas des secrets d'administration, mais leur association au bon projet doit être vérifiée avant utilisation.

Pour une modification de synchronisation, vérifier les tests `hub-sync-data-loss`, les règles Firestore et les déploiements exacts. Pour un import, vérifier la sélection explicite du dossier, les doublons, le point de récupération et l'absence de publication involontaire.
