# Système et paramètres (3.22.0)

Module `js/system.js` (`HubSystem`) + réorganisation de Paramètres (`app.html`).

## Mise à jour automatique

`build-info.json` (publié avec chaque version par `scripts/prepare-deploy.mjs`) était déployé mais jamais lu. Désormais : vérification 8 s après le chargement, toutes les 30 min quand l'onglet est visible, et au retour sur l'onglet (plus de 10 min après). Comparaison numérique (`3.10` > `3.9`) avec `HUB_VERSIONS[0]`. Version en ligne plus récente → bandeau « ✨ Version X disponible — Recharger » : enregistre l'éditeur s'il est ouvert, met à jour le service worker, recharge. Sans `build-info.json` (serveur local) : rien.

## Paramètres

- Menu : icônes partout, nouvel onglet **🖥 Système** ; sur téléphone/tablette (≤ 820 px) le menu devient une rangée d'onglets défilante au-dessus du contenu (avant : colonne de 200 px qui laissait ~100 px au contenu).
- **Général → Préférences** (appareil, `hub_prefs`) : page au démarrage (Vue d'ensemble, dernière page ouverte — `hub_last_page` mémorisée à chaque `showPage` —, Clients & Projets, Facturation, Demandes & Devis, Éditeur) ; « Animations réduites » (classe `hub-calm`, tableau de bord seulement) ; liste des raccourcis clavier.
- **Domaine** : le réglage `customDomain` était enregistré mais jamais utilisé. Il est validé (`hubCleanDomain` : nom de domaine, pas de `github.io`), expliqué (enregistrement DNS CNAME vers `<compte>.github.io`), et publié : `deployPortfolio` pose `CNAME` et l'utilise comme adresse canonique (SEO, plan du site). « Retirer le domaine » marque `customDomainRemoved` : seul ce retrait explicite supprime le `CNAME` (un domaine réglé directement sur GitHub n'est jamais effacé) ; le drapeau retombe après la publication.
- **Confidentialité** : l'interrupteur « Portfolio public » ne faisait rien (il ne changeait que sa propre couleur). Remplacé par **« Visible sur Google »**, branché sur `seo.index` (comme la fenêtre 🔎 SEO). Le bouton « Se déconnecter » en double est retiré (il reste dans Compte → Sécurité) ; la sauvegarde complète passe dans Système.
- **Système** : version installée / en ligne et bouton de mise à jour, nouveautés récentes, données locales par collection (libellés français, nombre d'éléments, taille, estimation du quota navigateur), dates de dernière sauvegarde GitHub et de dernière récupération, Exporter / Importer / Restaurer, diagnostic copiable (version, navigateur, écran, application installée, service worker, en ligne, taille locale, dernière sauvegarde — jamais de jeton ni de donnée personnelle).

## Accent du tableau de bord (3.29.1)

Le tableau de bord n’appliquait l’accent du site que depuis l’outil Palette ; 🎨 Thème et le chargement de la page l’ignoraient. Désormais `SiteConfig.save` appelle `HubAccent.sync()` (donc 🎨 Thème, Palette, édition rapide, import de configuration), ainsi que le chargement de `core.js` sur la page du hub et l’événement `storage` (autre onglet, synchro). `HubAccent.readable()` éclaircit un accent trop sombre pour le fond du tableau de bord (contraste ≥ 3:1 avec #080808) ; le site publié garde la couleur exacte. Le bouton « Ajouter un raccourci » suit aussi l’accent et passe au-dessus de la barre d’onglets sur téléphone.
