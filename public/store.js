(function () {
  'use strict';

  // Cada tbody do app espelha-se em uma chave do localStorage. Em
  // mudanças no DOM (incluindo via funções existentes como addCustomer,
  // saveOS, updateVehiclesList) salvamos seu innerHTML; ao recarregar a
  // página, restauramos antes de qualquer outro script rodar.
  const KEYS = {
    'customers-table-body':       'dihmec_customers_html',
    'vehicles-table-body':        'dihmec_vehicles_html',
    'products-table-body':        'dihmec_products_html',
    'receivables-table-body':     'dihmec_receivables_html',
    'paid-table-body':            'dihmec_paid_html',
    'pending-os-table-body':      'dihmec_pending_os_html',
    'pending-os-finish-table-body': 'dihmec_pending_os_finish_html',
    'all-os-table-body':          'dihmec_all_os_html',
    'plate-search-table-body':    'dihmec_plate_search_html',
    'checklist-table-body':       'dihmec_checklist_html',
  };

  const observers = new Map();
  const writeTimers = new Map();

  function restoreAll() {
    Object.keys(KEYS).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const html = localStorage.getItem(KEYS[id]);
      if (typeof html === 'string') el.innerHTML = html;
    });
  }

  function persistTbody(id) {
    const el = document.getElementById(id);
    if (!el) return;
    try { localStorage.setItem(KEYS[id], el.innerHTML); }
    catch (e) { /* quota? ignora */ }
  }

  function schedulePersist(id) {
    if (writeTimers.has(id)) clearTimeout(writeTimers.get(id));
    writeTimers.set(id, setTimeout(() => {
      persistTbody(id);
      recomputeTotals(id);
    }, 80));
  }

  // Mapa: tbody → { totalEl, valueColumnIndex }
  const TOTALS = {
    'receivables-table-body': { totalId: 'receivables-total', col: 6 },
    'paid-table-body':        { totalId: 'paid-total',        col: 6 },
  };

  function parseBRL(str) {
    if (!str) return 0;
    // "R$ 1.234,56" → 1234.56
    const m = String(str).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(m);
    return isNaN(n) ? 0 : n;
  }

  function recomputeTotals(changedId) {
    Object.keys(TOTALS).forEach((id) => {
      if (changedId && id !== changedId) return;
      const cfg = TOTALS[id];
      const tbody = document.getElementById(id);
      const totalEl = document.getElementById(cfg.totalId);
      if (!tbody || !totalEl) return;
      let sum = 0;
      tbody.querySelectorAll('tr').forEach((tr) => {
        const cell = tr.children[cfg.col];
        if (cell) sum += parseBRL(cell.textContent);
      });
      totalEl.textContent = 'R$ ' + sum.toFixed(2)
        .replace('.', ',')
        .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    });
  }

  function watchAll() {
    Object.keys(KEYS).forEach((id) => {
      const el = document.getElementById(id);
      if (!el || observers.has(id)) return;
      const obs = new MutationObserver(() => schedulePersist(id));
      obs.observe(el, { childList: true, subtree: true, characterData: true });
      observers.set(id, obs);
    });
  }

  // ---------- Helpers ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function fmtBRL(n) {
    return 'R$ ' + Number(n).toFixed(2)
      .replace('.', ',')
      .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function findRowByCell(tbody, columnIndex, value) {
    return Array.from(tbody.querySelectorAll('tr')).find(
      (r) => r.children[columnIndex] &&
             r.children[columnIndex].textContent.trim() === value
    );
  }

  // ---------- Form: Cadastrar Produto ----------
  function attachProductForm() {
    const form = document.getElementById('product-form');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const code     = (document.getElementById('product-code').value || '').trim().toUpperCase();
      const name     = (document.getElementById('product-name').value || '').trim();
      const category = (document.getElementById('product-category').value || '').trim();
      const qty      = parseInt(document.getElementById('product-qty').value, 10);
      const unit     = (document.getElementById('product-unit').value || '').trim();
      const price    = parseFloat(document.getElementById('product-price').value);

      if (!code || !name || !category || !unit || isNaN(qty) || isNaN(price)) {
        alert('Preencha todos os campos do produto.');
        return;
      }

      const tbody = document.getElementById('products-table-body');
      if (!tbody) return;
      if (findRowByCell(tbody, 0, code)) {
        alert('Já existe um produto com este código.');
        return;
      }

      const total = qty * price;
      const status = qty === 0
        ? 'Esgotado'
        : (qty < 5 ? 'Baixo Estoque' : 'Disponível');

      const row = document.createElement('tr');
      row.innerHTML =
        '<td>' + escapeHtml(code) + '</td>' +
        '<td>' + escapeHtml(name) + '</td>' +
        '<td>' + escapeHtml(category) + '</td>' +
        '<td>' + qty + '</td>' +
        '<td>' + escapeHtml(unit) + '</td>' +
        '<td>' + fmtBRL(price) + '</td>' +
        '<td>' + fmtBRL(total) + '</td>' +
        '<td>' + status + '</td>' +
        '<td><div class="action-buttons">' +
          '<button class="btn-action btn-edit" type="button" onclick="DIHMECStore.editProduct(\'' + escapeHtml(code) + '\')">Editar</button> ' +
          '<button class="btn-action btn-delete" type="button" onclick="DIHMECStore.deleteProduct(\'' + escapeHtml(code) + '\')">Excluir</button>' +
        '</div></td>';
      tbody.appendChild(row);
      form.reset();
      alert('Produto cadastrado com sucesso!');
    });
  }

  // ---------- Form: Checklist ----------
  function attachChecklistForm() {
    const form = document.getElementById('checklist-form');
    if (!form) return;
    // Define data padrão como hoje
    const dateInput = document.getElementById('check-date');
    if (dateInput && !dateInput.value) {
      const t = new Date();
      dateInput.value = t.getFullYear() + '-' +
        String(t.getMonth() + 1).padStart(2, '0') + '-' +
        String(t.getDate()).padStart(2, '0');
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const plate = (document.getElementById('check-plate').value || '').trim().toUpperCase();
      const km    = document.getElementById('check-km').value;
      const date  = document.getElementById('check-date').value;
      const notes = (document.getElementById('check-notes').value || '').trim();
      const items = Array.from(form.querySelectorAll('input[name="checkItem"]:checked'))
        .map((c) => c.value);

      if (!plate || !date) {
        alert('Preencha placa e data.');
        return;
      }

      const tbody = document.getElementById('checklist-table-body');
      if (!tbody) return;

      const dateBR = date.split('-').reverse().join('/');
      const labels = {
        oleo: 'Óleo', freios: 'Freios', pneus: 'Pneus', suspensao: 'Suspensão',
        bateria: 'Bateria', luzes: 'Luzes', agua: 'Água', filtros: 'Filtros',
      };
      const itemsStr = items.length
        ? items.map((i) => labels[i] || i).join(', ')
        : '—';

      const row = document.createElement('tr');
      row.innerHTML =
        '<td>' + escapeHtml(dateBR) + '</td>' +
        '<td>' + escapeHtml(plate) + '</td>' +
        '<td>' + escapeHtml(km) + '</td>' +
        '<td>' + escapeHtml(itemsStr) + '</td>' +
        '<td>' + escapeHtml(notes || '-') + '</td>' +
        '<td><div class="action-buttons">' +
          '<button class="btn-action btn-delete" type="button" onclick="DIHMECStore.deleteChecklist(this)">Excluir</button>' +
        '</div></td>';
      tbody.appendChild(row);
      form.reset();
      // Restaura data padrão depois do reset
      if (dateInput) {
        const t = new Date();
        dateInput.value = t.getFullYear() + '-' +
          String(t.getMonth() + 1).padStart(2, '0') + '-' +
          String(t.getDate()).padStart(2, '0');
      }
      alert('Checklist salvo com sucesso!');
    });
  }

  // ---------- Título do menu Checklist ----------
  // O `formConfig` original do app não tem entrada para 'checklist'.
  // Atualizamos o cabeçalho manualmente quando o usuário entra nesse menu.
  function patchChecklistTitle() {
    document.querySelectorAll('.menu-item[data-form="checklist"]').forEach((a) => {
      a.addEventListener('click', () => {
        setTimeout(() => {
          const t  = document.getElementById('page-title');
          const s  = document.getElementById('page-subtitle');
          const st = document.getElementById('section-title');
          const sd = document.getElementById('section-description');
          if (t)  t.textContent  = 'Checklist do Carro';
          if (s)  s.textContent  = 'Formulário';
          if (st) st.textContent = 'Verificação do Veículo';
          if (sd) sd.textContent = 'Preencha o checklist do veículo após a inspeção.';
        }, 0);
      });
    });
  }

  // ---------- API pública (usada pelos onclick inline) ----------
  window.DIHMECStore = {
    deleteProduct(code) {
      if (!confirm('Excluir o produto ' + code + '?')) return;
      const tbody = document.getElementById('products-table-body');
      const row = findRowByCell(tbody, 0, code);
      if (row) row.remove();
    },
    editProduct(code) {
      const tbody = document.getElementById('products-table-body');
      const row = findRowByCell(tbody, 0, code);
      if (!row) return;
      const cells = row.children;
      const newQty = prompt('Nova quantidade:', cells[3].textContent.trim());
      if (newQty === null) return;
      const newPriceRaw = prompt(
        'Novo preço unitário (use ponto, ex.: 49.90):',
        cells[5].textContent.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')
      );
      if (newPriceRaw === null) return;
      const qty = Math.max(0, parseInt(newQty, 10) || 0);
      const price = Math.max(0, parseFloat(newPriceRaw) || 0);
      const total = qty * price;
      cells[3].textContent = qty;
      cells[5].textContent = fmtBRL(price);
      cells[6].textContent = fmtBRL(total);
      cells[7].textContent = qty === 0
        ? 'Esgotado'
        : (qty < 5 ? 'Baixo Estoque' : 'Disponível');
    },
    deleteChecklist(btn) {
      if (!confirm('Excluir este checklist?')) return;
      const row = btn.closest('tr');
      if (row) row.remove();
    },
    // Limpa TODOS os dados (utilitário — pode ser chamado pelo console).
    clearAll() {
      if (!confirm('Apagar TODOS os dados cadastrados? Esta ação é irreversível.')) return;
      Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
      window.location.reload();
    },
  };

  // Restaura imediatamente (antes do DOMContentLoaded de outros scripts) e
  // novamente em DOMContentLoaded para garantir que o conteúdo persistido
  // não seja sobrescrito por scripts que rodem depois.
  function init() {
    restoreAll();
    watchAll();
    attachProductForm();
    attachChecklistForm();
    patchChecklistTitle();
    recomputeTotals();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
