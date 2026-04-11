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
    mouvements: []
  };

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
    const el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.textContent = msg;
    $('#toast-container').appendChild(el);
    setTimeout(function () {
      el.classList.add('toast--out');
      setTimeout(function () { el.remove(); }, 300);
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

  function populateFournisseurs() {
    // Fournisseur select is now hardcoded in HTML with optgroups — no-op
  }

  // Populate #br-line-ref filtered by marque
  function populateBrRefs(marque) {
    var sel = $('#br-line-ref');
    sel.innerHTML = '<option value="">— Référence —</option>';
    if (!marque) { sel.disabled = true; return; }
    var filtered = state.references.filter(function (r) { return r.fournisseur === marque; });
    filtered.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.nom + ' (' + r.fournisseur + ' · ' + r.format + ')';
      sel.appendChild(o);
    });
    sel.disabled = false;
  }

  function populateRefSelects() {
    // Only populate non-cascaded ref selects (sortie + direction)
    var sels = [
      { el: '#bs-line-ref', filter: null },
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

  function brNextNumber() {
    return 'BR-' + padNum(state.settings.brCounter, 4);
  }

  function brReset() {
    brDraft = { lines: [] };
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
    $('#br-line-ref').innerHTML = '<option value="">— Référence —</option>';
    $('#br-line-ref').disabled = true;
    $('#br-line-caisses').value = '';
    $('#br-line-m2').value = '';
    $('#br-number').textContent = brNextNumber();
    renderBrLines();
  }

  function renderBrLines() {
    var body = $('#br-lines-body');
    body.innerHTML = '';
    var tCaisses = 0, tM2 = 0;
    if (brDraft.lines.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="empty-state">Aucune ligne ajoutée</td></tr>';
    } else {
      brDraft.lines.forEach(function (line, i) {
        var ref = refById(line.refId);
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + (ref ? ref.nom : '?') + '</td>' +
          '<td>' + (ref ? ref.fournisseur : '') + '</td>' +
          '<td>' + (ref ? ref.format : '') + '</td>' +
          '<td>' + line.caisses + '</td>' +
          '<td>' + round2(line.m2) + '</td>' +
          '<td><button class="btn btn--danger btn--sm" data-idx="' + i + '">✕</button></td>';
        body.appendChild(tr);
        tCaisses += line.caisses;
        tM2 += line.m2;
      });
    }
    $('#br-total-caisses').innerHTML = '<strong>' + tCaisses + '</strong>';
    $('#br-total-m2').innerHTML = '<strong>' + round2(tM2) + '</strong>';
    // Bind delete buttons
    body.querySelectorAll('.btn--danger').forEach(function (btn) {
      btn.addEventListener('click', function () {
        brDraft.lines.splice(parseInt(btn.getAttribute('data-idx')), 1);
        renderBrLines();
      });
    });
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
    // Add line
    $('#br-add-line').addEventListener('click', function () {
      var refId = $('#br-line-ref').value;
      var ref = refById(refId);
      var caisses = parseInt($('#br-line-caisses').value) || 0;
      if (!ref) { toast('Sélectionnez une référence', 'error'); return; }
      if (caisses <= 0) { toast('Nombre de caisses invalide', 'error'); return; }
      brDraft.lines.push({ refId: refId, caisses: caisses, m2: round2(caisses * ref.m2ParCaisse) });
      $('#br-line-ref').value = '';
      $('#br-line-caisses').value = '';
      $('#br-line-m2').value = '';
      renderBrLines();
    });
    // Nouveau
    $('#br-nouveau').addEventListener('click', function () { brReset(); toast('Nouveau bon de réception', 'info'); });
    // Valider
    $('#br-valider').addEventListener('click', async function () {
      if (brDraft.lines.length === 0) { toast('Ajoutez au moins une ligne', 'error'); return; }
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
        total_caisses: brDraft.lines.reduce(function (s, l) { return s + l.caisses; }, 0),
        total_m2: round2(brDraft.lines.reduce(function (s, l) { return s + l.m2; }, 0)),
        created_at: new Date().toISOString()
      };

      try {
        const { data: br, error: errBr } = await supabase.from('bons_reception').insert(receptionData).select().single();
        if(errBr || !br) throw new Error(errBr ? errBr.message : 'Error insertion BR');

        const lignesToInsert = brDraft.lines.map(l => ({
          bon_id: br.id,
          produit_id: l.refId,
          caisses: l.caisses,
          m2: l.m2
        }));

        await supabase.from('bons_reception_lignes').insert(lignesToInsert);

        for (const l of brDraft.lines) {
          const ref = refById(l.refId);
          if (ref) {
            const newStockM2 = round2((ref.stockM2 || 0) + l.m2);
            await supabase.from('produits').update({ stock_m2: newStockM2 }).eq('id', l.refId);
          }
          await supabase.from('mouvements').insert({
            date: date,
            type: 'reception',
            reference_id: l.refId,
            quantity_m2: l.m2,
            document_ref: br.numero || ('BR-' + br.id)
          });
        }

        await loadState();
        brReset();
        toast('Réception validée : ' + (br.numero || 'BR-'+br.id), 'success');
        refreshDropdowns();
        if ($('#panel-stock').classList.contains('active')) renderStock($('#stock-search').value);
      } catch (err) {
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
      } catch (err) {
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
  function renderArchives() {
    var search = ($('#archives-search').value || '').toLowerCase();
    var type = $('#archives-type').value;
    var body = $('#archives-body');
    body.innerHTML = '';
    var items = [];
    if (type === 'all' || type === 'receptions') {
      state.archives.receptions.forEach(function (r) {
        items.push({ type: 'Réception', number: r.number, date: r.date, tiers: r.fournisseur, lines: r.lines.length, totalM2: r.totalM2, data: r, docType: 'reception' });
      });
    }
    if (type === 'all' || type === 'sorties') {
      state.archives.sorties.forEach(function (s) {
        items.push({ type: 'Sortie', number: s.number, date: s.date, tiers: s.client, lines: s.lines.length, totalM2: s.totalM2, data: s, docType: 'sortie' });
      });
    }
    // Filter
    if (search) {
      items = items.filter(function (it) {
        return (it.number + it.tiers + it.date + it.type).toLowerCase().indexOf(search) >= 0;
      });
    }
    // Sort newest first
    items.sort(function (a, b) { return (b.data.createdAt || '').localeCompare(a.data.createdAt || ''); });
    if (items.length === 0) {
      body.innerHTML = '<tr><td colspan="7" class="empty-state">Aucune archive trouvée</td></tr>';
      return;
    }
    items.forEach(function (it) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + it.number + '</td>' +
        '<td>' + it.type + '</td>' +
        '<td>' + it.date + '</td>' +
        '<td>' + (it.tiers || '—') + '</td>' +
        '<td>' + it.lines + '</td>' +
        '<td>' + round2(it.totalM2) + '</td>' +
        '<td><button class="btn btn--outline btn--sm" data-id="' + it.data.id + '" data-doc="' + it.docType + '">Voir</button></td>';
      body.appendChild(tr);
    });
    body.querySelectorAll('.btn--outline').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var docType = btn.getAttribute('data-doc');
        var docId = btn.getAttribute('data-id');
        var arr = docType === 'reception' ? state.archives.receptions : state.archives.sorties;
        var doc = arr.find(function (d) { return d.id === docId; });
        if (doc) openDetailModal(doc, docType);
      });
    });
  }

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
