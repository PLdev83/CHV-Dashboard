const CATS = {
  "Atelier":            {color:"var(--cat-atelier)",   icon:"🪚"},
  "Étude":               {color:"var(--cat-etude)",     icon:"✏️"},
  "Commande/Matériel":  {color:"var(--cat-commande)",  icon:"📦"},
  "Livraison":          {color:"var(--cat-livraison)", icon:"🚚"},
  "Grue/Levage":        {color:"var(--cat-grue)",      icon:"🏗️"},
  "Bureau":             {color:"var(--cat-bureau)",    icon:"📋"}
};
const PRIORITIES = ["Urgent","Important","Normal","À vérifier"];
const PRIO_COLOR = {"Urgent":"var(--urgent)","Important":"var(--important)","Normal":"var(--normal)","À vérifier":"var(--tocheck)"};
const PRIO_RANK = {"Urgent":0,"Important":1,"Normal":2,"À vérifier":3};

let activeFilters = new Set(Object.keys(CATS));
let currentView = 'priority';
let editingId = null;
let tasks = [];
let PERSONNES = [];
let CHANTIERS = [];
let focusPerson = null;

// Vue focus : regroupe toujours par priorité, sans jamais modifier currentView
// ni activeFilters, pour que "◀ Retour" restaure exactement l'état précédent.
function effectiveView(){ return focusPerson ? 'priority' : currentView; }
function enterFocus(name){
  const n = (name || '').trim();
  if(!n) return;
  focusPerson = n;
  render();
}
function exitFocus(){
  focusPerson = null;
  render();
}

// ---------- Ordre des colonnes (préférence locale au navigateur) ----------
function columnOrderKey(view){ return 'chv-column-order-' + view; }
function getColumnOrder(view){
  try{
    const raw = localStorage.getItem(columnOrderKey(view));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch(e){ return []; }
}
function setColumnOrder(view, order){
  try{ localStorage.setItem(columnOrderKey(view), JSON.stringify(order)); }catch(e){}
}
function applyColumnOrder(view, groups){
  const order = getColumnOrder(view);
  if(!order.length) return groups;
  const byKey = new Map(groups.map(g=>[g.key, g]));
  const ordered = [];
  order.forEach(k=>{
    if(byKey.has(k)){ ordered.push(byKey.get(k)); byKey.delete(k); }
  });
  groups.forEach(g=>{ if(byKey.has(g.key)) ordered.push(g); });
  return ordered;
}
function reorderColumns(view, currentKeys, draggedKey, targetKey){
  if(draggedKey === targetKey) return;
  const newOrder = currentKeys.filter(k=>k!==draggedKey);
  const idx = newOrder.indexOf(targetKey);
  if(idx === -1) return;
  newOrder.splice(idx, 0, draggedKey);
  setColumnOrder(view, newOrder);
  render();
}

function setStatus(msg, isError=false, isOk=false){
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = isError ? 'error' : (isOk ? 'ok' : '');
}

// ---------- Annulation (Ctrl+Z) ----------
// Historique en mémoire seulement (perdu au rechargement), propre à ce navigateur :
// pas de localStorage, pas de synchronisation entre postes.
const MAX_HISTORY = 15;
let actionHistory = [];
function truncateLabel(s, n=40){
  s = String(s||'');
  return s.length > n ? s.slice(0, n-1) + '…' : s;
}
function recordAction(label, undo){
  actionHistory.push({ label, undo });
  if(actionHistory.length > MAX_HISTORY) actionHistory.shift();
}
// Variantes qui lèvent une erreur si la requête échoue, utilisées uniquement par les
// annulations : on veut savoir si l'inverse a vraiment fonctionné (ex. 404 si la tâche
// a changé entre-temps), contrairement aux actions normales de l'appli qui n'y regardent pas.
async function apiDeleteTaskChecked(id){
  const r = await fetch('/api/tasks/' + id, { method:'DELETE' });
  if(!r.ok) throw new Error('Échec de la suppression (id ' + id + ')');
}
async function apiUpdateTaskChecked(id, patch){
  const r = await fetch('/api/tasks/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) });
  if(!r.ok) throw new Error('Échec de la modification (id ' + id + ')');
  return r.json();
}
async function apiAddTaskChecked(task){
  const r = await fetch('/api/tasks', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(task) });
  if(!r.ok) throw new Error('Échec de la création');
  return r.json();
}
async function undoLastAction(){
  const action = actionHistory.pop();
  if(!action) return;
  try{
    await action.undo();
    setStatus('Action annulée : ' + action.label, false, true);
  }catch(err){
    console.error('Annulation impossible', err);
    setStatus("Impossible d'annuler : cette tâche a changé depuis.", true);
  }
}
document.addEventListener('keydown', (e)=>{
  const key = e.key.toLowerCase();
  if(!(e.ctrlKey || e.metaKey) || key !== 'z' || e.shiftKey) return;
  const target = e.target;
  const isEditableField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  if(isEditableField) return; // laisse l'undo natif du navigateur agir dans le champ
  e.preventDefault();
  undoLastAction();
});

// ---------- API ----------
async function apiGetTasks(){
  const r = await fetch('/api/tasks');
  return r.json();
}
async function apiAddTask(task){
  const r = await fetch('/api/tasks', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(task) });
  return r.json();
}
async function apiUpdateTask(id, patch){
  const r = await fetch('/api/tasks/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) });
  return r.json();
}
async function apiDeleteTask(id){
  await fetch('/api/tasks/' + id, { method:'DELETE' });
}
async function apiClearDone(){
  const r = await fetch('/api/tasks/clear-done', { method:'POST' });
  return r.json();
}
async function apiGetReferentiels(){
  const r = await fetch('/api/referentiels');
  return r.json();
}

// ---------- Temps réel ----------
function connectStream(){
  const es = new EventSource('/api/stream');
  const dot = document.getElementById('liveIndicator');
  es.onopen = ()=> dot.classList.remove('off');
  es.onerror = ()=> dot.classList.add('off');
  es.onmessage = (e)=>{
    try{
      tasks = JSON.parse(e.data);
      render();
    }catch(err){ console.error('Flux temps réel illisible', err); }
  };
}

function uid(){ return 't-' + Date.now() + '-' + Math.random().toString(36).slice(2,8); }

function dateSortKey(echeance){
  if(!echeance) return Infinity;
  const s = echeance.toLowerCase();
  if(s.includes('immédiat') || s.includes('immediate')) return -1;
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(iso) return new Date(iso[0]).getTime();
  const fr = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(fr) return new Date(`${fr[3]}-${fr[2]}-${fr[1]}`).getTime();
  return Infinity - 1;
}
function taskComparator(a,b){
  return (PRIO_RANK[a.priority]??9) - (PRIO_RANK[b.priority]??9) || dateSortKey(a.echeance) - dateSortKey(b.echeance);
}

function groupTasks(view, visibleTasks){
  if(view === 'priority'){
    return PRIORITIES.map(p=>({
      key:p, label:p, accent:PRIO_COLOR[p],
      tasks: visibleTasks.filter(t=>t.priority===p).sort((a,b)=>dateSortKey(a.echeance)-dateSortKey(b.echeance))
    }));
  }
  const field = view === 'person' ? 'responsable' : 'chantier';
  const fallback = view === 'person' ? 'Non assigné' : 'Sans chantier';
  const map = {};
  visibleTasks.forEach(t=>{
    const key = (t[field] && t[field].trim()) ? t[field].trim() : fallback;
    (map[key] = map[key] || []).push(t);
  });
  const keys = Object.keys(map).sort((a,b)=>{
    if(a===fallback) return 1;
    if(b===fallback) return -1;
    return a.localeCompare(b,'fr');
  });
  return keys.map(k=>({ key:k, label:k, accent:null, tasks: map[k].sort(taskComparator) }));
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function buildOptions(list, current, noneLabel){
  const opts = [`<option value="">${escapeHtml(noneLabel)}</option>`];
  const all = [...list];
  if(current && !all.includes(current)) all.push(current);
  all.sort((a,b)=>a.localeCompare(b,'fr'));
  all.forEach(v=>{
    opts.push(`<option value="${escapeHtml(v)}" ${v===current?'selected':''}>${escapeHtml(v)}</option>`);
  });
  return opts.join('');
}

function renderFocusHeader(){
  const viewSwitchEl = document.getElementById('viewSwitch');
  let focusHeaderEl = document.getElementById('focusHeader');
  viewSwitchEl.style.display = focusPerson ? 'none' : '';
  if(!focusPerson){
    if(focusHeaderEl) focusHeaderEl.remove();
    return;
  }
  if(!focusHeaderEl){
    focusHeaderEl = document.createElement('div');
    focusHeaderEl.id = 'focusHeader';
    focusHeaderEl.className = 'focus-header';
    document.getElementById('board').before(focusHeaderEl);
  }
  focusHeaderEl.innerHTML = '';
  const backBtn = document.createElement('button');
  backBtn.className = 'btn ghost';
  backBtn.textContent = '◀ Retour';
  backBtn.onclick = exitFocus;
  const title = document.createElement('h2');
  title.textContent = 'Tâches de ' + focusPerson;
  focusHeaderEl.appendChild(backBtn);
  focusHeaderEl.appendChild(title);
}

function render(){
  renderFocusHeader();
  const view = effectiveView();
  const board = document.getElementById('board');
  board.className = 'board' + (view==='priority' ? ' priority-view' : '');
  board.innerHTML = '';

  const visibleTasks = tasks.filter(t=>activeFilters.has(t.category) && (!focusPerson || (t.responsable||'').trim()===focusPerson));
  let groups = groupTasks(view, visibleTasks);
  groups = applyColumnOrder(view, groups);

  groups.forEach(g=>{
    const col = document.createElement('div');
    col.className = 'col';

    const head = document.createElement('div');
    head.className = 'col-head';
    if(g.accent) head.style.setProperty('--pcolor', g.accent);
    head.innerHTML = `<div class="label">${escapeHtml(g.label)}</div><div class="count">${g.tasks.length} tâche${g.tasks.length>1?'s':''}</div>`;
    col.appendChild(head);

    // Glisser-déposer de la colonne entière pour réordonner l'affichage
    // (préférence locale, distincte du drag des cartes via un type dataTransfer différent).
    head.draggable = true;
    head.addEventListener('dragstart', (e)=>{
      e.dataTransfer.setData('application/x-column-key', g.key);
      e.dataTransfer.effectAllowed = 'move';
      col.classList.add('col-dragging');
    });
    head.addEventListener('dragend', ()=> col.classList.remove('col-dragging'));
    head.addEventListener('dragover', (e)=>{
      if(!e.dataTransfer.types.includes('application/x-column-key')) return;
      e.preventDefault();
      head.classList.add('col-drop-target');
    });
    head.addEventListener('dragleave', ()=> head.classList.remove('col-drop-target'));
    head.addEventListener('drop', (e)=>{
      if(!e.dataTransfer.types.includes('application/x-column-key')) return;
      e.preventDefault();
      head.classList.remove('col-drop-target');
      const draggedKey = e.dataTransfer.getData('application/x-column-key');
      if(!draggedKey) return;
      reorderColumns(view, groups.map(x=>x.key), draggedKey, g.key);
    });

    // En vue "Par personne", le titre de colonne ouvre la vue focus sur cette personne
    // (le groupe "Non assigné" n'est pas une vraie personne, donc pas cliquable).
    if(view === 'person' && g.key !== 'Non assigné'){
      const labelEl = head.querySelector('.label');
      labelEl.classList.add('clickable-title');
      labelEl.title = 'Voir les tâches de ' + g.label;
      labelEl.addEventListener('click', (e)=>{ e.stopPropagation(); enterFocus(g.key); });
    }

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'cards';
    if(g.tasks.length===0){
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = 'Rien ici pour le moment.';
      cardsWrap.appendChild(hint);
    }
    g.tasks.forEach(t=> cardsWrap.appendChild(renderCard(t)));
    col.appendChild(cardsWrap);

    cardsWrap.addEventListener('dragover', (e)=>{ e.preventDefault(); cardsWrap.classList.add('drag-over'); });
    cardsWrap.addEventListener('dragleave', ()=> cardsWrap.classList.remove('drag-over'));
    cardsWrap.addEventListener('drop', async (e)=>{
      e.preventDefault();
      cardsWrap.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const t = tasks.find(x=>x.id===taskId);
      if(!t) return;
      const fallback = view==='person' ? 'Non assigné' : view==='chantier' ? 'Sans chantier' : null;
      const value = (fallback && g.key===fallback) ? '' : g.key;
      const field = view==='priority' ? 'priority' : view==='person' ? 'responsable' : 'chantier';
      const before = t[field];
      await apiUpdateTask(t.id, { [field]: value });
      const fieldLabel = field==='priority' ? 'priorité' : field==='responsable' ? 'responsable' : 'chantier';
      recordAction(`changement de ${fieldLabel} : « ${truncateLabel(t.description)} »`, async ()=>{
        await apiUpdateTaskChecked(t.id, { [field]: before });
      });
    });

    const addRow = document.createElement('div');
    addRow.className = 'add-row';
    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.textContent = '+ ajouter une tâche';
    addBtn.onclick = ()=> showAddForm(addRow, addBtn, g.key);
    addRow.appendChild(addBtn);
    col.appendChild(addRow);

    board.appendChild(col);
  });

  const total = tasks.length;
  const done = tasks.filter(t=>t.done).length;
  document.getElementById('taskCount').textContent = total ? `${done} / ${total} tâches terminées` : 'Aucune tâche pour le moment — importe un compte rendu pour commencer.';
}

function renderEditCard(t){
  const card = document.createElement('div');
  card.className = 'card edit-mode';
  card.style.setProperty('--cat-color', CATS[t.category]?.color || 'var(--muted)');

  const wrap = document.createElement('div');
  wrap.className = 'body';
  wrap.innerHTML = `
    <textarea class="editDesc">${escapeHtml(t.description)}</textarea>
    <div class="row">
      <select class="editCat">${Object.keys(CATS).map(c=>`<option value="${c}" ${c===t.category?'selected':''}>${CATS[c].icon} ${c}</option>`).join('')}</select>
      <select class="editPrio">${PRIORITIES.map(p=>`<option value="${p}" ${p===t.priority?'selected':''}>${p}</option>`).join('')}</select>
    </div>
    <div class="row">
      <select class="editChantier">${buildOptions(CHANTIERS, t.chantier, 'Sans chantier')}</select>
      <select class="editResp">${buildOptions(PERSONNES, t.responsable, 'Non assigné')}</select>
    </div>
    <input type="text" class="editEch" placeholder="Échéance" value="${escapeHtml(t.echeance)}" style="margin-top:6px; width:100%;" />
    <div class="row">
      <button class="btn primary editSave" type="button">Enregistrer</button>
      <button class="btn ghost editCancel" type="button">Annuler</button>
    </div>
  `;
  card.appendChild(wrap);

  wrap.querySelector('.editSave').onclick = async ()=>{
    const patch = {
      description: wrap.querySelector('.editDesc').value.trim() || t.description,
      category: wrap.querySelector('.editCat').value,
      priority: wrap.querySelector('.editPrio').value,
      chantier: wrap.querySelector('.editChantier').value.trim(),
      responsable: wrap.querySelector('.editResp').value.trim(),
      echeance: wrap.querySelector('.editEch').value.trim()
    };
    const before = {
      description: t.description, category: t.category, priority: t.priority,
      chantier: t.chantier, responsable: t.responsable, echeance: t.echeance
    };
    editingId = null;
    await apiUpdateTask(t.id, patch);
    recordAction(`modification : « ${truncateLabel(before.description)} »`, async ()=>{
      await apiUpdateTaskChecked(t.id, before);
    });
  };
  wrap.querySelector('.editCancel').onclick = ()=>{ editingId = null; render(); };

  return card;
}

function renderCard(t){
  if(editingId === t.id) return renderEditCard(t);

  const card = document.createElement('div');
  card.className = 'card' + (t.done ? ' done' : '');
  card.style.setProperty('--cat-color', CATS[t.category]?.color || 'var(--muted)');
  card.draggable = true;
  card.addEventListener('dragstart', (e)=>{
    e.dataTransfer.setData('text/plain', t.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', ()=> card.classList.remove('dragging'));

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!t.done;
  cb.onchange = async ()=>{
    const wasDone = t.done;
    await apiUpdateTask(t.id, { done: cb.checked });
    recordAction(`${cb.checked ? 'tâche cochée' : 'tâche décochée'} : « ${truncateLabel(t.description)} »`, async ()=>{
      await apiUpdateTaskChecked(t.id, { done: wasDone });
    });
  };

  const body = document.createElement('div');
  body.className = 'body';
  body.title = 'Cliquer pour modifier';
  body.addEventListener('click', ()=>{ editingId = t.id; render(); });

  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = t.description;
  body.appendChild(desc);

  const meta = document.createElement('div');
  meta.className = 'meta';
  if(effectiveView() !== 'priority'){
    const pTag = document.createElement('span');
    pTag.className = 'tag';
    pTag.textContent = t.priority;
    meta.appendChild(pTag);
  }
  const catTag = document.createElement('span');
  catTag.className = 'tag';
  catTag.textContent = (CATS[t.category]?.icon || '•') + ' ' + t.category;
  meta.appendChild(catTag);
  if(t.echeance){
    const dTag = document.createElement('span');
    dTag.className = 'tag date';
    dTag.textContent = '📅 ' + t.echeance;
    meta.appendChild(dTag);
  }
  if(effectiveView() !== 'chantier' && t.chantier){
    const cTag = document.createElement('span');
    cTag.className = 'tag';
    cTag.textContent = t.chantier;
    meta.appendChild(cTag);
  }
  if(effectiveView() !== 'person' && t.responsable){
    const rTag = document.createElement('span');
    rTag.className = 'tag clickable';
    rTag.textContent = '👤 ' + t.responsable;
    rTag.title = 'Voir les tâches de ' + t.responsable;
    rTag.onclick = (e)=>{ e.stopPropagation(); enterFocus(t.responsable); };
    meta.appendChild(rTag);
  }
  body.appendChild(meta);

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '✕';
  del.title = 'Supprimer';
  del.onclick = async (e)=>{
    e.stopPropagation();
    await apiDeleteTask(t.id);
    recordAction(`suppression : « ${truncateLabel(t.description)} »`, async ()=>{
      const recreated = await apiAddTaskChecked({
        priority: t.priority, category: t.category, description: t.description,
        chantier: t.chantier, responsable: t.responsable, echeance: t.echeance, source: t.source
      });
      if(t.done) await apiUpdateTaskChecked(recreated.id, { done: true });
    });
  };

  card.appendChild(cb);
  card.appendChild(body);
  card.appendChild(del);
  return card;
}

function showAddForm(container, addBtn, groupKey){
  addBtn.style.display = 'none';
  const showPriority = effectiveView() !== 'priority';
  const showChantier = effectiveView() !== 'chantier';
  const showResponsable = effectiveView() !== 'person';

  const form = document.createElement('div');
  form.className = 'add-form';
  form.innerHTML = `
    <textarea placeholder="Décrire la tâche..."></textarea>
    <select class="catSel">${Object.keys(CATS).map(c=>`<option value="${c}">${CATS[c].icon} ${c}</option>`).join('')}</select>
    ${showPriority ? `<select class="prioSel">${PRIORITIES.map(p=>`<option value="${p}">${p}</option>`).join('')}</select>` : ''}
    ${showChantier ? `<select class="chantierInp">${buildOptions(CHANTIERS, '', 'Chantier (optionnel)')}</select>` : ''}
    ${showResponsable ? `<select class="respInp">${buildOptions(PERSONNES, '', 'Responsable (optionnel)')}</select>` : ''}
    <input type="text" class="echeanceInp" placeholder="Échéance, ex. 2026-07-20 (optionnel)" />
    <div class="row">
      <button class="btn primary" type="button">Ajouter</button>
      <button class="btn ghost" type="button">Annuler</button>
    </div>
  `;
  const textarea = form.querySelector('textarea');
  const catSel = form.querySelector('.catSel');
  const prioSel = form.querySelector('.prioSel');
  const chantierInp = form.querySelector('.chantierInp');
  const respInp = form.querySelector('.respInp');
  const echeanceInp = form.querySelector('.echeanceInp');
  const [okBtn, cancelBtn] = form.querySelectorAll('.row button');

  okBtn.onclick = async ()=>{
    const val = textarea.value.trim();
    if(!val) return;
    const created = await apiAddTask({
      priority: showPriority ? prioSel.value : groupKey,
      category: catSel.value,
      description: val,
      chantier: showChantier ? (chantierInp?.value.trim() || '') : groupKey,
      responsable: showResponsable ? (respInp?.value.trim() || '') : groupKey,
      echeance: echeanceInp.value.trim(),
      source: 'manuel'
    });
    recordAction(`création : « ${truncateLabel(val)} »`, async ()=>{
      await apiDeleteTaskChecked(created.id);
    });
  };
  cancelBtn.onclick = ()=>{ form.remove(); addBtn.style.display = 'block'; };
  container.insertBefore(form, addBtn);
}

document.getElementById('viewSwitch').addEventListener('click', (e)=>{
  const btn = e.target.closest('.view-btn');
  if(!btn) return;
  currentView = btn.dataset.view;
  document.querySelectorAll('.view-btn').forEach(b=>b.classList.toggle('active', b===btn));
  render();
});

document.getElementById('pegboard').addEventListener('click', (e)=>{
  const tag = e.target.closest('.peg-tag');
  if(!tag) return;
  const cat = tag.dataset.cat;
  if(activeFilters.has(cat)){ activeFilters.delete(cat); tag.classList.add('off'); }
  else{ activeFilters.add(cat); tag.classList.remove('off'); }
  render();
});

document.getElementById('clearDoneBtn').onclick = ()=> apiClearDone();

const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
uploadBtn.onclick = ()=> fileInput.click();

fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files[0];
  if(!file) return;
  uploadBtn.disabled = true;
  setStatus('Analyse du compte rendu « ' + file.name + ' »...');
  try{
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/extract', { method:'POST', body: fd });
    const data = await r.json();
    if(!r.ok) throw new Error(data.error || 'Erreur inconnue');
    if(data.added === 0) setStatus('Aucune tâche détectée dans ce document.', true);
    else{
      setStatus(`${data.added} tâche(s) importée(s) depuis « ${file.name} ».`, false, true);
      const importedIds = (data.tasks || []).map(x=>x.id);
      recordAction(`import « ${file.name} » (${data.added} tâche${data.added>1?'s':''})`, async ()=>{
        for(const id of importedIds){ await apiDeleteTaskChecked(id); }
      });
    }
  }catch(err){
    console.error(err);
    setStatus('Erreur pendant l\'extraction : ' + (err.message || err), true);
  }finally{
    uploadBtn.disabled = false;
    fileInput.value = '';
  }
});

(async function init(){
  const ref = await apiGetReferentiels();
  PERSONNES = ref.personnes;
  CHANTIERS = ref.chantiers;
  tasks = await apiGetTasks();
  render();
  connectStream();
})();
