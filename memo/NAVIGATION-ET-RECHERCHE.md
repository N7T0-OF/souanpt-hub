# Navigation et recherche (3.21.0)

## Recherche globale — Ctrl/⌘ + K (`js/command-palette.js`, `HubSearch`)

Bouton « 🔍 Rechercher » dans la barre du haut (toutes les pages) ou Ctrl/⌘ + K (désactivé tant que la porte de connexion est affichée). Index construit à l'ouverture depuis les données locales : pages, actions (nouveau client, nouvelle prestation, nouveau projet, lien de demande, publier, synchroniser Behance, infos de facturation, dépense, SEO, haunt.gg, thème, export CSV), clients, dossiers clients (étape, montant), projets du portfolio (masqués signalés), factures (numéro, client, montant, statut ; « retard » trouve les impayés échus), avis (« valider » trouve ceux en attente). Recherche sans accents, tous les mots requis, titre commençant par le premier mot en tête ; 6 résultats par groupe. ↑ ↓ Entrée Échap, souris. Sans saisie : récents (6, sur l'appareil, `hub_cmdk_recent`) + actions. Chaque résultat appelle les fonctions existantes (dossier → `ClientWorkspace.open`, facture → Facturation filtrée sur le numéro, projet → fenêtre d'édition de son bloc). Textes échappés.

## Navigation mobile / tablette (`js/mobile-nav.js`, `HubNav`)

≤ 820 px : la barre latérale devient un tiroir (☰ dans la barre du haut, fond assombri, Échap, fermeture après le choix d'une page, fermeture automatique en repassant en grand écran) ; « Sync Behance » quitte la barre du haut (disponible dans la recherche). Au-delà de 820 px, rien ne change. Avant 3.21, la barre latérale restait une colonne fixe et prenait la moitié d'un écran de téléphone.

## Stabilité

Les minuteurs périodiques sont uniques par session (garde existante). Le relevé des avis toutes les 5 min est sauté quand l'onglet est caché et relancé au retour (plus de 5 min après le dernier).

- 3.27.0 : la barre latérale Business compte trois entrées (Clients & Projets, Facturation, Avis). Demandes & Devis et Portails sont des onglets de Clients & Projets (`js/business-nav.js`, détail dans `CLIENTS-ET-PROJETS.md`) ; la recherche les affiche comme « Clients & Projets › … ». Le titre de la barre du haut est tronqué avec « … » sur mobile.

## Téléphone et tablette (3.29.0)

- ≤ 820 px (téléphone, tablette en portrait) : la barre latérale disparaît au profit d’une barre d’onglets flottante en bas (`js/mobile-tabbar.js`, `HubTabbar`) : coins arrondis, fond givré, zone sûre de l’iPhone respectée (`viewport-fit=cover`, `env(safe-area-inset-bottom)`), icônes seules (libellé pour les lecteurs d’écran). Cinq emplacements : Accueil (overview), Contenu (editor, storage, tools), Business (cp, devis, portals, facturation, avis), Rechercher (`HubSearch.open`), Réglages (settings, github). Point doré sur Business quand une pastille « à traiter » est visible.
- Une section à plusieurs pages affiche ses onglets en haut (`#grp-tabs`, collant) ; Demandes & Devis et Portails restent des onglets de Clients & Projets. Toucher la section active revient à sa première page, en haut ; sinon on retrouve la dernière page vue dans cette section.
- La barre se retire quand le clavier est ouvert (`visualViewport` < 72 % de la fenêtre → `body.kb-open`) et derrière l’écran de connexion. Les fenêtres de l’éditeur deviennent des feuilles du bas, les notifications éphémères et la bannière d’aperçu passent au-dessus de la barre, les champs sont en 16 px (pas de zoom iOS). Le titre de page n’est plus répété dans la page.
- 821–1100 px (tablette paysage) : barre latérale en rail d’icônes de 68 px, pastilles en coin.
- Éditeur sur téléphone : voir `EDITOR-ET-PUBLICATION.md` (édition rapide sans aperçu).
