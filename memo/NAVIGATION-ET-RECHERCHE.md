# Navigation et recherche (3.21.0)

## Recherche globale — Ctrl/⌘ + K (`js/command-palette.js`, `HubSearch`)

Bouton « 🔍 Rechercher » dans la barre du haut (toutes les pages) ou Ctrl/⌘ + K (désactivé tant que la porte de connexion est affichée). Index construit à l'ouverture depuis les données locales : pages, actions (nouveau client, nouvelle prestation, nouveau projet, lien de demande, publier, synchroniser Behance, infos de facturation, dépense, SEO, haunt.gg, thème, export CSV), clients, dossiers clients (étape, montant), projets du portfolio (masqués signalés), factures (numéro, client, montant, statut ; « retard » trouve les impayés échus), avis (« valider » trouve ceux en attente). Recherche sans accents, tous les mots requis, titre commençant par le premier mot en tête ; 6 résultats par groupe. ↑ ↓ Entrée Échap, souris. Sans saisie : récents (6, sur l'appareil, `hub_cmdk_recent`) + actions. Chaque résultat appelle les fonctions existantes (dossier → `ClientWorkspace.open`, facture → Facturation filtrée sur le numéro, projet → fenêtre d'édition de son bloc). Textes échappés.

## Navigation mobile / tablette (`js/mobile-nav.js`, `HubNav`)

≤ 820 px : la barre latérale devient un tiroir (☰ dans la barre du haut, fond assombri, Échap, fermeture après le choix d'une page, fermeture automatique en repassant en grand écran) ; « Sync Behance » quitte la barre du haut (disponible dans la recherche). Au-delà de 820 px, rien ne change. Avant 3.21, la barre latérale restait une colonne fixe et prenait la moitié d'un écran de téléphone.

## Stabilité

Les minuteurs périodiques sont uniques par session (garde existante). Le relevé des avis toutes les 5 min est sauté quand l'onglet est caché et relancé au retour (plus de 5 min après le dernier).

- 3.27.0 : la barre latérale Business compte trois entrées (Clients & Projets, Facturation, Avis). Demandes & Devis et Portails sont des onglets de Clients & Projets (`js/business-nav.js`, détail dans `CLIENTS-ET-PROJETS.md`) ; la recherche les affiche comme « Clients & Projets › … ». Le titre de la barre du haut est tronqué avec « … » sur mobile.
