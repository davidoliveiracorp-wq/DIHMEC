(function () {
  'use strict';

  // Aba "Controle de Ponto".
  //   * Todo usuario com acesso a aba marca o PROPRIO ponto (entrada,
  //     saida/retorno do almoco, saida). O horario vem do servidor.
  //   * Gestores (super admin ou permissao 'ponto-gestao') tambem veem o
  //     cadastro de funcionarios, o relatorio por periodo e o ajuste
  //     manual de registros.
  //   * Funcionarios (role 'funcionario') so enxergam esta aba — ver
  //     hasPermission() em auth.js.

  const TZ = 'America/Sao_Paulo';
  const STEPS = [
    { id: 'entrada', label: 'Entrada', icon: '🟢' },
    { id: 'almoco_saida', label: 'Saída almoço', icon: '🍽️' },
    { id: 'almoco_retorno', label: 'Retorno almoço', icon: '↩️' },
    { id: 'saida', label: 'Saída', icon: '🔴' },
  ];

  const MANUAL_MAX_DIAS = 7; // mesmo limite de api/ponto.js

  // Selo de marcacao manual: quais campos e se ja foi aprovada.
  function manualBadge(r) {
    if (!r.manual_campos) return '';
    const campos = r.manual_campos.split(',').map((c) => (STEPS.find((s) => s.id === c) || {}).label || c).join(', ');
    const ok = !!r.manual_aprovado_por;
    const title = `Manual: ${campos}` + (r.manual_motivo ? ` — ${r.manual_motivo}` : '') +
      (ok ? ` (aprovado por ${r.manual_aprovado_por})` : '');
    return ` <span class="ponto-manual ${ok ? 'ok' : 'pend'}" title="${esc(title)}">${ok ? 'manual ✔' : 'manual – pendente'}</span>`;
  }

  const STYLE = `
    .ponto-wrap { display: flex; flex-direction: column; gap: 20px; margin-top: 8px; }
    .ponto-clock-card { text-align: center; }
    .ponto-hello { font-size: 1rem; color: var(--text-secondary); margin-bottom: 4px; }
    .ponto-clock { font-size: 3rem; font-weight: 700; letter-spacing: 2px; font-variant-numeric: tabular-nums; color: var(--text-primary); line-height: 1.1; }
    .ponto-date { color: var(--text-secondary); margin: 4px 0 18px; }
    .ponto-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .ponto-step { border: 1px solid var(--border); border-radius: var(--radius-md); padding: 14px 8px; background: var(--bg-page); display: flex; flex-direction: column; gap: 8px; align-items: center; }
    .ponto-step.done { border-color: #1e7e34; background: rgba(30,126,52,0.08); }
    .ponto-step.next { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .ponto-step-label { font-size: 0.8125rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.03em; }
    .ponto-step-time { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-primary); }
    .ponto-step button { width: 100%; padding: 10px 6px; border: none; border-radius: var(--radius-sm); font-weight: 600; font-size: 0.875rem; cursor: pointer; background: var(--accent); color: #fff; transition: background var(--transition); }
    .ponto-step button:hover:not(:disabled) { background: var(--accent-hover); }
    .ponto-step button:disabled { background: #ced4da; color: #6c757d; cursor: not-allowed; }
    .ponto-msg { margin-top: 14px; font-size: 0.9375rem; min-height: 1.4em; }
    .ponto-msg.ok { color: #1e7e34; }
    .ponto-msg.error { color: #b3261e; }
    .ponto-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0 14px; align-items: end; }
    .ponto-grid .form-group { margin-bottom: 10px; }
    .ponto-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
    .ponto-actions .btn-action { padding: 10px 18px; }
    .btn-ponto-sec { background: #6c757d; color: #fff; }
    .btn-ponto-ok { background: #1e7e34; color: #fff; }
    .ponto-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .ponto-badge.on { background: rgba(30,126,52,0.12); color: #1e7e34; }
    .ponto-badge.off { background: rgba(108,117,125,0.15); color: #6c757d; }
    .ponto-table-wrap { overflow-x: auto; }
    .ponto-table-wrap .customers-table td, .ponto-table-wrap .customers-table th { white-space: nowrap; }
    .ponto-adj { color: #b26a00; font-size: 0.75rem; }
    .ponto-manual { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 600; }
    .ponto-manual.pend { background: rgba(178,106,0,0.14); color: #b26a00; }
    .ponto-manual.ok { background: rgba(30,126,52,0.12); color: #1e7e34; }
    .ponto-manual-toggle { margin-top: 16px; background: none; border: none; color: var(--accent); font-weight: 600; cursor: pointer; font-size: 0.875rem; text-decoration: underline; }
    .ponto-manual-form { margin-top: 12px; text-align: left; border-top: 1px dashed var(--border); padding-top: 14px; }
    .ponto-manual-form[hidden] { display: none; }
    .ponto-manual-form p { font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 10px; }
    .ponto-section-title { margin: 8px 0 -6px; font-size: 1.25rem; font-weight: 700; color: var(--text-primary); }
    .ponto-form-msg { font-size: 0.875rem; margin-top: 6px; min-height: 1.2em; }
    .ponto-form-msg.ok { color: #1e7e34; }
    .ponto-form-msg.error { color: #b3261e; }
    .ponto-saldo-pos { color: #1e7e34; font-weight: 600; }
    .ponto-saldo-neg { color: #b3261e; font-weight: 600; }
    .ponto-subtitle { grid-column: 1 / -1; font-size: 0.8125rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; margin: 6px 0 4px; }
    .ponto-check { display: flex; align-items: center; gap: 8px; font-weight: 500; cursor: pointer; }
    .ponto-modal-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(15,17,22,0.55); display: flex; align-items: center; justify-content: center; padding: 12px; }
    .ponto-modal { background: var(--bg-card); color: var(--text-primary); width: 100%; max-width: 720px; max-height: calc(100dvh - 24px); border-radius: var(--radius-lg); box-shadow: 0 24px 64px rgba(0,0,0,0.3); display: flex; flex-direction: column; overflow: hidden; text-align: left; }
    .ponto-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
    .ponto-modal-head h3 { font-size: 1.0625rem; margin: 0; }
    .ponto-modal-close { background: none; border: none; font-size: 26px; line-height: 1; cursor: pointer; color: var(--text-secondary); }
    .ponto-modal-body { padding: 16px 20px; overflow-y: auto; }
    .ponto-modal-foot { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; padding: 12px 20px; border-top: 1px solid var(--border); }
    .ponto-modal-foot .btn-action { padding: 10px 18px; }
    .ponto-modal-foot .spacer { flex: 1; }
    body.dark-mode .ponto-modal { background: #2d2d2d; color: #E0E0E0; }
    body.dark-mode .ponto-modal-head, body.dark-mode .ponto-modal-foot { border-color: #444; }
    body.dark-mode .ponto-modal .form-group input, body.dark-mode .ponto-modal .form-group select { background: #1f1f1f; color: #E0E0E0; border-color: #555; }
    body.dark-mode .ponto-step { background: #2d2d2d; border-color: #555; }
    body.dark-mode .ponto-step.done { background: rgba(30,126,52,0.18); border-color: #2f9e4a; }
    body.dark-mode .ponto-step.next { border-color: #c41e1e; }
    body.dark-mode .ponto-clock, body.dark-mode .ponto-step-time, body.dark-mode .ponto-section-title { color: #E0E0E0; }
    body.dark-mode .ponto-hello, body.dark-mode .ponto-date, body.dark-mode .ponto-step-label { color: #bdbdbd; }
    @media (max-width: 640px) {
      .ponto-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ponto-clock { font-size: 2.25rem; }
    }
    /* Login de funcionario no celular: tem uma aba so, entao dispensa o
       menu gaveta e o banner (layout geral em index.html "Responsivo"). */
    @media (max-width: 900px) {
      body.ponto-only .sidebar, body.ponto-only .mobile-menu-btn,
      body.ponto-only #dihmec-banner { display: none; }
      body.ponto-only .main-content { padding-top: 56px; }
    }
  `;

  const state = {
    rendered: false,
    session: null,
    manager: false,
    today: null,
    funcionarios: [],
    report: [],
    clockTimer: null,
  };

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  function api(path, opts) { return window.DIHMECAuth.apiFetch(path, opts); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function ymd(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function fmtDate(dateStr) {
    const [y, m, d] = dateStr.split('-');
    const wd = new Date(dateStr + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' });
    return `${d}/${m}/${y} <small style="color:#6c757d">${esc(wd.replace('.', ''))}</small>`;
  }
  function toMin(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }
  // Minutos trabalhados no dia (null se o dia ainda nao foi fechado).
  function workedMinutes(r) {
    const e = toMin(r.entrada), as = toMin(r.almoco_saida), ar = toMin(r.almoco_retorno), s = toMin(r.saida);
    if (e == null || s == null) return null;
    if (as != null && ar != null) return Math.max(0, as - e) + Math.max(0, s - ar);
    return Math.max(0, s - e);
  }
  function fmtMin(min) {
    if (min == null) return '—';
    return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  }
  // Saldo com sinal: +0h30 / -1h05
  function fmtSaldo(min) {
    if (min == null) return '—';
    const sign = min < 0 ? '-' : '+';
    const a = Math.abs(min);
    return `${sign}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
  }
  function saldoHTML(min) {
    if (min == null) return '—';
    return `<span class="${min < 0 ? 'ponto-saldo-neg' : 'ponto-saldo-pos'}">${fmtSaldo(min)}</span>`;
  }
  function funcOf(email) { return state.funcionarios.find((x) => x.email === email) || null; }
  // Minutos previstos pela jornada do funcionario (mesma conta das batidas).
  function expectedMinutes(email) {
    const f = funcOf(email);
    return f && f.jornada ? workedMinutes(f.jornada) : null;
  }
  function jornadaText(j) {
    if (!j || !j.entrada) return '—';
    return j.almoco_saida
      ? `${j.entrada}–${j.almoco_saida} / ${j.almoco_retorno}–${j.saida}`
      : `${j.entrada}–${j.saida}`;
  }
  function fmtCPF(cpf) {
    const d = String(cpf || '').replace(/\D/g, '');
    return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
  }

  // Campos de cadastro do funcionario — usados no form de cadastro e na
  // janela de edicao. `p` eh o prefixo dos ids.
  function funcFieldsHTML(p, f) {
    f = f || {};
    const j = f.jornada || {};
    const v = (x) => esc(x || '');
    return `
      <div class="ponto-subtitle">Dados cadastrais</div>
      <div class="form-group"><label for="${p}-name">Nome completo *</label>
        <input type="text" id="${p}-name" required value="${v(f.name)}" placeholder="Ex.: João da Silva" /></div>
      <div class="form-group"><label for="${p}-login">Login (usuário ou e-mail) *</label>
        <input type="text" id="${p}-login" required value="${v(f.email)}" placeholder="Ex.: joao.silva" autocapitalize="none" spellcheck="false" /></div>
      <div class="form-group"><label for="${p}-cargo">Cargo</label>
        <input type="text" id="${p}-cargo" value="${v(f.cargo)}" placeholder="Ex.: Mecânico" /></div>
      <div class="form-group"><label for="${p}-cpf">CPF</label>
        <input type="text" id="${p}-cpf" inputmode="numeric" value="${v(fmtCPF(f.cpf))}" placeholder="000.000.000-00" /></div>
      <div class="form-group"><label for="${p}-telefone">Telefone</label>
        <input type="tel" id="${p}-telefone" value="${v(f.telefone)}" placeholder="(11) 99999-0000" /></div>
      <div class="form-group"><label for="${p}-matricula">Matrícula</label>
        <input type="text" id="${p}-matricula" value="${v(f.matricula)}" /></div>
      <div class="form-group"><label for="${p}-admissao">Data de admissão</label>
        <input type="date" id="${p}-admissao" value="${v(f.admissao)}" /></div>
      <div class="ponto-subtitle">Jornada (horário previsto)</div>
      ${STEPS.map((s) => `
      <div class="form-group"><label for="${p}-j-${s.id}">${s.label}</label>
        <input type="time" id="${p}-j-${s.id}" value="${v(j[s.id])}" /></div>`).join('')}
    `;
  }
  function readFuncFields(p) {
    const val = (id) => { const e = document.getElementById(`${p}-${id}`); return e ? e.value.trim() : ''; };
    const jornada = {};
    STEPS.forEach((s) => { jornada[s.id] = val('j-' + s.id); });
    return {
      name: val('name'),
      login: val('login').toLowerCase(),
      cargo: val('cargo'),
      cpf: val('cpf'),
      telefone: val('telefone'),
      matricula: val('matricula'),
      admissao: val('admissao'),
      jornada,
    };
  }
  // Valida senha + confirmacao; retorna o hash (ou undefined se vazia).
  async function passwordHashFrom(pass, pass2, required) {
    if (!pass && !pass2) {
      if (required) throw new Error('Informe a senha do funcionário.');
      return undefined;
    }
    if (pass !== pass2) throw new Error('A confirmação não confere com a senha.');
    window.DIHMECAuth.validatePasswordComplexity(pass);
    return window.DIHMECAuth.hashPassword(pass);
  }

  // Janela modal simples. `onSave` recebe (overlay, close) e pode lancar
  // Error para exibir a mensagem.
  function openModal({ title, body, saveLabel, onSave, extraButtons }) {
    const ov = document.createElement('div');
    ov.className = 'ponto-modal-overlay';
    ov.innerHTML = `
      <form class="ponto-modal" role="dialog" aria-modal="true" autocomplete="off">
        <div class="ponto-modal-head"><h3>${esc(title)}</h3>
          <button type="button" class="ponto-modal-close" aria-label="Fechar">×</button></div>
        <div class="ponto-modal-body">${body}<div class="ponto-form-msg" data-modal-msg></div></div>
        <div class="ponto-modal-foot">
          ${extraButtons || ''}<span class="spacer"></span>
          <button type="button" class="btn-action btn-ponto-sec" data-modal-cancel>Cancelar</button>
          <button type="submit" class="btn-action btn-edit">${esc(saveLabel || 'Salvar')}</button>
        </div>
      </form>`;
    document.body.appendChild(ov);
    const form = ov.querySelector('form');
    const msg = ov.querySelector('[data-modal-msg]');
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    document.addEventListener('keydown', onKey);
    ov.querySelector('.ponto-modal-close').addEventListener('click', close);
    ov.querySelector('[data-modal-cancel]').addEventListener('click', close);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setMsg(msg, '', null);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try { await onSave(ov, close); }
      catch (err) { setMsg(msg, err.message || 'Erro ao salvar.', 'error'); }
      finally { btn.disabled = false; }
    });
    const first = ov.querySelector('input:not([type=hidden]), select');
    if (first) first.focus();
    return { ov, msg, close };
  }

  function nameOf(email) {
    const f = state.funcionarios.find((x) => x.email === email);
    if (f) return f.name;
    try {
      const u = window.DIHMECAuth.listUsers().find((x) => String(x.email).toLowerCase() === email);
      if (u) return u.name;
    } catch (e) {}
    return email;
  }
  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = el.className.replace(/\s*(ok|error)\b/g, '') + (kind ? ' ' + kind : '');
  }
  function nextStep(rec) {
    const r = rec || {};
    if (r.saida) return null;
    if (!r.entrada) return 'entrada';
    if (r.almoco_saida && !r.almoco_retorno) return 'almoco_retorno';
    if (!r.almoco_saida) return 'almoco_saida'; // 'saida' tambem fica liberada (sem almoco)
    return 'saida';
  }
  // Mesmas regras do servidor (api/ponto.js#validateNext).
  function canMark(rec, tipo) {
    const r = rec || {};
    if (r.saida) return false;
    if (tipo === 'entrada') return !r.entrada;
    if (!r.entrada) return false;
    if (tipo === 'almoco_saida') return !r.almoco_saida;
    if (tipo === 'almoco_retorno') return !!r.almoco_saida && !r.almoco_retorno;
    if (tipo === 'saida') return !r.almoco_saida || !!r.almoco_retorno;
    return false;
  }

  // ---------- render ----------
  function injectStyle() {
    if (document.getElementById('ponto-style')) return;
    const s = document.createElement('style');
    s.id = 'ponto-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function render() {
    const root = document.getElementById('form-controle-ponto');
    if (!root) return;
    const session = state.session;
    const histFrom = addDays(ymd(new Date()), -30);
    const today = ymd(new Date());

    root.innerHTML = `
      <div class="ponto-wrap">
        <div class="form-section ponto-clock-card">
          <div class="ponto-hello">Olá, <strong>${esc(session.name)}</strong></div>
          <div class="ponto-clock" id="ponto-clock">--:--:--</div>
          <div class="ponto-date" id="ponto-date"></div>
          <div class="ponto-steps" id="ponto-steps"></div>
          <div class="ponto-msg" id="ponto-msg"></div>
          <button type="button" class="ponto-manual-toggle" id="pm-toggle">Esqueceu de marcar? Lançar marcação manual</button>
          <form class="ponto-manual-form" id="pm-form" autocomplete="off" hidden>
            <p>Use apenas se esqueceu de bater o ponto. A marcação fica <strong>pendente de aprovação</strong> do gestor. Permitido até ${MANUAL_MAX_DIAS} dias atrás.</p>
            <div class="ponto-grid">
              <div class="form-group">
                <label for="pm-dia">Data</label>
                <input type="date" id="pm-dia" required value="${today}" min="${addDays(today, -MANUAL_MAX_DIAS)}" max="${today}" />
              </div>
              <div class="form-group">
                <label for="pm-tipo">Marcação</label>
                <select id="pm-tipo" required>
                  ${STEPS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label for="pm-hora">Horário</label>
                <input type="time" id="pm-hora" required />
              </div>
              <div class="form-group" style="grid-column: 1 / -1">
                <label for="pm-motivo">Motivo (obrigatório)</label>
                <input type="text" id="pm-motivo" maxlength="300" required placeholder="Ex.: esqueci de marcar a entrada" />
              </div>
            </div>
            <div class="ponto-actions">
              <button type="submit" class="btn-action btn-edit">Enviar marcação manual</button>
              <button type="button" class="btn-action btn-ponto-sec" id="pm-cancel">Cancelar</button>
            </div>
            <div class="ponto-form-msg" id="pm-msg"></div>
          </form>
        </div>

        <div class="customers-list" style="margin-top:0">
          <div class="customers-list-header">Meu histórico (últimos 30 dias)</div>
          <div class="ponto-table-wrap">
            <table class="customers-table">
              <thead><tr>
                <th>Data</th><th>Entrada</th><th>Saída almoço</th><th>Retorno almoço</th><th>Saída</th><th>Horas</th>
              </tr></thead>
              <tbody id="ponto-hist-body"><tr><td colspan="6" class="empty-state">Carregando...</td></tr></tbody>
            </table>
          </div>
        </div>

        ${state.manager ? `
        <div class="ponto-section-title">Gestão de Ponto</div>

        <div class="form-section">
          <h2>Cadastrar funcionário</h2>
          <form id="ponto-func-form" autocomplete="off">
            <div class="ponto-grid">
              ${funcFieldsHTML('pf', {})}
              <div class="ponto-subtitle">Acesso</div>
              <div class="form-group">
                <label for="pf-pass">Senha * <small>(mín. 8, maiúsc., número e especial)</small></label>
                <input type="password" id="pf-pass" autocomplete="new-password" />
              </div>
              <div class="form-group">
                <label for="pf-pass2">Confirmar senha *</label>
                <input type="password" id="pf-pass2" autocomplete="new-password" />
              </div>
            </div>
            <div class="ponto-actions">
              <button type="submit" class="btn-action btn-edit" id="pf-submit">Cadastrar</button>
            </div>
            <div class="ponto-form-msg" id="pf-msg"></div>
          </form>
        </div>

        <div class="customers-list" style="margin-top:0">
          <div class="customers-list-header">Funcionários cadastrados</div>
          <div class="ponto-table-wrap">
            <table class="customers-table">
              <thead><tr><th>Nome</th><th>Login</th><th>Cargo</th><th>Jornada</th><th>Telefone</th><th>Status</th><th>Ações</th></tr></thead>
              <tbody id="ponto-func-body"><tr><td colspan="7" class="empty-state">Carregando...</td></tr></tbody>
            </table>
          </div>
        </div>

        <div class="form-section">
          <h2>Relatório de ponto</h2>
          <div class="ponto-grid">
            <div class="form-group">
              <label for="pr-func">Funcionário</label>
              <select id="pr-func"><option value="">Todos</option></select>
            </div>
            <div class="form-group">
              <label for="pr-from">De</label>
              <input type="date" id="pr-from" value="${today.slice(0, 8)}01" />
            </div>
            <div class="form-group">
              <label for="pr-to">Até</label>
              <input type="date" id="pr-to" value="${today}" />
            </div>
          </div>
          <div class="ponto-actions">
            <button type="button" class="btn-action btn-edit" id="pr-run">Gerar relatório</button>
            <button type="button" class="btn-action btn-ponto-ok" id="pr-csv">Exportar CSV (Excel)</button>
          </div>
        </div>

        <div class="customers-list" style="margin-top:0">
          <div class="customers-list-header" id="pr-title">Registros do período</div>
          <div class="ponto-table-wrap">
            <table class="customers-table">
              <thead><tr>
                <th>Funcionário</th><th>Data</th><th>Entrada</th><th>Saída almoço</th><th>Retorno almoço</th><th>Saída</th><th>Horas</th><th>Saldo</th><th>Obs.</th><th>Ações</th>
              </tr></thead>
              <tbody id="pr-body"><tr><td colspan="10" class="empty-state">Clique em "Gerar relatório".</td></tr></tbody>
              <tfoot><tr>
                <td colspan="6" style="text-align:right;font-weight:600">Totais:</td>
                <td id="pr-total" style="font-weight:700">—</td><td id="pr-saldo" style="font-weight:700">—</td><td colspan="2"></td>
              </tr></tfoot>
            </table>
          </div>
        </div>

        <div class="form-section" id="ponto-adj-section">
          <h2>Lançar registro de um dia</h2>
          <p style="font-size:0.8125rem;color:var(--text-secondary);margin:-8px 0 12px">Para dias sem nenhuma marcação. Para corrigir um dia que já aparece no relatório, use o botão <strong>Ajustar</strong> da linha.</p>
          <form id="ponto-adj-form" autocomplete="off">
            <div class="ponto-grid">
              <div class="form-group">
                <label for="pa-func">Funcionário</label>
                <select id="pa-func" required></select>
              </div>
              <div class="form-group">
                <label for="pa-dia">Data</label>
                <input type="date" id="pa-dia" required value="${today}" />
              </div>
              ${STEPS.map((s) => `
              <div class="form-group">
                <label for="pa-${s.id}">${s.label}</label>
                <input type="time" id="pa-${s.id}" />
              </div>`).join('')}
              <div class="form-group" style="grid-column: 1 / -1">
                <label for="pa-obs">Observação / motivo do ajuste</label>
                <input type="text" id="pa-obs" maxlength="500" placeholder="Ex.: esqueceu de marcar a saída" />
              </div>
            </div>
            <div class="ponto-actions">
              <button type="submit" class="btn-action btn-edit">Salvar registro</button>
            </div>
            <div class="ponto-form-msg" id="pa-msg"></div>
          </form>
        </div>
        ` : ''}
      </div>
    `;

    wire(root, histFrom);
    startClock();
    state.rendered = true;
  }

  function startClock() {
    if (state.clockTimer) clearInterval(state.clockTimer);
    const tick = () => {
      const c = document.getElementById('ponto-clock');
      if (!c) { clearInterval(state.clockTimer); state.clockTimer = null; return; }
      const now = new Date();
      c.textContent = now.toLocaleTimeString('pt-BR', { timeZone: TZ });
      const d = document.getElementById('ponto-date');
      if (d) {
        const txt = now.toLocaleDateString('pt-BR', {
          timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
        d.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
      }
    };
    tick();
    state.clockTimer = setInterval(tick, 1000);
  }

  function renderSteps() {
    const box = document.getElementById('ponto-steps');
    if (!box) return;
    const rec = state.today || {};
    const next = nextStep(rec);
    box.innerHTML = STEPS.map((s) => {
      const t = rec[s.id];
      const cls = 'ponto-step' + (t ? ' done' : '') + (s.id === next ? ' next' : '');
      return `
        <div class="${cls}">
          <span class="ponto-step-label">${s.icon} ${s.label}</span>
          <span class="ponto-step-time">${t ? esc(t) : '--:--'}</span>
          <button type="button" data-mark="${s.id}" ${canMark(rec, s.id) ? '' : 'disabled'}>
            ${t ? 'Registrado' : 'Marcar'}
          </button>
        </div>`;
    }).join('');
  }

  function renderHistory(records) {
    const body = document.getElementById('ponto-hist-body');
    if (!body) return;
    if (!records.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma marcação nos últimos 30 dias.</td></tr>';
      return;
    }
    body.innerHTML = records.slice().reverse().map((r) => `
      <tr>
        <td>${fmtDate(r.dia)}</td>
        ${STEPS.map((s) => `<td>${esc(r[s.id] || '—')}</td>`).join('')}
        <td><strong>${fmtMin(workedMinutes(r))}</strong>${r.ajustado_por ? ' <span class="ponto-adj" title="Ajustado pelo gestor">(ajustado)</span>' : ''}${manualBadge(r)}</td>
      </tr>`).join('');
  }

  function renderFuncionarios() {
    const body = document.getElementById('ponto-func-body');
    if (!body) return;
    const list = state.funcionarios;
    body.innerHTML = list.length ? list.map((f) => `
      <tr>
        <td>${esc(f.name)}</td>
        <td>${esc(f.email)}</td>
        <td>${esc(f.cargo || '—')}</td>
        <td>${esc(jornadaText(f.jornada))}</td>
        <td>${esc(f.telefone || '—')}</td>
        <td><span class="ponto-badge ${f.ativo ? 'on' : 'off'}">${f.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td><div class="action-buttons">
          <button type="button" class="btn-action btn-edit" data-func-edit="${esc(f.email)}">Editar</button>
          <button type="button" class="btn-action btn-ponto-sec" data-func-toggle="${esc(f.email)}">${f.ativo ? 'Desativar' : 'Ativar'}</button>
          <button type="button" class="btn-action btn-delete" data-func-del="${esc(f.email)}">Excluir</button>
        </div></td>
      </tr>`).join('')
      : '<tr><td colspan="7" class="empty-state">Nenhum funcionário cadastrado.</td></tr>';

    // Selects do relatorio e do ajuste: funcionarios + demais usuarios
    // que tenham marcado ponto (ex.: admin que tambem bate ponto).
    const opts = list.map((f) => `<option value="${esc(f.email)}">${esc(f.name)}${f.ativo ? '' : ' (inativo)'}</option>`).join('');
    const prFunc = document.getElementById('pr-func');
    if (prFunc) { const v = prFunc.value; prFunc.innerHTML = '<option value="">Todos</option>' + opts; prFunc.value = v; }
    const paFunc = document.getElementById('pa-func');
    if (paFunc) {
      const v = paFunc.value;
      const self = state.session;
      const selfOpt = list.some((f) => f.email === self.email) ? ''
        : `<option value="${esc(self.email)}">${esc(self.name)} (você)</option>`;
      paFunc.innerHTML = opts + selfOpt;
      if (v) paFunc.value = v;
    }
  }

  function renderReport() {
    const body = document.getElementById('pr-body');
    if (!body) return;
    const rows = state.report;
    let total = 0;
    let saldoTotal = 0;
    let temSaldo = false;
    body.innerHTML = rows.length ? rows.map((r) => {
      const w = workedMinutes(r);
      if (w != null) total += w;
      const prev = expectedMinutes(r.email);
      const saldo = w != null && prev != null ? w - prev : null;
      if (saldo != null) { saldoTotal += saldo; temSaldo = true; }
      return `
        <tr>
          <td>${esc(nameOf(r.email))}</td>
          <td>${fmtDate(r.dia)}</td>
          ${STEPS.map((s) => `<td>${esc(r[s.id] || '—')}</td>`).join('')}
          <td><strong>${fmtMin(w)}</strong></td>
          <td title="${prev != null ? 'Previsto: ' + fmtMin(prev) : 'Sem jornada cadastrada'}">${saldoHTML(saldo)}</td>
          <td>${esc(r.obs || r.manual_motivo || '')}${r.ajustado_por ? ` <span class="ponto-adj" title="Ajustado por ${esc(r.ajustado_por)}">(ajustado)</span>` : ''}${manualBadge(r)}</td>
          <td><div class="action-buttons">
            <button type="button" class="btn-action btn-edit" data-adj="${esc(r.email)}|${esc(r.dia)}">Ajustar</button>
            ${r.manual_campos && !r.manual_aprovado_por ? `<button type="button" class="btn-action btn-ponto-ok" data-aprovar="${esc(r.email)}|${esc(r.dia)}">Aprovar</button>` : ''}
            <button type="button" class="btn-action btn-delete" data-adj-del="${esc(r.email)}|${esc(r.dia)}">Excluir</button>
          </div></td>
        </tr>`;
    }).join('')
      : '<tr><td colspan="10" class="empty-state">Nenhum registro no período.</td></tr>';
    const t = document.getElementById('pr-total');
    if (t) t.textContent = fmtMin(total);
    const s = document.getElementById('pr-saldo');
    if (s) s.innerHTML = temSaldo ? saldoHTML(saldoTotal) : '—';
  }

  // ---------- data ----------
  async function loadToday() {
    try {
      const data = await api('/api/ponto?scope=hoje');
      state.today = data.record;
    } catch (e) {
      setMsg(document.getElementById('ponto-msg'), e.message, 'error');
    }
    renderSteps();
  }

  async function loadHistory(from) {
    try {
      const to = ymd(new Date());
      const email = encodeURIComponent(state.session.email);
      const data = await api(`/api/ponto?from=${from}&to=${to}&email=${email}`);
      renderHistory(data.records || []);
    } catch (e) {
      const body = document.getElementById('ponto-hist-body');
      if (body) body.innerHTML = `<tr><td colspan="6" class="empty-state">${esc(e.message)}</td></tr>`;
    }
  }

  async function loadFuncionarios() {
    if (!state.manager) return;
    try {
      const data = await api('/api/funcionarios');
      state.funcionarios = data.funcionarios || [];
    } catch (e) {
      state.funcionarios = [];
    }
    renderFuncionarios();
  }

  async function loadReport() {
    const from = $('#pr-from').value;
    const to = $('#pr-to').value;
    const email = $('#pr-func').value;
    if (!from || !to) return;
    const body = document.getElementById('pr-body');
    if (body) body.innerHTML = '<tr><td colspan="10" class="empty-state">Carregando...</td></tr>';
    try {
      const data = await api(`/api/ponto?from=${from}&to=${to}&email=${encodeURIComponent(email)}`);
      state.report = data.records || [];
      const [fy, fm, fd] = from.split('-');
      const [ty, tm, td] = to.split('-');
      $('#pr-title').textContent = `Registros de ${fd}/${fm}/${fy} a ${td}/${tm}/${ty}` +
        (email ? ' — ' + nameOf(email) : '');
    } catch (e) {
      state.report = [];
      if (body) body.innerHTML = `<tr><td colspan="10" class="empty-state">${esc(e.message)}</td></tr>`;
      return;
    }
    renderReport();
  }

  function exportCSV() {
    if (!state.report.length) { alert('Gere o relatório antes de exportar.'); return; }
    const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['Funcionário', 'Login', 'Data', 'Entrada', 'Saída almoço', 'Retorno almoço', 'Saída', 'Horas', 'Previsto', 'Saldo', 'Observação', 'Ajustado por', 'Marcação manual', 'Motivo manual', 'Aprovado por'];
    let total = 0;
    let saldoTotal = 0;
    const lines = state.report.map((r) => {
      const w = workedMinutes(r);
      if (w != null) total += w;
      const prev = expectedMinutes(r.email);
      const saldo = w != null && prev != null ? w - prev : null;
      if (saldo != null) saldoTotal += saldo;
      const [y, m, d] = r.dia.split('-');
      return [nameOf(r.email), r.email, `${d}/${m}/${y}`, r.entrada, r.almoco_saida, r.almoco_retorno, r.saida,
        w == null ? '' : fmtMin(w), prev == null ? '' : fmtMin(prev), saldo == null ? '' : fmtSaldo(saldo),
        r.obs, r.ajustado_por,
        (r.manual_campos || '').split(',').filter(Boolean).map((c) => (STEPS.find((s) => s.id === c) || {}).label || c).join(', '),
        r.manual_motivo, r.manual_aprovado_por].map(cell).join(';');
    });
    lines.push(['', '', '', '', '', '', 'Total', fmtMin(total), '', fmtSaldo(saldoTotal), '', '', '', '', ''].map(cell).join(';'));
    const csv = '﻿' + head.map(cell).join(';') + '\r\n' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ponto_${$('#pr-from').value}_a_${$('#pr-to').value}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- janelas de edicao (gestor) ----------
  // Editar todos os dados do funcionario: cadastro, jornada, login,
  // status e senha.
  function openEditFuncionario(f, histFrom) {
    openModal({
      title: 'Editar funcionário — ' + f.name,
      saveLabel: 'Salvar alterações',
      body: `
        <div class="ponto-grid">
          ${funcFieldsHTML('pe', f)}
          <div class="ponto-subtitle">Acesso</div>
          <div class="form-group">
            <label for="pe-pass">Nova senha <small>(em branco = manter)</small></label>
            <input type="password" id="pe-pass" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label for="pe-pass2">Confirmar nova senha</label>
            <input type="password" id="pe-pass2" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label class="ponto-check"><input type="checkbox" id="pe-ativo" ${f.ativo ? 'checked' : ''} /> Acesso ativo</label>
          </div>
        </div>`,
      onSave: async (ov, close) => {
        const data = readFuncFields('pe');
        if (!data.name || !data.login) throw new Error('Informe nome e login.');
        const body = Object.assign({}, data, {
          email: f.email,
          newLogin: data.login,
          ativo: ov.querySelector('#pe-ativo').checked,
          passwordHash: await passwordHashFrom(ov.querySelector('#pe-pass').value, ov.querySelector('#pe-pass2').value, false),
        });
        delete body.login;
        if (body.newLogin !== f.email && !confirm(`Trocar o login de "${f.email}" para "${body.newLogin}"? O funcionário passa a entrar com o novo login e o histórico de ponto é mantido.`)) return;
        if (f.ativo && !body.ativo && !confirm(`Desativar o acesso de ${f.name}?`)) return;
        await api('/api/funcionarios', { method: 'PUT', body });
        close();
        await loadFuncionarios();
        if (state.report.length) await loadReport();
      },
    });
  }

  // Ajustar os horarios de um dia ja registrado.
  function openAjusteDia(r, histFrom) {
    const [y, m, d] = r.dia.split('-');
    const f = funcOf(r.email);
    const manual = r.manual_campos
      ? `<p style="font-size:0.8125rem;margin:0 0 10px">${manualBadge(r)} Motivo: ${esc(r.manual_motivo || '—')}</p>` : '';
    const { ov, close: closeAjuste } = openModal({
      title: `Ajustar ponto — ${nameOf(r.email)} — ${d}/${m}/${y}`,
      saveLabel: 'Salvar horários',
      extraButtons: '<button type="button" class="btn-action btn-delete" data-modal-del>Excluir dia</button>',
      body: `
        ${manual}
        ${f && f.jornada ? `<p style="font-size:0.8125rem;color:var(--text-secondary);margin:0 0 10px">Jornada prevista: ${esc(jornadaText(f.jornada))}</p>` : ''}
        <div class="ponto-grid">
          ${STEPS.map((s) => `
          <div class="form-group"><label for="pj-${s.id}">${s.label}</label>
            <input type="time" id="pj-${s.id}" value="${esc(r[s.id] || '')}" /></div>`).join('')}
          <div class="form-group" style="grid-column: 1 / -1">
            <label for="pj-obs">Observação / motivo do ajuste</label>
            <input type="text" id="pj-obs" maxlength="500" value="${esc(r.obs || '')}" placeholder="Ex.: esqueceu de marcar a saída" />
          </div>
        </div>
        <p style="font-size:0.75rem;color:var(--text-secondary);margin-top:4px">Deixe um horário em branco para apagá-lo. Salvar também aprova marcações manuais pendentes.</p>`,
      onSave: async (ov2, close) => {
        const body = { email: r.email, dia: r.dia, obs: ov2.querySelector('#pj-obs').value.trim() };
        STEPS.forEach((s) => { body[s.id] = ov2.querySelector('#pj-' + s.id).value || null; });
        const seq = STEPS.map((s) => body[s.id]).filter(Boolean);
        for (let i = 1; i < seq.length; i++) {
          if (seq[i] <= seq[i - 1]) throw new Error('Horários fora de ordem.');
        }
        await api('/api/ponto', { method: 'PUT', body });
        close();
        await loadReport();
        if (r.email === state.session.email) { loadToday(); loadHistory(histFrom); }
      },
    });
    ov.querySelector('[data-modal-del]').addEventListener('click', async () => {
      if (!confirm(`Excluir o registro de ${nameOf(r.email)} em ${d}/${m}/${y}?`)) return;
      try {
        await api(`/api/ponto?email=${encodeURIComponent(r.email)}&dia=${r.dia}`, { method: 'DELETE' });
        closeAjuste();
        await loadReport();
        if (r.email === state.session.email) { loadToday(); loadHistory(histFrom); }
      } catch (err) { alert(err.message); }
    });
  }

  // ---------- eventos ----------

  function wire(root, histFrom) {
    root.addEventListener('click', async (e) => {
      // Marcar ponto
      const mark = e.target.closest('[data-mark]');
      if (mark) {
        const tipo = mark.getAttribute('data-mark');
        const label = STEPS.find((s) => s.id === tipo).label;
        const msg = document.getElementById('ponto-msg');
        if (!confirm(`Confirmar marcação de "${label}" agora?`)) return;
        root.querySelectorAll('[data-mark]').forEach((b) => { b.disabled = true; });
        try {
          const data = await api('/api/ponto', { method: 'POST', body: { tipo } });
          state.today = data.record;
          setMsg(msg, `✔ Marcação de "${label}" registrada às ${data.record[tipo]}.`, 'ok');
          loadHistory(histFrom);
        } catch (err) {
          setMsg(msg, err.message || 'Falha ao registrar.', 'error');
          await loadToday();
          return;
        }
        renderSteps();
        return;
      }

      if (!state.manager) return;

      const edit = e.target.closest('[data-func-edit]');
      if (edit) {
        const f = funcOf(edit.getAttribute('data-func-edit'));
        if (f) openEditFuncionario(f, histFrom);
        return;
      }

      const toggle = e.target.closest('[data-func-toggle]');
      if (toggle) {
        const f = state.funcionarios.find((x) => x.email === toggle.getAttribute('data-func-toggle'));
        if (!f) return;
        if (f.ativo && !confirm(`Desativar o acesso de ${f.name}? Ele não conseguirá mais entrar.`)) return;
        try {
          await api('/api/funcionarios', { method: 'PUT', body: { email: f.email, ativo: !f.ativo } });
          await loadFuncionarios();
        } catch (err) { alert(err.message); }
        return;
      }

      const del = e.target.closest('[data-func-del]');
      if (del) {
        const f = state.funcionarios.find((x) => x.email === del.getAttribute('data-func-del'));
        if (!f) return;
        if (!confirm(`Excluir o funcionário ${f.name}? Os registros de ponto dele serão mantidos.`)) return;
        try {
          await api('/api/funcionarios?email=' + encodeURIComponent(f.email), { method: 'DELETE' });
          await loadFuncionarios();
        } catch (err) { alert(err.message); }
        return;
      }

      const adj = e.target.closest('[data-adj]');
      if (adj) {
        const [email, dia] = adj.getAttribute('data-adj').split('|');
        const r = state.report.find((x) => x.email === email && x.dia === dia) || { email, dia };
        openAjusteDia(r, histFrom);
        return;
      }

      const aprovar = e.target.closest('[data-aprovar]');
      if (aprovar) {
        const [email, dia] = aprovar.getAttribute('data-aprovar').split('|');
        aprovar.disabled = true;
        try {
          await api('/api/ponto', { method: 'PUT', body: { aprovar: true, email, dia } });
          await loadReport();
          if (email === state.session.email) loadHistory(histFrom);
        } catch (err) { alert(err.message); aprovar.disabled = false; }
        return;
      }

      const adjDel = e.target.closest('[data-adj-del]');
      if (adjDel) {
        const [email, dia] = adjDel.getAttribute('data-adj-del').split('|');
        const [y, m, d] = dia.split('-');
        if (!confirm(`Excluir o registro de ${nameOf(email)} em ${d}/${m}/${y}?`)) return;
        try {
          await api(`/api/ponto?email=${encodeURIComponent(email)}&dia=${dia}`, { method: 'DELETE' });
          await loadReport();
          if (email === state.session.email) { loadToday(); loadHistory(histFrom); }
        } catch (err) { alert(err.message); }
      }
    });

    // Marcacao manual (qualquer usuario, para o proprio ponto)
    const pmForm = $('#pm-form');
    const pmToggle = $('#pm-toggle');
    const closeManual = () => {
      pmForm.hidden = true;
      pmForm.reset();
      setMsg($('#pm-msg'), '', null);
      pmToggle.hidden = false;
    };
    pmToggle.addEventListener('click', () => {
      pmForm.hidden = false;
      pmToggle.hidden = true;
      // Sugere o primeiro campo ainda vazio de hoje.
      const next = nextStep(state.today);
      if (next) $('#pm-tipo').value = next;
      $('#pm-hora').focus();
    });
    $('#pm-cancel').addEventListener('click', closeManual);
    pmForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#pm-msg');
      const body = {
        manual: true,
        dia: $('#pm-dia').value,
        tipo: $('#pm-tipo').value,
        hora: $('#pm-hora').value,
        motivo: $('#pm-motivo').value.trim(),
      };
      if (!body.dia || !body.hora || !body.motivo) { setMsg(msg, 'Preencha data, horário e motivo.', 'error'); return; }
      const label = STEPS.find((s) => s.id === body.tipo).label;
      const [y, m, d] = body.dia.split('-');
      if (!confirm(`Lançar "${label}" às ${body.hora} em ${d}/${m}/${y}?`)) return;
      const btn = pmForm.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api('/api/ponto', { method: 'POST', body });
        closeManual();
        setMsg($('#ponto-msg'), `✔ Marcação manual de "${label}" (${d}/${m}) enviada — pendente de aprovação.`, 'ok');
        loadToday();
        loadHistory(histFrom);
      } catch (err) {
        setMsg(msg, err.message || 'Falha ao lançar.', 'error');
      } finally {
        btn.disabled = false;
      }
    });

    if (!state.manager) return;

    $('#ponto-func-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#pf-msg');
      setMsg(msg, '', null);
      const data = readFuncFields('pf');
      try {
        if (!data.name || !data.login) throw new Error('Informe nome e login.');
        data.passwordHash = await passwordHashFrom($('#pf-pass').value, $('#pf-pass2').value, true);
        $('#pf-submit').disabled = true;
        await api('/api/funcionarios', { method: 'POST', body: data });
        setMsg(msg, `Funcionário cadastrado. Login: ${data.login}`, 'ok');
        $('#ponto-func-form').reset();
        await loadFuncionarios();
      } catch (err) {
        setMsg(msg, err.message || 'Erro ao salvar.', 'error');
      } finally {
        $('#pf-submit').disabled = false;
      }
    });

    $('#pr-run').addEventListener('click', loadReport);
    $('#pr-csv').addEventListener('click', exportCSV);

    $('#ponto-adj-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#pa-msg');
      const body = { email: $('#pa-func').value, dia: $('#pa-dia').value, obs: $('#pa-obs').value.trim() };
      STEPS.forEach((s) => { body[s.id] = $('#pa-' + s.id).value || null; });
      if (!body.email || !body.dia) { setMsg(msg, 'Informe funcionário e data.', 'error'); return; }
      try {
        await api('/api/ponto', { method: 'PUT', body });
        setMsg(msg, 'Registro salvo.', 'ok');
        await loadReport();
        if (body.email === state.session.email) { loadToday(); loadHistory(histFrom); }
      } catch (err) {
        setMsg(msg, err.message || 'Erro ao salvar.', 'error');
      }
    });
  }

  // ---------- init ----------
  function canSeeTab(session) {
    const A = window.DIHMECAuth;
    return A.hasPermission('controle-ponto', session) || A.hasPermission('ponto-gestao', session);
  }

  function boot(session) {
    if (!session || !window.DIHMECAuth || !canSeeTab(session)) return;
    injectStyle();
    state.session = session;
    document.body.classList.toggle('ponto-only', session.role === 'funcionario');
    state.manager = session.role === 'superadmin' ||
      (session.role === 'user' && window.DIHMECAuth.hasPermission('ponto-gestao', session));
    render();
    refresh();
  }

  function refresh() {
    if (!state.rendered) return;
    loadToday();
    loadHistory(addDays(ymd(new Date()), -30));
    loadFuncionarios();
  }

  window.addEventListener('dihmec:auth-ready', (e) => boot(e.detail));
  // Ao reabrir a aba, atualiza (ex.: virou o dia ou outro gestor ajustou).
  document.addEventListener('click', (e) => {
    if (e.target.closest('.menu-item[data-form="controle-ponto"]')) {
      if (!state.rendered && window.DIHMECAuth) boot(window.DIHMECAuth.getSession());
      else refresh();
    }
  });
})();
