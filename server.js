// Serveur de l'application "Planning des tâches — CHV"
// - Sert le frontend statique (dossier /public)
// - Expose une API REST pour lire/écrire les tâches (stockées dans Supabase/Postgres)
// - Diffuse les mises à jour en direct à tous les navigateurs connectés (Server-Sent Events)
// - Reçoit un compte rendu (txt/pdf), appelle l'API Anthropic pour en extraire des tâches

// Charge un fichier .env s'il existe (pratique en local ; en production, la plupart
// des hébergeurs (Render, Railway...) fournissent les variables d'environnement directement).
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
// Nombre maximum de tâches extraites par import. Sans la contrainte des artefacts Claude,
// on peut viser plus large : ajuste selon la longueur réelle de tes comptes rendus.
const MAX_TASKS_PER_IMPORT = parseInt(process.env.MAX_TASKS_PER_IMPORT || '40', 10);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ---------- Stockage (Supabase / Postgres) ----------
// Client service_role : tous les droits, ce qui est normal puisqu'il ne tourne
// que côté serveur et n'est jamais exposé au frontend.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
// Permet de séparer données de test et de prod dans le même projet Supabase
// (ex. SUPABASE_TABLE=tasks_dev en local), sans consommer un 2e projet gratuit.
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'tasks';

// Le frontend attend une clé "createdAt" (camelCase) ; la colonne Postgres est "created_at".
function toApiTask({ created_at, ...rest }) {
  return { ...rest, createdAt: created_at };
}

async function getTasks() {
  const { data, error } = await supabase.from(SUPABASE_TABLE).select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data.map(toApiTask);
}

// ---------- Temps réel (Server-Sent Events) ----------
// Chaque navigateur connecté garde une connexion HTTP ouverte ; à chaque changement,
// on relit les tâches depuis Supabase et on pousse la liste complète à tout le monde.
// Simple et suffisant pour une équipe de quelques dizaines de personnes.
let clients = [];
async function broadcast() {
  let tasks;
  try {
    tasks = await getTasks();
  } catch (e) {
    console.error('Erreur broadcast (lecture Supabase) :', e);
    return;
  }
  const payload = `data: ${JSON.stringify(tasks)}\n\n`;
  clients.forEach(res => res.write(payload));
}
app.get('/api/stream', async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();
  try {
    res.write(`data: ${JSON.stringify(await getTasks())}\n\n`);
  } catch (e) {
    console.error('Erreur SSE (lecture Supabase) :', e);
  }
  clients.push(res);
  req.on('close', () => { clients = clients.filter(c => c !== res); });
});

// ---------- API tâches ----------
app.get('/api/tasks', async (req, res) => {
  try {
    res.json(await getTasks());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  const row = {
    priority: req.body.priority || 'À vérifier',
    category: req.body.category || 'Bureau',
    description: String(req.body.description || '').slice(0, 300),
    chantier: String(req.body.chantier || '').slice(0, 80),
    responsable: String(req.body.responsable || '').slice(0, 80),
    echeance: String(req.body.echeance || '').slice(0, 40),
    done: false,
    source: req.body.source || 'manuel',
    created_at: Date.now()
  };
  const { data, error } = await supabase.from(SUPABASE_TABLE).insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await broadcast();
  res.status(201).json(toApiTask(data));
});

app.put('/api/tasks/:id', async (req, res) => {
  const { id, createdAt, ...patch } = req.body;
  const { data, error } = await supabase.from(SUPABASE_TABLE).update(patch).eq('id', req.params.id).select().single();
  if (error) {
    const notFound = error.code === 'PGRST116';
    return res.status(notFound ? 404 : 500).json({ error: notFound ? 'Tâche introuvable' : error.message });
  }
  await broadcast();
  res.json(toApiTask(data));
});

app.delete('/api/tasks/:id', async (req, res) => {
  const { error } = await supabase.from(SUPABASE_TABLE).delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await broadcast();
  res.status(204).end();
});

app.post('/api/tasks/clear-done', async (req, res) => {
  const { error } = await supabase.from(SUPABASE_TABLE).delete().eq('done', true);
  if (error) return res.status(500).json({ error: error.message });
  try {
    const tasks = await getTasks();
    await broadcast();
    res.json(tasks);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Référentiels (repris du prompt Plaud) ----------
const PERSONNES = [
  "Boris GARROT","Clément LAROCHE","Antoine CHANTEGRET","Pierre Louis ALLO","Alain BUISSON",
  "Thierry AUJOGUE","François MERCIER","Syamak AZADEH","Cathy GOUTAL","Melissa ORLA","Adam BRAUX",
  "Gaël ALESSANDRI","Lionel SELLIER","Stéphane ABAD","Thomas FERRER",
  "Axel LEMOINE","Cédric MARCHAL","Rory BOULIC","Ken SCHOEN","Eddy LORENC","Mickael ORAND",
  "Christophe ARNAUD","Clément MOREL","Bruno LUKASZEWSKI","Damien RICHY","Marc RAMBAUD",
  "Luis ANTUNES DA COSTA","Sdiri BELGACEM","Noah VITTU","Hafedh GUEZGUEZ","Victor MONTANELI","Aurélien COLAS",
  "Simon BERLINE","Noé BONNIN","Mohammed MARHOUCHE","Alex ROBIATI","Emmanuel RANAIVO","Laurent PIERROT",
  "Saïd MOUHAJAR","Noé MENZEL","Hamza MARHOUCHE","Stéphane AUGUSTE","Brandon FERREIRA",
  "Lassad BEN MUSTAPHA","Shun VIAN","Enzo PIEDCOQ","Lenny AUBERT","Mickael ROMANO","Michel MOLINENGO",
  "Ethan GROLLINGER","Philippe BERCY"
];
const CHANTIERS = [
  "Ephrussi / Villa Ephrussi / Rothschild","Cabrières / école des Cabrières / Mougins","Le Plan de la Tour",
  "Génoise du Plan de la Tour","Charpente du Plan de la Tour","Couverture du Plan de la Tour",
  "Château Reva / Bastide Château Reva","Les Remparts","SCI Strangle","Bolzon / Parcs de Saint-Tropez",
  "Domaine de l'Île","Domaine à Pégomas / Chanel","Domaine de Pibonson","Domaine L'Anglade","Domaine de Bonfin",
  "Domaine Louise","Domaine du Figuier","Domaine St Maurin","Domaine de Fontainebleau","Domaine Les Camelins",
  "Domaine du Vallon des Bouis","Mas de Noailles","Mas à Gigaro","Villa Les Palombières","Villa Avalon",
  "Villa Bon Puits","Villa SIRI","SCI Diane","SCI Maren","SCI Valfere / Matton","SCI Les Cavanilles",
  "SCI Letilouthel","SCI La Rose","SCI Fonta","SCI Apollo","SCI Nouvelle Caraïbe","SCI Etoile","Les Vanades",
  "Haras de Saint-Julien","Terrain Vidauban","SOFOVAR","Les Forgerons Réunis","Salle polyvalente de Gonfaron",
  "Charpente Gonfaron","Couverture Gonfaron","Bagnols-en-Forêt / centre de loisirs",
  "Complexe sportif des Colettes / Draguignan","Salle des Archers / Le Muy","Moulin Saint-Roch / Grimaud",
  "École Les 3 Sources / La Garde-Freinet","Gymnase du Luc","Margueron / Gymnase du Luc",
  "Parking Val d'Azur / Le Cannet","Collobrières salle polyvalente","Les Adrets / bâtiment sportif et associatif",
  "Cinéma Renaissance / Saint-Tropez","JDGA Saint-Tropez","La Réserve / Villa 3","Cap Tahiti","Vieux bois / Basso",
  "La Bargemone / Commanderie Bargemone","La Baume","La Baume 1D Fermettes","La Baume 1A Tradi",
  "La Baume Salle Polyvalente","Groupe scolaire de la Sainte-Baume à Fréjus","Vigna / pose des solives",
  "Gymnase de Vallauris","Hallerberg","SCI La Vie en Rose","SCI Brise","SCI Apache","Notlim / Carport Douglas",
  "Stellbell","Food Dream Capital","Maxime Invest","Flo / carport Flo","Baron","Pool House Baron","Ghrenassia",
  "Asset Holder","Avenue Maréchal Foch","Mourot Alexis","Boulangerie Ramatuelle","Mr Voigt / fermettes isolation",
  "Lilounelle / Layani"
];
app.get('/api/referentiels', (req, res) => {
  res.json({ personnes: PERSONNES, chantiers: CHANTIERS });
});

// ---------- Import IA d'un compte rendu ----------
function buildPrompt() {
  return `Ce document est un compte rendu de réunion de planning hebdomadaire chez CHV — Les Charpentiers du Haut Var (charpente, couverture, zinguerie, atelier bois, taille K2). Il a été généré par une IA (Plaud) à partir d'un prompt qui structure toujours le compte rendu de la même façon, avec entre autres une section "11. Liste complète des actions à faire" sous forme de tableau (colonnes : Priorité, Action, Chantier/sujet, Responsable, Échéance, Commentaire).

Les noms de personnes et de chantiers dans ce document ont déjà été normalisés selon les référentiels CHV suivants :

RÉFÉRENTIEL PERSONNES : ${PERSONNES.join(', ')}

RÉFÉRENTIEL CHANTIERS : ${CHANTIERS.join(', ')}

CONSIGNE PRINCIPALE : utilise la section "11. Liste complète des actions à faire" comme source principale et la plus fiable. Complète avec des tâches importantes présentes ailleurs (sections par chantier, blocages) si elles n'apparaissent pas déjà dans cette liste. Si le document indique "non précisé" ou "non précisée" pour un champ, laisse ce champ vide dans ta réponse.

Pour chaque tâche, fournis :
- "d" : description courte et actionnable (15 mots maximum), sans répéter le nom du chantier
- "p" : exactement l'une de "Urgent", "Important", "Normal", "À vérifier" (reprends la priorité indiquée dans le tableau du document)
- "c" : exactement l'une de "Atelier", "Étude", "Commande/Matériel", "Livraison", "Grue/Levage", "Bureau"
- "ch" : reprends EXACTEMENT l'une des chaînes du RÉFÉRENTIEL CHANTIERS si le chantier y correspond ; sinon recopie le nom tel qu'indiqué ; chaîne vide si non précisé
- "e" : échéance telle qu'indiquée (ex. "2026-07-20", "Immédiate"), chaîne vide si non précisée
- "r" : reprends EXACTEMENT l'une des chaînes du RÉFÉRENTIEL PERSONNES (nom complet) si le responsable y correspond ; sinon chaîne vide

Ignore le bavardage sans action concrète. Ne fabrique aucune tâche qui ne soit pas clairement mentionnée dans le document.

Réponds UNIQUEMENT avec un tableau JSON valide (clés d/p/c/ch/e/r), sans texte avant ni après, sans balises markdown. Maximum ${MAX_TASKS_PER_IMPORT} tâches : priorise les "Urgent" puis les "Important" les plus critiques si le document en contient davantage.`;
}

function cleanField(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^non précisé/i.test(s)) return '';
  return s.slice(0, 80);
}

app.post('/api/extract', upload.single('file'), async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Clé API Anthropic non configurée côté serveur (variable ANTHROPIC_API_KEY manquante)." });
  }
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

  try {
    const isPdf = req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf');
    let content;
    if (isPdf) {
      const base64 = req.file.buffer.toString('base64');
      content = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: buildPrompt() }
      ];
    } else {
      const text = req.file.buffer.toString('utf8');
      content = buildPrompt() + '\n\n--- COMPTE RENDU ---\n' + text;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Appel API Anthropic échoué (${response.status}) : ${errText.slice(0, 300)}` });
    }
    const anthropicData = await response.json();
    const text = (anthropicData.content || []).map(b => b.text || '').join('\n');
    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    const jsonStr = match ? match[0] : clean;

    let extracted;
    try {
      extracted = JSON.parse(jsonStr);
    } catch (e) {
      // réparation si la réponse a été coupée
      let candidate = jsonStr.trim();
      const lastBrace = candidate.lastIndexOf('}');
      if (lastBrace === -1) throw new Error("Réponse de l'IA illisible");
      candidate = candidate.slice(0, lastBrace + 1) + ']';
      extracted = JSON.parse(candidate);
    }
    if (!Array.isArray(extracted)) throw new Error('Réponse inattendue de l\'IA');

    const rows = extracted.map(t => ({
      priority: ['Urgent', 'Important', 'Normal', 'À vérifier'].includes(t.p) ? t.p : 'À vérifier',
      category: ['Atelier', 'Étude', 'Commande/Matériel', 'Livraison', 'Grue/Levage', 'Bureau'].includes(t.c) ? t.c : 'Bureau',
      description: String(t.d || '').slice(0, 300),
      chantier: cleanField(t.ch),
      responsable: cleanField(t.r),
      echeance: cleanField(t.e),
      done: false,
      source: req.file.originalname,
      created_at: Date.now()
    }));
    const { data, error } = await supabase.from(SUPABASE_TABLE).insert(rows).select();
    if (error) throw error;
    await broadcast();
    res.json({ added: data.length, tasks: data.map(toApiTask) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Planning des tâches CHV — serveur démarré sur http://localhost:${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn("⚠️  ANTHROPIC_API_KEY n'est pas définie : l'import automatique de comptes rendus ne fonctionnera pas tant qu'elle n'est pas configurée.");
  }
});
