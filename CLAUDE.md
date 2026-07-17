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
- **Stockage : Supabase (Postgres)**, table configurable via `SUPABASE_TABLE`
  (défaut `tasks`). Client créé côté serveur avec la clé `service_role` (tous les
  droits, jamais exposée au frontend). Le frontend n'accède jamais directement à
  Supabase : il passe uniquement par l'API REST de `server.js`.
- **Pas d'authentification** — tout le monde avec le lien voit et modifie tout.

### Variables d'environnement (voir `.env.example`)

- `ANTHROPIC_API_KEY` — requise pour l'extraction IA (`POST /api/extract`) ; sans elle
  le serveur démarre quand même mais renvoie une erreur 500 sur cet endpoint.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — requises pour le stockage des tâches
  (trouvables dans Supabase > Project Settings > API). Sans elles, le client
  Supabase créé au démarrage échoue dès la première requête sur `/api/tasks`.
- `SUPABASE_TABLE` (optionnel, défaut `tasks`) — nom de la table Supabase utilisée
  par toutes les requêtes de `server.js`. Voir "Séparation test/prod" ci-dessous.
- `PORT` (défaut 3000), `ANTHROPIC_MODEL` (défaut `claude-sonnet-4-6`),
  `MAX_TASKS_PER_IMPORT` (défaut 80).

### Séparation test/prod dans Supabase

Un seul projet Supabase est utilisé pour la prod et pour les tests locaux (même
`SUPABASE_URL`, même `SUPABASE_SERVICE_KEY`) — la séparation se fait uniquement via
le **nom de la table** (`SUPABASE_TABLE`), pas via des projets Supabase distincts.

Raison : le plan gratuit Supabase limite à **2 projets par compte** (pas par
organisation) ; multiplier les projets pour chaque usage (prod, test, autres apps
CHV) épuiserait vite ce quota. Pointer vers une table différente (ex. `tasks_dev`
en local, créée avec le même schéma que `tasks`) coûte rien et évite de polluer les
données réelles de l'équipe pendant les tests — voir l'incident du 2026-07-15 où des
tâches de test étaient visibles en direct sur l'app de production via le SSE.

En local : mettre `SUPABASE_TABLE=tasks_dev` dans `.env` (table à créer une fois
dans Supabase, avec le même schéma que `tasks`). En production (Render) : ne pas
définir `SUPABASE_TABLE`, ou la définir explicitement à `tasks`.

### API

- `GET /api/tasks`, `POST /api/tasks`, `PUT /api/tasks/:id`, `DELETE /api/tasks/:id`
- `POST /api/tasks/clear-done` — supprime les tâches marquées terminées
- `GET /api/tasks/by-source/:filename` — renvoie `{ totalTasks, batchCount, lastImportAt }`
  pour un nom de fichier exact, utilisé par le frontend pour détecter un réimport avant
  de lancer l'extraction (voir "Détection de réimport" ci-dessous)
- `GET /api/referentiels` — renvoie les listes normalisées PERSONNES / CHANTIERS
  (codées en dur dans `server.js`)
- `POST /api/extract` (multipart, champ `file`, champ optionnel `replaceSource`) —
  envoie un .txt/.pdf à l'API Anthropic et en extrait des tâches structurées
- `GET /api/stream` — SSE, pousse la liste complète des tâches à chaque changement

### Détection de réimport du même compte rendu

Avant d'envoyer un fichier à `/api/extract`, le frontend (`public/script.js`, fonction
attachée à `fileInput`) appelle `GET /api/tasks/by-source/:filename` (nom de fichier
exact). Si des tâches existent déjà pour ce nom, une boîte de dialogue (`showReimportDialog()`,
overlay `.modal-overlay`/`.modal` dans `style.css`) propose deux choix :
- **Remplacer** : le frontend envoie `replaceSource=<nom du fichier>` avec l'import. Côté
  serveur, `POST /api/extract` supprime alors `WHERE source = replaceSource` (tous
  `import_batch` confondus) **après** l'extraction IA réussie mais **avant** l'insertion
  du nouveau lot — l'ancien lot n'est jamais perdu si l'appel à l'IA échoue.
- **Ajouter quand même** : comportement inchangé, aucun paramètre envoyé, les deux lots
  cohabitent (comme avant cette fonctionnalité, avec le risque de doublons assumé).

Cette détection se fait uniquement sur le nom de fichier exact (`source`), pas sur le
contenu : renommer légèrement un fichier avant réimport contournerait la détection.

## Vue focus et ordre des colonnes (frontend uniquement, `public/script.js`)

- **Vue focus sur une personne** : cliquer sur le tag `👤 Nom` d'une carte (visible en
  vues "Par priorité"/"Par chantier"), ou sur le titre de colonne en vue "Par
  personne", ouvre une vue focus (tâches de cette personne, regroupées par priorité).
  `effectiveView()` force le groupement `'priority'` pendant le focus sans jamais
  modifier `currentView` ni `activeFilters`, pour que "◀ Retour" restaure exactement
  l'état précédent.
- **Annulation (Ctrl+Z / Cmd+Z)** : historique en mémoire (`actionHistory`, 15
  dernières actions max), propre à ce navigateur et perdu au rechargement — pas de
  localStorage, pas de synchronisation entre postes. Couvre : création manuelle,
  édition, suppression, coché/décoché, réassignation par glisser-déposer, et import
  IA (une seule entrée groupée pour tout l'import). Chaque entrée stocke sa propre
  fonction d'inversion (`undo`) : création → suppression de l'id créé ; suppression →
  recréation via POST (nouvel id, acceptable) ; édition/coché/réassignation → PUT qui
  restaure les valeurs d'avant. Le raccourci n'intercepte pas Ctrl+Z si le focus est
  dans un champ `input`/`textarea`/`contentEditable`, pour laisser l'undo natif du
  navigateur fonctionner dans les formulaires d'édition. Si l'inversion échoue (tâche
  changée/supprimée entre-temps par quelqu'un d'autre), un message d'erreur s'affiche
  et l'entrée est retirée de l'historique sans faire planter l'appli.
- **Ordre des colonnes par glisser-déposer** : l'en-tête de chaque colonne
  (`.col-head`) est draggable pour réordonner l'affichage des colonnes, indépendamment
  du glisser-déposer des cartes individuelles (réassignation) — les deux utilisent des
  types `dataTransfer` différents (`application/x-column-key` vs `text/plain`) pour ne
  jamais se confondre. **C'est une préférence d'affichage locale au navigateur,
  stockée en `localStorage`** (clé `chv-column-order-<vue>`, ex.
  `chv-column-order-person`) — pas une donnée d'équipe, pas partagée entre postes, pas
  synchronisée via Supabase. Les nouveaux groupes sans position enregistrée (nouvelle
  personne, nouveau chantier) sont ajoutés à la fin sans faire planter l'affichage.
- **Mise en évidence du dernier import** : colonne Postgres `import_batch` (text,
  nullable) — `server.js` génère un UUID unique par appel à `POST /api/extract` et
  l'assigne à toutes les tâches créées par cet import ; les créations manuelles
  (`POST /api/tasks`) laissent ce champ à `null`. Le frontend ne mémorise rien entre
  deux rendus : à chaque `render()`, `getLatestImportBatch()` parcourt `tasks` pour
  trouver la tâche avec un `import_batch` non nul et le `createdAt` le plus récent,
  et applique le style "🆕 Import récent" (liseré + fond teinté `--recent-import`,
  classe `.card.recent-import`) à toutes les cartes partageant ce même lot. Comme le
  calcul est refait à chaque rendu à partir des données reçues (y compris via SSE),
  dès qu'un import plus récent arrive, l'ancien lot perd automatiquement ce style —
  aucun état à réinitialiser manuellement. Fonctionne à l'identique dans les 3 vues.

## Modèle de données (une tâche)

Chaque tâche est une ligne de la table Postgres désignée par `SUPABASE_TABLE`
(`tasks` par défaut, colonnes en `snake_case`),
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
- `import_batch` — texte, `null` pour une tâche créée manuellement ; UUID commun à
  toutes les tâches d'un même import IA sinon. Voir "Mise en évidence du dernier
  import" ci-dessus.

## Référentiels personnes / chantiers

Les tableaux `PERSONNES` et `CHANTIERS` sont codés en dur **uniquement dans
`server.js`** (utilisés dans `buildPrompt()` pour l'extraction IA, et exposés via
`GET /api/referentiels`). Le frontend (`public/script.js`, fonction `init()` ligne
385-388) ne les duplique pas : il les récupère dynamiquement au chargement via cet
endpoint. Il n'y a donc **qu'un seul endroit à modifier** (`server.js`) pour mettre
à jour ces référentiels — pas de risque de désynchronisation entre extraction IA et
menus du frontend.

**`PERSONNES` est restreinte au "Personnel d'encadrement et de préparation"** (11
personnes, depuis 2026-07-17), en cohérence avec le prompt Plaud AI qui applique la
même restriction sur les comptes rendus importés. Seules ces personnes peuvent être
assignées comme "Responsable" d'une tâche (extraction IA ou menu manuel). Le
référentiel complet du personnel (chefs d'équipe, ouvriers...) n'est volontairement
plus utilisé dans l'app : ces personnes peuvent être mentionnées dans le texte d'une
tâche, mais pas assignées comme responsables. Les tâches existantes en base dont le
responsable n'est plus dans cette liste restreinte ne sont pas migrées : elles
restent affichées normalement, et leur valeur de responsable apparaît simplement
ajoutée en tête du menu déroulant (`buildOptions()` côté client ajoute toute valeur
courante absente de la liste).

## Logique du prompt d'extraction IA

`buildPrompt()` (dans `server.js`) suppose que le compte rendu suit la structure
imposée par le prompt Plaud AI utilisé en interne chez CHV, avec une section
"11. Liste complète des actions à faire" (tableau : Priorité, Action, Chantier/sujet,
Responsable, Échéance, Commentaire) comme source principale et la plus fiable ; les
tâches importantes mentionnées ailleurs dans le document viennent en complément.
Si CHV modifie la structure de son prompt Plaud, `buildPrompt()` devra être adapté
en conséquence pour que l'extraction reste fiable.

`MAX_TASKS_PER_IMPORT` (défaut 80, relevé depuis 40 le 2026-07-17 — certains comptes
rendus Plaud contiennent 60 à 90 actions) borne le nombre de tâches extraites par
import ; en cas de dépassement, le prompt demande de prioriser les tâches `Urgent`
puis `Important`. `max_tokens` de l'appel Anthropic est fixé à 8192 (relevé depuis
4096 en même temps) pour limiter le risque de troncature de la réponse IA avec un
nombre de tâches plus élevé ; le mécanisme de réparation JSON tronqué existant
(dans `POST /api/extract`) reste un filet de sécurité supplémentaire en cas de
coupure malgré tout.

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
- **Incident du 2026-07-16** : 1024 tâches vides (description vide, `source: 'manuel'`,
  `import_batch: null`) créées en production via des appels bruts et rapprochés à
  `POST /api/tasks`, sans passer par le formulaire de l'app — signature typique d'un
  bot/scanner automatisé sondant l'endpoint public. Supprimées le 2026-07-17 (86 vraies
  tâches conservées, vérifiées). En réponse, `POST /api/tasks` et `POST /api/extract`
  rejettent désormais (400) toute tâche sans description exploitable (vide ou uniquement
  des espaces). **Attention : c'est une protection minimale contre le spam, pas une
  authentification.** L'endpoint reste public et accessible à quiconque a l'URL — un bot
  peut toujours poster des tâches avec une description non vide (juste plus difficile à
  distinguer du bruit). Si l'incident se reproduit, même avec des descriptions non vides
  cette fois, il faudra une vraie protection : clé API partagée dans un header, rate
  limiting, ou authentification par compte.
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
