# Business : facturation et suivi (3.20.0)

Inspiré des outils libres de facturation pour indépendants (Invoice Ninja, Crater, InvoiceShelf, Akaunting). Module `js/business.js` (`Biz`), branché sur la page Facturation et la Vue d'ensemble.

## Fonctionnalités

- **Mes infos** (⚙ dans l'en-tête Facturation) : nom ou raison sociale (obligatoire pour facturer), SIRET, adresse, e-mail, téléphone, mention TVA (défaut « TVA non applicable, art. 293 B du CGI »), délai de paiement (jours, défaut 30), plafond annuel (défaut 77 700 €, modifiable — à vérifier chaque année), IBAN facultatif, mentions de retard B2B. Stocké dans `hub_business` : sauvegarde GitHub privée (registre `HubData`, `sync: null` → pas de miroir Firestore), jamais lu par le générateur du site.
- **Numérotation continue** `FA-AAAA-NNN` par année d'émission, attribuée à la création (ou au premier export pour les anciennes prestations), jamais réutilisée (`seq` + plus grand numéro existant).
- **Échéance** (`dueAt` = création + délai) ; « EN RETARD » = ouverte (en attente / acompte) et échéance dépassée (remplace l'ancien seuil fixe de 14 jours). **Encaissement daté** (`paidAt`) au passage à « Payée ».
- **Facture imprimable / PDF** 🧾 : A4, émetteur, client (e-mail si connu dans Clients), ligne, total, mentions TVA, délai, IBAN, pénalités de retard et indemnité de 40 € (art. L441-10 C. com.), tampon « PAYÉE ». Fenêtre d'impression du navigateur → « Enregistrer en PDF ».
- **Relance** ✉ : brouillon d'e-mail pré-rédigé (rappel avant échéance, relance après), compteur de relances affiché. Rien n'est envoyé automatiquement.
- **Dupliquer** ⧉ (nouveau numéro, nouvelle échéance), suppression confirmée.
- **Tableau de bord du CA** (remplace l'ancienne rangée de 4 compteurs) : encaissé ce mois / cette année, en attente, en retard, 12 derniers mois (couleur d'accent), barre vers le plafond (rouge à 90 %).
- **Vue d'ensemble → ⚡ À traiter** : factures en retard, échéances de la semaine, avis à valider, demandes à traiter — chaque ligne mène à sa page. Badge Facturation = factures **en retard** seulement.
- **Export CSV** : numéro, échéance et date d'encaissement en plus.

## Couleur dynamique (3.20.0)

- Tableau de bord : `--green` vaut `var(--accent)` ; les `#2e9a63` fixes sont devenus `var(--green)` ; les toasts « succès » prennent l'accent avec une encre lisible (`showToast`) ; les statuts Terminé/Actif (couleurs combinées à une opacité hexadécimale) lisent l'accent via `hubAccentHex()`.
- Pages vues par le client (devis en ligne `functions/estimate`, formulaire de demande `functions/request`) : l'accent du site est enregistré dans le document à sa création (`accent`, déjà public) et appliqué par `accentVars()` (accent, encre WCAG, teintes). Les anciens liens sans `accent` gardent le citron.
