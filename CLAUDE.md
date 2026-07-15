# CHV-Dashboard — Planning des tâches CHV

## Résumé

Tableau de bord d'équipe pour Les Charpentiers du Haut Var (CHV). Importe des comptes
rendus de réunion planning (générés par Plaud AI), en extrait automatiquement les
tâches via l'API Anthropic, et les partage en temps réel entre tous les postes du
bureau via Server-Sent Events.

## Architecture

- **`server.js`** — serveur Express unique (pas de framework front). Sert `public/`
  en statique, expose l'API REST, diffuse les mises à jour via SSE (`GET /api/stream`).
- **`public/`** — frontend statique (`index.html`, `script.js`, `style.css`), aucune
  étape de build.
- **`data.json`** — stockage des tâches, fichier JSON plat (pas de base de données).
  Chemin configurable via `DATA_DIR` (utile pour un disque persistant en hébergement).
- **Pas d'authentification** — tout le monde avec le lien voit et modifie tout.

### Variables d'environnement (voir `.env.example`)

- `ANTHROPIC_API_KEY` — requise pour l'extraction IA (`POST /api/extract`) ; sans elle
  le serveur démarre quand même mais renvoie une erreur 500 sur cet endpoint.
- `PORT` (défaut 3000), `ANTHROPIC_MODEL` (défaut `claude-sonnet-4-6`),
  `MAX_TASKS_PER_IMPORT` (défaut 40), `DATA_DIR` (défaut : dossier du projet).

### API

- `GET /api/tasks`, `POST /api/tasks`, `PUT /api/tasks/:id`, `DELETE /api/tasks/:id`
- `POST /api/tasks/clear-done` — supprime les tâches marquées terminées
- `GET /api/referentiels` — renvoie les listes normalisées PERSONNES / CHANTIERS
  (codées en dur dans `server.js`)
- `POST /api/extract` (multipart, champ `file`) — envoie un .txt/.pdf à l'API
  Anthropic et en extrait des tâches structurées
- `GET /api/stream` — SSE, pousse la liste complète des tâches à chaque changement

## Dépôt GitHub

Remote `origin` : `https://github.com/PLdev83/CHV-Dashboard.git`, branche `main`.

Ce dossier local (`chv-dashboard_2/chv-dashboard`) contenait une version bien plus
avancée que celle précédemment poussée sur GitHub. Historique fusionné le 2026-07-15
(`git merge --allow-unrelated-histories`) plutôt qu'écrasé, pour préserver l'historique
distant existant. Les anciens fichiers `download`, `script.js`, `style.css` à la racine
(reliquats d'une version antérieure) ont été supprimés au profit de `public/`.

## Instructions permanentes pour Claude sur ce projet

L'utilisateur a demandé une prise en charge autonome complète de ce dossier :

1. Avant toute modification : vérifier l'état avec `git status`.
2. Après chaque modification de code : tester que le serveur démarre
   (`npm install` si besoin, puis `npm start`, vérifier qu'il répond, puis l'arrêter).
   Utiliser un port alternatif (`PORT=xxxx npm start`) si 3000 est déjà occupé par
   un autre processus, pour ne pas le tuer par erreur.
3. Une fois testé : commit avec message clair, puis `git push` vers `origin main`
   automatiquement, sans redemander confirmation à chaque fois.
4. Si un changement touche l'architecture (nouvelle dépendance, nouvelle route API,
   nouveau champ de données...) : mettre à jour ce fichier en conséquence.
5. En cas d'erreur non résolue : expliquer clairement le blocage plutôt que de
   s'arrêter silencieusement.

Ceci ne couvre que ce dépôt. Les actions destructives (force-push, suppression de
branches, reset --hard, suppression de données) restent soumises à confirmation
explicite au cas par cas.
