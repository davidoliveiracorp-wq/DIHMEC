(function () {
  'use strict';

  const SUPER_ADMIN_EMAIL = 'dasioli@gmail.com';
  const STORAGE_USERS = 'dihmec_users';
  const STORAGE_SESSION = 'dihmec_session';
  const STORAGE_PERMISSIONS = 'dihmec_permissions';

  // Permissões padrão para usuários comuns recém-cadastrados.
  const DEFAULT_USER_PERMISSIONS = ['cadastro-cliente', 'checklist', 'nova-os'];

  // Agendamento de serviço
  const STORAGE_APPOINTMENTS = 'dihmec_appointments';
  const WHATSAPP_NUMBER = '5511995086683';
  const BUSINESS_HOURS = { startHour: 8, endHour: 17 }; // 08:00 às 17:00
  const SLOT_MINUTES = 30;

  // Lista de menus do sistema. `always: true` significa que todo usuário
  // logado tem acesso (não é possível remover esta permissão).
  const MENUS = [
    { id: 'cadastro-cliente', label: 'Cadastro de Cliente', always: true },
    { id: 'veiculos', label: 'Veículos' },
    { id: 'produtos-estoque', label: 'Produtos/Estoque' },
    { id: 'valores-receber', label: 'Valores a Receber' },
    { id: 'valores-pago', label: 'Valores Pago' },
    { id: 'checklist', label: 'Checklist do Carro' },
    { id: 'nova-os', label: 'Nova Ordem de Serviço' },
    { id: 'cancelar-os', label: 'Cancelar Ordem de Serviço' },
    { id: 'finalizar-os', label: 'Finalizar Ordem de Serviço' },
    { id: 'pesquisar-os', label: 'Pesquisar OS Pendente' },
    { id: 'pesquisa-placa', label: 'Pesquisa por Placa' },
    { id: 'relatorio-os', label: 'Relatório de Ordem de Serviço' },
    { id: 'diagrama', label: 'Diagrama' },
  ];

  async function hashPassword(password) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(password));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function getUsers() {
    try { return JSON.parse(localStorage.getItem(STORAGE_USERS) || '[]'); }
    catch (e) { return []; }
  }
  function saveUsers(users) {
    localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
  }
  function getSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_SESSION) || 'null'); }
    catch (e) { return null; }
  }
  function setSession(session) {
    localStorage.setItem(STORAGE_SESSION, JSON.stringify(session));
  }
  function clearSession() {
    localStorage.removeItem(STORAGE_SESSION);
  }

  // ---------- Permissões ----------
  function getPermissions() {
    try { return JSON.parse(localStorage.getItem(STORAGE_PERMISSIONS) || '{}'); }
    catch (e) { return {}; }
  }
  function savePermissions(perms) {
    localStorage.setItem(STORAGE_PERMISSIONS, JSON.stringify(perms));
  }
  function getUserPermissions(email) {
    email = (email || '').toLowerCase();
    const perms = getPermissions();
    if (Array.isArray(perms[email])) return perms[email];
    return DEFAULT_USER_PERMISSIONS.slice();
  }
  function setUserPermissions(email, list) {
    email = (email || '').toLowerCase();
    const perms = getPermissions();
    const set = new Set(Array.isArray(list) ? list : []);
    set.add('cadastro-cliente');
    perms[email] = Array.from(set);
    savePermissions(perms);
  }
  function hasPermission(menuId, session) {
    session = session || getSession();
    if (!session) return false;
    if (session.role === 'superadmin') return true;
    const def = MENUS.find((m) => m.id === menuId);
    if (def && def.always) return true;
    return getUserPermissions(session.email).includes(menuId);
  }
  // ---------- Agendamentos ----------
  function getAppointments() {
    try { return JSON.parse(localStorage.getItem(STORAGE_APPOINTMENTS) || '[]'); }
    catch (e) { return []; }
  }
  function saveAppointments(list) {
    localStorage.setItem(STORAGE_APPOINTMENTS, JSON.stringify(list));
  }
  function generateTimeSlots() {
    const slots = [];
    for (let h = BUSINESS_HOURS.startHour; h < BUSINESS_HOURS.endHour; h++) {
      for (let m = 0; m < 60; m += SLOT_MINUTES) {
        slots.push(
          String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
        );
      }
    }
    return slots;
  }
  function isSlotBooked(date, time) {
    return getAppointments().some((a) => a.date === date && a.time === time);
  }
  function buildWhatsAppMessage(a) {
    const [y, m, d] = a.date.split('-');
    const dataBR = `${d}/${m}/${y}`;
    return [
      'Olá! Gostaria de agendar um serviço na DIHMEC:',
      '',
      `📅 Data: ${dataBR}`,
      `🕐 Horário: ${a.time}`,
      '',
      `👤 Cliente: ${a.name}`,
      `📞 Telefone: ${a.phone}`,
      '',
      `🚗 Veículo: ${a.vehicle}`,
      `🪪 Placa: ${a.plate}`,
      '',
      `📝 Serviço: ${a.description}`,
    ].join('\n');
  }

  function listUsers() {
    const users = getUsers();
    const perms = getPermissions();
    return users.map((u) => ({
      name: u.name,
      email: u.email,
      role: u.role,
      permissions: u.role === 'superadmin'
        ? MENUS.map((m) => m.id)
        : (Array.isArray(perms[u.email]) ? perms[u.email] : DEFAULT_USER_PERMISSIONS.slice()),
    }));
  }

  async function register({ name, email, password }) {
    name = (name || '').trim();
    email = (email || '').trim().toLowerCase();
    if (!name || !email || !password) throw new Error('Preencha todos os campos.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
    if (password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');
    const users = getUsers();
    if (users.some((u) => u.email === email)) throw new Error('E-mail já cadastrado.');
    const role = email === SUPER_ADMIN_EMAIL ? 'superadmin' : 'user';
    const passwordHash = await hashPassword(password);
    const user = { name, email, passwordHash, role, createdAt: Date.now() };
    users.push(user);
    saveUsers(users);
    // Permissões padrão para usuários comuns: Cadastro de Cliente, Checklist e Nova OS.
    if (role !== 'superadmin') {
      const perms = getPermissions();
      if (!perms[email]) {
        perms[email] = DEFAULT_USER_PERMISSIONS.slice();
        savePermissions(perms);
      }
    }
    return { name: user.name, email: user.email, role: user.role };
  }

  async function login({ email, password }) {
    email = (email || '').trim().toLowerCase();
    if (!email || !password) throw new Error('Informe e-mail e senha.');
    const users = getUsers();
    const user = users.find((u) => u.email === email);
    if (!user) throw new Error('E-mail não encontrado.');
    const passwordHash = await hashPassword(password);
    if (user.passwordHash !== passwordHash) throw new Error('Senha incorreta.');
    const session = { name: user.name, email: user.email, role: user.role, ts: Date.now() };
    setSession(session);
    return session;
  }

  function logout() {
    clearSession();
    window.location.href = '/index.html';
  }

  function isLoggedIn() {
    return !!getSession();
  }

  function ensureSuperAdminPlaceholder() {
    const users = getUsers();
    if (!users.some((u) => u.email === SUPER_ADMIN_EMAIL)) {
      // Apenas marca o e-mail como reservado para super admin; o registro real
      // será feito quando o usuário se cadastrar com este e-mail (ele receberá
      // automaticamente o papel "superadmin").
    }
  }

  // ---------- UI: Modal de Login/Cadastro ----------
  const STYLE = `
    .auth-overlay {
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(15, 17, 22, 0.55);
      backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .auth-card {
      width: 100%; max-width: 420px; max-height: 92vh; overflow-y: auto;
      background: #fff; border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.25);
      padding: 28px 28px 24px; color: #1a1d24;
      transition: max-width .25s ease;
    }
    .auth-card.wide { max-width: 560px; }
    .auth-card h2 {
      margin: 0 0 4px; font-size: 22px; font-weight: 700;
      color: #1a1d24;
    }
    .auth-card p.auth-sub {
      margin: 0 0 20px; color: #5f6368; font-size: 13px;
    }

    /* Banner DIHMEC dentro do modal */
    .auth-banner {
      position: relative;
      margin: -28px -28px 20px;
      padding: 16px 22px 10px;
      border-radius: 16px 16px 0 0;
      background:
        radial-gradient(ellipse at 20% 0%, rgba(232,93,4,0.10), transparent 60%),
        linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 50%, #161616 100%);
      color: #f5f5f5;
      overflow: hidden;
    }
    .auth-banner::after {
      content: ''; position: absolute; inset: 0;
      background-image: radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px);
      background-size: 14px 14px; pointer-events: none;
    }
    .auth-banner-top {
      display: flex; align-items: center; gap: 14px;
      position: relative; z-index: 2;
    }
    .auth-banner-mark {
      flex-shrink: 0; width: 60px; height: 60px;
      border: 2px solid #888; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: radial-gradient(circle at 30% 30%, #3a3a3a 0%, #0d0d0d 70%);
      box-shadow: inset 0 0 10px rgba(255,255,255,0.05),
                  0 4px 10px rgba(0,0,0,0.4);
    }
    .auth-banner-mark img { max-width: 78%; max-height: 78%; object-fit: contain; }
    .auth-banner-mark span {
      color: #fff; font-weight: 800; font-size: 12px; letter-spacing: 1.5px;
    }
    .auth-banner-info { flex: 1; min-width: 0; }
    .auth-banner-info h3 {
      margin: 0; color: #fff; font-size: 16px; font-weight: 800;
      letter-spacing: 1.5px;
    }
    .auth-banner-info p {
      margin: 2px 0 0; font-size: 10px; color: #b8b8b8;
      font-weight: 500; letter-spacing: 0.8px; text-transform: uppercase;
    }
    .auth-banner-info .auth-banner-phone {
      color: #ff8a3d; font-size: 11px; font-weight: 700;
      margin-top: 3px; letter-spacing: 0; text-transform: none;
    }
    .auth-banner-strip {
      display: flex; align-items: center; justify-content: center;
      flex-wrap: wrap; gap: 12px;
      margin-top: 10px; padding-top: 8px;
      border-top: 1px solid rgba(255,255,255,0.08);
      position: relative; z-index: 2;
    }
    .auth-banner-strip img {
      height: 16px; width: auto;
      filter: brightness(0) invert(0.78);
      opacity: 0.55;
      transition: opacity .15s ease, filter .15s ease;
    }
    .auth-banner-strip img:hover {
      opacity: 1;
      filter: brightness(0) invert(1);
    }
    .auth-tabs {
      display: flex; background: #f0f2f5; border-radius: 10px;
      padding: 4px; margin-bottom: 18px;
    }
    .auth-tab {
      flex: 1; padding: 8px 12px; text-align: center;
      cursor: pointer; border-radius: 8px; font-size: 13px; font-weight: 600;
      color: #5f6368; transition: all .2s ease;
      border: none; background: transparent;
    }
    .auth-tab.active { background: #fff; color: #1a1d24; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .auth-field { margin-bottom: 12px; }
    .auth-field label {
      display: block; font-size: 12px; font-weight: 600; color: #5f6368;
      margin-bottom: 6px;
    }
    .auth-field input {
      width: 100%; padding: 10px 12px; border: 1px solid #e8eaed;
      border-radius: 8px; font-size: 14px; font-family: inherit;
      background: #fff; color: #1a1d24; outline: none;
      transition: border-color .2s ease, box-shadow .2s ease;
    }
    .auth-field input:focus {
      border-color: #e85d04;
      box-shadow: 0 0 0 3px rgba(232, 93, 4, 0.12);
    }
    .auth-submit {
      width: 100%; margin-top: 8px;
      padding: 11px 14px; border: none; border-radius: 8px;
      background: #e85d04; color: #fff; font-size: 14px; font-weight: 600;
      cursor: pointer; transition: background .2s ease;
      font-family: inherit;
    }
    .auth-submit:hover { background: #d45103; }
    .auth-submit:disabled { opacity: 0.6; cursor: not-allowed; }
    .auth-error {
      display: none; margin: 8px 0 0;
      padding: 8px 10px; background: #fdecea; color: #b3261e;
      border-radius: 6px; font-size: 12px;
    }
    .auth-error.show { display: block; }
    .auth-success {
      display: none; margin: 8px 0 0;
      padding: 8px 10px; background: #e6f4ea; color: #1e7e34;
      border-radius: 6px; font-size: 12px;
    }
    .auth-success.show { display: block; }
    .auth-hint {
      margin-top: 12px; font-size: 11px; color: #80868b; text-align: center;
    }
    .auth-userbar {
      position: fixed; top: 12px; right: 12px; z-index: 9998;
      display: flex; align-items: center; gap: 10px;
      background: #fff; padding: 8px 12px; border-radius: 999px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 12px; color: #1a1d24;
    }
    .auth-userbar .auth-badge {
      background: #e85d04; color: #fff; padding: 2px 8px;
      border-radius: 999px; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: .5px;
    }
    .auth-userbar .auth-badge.user { background: #5f6368; }
    .auth-userbar button {
      border: none; background: transparent; color: #b3261e;
      font-weight: 600; cursor: pointer; font-size: 12px;
      font-family: inherit;
    }
    .auth-userbar button:hover { text-decoration: underline; }

    /* Agendamento */
    .auth-field textarea {
      width: 100%; padding: 10px 12px; border: 1px solid #e8eaed;
      border-radius: 8px; font-size: 14px; font-family: inherit;
      background: #fff; color: #1a1d24; outline: none; resize: vertical;
      transition: border-color .2s ease, box-shadow .2s ease;
    }
    .auth-field textarea:focus {
      border-color: #e85d04;
      box-shadow: 0 0 0 3px rgba(232, 93, 4, 0.12);
    }
    .sched-grid {
      display: grid; gap: 12px; grid-template-columns: 1fr 1fr;
    }
    .sched-grid .auth-field { margin-bottom: 0; }
    .sched-slots {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
      margin-top: 4px;
    }
    .sched-slot {
      padding: 8px 4px; border: 1px solid #e8eaed; border-radius: 6px;
      background: #fff; cursor: pointer; font-size: 12px; font-weight: 500;
      font-family: inherit; text-align: center; color: #1a1d24;
      transition: all .15s ease;
    }
    .sched-slot:hover:not(.booked):not(:disabled) {
      border-color: #e85d04; background: #fff7f0;
    }
    .sched-slot.selected {
      background: #e85d04; color: #fff; border-color: #e85d04;
      box-shadow: 0 2px 6px rgba(232, 93, 4, 0.3);
    }
    .sched-slot.booked, .sched-slot:disabled {
      background: #f0f2f5; color: #b0b3b8; cursor: not-allowed;
      text-decoration: line-through;
    }
    .sched-empty {
      grid-column: 1 / -1; color: #5f6368; font-size: 12px;
      text-align: center; padding: 12px;
    }
    .sched-legend {
      display: flex; gap: 12px; font-size: 11px; color: #5f6368;
      margin-top: 8px; justify-content: center; flex-wrap: wrap;
    }
    .sched-legend span { display: inline-flex; align-items: center; gap: 4px; }
    .sched-legend .dot {
      width: 10px; height: 10px; border-radius: 3px; display: inline-block;
    }
    .sched-legend .dot.free { background: #fff; border: 1px solid #e8eaed; }
    .sched-legend .dot.sel { background: #e85d04; }
    .sched-legend .dot.busy { background: #f0f2f5; }

    /* Modal de Administração */
    .admin-overlay {
      position: fixed; inset: 0; z-index: 99998;
      background: rgba(15, 17, 22, 0.55);
      backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .admin-card {
      width: 100%; max-width: 880px; max-height: 86vh;
      background: #fff; border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.25);
      display: flex; flex-direction: column; overflow: hidden;
      color: #1a1d24;
    }
    .admin-header {
      padding: 18px 22px; border-bottom: 1px solid #e8eaed;
      display: flex; align-items: center; justify-content: space-between;
    }
    .admin-header h2 { margin: 0; font-size: 18px; font-weight: 700; }
    .admin-header p { margin: 4px 0 0; color: #5f6368; font-size: 12px; }
    .admin-close {
      border: none; background: transparent; cursor: pointer;
      font-size: 22px; color: #5f6368; padding: 4px 8px; line-height: 1;
    }
    .admin-body {
      padding: 16px 22px; overflow: auto; flex: 1;
    }
    .admin-table {
      width: 100%; border-collapse: collapse; font-size: 12px;
    }
    .admin-table th, .admin-table td {
      padding: 8px 6px; text-align: left; border-bottom: 1px solid #f0f2f5;
      vertical-align: middle; white-space: nowrap;
    }
    .admin-table th {
      position: sticky; top: 0; background: #fafafa; color: #5f6368;
      font-weight: 600; font-size: 11px; text-transform: uppercase;
      letter-spacing: .3px;
    }
    .admin-table th.menu-th {
      writing-mode: vertical-rl; transform: rotate(180deg);
      text-align: left; height: 130px; padding: 8px 4px;
      letter-spacing: .2px;
    }
    .admin-table tbody tr:hover { background: #fafafa; }
    .admin-user-cell { min-width: 200px; white-space: normal; }
    .admin-user-cell strong { display: block; }
    .admin-user-cell small { color: #80868b; }
    .admin-role-badge {
      display: inline-block; margin-left: 6px;
      background: #5f6368; color: #fff; padding: 1px 6px;
      border-radius: 999px; font-size: 9px; font-weight: 700;
      text-transform: uppercase; letter-spacing: .3px;
    }
    .admin-role-badge.super { background: #e85d04; }
    .admin-table input[type=checkbox] { cursor: pointer; transform: scale(1.1); }
    .admin-table input[type=checkbox]:disabled { cursor: not-allowed; opacity: 0.5; }
    .admin-footer {
      padding: 12px 22px; border-top: 1px solid #e8eaed;
      display: flex; justify-content: flex-end; gap: 8px; align-items: center;
    }
    .admin-footer .admin-status {
      margin-right: auto; font-size: 12px; color: #1e7e34;
      opacity: 0; transition: opacity .2s ease;
    }
    .admin-footer .admin-status.show { opacity: 1; }
    .admin-btn {
      padding: 9px 16px; border-radius: 8px; border: none;
      font-size: 13px; font-weight: 600; cursor: pointer;
      font-family: inherit;
    }
    .admin-btn.primary { background: #e85d04; color: #fff; }
    .admin-btn.primary:hover { background: #d45103; }
    .admin-btn.secondary { background: #f0f2f5; color: #1a1d24; }
    .admin-btn.secondary:hover { background: #e8eaed; }
  `;

  function injectStyle() {
    if (document.getElementById('auth-style')) return;
    const s = document.createElement('style');
    s.id = 'auth-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function renderUserBar() {
    const session = getSession();
    if (!session) return;
    const existing = document.getElementById('auth-userbar');
    if (existing) existing.remove();
    const bar = document.createElement('div');
    bar.id = 'auth-userbar';
    bar.className = 'auth-userbar';
    const roleLabel = session.role === 'superadmin' ? 'Super Admin' : 'Usuário';
    const roleClass = session.role === 'superadmin' ? '' : 'user';
    bar.innerHTML = `
      <span class="auth-badge ${roleClass}">${roleLabel}</span>
      <span><strong>${escapeHtml(session.name)}</strong></span>
      <button type="button" id="auth-logout-btn">Sair</button>
    `;
    document.body.appendChild(bar);
    document.getElementById('auth-logout-btn').addEventListener('click', logout);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function renderModal(onSuccess) {
    if (document.getElementById('auth-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.className = 'auth-overlay';
    overlay.innerHTML = `
      <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div class="auth-banner">
          <div class="auth-banner-top">
            <div class="auth-banner-mark">
              <img src="/logo-dihmec.png" alt="DIHMEC"
                   onerror="this.style.display='none';this.nextElementSibling.style.display='block';" />
              <span style="display:none">DIHMEC</span>
            </div>
            <div class="auth-banner-info">
              <h3>DIHMEC</h3>
              <p>Mecânico · Injeção · Diesel · Flex · Multimarcas</p>
              <p class="auth-banner-phone">📞 (11) 99508-6683 — Edimar</p>
            </div>
          </div>
          <div class="auth-banner-strip" aria-label="Marcas atendidas">
            <img src="https://cdn.simpleicons.org/mercedes/silver" alt="Mercedes-Benz" title="Mercedes-Benz" />
            <img src="https://cdn.simpleicons.org/volkswagen/silver" alt="Volkswagen" title="Volkswagen" />
            <img src="https://cdn.simpleicons.org/ford/silver" alt="Ford" title="Ford" />
            <img src="https://cdn.simpleicons.org/honda/silver" alt="Honda" title="Honda" />
            <img src="https://cdn.simpleicons.org/toyota/silver" alt="Toyota" title="Toyota" />
            <img src="https://cdn.simpleicons.org/bmw/silver" alt="BMW" title="BMW" />
            <img src="https://cdn.simpleicons.org/hyundai/silver" alt="Hyundai" title="Hyundai" />
            <img src="https://cdn.simpleicons.org/fiat/silver" alt="Fiat" title="Fiat" />
            <img src="https://cdn.simpleicons.org/chevrolet/silver" alt="Chevrolet" title="Chevrolet" />
            <img src="https://cdn.simpleicons.org/renault/silver" alt="Renault" title="Renault" />
          </div>
        </div>
        <h2 id="auth-title">Bem-vindo</h2>
        <p class="auth-sub">Entre ou crie sua conta para continuar.</p>
        <div class="auth-tabs" role="tablist">
          <button type="button" class="auth-tab active" data-tab="login" role="tab">Entrar</button>
          <button type="button" class="auth-tab" data-tab="register" role="tab">Cadastrar</button>
          <button type="button" class="auth-tab" data-tab="schedule" role="tab">Agendar</button>
        </div>

        <form id="auth-form-login" novalidate>
          <div class="auth-field">
            <label for="auth-login-email">E-mail</label>
            <input type="email" id="auth-login-email" autocomplete="email" required />
          </div>
          <div class="auth-field">
            <label for="auth-login-password">Senha</label>
            <input type="password" id="auth-login-password" autocomplete="current-password" required />
          </div>
          <button type="submit" class="auth-submit">Entrar</button>
          <div class="auth-error" id="auth-login-error"></div>
        </form>

        <form id="auth-form-register" novalidate style="display:none">
          <div class="auth-field">
            <label for="auth-reg-name">Nome completo</label>
            <input type="text" id="auth-reg-name" autocomplete="name" required />
          </div>
          <div class="auth-field">
            <label for="auth-reg-email">E-mail</label>
            <input type="email" id="auth-reg-email" autocomplete="email" required />
          </div>
          <div class="auth-field">
            <label for="auth-reg-password">Senha</label>
            <input type="password" id="auth-reg-password" autocomplete="new-password" minlength="6" required />
          </div>
          <button type="submit" class="auth-submit">Cadastrar</button>
          <div class="auth-error" id="auth-reg-error"></div>
          <div class="auth-success" id="auth-reg-success"></div>
        </form>

        <form id="auth-form-schedule" novalidate style="display:none">
          <p class="auth-sub" style="margin-top:-10px;margin-bottom:14px">
            Funcionamento: 08:00 às 17:00. O agendamento será enviado pelo WhatsApp para confirmação.
          </p>
          <div class="auth-field">
            <label for="sched-date">Data do agendamento</label>
            <input type="date" id="sched-date" required />
          </div>
          <div class="auth-field">
            <label>Horários disponíveis</label>
            <div class="sched-slots" id="sched-slots"></div>
            <div class="sched-legend">
              <span><span class="dot free"></span>Livre</span>
              <span><span class="dot sel"></span>Selecionado</span>
              <span><span class="dot busy"></span>Ocupado</span>
            </div>
          </div>
          <div class="sched-grid">
            <div class="auth-field">
              <label for="sched-name">Seu nome</label>
              <input type="text" id="sched-name" required />
            </div>
            <div class="auth-field">
              <label for="sched-phone">Telefone (WhatsApp)</label>
              <input type="tel" id="sched-phone" placeholder="(11) 99999-0000" required />
            </div>
            <div class="auth-field">
              <label for="sched-plate">Placa</label>
              <input type="text" id="sched-plate" placeholder="ABC1D23" maxlength="7" required />
            </div>
            <div class="auth-field">
              <label for="sched-vehicle">Marca / Modelo</label>
              <input type="text" id="sched-vehicle" placeholder="Honda Civic" required />
            </div>
          </div>
          <div class="auth-field" style="margin-top:12px">
            <label for="sched-desc">Descrição do serviço</label>
            <textarea id="sched-desc" rows="2" placeholder="Ex.: Troca de óleo e revisão" required></textarea>
          </div>
          <button type="submit" class="auth-submit">Enviar pelo WhatsApp</button>
          <div class="auth-error" id="auth-sched-error"></div>
          <div class="auth-success" id="auth-sched-success"></div>
        </form>

        <p class="auth-hint">Os dados ficam armazenados localmente no seu navegador.</p>
      </div>
    `;
    document.body.appendChild(overlay);

    const card = overlay.querySelector('.auth-card');
    const tabs = overlay.querySelectorAll('.auth-tab');
    const loginForm = overlay.querySelector('#auth-form-login');
    const registerForm = overlay.querySelector('#auth-form-register');
    const scheduleForm = overlay.querySelector('#auth-form-schedule');
    const loginError = overlay.querySelector('#auth-login-error');
    const regError = overlay.querySelector('#auth-reg-error');
    const regSuccess = overlay.querySelector('#auth-reg-success');
    const schedError = overlay.querySelector('#auth-sched-error');
    const schedSuccess = overlay.querySelector('#auth-sched-success');
    const slotsContainer = overlay.querySelector('#sched-slots');
    const dateInput = overlay.querySelector('#sched-date');

    // Define data mínima como hoje
    const today = new Date();
    const todayStr =
      today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    dateInput.min = todayStr;
    dateInput.value = todayStr;

    function renderSlotsForDate(date) {
      const slots = generateTimeSlots();
      const selected = slotsContainer.dataset.selected || '';
      slotsContainer.innerHTML = '';
      if (!date) {
        slotsContainer.innerHTML = '<p class="sched-empty">Selecione uma data primeiro.</p>';
        return;
      }
      slots.forEach((time) => {
        const booked = isSlotBooked(date, time);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sched-slot' +
          (booked ? ' booked' : '') +
          (time === selected ? ' selected' : '');
        btn.textContent = time;
        btn.disabled = booked;
        btn.dataset.time = time;
        btn.addEventListener('click', () => {
          slotsContainer.querySelectorAll('.sched-slot').forEach((s) => s.classList.remove('selected'));
          btn.classList.add('selected');
          slotsContainer.dataset.selected = time;
        });
        slotsContainer.appendChild(btn);
      });
    }

    dateInput.addEventListener('change', () => {
      slotsContainer.dataset.selected = '';
      renderSlotsForDate(dateInput.value);
    });

    tabs.forEach((t) =>
      t.addEventListener('click', () => {
        tabs.forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        const which = t.getAttribute('data-tab');
        loginForm.style.display = which === 'login' ? '' : 'none';
        registerForm.style.display = which === 'register' ? '' : 'none';
        scheduleForm.style.display = which === 'schedule' ? '' : 'none';
        if (which === 'schedule') {
          card.classList.add('wide');
          renderSlotsForDate(dateInput.value);
        } else {
          card.classList.remove('wide');
        }
        loginError.classList.remove('show');
        regError.classList.remove('show');
        regSuccess.classList.remove('show');
        schedError.classList.remove('show');
        schedSuccess.classList.remove('show');
      })
    );

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginError.classList.remove('show');
      const email = overlay.querySelector('#auth-login-email').value;
      const password = overlay.querySelector('#auth-login-password').value;
      const btn = loginForm.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await login({ email, password });
        overlay.remove();
        if (onSuccess) onSuccess();
      } catch (err) {
        loginError.textContent = err.message || 'Erro ao entrar.';
        loginError.classList.add('show');
      } finally {
        btn.disabled = false;
      }
    });

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      regError.classList.remove('show');
      regSuccess.classList.remove('show');
      const name = overlay.querySelector('#auth-reg-name').value;
      const email = overlay.querySelector('#auth-reg-email').value;
      const password = overlay.querySelector('#auth-reg-password').value;
      const btn = registerForm.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const u = await register({ name, email, password });
        regSuccess.textContent =
          u.role === 'superadmin'
            ? 'Cadastro realizado como Super Admin! Faça login.'
            : 'Cadastro realizado! Faça login para continuar.';
        regSuccess.classList.add('show');
        registerForm.reset();
        // Alterna para a aba de login automaticamente
        setTimeout(() => {
          tabs.forEach((x) => x.classList.remove('active'));
          tabs[0].classList.add('active');
          loginForm.style.display = '';
          registerForm.style.display = 'none';
          overlay.querySelector('#auth-login-email').value = u.email;
        }, 900);
      } catch (err) {
        regError.textContent = err.message || 'Erro ao cadastrar.';
        regError.classList.add('show');
      } finally {
        btn.disabled = false;
      }
    });

    scheduleForm.addEventListener('submit', (e) => {
      e.preventDefault();
      schedError.classList.remove('show');
      schedSuccess.classList.remove('show');
      const date = dateInput.value;
      const time = slotsContainer.dataset.selected || '';
      const name = overlay.querySelector('#sched-name').value.trim();
      const phone = overlay.querySelector('#sched-phone').value.trim();
      const plate = overlay.querySelector('#sched-plate').value.trim().toUpperCase();
      const vehicle = overlay.querySelector('#sched-vehicle').value.trim();
      const description = overlay.querySelector('#sched-desc').value.trim();

      if (!date) {
        schedError.textContent = 'Selecione uma data.';
        schedError.classList.add('show');
        return;
      }
      if (!time) {
        schedError.textContent = 'Escolha um horário disponível.';
        schedError.classList.add('show');
        return;
      }
      if (!name || !phone || !plate || !vehicle || !description) {
        schedError.textContent = 'Preencha todos os campos.';
        schedError.classList.add('show');
        return;
      }

      const list = getAppointments();
      if (list.some((a) => a.date === date && a.time === time)) {
        schedError.textContent = 'Este horário acabou de ser ocupado. Escolha outro.';
        schedError.classList.add('show');
        slotsContainer.dataset.selected = '';
        renderSlotsForDate(date);
        return;
      }

      const appointment = { name, phone, plate, vehicle, description, date, time, ts: Date.now() };
      list.push(appointment);
      saveAppointments(list);

      const message = buildWhatsAppMessage(appointment);
      const url = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
      window.open(url, '_blank', 'noopener');

      schedSuccess.textContent = 'Agendamento registrado! Confirme o envio no WhatsApp.';
      schedSuccess.classList.add('show');
      scheduleForm.reset();
      dateInput.value = todayStr;
      slotsContainer.dataset.selected = '';
      renderSlotsForDate(todayStr);
    });
  }

  // ---------- Aplicação de permissões na UI ----------
  function getMenuIdFromAnchor(a) {
    let id = a.getAttribute('data-form');
    if (id) return id;
    const href = a.getAttribute('href') || '';
    if (/diagrama\.html/i.test(href)) return 'diagrama';
    return null;
  }

  function applyMenuPermissions() {
    const session = getSession();
    if (!session) return;
    document.querySelectorAll('.sidebar-menu .menu-item').forEach((a) => {
      // Ignora o item de Administração que injetamos
      if (a.getAttribute('data-admin')) return;
      const menuId = getMenuIdFromAnchor(a);
      if (!menuId) return;
      const li = a.closest('li');
      if (!hasPermission(menuId, session)) {
        if (li) li.style.display = 'none';
        else a.style.display = 'none';
      } else {
        if (li) li.style.display = '';
        else a.style.display = '';
      }
    });
    if (session.role === 'superadmin') injectAdminMenu();
  }

  function enforcePagePermission() {
    const session = getSession();
    if (!session) return;
    if (/diagrama\.html/i.test(window.location.pathname) && !hasPermission('diagrama', session)) {
      alert('Você não tem permissão para acessar esta página.');
      window.location.href = '/index.html';
    }
  }

  function injectAdminMenu() {
    const menu = document.querySelector('.sidebar-menu');
    if (!menu) return;
    if (document.getElementById('admin-menu-item')) return;
    const li = document.createElement('li');
    li.id = 'admin-menu-item';
    li.innerHTML = '<a href="#" class="menu-item" data-admin="1">Administração</a>';
    menu.appendChild(li);
    li.querySelector('a').addEventListener('click', (e) => {
      e.preventDefault();
      openAdminModal();
    });
  }

  function openAdminModal() {
    const session = getSession();
    if (!session || session.role !== 'superadmin') return;
    if (document.getElementById('admin-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'admin-overlay';
    overlay.className = 'admin-overlay';

    const users = listUsers();
    const menusEditable = MENUS.filter((m) => !m.always);
    const headerMenuCells = menusEditable
      .map((m) => `<th class="menu-th">${escapeHtml(m.label)}</th>`)
      .join('');

    const rows = users.map((u) => {
      const isSuper = u.role === 'superadmin';
      const userCellRole = isSuper
        ? '<span class="admin-role-badge super">Super Admin</span>'
        : '<span class="admin-role-badge">Usuário</span>';
      const cells = menusEditable
        .map((m) => {
          const checked = u.permissions.includes(m.id) ? 'checked' : '';
          const disabled = isSuper ? 'disabled' : '';
          return `<td style="text-align:center"><input type="checkbox" data-email="${escapeHtml(u.email)}" data-menu="${escapeHtml(m.id)}" ${checked} ${disabled} /></td>`;
        })
        .join('');
      return `
        <tr>
          <td class="admin-user-cell">
            <strong>${escapeHtml(u.name)}</strong> ${userCellRole}<br/>
            <small>${escapeHtml(u.email)}</small>
          </td>
          ${cells}
        </tr>
      `;
    }).join('');

    overlay.innerHTML = `
      <div class="admin-card" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <div class="admin-header">
          <div>
            <h2 id="admin-title">Administração de Acessos</h2>
            <p>Marque os menus que cada usuário pode acessar. "Cadastro de Cliente" é sempre liberado.</p>
          </div>
          <button type="button" class="admin-close" aria-label="Fechar" id="admin-close-btn">×</button>
        </div>
        <div class="admin-body">
          ${users.length === 0
            ? '<p style="color:#5f6368;font-size:13px;margin:8px 0;">Nenhum usuário cadastrado ainda.</p>'
            : `<table class="admin-table">
                <thead>
                  <tr>
                    <th>Usuário</th>
                    ${headerMenuCells}
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>`}
        </div>
        <div class="admin-footer">
          <span class="admin-status" id="admin-status">Permissões salvas.</span>
          <button type="button" class="admin-btn secondary" id="admin-cancel-btn">Fechar</button>
          <button type="button" class="admin-btn primary" id="admin-save-btn">Salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#admin-close-btn').addEventListener('click', close);
    overlay.querySelector('#admin-cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#admin-save-btn').addEventListener('click', () => {
      const checks = overlay.querySelectorAll('input[type=checkbox][data-email]');
      const byEmail = {};
      checks.forEach((c) => {
        if (c.disabled) return;
        const em = c.getAttribute('data-email');
        const m = c.getAttribute('data-menu');
        if (!byEmail[em]) byEmail[em] = [];
        if (c.checked) byEmail[em].push(m);
      });
      Object.keys(byEmail).forEach((em) => setUserPermissions(em, byEmail[em]));
      const status = overlay.querySelector('#admin-status');
      status.classList.add('show');
      setTimeout(() => status.classList.remove('show'), 1800);
      // Reaplicar no menu lateral imediatamente (caso o admin tenha mudado a si mesmo)
      applyMenuPermissions();
    });
  }

  function requireAuth() {
    injectStyle();
    ensureSuperAdminPlaceholder();
    if (isLoggedIn()) {
      renderUserBar();
      applyMenuPermissions();
      enforcePagePermission();
      return Promise.resolve(getSession());
    }
    return new Promise((resolve) => {
      renderModal(() => {
        renderUserBar();
        applyMenuPermissions();
        enforcePagePermission();
        resolve(getSession());
      });
    });
  }

  window.DIHMECAuth = {
    register,
    login,
    logout,
    getSession,
    isLoggedIn,
    requireAuth,
    hasPermission,
    listUsers,
    getUserPermissions,
    setUserPermissions,
    openAdminModal,
    applyMenuPermissions,
    getAppointments,
    generateTimeSlots,
    isSlotBooked,
    MENUS,
    SUPER_ADMIN_EMAIL,
    WHATSAPP_NUMBER,
    BUSINESS_HOURS,
  };

  // Auto-executa proteção quando o script é carregado com o atributo
  // data-auto-protect (padrão para todas as páginas que incluírem este script).
  document.addEventListener('DOMContentLoaded', () => {
    const tag = document.currentScript || document.querySelector('script[src*="auth.js"]');
    const autoProtect = !tag || tag.getAttribute('data-auto-protect') !== 'false';
    if (autoProtect) requireAuth();
  });
})();
