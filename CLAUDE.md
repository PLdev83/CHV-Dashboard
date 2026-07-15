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
- **Stockage : Supabase (Postgres)**, table `tasks`. Client créé côté serveur avec la
  clé `service_role` (tous les droits, jamais exposée au frontend). Le frontend
  n'accède jamais directement à Supabase : il passe uniquement par l'API REST de
  `server.js`.
- **Pas d'authentification** — tout le monde avec le lien voit et modifie tout.

### Variables d'environnement (voir `.env.example`)

- `ANTHROPIC_API_KEY` — requise pour l'extraction IA (`POST /api/extract`) ; sans elle
  le serveur démarre quand même mais renvoie une erreur 500 sur cet endpoint.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — requises pour le stockage des tâches
  (trouvables dans Supabase > Project Settings > API). Sans elles, le client
  Supabase créé au démarrage échoue dès la première requête sur `/api/tasks`.
- `PORT` (défaut 3000), `ANTHROPIC_MODEL` (défaut `claude-sonnet-4-6`),
  `MAX_TASKS_PER_IMPORT` (défaut 40).

### API

- `GET /api/tasks`, `POST /api/tasks`, `PUT /api/tasks/:id`, `DELETE /api/tasks/:id`
- `POST /api/tasks/clear-done` — supprime les tâches marquées terminées
- `GET /api/referentiels` — renvoie les listes normalisées PERSONNES / CHANTIERS
  (codées en dur dans `server.js`)
- `POST /api/extract` (multipart, champ `file`) — envoie un .txt/.pdf à l'API
  Anthropic et en extrait des tâches structurées
- `GET /api/stream` — SSE, pousse la liste complète des tâches à chaque changement

## Modèle de données (une tâche)

Chaque tâche est une ligne de la table Postgres `tasks` (colonnes en `snake_case`),
renvoyée par l'API en JSON (clés en `camelCase`) sous la forme :

- `id` — UUID, généré automatiquement par Postgres à l'insertion (plus de
  `crypto.randomUUID()` côté serveur)
- `priority` — l'une de `Urgent`, `Important`, `Normal`, `À vérifier`
- `category` — l'une de `Atelier`, `Étude`, `Commande/Matériel`, `Livraison`,
  `Grue/Levage`, `Bureau`
- `description` — texte libre, tronqué à 300 caractères
- `chantier` — texte libre, tronqué à 80 caractères (idéalement une valeur du
  référentiel CHANTIERS, mais non forcé côté serveur)
- `responsable` — texte libre, tronqué à 80 caractères (idéalement une valeur du
  référentiel PERSONNES, mais non forcé côté serveur)
- `echeance` — texte libre, tronqué à 40 caractères (ex. `2026-07-20`, `Immédiate`)
- `done` — booléen, `false` à la création
- `source` — `'manuel'` si créée via le formulaire, ou le nom du fichier importé
  (ex. `compte-rendu-2026-07-14.pdf`) si extraite par l'IA
- `createdAt` — timestamp `Date.now()` (millisecondes epoch). **Colonne Postgres :
  `created_at` (bigint)**. Le frontend (`public/script.js`) attend `createdAt` en
  camelCase ; `server.js` fait le mapping (`toApiTask()`) sur toutes les réponses
  API, aucun changement requis côté frontend.

## Référentiels personnes / chantiers

Les tableaux `PERSONNES` et `CHANTIERS` sont codés en dur **uniquement dans
`server.js`** (utilisés dans `buildPrompt()` pour l'extraction IA, et exposés via
`GET /api/referentiels`). Le frontend (`public/script.js`, fonction `init()` ligne
385-388) ne les duplique pas : il les récupère dynamiquement au chargement via cet
endpoint. Il n'y a donc **qu'un seul endroit à modifier** (`server.js`) pour mettre
à jour ces référentiels — pas de risque de désynchronisation entre extraction IA et
menus du frontend.

## Logique du prompt d'extraction IA

`buildPrompt()` (dans `server.js`) suppose que le compte rendu suit la structure
imposée par le prompt Plaud AI utilisé en interne chez CHV, avec une section
"11. Liste complète des actions à faire" (tableau : Priorité, Action, Chantier/sujet,
Responsable, Échéance, Commentaire) comme source principale et la plus fiable ; les
tâches importantes mentionnées ailleurs dans le document viennent en complément.
Si CHV modifie la structure de son prompt Plaud, `buildPrompt()` devra être adapté
en conséquence pour que l'extraction reste fiable.

`MAX_TASKS_PER_IMPORT` (défaut 40) borne le nombre de tâches extraites par import,
pour éviter les réponses IA tronquées sur de longs comptes rendus ; en cas de
dépassement, le prompt demande de prioriser les tâches `Urgent` puis `Important`.

## Déploiement Render

- Hébergé sur **Render** (Web Service), déploiement automatique à chaque push sur
  `main`.
- Variables d'environnement à configurer sur Render : `ANTHROPIC_API_KEY`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
- Build command : `npm install` — Start command : `npm start`.
- Plan gratuit actuel : le service se met en veille après 15 min d'inactivité
  (~30-50s de réveil au réveil).
- **Le stockage n'est plus lié au disque de Render** depuis la migration vers
  Supabase (Postgres) : les tâches survivent désormais aux redéploiements sans
  disque persistant Render. Le problème de disque persistant sur le plan gratuit
  Render (qui avait causé un crash `ENOENT`) ne se pose donc plus.
- **Supabase, plan gratuit** : le projet se met en pause après **7 jours
  d'inactivité** (aucune requête). Une requête sur un projet en pause échoue le
  temps qu'il se réactive (généralement moins d'une minute) — à garder en tête si
  l'appli est peu utilisée pendant les vacances par exemple. Passer sur un plan
  Supabase payant supprime cette mise en pause automatique.

## Dépôt GitHub

Remote `origin` : `https://github.com/PLdev83/CHV-Dashboard.git`, branche `main`.

Ce dossier local (`chv-dashboard_2/chv-dashboard`) contenait une version bien plus
avancée que celle précédemment poussée sur GitHub. Historique fusionné le 2026-07-15
(`git merge --allow-unrelated-histories`) plutôt qu'écrasé, pour préserver l'historique
distant existant. Les anciens fichiers `download`, `script.js`, `style.css` à la racine
(reliquats d'une version antérieure) ont été supprimés au profit de `public/`.

## Limites connues et pistes d'évolution

- Pas d'authentification : toute personne avec le lien peut tout voir/modifier, sans
  distinction de droits par rôle.
- Pas de gestion de conflit : dernière sauvegarde gagne en cas de modification
  simultanée de la même tâche.
- ~~Stockage fichier JSON qui ne supportait pas plusieurs instances serveur en
  parallèle~~ — résolu par la migration vers Supabase/Postgres (2026-07-15).
- Piste évoquée mais non développée : pousser les tâches assignées vers Microsoft
  To Do / Outlook via Microsoft Graph API (nécessiterait l'enregistrement d'une
  app Azure/Entra côté CHV et la correspondance noms référentiel ↔ comptes
  Microsoft des collaborateurs).

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
6. Toute modification touchant directement la base Supabase en production (ALTER
   TABLE, DROP TABLE, TRUNCATE, DELETE sans clause WHERE précise, modification de
   schéma) reste soumise à confirmation explicite au cas par cas, au même titre que
   le force-push git. Les opérations normales de l'application (INSERT/UPDATE/DELETE
   par id via l'API, comme déjà en place dans `server.js`) ne sont pas concernées par
   cette règle.

Ceci ne couvre que ce dépôt. Les actions destructives (force-push, suppression de
branches, reset --hard, suppression de données) restent soumises à confirmation
explicite au cas par cas.
