# Outils locaux et raccourcis (3.25.0)

Inspirations (22 novembre 2026) : ihate.tools, neverupload.lol, animg (outils qui ne téléversent rien, recherche Ctrl/⌘K), bibliothèques d'interface opensourceui.in, Nexvyn UI (crazyui), pinui, wensity, easyui, wobli, ryanaque — composants React non réutilisables tels quels ici (hub en JavaScript sans framework) : seules les idées ont été reprises.

## Page 🧰 Outils (`js/toolbox.js`, `Toolbox`)

Barre latérale (Contenu), recherche globale ou `G` puis `T`. Tout se fait dans le navigateur ; aucun appel réseau dans le module (test).
- **Image** : compresser / redimensionner (largeur max, jamais d'agrandissement) / convertir (WebP, JPG, PNG), qualité, filigrane texte facultatif. Le réencodage par canvas retire les métadonnées (EXIF, GPS). Résultat avec tailles avant/après et téléchargement.
- **Palette** : couleurs dominantes (quantification 4 bits, pixels transparents ignorés, couleurs proches fusionnées) ; copier le HEX ou « Couleur du site » (confirmation, `accentColor` + `HubAccent.apply`).
- **Contraste** : rapport WCAG texte/fond (AA 4,5, grand texte 3, AAA 7), fond prérempli avec l'accent.
- **QR code** : texte ou lien (adresse du site préremplie) → PNG, librairie locale.
- Calculs exposés pour les tests sous `Toolbox.calc` — ne pas les nommer comme les onglets (`_palette`, `_contrast`) : ils les écraseraient (bug corrigé avant livraison).

## Raccourcis (`js/shortcuts.js`, `Shortcuts`)

Écoute en phase de capture sur `window` (passe avant les raccourcis de l'éditeur), jamais pendant une saisie, ni sur la porte de connexion, ni derrière la recherche ou une fenêtre Business/QR.
- `G` puis `O` Vue d'ensemble, `E` Éditeur, `C` Clients & Projets, `D` Demandes & Devis, `F` Facturation, `A` Avis, `S` Stockage, `T` Outils, `L` Portails, `P` Paramètres (1,2 s pour la 2ᵉ touche).
- `/` recherche globale (comme Ctrl/⌘K), `?` aide (liste complète, Échap ferme), `N` nouvelle prestation sur Facturation.
- Éditeur inchangé : `T` `E` `B` `S` ; `G` puis `E` n'ouvre pas « Effets ».

## Raccourcis vers les projets open source (3.26.0)

Demande du propriétaire : ne pas refaire les outils que ces sites proposent déjà, mais y donner accès. Onglet **🔗 Raccourcis** (ouvert par défaut dans la page Outils) :
- **Par défaut** (`DEFAULT_LINKS`, 2 catégories) : Outils sans envoi — ihate.tools, NeverUpload, Aimg ; Interfaces open source — Opensource UI, PinUI, Wensity UI, EasyUI, Wobli, Ryan Aque, Nexvyn UI (crazyui.vercel.app). Masquables (✕) et rétablissables.
- **Personnels** : nom, adresse, icône (emoji), catégorie (libre ou existante), description ; modifier (✎), supprimer (confirmation).
- Stockage `hub_shortcuts` `{ hidden: [ids], custom: [...] }` (registre `HubData`, sauvegarde GitHub privée, `sync: null`). Adresses **https uniquement**, sans identifiants, 300 caractères max (`Toolbox.safeUrl`, revalidées à l'affichage et à l'ouverture) ; ouverture `noopener,noreferrer`.
- Aucune icône chargée depuis ces sites (pastille locale : emoji ou initiale) → aucune requête vers un tiers tant qu'on ne clique pas.
- Recherche globale (Ctrl/⌘K) : groupe « Raccourcis ».
