const STORAGE_KEY = 'oramed_depot_stock_v45_logo';
const ALL_TABS = [
  ['reception','Bon de réception'],
  ['sortie','Bon de sortie'],
  ['etat','État de stock'],
  ['synthese','Synthèse'],
  ['archives','Archives'],
  ['direction','Direction']
];
const APP_ROLE = (() => {
  const params = new URLSearchParams(window.location.search);
  const roleFromUrl = params.get('role');
  const roleFromStorage = localStorage.getItem('oramed_app_role');

  if (roleFromUrl === 'operateur' || roleFromUrl === 'direction') {
    localStorage.setItem('oramed_app_role', roleFromUrl);
    return roleFromUrl;
  }

  if (roleFromStorage === 'operateur' || roleFromStorage === 'direction') {
    return roleFromStorage;
  }

  return 'direction';
})();
const ROLE_TABS = {
  direction: ALL_TABS,
  operateur: ALL_TABS.filter(([k]) => k !== 'direction')
};
const directionTabs = [
  ['mouvements','Mouvements par référence'],
  ['referentiel','Base']
];


const SYNC_CONFIG_KEY = 'oramed_sync_config_v1';
const SYNC_MACHINE_ID_KEY = 'oramed_sync_machine_id_v1';
const REMOTE_TABLE = 'oramed_app_state';
const REMOTE_APP_ID = 'oramed-principal';
const REMOTE_POLL_INTERVAL = 1500;
const syncState = {
  config: loadSyncConfig(),
  machineId: getSyncMachineId(),
  isApplyingRemote: false,
  pollTimer: null,
  lastRemoteUpdatedAt: '',
  lastPushedHash: '',
  lastPulledHash: '',
  status: 'local',
  lastMessage: ''
};

function getSyncMachineId(){
  let id = localStorage.getItem(SYNC_MACHINE_ID_KEY);
  if(!id){
    id = 'machine_' + uid();
    localStorage.setItem(SYNC_MACHINE_ID_KEY, id);
  }
  return id;
}
function loadSyncConfig(){
  try{
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    return {
      enabled: !!cfg.enabled,
      url: String(cfg.url || '').trim().replace(/\/$/, ''),
      anonKey: String(cfg.anonKey || '').trim()
    };
  }catch(e){
    return { enabled:false, url:'', anonKey:'' };
  }
}
function saveSyncConfig(config){
  syncState.config = {
    enabled: !!config.enabled,
    url: String(config.url || '').trim().replace(/\/$/, ''),
    anonKey: String(config.anonKey || '').trim()
  };
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(syncState.config));
  updateSyncStatus(syncState.config.enabled ? 'ready' : 'local', syncState.config.enabled ? 'Base centrale configurée.' : 'Mode local seulement.');
}
function getSyncHeaders(extra={}){
  return {
    'Content-Type':'application/json',
    'apikey': syncState.config.anonKey,
    'Authorization': `Bearer ${syncState.config.anonKey}`,
    ...extra
  };
}
function getStateHash(payload){
  try{ return JSON.stringify(payload); }catch(e){ return String(Date.now()); }
}
function normalizeLoadedState(source){
  try{
    const s = source ? Object.assign(defaultState(), JSON.parse(JSON.stringify(source))) : defaultState();
    if(s.receptionDraft){
      if(s.receptionDraft.driver && !s.receptionDraft.transporteur) s.receptionDraft.transporteur = s.receptionDraft.driver;
      if(s.receptionDraft.plate && !s.receptionDraft.matricule) s.receptionDraft.matricule = s.receptionDraft.plate;
      delete s.receptionDraft.driver; delete s.receptionDraft.plate; delete s.receptionDraft.source; delete s.receptionDraft.observation;
      if(!('headerLock' in s.receptionDraft)) s.receptionDraft.headerLock = null;
      if(!('editingArchiveId' in s.receptionDraft)) s.receptionDraft.editingArchiveId = null;
      if(!('editingOriginal' in s.receptionDraft)) s.receptionDraft.editingOriginal = null;
    }
    if(s.sortieDraft){
      if(!('editingArchiveId' in s.sortieDraft)) s.sortieDraft.editingArchiveId = null;
      if(!('editingOriginal' in s.sortieDraft)) s.sortieDraft.editingOriginal = null;
    }
    if(['mouvements','referentiel'].includes(s.activeTab)){
      s.directionTab = s.activeTab;
      s.activeTab = 'direction';
    }
    if(!['mouvements','referentiel'].includes(s.directionTab)) s.directionTab = 'mouvements';
    if(!s.accordions || typeof s.accordions !== 'object') s.accordions = { baseRefForm:true, baseRefList:true, baseClientForm:true, baseClientList:true };
    s.refListSearch = s.refListSearch || '';
    s.clientListSearch = s.clientListSearch || '';
    if(!['day','month','quarter','year'].includes(s.synthesePeriod)) s.synthesePeriod = 'month';
    s.syntheseDay = s.syntheseDay || todayStr();
    s.syntheseMonth = s.syntheseMonth || todayStr().slice(0,7);
    s.syntheseQuarter = s.syntheseQuarter || `${new Date().getFullYear()}-T${Math.floor(new Date().getMonth()/3)+1}`;
    s.syntheseYear = s.syntheseYear || String(new Date().getFullYear());
    if(!['reception','sortie','etat','synthese','archives','direction'].includes(s.activeTab)) s.activeTab = 'reception';
    if(!isTabAllowed(s.activeTab)) s.activeTab = 'reception';
    (s.receptions||[]).forEach(doc => {
      if(doc.driver && !doc.transporteur) doc.transporteur = doc.driver;
      if(doc.plate && !doc.matricule) doc.matricule = doc.plate;
      delete doc.driver; delete doc.plate; delete doc.source; delete doc.observation;
      if(!doc.createdAt) doc.createdAt = doc.date ? `${doc.date}T00:00:00` : new Date().toISOString();
      if(!doc.sequence) doc.sequence = numberToSeq(doc.number, 'BR');
    });
    (s.sorties||[]).forEach(doc => {
      if(!doc.createdAt) doc.createdAt = doc.date ? `${doc.date}T00:00:00` : new Date().toISOString();
      if(!doc.sequence) doc.sequence = numberToSeq(doc.number, 'BS');
    });
    if(!s.transporters || typeof s.transporters !== 'object'){
      s.transporters = JSON.parse(JSON.stringify(DEFAULT_TRANSPORTERS));
    }else{
      s.transporters.camion_oramed = Array.isArray(s.transporters.camion_oramed) ? s.transporters.camion_oramed : JSON.parse(JSON.stringify(DEFAULT_TRANSPORTERS.camion_oramed));
      s.transporters.orabtrans = JSON.parse(JSON.stringify(DEFAULT_TRANSPORTERS.orabtrans));
    }
    return s;
  }catch(e){ return defaultState(); }
}
function updateSyncStatus(status, message=''){
  syncState.status = status;
  syncState.lastMessage = message || syncState.lastMessage || '';
  const badge = document.getElementById('syncStatusBadge');
  if(badge){
    const active = ['ready','syncing','online'].includes(status);
    badge.className = `sync-badge ${active ? '' : 'off'}`.trim();
    badge.innerHTML = `<span class="sync-dot"></span><span>${active ? 'Base centrale active' : 'Mode local'}</span>`;
  }
  const info = document.getElementById('syncStatusText');
  if(info) info.textContent = syncState.lastMessage || (status === 'online' ? 'Synchronisation en cours.' : 'Aucune synchronisation distante.');
}
async function fetchRemoteEnvelope(){
  if(!syncState.config.enabled || !syncState.config.url || !syncState.config.anonKey) return null;
  const url = `${syncState.config.url}/rest/v1/${REMOTE_TABLE}?select=app_id,payload,updated_at,updated_by&app_id=eq.${encodeURIComponent(REMOTE_APP_ID)}`;
  const res = await fetch(url, { headers:getSyncHeaders() });
  if(!res.ok) throw new Error('Lecture distante impossible.');
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function pushRemoteState(reason='save'){
  if(!syncState.config.enabled || !syncState.config.url || !syncState.config.anonKey) return false;
  if(syncState.isApplyingRemote) return false;
  const payload = JSON.parse(JSON.stringify(state));
  const hash = getStateHash(payload);
  syncState.lastPushedHash = hash;
  updateSyncStatus('syncing', reason === 'setup' ? 'Connexion à la base centrale...' : 'Envoi des données vers la base centrale...');
  const url = `${syncState.config.url}/rest/v1/${REMOTE_TABLE}?on_conflict=app_id`;
  const body = [{ app_id: REMOTE_APP_ID, payload, updated_by: syncState.machineId }];
  const res = await fetch(url, {
    method:'POST',
    headers:getSyncHeaders({ 'Prefer':'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error('Écriture distante impossible.');
  const rows = await res.json();
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if(row?.updated_at) syncState.lastRemoteUpdatedAt = row.updated_at;
  updateSyncStatus('online', 'Base centrale synchronisée.');
  return true;
}
async function pullRemoteState(force=false){
  if(!syncState.config.enabled || !syncState.config.url || !syncState.config.anonKey) return false;
  const row = await fetchRemoteEnvelope();
  if(!row || !row.payload) return false;
  const incomingHash = getStateHash(row.payload);
  if(!force){
    if(syncState.lastPulledHash && incomingHash === syncState.lastPulledHash) return false;
    if(syncState.lastPushedHash && incomingHash === syncState.lastPushedHash) {
      syncState.lastPulledHash = incomingHash;
      if(row.updated_at) syncState.lastRemoteUpdatedAt = row.updated_at;
      return false;
    }
    if(syncState.lastRemoteUpdatedAt && row.updated_at && row.updated_at <= syncState.lastRemoteUpdatedAt) return false;
  }
  syncState.isApplyingRemote = true;
  try{
    state = normalizeLoadedState(row.payload);
    ensureSeedReferences();
    ensureDraftNumbers();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    syncState.lastRemoteUpdatedAt = row.updated_at || '';
    syncState.lastPulledHash = incomingHash;
    renderTabs();
    syncRoleBadge();
    renderActiveTab();
    updateSyncStatus('online', 'Données mises à jour depuis la base centrale.');
    return true;
  } finally {
    syncState.isApplyingRemote = false;
  }
}
async function initRemoteSync(){
  if(syncState.pollTimer){ clearInterval(syncState.pollTimer); syncState.pollTimer = null; }
  if(!syncState.config.enabled || !syncState.config.url || !syncState.config.anonKey){
    updateSyncStatus('local', 'Mode local seulement.');
    return;
  }
  try{
    const row = await fetchRemoteEnvelope();
    if(row && row.payload){
      await pullRemoteState(true);
    }else{
      await pushRemoteState('setup');
    }
    syncState.pollTimer = setInterval(() => {
      pullRemoteState(false).catch(err => updateSyncStatus('local', err.message || 'La synchro distante a été interrompue.'));
    }, REMOTE_POLL_INTERVAL);
  }catch(err){
    updateSyncStatus('local', err.message || 'Connexion à la base centrale impossible.');
  }
}
function saveSyncSettingsFromForm(){
  const url = document.getElementById('sync_url')?.value || '';
  const anonKey = document.getElementById('sync_key')?.value || '';
  const enabled = !!document.getElementById('sync_enabled')?.checked;
  saveSyncConfig({ enabled, url, anonKey });
  initRemoteSync();
  renderSyncSettings();
}
async function syncNow(){
  try{
    await pushRemoteState('manual');
    await pullRemoteState(true);
  }catch(err){
    updateSyncStatus('local', err.message || 'Synchronisation manuelle impossible.');
    alert(syncState.lastMessage);
  }
}
function renderSyncSettings(targetId='syncSettingsHost'){
  const host = document.getElementById(targetId);
  if(!host) return;
  const cfg = syncState.config;
  host.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div>
          <h3 class="section-title" style="margin:0">Base centralisée</h3>
          <div class="subtitle" style="margin:6px 0 0 0">Active la même base pour le poste opérateur et le poste direction, sans toucher à la logique des bons.</div>
        </div>
        <div id="syncStatusBadge" class="sync-badge off"><span class="sync-dot"></span><span>Mode local</span></div>
      </div>
      <div class="sync-grid">
        <div>
          <label>URL Supabase</label>
          <input id="sync_url" value="${esc(cfg.url)}" placeholder="https://xxxx.supabase.co">
        </div>
        <div>
          <label>Anon key</label>
          <input id="sync_key" value="${esc(cfg.anonKey)}" placeholder="Clé publique Supabase">
        </div>
      </div>
      <div class="sync-actions">
        <label style="display:flex;align-items:center;gap:10px;margin:0"><input id="sync_enabled" type="checkbox" ${cfg.enabled ? 'checked' : ''} style="width:auto"> Activer la base centrale</label>
        <button class="info" onclick="saveSyncSettingsFromForm()">Enregistrer la connexion</button>
        <button class="secondary" onclick="syncNow()">Synchroniser maintenant</button>
      </div>
      <div id="syncStatusText" class="role-note" style="margin-top:12px">Mode local seulement.</div>
      <div class="notice" style="margin-top:12px">Table attendue : <strong>${REMOTE_TABLE}</strong> avec les colonnes <strong>app_id</strong> (texte, clé unique), <strong>payload</strong> (jsonb), <strong>updated_at</strong> (timestamptz, défaut now()), <strong>updated_by</strong> (texte).</div>
    </div>`;
  updateSyncStatus(syncState.status, syncState.lastMessage || (cfg.enabled ? 'Base centrale configurée.' : 'Mode local seulement.'));
}

const todayStr = () => new Date().toISOString().slice(0,10);
const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
const round2 = n => Math.round((Number(n)||0)*100)/100;
const fmt = n => round2(n).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
const esc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const byDateDesc = (a,b) => String(b.date||'').localeCompare(String(a.date||''));

const FORMAT_OPTIONS = ['20x20','25x50','30x60','33x33','60x60','40x40','49x49','41x41','45x45','50x50','35x35','20x60'];
const BASE_SUPPLIER_OPTIONS = [
  {group:'Fournisseurs', value:'Super Cerame', label:'Super Cerame'},
  {group:'Fournisseurs', value:'Multicerame', label:'Multicerame'},
  {group:'Fournisseurs', value:'Facemag', label:'Facemag'}
];
const RECEPTION_SUPPLIER_OPTIONS = [
  {group:'Super Cerame', value:'SCC', label:'SCC'},
  {group:'Super Cerame', value:'SCB', label:'SCB'},
  {group:'Super Cerame', value:'SCK', label:'SCK'},
  {group:'Super Cerame', value:'SCT', label:'SCT'},
  {group:'Fournisseurs', value:'Multicerame', label:'Multicerame'},
  {group:'Fournisseurs', value:'Facemag', label:'Facemag'}
];

const PACKAGING_DEFAULTS = {
  'Super Cerame': {
    '20x20': { caissesParPalette:125 },
    '25x50': { caissesParPalette:64 },
    '30x60': { caissesParPalette:48 },
    '35x35': { caissesParPalette:72 },
    '41x41': { caissesParPalette:48 },
    '45x45': { caissesParPalette:64 },
    '50x50': { caissesParPalette:48 },
    '60x60': { caissesParPalette:36 },
    '20x60': { caissesParPalette:64 }
  },
  'Facemag': {
    '25x50': { caissesParPalette:60 },
    '30x60': { caissesParPalette:72 },
    '33x33': { caissesParPalette:60 },
    '40x40': { caissesParPalette:56 },
    '49x49': { caissesParPalette:72 },
    '60x60': { caissesParPalette:36 }
  },
  'Multicerame': {
    '25x50': { caissesParPalette:64 },
    '30x60': { caissesParPalette:60 },
    '60x60': { caissesParPalette:36 }
  }
};
function getPackagingDefaults(marque, format){
  return (PACKAGING_DEFAULTS[String(marque||'').trim()] || {})[String(format||'').trim()] || {};
}
function refreshReferencePackagingForm(){
  const marqueEl = document.getElementById('ref_marque');
  const formatEl = document.getElementById('ref_format');
  const caissesEl = document.getElementById('ref_caisses_palette');
  const m2El = document.getElementById('ref_m2');
  const m2PaletteEl = document.getElementById('ref_m2_palette');
  if(!marqueEl || !formatEl || !caissesEl || !m2El || !m2PaletteEl) return;
  if(!caissesEl.value){
    const defaults = getPackagingDefaults(marqueEl.value, formatEl.value);
    if(defaults.caissesParPalette) caissesEl.value = defaults.caissesParPalette;
  }
  const m2 = Number(m2El.value || 0);
  const caisses = Number(caissesEl.value || 0);
  m2PaletteEl.value = (m2 > 0 && caisses > 0) ? fmt(round2(m2 * caisses)) : '';
}

const TRANSPORTER_OPTIONS = [
  {value:'usine', label:'Usine'},
  {value:'camion_oramed', label:'Nos camions'},
  {value:'orabtrans', label:'ORABTRANS'}
];

const FACEMAG_REFERENCE_SEED = (() => {
  const groups = [
    { format:'25x50', m2:1.50, refs:['50000','50001','50176','50177','50585','50586','50587','50588','50589','50631','50632 s','50633 p','50960','50961','50962','50963','50964','50965','50966','51063','51064','51065','51066','51067','51068','51069','51098','51099','51100','51163','51164','51321','51322','51323','51324','51354','51358','51359','51360','51442','51443','51444','51467','51468','51469','51470','51471','51472','51473','51474','51475'] },
    { format:'30x60', m2:1.44, refs:['3000','3001','3002','3009','3080','3081','3082','3083','3089','3090','3115','3116','3117','3118','3119','3120','3146','3147','3150','3172','3173','3174','3175','3203','3205','3278','3279','3280','3289','3290','3291','3292','3293','3294','3295','3296','3380','3381','3382','3383','3384','3385','3386','3387','3388','3403','3404'] },
    { format:'33x33', m2:1.44, refs:['20954','21046','21071','21363','21371','21372','21348','21349','21365','21366','21367','21368'] },
    { format:'60x60', m2:1.44, refs:['6027','6110','6111','6112','6113','6120','6122','6123','6132','6135','6138','6105','6157','6158','6178','6168','6148','6175'] },
    { format:'40x40', m2:1.45, refs:['206','207','504','505','590','721','901','917','919','928','929','930','931','933','934','935','1018','1021','769'] },
    { format:'49x49', m2:1.44, refs:['15022','15026','15034','15035','15055','15097','15129','15165','15219','15228','15233','15237','15203'] }
  ];
  const rows = [];
  groups.forEach(group => {
    group.refs.forEach(ref => {
      ['1er choix','2eme choix'].forEach(choix => {
        rows.push({
          id: uid(),
          reference: `${ref} ${group.format} ${choix}`,
          designation:'',
          format: group.format,
          marque:'Facemag',
          choix,
          m2ParCaisse: group.m2,
          initialStock: 0,
          actif:true
        });
      });
    });
  });
  return rows;
})();

const SUPER_CERAME_REFERENCE_SEED = (() => {
  const groups = [
    { format:'41x41', m2:1.51, refs:['LUX','TADLA CREMA','82419','82080','82246','ALASKA GRIS C','AHLAN','CAMBRIDGE','EXCELL BG','EXCELL MAR','RIO MARRON','ALASKA GRIS F','80029','SANTIAGO BG','ALASKA BG','RIO GRIS','82454','82107','PERLATINO BG','ANGAD GRIS','82245','ANGAD BG C','ANGAD BG F','DIVA 100','DIVA 110','DIVA 130','DIVA 140','DIVA180 C','DIVA180 F','BORA GRIS','MEDZA 100','MEDZA 110','MEDZA 130','MEDZA 150','MEDZA 170','MEDZA 190','MEDZA 200','MEDZA 210'] },
    { format:'45x45', m2:1.42, refs:['DUSTY','LUXUM','45000','45048','45011','PURA BEIGE','ALBAY GRIS','CAROLINA BG','CHARQ GR','45020','45021','45023','45046','PARADOR','STANDFORD','LENS','ADIANA BEIGE','ADIANA GRIS'] },
    { format:'50x50', m2:1.50, refs:['LUX','107','100','AHLAN','MBAPE NOIR','CAPIO GRIS','VEINS','ALURA GRIS','ALURA BEIGE','ORIGAMA','ALASKA GRIS'] },
    { format:'35x35', m2:1.47, refs:['50014','50015','50017','35104','35104 N.M','35301','35482','35708','35708 N.M','35709','35709 N.M','35560','35561','35562','35563','35564','BORA GRIS','BORA BEIGE','BORA MARRON','MAKDO GRIS','BRICA SABLE'] },
    { format:'20x60', m2:1.44, refs:['WOOD IROCO','WOOD PERLA','WOOD GRIS','WOOD BEIGE','WOOD ROBLY','62035','62032','62037'] },
    { format:'60x60', m2:1.44, refs:['DUSTY','SAMAR BEIGE','VENO','SCARS','BASTI','BETTA','VEINS','MUNICH BEIGE','MUNICH GRIS','MUNICH BLANC'] }
  ];
  const rows = [];
  groups.forEach(group => {
    group.refs.forEach(ref => {
      ['1er choix','2eme choix'].forEach(choix => {
        rows.push({
          id: uid(),
          reference: `${ref} ${group.format} ${choix}`,
          designation:'',
          format: group.format,
          marque:'Super Cerame',
          choix,
          m2ParCaisse: group.m2,
          initialStock: 0,
          actif:true
        });
      });
    });
  });
  return rows;
})();

const SUPER_CERAME_EXTRA_REFERENCE_SEED = (() => {
  const rows = [];

  const addRow = (refName, format, choix, m2) => {
    rows.push({
      id: uid(),
      reference: `${refName} ${format} ${choix}`,
      designation:'',
      format,
      marque:'Super Cerame',
      choix,
      m2ParCaisse: m2,
      initialStock: 0,
      actif:true
    });
  };

  const refs30x60 = ['ACRUX','ARABICA','ARTICA','BREZILIA','BUDAPEST G.CL','CAPELLA','CLASSIO CREM','LUXIA','NIVIKA','ORCA','POLUX','ROMANO','SARGAS','SIBERIA','SOLITAIR0','STON 1','STON 2','STON 3','STON 4','VALENCIA','ALESSIA','MELISSA','VEGA','ORION','COMO','BERGAMO','BARI BLEU','BARI GOLD','SONATE PEARL','BELTON GRIS','ADANA 100','ADANA 110','ADANA 120','ADANA 130'];
  const refs25x50 = ['55714','55717','55718','55719','55720','55721','55722','55723','55724','55725','GLAM 1','GLAM 2'];
  const refs20x20 = ['BLANC'];

  refs30x60.forEach(ref => {
    ['1er choix','2eme choix'].forEach(choix => {
      addRow(ref, '30x60', choix, 1.44);
      addRow(`${ref} D-SDB`, '30x60', choix, 1.44);
      addRow(`${ref} D-CUISINE`, '30x60', choix, 1.44);
      addRow(`${ref} R1`, '30x60', choix, 1.44);
    });
  });

  refs25x50.forEach(ref => {
    ['1er choix','2eme choix'].forEach(choix => {
      addRow(ref, '25x50', choix, 1.50);
      addRow(`${ref} D-SDB`, '25x50', choix, 1.50);
      addRow(`${ref} D-CUISINE`, '25x50', choix, 1.50);
    });
  });

  refs20x20.forEach(ref => {
    ['1er choix','2eme choix'].forEach(choix => {
      addRow(ref, '20x20', choix, 1.00);
    });
  });

  return rows;
})();

const ALL_REFERENCE_SEEDS = [
  ...FACEMAG_REFERENCE_SEED,
  ...SUPER_CERAME_REFERENCE_SEED,
  ...SUPER_CERAME_EXTRA_REFERENCE_SEED
];

const DEFAULT_TRANSPORTERS = {
  camion_oramed: [
    { id:'1', driver:'Adil', plate:'51762-A-72' },
    { id:'2', driver:'Munir', plate:'51761-A-72' },
    { id:'3', driver:'Said', plate:'21981-A-9' },
    { id:'4', driver:'Hamza', plate:'21982-A-9' },
    { id:'5', driver:'Mustafa', plate:'21980-A-9' },
    { id:'6', driver:'Mohemad', plate:'148-A-73' },
    { id:'7', driver:'Mjid', plate:'21983-A-9' },
    { id:'8', driver:'Kamal', plate:'21984-A-9' }
  ],
  orabtrans: [
    { id:'1', driver:'Nacer', plate:'24531-A-54' },
    { id:'2', driver:'Abdlkhalek', plate:'24532-A-54' },
    { id:'3', driver:'Abdlah', plate:'24533-A-54' }
  ]
};

function getAppRole(){ return APP_ROLE === 'operateur' ? 'operateur' : 'direction'; }
function isDirectionRole(){ return getAppRole() === 'direction'; }
function getVisibleTabs(){ return ROLE_TABS[getAppRole()] || ROLE_TABS.direction; }
function isTabAllowed(tab){ return getVisibleTabs().some(([k]) => k === tab); }
function getRoleLabel(){ return isDirectionRole() ? 'Direction' : 'Opérateur'; }
function syncRoleBadge(){
  const host = document.getElementById('roleBadgeHost');
  if(!host) return;
  host.innerHTML = `<div class="role-badge"><span class="dot"></span><span>Profil : ${getRoleLabel()}</span></div>`;
}

const defaultState = () => ({
  activeTab:'reception',
  counters:{ reception:1, sortie:1 },
  reusableNumbers:{ reception:[], sortie:[] },
  references:[
    ...ALL_REFERENCE_SEEDS
  ],
  clients:[
    {id:uid(),code:'CL001',nom:'Client Compte 1',telephone:'',adresse:'',actif:true}
  ],
  receptionDraft:{number:'',date:todayStr(),bl:'',fournisseur:'',transporteur:'',chauffeur:'',matricule:'',lines:[],headerLock:null,editingArchiveId:null,editingOriginal:null},
  sortieDraft:{number:'',date:todayStr(),clientType:'divers',clientCode:'',clientNom:'',observation:'',lines:[],editingArchiveId:null,editingOriginal:null},
  receptions:[],
  sorties:[],
  movementFilterRef:'',
  stockSearch:'',
  refListSearch:'',
  clientListSearch:'',
  directionTab:'mouvements',
  synthesePeriod:'month',
  syntheseDay: todayStr(),
  syntheseMonth: todayStr().slice(0,7),
  syntheseQuarter: `${new Date().getFullYear()}-T${Math.floor(new Date().getMonth()/3)+1}`,
  syntheseYear: String(new Date().getFullYear()),
  accordions:{ baseRefForm:true, baseRefList:true, baseClientForm:true, baseClientList:true },
  transporters: JSON.parse(JSON.stringify(DEFAULT_TRANSPORTERS))
});

let state = loadState();
ensureSeedReferences();
applyTheme(localStorage.getItem('oramed_theme') || 'light');
ensureDraftNumbers();
renderTabs();
syncRoleBadge();
renderActiveTab();
initRemoteSync();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? JSON.parse(raw) : defaultState();
    return normalizeLoadedState(s);
  }catch(e){ return defaultState(); }
}

function legacyNormalizeFallback(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? Object.assign(defaultState(), JSON.parse(raw)) : defaultState();
    if(s.receptionDraft){
      if(s.receptionDraft.driver && !s.receptionDraft.transporteur) s.receptionDraft.transporteur = s.receptionDraft.driver;
      if(s.receptionDraft.plate && !s.receptionDraft.matricule) s.receptionDraft.matricule = s.receptionDraft.plate;
      delete s.receptionDraft.driver; delete s.receptionDraft.plate; delete s.receptionDraft.source; delete s.receptionDraft.observation;
      if(!('headerLock' in s.receptionDraft)) s.receptionDraft.headerLock = null;
      if(!('editingArchiveId' in s.receptionDraft)) s.receptionDraft.editingArchiveId = null;
      if(!('editingOriginal' in s.receptionDraft)) s.receptionDraft.editingOriginal = null;
    }
    if(s.sortieDraft){
      if(!('editingArchiveId' in s.sortieDraft)) s.sortieDraft.editingArchiveId = null;
      if(!('editingOriginal' in s.sortieDraft)) s.sortieDraft.editingOriginal = null;
    }
    if(['mouvements','referentiel'].includes(s.activeTab)){
      s.directionTab = s.activeTab;
      s.activeTab = 'direction';
    }
    if(!['mouvements','referentiel'].includes(s.directionTab)) s.directionTab = 'mouvements';
    if(!s.accordions || typeof s.accordions !== 'object') s.accordions = { baseRefForm:true, baseRefList:true, baseClientForm:true, baseClientList:true };
    s.refListSearch = s.refListSearch || '';
    s.clientListSearch = s.clientListSearch || '';
    if(!['day','month','quarter','year'].includes(s.synthesePeriod)) s.synthesePeriod = 'month';
    s.syntheseDay = s.syntheseDay || todayStr();
    s.syntheseMonth = s.syntheseMonth || todayStr().slice(0,7);
    s.syntheseQuarter = s.syntheseQuarter || `${new Date().getFullYear()}-T${Math.floor(new Date().getMonth()/3)+1}`;
    s.syntheseYear = s.syntheseYear || String(new Date().getFullYear());
    if(!['reception','sortie','etat','synthese','archives','direction'].includes(s.activeTab)) s.activeTab = 'reception';
    if(!isTabAllowed(s.activeTab)) s.activeTab = 'reception';
    (s.receptions||[]).forEach(doc => {
      if(doc.driver && !doc.transporteur) doc.transporteur = doc.driver;
      if(doc.plate && !doc.matricule) doc.matricule = doc.plate;
      delete doc.driver; delete doc.plate; delete doc.source; delete doc.observation;
      if(!doc.createdAt) doc.createdAt = doc.date ? `${doc.date}T00:00:00` : new Date().toISOString();
      if(!doc.sequence) doc.sequence = numberToSeq(doc.number, 'BR');
    });
    (s.sorties||[]).forEach(doc => {
      if(!doc.createdAt) doc.createdAt = doc.date ? `${doc.date}T00:00:00` : new Date().toISOString();
      if(!doc.sequence) doc.sequence = numberToSeq(doc.number, 'BS');
    });
    if(!s.transporters || typeof s.transporters !== 'object'){
      s.transporters = JSON.parse(JSON.stringify(DEFAULT_TRANSPORTERS));
    }else{
      s.transporters.camion_oramed = Array.isArray(s.transporters.camion_oramed) ? s.transporters.camion_oramed : JSON.parse(JSON.stringify(DEFAULT_TRANSPORTERS.camion_oramed));
      s.transporters.orabtrans = JSON.parse(JSON.stringify(DEFAULT_TRANSPORTERS.orabtrans));
    }
    return s;
  }catch(e){ return defaultState(); }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if(syncState.config.enabled && !syncState.isApplyingRemote){
    pushRemoteState('save').catch(err => updateSyncStatus('local', err.message || 'Synchronisation distante impossible.'));
  }
}

function ensureSeedReferences(){
  const existing = new Set((state.references || []).map(r => `${String(r.reference||'').trim().toLowerCase()}|${String(r.marque||'').trim().toLowerCase()}|${String(r.format||'').trim().toLowerCase()}|${String(r.choix||'').trim().toLowerCase()}`));
  let added = false;
  ALL_REFERENCE_SEEDS.forEach(seed => {
    const key = `${String(seed.reference||'').trim().toLowerCase()}|${String(seed.marque||'').trim().toLowerCase()}|${String(seed.format||'').trim().toLowerCase()}|${String(seed.choix||'').trim().toLowerCase()}`;
    if(!existing.has(key)){
      state.references.push({...seed, id: uid()});
      existing.add(key);
      added = true;
    }
  });
  if(added) saveState();
}


function numberToSeq(number, prefix){
  const m = new RegExp('^' + prefix + '-(\\d+)$').exec(String(number || ''));
  return m ? Number(m[1]) : 0;
}
function ensureCounters(){
  if(!state.counters || typeof state.counters !== 'object') state.counters = {};
  if(!state.reusableNumbers || typeof state.reusableNumbers !== 'object') state.reusableNumbers = {};
  const maxReception = Math.max(0, ...(state.receptions||[]).map(d => Number(d.sequence || numberToSeq(d.number, 'BR') || 0)));
  const maxSortie = Math.max(0, ...(state.sorties||[]).map(d => Number(d.sequence || numberToSeq(d.number, 'BS') || 0)));
  state.counters.reception = Math.max(Number(state.counters.reception || 1), maxReception + 1);
  state.counters.sortie = Math.max(Number(state.counters.sortie || 1), maxSortie + 1);
  const usedReception = new Set((state.receptions||[]).map(d => Number(d.sequence || numberToSeq(d.number, 'BR') || 0)).filter(Boolean));
  const usedSortie = new Set((state.sorties||[]).map(d => Number(d.sequence || numberToSeq(d.number, 'BS') || 0)).filter(Boolean));
  const normalizePool = (pool, usedSet, limit) => [...new Set((Array.isArray(pool) ? pool : []).map(n => Number(n||0)).filter(n => n > 0 && !usedSet.has(n) && n < limit))].sort((a,b)=>a-b);
  state.reusableNumbers.reception = normalizePool(state.reusableNumbers.reception, usedReception, Number(state.counters.reception || 1));
  state.reusableNumbers.sortie = normalizePool(state.reusableNumbers.sortie, usedSortie, Number(state.counters.sortie || 1));
}
function getReusablePool(prefix){
  ensureCounters();
  const key = prefix === 'BR' ? 'reception' : 'sortie';
  if(!Array.isArray(state.reusableNumbers[key])) state.reusableNumbers[key] = [];
  return state.reusableNumbers[key];
}
function registerReusableNumber(prefix, sequence){
  ensureCounters();
  const seq = Number(sequence || 0);
  if(seq <= 0) return;
  const key = prefix === 'BR' ? 'reception' : 'sortie';
  const pool = getReusablePool(prefix);
  const usedSet = new Set((key === 'reception' ? state.receptions : state.sorties).map(d => Number(d.sequence || numberToSeq(d.number, prefix) || 0)).filter(Boolean));
  if(usedSet.has(seq)) return;
  if(!pool.includes(seq)) pool.push(seq);
  pool.sort((a,b)=>a-b);
}
function ensureDraftNumbers(){
  if(!state.receptionDraft) state.receptionDraft = defaultState().receptionDraft;
  if(!state.sortieDraft) state.sortieDraft = defaultState().sortieDraft;
  ensureCounters();

  const expectedReceptionNumber = nextNumber('BR');
  const expectedSortieNumber = nextNumber('BS');
  const receptionHasArchives = Array.isArray(state.receptions) && state.receptions.length > 0;
  const sortieHasArchives = Array.isArray(state.sorties) && state.sorties.length > 0;

  if(!receptionHasArchives){
    state.counters.reception = 1;
    state.reusableNumbers.reception = [];
    state.receptionDraft.number = 'BR-0001';
  }else if(!state.receptionDraft.number || numberToSeq(state.receptionDraft.number, 'BR') !== numberToSeq(expectedReceptionNumber, 'BR')){
    state.receptionDraft.number = expectedReceptionNumber;
  }

  if(!sortieHasArchives){
    state.counters.sortie = 1;
    state.reusableNumbers.sortie = [];
    state.sortieDraft.number = 'BS-0001';
  }else if(!state.sortieDraft.number || numberToSeq(state.sortieDraft.number, 'BS') !== numberToSeq(expectedSortieNumber, 'BS')){
    state.sortieDraft.number = expectedSortieNumber;
  }

  if(!state.receptionDraft.date) state.receptionDraft.date = todayStr();
  if(!('headerLock' in state.receptionDraft)) state.receptionDraft.headerLock = null;
  if(!state.sortieDraft.date) state.sortieDraft.date = todayStr();
  if(!('editingArchiveId' in state.sortieDraft)) state.sortieDraft.editingArchiveId = null;
  if(!('editingOriginal' in state.sortieDraft)) state.sortieDraft.editingOriginal = null;
}

function getSupplierBrand(value){
  const v = String(value || '').trim();
  if(['SCC','SCB','SCK','SCT'].includes(v)) return 'Super Cerame';
  return v || '';
}
function matchesReceptionSupplier(referenceRow, receptionSupplier){
  const refSupplier = getSupplierBrand(referenceRow?.marque || '');
  const selected = getSupplierBrand(receptionSupplier || '');
  if(!selected) return true;
  return refSupplier === selected;
}
function getReceptionHeaderSnapshot(){
  const d = state.receptionDraft || {};
  return {
    date: String(d.date || ''),
    bl: String(d.bl || ''),
    fournisseur: String(d.fournisseur || ''),
    transporteur: String(d.transporteur || ''),
    chauffeur: String(d.chauffeur || ''),
    matricule: String(d.matricule || '')
  };
}
function sameReceptionHeader(a,b){
  const aa = a || {}, bb = b || {};
  return ['date','bl','fournisseur','transporteur','chauffeur','matricule'].every(k => String(aa[k] || '') === String(bb[k] || ''));
}
function calcReceptionLineTotal(){
  const ref = getReferenceById(document.getElementById('rec_ref_id')?.value || '');
  const boxes = Number(document.getElementById('rec_line_boxes')?.value || 0);
  const total = round2(boxes * Number(ref?.m2ParCaisse || 0));
  const totalInput = document.getElementById('rec_line_metrage');
  if(totalInput) totalInput.value = boxes > 0 && ref ? total : '';
}
function renderSupplierOptions(options, selected=''){
  const groups = {};
  options.forEach(o => {
    if(!groups[o.group]) groups[o.group] = [];
    groups[o.group].push(o);
  });
  return `<option value="">Choisir</option>` + Object.entries(groups).map(([group, items]) =>
    `<optgroup label="${group}">${items.map(o => `<option value="${o.value}" ${selected===o.value?'selected':''}>${o.label}</option>`).join('')}</optgroup>`
  ).join('');
}
function renderTransporterOptions(selected=''){
  return `<option value="">Choisir</option>` + TRANSPORTER_OPTIONS.map(o => `<option value="${o.value}" ${selected===o.value?'selected':''}>${o.label}</option>`).join('');
}
function onReceptionTransporterChange(){
  const type = state.receptionDraft.transporteur || '';
  const chauffeurSelect = document.getElementById('rec_chauffeur_select');
  const chauffeurManual = document.getElementById('rec_chauffeur_manual');
  const matricule = document.getElementById('rec_matricule');
  if(!chauffeurSelect || !chauffeurManual || !matricule) return;

  chauffeurSelect.classList.add('hidden');
  chauffeurManual.classList.add('hidden');
  chauffeurSelect.innerHTML = '';
  if(type === 'camion_oramed' || type === 'orabtrans'){
    const items = state.transporters[type] || [];
    chauffeurSelect.classList.remove('hidden');
    chauffeurSelect.innerHTML = `<option value="">Choisir un chauffeur</option>` + items.map(d =>
      `<option value="${esc(d.driver)}" data-plate="${esc(d.plate)}" ${state.receptionDraft.chauffeur===d.driver?'selected':''}>${esc(d.driver)}</option>`
    ).join('');
    matricule.readOnly = true;
    onReceptionDriverChange();
  }else{
    chauffeurManual.classList.remove('hidden');
    chauffeurManual.placeholder = 'Nom du chauffeur';
    matricule.readOnly = false;
    if(type !== 'usine' && !state.receptionDraft.matricule){
      matricule.value = '';
    }
  }
}
function onReceptionDriverChange(){
  const type = state.receptionDraft.transporteur || '';
  const chauffeurSelect = document.getElementById('rec_chauffeur_select');
  const matricule = document.getElementById('rec_matricule');
  if(type !== 'camion_oramed' && type !== 'orabtrans') return;
  const selected = chauffeurSelect?.selectedOptions?.[0];
  state.receptionDraft.chauffeur = selected ? (selected.value || '') : '';
  state.receptionDraft.matricule = selected ? (selected.dataset.plate || '') : '';
  if(chauffeurSelect) chauffeurSelect.value = state.receptionDraft.chauffeur || '';
  if(matricule) matricule.value = state.receptionDraft.matricule || '';
  saveState();
}
function setReceptionTransporter(value){
  state.receptionDraft.transporteur = value;
  state.receptionDraft.chauffeur = '';
  state.receptionDraft.matricule = '';
  saveState();
  renderReception();
}
function nextNumber(prefix){
  ensureCounters();
  const key = prefix === 'BR' ? 'reception' : 'sortie';
  const pool = getReusablePool(prefix);
  const n = pool.length ? Number(pool[0]) : Number(state.counters[key] || 1);
  return `${prefix}-${String(n).padStart(4,'0')}`;
}
function consumeNextNumber(prefix){
  ensureCounters();
  const key = prefix === 'BR' ? 'reception' : 'sortie';
  const pool = getReusablePool(prefix);
  let n;
  if(pool.length){
    n = Number(pool.shift() || 0);
  }else{
    n = Number(state.counters[key] || 1);
    state.counters[key] = n + 1;
  }
  saveState();
  return { number: `${prefix}-${String(n).padStart(4,'0')}`, sequence: n };
}
const byArchiveOrderDesc = (a,b) => {
  const as = Number(a.sequence || numberToSeq(a.number, String(a.number||'').startsWith('BS-') ? 'BS' : 'BR') || 0);
  const bs = Number(b.sequence || numberToSeq(b.number, String(b.number||'').startsWith('BS-') ? 'BS' : 'BR') || 0);
  if(bs !== as) return bs - as;
  return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
};
function setTab(tab){
  if(!isTabAllowed(tab)) return;
  state.activeTab = tab;
  saveState();
  renderTabs();
  renderActiveTab();
}
function renderTabs(){
  const visibleTabs = getVisibleTabs();
  if(!isTabAllowed(state.activeTab)) state.activeTab = visibleTabs[0]?.[0] || 'reception';
  document.getElementById('tabs').innerHTML = visibleTabs.map(([k,label]) => `<button class="tab ${state.activeTab===k?'active':''}" onclick="setTab('${k}')">${label}</button>`).join('');
}
function renderActiveTab(){
  if(!isTabAllowed(state.activeTab)) state.activeTab = 'reception';
  const map = {reception:renderReception,sortie:renderSortie,etat:renderEtat,synthese:renderSynthese,archives:renderArchives,direction:renderDirection};
  try {
    (map[state.activeTab] || renderReception)();
  } catch (err) {
    console.error('renderActiveTab error', err);
    document.getElementById('view').innerHTML = `<div class="card"><h2 class="section-title">Erreur d'affichage</h2><div class="muted" style="margin-top:8px">Un ancien essai a bloqué l'onglet. Cette version a été isolée avec une nouvelle mémoire locale. Recharge la page puis réessaie.</div></div>`;
  }
}
function setDirectionTab(tab){ if(!isDirectionRole()) return; state.directionTab = tab; saveState(); renderDirection(); }
function renderDirection(){
  if(!isDirectionRole()){
    state.activeTab = 'reception';
    saveState();
    renderTabs();
    renderActiveTab();
    return;
  }
  const current = ['mouvements','referentiel'].includes(state.directionTab) ? state.directionTab : 'mouvements';
  document.getElementById('view').innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div>
          <h2 class="section-title" style="margin:0">Direction</h2>
          <div class="subtitle" style="margin:6px 0 0 0">Espace de pilotage avec mouvements par référence et base.</div>
          <div class="role-note">Cette vue reste réservée au profil direction. La logique des bons, de l'état de stock et de la synthèse n'a pas été touchée.</div>
        </div>
        <div class="tabs">${directionTabs.map(([k,label]) => `<button class="tab ${current===k?'active':''}" onclick="setDirectionTab('${k}')">${label}</button>`).join('')}</div>
      </div>
    </div>
    <div id="syncSettingsHost"></div><div id="directionContent"></div>`;
  renderSyncSettings();
  ({mouvements:renderMouvements,referentiel:renderReferentiel}[current] || renderMouvements)('directionContent');
}
function getGlobalQuery(){ return (document.getElementById('globalSearch')?.value || '').trim().toLowerCase(); }

function displayTransporterLabel(value){
  if(value === 'camion_oramed') return 'Nos camions';
  if(value === 'orabtrans') return 'ORABTRANS';
  if(value === 'usine') return 'Usine';
  return value || '';
}
function computeStockRows(){
  const refs = state.references.filter(r => r.actif !== false);
  return refs.map(ref => {
    const inLines = state.receptions.filter(doc => doc.status !== 'annulé').flatMap(doc => (doc.lines||[]).filter(l => l.referenceId === ref.id).map(l => ({...l, date:doc.date, number:doc.number, fournisseur:doc.fournisseur, transporteur:doc.transporteur, chauffeur:doc.chauffeur, matricule:doc.matricule})));
    const outLines = state.sorties.filter(doc => doc.status !== 'annulé').flatMap(doc => (doc.lines||[]).filter(l => l.referenceId === ref.id).map(l => ({...l, date:doc.date, number:doc.number, clientNom:doc.clientNom, clientType:doc.clientType, clientCode:doc.clientCode})));
    const initialStock = round2(Number(ref.initialStock||0));
    const totalIn = round2(inLines.reduce((s,l)=>s+Number(l.metrage||0),0));
    const totalOut = round2(outLines.reduce((s,l)=>s+Number(l.metrage||0),0));
    const stock = round2(initialStock+totalIn-totalOut);
    const m2ParCaisse = round2(Number(ref.m2ParCaisse||0));
    const defaults = getPackagingDefaults(ref.marque, ref.format);
    const caissesParPalette = round2(Number(ref.caissesParPalette || defaults.caissesParPalette || 0));
    const stockCaisses = m2ParCaisse > 0 ? round2(stock / m2ParCaisse) : 0;
    const stockPalettes = (m2ParCaisse > 0 && caissesParPalette > 0) ? round2(stockCaisses / caissesParPalette) : 0;
    return {...ref,initialStock,totalIn,totalOut,stock,m2ParCaisse,caissesParPalette,m2ParPalette:round2(m2ParCaisse*caissesParPalette),stockCaisses,stockPalettes,entryCount:inLines.length,exitCount:outLines.length};
  });
}
function getReferenceById(id){ return state.references.find(r => r.id===id); }
function getClientByCode(code){ return state.clients.find(c => c.code===code); }
function searchReferences(term){
  term = String(term||'').trim().toLowerCase();
  return state.references.filter(r => r.actif !== false).filter(r => !term || [r.reference,r.format,r.marque,getSupplierBrand(r.marque),r.choix].join(' ').toLowerCase().includes(term)).slice(0,12);
}
function getRefSuggestionBoxId(mode){
  return mode === 'rec' ? 'recSuggestions' : mode === 'sort' ? 'sortSuggestions' : 'movSuggestions';
}
function renderRefSuggestions(mode){
  const input = document.getElementById(`${mode}_ref_search`);
  const hidden = document.getElementById(`${mode}_ref_id`);
  const box = document.getElementById(getRefSuggestionBoxId(mode));
  if(!input || !hidden || !box) return;
  const term = String(input.value || '').trim().toLowerCase();
  if(mode === 'rec'){
    const selectedSupplier = state.receptionDraft.fournisseur || '';
    const refs = state.references
      .filter(r => r.actif !== false)
      .filter(r => matchesReceptionSupplier(r, selectedSupplier))
      .filter(r => !term || String(r.reference || '').toLowerCase().startsWith(term))
      .sort((a,b) => String(a.reference||'').localeCompare(String(b.reference||''), 'fr'))
      .slice(0,12);
    if(!selectedSupplier){
      box.innerHTML = `<div class="autocomplete-item muted">Choisis d'abord le fournisseur / usine.</div>`;
      box.classList.remove('hidden');
      hidden.value = '';
      return;
    }
    if(!refs.length){
      box.innerHTML = `<div class="autocomplete-item muted">Aucune référence trouvée pour ${esc(selectedSupplier)}.</div>`;
      box.classList.remove('hidden');
      hidden.value = '';
      return;
    }
    box.innerHTML = refs.map(r => `<div class="autocomplete-item ${String(r.choix||'').toLowerCase().includes('2eme') ? 'second-choice' : ''}" onclick="selectReference('${mode}','${r.id}')"><strong>${esc(r.reference)}</strong><div class="small muted">${esc(r.format)} · ${esc(getSupplierBrand(r.marque))} · ${esc(r.choix || '')}</div></div>`).join('');
    box.classList.remove('hidden');
    return;
  }
  const refs = state.references
    .filter(r => r.actif !== false)
    .filter(r => !term || String(r.reference || '').toLowerCase().includes(term))
    .sort((a,b) => String(a.reference||'').localeCompare(String(b.reference||''), 'fr'))
    .slice(0,12);
  if(!refs.length){
    box.innerHTML = `<div class="autocomplete-item muted">Aucune référence trouvée.</div>`;
    box.classList.remove('hidden');
    hidden.value = '';
    return;
  }
  box.innerHTML = refs.map(r => `<div class="autocomplete-item ${String(r.choix||'').toLowerCase().includes('2eme') ? 'second-choice' : ''}" onclick="selectReference('${mode}','${r.id}')"><strong>${esc(r.reference)}</strong><div class="small muted">${esc(r.format)} · ${esc(getSupplierBrand(r.marque))} · ${esc(r.choix || '')} · Stock: ${fmt((computeStockRows().find(s => s.id===r.id)?.stock || 0))} m²</div></div>`).join('');
  box.classList.remove('hidden');
}
function selectReference(mode, refId){
  const ref = getReferenceById(refId);
  const input = document.getElementById(`${mode}_ref_search`);
  const hidden = document.getElementById(`${mode}_ref_id`);
  const box = document.getElementById(getRefSuggestionBoxId(mode));
  if(!ref || !input || !hidden || !box) return;
  input.value = ref.reference || '';
  hidden.value = ref.id || '';
  box.classList.add('hidden');
  if(mode === 'rec') calcReceptionLineTotal();
  if(mode === 'sort') calcSortieLineTotal();
  if(mode === 'mov') changeMovementRef(ref.id);
}
function computeMovements(referenceId){
  const rows = [];
  state.receptions.filter(doc => doc.status !== 'annulé').forEach(doc => (doc.lines||[]).filter(l => l.referenceId===referenceId).forEach(l => rows.push({date:doc.date,type:'ENTRÉE',number:doc.number,tiers:doc.fournisseur||doc.provenance||'',metrage:Number(l.metrage||0),boxes:Number(l.boxes||0)})));
  state.sorties.filter(doc => doc.status !== 'annulé').forEach(doc => (doc.lines||[]).filter(l => l.referenceId===referenceId).forEach(l => rows.push({date:doc.date,type:'SORTIE',number:doc.number,tiers:doc.clientNom||'',metrage:-Number(l.metrage||0),boxes:Number(l.boxes||0)})));
  rows.sort((a,b)=> String(a.date).localeCompare(String(b.date)) || a.type.localeCompare(b.type));
  let running=0;
  return rows.map(r => ({...r, running: round2(running += Number(r.metrage||0))}));
}

function toggleAccordion(key){
  state.accordions = state.accordions || {};
  state.accordions[key] = !state.accordions[key];
  saveState();
  if(state.activeTab==='direction') renderDirection(); else renderReferentiel();
}
function setRefListSearch(v){
  state.refListSearch = v;
  state.baseFocus = 'refListSearch';
  saveState();
  if(state.activeTab==='direction') renderDirection(); else renderReferentiel();
}
function setClientListSearch(v){
  state.clientListSearch = v;
  state.baseFocus = 'clientListSearch';
  saveState();
  if(state.activeTab==='direction') renderDirection(); else renderReferentiel();
}
function startEditReference(id){
  const r = state.references.find(x => x.id===id);
  if(!r) return;
  document.getElementById('ref_edit_id').value = r.id;
  document.getElementById('ref_reference').value = r.reference || '';
  document.getElementById('ref_format').value = r.format || FORMAT_OPTIONS[0] || '';
  document.getElementById('ref_marque').value = r.marque || 'Super Cerame';
  document.getElementById('ref_choix').value = r.choix || '1er choix';
  document.getElementById('ref_m2').value = Number(r.m2ParCaisse||0);
  document.getElementById('ref_initial').value = Number(r.initialStock||0);
  document.getElementById('ref_caisses_palette').value = Number(r.caissesParPalette || getPackagingDefaults(r.marque, r.format).caissesParPalette || 0) || '';
  refreshReferencePackagingForm();
  const btn = document.getElementById('ref_submit_btn');
  if(btn) btn.textContent = 'Enregistrer la modification';
}
function cancelEditReference(){
  document.getElementById('ref_edit_id').value = '';
  document.getElementById('ref_reference').value = '';
  document.getElementById('ref_format').value = FORMAT_OPTIONS[0] || '';
  document.getElementById('ref_marque').value = 'Super Cerame';
  document.getElementById('ref_choix').value = '1er choix';
  document.getElementById('ref_m2').value = '';
  document.getElementById('ref_initial').value = '';
  document.getElementById('ref_caisses_palette').value = '';
  refreshReferencePackagingForm();
  const btn = document.getElementById('ref_submit_btn');
  if(btn) btn.textContent = 'Ajouter la référence';
}
function startEditClient(id){
  const c = state.clients.find(x => x.id===id);
  if(!c) return;
  document.getElementById('client_edit_id').value = c.id;
  document.getElementById('client_code').value = c.code || '';
  document.getElementById('client_nom').value = c.nom || '';
  document.getElementById('client_phone').value = c.telephone || '';
  document.getElementById('client_address').value = c.adresse || '';
  const btn = document.getElementById('client_submit_btn');
  if(btn) btn.textContent = 'Enregistrer la modification';
}
function cancelEditClient(){
  document.getElementById('client_edit_id').value = '';
  document.getElementById('client_code').value = '';
  document.getElementById('client_nom').value = '';
  document.getElementById('client_phone').value = '';
  document.getElementById('client_address').value = '';
  const btn = document.getElementById('client_submit_btn');
  if(btn) btn.textContent = 'Ajouter le client';
}

function renderReferentiel(mountId='view'){
  const target = document.getElementById(mountId) || document.getElementById('view');
  const refQ = (state.refListSearch || '').trim().toLowerCase();
  const clientQ = (state.clientListSearch || '').trim().toLowerCase();
  const refs = state.references.filter(r => !refQ || [r.reference,r.format,r.marque,getSupplierBrand(r.marque),r.choix].join(' ').toLowerCase().includes(refQ));
  const clients = state.clients.filter(c => !clientQ || [c.code,c.nom,c.telephone,c.adresse].join(' ').toLowerCase().includes(clientQ));
  const acc = state.accordions || {};
  const arrow = (open) => `<span class="arrow">▾</span>`;
  target.innerHTML = `
    <div class="card">
      <div class="toolbar" style="align-items:end">
        <div>
          <h2 class="section-title" style="margin:0">Base</h2>
          <div class="subtitle" style="margin:6px 0 0 0">Références dépôt et clients à compte utilisés dans les réceptions, sorties et états de stock.</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="collapse-head ${acc.baseRefForm===false?'closed':''}" onclick="toggleAccordion('baseRefForm')">
        <h2 class="section-title" style="margin:0">Base des références</h2>
        ${arrow(acc.baseRefForm!==false)}
      </div>
      ${acc.baseRefForm===false ? '' : `
        <div class="subtitle">Tu peux saisir ici le stock initial et les données palette pour chaque référence.</div>
        <input type="hidden" id="ref_edit_id">
        <div class="row">
          <div><label>Référence</label><input id="ref_reference"></div>
          <div><label>Format</label><select id="ref_format" onchange="refreshReferencePackagingForm()">${FORMAT_OPTIONS.map(v=>`<option value="${v}">${v}</option>`).join('')}</select></div>
          <div><label>Fournisseur</label><select id="ref_marque" onchange="refreshReferencePackagingForm()">${renderSupplierOptions(BASE_SUPPLIER_OPTIONS, 'Super Cerame')}</select></div>
          <div><label>Choix</label><select id="ref_choix"><option value="1er choix">1er choix</option><option value="2eme choix">2eme choix</option></select></div>
        </div>
        <div class="row" style="margin-top:12px">
          <div><label>m² / caisse</label><input id="ref_m2" type="number" step="0.01" oninput="refreshReferencePackagingForm()"></div>
          <div><label>Stock initial (m²)</label><input id="ref_initial" type="number" step="0.01"></div>
          <div><label>Caisses / palette</label><input id="ref_caisses_palette" type="number" step="0.01" oninput="refreshReferencePackagingForm()"></div>
          <div><label>m² / palette</label><input id="ref_m2_palette" readonly></div>
        </div>
        <div class="footer-actions"><button id="ref_submit_btn" class="success" onclick="addReference()">Ajouter la référence</button><button class="secondary" onclick="cancelEditReference()">Nouveau</button></div>
      `}
    </div>

    <div class="card">
      <div class="collapse-head ${acc.baseRefList===false?'closed':''}" onclick="toggleAccordion('baseRefList')">
        <div class="toolbar" style="margin:0;width:100%">
          <h2 class="section-title" style="margin:0">Liste des références</h2>
          <span class="pill">${refs.length} référence(s)</span>
        </div>
        ${arrow(acc.baseRefList!==false)}
      </div>
      ${acc.baseRefList===false ? '' : `
        <div style="margin-top:12px;max-width:420px">
          <label>Recherche référence / format / fournisseur</label>
          <input id="refListSearch" value="${esc(state.refListSearch||'')}" oninput="setRefListSearch(this.value)" placeholder="Ex : 60x60, Super Cerame, SC-...">
        </div>
        <div class="table-wrap" style="margin-top:12px">
          <table>
            <thead><tr><th>Référence</th><th>Format</th><th>Fournisseur</th><th>Choix</th><th>m²/caisse</th><th>Stock initial</th><th>Caisse/palette</th><th></th></tr></thead>
            <tbody>
              ${refs.map(r => `<tr>
                <td class="mono">${esc(r.reference)}</td>
                <td>${esc(r.format)}</td>
                <td>${esc(r.marque)}${getSupplierBrand(r.marque) && getSupplierBrand(r.marque)!==r.marque ? ' <span class="muted small">(' + esc(getSupplierBrand(r.marque)) + ')</span>' : ''}</td>
                <td>${esc(r.choix)}</td>
                <td>${fmt(r.m2ParCaisse)}</td>
                <td>${fmt(r.initialStock||0)}</td>
                <td>${fmt(Number(r.caissesParPalette || getPackagingDefaults(r.marque, r.format).caissesParPalette || 0))}</td>
                <td class="right"><button class="secondary" onclick="startEditReference('${r.id}')">Modifier</button> <button class="secondary" onclick="removeReference('${r.id}')">Supprimer</button></td>
              </tr>`).join('') || `<tr><td colspan="8" class="muted">Aucune référence.</td></tr>`}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <div class="card">
      <div class="collapse-head ${acc.baseClientForm===false?'closed':''}" onclick="toggleAccordion('baseClientForm')">
        <h2 class="section-title" style="margin:0">Base des clients à compte</h2>
        ${arrow(acc.baseClientForm!==false)}
      </div>
      ${acc.baseClientForm===false ? '' : `
        <div class="subtitle">Le bon de sortie pourra être saisi en client divers ou client à compte via ce code client.</div>
        <input type="hidden" id="client_edit_id">
        <div class="row-2">
          <div><label>Code client</label><input id="client_code"></div>
          <div><label>Nom client</label><input id="client_nom"></div>
        </div>
        <div class="row-2" style="margin-top:12px">
          <div><label>Téléphone</label><input id="client_phone"></div>
          <div><label>Adresse</label><input id="client_address"></div>
        </div>
        <div class="footer-actions"><button id="client_submit_btn" class="success" onclick="addClient()">Ajouter le client</button><button class="secondary" onclick="cancelEditClient()">Nouveau</button></div>
      `}
    </div>

    <div class="card">
      <div class="collapse-head ${acc.baseClientList===false?'closed':''}" onclick="toggleAccordion('baseClientList')">
        <div class="toolbar" style="margin:0;width:100%">
          <h2 class="section-title" style="margin:0">Liste des clients à compte</h2>
          <span class="pill">${clients.length} client(s)</span>
        </div>
        ${arrow(acc.baseClientList!==false)}
      </div>
      ${acc.baseClientList===false ? '' : `
        <div style="margin-top:12px;max-width:420px">
          <label>Recherche code / nom / téléphone / adresse</label>
          <input id="clientListSearch" value="${esc(state.clientListSearch||'')}" oninput="setClientListSearch(this.value)" placeholder="Ex : CL001, Ahmed, Casa...">
        </div>
        <div class="table-wrap" style="margin-top:12px">
          <table>
            <thead><tr><th>Code</th><th>Nom</th><th>Téléphone</th><th>Adresse</th><th></th></tr></thead>
            <tbody>
              ${clients.map(c => `<tr>
                <td class="mono">${esc(c.code)}</td>
                <td>${esc(c.nom)}</td>
                <td>${esc(c.telephone||'')}</td>
                <td>${esc(c.adresse||'')}</td>
                <td class="right"><button class="secondary" onclick="startEditClient('${c.id}')">Modifier</button> <button class="secondary" onclick="removeClient('${c.id}')">Supprimer</button></td>
              </tr>`).join('') || `<tr><td colspan="5" class="muted">Aucun client à compte.</td></tr>`}
            </tbody>
          </table>
        </div>
      `}
    </div>`;
  requestAnimationFrame(() => {
    if(state.baseFocus){
      const el = document.getElementById(state.baseFocus);
      if(el){
        const len = el.value.length;
        el.focus();
        try{ el.setSelectionRange(len, len); }catch(e){}
      }
    }
    refreshReferencePackagingForm();
  });
}
function addReference(){
  const editId = document.getElementById('ref_edit_id')?.value || '';
  const reference = document.getElementById('ref_reference').value.trim();
  const format = document.getElementById('ref_format').value.trim();
  const marque = document.getElementById('ref_marque').value.trim();
  const choix = document.getElementById('ref_choix').value.trim();
  const m2ParCaisse = Number(document.getElementById('ref_m2').value || 0);
  const initialStock = Number(document.getElementById('ref_initial').value || 0);
  const caissesParPalette = Number(document.getElementById('ref_caisses_palette').value || 0);
  if(!reference){ alert('Remplis au minimum la référence.'); return; }
  const exists = state.references.some(r => String(r.reference||'').toLowerCase() === reference.toLowerCase() && r.id !== editId);
  if(exists){ alert('Cette référence existe déjà.'); return; }
  const payload = {reference, designation:'', format, marque, choix, m2ParCaisse:round2(m2ParCaisse), initialStock:round2(initialStock), caissesParPalette:round2(caissesParPalette), m2ParPalette:round2(m2ParCaisse*caissesParPalette), actif:true};
  if(editId){
    const idx = state.references.findIndex(r => r.id===editId);
    if(idx<0) return;
    state.references[idx] = {...state.references[idx], ...payload};
  }else{
    state.references.unshift({id:uid(), ...payload});
  }
  saveState();
  if(state.activeTab==='direction') renderDirection(); else renderReferentiel();
}
function removeReference(id){
  const used = state.receptions.some(d => d.lines.some(l => l.referenceId===id)) || state.sorties.some(d => d.lines.some(l => l.referenceId===id));
  if(used){ alert('Impossible : cette référence a déjà des mouvements.'); return; }
  state.references = state.references.filter(r => r.id !== id); saveState(); if(state.activeTab==='direction') renderDirection(); else renderReferentiel();
}
function addClient(){
  const editId = document.getElementById('client_edit_id')?.value || '';
  const code = document.getElementById('client_code').value.trim();
  const nom = document.getElementById('client_nom').value.trim();
  const telephone = document.getElementById('client_phone').value.trim();
  const adresse = document.getElementById('client_address').value.trim();
  if(!code || !nom){ alert('Remplis au minimum le code client et le nom.'); return; }
  if(state.clients.some(c => c.code.toLowerCase() === code.toLowerCase() && c.id !== editId)){ alert('Ce code client existe déjà.'); return; }
  if(editId){
    const idx = state.clients.findIndex(c => c.id===editId);
    if(idx<0) return;
    state.clients[idx] = {...state.clients[idx], code, nom, telephone, adresse, actif:true};
  }else{
    state.clients.unshift({id:uid(),code,nom,telephone,adresse,actif:true});
  }
  saveState(); if(state.activeTab==='direction') renderDirection(); else renderReferentiel();
}
function removeClient(id){
  const code = state.clients.find(c => c.id===id)?.code;
  const used = state.sorties.some(s => s.clientCode===code);
  if(used){ alert('Impossible : ce client a déjà des bons de sortie.'); return; }
  state.clients = state.clients.filter(c => c.id!==id); saveState(); if(state.activeTab==='direction') renderDirection(); else renderReferentiel();
}

function renderReception(){
  const d = state.receptionDraft;
  const totalMetrage = round2((d.lines||[]).reduce((s,l)=>s+Number(l.metrage||0),0));
  const totalBoxes = round2((d.lines||[]).reduce((s,l)=>s+Number(l.boxes||0),0));
  document.getElementById('view').innerHTML = `
    <div class="card">
      <div class="toolbar"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 class="section-title" style="margin:0">Bon de réception</h2>${d.editingArchiveId ? '<span class="tag warn-tag">Modification archive</span>' : ''}</div><button class="secondary" onclick="newReceptionDraft()">Nouveau bon</button></div>
      <div class="row">
        <div><label>N° entrée</label><input value="${esc(d.number)}" readonly></div>
        <div><label>Date</label><input type="date" id="rec_date" value="${esc(d.date)}" onchange="state.receptionDraft.date=this.value;saveState()" ${d.lines.length?'disabled':''}></div>
        <div><label>BL</label><input id="rec_bl" value="${esc(d.bl||'')}" oninput="state.receptionDraft.bl=this.value;saveState()" ${d.lines.length?'disabled':''}></div>
        <div><label>Fournisseur / Usine</label><select id="rec_fournisseur" onchange="state.receptionDraft.fournisseur=this.value;saveState()" ${d.lines.length?'disabled':''}>${renderSupplierOptions(RECEPTION_SUPPLIER_OPTIONS, d.fournisseur||'')}</select></div>
      </div>
      <div class="row" style="margin-top:12px">
        <div><label>Transporteur</label><select id="rec_transporteur" onchange="setReceptionTransporter(this.value)" ${d.lines.length?'disabled':''}>${renderTransporterOptions(d.transporteur||'')}</select></div>
        <div>
          <label>Chauffeur</label>
          <select id="rec_chauffeur_select" class="hidden" onchange="onReceptionDriverChange()" ${d.lines.length?'disabled':''}></select>
          <input id="rec_chauffeur_manual" class="hidden" value="${esc(d.chauffeur||'')}" oninput="state.receptionDraft.chauffeur=this.value;saveState()" ${d.lines.length?'disabled':''}>
        </div>
        <div><label>Matricule</label><input id="rec_matricule" value="${esc(d.matricule||'')}" oninput="state.receptionDraft.matricule=this.value;saveState()" ${d.lines.length?'disabled':''}></div>
        <div></div>
      </div>
    </div>

    <div class="card entry-card">
      <div class="toolbar"><h2 class="section-title" style="margin:0">Ajouter une ligne du bon d'entrée</h2><span class="pill">${d.lines.length} ligne(s)</span></div>
      <div class="row">
        <div>
          <label>Référence</label>
          <div class="autocomplete">
            <input id="rec_ref_search" placeholder="Tape le début de référence" oninput="renderRefSuggestions('rec')" onfocus="renderRefSuggestions('rec')" autocomplete="off">
            <div id="recSuggestions" class="autocomplete-list hidden"></div>
          </div>
          <input type="hidden" id="rec_ref_id">
        </div>
        <div><label>Nb de caisse</label><input id="rec_line_boxes" type="number" step="1" oninput="calcReceptionLineTotal()"></div>
        <div><label>Total m²</label><input id="rec_line_metrage" type="number" step="0.01" readonly></div>
        <div style="display:flex;align-items:end"><button class="success w-100" onclick="addReceptionLine()">Ajouter la ligne</button></div>
      </div>
      <div class="small muted" style="margin-top:8px">Le total m² se calcule automatiquement : nb de caisse × m²/caisse de la référence sélectionnée.</div>
    </div>

    <div class="card details-card">
      <div class="toolbar"><h2 class="section-title" style="margin:0">Détails du bon d'entrée</h2><span class="pill">${fmt(totalMetrage)} m²</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>BL</th><th>Fournisseur</th><th>Transporteur</th><th>Chauffeur</th><th>Matricule</th><th>Référence</th><th>Format</th><th>Nb de caisse</th><th>Total m²</th><th></th></tr></thead>
          <tbody>
            ${d.lines.map(l => `<tr>
              <td>${esc(d.date)}</td>
              <td>${esc(d.bl||'')}</td>
              <td>${esc(d.fournisseur||'')}</td>
              <td>${esc(displayTransporterLabel(d.transporteur||''))}</td>
              <td>${esc(d.chauffeur||'')}</td>
              <td>${esc(d.matricule||'')}</td>
              <td class="mono">${esc(l.reference)}</td>
              <td>${esc(l.format)}</td>
              <td>${Number(l.boxes||0)||''}</td>
              <td class="line-total">${fmt(l.metrage)}</td>
              <td class="right"><div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="secondary" onclick="editReceptionLine('${l.id}')">Modifier</button><button class="secondary" onclick="removeReceptionLine('${l.id}')">Supprimer</button></div></td>
            </tr>`).join('') || `<tr><td colspan="11" class="muted">Aucune ligne pour le moment.</td></tr>`}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="8" class="right">Totaux</th>
              <th>${totalBoxes || ''}</th>
              <th>${fmt(totalMetrage)}</th>
              <th></th>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="footer-actions">
        <button class="success" onclick="validateReception()">Valider le bon de réception</button>
      </div>
    </div>`;
  onReceptionTransporterChange();
}
function addReceptionLine(){
  const refId = document.getElementById('rec_ref_id').value; const ref = getReferenceById(refId);
  const boxes = Number(document.getElementById('rec_line_boxes').value || 0);
  const metrage = round2(boxes * Number(ref?.m2ParCaisse || 0));
  const currentHeader = getReceptionHeaderSnapshot();
  if(!ref){ alert('Choisis une référence.'); return; }
  if(!currentHeader.fournisseur){ alert("Choisis le fournisseur / usine avant d'ajouter une ligne."); return; }
  if(boxes <= 0){ alert('Le nombre de caisse doit être supérieur à 0.'); return; }
  if(metrage <= 0){ alert('Impossible de calculer le total m² pour cette référence. Vérifie le m²/caisse dans la Base.'); return; }
  const exists = state.receptionDraft.lines.some(l => String(l.referenceId||'') === String(ref.id||''));
  if(exists){ alert('Cette référence existe déjà dans ce bon. Utilise le bouton Modifier sur la ligne existante.'); return; }
  if(state.receptionDraft.lines.length){
    const locked = state.receptionDraft.headerLock || currentHeader;
    if(!sameReceptionHeader(locked, currentHeader)){
      alert("Tu ne peux pas ajouter une ligne avec un autre fournisseur, transporteur, chauffeur, matricule, date ou BL dans le même bon. Valide d'abord le bon actuel.");
      return;
    }
  }else{
    state.receptionDraft.headerLock = currentHeader;
  }
  state.receptionDraft.lines.push({id:uid(),referenceId:ref.id,reference:ref.reference,designation:'',format:ref.format,m2ParCaisse:Number(ref.m2ParCaisse||0),boxes:boxes||0,metrage});
  document.getElementById('rec_ref_search').value=''; document.getElementById('rec_ref_id').value=''; document.getElementById('rec_line_metrage').value=''; document.getElementById('rec_line_boxes').value='';
  saveState(); renderReception();
}
function removeReceptionLine(id){ state.receptionDraft.lines = state.receptionDraft.lines.filter(l => l.id!==id); if(!state.receptionDraft.lines.length){ state.receptionDraft.headerLock = null; } saveState(); renderReception(); }
function editReceptionLine(id){
  const line = state.receptionDraft.lines.find(l => l.id===id);
  if(!line) return;
  state.receptionDraft.lines = state.receptionDraft.lines.filter(l => l.id!==id);
  if(!state.receptionDraft.lines.length){ state.receptionDraft.headerLock = null; }
  saveState();
  renderReception();
  const refSearch = document.getElementById('rec_ref_search');
  const refId = document.getElementById('rec_ref_id');
  const boxes = document.getElementById('rec_line_boxes');
  const metrage = document.getElementById('rec_line_metrage');
  if(refSearch) refSearch.value = line.reference || '';
  if(refId) refId.value = line.referenceId || '';
  if(boxes) boxes.value = Number(line.boxes || 0) || '';
  if(metrage) metrage.value = Number(line.metrage || 0) || '';
}
function newReceptionDraft(){
  state.receptionDraft = {number:nextNumber('BR'),date:todayStr(),bl:'',fournisseur:'',transporteur:'',chauffeur:'',matricule:'',lines:[],headerLock:null,editingArchiveId:null,editingOriginal:null}; saveState(); renderReception();
}
function resetReceptionDraft(){ newReceptionDraft(); }
function validateReception(){
  const d = state.receptionDraft;
  if(!d.lines.length){ alert('Ajoute au moins une ligne.'); return; }
  let archivedDoc;
  if(d.editingArchiveId){
    const idx = state.receptions.findIndex(x => x.id === d.editingArchiveId);
    if(idx === -1){ alert("Le bon d'archive à modifier est introuvable."); return; }
    const original = state.receptions[idx];
    archivedDoc = {...JSON.parse(JSON.stringify(d)), id:original.id, number:original.number, sequence:original.sequence, createdAt:original.createdAt, status:'validé', editingArchiveId:null, editingOriginal:null};
    state.receptions[idx] = archivedDoc;
  }else{
    const num = consumeNextNumber('BR');
    archivedDoc = {...JSON.parse(JSON.stringify(d)), id:uid(), number:num.number, sequence:num.sequence, createdAt:new Date().toISOString(), status:'validé', editingArchiveId:null, editingOriginal:null};
    state.receptions.unshift(archivedDoc);
  }
  state.receptionDraft = {number:nextNumber('BR'),date:todayStr(),bl:'',fournisseur:'',transporteur:'',chauffeur:'',matricule:'',lines:[],headerLock:null,editingArchiveId:null,editingOriginal:null};
  saveState();
  openPrint(buildReceptionDoc(archivedDoc));
  alert(d.editingArchiveId ? 'Bon de réception modifié, imprimé et archivé.' : 'Bon de réception validé, imprimé et archivé.');
  renderReception();
}

function renderSortie(){
  const d = state.sortieDraft;
  const currentClient = getClientByCode(d.clientCode);
  document.getElementById('view').innerHTML = `
    <div class="card">
      <div class="toolbar"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 class="section-title" style="margin:0">Bon de sortie</h2>${d.editingArchiveId ? '<span class="tag warn-tag">Modification archive</span>' : ''}</div><button class="secondary" onclick="newSortieDraft()">Nouveau bon</button></div>
      <div class="subtitle">Saisie des marchandises sorties du dépôt avec calcul automatique du métrage et validation souple.</div>
      <div class="row">
        <div><label>N° bon</label><input value="${esc(d.number)}" readonly></div>
        <div><label>Date</label><input type="date" value="${esc(d.date)}" onchange="state.sortieDraft.date=this.value;saveState()"></div>
        <div><label>Type client</label><select onchange="changeClientType(this.value)"><option value="divers" ${d.clientType==='divers'?'selected':''}>Client divers</option><option value="compte" ${d.clientType==='compte'?'selected':''}>Client à compte</option></select></div>
        <div>${d.clientType==='compte' ? `<label>Code client</label><select onchange="selectClientCode(this.value)"><option value="">Choisir</option>${state.clients.map(c=>`<option value="${esc(c.code)}" ${d.clientCode===c.code?'selected':''}>${esc(c.code)} - ${esc(c.nom)}</option>`).join('')}</select>` : `<label>Nom client divers</label><input value="${esc(d.clientNom)}" oninput="state.sortieDraft.clientNom=this.value;saveState()">`}</div>
      </div>
      ${d.clientType==='compte' ? `<div class="row" style="margin-top:12px"><div><label>Nom client</label><input readonly value="${esc(currentClient?.nom || d.clientNom || '')}"></div><div><label>Téléphone</label><input readonly value="${esc(currentClient?.telephone || '')}"></div><div><label>Adresse</label><input readonly value="${esc(currentClient?.adresse || '')}"></div><div></div></div>` : ''}
    </div>

    <div class="card entry-card">
      <div class="toolbar"><h2 class="section-title" style="margin:0">Ajouter une ligne sortie</h2></div>
      <div class="row">
        <div>
          <label>Référence</label>
          <div class="autocomplete">
            <input id="sort_ref_search" placeholder="Tape la référence" oninput="renderRefSuggestions('sort');updateSortieLineTotals()" onfocus="renderRefSuggestions('sort')" autocomplete="off">
            <div id="sortSuggestions" class="autocomplete-list hidden"></div>
          </div>
          <input type="hidden" id="sort_ref_id">
        </div>
        <div><label>Nb de caisse</label><input id="sort_line_boxes" type="number" step="1" oninput="updateSortieLineTotals()"></div>
        <div><label>m² / caisse</label><input id="sort_line_m2caisse" readonly></div>
        <div><label>Total m²</label><input id="sort_line_metrage" readonly></div>
        <div style="display:flex;align-items:end"><button class="success w-100" onclick="addSortieLine()">Ajouter la ligne</button></div>
      </div>
    </div>

    <div class="card details-card">
      <div class="toolbar"><h2 class="section-title" style="margin:0">Lignes du bon</h2><span class="pill">${d.lines.length} ligne(s)</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Référence</th><th>Format</th><th>Stock dispo</th><th>Nb caisse</th><th>Total m²</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            ${d.lines.map(l => {
              const stock = computeStockRows().find(s => s.id===l.referenceId)?.stock || 0;
              const status = stock >= Number(l.metrage||0) ? `<span class="tag ok">OK</span>` : `<span class="tag bad">Stock insuffisant</span>`;
              return `<tr>
                <td class="mono">${esc(l.reference)}</td><td>${esc(l.format)}</td><td>${fmt(stock)}</td><td>${Number(l.boxes||0)||''}</td><td class="line-total">${fmt(l.metrage)}</td><td>${status}</td><td class="right"><div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="secondary" onclick="editSortieLine('${l.id}')">Modifier</button><button class="secondary" onclick="removeSortieLine('${l.id}')">Supprimer</button></div></td>
              </tr>`;
            }).join('') || `<tr><td colspan="7" class="muted">Aucune ligne saisie.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="footer-actions">
        <button class="success" onclick="validateSortie()">Valider le bon</button>
      </div>
    </div>`;
  setTimeout(updateSortieLineTotals, 0);
}
function changeClientType(v){ state.sortieDraft.clientType = v; state.sortieDraft.clientCode=''; state.sortieDraft.clientNom=''; saveState(); renderSortie(); }
function selectClientCode(code){
  state.sortieDraft.clientCode = code; const c = getClientByCode(code); state.sortieDraft.clientNom = c?.nom || ''; saveState(); renderSortie();
}
function updateSortieLineTotals(){
  const refIdEl = document.getElementById('sort_ref_id');
  const boxesEl = document.getElementById('sort_line_boxes');
  const m2El = document.getElementById('sort_line_m2caisse');
  const totalEl = document.getElementById('sort_line_metrage');
  if(!refIdEl || !boxesEl || !m2El || !totalEl) return;
  const ref = getReferenceById(refIdEl.value);
  const boxes = Number(boxesEl.value || 0);
  const m2c = Number(ref?.m2ParCaisse || 0);
  m2El.value = m2c ? fmt(m2c) : '';
  totalEl.value = (ref && boxes > 0) ? fmt(round2(boxes * m2c)) : '';
}
function addSortieLine(){
  const refId = document.getElementById('sort_ref_id').value; const ref = getReferenceById(refId);
  const boxes = Number(document.getElementById('sort_line_boxes').value || 0);
  const metrage = round2(boxes * Number(ref?.m2ParCaisse || 0));
  if(!ref){ alert('Choisis une référence.'); return; }
  if(boxes <= 0){ alert('Le nombre de caisse doit être supérieur à 0.'); return; }
  if(metrage <= 0){ alert('Le total m² doit être supérieur à 0. Vérifie la référence sélectionnée.'); return; }
  const exists = state.sortieDraft.lines.some(l => String(l.referenceId||'') === String(ref.id||''));
  if(exists){ alert('Cette référence existe déjà dans ce bon. Utilise le bouton Modifier sur la ligne existante.'); return; }
  state.sortieDraft.lines.push({id:uid(),referenceId:ref.id,reference:ref.reference,designation:'',format:ref.format,boxes:boxes||0,metrage:metrage});
  document.getElementById('sort_ref_search').value=''; document.getElementById('sort_ref_id').value=''; document.getElementById('sort_line_metrage').value=''; document.getElementById('sort_line_boxes').value=''; document.getElementById('sort_line_m2caisse').value='';
  saveState(); renderSortie();
}
function removeSortieLine(id){ state.sortieDraft.lines = state.sortieDraft.lines.filter(l => l.id!==id); saveState(); renderSortie(); }
function editSortieLine(id){
  const line = state.sortieDraft.lines.find(l => l.id===id);
  if(!line) return;
  state.sortieDraft.lines = state.sortieDraft.lines.filter(l => l.id!==id);
  saveState();
  renderSortie();
  const refSearch = document.getElementById('sort_ref_search');
  const refId = document.getElementById('sort_ref_id');
  const metrage = document.getElementById('sort_line_metrage');
  const boxes = document.getElementById('sort_line_boxes');
  const m2caisse = document.getElementById('sort_line_m2caisse');
  if(refSearch) refSearch.value = line.reference || '';
  if(refId) refId.value = line.referenceId || '';
  if(boxes) boxes.value = Number(line.boxes || 0) || '';
  updateSortieLineTotals();
  if(metrage) metrage.value = Number(line.metrage || 0) ? fmt(Number(line.metrage || 0)) : '';
  if(m2caisse){
    const ref = getReferenceById(line.referenceId);
    m2caisse.value = ref?.m2ParCaisse ? fmt(Number(ref.m2ParCaisse || 0)) : '';
  }
}
function newSortieDraft(){ state.sortieDraft = {number:nextNumber('BS'),date:todayStr(),clientType:'divers',clientCode:'',clientNom:'',observation:'',lines:[]}; saveState(); renderSortie(); }
function validateSortie(){
  const d = state.sortieDraft;
  if(!d.lines.length){ alert('Ajoute au moins une ligne.'); return; }
  if(d.clientType==='compte' && !d.clientCode){ alert('Choisis un client à compte.'); return; }
  const stockRows = computeStockRows();
  for(const l of d.lines){
    const available = stockRows.find(s => s.id===l.referenceId)?.stock || 0;
    if(Number(l.metrage||0) > available){
      const proceed = confirm(`Stock insuffisant pour ${l.reference}. Disponible : ${fmt(available)} m².

Cliquer sur OK pour valider quand même, ou Annuler pour revenir au bon.`);
      if(!proceed) return;
    }
  }
  let archived;
  if(d.editingArchiveId){
    const idx = state.sorties.findIndex(x => x.id === d.editingArchiveId);
    if(idx === -1){ alert("Le bon d'archive à modifier est introuvable."); return; }
    const original = state.sorties[idx];
    archived = {...JSON.parse(JSON.stringify(d)), id:original.id, number:original.number, sequence:original.sequence, createdAt:original.createdAt, status:'validé', editingArchiveId:null, editingOriginal:null};
    state.sorties[idx] = archived;
  }else{
    const num = consumeNextNumber('BS');
    archived = {...JSON.parse(JSON.stringify(d)), id:uid(), number:num.number, sequence:num.sequence, createdAt:new Date().toISOString(), status:'validé', editingArchiveId:null, editingOriginal:null};
    state.sorties.unshift(archived);
  }
  state.sortieDraft = {number:nextNumber('BS'),date:todayStr(),clientType:'divers',clientCode:'',clientNom:'',observation:'',lines:[],editingArchiveId:null,editingOriginal:null};
  saveState();
  openPrint(buildSortieDoc(archived));
  alert(d.editingArchiveId ? 'Bon de sortie modifié, imprimé et archivé.' : 'Bon de sortie validé, imprimé et archivé.');
  renderSortie();
}

function renderEtat(){
  const q = getGlobalQuery();
  const stockQ = (state.stockSearch || '').trim().toLowerCase();
  const rows = computeStockRows()
    .filter(r => !q || [r.reference,r.format,r.marque,getSupplierBrand(r.marque),r.choix].join(' ').toLowerCase().includes(q))
    .filter(r => !stockQ || [r.reference,r.format,r.marque,getSupplierBrand(r.marque)].join(' ').toLowerCase().includes(stockQ))
    .sort((a,b) => b.stock - a.stock);
  const totalStock = round2(rows.reduce((s,r)=>s+r.stock,0));
  const totalCaisses = round2(rows.reduce((s,r)=>s+r.stockCaisses,0));
  const totalPalettes = round2(rows.reduce((s,r)=>s+r.stockPalettes,0));
  document.getElementById('view').innerHTML = `
    <div class="card">
      <div class="toolbar"><h2 class="section-title" style="margin:0">État de stock du dépôt</h2><button class="info" onclick="printStockState()">Imprimer état de stock</button></div>
      <div class="row-2">
        <div>
          <label>Recherche par référence / format / fournisseur</label>
          <input id="stockSearchInput" value="${esc(state.stockSearch || '')}" placeholder="Ex: 60x60, Super Cerame, SC-..." oninput="setStockSearch(this.value)" />
        </div>
        <div class="stats" style="margin-top:24px">
          <div class="stat"><div class="label">Stock</div><div class="value">${fmt(totalStock)}</div></div>
          <div class="stat"><div class="label">Nb caisse</div><div class="value">${fmt(totalCaisses)}</div></div>
          <div class="stat"><div class="label">Nb palette</div><div class="value">${fmt(totalPalettes)}</div></div>
          <div class="stat"><div class="label">Références actives</div><div class="value">${rows.length}</div></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Référence</th><th>Format</th><th>Fournisseur</th><th>Stock</th><th>Nb caisse</th><th>Nb palette</th><th>État</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td class="mono">${esc(r.reference)}</td><td>${esc(r.format)}</td><td>${esc(r.marque)}${getSupplierBrand(r.marque) && getSupplierBrand(r.marque)!==r.marque ? ' <span class="muted small">(' + esc(getSupplierBrand(r.marque)) + ')</span>' : ''}</td><td class="line-total">${fmt(r.stock)}</td><td>${fmt(r.stockCaisses)}</td><td>${fmt(r.stockPalettes)}</td><td>${r.stock<0?'<span class="tag bad">Négatif</span>':r.stock===0?'<span class="tag warn-tag">Épuisé</span>':r.stock<20?'<span class="tag warn-tag">Faible</span>':'<span class="tag ok">Correct</span>'}</td>
            </tr>`).join('') || `<tr><td colspan="7" class="muted">Aucune donnée de stock.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}
function getSyntheseBounds(period){
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  if(period === 'day'){
    const dayValue = state.syntheseDay || todayStr();
    const start = new Date(`${dayValue}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, label:`Jour sélectionné · ${start.toLocaleDateString('fr-FR')}` };
  }
  if(period === 'month'){
    const monthValue = (state.syntheseMonth || todayStr().slice(0,7)).split('-');
    const y = Number(monthValue[0]) || currentYear;
    const m = (Number(monthValue[1]) || (currentMonth+1)) - 1;
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 1);
    return { start, end, label:`Mois sélectionné · ${start.toLocaleDateString('fr-FR', { month:'long', year:'numeric' })}` };
  }
  if(period === 'quarter'){
    const qValue = state.syntheseQuarter || `${currentYear}-T${Math.floor(currentMonth/3)+1}`;
    const m = /^(\d{4})-T([1-4])$/.exec(qValue);
    const y = m ? Number(m[1]) : currentYear;
    const q = m ? Number(m[2]) : (Math.floor(currentMonth/3)+1);
    const startMonth = (q - 1) * 3;
    const start = new Date(y, startMonth, 1);
    const end = new Date(y, startMonth + 3, 1);
    return { start, end, label:`Trimestre sélectionné · T${q} ${y}` };
  }
  const yearValue = Number(state.syntheseYear) || currentYear;
  const start = new Date(yearValue, 0, 1);
  const end = new Date(yearValue + 1, 0, 1);
  return { start, end, label:`Année sélectionnée · ${yearValue}` };
}
function syntheseSelectorHtml(period){
  if(period === 'day'){
    return `<div><label>Choisir le jour</label><input type="date" value="${esc(state.syntheseDay || todayStr())}" onchange="setSyntheseSelector('day', this.value)"></div>`;
  }
  if(period === 'month'){
    return `<div><label>Choisir le mois</label><input type="month" value="${esc(state.syntheseMonth || todayStr().slice(0,7))}" onchange="setSyntheseSelector('month', this.value)"></div>`;
  }
  if(period === 'quarter'){
    const y = new Date().getFullYear();
    const selected = state.syntheseQuarter || `${y}-T${Math.floor(new Date().getMonth()/3)+1}`;
    const years = [y-2,y-1,y,y+1];
    const opts = years.flatMap(yr => [1,2,3,4].map(q => {
      const val = `${yr}-T${q}`;
      return `<option value="${val}" ${selected===val?'selected':''}>T${q} ${yr}</option>`;
    })).join('');
    return `<div><label>Choisir le trimestre</label><select onchange="setSyntheseSelector('quarter', this.value)">${opts}</select></div>`;
  }
  const currentYear = new Date().getFullYear();
  const selectedYear = String(state.syntheseYear || currentYear);
  const yearOptions = Array.from({length:7}, (_,i) => String(currentYear - 3 + i)).map(val => `<option value="${val}" ${selectedYear===val?'selected':''}>${val}</option>`).join('');
  return `<div><label>Choisir l'année</label><select onchange="setSyntheseSelector('year', this.value)">${yearOptions}</select></div>`;
}
function isDocActive(doc){ return (doc.status || 'validated') !== 'cancelled'; }
function docDateInBounds(dateStr, bounds){
  const d = new Date((dateStr || '') + 'T00:00:00');
  if(Number.isNaN(d.getTime())) return false;
  return d >= bounds.start && d < bounds.end;
}

function getSyntheseData(){
  const period = state.synthesePeriod || 'month';
  const bounds = getSyntheseBounds(period);
  const refMap = new Map((state.references || []).map(r => [r.id, r]));
  const byFormat = {};
  const byRef = {};
  const receptionDetails = [];
  const sortieDetails = [];
  let totalIn = 0;
  let totalOut = 0;
  let nbReceptions = 0;
  let nbSorties = 0;

  (state.receptions || []).forEach(doc => {
    if(!isDocActive(doc) || !docDateInBounds(doc.date, bounds)) return;
    nbReceptions++;
    (doc.lines || []).forEach(line => {
      const ref = refMap.get(line.referenceId) || {};
      const format = line.format || ref.format || '';
      const fournisseur = line.marque || ref.marque || '';
      const metrage = round2(Number(line.metrage) || 0);
      totalIn = round2(totalIn + metrage);
      const key = line.referenceId || line.reference || '';
      if(!byRef[key]) byRef[key] = { label: line.reference || ref.reference || '', valueIn: 0, valueOut: 0, format, fournisseur };
      byRef[key].valueIn = round2(byRef[key].valueIn + metrage);
      receptionDetails.push({date:doc.date || '', number:doc.number || '', reference:line.reference || ref.reference || '', format, fournisseur, tiers:doc.fournisseur || '', caisses: round2(Number(line.boxes)||0), metrage});
    });
  });

  (state.sorties || []).forEach(doc => {
    if(!isDocActive(doc) || !docDateInBounds(doc.date, bounds)) return;
    nbSorties++;
    (doc.lines || []).forEach(line => {
      const ref = refMap.get(line.referenceId) || {};
      const format = line.format || ref.format || '';
      const fournisseur = line.marque || ref.marque || '';
      const metrage = round2(Number(line.metrage) || 0);
      totalOut = round2(totalOut + metrage);
      const key = line.referenceId || line.reference || '';
      if(!byRef[key]) byRef[key] = { label: line.reference || ref.reference || '', valueIn: 0, valueOut: 0, format, fournisseur };
      byRef[key].valueOut = round2(byRef[key].valueOut + metrage);
      byFormat[format || 'Sans format'] = round2((byFormat[format || 'Sans format'] || 0) + metrage);
      sortieDetails.push({date:doc.date || '', number:doc.number || '', reference:line.reference || ref.reference || '', format, fournisseur, tiers:doc.clientNom || (doc.clientType === 'divers' ? 'Client divers' : doc.clientCode || ''), caisses: round2(Number(line.boxes)||0), metrage});
    });
  });

  const totalStock = round2(computeStockRows().reduce((s,r)=>s+r.stock,0));
  const topRefs = Object.values(byRef).filter(x=>x.valueOut>0).sort((a,b)=>b.valueOut-a.valueOut).slice(0,8);
  const topFormats = Object.entries(byFormat).map(([label,value])=>({label,value})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
  return {period,bounds,totalIn,totalOut,totalStock,nbReceptions,nbSorties,topRefs,topFormats,receptionDetails,sortieDetails};
}

function printSynthese(){
  const data = getSyntheseData();
  const inRows = data.receptionDetails.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.number)}</td><td>${esc(r.reference)}</td><td>${esc(r.format)}</td><td>${esc(r.fournisseur)}</td><td>${esc(r.tiers)}</td><td>${fmt(r.caisses)}</td><td><strong>${fmt(r.metrage)} m²</strong></td></tr>`).join('') || `<tr><td colspan="8" style="text-align:center;color:#6b7280">Aucune entrée sur cette période.</td></tr>`;
  const outRows = data.sortieDetails.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.number)}</td><td>${esc(r.reference)}</td><td>${esc(r.format)}</td><td>${esc(r.fournisseur)}</td><td>${esc(r.tiers)}</td><td>${fmt(r.caisses)}</td><td><strong>${fmt(r.metrage)} m²</strong></td></tr>`).join('') || `<tr><td colspan="8" style="text-align:center;color:#6b7280">Aucune sortie sur cette période.</td></tr>`;
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Synthèse dépôt</title><style>
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;color:#111827;background:#fff;padding:18px}
    .doc-page{max-width:1020px;margin:0 auto}
    .panel{border:1px solid #d9dde3;border-radius:18px;background:#fff;padding:18px 20px;margin-bottom:14px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
    .brand{display:flex;align-items:center;font-size:24px}.brand img{width:84px !important;height:auto !important;max-width:84px !important;max-height:none !important;display:block;object-fit:contain}
    .title{font-size:24px;font-weight:800;text-align:center;margin:14px 0 6px}
    .sub{text-align:center;font-size:13px;color:#4b5563}
    .stats{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:12px;margin-top:14px}
    .stat{border:1px solid #d9dde3;border-radius:14px;padding:12px 14px;text-align:center}
    .stat .label{font-size:12px;color:#6b7280;margin-bottom:6px}
    .stat .value{font-size:20px;font-weight:800}
    .section{font-size:18px;font-weight:800;margin:18px 0 10px}
    .table-shell{border:1px solid #d9dde3;border-radius:14px;overflow:hidden;background:#fff;margin-top:8px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:10px 11px;font-size:13px;text-align:left;border-bottom:1px solid #e8ebef;vertical-align:middle}
    th{background:#f8fafc;font-weight:700}
    tbody tr:last-child td{border-bottom:none}
    .small{font-size:12px;color:#6b7280}
    @page{size:A4 portrait;margin:10mm}
    @media print{body{padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.doc-page{max-width:none}.section,.stats,.stat,.head,.brand,.title,.sub{break-inside:avoid;page-break-inside:avoid}thead{display:table-header-group}tfoot{display:table-footer-group}tr,td,th{break-inside:avoid;page-break-inside:avoid}}
  
  .search-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .icon-btn{min-width:44px;padding:10px 12px;font-size:18px;line-height:1}

  .role-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:12px;font-weight:800}
  .role-badge .dot{width:10px;height:10px;border-radius:999px;background:#166534;display:inline-block}
  .role-note{font-size:12px;color:var(--muted);margin-top:6px}
  .sync-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:12px;font-weight:800}
  .sync-badge.off{background:#f8fafc;border-color:#cbd5e1;color:#475569}
  .sync-dot{width:10px;height:10px;border-radius:999px;background:#22c55e;display:inline-block}
  .sync-badge.off .sync-dot{background:#94a3b8}
  .sync-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  .sync-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}

  .synthese-periods button{background:rgba(255,255,255,.76);color:#1d4ed8 !important;border:1px solid rgba(59,130,246,.35)}
  .synthese-periods button.primary{background:#2563eb;color:#fff !important;border-color:#2563eb}
  .synthese-periods button.ghost{background:rgba(255,255,255,.76);color:#1d4ed8 !important;border:1px solid rgba(59,130,246,.35)}
  body.dark .synthese-periods button{background:transparent;color:#60a5fa !important;border:1px solid #2563eb}
  body.dark .synthese-periods button.primary{background:#2563eb;color:#fff !important;border-color:#2563eb}
  body.dark .synthese-periods button.ghost{background:transparent;color:#60a5fa !important;border:1px solid #2563eb}
  body.dark{
    --bg:#0b1220;
    --card:#0f172a;
    --text:#e5eef8;
    --muted:#8ea3b8;
    --line:#243244;
    --accent:#1d4ed8;
    --ok:#86efac;
    --okbg:#052e16;
    --bad:#fecaca;
    --badbg:#450a0a;
    --warn:#fde68a;
    --warnbg:#451a03;
    --blue:#bfdbfe;
    --bluebg:#172554;
  }
  body.dark{background:radial-gradient(circle at top,#132033 0%,#0b1220 55%,#09101b 100%);color:var(--text)}
  body.dark .brand,
  body.dark .card,
  body.dark .table-wrap,
  body.dark .stat,
  body.dark table,
  body.dark .tab,
  body.dark button.secondary,
  body.dark .btn.secondary,
  body.dark input,
  body.dark select,
  body.dark textarea,
  body.dark .notice,
  body.dark .pill{background:#0f172a;color:var(--text);border-color:#243244}
  body.dark .tab.active{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
  body.dark th{background:#111c31;color:#9fb3c8}
  body.dark td{border-bottom-color:#243244}
  body.dark .autocomplete-list{background:#0f172a;border-color:#243244}
  body.dark .autocomplete-item{border-bottom-color:#1b2940}
  body.dark .autocomplete-item:hover,body.dark .autocomplete-item.active{background:#14213a}
  body.dark .collapse-head .arrow,body.dark .muted,body.dark .small,label{color:inherit}
  body.dark .doc{background:#fff;color:#111827}
  body.dark .doc-head, body.dark .doc table, body.dark .doc th, body.dark .doc td, body.dark .doc .sign{color:#111827}
  body.dark .search-top{align-items:center}
  body.dark #themeToggleBtn{align-self:center}

</style></head><body><div class="doc-page"><div class="panel"><div class="head"><div class="brand"><img class="oramed-logo-img" src="data:image/png;base64,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" alt="ORAMED"></div><div class="small"><div><strong>Période :</strong> ${esc(data.bounds.label)}</div><div><strong>Date d'impression :</strong> ${esc(todayStr())}</div></div></div><div class="title">SYNTHÈSE DÉPÔT</div><div class="sub">Métrage entré, métrage sorti et détails de la période sélectionnée.</div><div class="stats"><div class="stat"><div class="label">Métrage entré</div><div class="value">${fmt(data.totalIn)} m²</div></div><div class="stat"><div class="label">Métrage sorti</div><div class="value">${fmt(data.totalOut)} m²</div></div><div class="stat"><div class="label">Stock actuel</div><div class="value">${fmt(data.totalStock)} m²</div></div></div></div><div class="section">Détail des entrées</div><div class="table-shell"><table><thead><tr><th>Date</th><th>N° bon</th><th>Référence</th><th>Format</th><th>Fournisseur</th><th>Tiers</th><th>Nb caisse</th><th>Total m²</th></tr></thead><tbody>${inRows}</tbody></table></div><div class="section">Détail des sorties</div><div class="table-shell"><table><thead><tr><th>Date</th><th>N° bon</th><th>Référence</th><th>Format</th><th>Fournisseur</th><th>Client</th><th>Nb caisse</th><th>Total m²</th></tr></thead><tbody>${outRows}</tbody></table></div></div></body></html>`;
  printInline(html, 'Synthèse dépôt');
}

function renderSynthese(mountId='view'){
  const target = document.getElementById(mountId) || document.getElementById('view');
  const data = getSyntheseData();
  target.innerHTML = `
    <div class="card">
      <div class="toolbar" style="align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <h2 class="section-title">Synthèse dépôt</h2>
          <div class="subtitle">Lecture par période : jour, mois, trimestre ou année.</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
          <div class="segmented">
            <button class="${data.period==='day'?'primary':'ghost'}" onclick="setSynthesePeriod('day')">Jour</button>
            <button class="${data.period==='month'?'primary':'ghost'}" onclick="setSynthesePeriod('month')">Mois</button>
            <button class="${data.period==='quarter'?'primary':'ghost'}" onclick="setSynthesePeriod('quarter')">Trimestre</button>
            <button class="${data.period==='year'?'primary':'ghost'}" onclick="setSynthesePeriod('year')">Année</button>
          </div>
          <button class="info" onclick="printSynthese()">Imprimer la synthèse</button>
        </div>
      </div>
      <div class="row-2" style="margin-top:10px">
        ${syntheseSelectorHtml(data.period)}
        <div class="notice">Choisis d'abord le type de période, puis sélectionne précisément le jour, le mois, le trimestre ou l'année à analyser.</div>
      </div>
      <div class="notice" style="margin-top:10px">Période analysée : <strong>${esc(data.bounds.label)}</strong></div>
      <div class="stats">
        <div class="stat"><div class="label">Métrage entré</div><div class="value">${fmt(data.totalIn)}</div></div>
        <div class="stat"><div class="label">Métrage sorti</div><div class="value">${fmt(data.totalOut)}</div></div>
        <div class="stat"><div class="label">Stock actuel</div><div class="value">${fmt(data.totalStock)}</div></div>
        <div class="stat"><div class="label">Bons traités</div><div class="value">${data.nbReceptions + data.nbSorties}</div></div>
      </div>
    </div>
    <div class="split">
      <div class="card">
        <h2 class="section-title">Marchandise vendue par référence</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Référence</th><th>Format</th><th>Fournisseur</th><th>Métrage vendu</th></tr></thead>
            <tbody>
              ${data.topRefs.map(r=>`<tr><td>${esc(r.label)}</td><td>${esc(r.format)}</td><td>${esc(r.fournisseur)}</td><td class="line-total">${fmt(r.valueOut)}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">Aucune sortie enregistrée sur cette période.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h2 class="section-title">Formats qui sortent le plus</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Format</th><th>Métrage vendu</th><th>Lecture</th></tr></thead>
            <tbody>
              ${data.topFormats.map(f=>`<tr><td>${esc(f.label)}</td><td class="line-total">${fmt(f.value)}</td><td>${data.topFormats[0]?.label===f.label?'<span class="tag ok">Top rotation</span>':'<span class="tag info-tag">À suivre</span>'}</td></tr>`).join('') || `<tr><td colspan="3" class="muted">Aucune sortie enregistrée sur cette période.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="card">
      <h2 class="section-title">Lecture métier</h2>
      <div class="notice">
        Cette zone sert à contrôler le dépôt selon la période choisie. Le métrage entré et le métrage sorti sont recalculés sur le jour, le mois, le trimestre ou l’année. Le <strong>stock actuel</strong> reste le stock théorique global du dépôt à l’instant présent. Le bouton d'impression sort une fiche détaillée avec les entrées et les sorties de la période.
      </div>
    </div>`;
}
function setSynthesePeriod(period){ state.synthesePeriod = period; saveState(); renderSynthese(); }
function setSyntheseSelector(type, value){
  if(type === 'day') state.syntheseDay = value || todayStr();
  if(type === 'month') state.syntheseMonth = value || todayStr().slice(0,7);
  if(type === 'quarter') state.syntheseQuarter = value || `${new Date().getFullYear()}-T${Math.floor(new Date().getMonth()/3)+1}`;
  if(type === 'year') state.syntheseYear = value || String(new Date().getFullYear());
  saveState();
  renderSynthese();
}


function renderMouvements(mountId='view'){
  const target = document.getElementById(mountId) || document.getElementById('view');
  const q = getGlobalQuery();
  const refs = state.references.filter(r => !q || [r.reference,r.format].join(' ').toLowerCase().includes(q));
  const currentRefId = state.movementFilterRef || refs[0]?.id || '';
  if(!state.movementFilterRef && currentRefId) state.movementFilterRef = currentRefId;
  const ref = getReferenceById(currentRefId);
  const moves = ref ? computeMovements(ref.id) : [];
  target.innerHTML = `
    <div class="card">
      <h2 class="section-title">Mouvements par référence</h2>
      <div class="subtitle">Utilise cette partie quand le stock système et le stock physique ne correspondent pas.</div>
      <div class="row-2">
        <div>
          <label>Choisir une référence</label>
          <div class="autocomplete">
            <input id="mov_ref_search" value="${esc(ref?.reference || '')}" placeholder="Tape la référence comme dans les bons" oninput="document.getElementById('mov_ref_id').value=''; renderRefSuggestions('mov')" onfocus="renderRefSuggestions('mov')">
            <input type="hidden" id="mov_ref_id" value="${esc(currentRefId)}">
            <div id="movSuggestions" class="autocomplete-list hidden"></div>
          </div>
        </div>
        <div class="notice">Le tableau reconstruit toutes les entrées et toutes les sorties dans l’ordre chronologique afin d’identifier l’origine d’un écart.</div>
      </div>
    </div>
    <div class="card">
      <div class="toolbar"><h2 class="section-title" style="margin:0">${ref ? esc(ref.reference) + ' · ' + esc(ref.format) : 'Aucune référence'}</h2>${ref ? `<button class="info" onclick="printReferenceMoves('${ref.id}')">Imprimer la fiche mouvement</button>` : ''}</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>N° bon</th><th>Tiers</th><th>Mouvement m²</th><th>Stock cumulé</th></tr></thead>
          <tbody>
            ${moves.map(m => `<tr><td>${esc(m.date)}</td><td>${m.type==='ENTRÉE'?'<span class="tag ok">Entrée</span>':'<span class="tag info-tag">Sortie</span>'}</td><td class="mono">${esc(m.number)}</td><td>${esc(m.tiers)}</td><td class="line-total">${m.metrage>0?'+':''}${fmt(m.metrage)}</td><td class="line-total">${fmt(m.running)}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">Aucun mouvement pour cette référence.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}
function changeMovementRef(id){ state.movementFilterRef=id; saveState(); if(state.activeTab==='direction') renderDirection(); else renderMouvements(); }
function setStockSearch(v){
  state.stockSearch = v || '';
  saveState();
  const active = document.activeElement;
  const keepFocus = active && active.id === 'stockSearchInput';
  const start = keepFocus && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  const end = keepFocus && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
  renderEtat();
  if(keepFocus){
    requestAnimationFrame(() => {
      const input = document.getElementById('stockSearchInput');
      if(!input) return;
      input.focus();
      const s = Math.min(start ?? input.value.length, input.value.length);
      const e = Math.min(end ?? input.value.length, input.value.length);
      try { input.setSelectionRange(s, e); } catch(_) {}
    });
  }
}

function renderArchives(){
  const q = getGlobalQuery();
  const receptions = Array.isArray(state.receptions) ? state.receptions.filter(Boolean) : [];
  const sorties = Array.isArray(state.sorties) ? state.sorties.filter(Boolean) : [];
  const safeText = (obj) => {
    try { return JSON.stringify(obj || {}).toLowerCase(); }
    catch(e){ return ''; }
  };
  const recs = receptions.filter(d => !q || safeText(d).includes(q)).sort(byArchiveOrderDesc);
  const outs = sorties.filter(d => !q || safeText(d).includes(q)).sort(byArchiveOrderDesc);
  const recRows = recs.map(d => {
    const linesCount = Array.isArray(d.lines) ? d.lines.length : 0;
    const badge = d.status === 'annulé' ? `<span class="tag bad">ANNULÉ</span>` : `<span class="tag ok">VALIDÉ</span>`;
    const actions = d.status === 'annulé'
      ? `<button class="secondary" onclick="editReceptionArchive('${d.id}')">Modifier</button><button class="danger" onclick="deleteReceptionArchive('${d.id}')">Supprimer</button>`
      : `<button class="secondary" onclick="editReceptionArchive('${d.id}')">Modifier</button><button class="secondary" onclick="printReceptionArchive('${d.id}')">Imprimer</button><button class="danger" onclick="cancelReceptionArchive('${d.id}')">Annuler</button><button class="secondary" onclick="deleteReceptionArchive('${d.id}')">Supprimer</button>`;
    return `<tr><td class="mono">${esc(d.number||'')}</td><td>${esc(d.date||'')}</td><td>${esc(d.bl||'')}</td><td>${esc(d.fournisseur||'')}</td><td>${badge}</td><td>${linesCount}</td><td class="right"><div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">${actions}</div></td></tr>`;
  }).join('') || `<tr><td colspan="7" class="muted">Aucun bon réception archivé.</td></tr>`;
  const outRows = outs.map(d => {
    const linesCount = Array.isArray(d.lines) ? d.lines.length : 0;
    const badge = d.status === 'annulé' ? `<span class="tag bad">ANNULÉ</span>` : `<span class="tag ok">VALIDÉ</span>`;
    const actions = d.status === 'annulé'
      ? `<button class="secondary" onclick="editSortieArchive('${d.id}')">Modifier</button><button class="danger" onclick="deleteSortieArchive('${d.id}')">Supprimer</button>`
      : `<button class="secondary" onclick="editSortieArchive('${d.id}')">Modifier</button><button class="secondary" onclick="printSortieArchive('${d.id}')">Imprimer</button><button class="danger" onclick="cancelSortieArchive('${d.id}')">Annuler</button><button class="secondary" onclick="deleteSortieArchive('${d.id}')">Supprimer</button>`;
    return `<tr><td class="mono">${esc(d.number||'')}</td><td>${esc(d.date||'')}</td><td>${esc(d.clientNom || d.clientCode || '')}</td><td>${badge}</td><td>${linesCount}</td><td class="right"><div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">${actions}</div></td></tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">Aucun bon sortie archivé.</td></tr>`;
  document.getElementById('view').innerHTML = `
    <div class="stack" style="display:grid;gap:16px">
      <details class="card" open>
        <summary class="toolbar" style="cursor:pointer;list-style:none;user-select:none">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:14px">▾</span>
            <h2 class="section-title" style="margin:0">Archives des réceptions</h2>
          </div>
          <span class="pill">${recs.length}</span>
        </summary>
        <div class="table-wrap" style="margin-top:12px">
          <table>
            <thead><tr><th>N° entrée</th><th>Date</th><th>BL</th><th>Fournisseur</th><th>Statut</th><th>Lignes</th><th></th></tr></thead>
            <tbody>${recRows}</tbody>
          </table>
        </div>
      </details>
      <details class="card" open>
        <summary class="toolbar" style="cursor:pointer;list-style:none;user-select:none">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:14px">▾</span>
            <h2 class="section-title" style="margin:0">Archives des sorties</h2>
          </div>
          <span class="pill">${outs.length}</span>
        </summary>
        <div class="table-wrap" style="margin-top:12px">
          <table>
            <thead><tr><th>N° bon</th><th>Date</th><th>Client</th><th>Statut</th><th>Lignes</th><th></th></tr></thead>
            <tbody>${outRows}</tbody>
          </table>
        </div>
      </details>
    </div>`;
}


function buildReceptionDoc(doc){
  const rows = doc.lines.map((l)=>`<tr><td>${esc(l.reference)}</td><td>${Number(l.boxes||0)||''}</td><td>${fmt(l.metrage)} m²</td></tr>`).join('');
  const total = fmt(doc.lines.reduce((s,l)=>s+Number(l.metrage||0),0));
  const source = displayTransporterLabel(doc.transporteur||'');
  const transportLine = [doc.chauffeur||'', doc.matricule||''].filter(Boolean).join(' - ');
  return `<!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="utf-8">
    <title>${esc(doc.number)}</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;font-family:Arial,sans-serif;background:#fff;color:#111827}
      .doc-page{width:210mm;min-height:297mm;margin:0 auto;padding:10mm 12mm 12mm;background:#fff}
      .meta-top{display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:8mm}
      .panel{border:1.2px solid #d3d8de;border-radius:16px;padding:16px 18px;background:#fff}
      .panel + .panel{margin-top:14px}
      .doc-header{display:flex;justify-content:space-between;align-items:center;gap:18px}
      .print-logo-box{flex:1;display:flex;align-items:center}
      .print-logo{width:112px;height:36px;border:1.2px solid #7a7a7a;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#111;background:#fff;overflow:hidden;padding:4px 8px}.print-logo .oramed-logo-img{display:block;max-width:90px;max-height:20px;width:auto !important;height:auto !important;object-fit:contain;aspect-ratio:auto}
      .doc-header-right{min-width:250px;text-align:right}
      .doc-header-right div{font-size:18px;font-weight:700;line-height:1.45}
      .doc-header-right div:first-child{margin-bottom:4px}
      .section-title{margin:0 0 14px 0;font-size:30px;font-weight:800;letter-spacing:.2px;color:#172036}
      .top-info{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;margin-bottom:16px}
      .info-box{border:1.2px solid #d3d8de;border-radius:14px;padding:12px 16px;font-size:18px;min-height:54px;display:flex;align-items:center}
      .info-box.transport{grid-column:1 / 2}
      .table-shell{border:1.2px solid #d3d8de;border-radius:16px;overflow:hidden;margin-top:4px}
      table{width:100%;border-collapse:separate;border-spacing:0;font-size:16px}
      th,td{padding:12px 14px;text-align:left;white-space:nowrap}
      thead th{font-size:16px;font-weight:800;border-bottom:1.2px solid #d8dde3;background:#fff;vertical-align:top}
      tbody td{border-bottom:1px solid #e3e7ec}
      tbody tr:last-child td{border-bottom:none}
      .totals{display:flex;justify-content:flex-end;margin-top:18px}
      .box{border:1.2px solid #d3d8de;border-radius:14px;padding:14px 18px;min-width:270px}
      .box div:first-child{font-size:17px;margin-bottom:4px}
      .box div:last-child{font-size:26px;font-weight:800}
      .signature-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:72px}
      .signature-box{border:1.2px solid #d3d8de;border-radius:14px;min-height:76px;display:flex;align-items:flex-end;justify-content:center;padding:14px;font-size:16px;text-align:center}
      @page{size:A4 portrait;margin:10mm}
      @media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.doc-page{width:auto;min-height:auto;margin:0;padding:0}.totals,.box,.signature-grid,.signature-box,.top-info,.info-box,.doc-header,.meta-top{break-inside:avoid;page-break-inside:avoid}table{width:100%;border-collapse:separate;border-spacing:0}thead{display:table-header-group}tfoot{display:table-footer-group}tr,td,th{break-inside:avoid;page-break-inside:avoid}.signature-grid{page-break-inside:avoid;break-inside:avoid}}
    
  .search-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .icon-btn{min-width:44px;padding:10px 12px;font-size:18px;line-height:1}

  .role-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:12px;font-weight:800}
  .role-badge .dot{width:10px;height:10px;border-radius:999px;background:#166534;display:inline-block}
  .role-note{font-size:12px;color:var(--muted);margin-top:6px}
  .sync-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:12px;font-weight:800}
  .sync-badge.off{background:#f8fafc;border-color:#cbd5e1;color:#475569}
  .sync-dot{width:10px;height:10px;border-radius:999px;background:#22c55e;display:inline-block}
  .sync-badge.off .sync-dot{background:#94a3b8}
  .sync-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  .sync-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}

  .synthese-periods button{background:rgba(255,255,255,.76);color:#1d4ed8 !important;border:1px solid rgba(59,130,246,.35)}
  .synthese-periods button.primary{background:#2563eb;color:#fff !important;border-color:#2563eb}
  .synthese-periods button.ghost{background:rgba(255,255,255,.76);color:#1d4ed8 !important;border:1px solid rgba(59,130,246,.35)}
  body.dark .synthese-periods button{background:transparent;color:#60a5fa !important;border:1px solid #2563eb}
  body.dark .synthese-periods button.primary{background:#2563eb;color:#fff !important;border-color:#2563eb}
  body.dark .synthese-periods button.ghost{background:transparent;color:#60a5fa !important;border:1px solid #2563eb}
  body.dark{
    --bg:#0b1220;
    --card:#0f172a;
    --text:#e5eef8;
    --muted:#8ea3b8;
    --line:#243244;
    --accent:#1d4ed8;
    --ok:#86efac;
    --okbg:#052e16;
    --bad:#fecaca;
    --badbg:#450a0a;
    --warn:#fde68a;
    --warnbg:#451a03;
    --blue:#bfdbfe;
    --bluebg:#172554;
  }
  body.dark{background:radial-gradient(circle at top,#132033 0%,#0b1220 55%,#09101b 100%);color:var(--text)}
  body.dark .brand,
  body.dark .card,
  body.dark .table-wrap,
  body.dark .stat,
  body.dark table,
  body.dark .tab,
  body.dark button.secondary,
  body.dark .btn.secondary,
  body.dark input,
  body.dark select,
  body.dark textarea,
  body.dark .notice,
  body.dark .pill{background:#0f172a;color:var(--text);border-color:#243244}
  body.dark .tab.active{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
  body.dark th{background:#111c31;color:#9fb3c8}
  body.dark td{border-bottom-color:#243244}
  body.dark .autocomplete-list{background:#0f172a;border-color:#243244}
  body.dark .autocomplete-item{border-bottom-color:#1b2940}
  body.dark .autocomplete-item:hover,body.dark .autocomplete-item.active{background:#14213a}
  body.dark .collapse-head .arrow,body.dark .muted,body.dark .small,label{color:inherit}
  body.dark .doc{background:#fff;color:#111827}
  body.dark .doc-head, body.dark .doc table, body.dark .doc th, body.dark .doc td, body.dark .doc .sign{color:#111827}
  body.dark .search-top{align-items:center}
  body.dark #themeToggleBtn{align-self:center}

</style>
  </head>
  <body onload="window.print();setTimeout(()=>window.close(),200);">
    <div class="doc-page">
      <div class="meta-top">
        <div>${esc(new Date().toLocaleDateString('fr-FR'))} ${esc(new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}))}</div>
        <div>${esc(doc.number)}</div>
      </div>
      <div class="panel">
        <div class="doc-header">
          <div class="print-logo-box"><div class="print-logo"><img class="oramed-logo-img" src="data:image/png;base64,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" alt="ORAMED"></div></div>
          <div class="doc-header-right">
            <div>Bon d'entrée</div>
            <div>N° entrée : ${esc(doc.number)}</div>
            <div>Date : ${esc(doc.date)}</div>
            <div>BL : ${esc(doc.bl||'')}</div>
          </div>
        </div>
      </div>
      <div class="panel">
        <h2 class="section-title">BON DE RÉCEPTION</h2>
        <div class="top-info">
          <div class="info-box"><strong>Source :</strong>&nbsp;${esc(source)}</div>
          <div class="info-box"><strong>Fournisseur / Usine :</strong>&nbsp;${esc(doc.fournisseur||'')}</div>
          <div class="info-box transport"><strong>Transporteur :</strong>&nbsp;${esc(transportLine)}</div>
        </div>
        <div class="table-shell">
          <table>
            <colgroup><col style="width:50%"><col style="width:20%"><col style="width:30%"></colgroup>
            <thead><tr><th>Référence</th><th>Nb de caisse</th><th>Total m²</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="totals"><div class="box"><div>Total métrage entrée</div><div>${total} m²</div></div></div>
        <div class="signature-grid"><div class="signature-box">Visa réception</div><div class="signature-box">Visa transport</div><div class="signature-box">Visa magasin</div><div class="signature-box">Visa direction</div></div>
      </div>
    </div>
  </body></html>`;
}

function buildSortieDoc(doc){
  const rows = doc.lines.map((l)=>`<tr><td>${esc(l.reference)}</td><td>${Number(l.boxes||0)||''}</td><td>${fmt(l.metrage)} m²</td></tr>`).join('');
  const total = fmt(doc.lines.reduce((s,l)=>s+Number(l.metrage||0),0));
  const clientTypeLabel = doc.clientType === 'compte' ? 'Client à compte' : 'Client divers';
  const clientLabel = [doc.clientNom || '', doc.clientCode ? `(${doc.clientCode})` : ''].filter(Boolean).join(' ');
  return `<!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="utf-8">
    <title>${esc(doc.number)}</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;font-family:Arial,sans-serif;background:#fff;color:#111827}
      .doc-page{width:210mm;min-height:297mm;margin:0 auto;padding:10mm 12mm 12mm;background:#fff}
      .meta-top{display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:8mm}
      .panel{border:1.2px solid #d3d8de;border-radius:16px;padding:16px 18px;background:#fff}
      .panel + .panel{margin-top:14px}
      .doc-header{display:flex;justify-content:space-between;align-items:center;gap:18px}
      .print-logo-box{flex:1;display:flex;align-items:center}
      .print-logo{width:112px;height:36px;border:1.2px solid #7a7a7a;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#111;background:#fff;overflow:hidden;padding:4px 8px}.print-logo .oramed-logo-img{display:block;max-width:90px;max-height:20px;width:auto !important;height:auto !important;object-fit:contain;aspect-ratio:auto}
      .doc-header-right{min-width:250px;text-align:right}
      .doc-header-right div{font-size:18px;font-weight:700;line-height:1.45}
      .doc-header-right div:first-child{margin-bottom:4px}
      .section-title{margin:0 0 14px 0;font-size:30px;font-weight:800;letter-spacing:.2px;color:#172036}
      .top-info{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;margin-bottom:16px}
      .info-box{border:1.2px solid #d3d8de;border-radius:14px;padding:12px 16px;font-size:18px;min-height:54px;display:flex;align-items:center}
      .info-box.wide{grid-column:1 / span 2}
      .table-shell{border:1.2px solid #d3d8de;border-radius:16px;overflow:hidden;margin-top:4px}
      table{width:100%;border-collapse:separate;border-spacing:0;font-size:16px}
      th,td{padding:12px 14px;text-align:left;white-space:nowrap}
      thead th{font-size:16px;font-weight:800;border-bottom:1.2px solid #d8dde3;background:#fff;vertical-align:top}
      tbody td{border-bottom:1px solid #e3e7ec}
      tbody tr:last-child td{border-bottom:none}
      .totals{display:flex;justify-content:flex-end;margin-top:18px}
      .box{border:1.2px solid #d3d8de;border-radius:14px;padding:14px 18px;min-width:270px}
      .box div:first-child{font-size:17px;margin-bottom:4px}
      .box div:last-child{font-size:26px;font-weight:800}
      .signature-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:72px}
      .signature-box{border:1.2px solid #d3d8de;border-radius:14px;min-height:76px;display:flex;align-items:flex-end;justify-content:center;padding:14px;font-size:16px;text-align:center}
      @page{size:A4 portrait;margin:10mm}
      @media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.doc-page{width:auto;min-height:auto;margin:0;padding:0}.totals,.box,.signature-grid,.signature-box,.top-info,.info-box,.doc-header,.meta-top{break-inside:avoid;page-break-inside:avoid}table{width:100%;border-collapse:separate;border-spacing:0}thead{display:table-header-group}tfoot{display:table-footer-group}tr,td,th{break-inside:avoid;page-break-inside:avoid}.signature-grid{page-break-inside:avoid;break-inside:avoid}}
    
  .search-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .icon-btn{min-width:44px;padding:10px 12px;font-size:18px;line-height:1}

  .role-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:12px;font-weight:800}
  .role-badge .dot{width:10px;height:10px;border-radius:999px;background:#166534;display:inline-block}
  .role-note{font-size:12px;color:var(--muted);margin-top:6px}
  .sync-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:12px;font-weight:800}
  .sync-badge.off{background:#f8fafc;border-color:#cbd5e1;color:#475569}
  .sync-dot{width:10px;height:10px;border-radius:999px;background:#22c55e;display:inline-block}
  .sync-badge.off .sync-dot{background:#94a3b8}
  .sync-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  .sync-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}

  .synthese-periods button{background:rgba(255,255,255,.76);color:#1d4ed8 !important;border:1px solid rgba(59,130,246,.35)}
  .synthese-periods button.primary{background:#2563eb;color:#fff !important;border-color:#2563eb}
  .synthese-periods button.ghost{background:rgba(255,255,255,.76);color:#1d4ed8 !important;border:1px solid rgba(59,130,246,.35)}
  body.dark .synthese-periods button{background:transparent;color:#60a5fa !important;border:1px solid #2563eb}
  body.dark .synthese-periods button.primary{background:#2563eb;color:#fff !important;border-color:#2563eb}
  body.dark .synthese-periods button.ghost{background:transparent;color:#60a5fa !important;border:1px solid #2563eb}
  body.dark{
    --bg:#0b1220;
    --card:#0f172a;
    --text:#e5eef8;
    --muted:#8ea3b8;
    --line:#243244;
    --accent:#1d4ed8;
    --ok:#86efac;
    --okbg:#052e16;
    --bad:#fecaca;
    --badbg:#450a0a;
    --warn:#fde68a;
    --warnbg:#451a03;
    --blue:#bfdbfe;
    --bluebg:#172554;
  }
  body.dark{background:radial-gradient(circle at top,#132033 0%,#0b1220 55%,#09101b 100%);color:var(--text)}
  body.dark .brand,
  body.dark .card,
  body.dark .table-wrap,
  body.dark .stat,
  body.dark table,
  body.dark .tab,
  body.dark button.secondary,
  body.dark .btn.secondary,
  body.dark input,
  body.dark select,
  body.dark textarea,
  body.dark .notice,
  body.dark .pill{background:#0f172a;color:var(--text);border-color:#243244}
  body.dark .tab.active{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
  body.dark th{background:#111c31;color:#9fb3c8}
  body.dark td{border-bottom-color:#243244}
  body.dark .autocomplete-list{background:#0f172a;border-color:#243244}
  body.dark .autocomplete-item{border-bottom-color:#1b2940}
  body.dark .autocomplete-item:hover,body.dark .autocomplete-item.active{background:#14213a}
  body.dark .collapse-head .arrow,body.dark .muted,body.dark .small,label{color:inherit}
  body.dark .doc{background:#fff;color:#111827}
  body.dark .doc-head, body.dark .doc table, body.dark .doc th, body.dark .doc td, body.dark .doc .sign{color:#111827}
  body.dark .search-top{align-items:center}
  body.dark #themeToggleBtn{align-self:center}

</style>
  </head>
  <body onload="window.print();setTimeout(()=>window.close(),200);">
    <div class="doc-page">
      <div class="meta-top">
        <div>${esc(new Date().toLocaleDateString('fr-FR'))} ${esc(new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}))}</div>
        <div>${esc(doc.number)}</div>
      </div>
      <div class="panel">
        <div class="doc-header">
          <div class="print-logo-box"><div class="print-logo"><img class="oramed-logo-img" src="data:image/png;base64,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" alt="ORAMED"></div></div>
          <div class="doc-header-right">
            <div>Bon de sortie</div>
            <div>N° bon : ${esc(doc.number)}</div>
            <div>Date : ${esc(doc.date)}</div>
          </div>
        </div>
      </div>
      <div class="panel">
        <h2 class="section-title">BON DE SORTIE</h2>
        <div class="top-info">
          <div class="info-box"><strong>Type client :</strong>&nbsp;${esc(clientTypeLabel)}</div>
          <div class="info-box wide"><strong>Client :</strong>&nbsp;${esc(clientLabel)}</div>
        </div>
        <div class="table-shell">
          <table>
            <colgroup><col style="width:50%"><col style="width:20%"><col style="width:30%"></colgroup>
            <thead><tr><th>Référence</th><th>Nb de caisse</th><th>Total m²</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="totals"><div class="box"><div>Total métrage sortie</div><div>${total} m²</div></div></div>
        <div class="signature-grid"><div class="signature-box">Visa magasin</div><div class="signature-box">Visa client</div><div class="signature-box">Visa transport</div><div class="signature-box">Visa direction</div></div>
      </div>
    </div>
  </body></html>`;
}
function openPrint(html){ const win = window.open('','_blank'); if(!win){ alert("Le navigateur a bloqué l'ouverture de la fenêtre d'impression."); return; } win.document.open(); win.document.write(html); win.document.close(); win.focus(); setTimeout(()=>win.print(),300); }
function printInline(html, title='Impression'){
  let iframe = document.getElementById('inline-print-frame');
  if(!iframe){
    iframe = document.createElement('iframe');
    iframe.id = 'inline-print-frame';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);
  }
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  iframe.onload = function(){
    setTimeout(()=>{
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }, 150);
  };
}
function printReceptionDraft(){ openPrint(buildReceptionDoc(state.receptionDraft)); }
function printSortieDraft(){ openPrint(buildSortieDoc(state.sortieDraft)); }
function printReceptionArchive(id){ const doc = state.receptions.find(d=>d.id===id); if(!doc) return; if(doc.status === 'annulé'){ alert("Un bon de réception annulé ne peut plus être imprimé."); return; } openPrint(buildReceptionDoc(doc)); }
function cancelReceptionArchive(id){
  const doc = state.receptions.find(d=>d.id===id);
  if(!doc) return;
  if(doc.status === 'annulé'){ alert('Ce bon de réception est déjà annulé.'); return; }
  if(!confirm(`Annuler ${doc.number} ? Les quantités de ce bon seront retirées du stock.`)) return;
  doc.status = 'annulé';
  doc.cancelledAt = new Date().toISOString();
  saveState();
  renderArchives();
}
function deleteReceptionArchive(id){
  const doc = state.receptions.find(d=>d.id===id);
  if(!doc) return;
  if(!confirm(`Supprimer définitivement ${doc.number} de l'archive ? Cette action est réservée aux essais. Son numéro redeviendra réutilisable.`)) return;
  state.receptions = state.receptions.filter(d=>d.id!==id);
  registerReusableNumber('BR', doc.sequence || numberToSeq(doc.number, 'BR'));
  if(!state.receptionDraft?.lines?.length) state.receptionDraft.number = nextNumber('BR');
  saveState();
  renderArchives();
}
function printSortieArchive(id){ const doc = state.sorties.find(d=>d.id===id); if(!doc) return; if(doc.status === 'annulé'){ alert("Un bon de sortie annulé ne peut plus être imprimé."); return; } openPrint(buildSortieDoc(doc)); }
function cancelSortieArchive(id){
  const doc = state.sorties.find(d=>d.id===id);
  if(!doc) return;
  if(doc.status === 'annulé'){ alert('Ce bon de sortie est déjà annulé.'); return; }
  if(!confirm(`Annuler ${doc.number} ? Les quantités de ce bon seront remises au stock.`)) return;
  doc.status = 'annulé';
  doc.cancelledAt = new Date().toISOString();
  saveState();
  renderArchives();
}
function deleteSortieArchive(id){
  const doc = state.sorties.find(d=>d.id===id);
  if(!doc) return;
  if(!confirm(`Supprimer définitivement ${doc.number} de l'archive ? Cette action est réservée aux essais. Son numéro redeviendra réutilisable.`)) return;
  state.sorties = state.sorties.filter(d=>d.id!==id);
  registerReusableNumber('BS', doc.sequence || numberToSeq(doc.number, 'BS'));
  if(!state.sortieDraft?.lines?.length) state.sortieDraft.number = nextNumber('BS');
  saveState();
  renderArchives();
}
function printStockState(){
  const stockRows = computeStockRows();
  const totalStock = round2(stockRows.reduce((s,r)=>s+r.stock,0));
  const totalCaisses = round2(stockRows.reduce((s,r)=>s+r.stockCaisses,0));
  const totalPalettes = round2(stockRows.reduce((s,r)=>s+r.stockPalettes,0));
  const rows = stockRows.map(r=>`<tr><td>${esc(r.reference)}</td><td>${esc(r.marque)}</td><td>${esc(r.format)}</td><td><strong>${fmt(r.stock)} m²</strong></td><td>${fmt(r.stockCaisses)}</td><td>${fmt(r.stockPalettes)}</td></tr>`).join('');
  const logoSrc = document.querySelector('.oramed-logo-img')?.src || '';
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>État de stock</title><style>
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;color:#111827;background:#fff;padding:18px}
    .doc-page{max-width:920px;margin:0 auto}
    .panel{border:1px solid #d9dde3;border-radius:18px;background:#fff;padding:18px 20px;margin-bottom:14px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
    .brand{display:flex;align-items:center;font-size:24px}.brand img{width:84px !important;height:auto !important;max-width:84px !important;display:block;object-fit:contain}
    .title{font-size:24px;font-weight:800;text-align:center;margin:14px 0 6px}
    .top-total{display:flex;justify-content:center;margin-top:10px}
    .stock-box{border:1px solid #d9dde3;border-radius:14px;padding:12px 16px;font-size:15px;font-weight:800;background:#fff;min-width:220px;text-align:center}
    .totals{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:12px}
    .mini-box{border:1px solid #d9dde3;border-radius:14px;padding:10px 14px;background:#fff;font-size:14px;font-weight:700;min-width:180px;text-align:center}
    .table-shell{border:1px solid #d9dde3;border-radius:14px;overflow:hidden;background:#fff;margin-top:12px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:11px 12px;font-size:14px;text-align:left;border-bottom:1px solid #e8ebef;vertical-align:middle}
    th{background:#f8fafc;font-weight:700}
    tbody tr:last-child td{border-bottom:none}
    .footer{display:flex;justify-content:flex-end;margin-top:12px}
    .total-box{border:1px solid #d9dde3;border-radius:14px;padding:12px 16px;font-size:14px;font-weight:700;background:#fff;min-width:260px;text-align:center}
    @page{size:A4 portrait;margin:10mm}
    @media print{body{padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.doc-page{max-width:none}.head,.title,.top-total,.stock-box,.totals,.mini-box{break-inside:avoid;page-break-inside:avoid}thead{display:table-header-group}tfoot{display:table-footer-group}tr,td,th{break-inside:avoid;page-break-inside:avoid}}
  </style></head><body><div class="doc-page"><div class="panel"><div class="head"><div class="brand">${logoSrc?`<img class="oramed-logo-img" src="${logoSrc}" alt="ORAMED">`:''}</div><div><strong>Date d'impression :</strong> ${esc(todayStr())}</div></div><div class="title">ÉTAT DE STOCK</div><div class="top-total"><div class="stock-box">Stock : ${fmt(totalStock)} m²</div></div><div class="totals"><div class="mini-box">Nb caisse : ${fmt(totalCaisses)}</div><div class="mini-box">Nb palette : ${fmt(totalPalettes)}</div></div></div><div class="table-shell"><table><thead><tr><th>Référence</th><th>Fournisseur</th><th>Format</th><th>Stock</th><th>Nb caisse</th><th>Nb palette</th></tr></thead><tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#6b7280">Aucune donnée</td></tr>'}</tbody></table></div><div class="footer"><div class="total-box">Références actives : ${stockRows.length}</div></div></div></body></html>`;
  printInline(html, 'État de stock');
}
function printReferenceMoves(id){
  const ref = getReferenceById(id); if(!ref) return;
  const rows = computeMovements(id).map(m=>`<tr><td>${esc(m.date)}</td><td>${m.type==='ENTRÉE'?'Entrée':'Sortie'}</td><td>${esc(m.number)}</td><td>${esc(m.tiers)}</td><td>${m.metrage>0?'+':''}${fmt(m.metrage)} m²</td><td>${fmt(m.running)} m²</td></tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:#6b7280">Aucun mouvement.</td></tr>`;
  const currentStock = fmt((computeStockRows().find(r => r.id===id)?.stock || 0));
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Mouvements ${esc(ref.reference)}</title><style>
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;background:#fff;color:#111827;padding:18px}
    .doc-page{max-width:980px;margin:0 auto}
    .panel{border:1px solid #d9dde3;border-radius:18px;background:#fff;padding:18px 20px;margin-bottom:14px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
    .brand{display:flex;align-items:center;font-size:24px}.brand img{width:84px !important;height:auto !important;max-width:84px !important;max-height:none !important;display:block;object-fit:contain}
    .meta{display:grid;grid-template-columns:repeat(3,minmax(150px,1fr));gap:10px;margin-top:12px}
    .meta-box{border:1px solid #d9dde3;border-radius:14px;padding:10px 12px;background:#fff}
    .meta-box strong{display:block;font-size:12px;margin-bottom:4px;color:#374151}
    .title{font-size:24px;font-weight:800;text-align:center;margin:14px 0 6px}
    .top-total{display:flex;justify-content:center;margin-top:10px}
    .stock-box{border:1px solid #d9dde3;border-radius:14px;padding:12px 18px;font-size:15px;font-weight:800;background:#fff;min-width:220px;text-align:center}
    .table-shell{border:1px solid #d9dde3;border-radius:14px;overflow:hidden;background:#fff;margin-top:12px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:11px 12px;font-size:14px;text-align:left;border-bottom:1px solid #e8ebef;vertical-align:middle;white-space:nowrap}
    th{background:#f8fafc;font-weight:700}
    tbody tr:last-child td{border-bottom:none}
    @page{size:A4 portrait;margin:10mm}
    @media print{body{padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.doc-page{max-width:none}.section,.stats,.stat,.head,.brand,.title,.sub{break-inside:avoid;page-break-inside:avoid}thead{display:table-header-group}tfoot{display:table-footer-group}tr,td,th{break-inside:avoid;page-break-inside:avoid}}
  
  .search-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .icon-btn{min-width:44px;padding:10px 12px;font-size:18px;line-height:1}

  .role-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:12px;font-weight:800}
  .role-badge .dot{width:10px;height:10px;border-radius:999px;background:#166534;display:inline-block}
  .role-note{font-size:12px;color:var(--muted);margin-top:6px}
  .sync-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:12px;font-weight:800}
  .sync-badge.off{background:#f8fafc;border-color:#cbd5e1;color:#475569}
  .sync-dot{width:10px;height:10px;border-radius:999px;background:#22c55e;display:inline-block}
  .sync-badge.off .sync-dot{background:#94a3b8}
  .sync-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  .sync-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}

  .synthese-periods button{background:rgba(255,255,255,.76);color:#1d4ed8 !important;border:1px solid rgba(59,130,246,.35)}
  .synthese-periods button.primary{background:#2563eb;color:#fff !important;border-color:#2563eb}
  .synthese-periods button.ghost{background:rgba(255,255,255,.76);color:#1d4ed8 !important;border:1px solid rgba(59,130,246,.35)}
  body.dark .synthese-periods button{background:transparent;color:#60a5fa !important;border:1px solid #2563eb}
  body.dark .synthese-periods button.primary{background:#2563eb;color:#fff !important;border-color:#2563eb}
  body.dark .synthese-periods button.ghost{background:transparent;color:#60a5fa !important;border:1px solid #2563eb}
  body.dark{
    --bg:#0b1220;
    --card:#0f172a;
    --text:#e5eef8;
    --muted:#8ea3b8;
    --line:#243244;
    --accent:#1d4ed8;
    --ok:#86efac;
    --okbg:#052e16;
    --bad:#fecaca;
    --badbg:#450a0a;
    --warn:#fde68a;
    --warnbg:#451a03;
    --blue:#bfdbfe;
    --bluebg:#172554;
  }
  body.dark{background:radial-gradient(circle at top,#132033 0%,#0b1220 55%,#09101b 100%);color:var(--text)}
  body.dark .brand,
  body.dark .card,
  body.dark .table-wrap,
  body.dark .stat,
  body.dark table,
  body.dark .tab,
  body.dark button.secondary,
  body.dark .btn.secondary,
  body.dark input,
  body.dark select,
  body.dark textarea,
  body.dark .notice,
  body.dark .pill{background:#0f172a;color:var(--text);border-color:#243244}
  body.dark .tab.active{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
  body.dark th{background:#111c31;color:#9fb3c8}
  body.dark td{border-bottom-color:#243244}
  body.dark .autocomplete-list{background:#0f172a;border-color:#243244}
  body.dark .autocomplete-item{border-bottom-color:#1b2940}
  body.dark .autocomplete-item:hover,body.dark .autocomplete-item.active{background:#14213a}
  body.dark .collapse-head .arrow,body.dark .muted,body.dark .small,label{color:inherit}
  body.dark .doc{background:#fff;color:#111827}
  body.dark .doc-head, body.dark .doc table, body.dark .doc th, body.dark .doc td, body.dark .doc .sign{color:#111827}
  body.dark .search-top{align-items:center}
  body.dark #themeToggleBtn{align-self:center}

</style></head><body><div class="doc-page"><div class="panel"><div class="head"><div class="brand"><img class="oramed-logo-img" src="data:image/png;base64,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" alt="ORAMED"></div><div style="font-size:13px;color:#4b5563"><div><strong>Date d'impression :</strong> ${esc(todayStr())}</div></div></div><div class="title">FICHE MOUVEMENT PAR RÉFÉRENCE</div><div class="top-total"><div class="stock-box">Stock : ${currentStock} m²</div></div><div class="meta"><div class="meta-box"><strong>Référence</strong>${esc(ref.reference)}</div><div class="meta-box"><strong>Format</strong>${esc(ref.format)}</div><div class="meta-box"><strong>Fournisseur</strong>${esc(getSupplierBrand(ref.marque))}</div></div></div><div class="table-shell"><table><thead><tr><th>Date</th><th>Type</th><th>N° bon</th><th>Tiers</th><th>Mouvement m²</th><th>Stock cumulé</th></tr></thead><tbody>${rows}</tbody></table></div></div></body></html>`;
  printInline(html, 'Fiche mouvement par référence');
}
function exportData(){
  const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'velsa_depot_stock_data.json'; a.click(); URL.revokeObjectURL(a.href);
}
function importDataPrompt(){
  const input = document.createElement('input'); input.type='file'; input.accept='application/json';
  input.onchange = e => {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader(); reader.onload = () => {
      try{ state = Object.assign(defaultState(), JSON.parse(reader.result)); ensureDraftNumbers(); saveState(); renderTabs(); syncRoleBadge(); renderActiveTab(); alert('Import terminé.'); }
      catch(err){ alert('Fichier invalide.'); }
    }; reader.readAsText(file);
  };
  input.click();
}
function resetAllData(){ if(!confirm('Tout effacer ?')) return; state = defaultState(); ensureDraftNumbers(); saveState(); renderTabs(); syncRoleBadge(); renderActiveTab(); }

document.addEventListener('click', e => {
  if(!e.target.closest('.autocomplete')) document.querySelectorAll('.autocomplete-list').forEach(el => el.classList.add('hidden'));
});

function applyTheme(theme){
  const dark = theme === 'dark';
  document.body.classList.toggle('dark', dark);
  const btn = document.getElementById('themeToggleBtn');
  if(btn){
    btn.textContent = dark ? '☼' : '◐';
    btn.title = dark ? 'Mode clair' : 'Mode sombre';
    btn.setAttribute('aria-label', dark ? 'Mode clair' : 'Mode sombre');
  }
}
function toggleTheme(){
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem('oramed_theme', next);
  applyTheme(next);
}

</script>
</body>
</html>
