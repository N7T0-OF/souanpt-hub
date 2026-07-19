# Fusion Portails + Demandes & Devis — audit et état

## 1. Écart entre le cahier et le projet réel

Le cahier reçu décrit une autre pile technique. Voici ce qui existe réellement,
vérifié fichier par fichier :

| Le cahier suppose | Réalité de souanpt.hub |
|---|---|
| Supabase + RLS + `supabase/migrations/*.sql` | **Firestore**. Aucun SQL, aucune migration versionnée. Les règles sont dans `firebase/firestore.rules`. |
| `npm install / lint / typecheck / test / build / test:e2e` | **Aucun `package.json`.** Le projet est du HTML/CSS/JS servi tel quel : il n'y a ni build, ni lint, ni suite de tests à lancer. |
| `npm audit`, dépendances | Aucune dépendance installée. Les seules bibliothèques externes sont chargées à la demande depuis un CDN (PDF.js). |
| R2, `R2_ACCESS_KEY_ID`, `R2_BUCKET` | **R2 abandonné** (exige une carte bancaire). Le stockage passe par GitHub. |
| Environnement de préproduction `staging.…` | Inexistant. Cloudflare Pages crée une URL par déploiement (`<hash>.souanptjub.pages.dev`) qui sert de préproduction de fait. |
| Composants React (`WorkspaceHeader`, `onClick={}`, `setState`) | JavaScript natif, sans framework. |
| `PORTAL_SIGNING_SECRET`, `WEBHOOK_SECRET` | Aucun secret côté Pages. Les seuls secrets vivent dans les Workers Cloudflare. |

**Conséquence.** Les sections 18 (tables SQL), 19 (migrations), 25 (RLS), 26
étapes 3-4, 27 (variables), 28 (commandes npm), 30 (migrations Supabase) et 32
(monitoring outillé) ne sont pas applicables telles quelles. Elles ne sont pas
« refusées » : elles décrivent un projet qui n'est pas celui-ci.

## 2. Ce qui existe aujourd'hui

| Élément | Où | Stockage |
|---|---|---|
| Portails clients | `page-portals`, `portal.html?id=<id>`, `generatePortal()` | `hub_portals` (local) + collection publique `portals` (Firestore) |
| Demandes & Devis | `page-devis`, `js/quote.js` | `hub_pricing` (privé) + collection publique `estimates` |
| Estimation publique | `functions/estimate/[code].js` | `estimates/<code>` + sous-collection `offers` |
| Clients | `page-clients` | `hub_clients` |

Les deux modules avaient donc **deux liens publics différents** pour un même
client : `portal.html?id=…` et `/estimate/<code>`.

## 3. Ce qui a été fait

**Un lien unique et permanent : `/c/<token>`** (`functions/c/[token].js`).

Ce n'est pas une nouvelle page mais un **résolveur** : il regarde à quelle
étape se trouve le dossier et sert la vue correspondante.

- `estimates/<token>` → estimation et négociation, **rendues sur place**
  (l'adresse reste `/c/<token>`) ;
- `portals/<token>` → redirection vers la page portail existante ;
- sinon → 404 explicite.

Aucune donnée n'a été déplacée, dupliquée ou supprimée. **Les anciennes
adresses continuent de fonctionner** : `/estimate/<code>` et
`portal.html?id=<id>` répondent comme avant.

Le bouton « Créer un lien client » produit désormais un lien `/c/…`.

### Vérifié

| Test | Résultat |
|---|---|
| `/c/<token>` avec une estimation | 200, vue rendue sur place, fenêtre de négociation et les 3 boutons de remise présents |
| `/c/<token>` avec un portail | 302 vers `portal.html?id=…` |
| `/c/` inexistant · invalide · trop court | 404 « Lien introuvable » |
| `/estimate/<code>` | toujours 404 propre sur un code inconnu → route intacte |
| `portal.html` | 200 → page inchangée |
| `/u/<pseudo>` | 200/404 selon le pseudo → route intacte |
| `app.html` et fichiers statiques | 200, non interceptés par les Functions |

## 4. Ce qui reste à faire

La fusion **n'est pas terminée** ; seule sa fondation l'est.

1. **Modèle `ClientWorkspace`** — aujourd'hui un devis et un portail restent
   deux documents distincts. Il faut une entité pivot portant `stage`, et
   faire pointer les deux collections vers elle.
2. **Portail rendu par le même moteur** — tant que `portal.html` reste une page
   statique lisant `?id=`, l'étape production impose une redirection et
   l'adresse change. C'est la prochaine étape logique.
3. **Navigation « Clients & Projets »** — les entrées Portails, Demandes &
   Devis et Clients existent encore séparément. Les fusionner suppose d'abord
   le point 1, sinon on ne ferait que renommer des onglets.
4. **Conversion prospect → client sans nouveau dossier** (§8), machine d'états
   unifiée (§9), fil de messages commun (§12), déblocage des fichiers au
   paiement (§15).

## 5. Points de sécurité déjà tenus

- Le document `estimates/<code>` est en **lecture publique** : n'y entrent que
  les données destinées au client. Prix plancher, taux horaire et marge restent
  dans `users/{uid}/data`, illisible par autrui.
- Les contre-offres sont créables sans compte, mais la **forme est verrouillée**
  (liste blanche de champs, montant borné, message ≤ 600 caractères) et
  `status: 'pending'` est imposé : une offre ne peut pas s'auto-accepter.
- Les jetons sont validés par expression régulière **avant** toute requête.

> ⚠ **Action requise côté utilisateur.** Les règles Firestore doivent être
> publiées depuis la console Firebase (Firestore → Règles). Sans cela, les
> contre-offres sont refusées : aucune règle existante ne couvre la
> sous-collection `offers`.

## 6. Retour en arrière

Chaque étape est un commit séparé et le déploiement Cloudflare conserve
l'historique : revenir en arrière consiste à redéployer le déploiement
précédent depuis le tableau de bord Cloudflare, sans toucher aux données.
Le résolveur `/c/` étant purement additif, le supprimer ne casse rien — les
anciens liens n'ont jamais cessé de fonctionner.
