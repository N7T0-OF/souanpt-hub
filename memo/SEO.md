# Référencement des sites publiés (3.18.0)

haunt.gg est une page de liens : elle ne se classe pas sur Google pour un métier. Le site publié est le complément qui peut l'être. Module : `js/site-seo.js` (`SiteSEO`), fenêtre éditeur 🔎 SEO dans `js/editor-seo.js`.

## Ce qui est publié

- `<head>` : titre (réglé, sinon « nom — métier — ville », 70 car. max), description (réglée, sinon bio + métier + ville), `robots` (`index,follow,max-image-preview:large` ou `noindex,nofollow`), lien canonique, `theme-color`, Open Graph et Twitter (image de partage réglée, sinon bannière, sinon première couverture **https**), `rel="me"` vers haunt.gg.
- JSON-LD `@graph` : `WebSite`, `Person` (métier, ville, e-mail, `sameAs` = haunt.gg + liens **visibles**), `ItemList` des projets **visibles** (30 max), et `Service` avec `aggregateRating` + avis **validés et affichés** (section Avis active). Google affiche les étoiles à sa discrétion (règle des avis « auto-hébergés »).
- `sitemap.xml` (page d'accueil + images des projets pour Google Images) et `robots.txt` (avec le lien du plan, ou `Disallow: /` si l'indexation est coupée), ajoutés au commit de publication. Sans adresse connue, rien n'est ajouté.
- Adresse : `cfg.siteUrl` (enregistrée à la publication), sinon `https://<login>.github.io/<dépôt>/`.

## Règles

Textes nettoyés et échappés ; `<` échappé dans le JSON-LD ; seules les images `https` (jamais `data:`) servent d'aperçu. Projets masqués, avis en attente et liens masqués n'apparaissent jamais (test `site-seo.test.mjs`).

## Audit

11 vérifications (indexation, adresse, longueur du titre et de la description, métier, ville, image de partage, ≥ 3 projets, tags, avis validés, haunt.gg relié) → score sur 100 et conseils, avec aperçu du résultat Google et de la carte de partage.

## Une page par projet (3.19.0)

Inspiré des plateformes de portfolio (Contra, Behance) : chaque projet visible devient `projets/<titre-sans-accents>-<id>/index.html` (`SiteSEO.projectSlug/projectPath/projectPage`). Page légère et autonome aux couleurs du site : titre, sous-titre (`p.sub`), tags, bouton « ✉ Me contacter / devis » (`../../#contact`), lien Behance/projet, couverture + galerie, liens vers 6 autres projets (maillage interne), bouton retour haunt.gg. SEO propre : titre « projet — nom », description, canonique, Open Graph `article`, JSON-LD `CreativeWork` + `BreadcrumbList`. Le plan du site liste chaque page avec son image ; dans le JSON-LD de l'accueil, la liste des projets pointe vers ces pages.

Publication (`deployPortfolio`) : pages incluses dans le commit (300 max) ; les dossiers `projets/*` qui ne correspondent plus à un projet public sont supprimés dans le même commit (`GH.commitFiles` accepte `{ path, delete: true }` → entrée d'arbre `sha: null`), pour qu'un projet masqué ne reste pas sur Google. Les portails clients gardent `p/<id>/` (dépôt des portails) : pas de collision.

Choix assumé : pas de grandes tuiles-liens en image sur le site, elles existent déjà sur le profil haunt.gg.
