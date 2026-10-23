# Sankai Life unifié — préparation sécurisée

Date : 21 octobre 2026
État : partiel — préparation documentaire prête; création de branche et sauvegarde distante non exécutées.

## Sources de migration à préserver

- `souanpt-hub` : checkout courant `ee41a3f963bdd717f8fc0b62b0839b63133eee3c`.
- `sankai-life` : le dépôt Android n'est pas présent dans ce workspace.
- `harvey` : le dépôt du moteur Python n'est pas présent dans ce workspace.

Ne pas fusionner, renommer ou archiver ces dépôts avant sauvegarde vérifiée et validation des migrations. Aucun environnement de production ni fichier de données utilisateur n'a été modifié par cette préparation.

## Cible de travail proposée

Le dépôt principal de migration reste `sankai-life`, conformément au cahier des charges. Structure visée par lots, à adapter seulement après audit des sources Android :

```text
apps/
  web/          dashboard et profils publics issus de souanpt-hub
  android/      application Kotlin/Compose existante
packages/
  schemas/      contrats versionnés communs
  profile/      profil, portfolio, thèmes
  business/    clients, projets, devis
  sync/         manifeste, adaptateurs, conflits
services/
  auth/ profiles/ analytics/ notifications/
integrations/
  harvey/       adaptateur facultatif vers le moteur Python séparé
docs/migration/
```

Ce document ne déplace pas encore les répertoires existants : le faire avant de vérifier les imports, workflows, règles de publication et migrations risquerait de casser les produits en service.

## Sauvegardes et secrets

- Sauvegarder les historiques Git en conservant les commits; ne pas recopier `.env`, clés privées, PAT, credentials Firebase/Google ou secrets CI.
- Les données utilisateur de production ne sont pas copiées ici. Une sauvegarde exploitable doit être créée et vérifiée dans un environnement propriétaire avant le premier essai de migration.
- Conserver les manifestes, règles Firebase, fichiers de build, workflows et configurations Cloudflare sous contrôle de version après retrait de toute valeur secrète.
- Pour toute migration de données : exporter, vérifier les nombres et empreintes, exécuter sur comptes synthétiques, puis confirmer le retour arrière avant une migration réelle.

## Blocage d'environnement

La création de branche `codex/sankai-life-migration-prep` a été tentée localement et refusée par Git : l'environnement expose `.git` en lecture seule (`unable to create directory for .git/refs/heads/...`). Le checkout reste sur `main`; aucun push n'a été tenté. Les branches devront être créées dans un checkout dont les métadonnées Git sont inscriptibles, pour chacun des dépôts après récupération sécurisée des sources.

## Séquence avant toute migration

1. Récupérer les checkouts Android et Harvey dans un espace de travail autorisé, sans écraser leurs répertoires existants.
2. Vérifier les révisions, licences, workflows, dépendances, signatures et jeux de tests de chaque dépôt.
3. Créer les branches de migration et des snapshots Git locaux vérifiables.
4. Définir et valider le schéma `userId` et les adaptateurs de stockage avant toute écriture.
5. Préparer des comptes de test et des jeux de données synthétiques; garder la production hors cible.

Les risques P0 et le premier correctif sont détaillés dans [00-audit-initial.md](00-audit-initial.md).
