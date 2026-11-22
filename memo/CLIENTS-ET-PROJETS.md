# Clients et projets

L'annuaire vit dans `hub_clients`. Les créations du portfolio vivent dans `hub_projects`. Les projets professionnels ont pour source canonique `hub_workspaces` via `ClientWorkspace` ; le registre `public_links` fournit les liens publics et est réconcilié par jeton. Un projet manuel est local et privé (`localOnly`) ; créer un dossier ne l'ajoute pas au portfolio public.

`CP` dans `js/clients.js` assemble Pipeline, Liste et Clients. La recherche normalise accents, casse et espaces puis filtre la vue courante ; elle ouvre la fiche ou le dossier existant. Le tri récent/A-Z s'applique après filtrage. `ClientMetrics.collect()` déduplique les dossiers par `token`, exclut la corbeille, compte comme actifs les projets non terminés et non archivés, et garde les nombres de portfolio séparés. Aucun compteur n'est stocké en parallèle.

`ClientImport` lit seulement les noms `racine/client/projet` depuis un dossier choisi. Le repli `webkitdirectory` ne voit pas nécessairement les dossiers vides. La prévisualisation permet de rattacher un client exact, de choisir un autre client, d'exclure des éléments et d'ignorer les doublons. L'import écrit les mêmes `hub_clients` et `hub_workspaces`, avec `origin: directory_import` et un jeton stable dérivé des noms. Les projets restent privés. Un point de récupération local et un rapport sont créés avant/après l'opération.

Si un nom de dossier ressemble à une fiche existante sans correspondance exacte, l'import attend un choix explicite : rattacher à une fiche ou créer une fiche distincte. Il ne crée plus de doublon par défaut. Les lignes désélectionnées restent ignorées, et les choix sont conservés lors du retour à la prévisualisation.

Les types, statuts et pièces rattachées restent modifiables dans `ClientWorkspace`. Les actions groupées utilisent ces objets existants et les mêmes contrôles de sauvegarde.
Les projets privés peuvent être renommés, retypés, rattachés à un autre client ou archivés depuis leur dossier. La vue Liste permet les actions groupées sur ces seuls projets privés. La suppression groupée les place dans une corbeille locale récupérable ; elle ne touche jamais un lien public.
Un panneau de suggestions local signale les fiches clientes identiques ou proches, les projets sans fiche associée et les noms de projets répétés. Il ne fusionne rien automatiquement.

## Fusion des fenêtres (3.27.0)

`js/business-nav.js` (`BizNav`) réunit Projets (`cp`), Demandes & Devis (`devis`) et Portails (`portals`) en un seul espace « Clients & Projets » : une barre d'onglets `#biz-tabs` placée avant `#page-cp`, une seule entrée dans la barre latérale (les entrées `devis` et `portals` reçoivent `hidden` + `ni-merged` ; `.ni[hidden]` est forcé à `display:none` car `.ni` fixe `display`). Les trois pages restent distinctes dans le DOM : `showPage('devis')`, les raccourcis G+D, la recherche et les notifications continuent de fonctionner. `showPage` est enveloppé une fois (`__bizNav`) pour activer l'onglet, garder l'entrée `cp` active et fixer le titre. Les pastilles `#devis-badge` et `#portals-badge` sont déplacées dans leurs onglets ; `#cp-req-badge` recopie la première sur l'entrée latérale (MutationObserver). Facturation et Avis restent des pages séparées : ce sont d'autres usages (argent, réputation).
