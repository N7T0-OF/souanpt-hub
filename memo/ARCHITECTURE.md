# Architecture

`app.html` contient l'interface du dashboard, ses pages et plusieurs contrôleurs historiques. `js/core.js` contient les données du site créateur (`SiteConfig`, projets, avis), `generateSite()` et `deployPortfolio()`. `js/ui.js` orchestre la navigation, l'éditeur et `PublishUI`. `js/canvas.js` fournit `EdCanvas`, l'édition directe dans l'iframe, les fenêtres contextuelles et les contrôles de la barre latérale publique.

`js/clients.js` pilote Clients & Projets (`CP`) et réunit annuaire, pipeline, liste et projets locaux. `js/client-workspace.js` conserve un dossier par jeton de projet ; il lie les devis, portails et factures sans recopier leurs contenus. `js/client-metrics.js` calcule les comptes depuis les collections existantes ; `js/client-import.js` lit seulement les noms des dossiers choisis. `js/registry.js` gère le registre de liens publics.

`js/hub-data.js` est la liste canonique des collections synchronisées et sauvegardées. `js/hub-sync.js` réconcilie les versions GitHub, `js/cloud.js` pilote Firebase/Firestore lorsqu'il est disponible. `js/gh-auth.js` gère la connexion GitHub relayée. Les fonctions Cloudflare dans `functions/` servent les URL publiques `/u`, `/c`, `/request`, `/estimate` et des API ; `cloudflare/*.js` contient les Workers d'authentification, de notifications et d'analytics.

Le dashboard statique et les portfolios publiés ont des cycles de déploiement distincts. Un projet professionnel privé de `ClientWorkspace` n'est pas automatiquement une création du portfolio `hub_projects`.
