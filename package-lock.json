# Planning des tâches — CHV

Tableau de bord d'équipe pour extraire automatiquement les tâches des comptes rendus
de réunion planning (Plaud AI) et les partager en direct entre tous les postes du bureau.

Contrairement à la version précédente (artefact Claude), cette application est **autonome** :
elle tourne sur un petit serveur, s'ouvre dans n'importe quel navigateur, et ne nécessite
aucun compte Claude pour les personnes qui l'utilisent.

## Ce que ça fait

- Import d'un compte rendu (.txt ou .pdf) → extraction automatique des tâches par IA
- 3 vues : par priorité, par personne, par chantier
- Filtre par catégorie (Atelier, Étude, Commande/Matériel, Livraison, Grue/Levage, Bureau)
- Glisser-déposer pour réassigner une tâche (personne, chantier ou priorité selon la vue)
- Clic sur une tâche pour la modifier
- **Mise à jour en direct** : tout le monde voit les mêmes tâches, en temps quasi réel,
  sans recharger la page

## Démarrer en local (pour tester)

Prérequis : [Node.js](https://nodejs.org) version 18 ou plus.

```bash
npm install
cp .env.example .env
```

Ouvre `.env` et colle ta clé API Anthropic (créée sur https://console.anthropic.com) :

```
ANTHROPIC_API_KEY=sk-ant-...
```

Puis lance le serveur :

```bash
npm start
```

Ouvre http://localhost:3000 dans ton navigateur. Pour que tes collègues sur le même
réseau du bureau y accèdent aussi, utilise ton adresse IP locale à la place de
`localhost` (ex. http://192.168.1.42:3000) — demande à ton développeur si besoin.

## Déployer pour un accès permanent (recommandé)

Pour un accès stable depuis n'importe où (pas seulement le réseau du bureau), il faut
héberger ce serveur. Options simples, avec un disque persistant pour ne pas perdre les
tâches à chaque redémarrage :

- **Render** (render.com) : "New Web Service", branché sur ce dossier ; ajoute
  `ANTHROPIC_API_KEY` dans les variables d'environnement ; ajoute un disque persistant
  monté sur le dossier du projet (pour que `data.json` survive aux redéploiements).
- **Railway** (railway.app) : équivalent, avec un volume persistant.
- Un petit serveur/VPS existant de CHV, avec `pm2` ou un service systemd pour garder
  le serveur actif en permanence.

Dans tous les cas, il faut configurer la variable d'environnement `ANTHROPIC_API_KEY`
sur la plateforme choisie (ne jamais la mettre dans le code ou sur GitHub public).

## Limites actuelles à connaître

- **Stockage simple** : les tâches sont dans un fichier `data.json` sur le serveur.
  Ça suffit largement pour une équipe comme CHV, mais si le volume grandit beaucoup
  ou si vous faites tourner plusieurs serveurs en parallèle, il faudra migrer vers
  une vraie base de données (SQLite ou PostgreSQL) — voir avec ton développeur.
- **Pas de comptes utilisateurs** : tout le monde qui a le lien peut tout voir et
  tout modifier. Il n'y a pas de distinction de droits (dirigeant / conducteur /
  chef d'équipe...). À ajouter plus tard si besoin (authentification simple par
  mot de passe partagé, ou comptes nominatifs).
- **Pas de fusion en cas de conflit** : si deux personnes modifient la même tâche
  au même moment, la dernière sauvegarde gagne.
- **La clé API Anthropic est partagée par toute l'équipe** côté serveur : c'est CHV
  qui paie l'usage de l'extraction IA (pas chaque collègue individuellement — il n'y
  a pas besoin de compte Claude personnel).

## Pour aller plus loin (intégration ERP)

Ce projet est conçu comme un prototype autonome et complet : la logique métier
(catégories, priorités, référentiels personnes/chantiers, règles d'extraction) est
la même que celle validée dans les échanges précédents. Il peut servir de base de
spécification directe pour ton développeur s'il préfère intégrer cette fonctionnalité
dans l'ERP Bubble plutôt que de maintenir cette application à part.
