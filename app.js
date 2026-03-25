/* ══════════════════════════════════════════════════════
   ORAMED — App Logic (app.js)
   Centralized state, role-based tabs, full CRUD
   ══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Constants ──
  const STORAGE_KEY = 'oramed_app_state';
  const ROLE_KEY = 'oramed_app_role';
  const THEME_KEY = 'oramed_app_theme';

  // ── Utility ──
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function padNum(n, len) { return String(n).padStart(len, '0'); }
  function round2(v) { return Math.round(v * 100) / 100; }
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  // ── Default State ──
  function defaultState() {
    return {
      references: [],
      clients: [],
      receptions: [],
      sorties: [],
      archives: { receptions: [], sorties: [] },
      settings: { brCounter: 1, bsCounter: 1 }
    };
  }

  // ── State persistence ──
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaultState();
      const def = defaultState();
      // Merge with defaults to fill missing keys
      for (const k of Object.keys(def)) {
        if (!(k in parsed)) parsed[k] = def[k];
      }
      if (!parsed.archives) parsed.archives = { receptions: [], sorties: [] };
      if (!parsed.archives.receptions) parsed.archives.receptions = [];
      if (!parsed.archives.sorties) parsed.archives.sorties = [];
      if (!parsed.settings) parsed.settings = { brCounter: 1, bsCounter: 1 };
      return parsed;
    } catch (_) {
      return defaultState();
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* silent */ }
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

  // ── Role Logic ──
  function resolveRole() {
    var params = new URLSearchParams(window.location.search);
    var urlRole = params.get('role');
    if (urlRole === 'direction' || urlRole === 'operateur') {
      localStorage.setItem(ROLE_KEY, urlRole);
      return urlRole;
    }
    var stored = localStorage.getItem(ROLE_KEY);
    if (stored === 'direction' || stored === 'operateur') return stored;
    return 'direction';
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
  function populateFournisseurs() {
    var sel = $('#br-fournisseur');
    sel.innerHTML = '<option value="">— Sélectionner —</option>';
    var fSet = new Set(state.references.map(function (r) { return r.fournisseur; }));
    fSet.forEach(function (f) {
      if (!f) return;
      var o = document.createElement('option'); o.value = f; o.textContent = f; sel.appendChild(o);
    });
  }

  function populateRefSelects() {
    var sels = [
      { el: '#br-line-ref', filter: null },
      { el: '#bs-line-ref', filter: null }
    ];
    sels.forEach(function (s) {
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
      var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
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
    $('#br-matricule').value = '';
    $('#br-line-ref').value = '';
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

  function initReception() {
    brReset();
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
    $('#br-valider').addEventListener('click', function () {
      if (brDraft.lines.length === 0) { toast('Ajoutez au moins une ligne', 'error'); return; }
      var reception = {
        id: uid(),
        number: brNextNumber(),
        date: $('#br-date').value || today(),
        bl: $('#br-bl').value,
        fournisseur: $('#br-fournisseur').value,
        transporteur: $('#br-transporteur').value,
        chauffeur: $('#br-chauffeur').value,
        matricule: $('#br-matricule').value,
        lines: brDraft.lines.slice(),
        totalCaisses: brDraft.lines.reduce(function (s, l) { return s + l.caisses; }, 0),
        totalM2: round2(brDraft.lines.reduce(function (s, l) { return s + l.m2; }, 0)),
        createdAt: new Date().toISOString()
      };
      // Update stock
      reception.lines.forEach(function (l) { addStock(l.refId, l.caisses); });
      state.archives.receptions.push(reception);
      state.settings.brCounter++;
      saveState();
      brReset();
      toast('Réception validée : ' + reception.number, 'success');
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
    $('#bs-valider').addEventListener('click', function () {
      if (bsDraft.lines.length === 0) { toast('Ajoutez au moins une ligne', 'error'); return; }
      var sortie = {
        id: uid(),
        number: bsNextNumber(),
        date: $('#bs-date').value || today(),
        client: $('#bs-client').value,
        lines: bsDraft.lines.slice(),
        totalCaisses: bsDraft.lines.reduce(function (s, l) { return s + l.caisses; }, 0),
        totalM2: round2(bsDraft.lines.reduce(function (s, l) { return s + l.m2; }, 0)),
        createdAt: new Date().toISOString()
      };
      sortie.lines.forEach(function (l) { removeStock(l.refId, l.caisses); });
      state.archives.sorties.push(sortie);
      state.settings.bsCounter++;
      saveState();
      bsReset();
      toast('Sortie validée : ' + sortie.number, 'success');
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
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        state.references = state.references.filter(function (r) { return r.id !== id; });
        saveState();
        renderDirRefs($('#dir-ref-search').value);
        refreshDropdowns();
        toast('Référence supprimée', 'info');
      });
    });
  }

  function renderDirClients() {
    var body = $('#dir-client-body');
    body.innerHTML = '';
    if (state.clients.length === 0) {
      body.innerHTML = '<tr><td colspan="2" class="empty-state">Aucun client</td></tr>';
      return;
    }
    state.clients.forEach(function (c, i) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + c + '</td>' +
        '<td><button class="btn btn--danger btn--sm" data-idx="' + i + '">Supprimer</button></td>';
      body.appendChild(tr);
    });
    body.querySelectorAll('.btn--danger').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.clients.splice(parseInt(btn.getAttribute('data-idx')), 1);
        saveState();
        renderDirClients();
        populateClients();
        toast('Client supprimé', 'info');
      });
    });
  }

  function initDirection() {
    $('#dir-ref-search').addEventListener('input', function () { renderDirRefs(this.value); });
    $('#dir-ref-add').addEventListener('click', function () {
      var nom = $('#dir-ref-nom').value.trim();
      var fournisseur = $('#dir-ref-fournisseur').value;
      var format = $('#dir-ref-format').value.trim();
      var m2 = parseFloat($('#dir-ref-m2caisse').value) || 0;
      if (!nom) { toast('Le nom est requis', 'error'); return; }
      if (!fournisseur) { toast('Sélectionnez un fournisseur', 'error'); return; }
      if (m2 <= 0) { toast('m²/caisse invalide', 'error'); return; }
      // Duplicate check
      var dup = state.references.find(function (r) {
        return r.nom.toLowerCase() === nom.toLowerCase() && r.fournisseur === fournisseur && r.format === format;
      });
      if (dup) { toast('Cette référence existe déjà', 'error'); return; }
      state.references.push({ id: uid(), nom: nom, fournisseur: fournisseur, format: format, m2ParCaisse: m2, stockM2: 0 });
      saveState();
      $('#dir-ref-nom').value = '';
      $('#dir-ref-format').value = '';
      $('#dir-ref-m2caisse').value = '';
      renderDirRefs();
      refreshDropdowns();
      toast('Référence ajoutée : ' + nom, 'success');
    });
    $('#dir-client-add').addEventListener('click', function () {
      var nom = $('#dir-client-nom').value.trim();
      if (!nom) { toast('Le nom du client est requis', 'error'); return; }
      if (state.clients.indexOf(nom) >= 0) { toast('Ce client existe déjà', 'error'); return; }
      state.clients.push(nom);
      saveState();
      $('#dir-client-nom').value = '';
      renderDirClients();
      populateClients();
      toast('Client ajouté : ' + nom, 'success');
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

  function boot() {
    try {
      // 1. Load state
      state = loadState();

      // 2. Role
      var role = resolveRole();
      var badge = $('#role-badge');
      badge.textContent = role;
      if (role === 'operateur') {
        badge.classList.add('role-badge--operateur');
        $('#tab-direction').style.display = 'none';
      }

      // 3. Theme
      applyTheme(resolveTheme());
      $('#theme-toggle').addEventListener('click', function () {
        var cur = document.documentElement.getAttribute('data-theme');
        applyTheme(cur === 'dark' ? 'light' : 'dark');
      });

      // 4. Init modules
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

      // 5. Show first tab
      switchTab('reception');

    } catch (err) {
      var el = document.getElementById('fatal-error');
      var msg = document.getElementById('fatal-error-msg');
      if (el && msg) {
        msg.textContent = err.message || 'Erreur inconnue';
        el.hidden = false;
      }
      console.error('ORAMED boot error:', err);
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
