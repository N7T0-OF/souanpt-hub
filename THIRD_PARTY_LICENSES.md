# Licences tierces — souanpt.hub

Ce projet reprend et adapte des mécanismes issus de logiciels libres.
Cette page conserve les avis de copyright et les licences applicables.

---

## OpenBento

- **Copyright** © 2025 Yoan Bernabeu et les contributeurs d'OpenBento
- **Licence** : MIT
- **Source** : https://github.com/yoanbernabeu/openbento

### Ce qui est repris / adapté dans souanpt.hub

Le moteur d'édition de souanpt.hub n'est pas une copie d'OpenBento : il est écrit
en JavaScript natif (OpenBento est en React/TypeScript) et repose sur un modèle de
données différent. Les idées et mécanismes suivants ont toutefois été **analysés
puis adaptés** à partir de son code, et le crédit lui revient :

- **Point focal non destructif des médias** — stocker la position de cadrage dans
  les données (`x`/`y` en pourcentage) et l'appliquer en CSS `object-position`,
  plutôt que de recadrer/ré-encoder le fichier. C'est ce qui permet aux **GIF de
  rester animés** (`components/Block.tsx`, `mediaPosition`).
- **Mathématiques de placement en grille** — test de chevauchement AABB, ensemble
  des cellules occupées, recherche de la première position libre, conversion
  pixels → cellule de grille (`components/Builder.tsx`).
- **Registre de plateformes sociales** — décrire chaque réseau par une donnée
  (`id`, `label`, `icône`, `couleur`, `placeholder`, constructeur d'URL) au lieu de
  coder chaque plateforme séparément (`socialPlatforms.ts`).
- **Historique d'édition** — piles passé/futur bornées, avec déduplication des
  états identiques (`hooks/useHistory.ts`).
- **Versionnement du modèle de blocs** et migration d'une version de grille à la
  suivante (`gridVersion`, `services/storageService.ts`).

Aucun fichier d'OpenBento n'est distribué tel quel dans ce dépôt.

### Texte de la licence MIT

```
MIT License

Copyright (c) 2025 Yoan Bernabeu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
