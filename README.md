# ORAMED — Gestion de Stock Dépôt

Application web statique de gestion de stock pour dépôt/entrepôt.

## Stack

- **HTML** / **CSS** / **JavaScript** — aucun framework
- Déployable sur GitHub Pages, Vercel, Netlify (static)

## Fichiers

| Fichier      | Rôle                                          |
|-------------|-----------------------------------------------|
| `index.html` | Structure HTML sémantique                    |
| `style.css`  | Design system dark/light avec CSS variables  |
| `app.js`     | Logique applicative, état centralisé localStorage |

## Rôles

- `?role=direction` → accès complet (tous les onglets)
- `?role=operateur` → accès restreint (onglet Direction masqué)
- Sauvegardé en `localStorage` pour persistance

## Déploiement

1. Push les 3 fichiers sur un repo GitHub
2. Connecter le repo à Vercel → déploiement automatique
3. Pas de build step nécessaire

## Développement local

```bash
npx -y serve .
```
