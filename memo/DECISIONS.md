# Décisions

- Les trois représentations « fiche client », « dossier professionnel » et « réalisation portfolio » restent distinctes ; les compteurs sont calculés à la lecture.
- Le `token` de `ClientWorkspace` est l'identité canonique d'un projet professionnel. Une importation de dossier ajoute des métadonnées au même objet, sans collection parallèle.
- Le navigateur ne parcourt pas librement un disque local. L'utilisateur sélectionne un dossier ; le repli fondé sur des fichiers ne peut pas garantir la découverte des dossiers vides.
- Les conflits de sauvegarde suspendent l'écriture automatique. Aucune version ne gagne par défaut.
- GitHub Pages publie le dashboard à chaque fusion validée sur `main`; Cloudflare et les sites créateurs ont leurs propres procédures.
