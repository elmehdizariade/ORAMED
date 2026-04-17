/* ══════════════════════════════════════════════════════
   ORAMED — App Logic (app.js)
   Centralized state, role-based tabs, full CRUD
   ══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Constants & Supabase ──
  const ROLE_KEY = 'oramed_app_role';
  const THEME_KEY = 'oramed_app_theme';

  // SUPABASE CONFIGURATION
  const supabaseUrl = 'https://qshgocqxbbcbmicakiqm.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzaGdvY3F4YmJjYm1pY2FraXFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NDk4MTQsImV4cCI6MjA5MDAyNTgxNH0.b1MqARHF86wJUoc_W7p7WFUWYvhWUqNPdh3m4lDA4jU';
  const supabase = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

  // ── Utility ──
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function padNum(n, len) { return String(n).padStart(len, '0'); }
  function round2(v) { return Math.round(v * 100) / 100; }
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  // ── State ──
  var state = {
    references: [],
    clients: [],
    receptions: [],
    sorties: [],
    archives: { receptions: [], sorties: [] },
    settings: { brCounter: 1, bsCounter: 1 },
    mouvements: [],
    currentReception: { lines: [] } // Antigravity Staging
  };

  // Temp state for searchable reference combobox
  let $selectedRefDraft = null;

  // ── Supabase State loading ──
  async function loadState() {
    if(!supabase) return;
    try {
      const { data: pData } = await supabase.from('produits').select('*');
      const { data: cData } = await supabase.from('clients').select('*');
      const { data: brData } = await supabase.from('bons_reception').select('*');
      const { data: brlData } = await supabase.from('bons_reception_lignes').select('*');
      const { data: bsData } = await supabase.from('bons_sortie').select('*');
      const { data: bslData } = await supabase.from('bons_sortie_lignes').select('*');

      state.references = (pData || []).map(p => ({
        ...p,
        m2ParCaisse: p.m2_par_caisse,
        stockM2: p.stock_m2
      }));

      state.clients = cData || [];

      const brLignes = brlData || [];
      state.archives.receptions = (brData || []).map(br => {
        br.lines = brLignes.filter(l => l.bon_id === br.id).map(l => ({
          refId: l.produit_id,
          caisses: l.caisses,
          m2: l.m2
        }));
        br.number = br.number || br.numero || ('BR-' + br.id);
        br.totalCaisses = br.total_caisses;
        br.totalM2 = br.total_m2;
        br.createdAt = br.created_at;
        return br;
      });

      const bsLignes = bslData || [];
      state.archives.sorties = (bsData || []).map(bs => {
        bs.lines = bsLignes.filter(l => l.bon_id === bs.id).map(l => ({
          refId: l.produit_id,
          caisses: l.caisses,
          m2: l.m2
        }));
        bs.number = bs.number || bs.numero || ('BS-' + bs.id);
        bs.totalCaisses = bs.total_caisses;
        bs.totalM2 = bs.total_m2;
        bs.createdAt = bs.created_at;
        bs.clientType = bs.client_type;
        bs.clientNom = bs.client_nom;
        
        // Map legacy client name for archival view
        if (bs.client_type === 'divers') {
          bs.client = bs.client_nom;
        } else {
          const c = state.clients.find(c => c.id == bs.client_id);
          bs.client = c ? c.nom : bs.client_id;
        }
        return bs;
      });

      state.settings.brCounter = state.archives.receptions.length + 1;
      state.settings.bsCounter = state.archives.sorties.length + 1;

    } catch (err) {
      console.error('loadState Supabase error:', err);
    }
  }

  function saveState() {
    // No-op. We handle inserts granularly and await loadState()
  }

  // ── Toast ──
  function toast(msg, type) {
    type = type || 'info';

    // Core Principle: Remove any existing error toasts to prevent infinite stacking
    if (type === 'error') {
      document.querySelectorAll('.toast--error').forEach(function(existingEl) {
        existingEl.remove();
      });
    }

    const el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.textContent = msg;
    $('#toast-container').appendChild(el);
    setTimeout(function () {
      if (el && el.parentNode) {
        el.classList.add('toast--out');
        setTimeout(function () { if (el && el.parentNode) el.remove(); }, 300);
      }
    }, 2800);
  }

  // ── Auth & Role Logic ──
  let currentRole = null;
  let authMode = 'login';

  async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      $('#auth-overlay').hidden = false;
      return;
    }
    
    const role = await fetchUserRole(session.user.id);
    if (!role || role === 'en_attente') {
      $('#auth-overlay').hidden = false;
      $('#auth-error').textContent = "Votre compte est en attente de validation par la direction";
      $('#auth-error').hidden = false;
      return;
    }
    
    $('#auth-overlay').hidden = true;
    currentRole = role;
    await initAppData(role);
  }

  async function fetchUserRole(userId) {
    const { data, error } = await supabase.from('utilisateurs').select('role').eq('id', userId).single();
    if (error || !data) return null;
    return data.role;
  }

  function initAuthUI() {
    $('#auth-toggle-mode').addEventListener('click', function() {
      authMode = authMode === 'login' ? 'signup' : 'login';
      $('#auth-title').textContent = authMode === 'login' ? 'Connexion' : 'Créer un compte';
      $('#auth-submit').textContent = authMode === 'login' ? 'Se connecter' : "S'inscrire";
      this.textContent = authMode === 'login' ? 'Demander un accès' : 'Déjà un compte ? Connexion';
      $('#auth-error').hidden = true;
    });

    $('#auth-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var email = $('#auth-email').value;
      var password = $('#auth-password').value;
      $('#auth-error').hidden = true;
      try {
        if (authMode === 'login') {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
        } else {
          const { error } = await supabase.auth.signUp({ email, password });
          if (error) throw error;
          toast('Compte créé, en attente de validation', 'info');
        }
        await checkSession();
      } catch (err) {
        $('#auth-error').textContent = err.message;
        $('#auth-error').hidden = false;
      }
    });

    $('#auth-logout').addEventListener('click', async function() {
      await supabase.auth.signOut();
      location.reload();
    });
  }

  // ── Theme Logic ──
  function resolveTheme() {
    return localStorage.getItem(THEME_KEY) || 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    $('#theme-icon').textContent = theme === 'dark' ? '🌙' : '☀️';
  }

  // ── Populate dropdowns ──

  // Fournisseur → marque mapping for cascading reference filter
  var FOURNISSEUR_MARQUE_MAP = {
    "SCC": "Super Cerame",
    "SCB": "Super Cerame",
    "SCK": "Super Cerame",
    "SCT": "Super Cerame",
    "Facemag": "Facemag",
    "Multicerame": "Multicerame"
  };

  // ── Autocomplete Logic ──
  async function fetchReferences(query, filters = {}) {
    let results = state.references;
    if (filters.marque) {
      results = results.filter(r => r.fournisseur === filters.marque);
    }
    
    query = (query || '').toLowerCase().trim();
    if (!query) return results.slice(0, 20);

    results = results.filter(r => {
      return (r.id+'').toLowerCase().includes(query) ||
             r.nom.toLowerCase().includes(query) ||
             (r.fournisseur || '').toLowerCase().includes(query);
    });
    return results.slice(0, 20);
  }

  function setupAutocomplete(searchInputId, hiddenInputId, listId, isReception) {
    const searchInput = $(searchInputId);
    const hiddenInput = $(hiddenInputId);
    const listEl = $(listId);
    if (!searchInput || !hiddenInput || !listEl) return;
    
    let activeIndex = -1;
    let currentResults = [];

    async function handleSearch() {
      const query = searchInput.value;
      let filters = {};
      
      if (isReception) {
         const fournisseurVal = $('#br-fournisseur').value;
         const marque = FOURNISSEUR_MARQUE_MAP[fournisseurVal] || null;
         if (!marque) {
            listEl.hidden = true;
            return;
         }
         filters.marque = marque;
      }
      
      const results = await fetchReferences(query, filters);
      currentResults = results;
      renderList(results, query);
    }

    function renderList(results, query) {
      listEl.innerHTML = '';
      activeIndex = -1;
      
      if (results.length === 0) {
        listEl.innerHTML = '<div class="autocomplete-empty">Aucun résultat trouvé</div>';
        listEl.hidden = false;
        return;
      }

      results.forEach((r, idx) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        
        let displayStr = `${r.nom} (${r.fournisseur} · ${r.format})`;

        if (query) {
           const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\\\]/g, '\\\\$&')})`, 'gi');
           displayStr = displayStr.replace(regex, '<span class="highlight">$1</span>');
        }

        if (!isReception) {
           const stockM2 = r.stockM2 || 0;
           if (stockM2 <= 0) {
              displayStr += ` <span style="color:var(--danger);font-size:0.75rem;margin-left:8px">(Rupture: ${stockM2} m²)</span>`;
           } else if (stockM2 < 20) {
              displayStr += ` <span style="color:var(--warning);font-size:0.75rem;margin-left:8px">(Stock faible: ${stockM2} m²)</span>`;
           } else {
              displayStr += ` <span style="color:var(--text-muted);font-size:0.75rem;margin-left:8px">(Stock: ${stockM2} m²)</span>`;
           }
        }
        
        item.innerHTML = displayStr;
        item.dataset.index = idx;
        
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectItem(r);
        });
        
        listEl.appendChild(item);
      });
      listEl.hidden = false;
    }

    function selectItem(ref) {
      searchInput.value = `${ref.nom} (${ref.fournisseur} · ${ref.format})`;
      hiddenInput.value = ref.id;
      $selectedRefDraft = ref; // Staging the full reference object
      listEl.hidden = true;
      hiddenInput.dispatchEvent(new Event('change'));
    }

    searchInput.addEventListener('input', () => {
      hiddenInput.value = ''; // clear hidden value if user types
      handleSearch();
    });
    searchInput.addEventListener('focus', handleSearch);
    searchInput.addEventListener('blur', () => { setTimeout(() => listEl.hidden = true, 150); });

    searchInput.addEventListener('keydown', (e) => {
      const items = listEl.querySelectorAll('.autocomplete-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        updateActive(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        updateActive(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex > -1 && currentResults[activeIndex]) {
          selectItem(currentResults[activeIndex]);
        }
      } else if (e.key === 'Escape') {
        listEl.hidden = true;
        searchInput.blur();
      }
    });

    function updateActive(items) {
      items.forEach((item, idx) => {
        if (idx === activeIndex) {
          item.classList.add('active');
          item.scrollIntoView({ block: 'nearest' });
        } else {
          item.classList.remove('active');
        }
      });
    }
  }

  function populateFournisseurs() {
  }

  function populateBrRefs(marque) {
    if ($('#br-line-ref-search')) {
      $('#br-line-ref').value = '';
      $('#br-line-ref-search').value = '';
      $('#br-line-ref-search').disabled = !marque;
    }
  }

  function populateRefSelects() {
    var sels = [
      { el: '#dir-mvt-ref', filter: null }
    ];
    sels.forEach(function (s) {
      if(!$(s.el)) return;
      var sel = $(s.el);
      sel.innerHTML = '<option value="">— Référence —</option>';
      state.references.forEach(function (r) {
        var o = document.createElement('option');
        o.value = r.id;
        o.textContent = r.nom + ' (' + r.fournisseur + ' · ' + r.format + ')';
        sel.appendChild(o);
      });
    });
  }

  function populateClients() {
    var sel = $('#bs-client');
    sel.innerHTML = '<option value="">— Sélectionner —</option>';
    state.clients.forEach(function (c) {
      if (!c) return;
      var o = document.createElement('option'); o.value = c.id; o.textContent = c.nom; sel.appendChild(o);
    });
  }

  function refreshDropdowns() {
    populateFournisseurs();
    populateRefSelects();
    populateClients();
  }

  // ── Find reference by id ──
  function refById(id) {
    return state.references.find(function (r) { return r.id === id; }) || null;
  }

  // ── Stock helpers ──
  function getStockM2(refId) {
    var ref = refById(refId);
    return ref ? (ref.stockM2 || 0) : 0;
  }

  function addStock(refId, caisses) {
    var ref = refById(refId);
    if (!ref) return;
    var m2 = round2(caisses * ref.m2ParCaisse);
    ref.stockM2 = round2((ref.stockM2 || 0) + m2);
  }

  function removeStock(refId, caisses) {
    var ref = refById(refId);
    if (!ref) return;
    var m2 = round2(caisses * ref.m2ParCaisse);
    ref.stockM2 = round2(Math.max(0, (ref.stockM2 || 0) - m2));
  }

  // ══════════════════════════════════════════════════
  // TABS
  // ══════════════════════════════════════════════════
  function initTabs() {
    var btns = $$('.tab-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-tab');
        switchTab(tab);
      });
    });
  }

  function switchTab(tab) {
    $$('.tab-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
    $$('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + tab); });
    // Refresh panel data
    if (tab === 'stock') renderStock();
    if (tab === 'synthese') renderSynthese();
    if (tab === 'archives') renderArchives();
    if (tab === 'direction') { renderDirRefs(); renderDirClients(); }
  }

  // ══════════════════════════════════════════════════
  // BON DE RÉCEPTION
  // ══════════════════════════════════════════════════
  var brDraft = { lines: [] };

  function saveBrDraft() {
    const lines = state.currentReception.lines.length > 0 
      ? state.currentReception.lines.map(l => ({ refId: l.reference_id, caisses: l.caisses, m2: l.m2 }))
      : brDraft.lines;
    localStorage.setItem('draft_reception_lines', JSON.stringify(lines));
  }

  function loadBrDraft() {
    try {
      var saved = localStorage.getItem('draft_reception_lines');
      if (saved) {
        const lines = JSON.parse(saved);
        brDraft.lines = lines;
        state.currentReception.lines = lines.map(l => ({
          reference_id: l.refId || l.reference_id,
          caisses: l.caisses,
          m2: l.m2,
          nom: refById(l.refId || l.reference_id)?.nom || '?',
          fournisseur: refById(l.refId || l.reference_id)?.fournisseur || '',
          format: refById(l.refId || l.reference_id)?.format || ''
        }));
      }
    } catch (e) {
      console.error("Erreur chargement brouillon", e);
    }
  }

  function editLine(idx) {
    const lines = state.currentReception.lines.length > 0 ? state.currentReception.lines : brDraft.lines;
    var line = lines[idx];
    const refId = line.reference_id || line.refId;
    $('#br-line-ref').value = refId;
    var ref = refById(refId);
    if (ref && $('#br-line-ref-search')) {
      $('#br-line-ref-search').value = `${ref.nom} (${ref.fournisseur} · ${ref.format})`;
      $selectedRefDraft = ref;
    }
    $('#br-line-caisses').value = line.caisses;
    $('#br-line-caisses').dispatchEvent(new Event('input'));
    lines.splice(idx, 1);
    saveBrDraft();
    renderBrLines();
  }

  // ── Lock/unlock header fields when lines exist ──
  function toggleHeaderLock(isLocked) {
    $('#br-date').disabled = isLocked;
    $('#br-bl').disabled = isLocked;
    $('#br-fournisseur').disabled = isLocked;
    $('#br-transporteur').disabled = isLocked;
    $('#br-chauffeur').disabled = isLocked;
    $('#br-chauffeur-select').disabled = isLocked;
    $('#br-matricule').disabled = isLocked;
  }

  function brNextNumber() {
    return 'BR-' + padNum(state.settings.brCounter, 4);
  }

  function brReset() {
    brDraft = { lines: [] };
    state.currentReception.lines = [];
    $('#br-date').value = today();
    $('#br-bl').value = '';
    $('#br-fournisseur').value = '';
    $('#br-transporteur').value = '';
    $('#br-chauffeur').value = '';
    $('#br-chauffeur').style.display = '';
    $('#br-chauffeur-select').style.display = 'none';
    $('#br-chauffeur-select').innerHTML = '<option value="">— Sélectionner —</option>';
    $('#br-matricule').value = '';
    $('#br-matricule').readOnly = false;
    $('#br-line-ref').value = '';
    if ($('#br-line-ref-search')) {
      $('#br-line-ref-search').value = '';
      $('#br-line-ref-search').disabled = true;
    }
    $('#br-line-caisses').value = '';
    $('#br-line-m2').value = '';
    $('#br-number').textContent = brNextNumber();
    renderBrLines();
  }

  function renderBrLines() {
    var body = $('#br-lines-body');
    body.innerHTML = '';
    var tCaisses = 0, tM2 = 0;
    const lines = state.currentReception.lines.length > 0 ? state.currentReception.lines : brDraft.lines;
    
    if (lines.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="empty-state">Aucune ligne ajoutée</td></tr>';
    } else {
      lines.forEach(function (line, i) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + (line.nom || '?') + '</td>' +
          '<td>' + (line.fournisseur || '') + '</td>' +
          '<td>' + (line.format || '') + '</td>' +
          '<td>' + line.caisses + '</td>' +
          '<td>' + round2(line.m2) + '</td>' +
          '<td>' +
          '<button class="btn btn--primary btn--sm btn--edit" data-idx="' + i + '" style="margin-right: 4px;">Modifier</button>' +
          '<button class="btn btn--danger btn--sm btn--delete" data-idx="' + i + '">✕</button>' +
          '</td>';
        body.appendChild(tr);
        tCaisses += line.caisses;
        tM2 += line.m2;
      });
    }
    $('#br-total-caisses').innerHTML = '<strong>' + tCaisses + '</strong>';
    $('#br-total-m2').innerHTML = '<strong>' + round2(tM2) + '</strong>';
    // Bind buttons
    body.querySelectorAll('.btn--delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleLineDeletion(parseInt(btn.getAttribute('data-idx')));
      });
    });
    body.querySelectorAll('.btn--edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        editLine(parseInt(btn.getAttribute('data-idx')));
      });
    });
    // Lock/unlock header based on line count
    toggleHeaderLock((state.currentReception.lines.length || brDraft.lines.length) > 0);
  }

  function toggleLineDeletion(idx) {
    if (state.currentReception.lines.length > 0) {
      state.currentReception.lines.splice(idx, 1);
    } else {
      brDraft.lines.splice(idx, 1);
    }
    saveBrDraft();
    renderBrLines();
  }

  // ── Transporteurs Fleet Data ──
  const TRANSPORTEURS_DATA = {
    "ORABTRANS": {
      "Nacer": "24531-A-54",
      "Abdlkhalek": "24532-A-54",
      "Abdlah": "24533-A-54"
    },
    "LONGO CERAME": {
      "Adil": "51762-A-72",
      "Munir": "51761-A-72",
      "Said": "21981-A-9",
      "Hamza": "21982-A-9",
      "Mustafa": "21980-A-9",
      "Mohemad": "148-A-73",
      "Mjid": "21983-a-9",
      "Kamal": "21984-A-9"
    }
  };

  function initReception() {
    brReset();
    loadBrDraft();
    renderBrLines();
    setupAutocomplete('#br-line-ref-search', '#br-line-ref', '#br-autocomplete-list', true);

    // ── Transporteur → Chauffeur → Matricule cascade ──
    $('#br-transporteur').addEventListener('change', function () {
      var transporteur = this.value;
      var chauffeurInput = $('#br-chauffeur');
      var chauffeurSelect = $('#br-chauffeur-select');
      var matriculeInput = $('#br-matricule');

      if (TRANSPORTEURS_DATA[transporteur]) {
        // Known transporter: show driver select, hide manual input
        chauffeurInput.style.display = 'none';
        chauffeurInput.value = '';
        chauffeurSelect.style.display = '';
        chauffeurSelect.innerHTML = '<option value="">— Sélectionner —</option>';
        var drivers = TRANSPORTEURS_DATA[transporteur];
        Object.keys(drivers).forEach(function (name) {
          var opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          chauffeurSelect.appendChild(opt);
        });
        // Clear and lock matricule until a driver is picked
        matriculeInput.value = '';
        matriculeInput.readOnly = true;
      } else {
        // "Usine" or unknown: show manual input, hide driver select
        chauffeurInput.style.display = '';
        chauffeurSelect.style.display = 'none';
        chauffeurSelect.innerHTML = '<option value="">— Sélectionner —</option>';
        matriculeInput.value = '';
        matriculeInput.readOnly = false;
      }
    });

    $('#br-chauffeur-select').addEventListener('change', function () {
      var transporteur = $('#br-transporteur').value;
      var driverName = this.value;
      var matriculeInput = $('#br-matricule');
      if (TRANSPORTEURS_DATA[transporteur] && TRANSPORTEURS_DATA[transporteur][driverName]) {
        matriculeInput.value = TRANSPORTEURS_DATA[transporteur][driverName];
        matriculeInput.readOnly = true;
      } else {
        matriculeInput.value = '';
        matriculeInput.readOnly = true;
      }
    });

    // ── Fournisseur → Référence cascade ──
    $('#br-fournisseur').addEventListener('change', function () {
      var fournisseurVal = this.value;
      var marque = FOURNISSEUR_MARQUE_MAP[fournisseurVal] || null;
      populateBrRefs(marque);
      // Reset dependent fields
      $('#br-line-caisses').value = '';
      $('#br-line-m2').value = '';
    });

    // Auto-calc m²
    $('#br-line-caisses').addEventListener('input', function () {
      var refId = $('#br-line-ref').value;
      var ref = refById(refId);
      var caisses = parseFloat($('#br-line-caisses').value) || 0;
      if (ref) {
        $('#br-line-m2').value = round2(caisses * ref.m2ParCaisse);
      } else {
        $('#br-line-m2').value = '';
      }
    });
    $('#br-line-ref').addEventListener('change', function () {
      $('#br-line-caisses').dispatchEvent(new Event('input'));
    });
    // ── ajouterLigne Function (Antigravity Core) ──
    function ajouterLigne() {
      // 1. Verify staging
      if (!$selectedRefDraft) {
        alert("Veuillez d'abord sélectionner une référence dans la recherche.");
        return;
      }

      // 2. Get input values
      const caisses = parseInt($('#br-line-caisses').value) || 0;
      if (caisses <= 0) {
        alert("Nombre de caisses invalide. Veuillez saisir un entier supérieur à 0.");
        return;
      }

      // 3. Prevent Duplicate Principle
      const duplicate = state.currentReception.lines.some(l => l.reference_id === $selectedRefDraft.id);
      if (duplicate) {
        alert("Cette référence est déjà dans la liste. Modifiez la ligne existante si besoin.");
        return;
      }

      // 4. Calculate total_m2 (Antigravity Math)
      const total_m2 = round2(caisses * ($selectedRefDraft.m2_par_caisse || $selectedRefDraft.m2ParCaisse));

      // 5. Push to state
      state.currentReception.lines.push({
        reference_id: $selectedRefDraft.id,
        nom: $selectedRefDraft.nom,
        fournisseur: $selectedRefDraft.fournisseur,
        format: $selectedRefDraft.format,
        caisses: caisses,
        m2: total_m2
      });

      // Clear inputs
      $('#br-line-ref').value = '';
      if ($('#br-line-ref-search')) $('#br-line-ref-search').value = '';
      $('#br-line-caisses').value = '';
      $('#br-line-m2').value = '';
      $selectedRefDraft = null; // Reset staging

      renderBrLines();
      saveBrDraft();
    }

    // Bind the function to the existing UI button (Clear existing to prevent stack bounds)
    var btnAddLigne = $('#br-add-line');
    var newBtnAddLigne = btnAddLigne.cloneNode(true);
    btnAddLigne.parentNode.replaceChild(newBtnAddLigne, btnAddLigne);
    newBtnAddLigne.addEventListener('click', ajouterLigne);

  function generatePrintLayout(bonData, linesData, docType='reception') {
    var section = $('#print-section');
    if (!section) return;

    if (docType === 'reception') {
      var html = `
        <div class="print-header-top">
            <div class="print-logo">ORAMED</div>
            <div class="print-doc-info">
                <p><strong>Bon d'entrée</strong></p>
                <p><strong>N° entrée :</strong> <span>${bonData.numero || '—'}</span></p>
                <p><strong>Date :</strong> <span>${bonData.date || '—'}</span></p>
                <p><strong>BL :</strong> <span>${bonData.bl || '—'}</span></p>
            </div>
        </div>

        <div class="print-main-box">
            <h1 class="print-title">BON DE RÉCEPTION</h1>

            <div class="print-info-grid">
                <div class="info-box"><strong>Source :</strong> Usine</div>
                <div class="info-box"><strong>Fournisseur :</strong> <span>${bonData.fournisseur || '—'}</span></div>
                <div class="info-box"><strong>Transporteur :</strong> <span>${bonData.transporteur || '—'}</span></div>
            </div>

            <table class="print-table">
                <thead>
                    <tr>
                        <th>Référence</th>
                        <th>Nb de caisse</th>
                        <th>Total m²</th>
                    </tr>
                </thead>
                <tbody>
      `;

      linesData.forEach(function(l) {
        var ref = refById(l.produit_id || l.refId);
        var refName = ref ? ref.nom : (l.produit_id || l.refId);
        html += `
                    <tr>
                        <td>${refName}</td>
                        <td>${l.caisses}</td>
                        <td>${round2(l.m2)} m²</td>
                    </tr>
        `;
      });

      html += `
                </tbody>
            </table>

            <div class="print-summary-container">
                <div class="print-summary-box">
                    <p class="summary-label">Total métrage entrée</p>
                    <p class="summary-value"><span>${round2(bonData.total_m2)}</span> m²</p>
                </div>
            </div>

            <div class="print-signatures">
                <div class="signature-box">Visa réception</div>
                <div class="signature-box">Visa transport</div>
                <div class="signature-box">Visa magasin</div>
                <div class="signature-box">Visa direction</div>
            </div>
        </div>
      `;
      section.innerHTML = html;
      return;
    }

    // Fallback original style for Bon de Sortie (as the new CSS overrides old global styles)
    var title = 'ORAMED — Bon de Sortie';
    var infoRight = `
        <p><strong>Type Client:</strong> ${bonData.client_type || '—'}</p>
        <p><strong>Client:</strong> ${bonData.client_nom || bonData.client_id || '—'}</p>
    `;

    var htmlSortie = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 30px;">
        <div>
          <h2 style="margin-bottom: 5px;">${title}</h2>
          <p><strong>N°:</strong> ${bonData.numero || '—'}</p>
          <p><strong>Date:</strong> ${bonData.date}</p>
        </div>
        <div style="text-align: right;">
          ${infoRight}
        </div>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;" class="print-table">
        <thead>
          <tr>
            <th style="border: 1px solid #cbd5e1; padding: 12px 15px; text-align: left; background: #f8fafc; font-weight: bold;">Référence</th>
            <th style="border: 1px solid #cbd5e1; padding: 12px 15px; text-align: left; background: #f8fafc; font-weight: bold;">Fournisseur / Marque</th>
            <th style="border: 1px solid #cbd5e1; padding: 12px 15px; text-align: left; background: #f8fafc; font-weight: bold;">Format</th>
            <th style="border: 1px solid #cbd5e1; padding: 12px 15px; text-align: left; background: #f8fafc; font-weight: bold;">Caisses</th>
            <th style="border: 1px solid #cbd5e1; padding: 12px 15px; text-align: left; background: #f8fafc; font-weight: bold;">Total m²</th>
          </tr>
        </thead>
        <tbody>
    `;

    linesData.forEach(function(l) {
      var ref = refById(l.produit_id || l.refId);
      htmlSortie += `
          <tr>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 12px 15px;">${ref ? ref.nom : (l.produit_id || l.refId)}</td>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 12px 15px;">${ref ? ref.fournisseur : ''}</td>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 12px 15px;">${ref ? ref.format : ''}</td>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 12px 15px;">${l.caisses}</td>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 12px 15px;">${round2(l.m2)}</td>
          </tr>
      `;
    });

    htmlSortie += `
        </tbody>
        <tfoot>
          <tr>
            <th colspan="3" style="text-align: right; padding: 12px 15px; background: #f8fafc; border-top: 2px solid #cbd5e1;">Total</th>
            <th style="padding: 12px 15px; background: #f8fafc; border-top: 2px solid #cbd5e1;">${bonData.total_caisses}</th>
            <th style="padding: 12px 15px; background: #f8fafc; border-top: 2px solid #cbd5e1;">${round2(bonData.total_m2)}</th>
          </tr>
        </tfoot>
      </table>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-top: 50px;">
        <div style="border: 1px solid #cbd5e1; border-radius: 8px; height: 80px; padding: 10px; font-size: 12px; display: flex; align-items: flex-end; justify-content: center;">Magasinier</div>
        <div style="border: 1px solid #cbd5e1; border-radius: 8px; height: 80px; padding: 10px; font-size: 12px; display: flex; align-items: flex-end; justify-content: center;">Chauffeur</div>
        <div style="border: 1px solid #cbd5e1; border-radius: 8px; height: 80px; padding: 10px; font-size: 12px; display: flex; align-items: flex-end; justify-content: center;">Contrôle</div>
        <div style="border: 1px solid #cbd5e1; border-radius: 8px; height: 80px; padding: 10px; font-size: 12px; display: flex; align-items: flex-end; justify-content: center;">Direction</div>
      </div>
    `;

    section.innerHTML = htmlSortie;
  }

    // Nouveau
    $('#br-nouveau').addEventListener('click', function () { 
      localStorage.removeItem('draft_reception_lines');
      brReset(); 
      toast('Nouveau bon de réception', 'info'); 
    });
    // Valider
    var btnValider = $('#br-valider');
    var newBtnValider = btnValider.cloneNode(true);
    btnValider.parentNode.replaceChild(newBtnValider, btnValider);
    
    newBtnValider.addEventListener('click', async function () {
      // 1. Align the Data Array: Check all possible state locations
      let currentLines = [];
      if (state.currentReception && state.currentReception.lines && state.currentReception.lines.length > 0) {
          currentLines = state.currentReception.lines;
      } else if (typeof brDraft !== 'undefined' && brDraft.lines && brDraft.lines.length > 0) {
          currentLines = brDraft.lines;
      }
      
      // 2. Emergency Failsafe DOM Check
      const domRows = document.querySelectorAll('#br-lines-body tr:not(.empty-state)');
      if (currentLines.length === 0 && domRows.length === 0) {
          toast('Ajoutez au moins une ligne', 'error'); 
          return; 
      }

      if (!supabase) { toast('Supabase non configuré', 'error'); return; }
      
      var number = brNextNumber();
      var date = $('#br-date').value || today();
      
      var receptionData = {
        numero: number,
        date: date,
        bl: $('#br-bl').value,
        fournisseur: $('#br-fournisseur').value,
        transporteur: $('#br-transporteur').value,
        chauffeur: $('#br-chauffeur').style.display !== 'none' ? $('#br-chauffeur').value : $('#br-chauffeur-select').value,
        matricule: $('#br-matricule').value,
        total_caisses: currentLines.reduce(function (s, l) { return s + (parseInt(l.caisses)||0); }, 0),
        total_m2: round2(currentLines.reduce(function (s, l) { return s + (parseFloat(l.m2)||0); }, 0)),
        created_at: new Date().toISOString()
      };

      try {
        const { data: br, error: errBr } = await supabase.from('bons_reception').insert(receptionData).select().single();
        
        // --- STRICT UNIQUE CONSTRAINT CHECK ---
        if (errBr) {
            if (errBr.code === '23505' || (errBr.message && errBr.message.toLowerCase().includes('duplicate'))) {
                toast('Le bon ' + receptionData.numero + ' existe déjà. Modifié en brouillon (Auto-incrémenté).', 'error');
                state.settings.brCounter++;
                $('#br-number').textContent = brNextNumber();
                return; // HALT EXECUTION: Do not parse lines, do not archive, do not print.
            } else {
                throw new Error(errBr.message);
            }
        }
        if (!br) throw new Error('Error insertion BR: Unknown error from Supabase.');
        // --------------------------------------

        const lignesToInsert = currentLines.map(l => ({
          bon_id: br.id,
          produit_id: l.reference_id || l.refId,
          caisses: l.caisses,
          m2: l.m2
        }));

        if (lignesToInsert.length > 0) {
            await supabase.from('bons_reception_lignes').insert(lignesToInsert);
        }

        for (const l of currentLines) {
          const refId = l.reference_id || l.refId;
          const ref = refById(refId);
          if (ref) {
            const newStockM2 = round2((ref.stockM2 || 0) + l.m2);
            await supabase.from('produits').update({ stock_m2: newStockM2 }).eq('id', refId);
          }
          await supabase.from('mouvements').insert({
            date: date,
            type: 'reception',
            reference_id: refId,
            quantity_m2: l.m2,
            document_ref: br.numero || ('BR-' + br.id)
          });
        }

        // ════ ARCHIVING LOGIC ════
        const finalLines = currentLines.length > 0 
            ? currentLines 
            : Array.from(document.querySelectorAll('#br-lines-body tr:not(.empty-state)')).map(row => {
                const cells = row.querySelectorAll('td');
                return {
                    reference_id: cells[0]?.innerText || '',
                    fournisseur: cells[1]?.innerText || '',
                    format: cells[2]?.innerText || '',
                    caisses: parseFloat(cells[3]?.innerText || 0),
                    m2: parseFloat(cells[4]?.innerText || 0)
                };
            });

        const finalTotalM2 = finalLines.reduce((sum, line) => sum + (parseFloat(line.m2) || 0), 0);

        // 1. Push to Antigravity State (User Required)
        const archiveEntry = {
            id: br.numero || ('BR-' + br.id),
            type: 'Réception',
            date: date || new Date().toLocaleDateString('en-GB'),
            fournisseur: $('#br-fournisseur').value || '—',
            lines: JSON.parse(JSON.stringify(finalLines)), // Deep copy the lines
            total_m2: finalTotalM2.toFixed(2),
            status: 'Validé',
            timestamp: new Date().toISOString()
        };

        // --- ROBUST ARCHIVE PUSH ---
        // 1. Force state.archives_reception to be an Array if it isn't one
        if (!Array.isArray(state.archives_reception)) {
            state.archives_reception = [];
        }
        state.archives_reception.push(archiveEntry);

        // 2. Force state.archives.receptions to be an Array (since state.archives is an object)
        if (typeof state.archives === 'object' && state.archives !== null) {
            if (!Array.isArray(state.archives.receptions)) {
                state.archives.receptions = [];
            }
            state.archives.receptions.push(archiveEntry);
        }
        // ---------------------------

        // 2. Push to Supabase 'archives' table to reliably populate renderArchives view
        await supabase.from('archives').insert({
            record_number: br.numero || ('BR-' + br.id),
            record_type: 'Réception',
            record_date: date || new Date().toLocaleDateString('en-GB'),
            tiers: $('#br-fournisseur').value || '—',
            lignes: finalLines.length,
            total_m2: finalTotalM2.toFixed(2)
        });
        // ════ END ARCHIVING LOGIC ════

        await loadState();
        localStorage.removeItem('draft_reception_lines');
        if (state.currentReception) state.currentReception.lines = [];
        if (typeof brDraft !== 'undefined') brDraft.lines = [];
        brReset();
        toast('Réception validée : ' + (br.numero || 'BR-'+br.id), 'success');
        refreshDropdowns();
        if ($('#panel-stock').classList.contains('active')) renderStock($('#stock-search').value);
        
        // 3. FORCE PRINT
        generatePrintLayout(receptionData, lignesToInsert, 'reception');
        setTimeout(() => {
            document.body.classList.add('printing-bon');
            window.print();
            // Automatically unshield after the print dialog finishes or is cancelled
            setTimeout(() => {
                document.body.classList.remove('printing-bon');
            }, 500);
        }, 150);

      } catch (err) {
        console.error('[ORAMED State Error] Échec critique lors de la validation Réception:', err);
        alert('Erreur système durant la validation: ' + err.message);
        toast('Erreur de validation: ' + err.message, 'error');
      }
    });
  }

  // ══════════════════════════════════════════════════
  // BON DE SORTIE
  // ══════════════════════════════════════════════════
  var bsDraft = { lines: [] };

  function bsNextNumber() {
    return 'BS-' + padNum(state.settings.bsCounter, 4);
  }

  function bsReset() {
    bsDraft = { lines: [] };
    $('#bs-date').value = today();
    $('#bs-client').value = '';
    $('#bs-line-ref').value = '';
    if ($('#bs-line-ref-search')) $('#bs-line-ref-search').value = '';
    $('#bs-line-caisses').value = '';
    $('#bs-line-m2').value = '';
    $('#bs-line-stock').value = '';
    $('#bs-stock-warning').hidden = true;
    $('#bs-number').textContent = bsNextNumber();
    renderBsLines();
  }

  function renderBsLines() {
    var body = $('#bs-lines-body');
    body.innerHTML = '';
    var tCaisses = 0, tM2 = 0, hasWarn = false;
    if (bsDraft.lines.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">Aucune ligne ajoutée</td></tr>';
    } else {
      bsDraft.lines.forEach(function (line, i) {
        var ref = refById(line.refId);
        var stockM2 = getStockM2(line.refId);
        var warn = line.m2 > stockM2;
        if (warn) hasWarn = true;
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + (ref ? ref.nom : '?') + (warn ? ' <span class="text-warning">⚠</span>' : '') + '</td>' +
          '<td>' + (ref ? ref.format : '') + '</td>' +
          '<td>' + line.caisses + '</td>' +
          '<td>' + round2(line.m2) + '</td>' +
          '<td><button class="btn btn--danger btn--sm" data-idx="' + i + '">✕</button></td>';
        body.appendChild(tr);
        tCaisses += line.caisses;
        tM2 += line.m2;
      });
    }
    $('#bs-total-caisses').innerHTML = '<strong>' + tCaisses + '</strong>';
    $('#bs-total-m2').innerHTML = '<strong>' + round2(tM2) + '</strong>';
    $('#bs-stock-warning').hidden = !hasWarn;
    body.querySelectorAll('.btn--danger').forEach(function (btn) {
      btn.addEventListener('click', function () {
        bsDraft.lines.splice(parseInt(btn.getAttribute('data-idx')), 1);
        renderBsLines();
      });
    });
  }

  function initSortie() {
    bsReset();
    setupAutocomplete('#bs-line-ref-search', '#bs-line-ref', '#bs-autocomplete-list', false);
    document.querySelectorAll('[name="bs-client-type"]').forEach(r => r.addEventListener('change', function() {
      if(this.value === 'compte') {
          $('#group-bs-client-compte').hidden = false;
          $('#group-bs-client-divers').hidden = true;
      } else {
          $('#group-bs-client-compte').hidden = true;
          $('#group-bs-client-divers').hidden = false;
      }
    }));

    $('#bs-line-ref').addEventListener('change', function () {
      var refId = this.value;
      var sm2 = getStockM2(refId);
      $('#bs-line-stock').value = refId ? (round2(sm2) + ' m²') : '';
      $('#bs-line-caisses').dispatchEvent(new Event('input'));
    });
    $('#bs-line-caisses').addEventListener('input', function () {
      var refId = $('#bs-line-ref').value;
      var ref = refById(refId);
      var caisses = parseFloat(this.value) || 0;
      if (ref) {
        $('#bs-line-m2').value = round2(caisses * ref.m2ParCaisse);
      } else {
        $('#bs-line-m2').value = '';
      }
    });
    $('#bs-add-line').addEventListener('click', function () {
      var refId = $('#bs-line-ref').value;
      var ref = refById(refId);
      var caisses = parseInt($('#bs-line-caisses').value) || 0;
      if (!ref) { toast('Sélectionnez une référence', 'error'); return; }
      if (caisses <= 0) { toast('Nombre de caisses invalide', 'error'); return; }
      bsDraft.lines.push({ refId: refId, caisses: caisses, m2: round2(caisses * ref.m2ParCaisse) });
      $('#bs-line-ref').value = '';
      if ($('#bs-line-ref-search')) $('#bs-line-ref-search').value = '';
      $('#bs-line-caisses').value = '';
      $('#bs-line-m2').value = '';
      $('#bs-line-stock').value = '';
      renderBsLines();
    });
    $('#bs-nouveau').addEventListener('click', function () { bsReset(); toast('Nouveau bon de sortie', 'info'); });
    $('#bs-valider').addEventListener('click', async function () {
      if (bsDraft.lines.length === 0) { toast('Ajoutez au moins une ligne', 'error'); return; }
      if (!supabase) { toast('Supabase non configuré', 'error'); return; }

      var clientTypeElem = document.querySelector('[name="bs-client-type"]:checked');
      var clientType = clientTypeElem ? clientTypeElem.value : 'compte';
      var clientId = clientType === 'compte' ? $('#bs-client').value : null;
      var clientNom = clientType === 'divers' ? $('#bs-client-divers-nom').value.trim() : null;

      if(clientType === 'compte' && !clientId) { toast('Sélectionnez un client', 'error'); return; }
      if(clientType === 'divers' && !clientNom) { toast('Saisissez le nom du client', 'error'); return; }

      var number = bsNextNumber();
      var date = $('#bs-date').value || today();
      var sortieData = {
        numero: number,
        date: date,
        client_type: clientType,
        client_id: clientId || null,
        client_nom: clientNom || null,
        total_caisses: bsDraft.lines.reduce(function (s, l) { return s + l.caisses; }, 0),
        total_m2: round2(bsDraft.lines.reduce(function (s, l) { return s + l.m2; }, 0)),
        created_at: new Date().toISOString()
      };

      try {
        const { data: bs, error: errBs } = await supabase.from('bons_sortie').insert(sortieData).select().single();
        if(errBs || !bs) throw new Error(errBs ? errBs.message : 'Error insertion BS');

        const lignesToInsert = bsDraft.lines.map(l => ({
          bon_id: bs.id,
          produit_id: l.refId,
          caisses: l.caisses,
          m2: l.m2
        }));

        await supabase.from('bons_sortie_lignes').insert(lignesToInsert);

        for (const l of bsDraft.lines) {
          const ref = refById(l.refId);
          if (ref) {
            const newStockM2 = round2(Math.max(0, (ref.stockM2 || 0) - l.m2));
            await supabase.from('produits').update({ stock_m2: newStockM2 }).eq('id', l.refId);
          }
          await supabase.from('mouvements').insert({
            date: date,
            type: 'sortie',
            reference_id: l.refId,
            quantity_m2: -l.m2,
            document_ref: bs.numero || ('BS-' + bs.id)
          });
        }

        await loadState();
        bsReset();
        toast('Sortie validée : ' + (bs.numero || 'BS-'+bs.id), 'success');
        refreshDropdowns();
        if ($('#panel-stock').classList.contains('active')) renderStock($('#stock-search').value);

        // TRIGGER PRINT SAFELY WITH TRY/CATCH
        setTimeout(() => {
          try {
            generatePrintLayout(sortieData, lignesToInsert, 'sortie');
            document.body.classList.add('printing-bon');
            window.print();
          } catch (printErr) {
            console.error('[ORAMED Print Error] Échec de la génération/impression Sortie:', printErr);
            alert('Erreur critique lors de la préparation de l\'impression: ' + printErr.message);
          } finally {
            document.body.classList.remove('printing-bon');
          }
        }, 100);

      } catch (err) {
        console.error('[ORAMED State Error] Échec critique lors de la validation Sortie:', err);
        alert('Erreur système durant la validation BS: ' + err.message);
        toast('Erreur de validation BS: ' + err.message, 'error');
      }
    });
  }

  // ══════════════════════════════════════════════════
  // ÉTAT DE STOCK
  // ══════════════════════════════════════════════════
  function renderStock(filter) {
    filter = (filter || '').toLowerCase();
    var body = $('#stock-body');
    body.innerHTML = '';
    var refs = state.references.filter(function (r) {
      if (!filter) return true;
      return (r.nom + r.fournisseur + r.format).toLowerCase().indexOf(filter) >= 0;
    });
    if (refs.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">Aucune référence trouvée</td></tr>';
      return;
    }
    refs.forEach(function (r) {
      var m2 = round2(r.stockM2 || 0);
      var caisses = r.m2ParCaisse > 0 ? Math.floor(m2 / r.m2ParCaisse) : '—';
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + r.nom + '</td>' +
        '<td>' + r.fournisseur + '</td>' +
        '<td>' + r.format + '</td>' +
        '<td>' + m2 + '</td>' +
        '<td>' + caisses + '</td>';
      body.appendChild(tr);
    });
  }

  function initStock() {
    $('#stock-search').addEventListener('input', function () { renderStock(this.value); });
    $('#btn-print-stock').addEventListener('click', function () { window.print(); });
  }

  // ══════════════════════════════════════════════════
  // SYNTHÈSE
  // ══════════════════════════════════════════════════
  function renderSynthese() {
    var period = $('#synth-period').value;
    var now = new Date();
    var startDate;
    if (period === 'jour') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'mois') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'trimestre') {
      var qm = Math.floor(now.getMonth() / 3) * 3;
      startDate = new Date(now.getFullYear(), qm, 1);
    } else {
      startDate = new Date(now.getFullYear(), 0, 1);
    }
    var recs = state.archives.receptions.filter(function (r) { return new Date(r.createdAt) >= startDate; });
    var sorts = state.archives.sorties.filter(function (s) { return new Date(s.createdAt) >= startDate; });
    var m2In = recs.reduce(function (s, r) { return s + r.totalM2; }, 0);
    var m2Out = sorts.reduce(function (s, r) { return s + r.totalM2; }, 0);
    var refsInStock = state.references.filter(function (r) { return (r.stockM2 || 0) > 0; }).length;
    $('#synth-entrees').textContent = recs.length;
    $('#synth-sorties').textContent = sorts.length;
    $('#synth-refs').textContent = refsInStock;
    $('#synth-m2-in').textContent = round2(m2In);
    $('#synth-m2-out').textContent = round2(m2Out);
  }

  function initSynthese() {
    $('#synth-period').addEventListener('change', renderSynthese);
  }

  // ══════════════════════════════════════════════════
  // ARCHIVES
  // ══════════════════════════════════════════════════
  async function renderArchives() {
    var search = ($('#archives-search').value || '').toLowerCase();
    var type = $('#archives-type').value;
    var body = $('#archives-body');
    body.innerHTML = '<tr><td colspan="7">Chargement...</td></tr>';
    
    if (!supabase) return;

    try {
      const { data, error } = await supabase.from('archives').select('*');
      if (error) throw error;
      
      var items = data || [];
      
      if (type === 'receptions') {
        items = items.filter(r => (r.record_type || '').toLowerCase().includes('reception') || (r.record_type || '').toLowerCase() === 'réception');
      } else if (type === 'sorties') {
        items = items.filter(r => (r.record_type || '').toLowerCase().includes('sortie'));
      }
      
      if (search) {
        items = items.filter(function (it) {
          return ((it.record_number || '') + (it.tiers || '') + (it.record_date || '') + (it.record_type || '')).toLowerCase().indexOf(search) >= 0;
        });
      }
      
      items.sort(function (a, b) { 
        var dateA = new Date(a.record_date || 0); 
        var dateB = new Date(b.record_date || 0); 
        return dateB - dateA; 
      });

      if (items.length === 0) {
        body.innerHTML = '<tr><td colspan="7" class="empty-state">Aucune archive trouvée.</td></tr>';
        return;
      }
      
      body.innerHTML = '';
      items.forEach(function (row) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + (row.record_number || '—') + '</td>' +
          '<td>' + (row.record_type || '—') + '</td>' +
          '<td>' + (row.record_date || '—') + '</td>' +
          '<td>' + (row.tiers || '—') + '</td>' +
          '<td>' + (row.lignes || 0) + '</td>' +
          '<td>' + round2(row.total_m2 || 0) + '</td>' +
          '<td>' +
          '<button class="btn-icon" onclick="editArchive(\'' + row.id + '\')" title="Modifier">✏️</button> ' +
          '<button class="btn-icon" onclick="deleteArchive(\'' + row.id + '\')" title="Supprimer" style="color:var(--danger)">🗑️</button>' +
          '</td>';
        body.appendChild(tr);
      });
    } catch (err) {
      body.innerHTML = '<tr><td colspan="7" class="text-danger">Erreur: ' + err.message + '</td></tr>';
    }
  }

  // ════════ QUICK EDIT MODAL LOGIC ════════
  state.editingArchive = null;
  state.editingArchiveOriginalLines = [];

  function renderQeLines() {
    var body = $('#qe-lines-body');
    body.innerHTML = '';
    var tCaisses = 0, tM2 = 0;
    
    var lines = state.editingArchive ? state.editingArchive.lines : [];
    if (!lines || lines.length === 0) {
      body.innerHTML = '<tr><td colspan="4" class="empty-state">Aucune ligne</td></tr>';
      $('#qe-total-caisses').textContent = '0';
      $('#qe-total-m2').textContent = '0';
      return;
    }

    lines.forEach(function (line, i) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (line.nom || line.reference_id || line.refId) + '</td>' +
        '<td>' + line.caisses + '</td>' +
        '<td>' + round2(line.m2 || line.total_m2) + '</td>' +
        '<td style="text-align: center;">' +
        '<button class="btn btn--danger btn--sm" onclick="removeLineEdit(' + i + ')">✕</button>' +
        '</td>';
      body.appendChild(tr);
      tCaisses += (parseInt(line.caisses) || 0);
      tM2 += (parseFloat(line.m2 || line.total_m2) || 0);
    });

    $('#qe-total-caisses').textContent = tCaisses;
    $('#qe-total-m2').textContent = round2(tM2);
  }

  window.removeLineEdit = function(index) {
    if (state.editingArchive && state.editingArchive.lines) {
      state.editingArchive.lines.splice(index, 1);
      renderQeLines();
    }
  };

  $('#qe-line-caisses').addEventListener('input', function () {
    var refId = $('#qe-line-ref').value;
    var ref = refById(refId);
    var caisses = parseFloat($('#qe-line-caisses').value) || 0;
    if (ref) {
      $('#qe-line-m2').value = round2(caisses * (ref.m2ParCaisse || ref.m2_par_caisse));
    } else {
      $('#qe-line-m2').value = '';
    }
  });

  $('#qe-add-line').addEventListener('click', function() {
    if (!state.editingArchive) return;
    if (!$selectedRefDraft) { alert("Sélectionnez une référence."); return; }
    
    var caisses = parseInt($('#qe-line-caisses').value) || 0;
    if (caisses <= 0) { alert("Nombre de caisses invalide."); return; }
    
    var duplicate = state.editingArchive.lines.some(l => (l.reference_id || l.refId || l.produit_id) === $selectedRefDraft.id);
    if (duplicate) { alert("Référence déjà présente."); return; }

    var total_m2 = round2(caisses * ($selectedRefDraft.m2_par_caisse || $selectedRefDraft.m2ParCaisse));

    state.editingArchive.lines.push({
      reference_id: $selectedRefDraft.id,
      produit_id: $selectedRefDraft.id,
      refId: $selectedRefDraft.id,
      nom: $selectedRefDraft.nom,
      fournisseur: $selectedRefDraft.fournisseur,
      format: $selectedRefDraft.format,
      caisses: caisses,
      nb_caisses: caisses,
      total_m2: total_m2,
      m2: total_m2
    });

    // Reset inputs
    $('#qe-line-ref').value = '';
    $('#qe-line-ref-search').value = '';
    $('#qe-line-caisses').value = '';
    $('#qe-line-m2').value = '';
    $selectedRefDraft = null;
    
    renderQeLines();
  });

  window.editArchive = async function(id) {
    try {
      // Find the target document in Supabase
      const { data: archiveDbObj, error } = await supabase.from('archives').select('*').eq('id', id).single();
      if (error) throw error;
      
      const recordNumber = archiveDbObj.record_number;
      
      // Find the target document in state.archives.receptions
      let localArchiveIndex = -1;
      let bon = null;
      if (state.archives && Array.isArray(state.archives.receptions)) {
          localArchiveIndex = state.archives.receptions.findIndex(b => b.number === recordNumber || b.numero === recordNumber);
          if (localArchiveIndex !== -1) {
              bon = state.archives.receptions[localArchiveIndex];
              if (bon && bon.lines) {
                  bon.lines = bon.lines.map(l => ({
                      reference_id: l.refId || l.produit_id,
                      produit_id: l.refId || l.produit_id,
                      nom: (refById(l.refId || l.produit_id) || {}).nom || '',
                      fournisseur: (refById(l.refId || l.produit_id) || {}).fournisseur || '',
                      format: (refById(l.refId || l.produit_id) || {}).format || '',
                      nb_caisses: l.caisses,
                      caisses: l.caisses,
                      total_m2: l.m2,
                      m2: l.m2
                  }));
              }
          }
      }

      if (!bon && Array.isArray(state.archives_reception)) {
          const idx = state.archives_reception.findIndex(b => b.id === recordNumber);
          if (idx !== -1) bon = state.archives_reception[idx];
      }

      if (!bon) {
          alert("Archive introuvable dans la session active.");
          return;
      }

      // LOAD TO MODAL STATE
      state.editingArchive = JSON.parse(JSON.stringify(bon));
      state.editingArchiveOriginalLines = JSON.parse(JSON.stringify(bon.lines || []));
      state.editingArchiveDbId = id; // the supabase ID for the archive row
      
      $('#qe-title').textContent = "Édition Rapide : " + recordNumber;
      
      // Set up autocomplete if not done already for QE
      setupAutocomplete('#qe-line-ref-search', '#qe-line-ref', '#qe-autocomplete-list', false);
      
      renderQeLines();
      $('#quick-edit-modal').hidden = false;
      
    } catch (err) {
      alert("Erreur: " + err.message);
    }
  };

  $('#quick-edit-close').addEventListener('click', function() { $('#quick-edit-modal').hidden = true; });
  $('#qe-btn-annuler').addEventListener('click', function() { $('#quick-edit-modal').hidden = true; });

  $('#qe-btn-save').addEventListener('click', async function() {
    if (!state.editingArchive || !state.editingArchive.lines || state.editingArchive.lines.length === 0) {
      alert("Ajoutez au moins une ligne.");
      return;
    }
    
    if (!confirm("Ceci va ajuster les stocks en fonction de la différence avec votre ancien ticket. Continuer ?")) return;
    
    const recordNumber = state.editingArchive.numero || state.editingArchive.number || state.editingArchive.id;

    try {
      // 1. REVERSE OLD STOCK
      if (state.editingArchiveOriginalLines.length > 0) {
        for (const line of state.editingArchiveOriginalLines) {
           const refId = line.reference_id || line.refId || line.produit_id;
           const ref = state.references.find(r => r.id === refId);
           const m2ToDeduct = parseFloat(line.total_m2 || line.m2 || 0);
           
           if (ref && m2ToDeduct > 0) {
               ref.stock_m2 = (ref.stockM2 || ref.stock_m2 || 0) - m2ToDeduct; 
               ref.stockM2 = ref.stock_m2;
               const newStock = round2(ref.stock_m2);
               await supabase.from('produits').update({ stock_m2: newStock }).eq('id', ref.id);
               // Negative movement correction
               await supabase.from('mouvements').insert({
                  date: today(),
                  type: 'reception_correction_out',
                  reference_id: ref.id,
                  quantity_m2: -m2ToDeduct,
                  document_ref: recordNumber
               });
           }
        }
      }

      // 2. APPLY NEW STOCK
      for (const l of state.editingArchive.lines) {
         const refId = l.reference_id || l.refId || l.produit_id;
         const ref = state.references.find(r => r.id === refId);
         if (ref) {
            const newStockM2 = round2((ref.stockM2 || ref.stock_m2 || 0) + l.m2);
            ref.stock_m2 = newStockM2;
            ref.stockM2 = newStockM2;
            await supabase.from('produits').update({ stock_m2: newStockM2 }).eq('id', refId);
         }
         await supabase.from('mouvements').insert({
            date: today(),
            type: 'reception_correction_in',
            reference_id: refId,
            quantity_m2: l.m2,
            document_ref: recordNumber
         });
      }

      // 3. UPDATE ARCHIVE IN SUPABASE (bons_reception_lignes & archives)
      const newTotalCaisses = state.editingArchive.lines.reduce((s, l) => s + (parseInt(l.caisses)||0), 0);
      const newTotalM2 = round2(state.editingArchive.lines.reduce((s, l) => s + (parseFloat(l.m2)||0), 0));
      
      const realBonId = state.editingArchive.originalId || state.editingArchive.bon_id || state.editingArchive.id;

      // Ensure we hit the integer bon_id if looking inside bons_reception
      const localBr = typeof realBonId === 'number' ? realBonId : null;

      if (localBr) {
         // Drop old lines
         await supabase.from('bons_reception_lignes').delete().eq('bon_id', localBr);
         // Insert new lines
         const lignesToInsert = state.editingArchive.lines.map(l => ({
            bon_id: localBr,
            produit_id: l.reference_id || l.refId || l.produit_id,
            caisses: l.caisses,
            m2: l.m2
         }));
         await supabase.from('bons_reception_lignes').insert(lignesToInsert);
         // Update totals in bons_reception
         await supabase.from('bons_reception').update({ total_caisses: newTotalCaisses, total_m2: newTotalM2 }).eq('id', localBr);
      }
      
      // Update the archives summary overview table
      await supabase.from('archives').update({
          lignes: state.editingArchive.lines.length,
          total_m2: newTotalM2
      }).eq('id', state.editingArchiveDbId);

      // 4. PRINT & CLOSE
      var printData = {
         numero: recordNumber,
         date: state.editingArchive.date || state.editingArchive.record_date || today(),
         bl: state.editingArchive.bl || '—',
         fournisseur: state.editingArchive.fournisseur || state.editingArchive.tiers || '—',
         transporteur: state.editingArchive.transporteur || '—',
         total_caisses: newTotalCaisses,
         total_m2: newTotalM2
      };

      generatePrintLayout(printData, state.editingArchive.lines, 'reception');
      
      $('#quick-edit-modal').hidden = true;
      state.editingArchive = null;
      state.editingArchiveOriginalLines = [];
      toast('Archive mise à jour avec succès.', 'success');

      // Refresh background data
      renderArchives();
      loadState();

      // Fire print shielded
      setTimeout(() => {
          document.body.classList.add('printing-bon');
          window.print();
          setTimeout(() => { document.body.classList.remove('printing-bon'); }, 500);
      }, 150);

    } catch (err) {
      alert("Erreur critique lors de la mise à jour : " + err.message);
    }
  });

  window.deleteArchive = async function(id) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette archive ?')) return;

    try {
      const { error } = await supabase.from('archives').delete().eq('id', id);
      if (error) throw error;
      
      toast('Archive supprimée', 'success');
      renderArchives();
    } catch (err) {
      alert("Erreur durant la suppression: " + err.message);
    }
  };

  function initArchives() {
    $('#archives-search').addEventListener('input', renderArchives);
    $('#archives-type').addEventListener('change', renderArchives);
  }

  // ── Detail Modal ──
  function openDetailModal(doc, docType) {
    var modal = $('#detail-modal');
    $('#modal-title').textContent = doc.number + ' — ' + (docType === 'reception' ? 'Réception' : 'Sortie');
    var html = '';
    html += '<div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">' + doc.date + '</span></div>';
    if (docType === 'reception') {
      html += '<div class="detail-row"><span class="detail-label">N° BL</span><span class="detail-value">' + (doc.bl || '—') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Fournisseur</span><span class="detail-value">' + (doc.fournisseur || '—') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Transporteur</span><span class="detail-value">' + (doc.transporteur || '—') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Chauffeur</span><span class="detail-value">' + (doc.chauffeur || '—') + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Matricule</span><span class="detail-value">' + (doc.matricule || '—') + '</span></div>';
    } else {
      html += '<div class="detail-row"><span class="detail-label">Client</span><span class="detail-value">' + (doc.client || '—') + '</span></div>';
    }
    html += '<div class="detail-row"><span class="detail-label">Total caisses</span><span class="detail-value">' + doc.totalCaisses + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Total m²</span><span class="detail-value">' + round2(doc.totalM2) + '</span></div>';
    html += '<div class="detail-lines"><table class="table"><thead><tr><th>Référence</th><th>Caisses</th><th>m²</th></tr></thead><tbody>';
    doc.lines.forEach(function (l) {
      var ref = refById(l.refId);
      html += '<tr><td>' + (ref ? ref.nom : l.refId) + '</td><td>' + l.caisses + '</td><td>' + round2(l.m2) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    $('#modal-body').innerHTML = html;
    modal.hidden = false;
  }

  function initModal() {
    $('#modal-close').addEventListener('click', function () { $('#detail-modal').hidden = true; });
    $('.modal__overlay').addEventListener('click', function () { $('#detail-modal').hidden = true; });
  }

  // ══════════════════════════════════════════════════
  // DIRECTION — References & Clients
  // ══════════════════════════════════════════════════
  function renderDirRefs(filter) {
    filter = (filter || '').toLowerCase();
    var body = $('#dir-ref-body');
    body.innerHTML = '';
    var refs = state.references.filter(function (r) {
      if (!filter) return true;
      return (r.nom + r.fournisseur + r.format).toLowerCase().indexOf(filter) >= 0;
    });
    if (refs.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">Aucune référence</td></tr>';
      return;
    }
    refs.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + r.nom + '</td>' +
        '<td>' + r.fournisseur + '</td>' +
        '<td>' + r.format + '</td>' +
        '<td>' + r.m2ParCaisse + '</td>' +
        '<td><button class="btn btn--danger btn--sm" data-id="' + r.id + '">Supprimer</button></td>';
      body.appendChild(tr);
    });
    body.querySelectorAll('.btn--danger').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-id');
        if (!supabase) return;
        try {
          const { error } = await supabase.from('produits').delete().eq('id', id);
          if (error) throw error;
          await loadState();
          renderDirRefs($('#dir-ref-search').value);
          refreshDropdowns();
          toast('Référence supprimée', 'info');
        } catch(err) { toast('Erreur: ' + err.message, 'error'); }
      });
    });
  }

  function renderDirClients() {
    var body = $('#dir-client-body');
    body.innerHTML = '';
    if (state.clients.length === 0) {
      body.innerHTML = '<tr><td colspan="3" class="empty-state">Aucun client</td></tr>';
      return;
    }
    state.clients.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + c.nom + '</td>' +
        '<td>' + (c.type || '—') + '</td>' +
        '<td><button class="btn btn--danger btn--sm" data-id="' + c.id + '">Supprimer</button></td>';
      body.appendChild(tr);
    });
    body.querySelectorAll('.btn--danger').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-id');
        if (!supabase) return;
        try {
          const { error } = await supabase.from('clients').delete().eq('id', id);
          if (error) throw error;
          await loadState();
          renderDirClients();
          populateClients();
          toast('Client supprimé', 'info');
        } catch(err) { toast('Erreur: ' + err.message, 'error'); }
      });
    });
  }

  async function renderDirUsers() {
    var body = $('#dir-users-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="2">Chargement...</td></tr>';
    try {
      const { data: users, error } = await supabase.from('utilisateurs').select('*');
      if (error) throw error;
      body.innerHTML = '';
      if (!users || users.length === 0) {
        body.innerHTML = '<tr><td colspan="2" class="empty-state">Aucun utilisateur</td></tr>';
        return;
      }
      users.forEach(u => {
        var tr = document.createElement('tr');
        var isWait = u.role === 'en_attente' ? 'selected' : '';
        var isOp = u.role === 'operateur' ? 'selected' : '';
        var isDir = u.role === 'direction' ? 'selected' : '';
        tr.innerHTML = 
          '<td>' + u.email + '</td>' +
          '<td>' +
             '<select class="input input-role" data-id="'+u.id+'">' +
                '<option value="en_attente" '+isWait+'>En attente</option>' +
                '<option value="operateur" '+isOp+'>Opérateur</option>' +
                '<option value="direction" '+isDir+'>Direction</option>' +
             '</select>' +
          '</td>';
        body.appendChild(tr);
      });
      
      body.querySelectorAll('.input-role').forEach(function(sel) {
        sel.addEventListener('change', async function() {
          var userId = this.getAttribute('data-id');
          var newRole = this.value;
          try {
            const { error: errUpd } = await supabase.from('utilisateurs').update({ role: newRole }).eq('id', userId);
            if (errUpd) throw errUpd;
            toast('Rôle mis à jour', 'success');
          } catch(err) {
            toast('Erreur: ' + err.message, 'error');
            renderDirUsers(); // revert UI on failure
          }
        });
      });
    } catch(err) {
      body.innerHTML = '<tr><td colspan="2" class="text-danger">Erreur: '+err.message+'</td></tr>';
    }
  }

  function initDirection() {
    $('#dir-ref-search').addEventListener('input', function () { renderDirRefs(this.value); });
    $('#dir-ref-add').addEventListener('click', async function () {
      if(!supabase) return;
      var nom = $('#dir-ref-nom').value.trim();
      var fournisseur = $('#dir-ref-fournisseur').value;
      var format = $('#dir-ref-format').value.trim();
      var m2 = parseFloat($('#dir-ref-m2caisse').value) || 0;
      if (!nom) { toast('Le nom est requis', 'error'); return; }
      if (!fournisseur) { toast('Sélectionnez un fournisseur', 'error'); return; }
      if (m2 <= 0) { toast('m²/caisse invalide', 'error'); return; }
      var dup = state.references.find(function (r) {
        return r.nom.toLowerCase() === nom.toLowerCase() && r.fournisseur === fournisseur && r.format === format;
      });
      if (dup) { toast('Cette référence existe déjà', 'error'); return; }
      try {
        const { error } = await supabase.from('produits').insert({ nom: nom, fournisseur: fournisseur, format: format, m2_par_caisse: m2, stock_m2: 0 });
        if (error) throw error;
        await loadState();
        $('#dir-ref-nom').value = '';
        $('#dir-ref-format').value = '';
        $('#dir-ref-m2caisse').value = '';
        renderDirRefs();
        refreshDropdowns();
        toast('Référence ajoutée : ' + nom, 'success');
      } catch(err) { toast('Erreur ajout: ' + err.message, 'error'); }
    });
    $('#dir-client-add').addEventListener('click', async function () {
      if(!supabase) return;
      var nom = $('#dir-client-nom').value.trim();
      if (!nom) { toast('Le nom du client est requis', 'error'); return; }
      if (state.clients.find(c => c.nom.toLowerCase() === nom.toLowerCase())) { toast('Ce client existe déjà', 'error'); return; }
      try {
        const { error } = await supabase.from('clients').insert({ nom: nom, type: 'compte' });
        if (error) throw error;
        await loadState();
        $('#dir-client-nom').value = '';
        renderDirClients();
        populateClients();
        toast('Client ajouté : ' + nom, 'success');
      } catch(err) { toast('Erreur ajout: ' + err.message, 'error'); }
    });
    
    $('#dir-mvt-btn').addEventListener('click', async function() {
      var refId = $('#dir-mvt-ref').value;
      if(!refId) { toast('Sélectionnez une référence', 'error'); return; }
      if(!supabase) return;
      var body = $('#dir-mvt-body');
      body.innerHTML = '<tr><td colspan="5">Chargement...</td></tr>';
      try {
        var { data: mvts } = await supabase.from('mouvements').select('*').eq('reference_id', refId).order('date', { ascending: false });
        body.innerHTML = '';
        if(!mvts || mvts.length === 0) {
          body.innerHTML = '<tr><td colspan="5" class="empty-state">Aucun mouvement</td></tr>';
          return;
        }
        var ref = refById(refId);
        mvts.forEach(function(m) {
          var caisses = ref && ref.m2ParCaisse ? round2(m.quantity_m2 / ref.m2ParCaisse) : '—';
          // color red for sortie, green for reception
          var style = m.type === 'sortie' ? 'color: var(--danger)' : 'color: var(--success)';
          var typeLabel = m.type === 'sortie' ? 'Sortie' : 'Réception';
          var sign = m.type === 'sortie' ? '-' : '+';
          var tr = document.createElement('tr');
          tr.innerHTML = 
            '<td>' + m.date + '</td>' +
            '<td>' + typeLabel + '</td>' +
            '<td>' + (m.document_ref || '—') + '</td>' +
            '<td style="' + style + '"><strong>' + sign + Math.abs(caisses) + '</strong></td>' +
            '<td style="' + style + '"><strong>' + sign + round2(Math.abs(m.quantity_m2)) + '</strong></td>';
          body.appendChild(tr);
        });
      } catch(e) {
        toast('Erreur mvts: ' + e.message, 'error');
      }
    });
  }

  // ══════════════════════════════════════════════════
  // GLOBAL SEARCH
  // ══════════════════════════════════════════════════
  function initGlobalSearch() {
    $('#global-search').addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      if (!q) return;
      // Search references → switch to stock tab
      var found = state.references.some(function (r) {
        return (r.nom + r.fournisseur + r.format).toLowerCase().indexOf(q) >= 0;
      });
      if (found) { switchTab('stock'); renderStock(q); $('#stock-search').value = this.value; }
    });
  }

  // ══════════════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════════════
  var state;

  function showFatalError(err) {
      var el = document.getElementById('fatal-error');
      var msg = document.getElementById('fatal-error-msg');
      if (el && msg) {
        msg.textContent = err.message || 'Erreur inconnue';
        el.hidden = false;
      }
      console.error('ORAMED boot error:', err);
  }

  async function initAppData(role) {
    try {
      await loadState();

      var badge = $('#role-badge');
      badge.textContent = role;
      if (role === 'operateur') {
        badge.classList.add('role-badge--operateur');
        $('#tab-direction').style.display = 'none';
      }

      applyTheme(resolveTheme());
      $('#theme-toggle').addEventListener('click', function () {
        var cur = document.documentElement.getAttribute('data-theme');
        applyTheme(cur === 'dark' ? 'light' : 'dark');
      });

      refreshDropdowns();
      initTabs();
      initReception();
      initSortie();
      initStock();
      initSynthese();
      initArchives();
      initDirection();
      initModal();
      initGlobalSearch();
      
      if (role !== 'operateur') {
         renderDirUsers();
      }

      switchTab('reception');
    } catch(err) {
      showFatalError(err);
    }
  }

  async function boot() {
    try {
      initAuthUI();
      await checkSession();
    } catch (err) {
      showFatalError(err);
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
