# Décisions

- Les trois représentations « fiche client », « dossier professionnel » et « réalisation portfolio » restent distinctes ; les compteurs sont calculés à la lecture.
- Le `token` de `ClientWorkspace` est l'identité canonique d'un projet professionnel. Une importation de dossier ajoute des métadonnées au même objet, sans collection parallèle.
- Le navigateur ne parcourt pas librement un disque local. L'utilisateur sélectionne un dossier ; le repli fondé sur des fichiers ne peut pas garantir la découverte des dossiers vides.
- Les conflits de sauvegarde suspendent l'écriture automatique. Aucune version ne gagne par défaut.
- GitHub Pages publie le dashboard à chaque fusion validée sur `main`; Cloudflare et les sites créateurs ont leurs propres procédures.
- Les couleurs de marque dérivent d'une seule source par surface (`cfg.accentColor` pour le site et le portail, `--accent` pour le tableau de bord) ; le texte posé sur l'accent est choisi pour le contraste. Les couleurs d'état (succès, erreur, avertissement) restent fixes.
- Les projets Behance s'ouvrent dans une fenêtre intégrée seulement via l'intégration officielle (`/embed/project/<id>`), reconstruite depuis un identifiant validé ; aucun HTML collé n'est injecté, et aucune capture de l'iframe n'est prétendue (voir `BEHANCE-PREVIEW.md`).
- Le produit est uniquement un site (décision du 20 novembre 2026) : pas d'APK, ni Google Play, ni AdMob. Sur téléphone et tablette, le bouton « Ajouter un raccourci » installe le site comme application web (`manifest.webmanifest`, `sw.js`, `js/install-shortcut.js`). Le service worker ne met en cache que `offline.html` et des icônes, jamais une page ou une réponse d'API.
- 22/11/2026 (3.28.0) : rien n’entre dans le portfolio depuis Behance sans un choix explicite. La synchro automatique annonce les nouveaux projets, l’ajout rapide les propose cochés ; l’ancien import « tout d’un coup » n’est plus exposé.
- 25/11/2026 (3.29.2) : Behance n’est interrogé que par son oEmbed officiel, via notre relais, avec un client honnête. Pas de lecture des pages ni de faux navigateur ; la liste des projets vient des liens que colle le propriétaire.
