(function () {
  'use strict';

  const SUPER_ADMIN_EMAILS = ['dasioli@gmail.com', 'edisioli@gmail.com'];
  // Mantido para compatibilidade com integrações antigas
  const SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAILS[0];
  function isSuperAdminEmail(email) {
    return SUPER_ADMIN_EMAILS.includes(String(email || '').trim().toLowerCase());
  }
  const STORAGE_USERS = 'dihmec_users';
  const STORAGE_SESSION = 'dihmec_session';
  const STORAGE_PERMISSIONS = 'dihmec_permissions';
  const STORAGE_RESET = 'dihmec_reset_token';
  const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutos

  // ---------- HTTP helper ----------
  // Toda comunicacao com o backend (/api/*) passa por aqui. Anexa o
  // Bearer token (lido da sessao em localStorage), faz o parse de JSON
  // e converte erros HTTP em Error legivel.
  async function apiFetch(path, options = {}) {
    const opts = Object.assign({ method: 'GET' }, options);
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_SESSION) || 'null');
      if (s && s.token) opts.headers['Authorization'] = 'Bearer ' + s.token;
    } catch (e) {}
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    const r = await fetch(path, opts);
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (!r.ok) {
      const msg = (data && data.error) || ('HTTP ' + r.status);
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return data;
  }

  function syncReady() {
    return (window.DIHMECSync && window.DIHMECSync.ready) || Promise.resolve();
  }
  async function syncPull() {
    if (window.DIHMECSync && window.DIHMECSync.pull) {
      try { await window.DIHMECSync.pull(); } catch (e) {}
    }
  }

  // ----------------------------------------------------------------
  // Integração com EmailJS (envio do token para o e-mail cadastrado).
  // Como o site é estático, usamos o EmailJS (https://www.emailjs.com)
  // que envia e-mails direto do navegador. Para ligar:
  //   1) Criar conta gratuita em emailjs.com (200 e-mails/mês de graça)
  //   2) Adicionar um "Email Service" (Gmail, Outlook, etc.)
  //   3) Criar um "Email Template" com as variáveis {{to_email}},
  //      {{token}} e {{expires_minutes}} no corpo
  //   4) Substituir os valores abaixo pelos seus
  // Enquanto vazio, o token continua aparecendo na tela como fallback.
  window.DIHMEC_EMAILJS = window.DIHMEC_EMAILJS || {
    serviceId: '',
    templateId: '',
    publicKey: '',
  };

  let _emailjsLoading = null;
  function loadEmailJS() {
    if (window.emailjs) return Promise.resolve(window.emailjs);
    const cfg = window.DIHMEC_EMAILJS || {};
    if (!cfg.serviceId || !cfg.templateId || !cfg.publicKey) return Promise.resolve(null);
    if (_emailjsLoading) return _emailjsLoading;
    _emailjsLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
      s.onload = () => {
        try { window.emailjs.init({ publicKey: cfg.publicKey }); } catch (e) {}
        resolve(window.emailjs);
      };
      s.onerror = () => reject(new Error('Falha ao carregar EmailJS SDK'));
      document.head.appendChild(s);
    });
    return _emailjsLoading;
  }

  async function sendResetEmailViaEmailJS({ email, token, expiresAt }) {
    const cfg = window.DIHMEC_EMAILJS || {};
    if (!cfg.serviceId || !cfg.templateId || !cfg.publicKey) return false;
    const lib = await loadEmailJS();
    if (!lib) return false;
    const expiresMinutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60000));
    await lib.send(cfg.serviceId, cfg.templateId, {
      to_email: email,
      token,
      expires_minutes: expiresMinutes,
    });
    return true;
  }

  // Política de complexidade de senha
  function validatePasswordComplexity(password) {
    const p = String(password || '');
    if (p.length < 8) throw new Error('A senha deve ter no mínimo 8 caracteres.');
    if (!/[A-Z]/.test(p)) throw new Error('A senha deve conter ao menos uma letra maiúscula.');
    if (!/\d/.test(p)) throw new Error('A senha deve conter ao menos um número.');
    if (!/[!@#$%^&*()_+\-=\[\]{};:'",.<>\/?\\|`~]/.test(p))
      throw new Error('A senha deve conter ao menos um caractere especial (ex.: ! @ # $ % * ?).');
  }

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
  // Persiste a permissao no servidor (requer superadmin). O cliente
  // tambem atualiza o cache local imediatamente para a UI nao "piscar".
  async function setUserPermissions(email, list) {
    email = (email || '').toLowerCase();
    const set = new Set(Array.isArray(list) ? list : []);
    set.add('cadastro-cliente');
    const menus = Array.from(set);
    // Otimismo local — refletira no DOM antes do retorno da API.
    const perms = getPermissions();
    perms[email] = menus;
    try { localStorage.setItem(STORAGE_PERMISSIONS, JSON.stringify(perms)); } catch (e) {}
    await apiFetch('/api/permissions', {
      method: 'PUT',
      body: { email, menus },
    });
    await syncPull();
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

  // ---------- Cadastros (placas / clientes / veículos) ----------
  function getRegisteredPlates() {
    try {
      const html = localStorage.getItem('dihmec_vehicles_html') || '';
      if (!html.trim()) return [];
      const tmp = document.createElement('tbody');
      tmp.innerHTML = html;
      return Array.from(tmp.querySelectorAll('tr'))
        .map((r) => r.children[0] && r.children[0].textContent.trim().toUpperCase())
        .filter(Boolean);
    } catch (e) { return []; }
  }
  function isPlateRegistered(plate) {
    const p = String(plate || '').trim().toUpperCase();
    return !!p && getRegisteredPlates().includes(p);
  }
  function registerVehicleFromSchedule({ name, phone, plate, vehicle }) {
    // Divide "Marca Modelo" no primeiro espaço
    const parts = String(vehicle || '').trim().split(/\s+/);
    const brand = parts.shift() || '-';
    const model = parts.join(' ') || '-';
    const customerHtml = localStorage.getItem('dihmec_customers_html') || '';
    const vehicleHtml  = localStorage.getItem('dihmec_vehicles_html')  || '';
    const customerId = Date.now();

    const newCustomerRow =
      `<tr>` +
        `<td>${escapeHtml(name)}</td>` +
        `<td>-</td>` +
        `<td>${escapeHtml(phone || '-')}</td>` +
        `<td>${escapeHtml(plate)}</td>` +
        `<td>${escapeHtml(model)}</td>` +
        `<td>${escapeHtml(brand)}</td>` +
        `<td>-</td>` +
        `<td>-</td>` +
        `<td><div class="action-buttons">` +
          `<button class="btn-action btn-edit" onclick="editCustomer(${customerId})">Editar</button>` +
          `<button class="btn-action btn-delete" onclick="deleteCustomer(${customerId})">Excluir</button>` +
        `</div></td>` +
      `</tr>`;

    const newVehicleRow =
      `<tr>` +
        `<td>${escapeHtml(plate)}</td>` +
        `<td>${escapeHtml(model)}</td>` +
        `<td>${escapeHtml(brand)}</td>` +
        `<td>-</td>` +
        `<td>-</td>` +
        `<td>${escapeHtml(name)}</td>` +
        `<td>-</td>` +
        `<td>${escapeHtml(phone || '-')}</td>` +
        `<td><div class="action-buttons">` +
          `<button class="btn-action btn-edit" onclick="editVehicle('${escapeHtml(plate)}')">Editar</button>` +
          `<button class="btn-action btn-delete" onclick="deleteVehicle('${escapeHtml(plate)}')">Excluir</button>` +
        `</div></td>` +
      `</tr>`;

    localStorage.setItem('dihmec_customers_html', customerHtml + newCustomerRow);
    localStorage.setItem('dihmec_vehicles_html',  vehicleHtml  + newVehicleRow);
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

  // Cadastra um novo usuario via /api/register (apenas super admin).
  // Apos o sucesso, dispara um pull para atualizar o cache local com
  // o usuario recem-criado.
  async function register({ name, email, password }) {
    name = (name || '').trim();
    email = (email || '').trim().toLowerCase();
    if (!name || !email || !password) throw new Error('Preencha todos os campos.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail invalido.');
    validatePasswordComplexity(password);
    const passwordHash = await hashPassword(password);
    const data = await apiFetch('/api/register', {
      method: 'POST',
      body: { name, email, passwordHash },
    });
    await syncPull();
    return data;
  }

  // ---------- Reset de senha ----------
  // O servidor gera/valida o token. O cliente continua responsavel
  // por disparar o e-mail (via EmailJS) e por receber o token informado
  // pelo usuario. Util via console caso alguem precise reativar a UI de
  // recuperacao de senha no futuro.
  async function requestPasswordReset(email) {
    email = (email || '').trim().toLowerCase();
    if (!email) throw new Error('Informe o e-mail.');
    const data = await apiFetch('/api/reset-request', {
      method: 'POST',
      body: { email },
    });
    let sentViaEmail = false;
    try {
      sentViaEmail = await sendResetEmailViaEmailJS({
        email: data.email, token: data.token, expiresAt: data.expiresAt,
      });
    } catch (e) {
      console.warn('[DIHMECAuth] Falha ao enviar e-mail via EmailJS:', e);
    }
    if (typeof window.DIHMEC_SEND_RESET_EMAIL === 'function') {
      try { window.DIHMEC_SEND_RESET_EMAIL(data); }
      catch (e) { console.warn('[DIHMECAuth] Falha no hook DIHMEC_SEND_RESET_EMAIL:', e); }
    }
    return Object.assign({}, data, { sentViaEmail });
  }

  async function resetPasswordWithToken({ email, token, newPassword }) {
    email = (email || '').trim().toLowerCase();
    token = String(token || '').trim();
    if (!email || !token) throw new Error('Informe e-mail e token.');
    validatePasswordComplexity(newPassword);
    const passwordHash = await hashPassword(newPassword);
    await apiFetch('/api/reset-confirm', {
      method: 'POST',
      body: { email, token, passwordHash },
    });
    return true;
  }

  // ---------- Console helpers de emergencia ----------
  // Sem efeito local — agora a fonte da verdade eh o servidor. Mantemos
  // a funcao exposta para nao quebrar integracoes antigas: ela apenas
  // dispara um reset request no backend.
  async function emergencyResetPassword(email, newPassword) {
    email = String(email || '').trim().toLowerCase();
    validatePasswordComplexity(newPassword);
    const { token } = await apiFetch('/api/reset-request', {
      method: 'POST', body: { email },
    });
    return resetPasswordWithToken({ email, token, newPassword });
  }

  async function bootstrapSuperAdmin(email/* , password, name */) {
    email = String(email || '').trim().toLowerCase();
    if (!isSuperAdminEmail(email))
      throw new Error('E-mail ' + email + ' nao esta na lista de super admins.');
    // O servidor ja semeia os super admins com a senha padrao
    // (lib/db.js#DEFAULT_SUPER_ADMIN_PASSWORD). Esta funcao virou
    // apenas um stub para compatibilidade com chamadas antigas.
    return true;
  }

  async function login({ email, password }) {
    email = (email || '').trim().toLowerCase();
    if (!email || !password) throw new Error('Informe e-mail e senha.');
    const passwordHash = await hashPassword(password);
    const data = await apiFetch('/api/login', {
      method: 'POST',
      body: { email, passwordHash },
    });
    const session = {
      name: data.name,
      email: data.email,
      role: data.role,
      token: data.token,
      expiresAt: data.expiresAt,
      ts: Date.now(),
    };
    setSession(session);
    // Apos logar, puxa o estado completo do servidor para esta maquina.
    await syncPull();
    return session;
  }

  async function logout() {
    try { await apiFetch('/api/logout', { method: 'POST' }); }
    catch (e) { /* segue mesmo se a invalidacao do token falhar */ }
    clearSession();
    window.location.href = '/index.html';
  }

  function isLoggedIn() {
    return !!getSession();
  }

  // O servidor (lib/db.js#ensureSuperAdmins) eh quem semeia/promove os
  // super admins de forma idempotente em toda inicializacao do schema.
  // Aqui mantemos um stub para nao quebrar chamadas antigas e — por
  // garantia — corrigimos o cache local caso ele tenha entrado em
  // inconsistencia (ex.: dado antigo de localStorage).
  function ensureSuperAdmins() {
    const session = getSession();
    if (session && isSuperAdminEmail(session.email) && session.role !== 'superadmin') {
      session.role = 'superadmin';
      try { localStorage.setItem(STORAGE_SESSION, JSON.stringify(session)); } catch (e) {}
    }
  }
  const ensureSuperAdminPlaceholder = ensureSuperAdmins;

  function pendingSetupEmails() {
    return getUsers()
      .filter((u) => u.needsPasswordSetup && isSuperAdminEmail(u.email))
      .map((u) => u.email);
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
      background: #1f1f23; border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.55);
      padding: 28px 28px 24px; color: #e8e8e8;
      transition: max-width .25s ease;
      border: 1px solid #2c2c33;
    }
    .auth-card.wide { max-width: 560px; }
    .auth-card h2 {
      margin: 0 0 4px; font-size: 22px; font-weight: 700;
      color: #f5f5f5;
    }
    .auth-card p.auth-sub {
      margin: 0 0 20px; color: #a0a0a8; font-size: 13px;
    }

    /* Banner DIHMEC dentro do modal */
    .auth-banner {
      position: relative;
      margin: -28px -28px 20px;
      padding: 16px 22px 10px;
      border-radius: 16px 16px 0 0;
      background:
        radial-gradient(ellipse at 20% 0%, rgba(196, 30, 30,0.10), transparent 60%),
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
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .auth-banner-mark svg {
      width: 140px; height: auto; max-height: 76px;
      display: block;
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
      color: #ff6b6b; font-size: 11px; font-weight: 700;
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
      display: flex; background: #16161a; border-radius: 10px;
      padding: 4px; margin-bottom: 18px;
      border: 1px solid #2c2c33;
    }
    .auth-tab {
      flex: 1; padding: 8px 12px; text-align: center;
      cursor: pointer; border-radius: 8px; font-size: 13px; font-weight: 600;
      color: #a0a0a8; transition: all .2s ease;
      border: none; background: transparent;
    }
    .auth-tab.active { background: #2a2a32; color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
    .auth-field { margin-bottom: 12px; }
    .auth-field label {
      display: block; font-size: 12px; font-weight: 600; color: #b0b0b8;
      margin-bottom: 6px;
    }
    .auth-field input,
    .auth-field textarea {
      width: 100%; padding: 10px 12px; border: 1px solid #3a3a42;
      border-radius: 8px; font-size: 14px; font-family: inherit;
      background: #16161a; color: #f0f0f0; outline: none;
      transition: border-color .2s ease, box-shadow .2s ease;
    }
    .auth-field input::placeholder,
    .auth-field textarea::placeholder { color: #5a5a62; }
    .auth-field input:focus,
    .auth-field textarea:focus {
      border-color: #c41e1e;
      box-shadow: 0 0 0 3px rgba(196, 30, 30, 0.18);
    }
    .auth-field input[type=date] { color-scheme: dark; }
    .auth-plate-status {
      margin-top: 6px; font-size: 11px; font-weight: 500;
      display: none;
    }
    .auth-plate-status.show { display: block; }
    .auth-plate-status.found { color: #6dd58c; }
    .auth-plate-status.missing { color: #ffb54a; }

    /* Link "Esqueci minha senha" e tela de reset */
    .auth-link {
      background: none; border: none; cursor: pointer;
      color: #ff6b6b; font-size: 12px; font-weight: 600;
      margin-top: 10px; padding: 4px 0;
      font-family: inherit; text-align: center;
      width: 100%; display: block;
    }
    .auth-link:hover { text-decoration: underline; color: #ff8a8a; }
    .auth-back {
      background: none; border: none; cursor: pointer;
      color: #a0a0a8; font-size: 12px; font-weight: 500;
      padding: 4px 0; margin-bottom: 8px;
      font-family: inherit; display: inline-flex; align-items: center; gap: 4px;
    }
    .auth-back:hover { color: #f0f0f0; }
    .auth-token-box {
      background: rgba(255,255,255,0.04);
      border: 1px dashed #3a3a42;
      border-radius: 8px; padding: 10px 12px;
      margin: 10px 0; font-size: 12px; color: #e0e0e0;
    }
    .auth-token-box strong {
      display: block; font-family: 'Courier New', monospace;
      font-size: 22px; letter-spacing: 4px;
      color: #ffb54a; text-align: center;
      margin-top: 4px;
    }
    .auth-token-box small {
      display: block; margin-top: 6px; color: #80808a; font-size: 10px;
    }
    .auth-pwd-hint {
      font-size: 11px; color: #80808a; margin-top: 4px;
      line-height: 1.4;
    }
    .auth-pwd-hint.ok { color: #6dd58c; }
    .auth-pwd-hint.bad { color: #ffb54a; }

    /* Aviso de setup inicial de senha */
    .auth-setup-notice {
      display: none;
      background: rgba(255,181,74,0.12);
      border: 1px solid rgba(255,181,74,0.35);
      border-radius: 8px;
      padding: 10px 12px;
      color: #ffb54a;
      font-size: 12px; line-height: 1.45;
      margin-bottom: 14px;
    }
    .auth-setup-notice.show { display: block; }
    .auth-setup-notice strong { color: #ffd28a; }
    .auth-setup-notice .auth-setup-emails {
      display: block; margin-top: 4px;
      color: #fff; font-family: 'Courier New', monospace; font-size: 11px;
    }
    .auth-submit {
      width: 100%; margin-top: 8px;
      padding: 11px 14px; border: none; border-radius: 8px;
      background: #c41e1e; color: #fff; font-size: 14px; font-weight: 600;
      cursor: pointer; transition: background .2s ease;
      font-family: inherit;
    }
    .auth-submit:hover { background: #a01818; }
    .auth-submit:disabled { opacity: 0.6; cursor: not-allowed; }
    .auth-error {
      display: none; margin: 8px 0 0;
      padding: 8px 10px; background: rgba(220, 53, 69, 0.15); color: #ff8a8a;
      border: 1px solid rgba(220, 53, 69, 0.35);
      border-radius: 6px; font-size: 12px;
    }
    .auth-error.show { display: block; }
    .auth-success {
      display: none; margin: 8px 0 0;
      padding: 8px 10px; background: rgba(40, 167, 69, 0.15); color: #6dd58c;
      border: 1px solid rgba(40, 167, 69, 0.35);
      border-radius: 6px; font-size: 12px;
    }
    .auth-success.show { display: block; }
    .auth-hint {
      margin-top: 12px; font-size: 11px; color: #6a6a72; text-align: center;
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
      background: #c41e1e; color: #fff; padding: 2px 8px;
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

    /* Agendamento (tema escuro) */
    .sched-grid {
      display: grid; gap: 12px; grid-template-columns: 1fr 1fr;
    }
    .sched-grid .auth-field { margin-bottom: 0; }
    .sched-slots {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
      margin-top: 4px;
    }
    .sched-slot {
      padding: 8px 4px; border: 1px solid #3a3a42; border-radius: 6px;
      background: #16161a; cursor: pointer; font-size: 12px; font-weight: 500;
      font-family: inherit; text-align: center; color: #e0e0e6;
      transition: all .15s ease;
    }
    .sched-slot:hover:not(.booked):not(:disabled) {
      border-color: #c41e1e; background: #2a1f17;
    }
    .sched-slot.selected {
      background: #c41e1e; color: #fff; border-color: #c41e1e;
      box-shadow: 0 2px 6px rgba(196, 30, 30, 0.4);
    }
    .sched-slot.booked, .sched-slot:disabled {
      background: #232328; color: #5a5a62; cursor: not-allowed;
      text-decoration: line-through; border-color: #2c2c33;
    }
    .sched-empty {
      grid-column: 1 / -1; color: #80808a; font-size: 12px;
      text-align: center; padding: 12px;
    }
    .sched-legend {
      display: flex; gap: 12px; font-size: 11px; color: #80808a;
      margin-top: 8px; justify-content: center; flex-wrap: wrap;
    }
    .sched-legend span { display: inline-flex; align-items: center; gap: 4px; }
    .sched-legend .dot {
      width: 10px; height: 10px; border-radius: 3px; display: inline-block;
    }
    .sched-legend .dot.free { background: #16161a; border: 1px solid #3a3a42; }
    .sched-legend .dot.sel { background: #c41e1e; }
    .sched-legend .dot.busy { background: #232328; }

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
    /* Lista horizontal de permissões por usuário */
    .admin-user-block {
      border: 1px solid #e8eaed; border-radius: 10px;
      padding: 12px 14px; margin-bottom: 10px; background: #fff;
    }
    .admin-user-header {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      margin-bottom: 10px; padding-bottom: 8px;
      border-bottom: 1px solid #f0f2f5;
    }
    .admin-user-header strong { font-size: 14px; color: #1a1d24; }
    .admin-user-header small { color: #80868b; font-size: 12px; margin-left: auto; }
    .admin-perms-row {
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .admin-perm-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px; border: 1px solid #e8eaed;
      border-radius: 999px; background: #fafafa;
      font-size: 12px; color: #5f6368; cursor: pointer;
      user-select: none;
      transition: background .15s ease, border-color .15s ease, color .15s ease;
    }
    .admin-perm-chip:hover { border-color: #c41e1e; background: #fff5f5; }
    .admin-perm-chip input[type=checkbox] {
      margin: 0; accent-color: #c41e1e; cursor: pointer;
    }
    .admin-perm-chip.checked {
      background: #c41e1e; border-color: #c41e1e; color: #fff;
    }
    .admin-perm-chip.checked:hover { background: #a01818; }
    .admin-perm-chip.disabled {
      opacity: 0.55; cursor: not-allowed;
    }
    .admin-perm-chip.disabled input { cursor: not-allowed; }
    .admin-role-badge {
      display: inline-block;
      background: #5f6368; color: #fff; padding: 1px 6px;
      border-radius: 999px; font-size: 9px; font-weight: 700;
      text-transform: uppercase; letter-spacing: .3px;
    }
    .admin-role-badge.super { background: #c41e1e; }
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
    .admin-btn.primary { background: #c41e1e; color: #fff; }
    .admin-btn.primary:hover { background: #a01818; }
    .admin-btn.secondary { background: #f0f2f5; color: #1a1d24; }
    .admin-btn.secondary:hover { background: #e8eaed; }

    /* Criar usuário (dentro do painel de Administração) */
    .admin-newuser {
      border: 1px solid #e8eaed; border-radius: 10px;
      padding: 12px 14px; margin-bottom: 14px; background: #fafafa;
    }
    .admin-newuser h3 {
      margin: 0 0 8px; font-size: 13px; font-weight: 700;
      color: #1a1d24; letter-spacing: .3px;
    }
    .admin-newuser-grid {
      display: grid; gap: 8px;
      grid-template-columns: 1.4fr 1.4fr 1fr auto;
      align-items: end;
    }
    .admin-newuser-grid label {
      display: block; font-size: 11px; font-weight: 600;
      color: #5f6368; margin-bottom: 4px;
    }
    .admin-newuser-grid input {
      width: 100%; padding: 8px 10px; border: 1px solid #e8eaed;
      border-radius: 6px; font-size: 13px; font-family: inherit;
      outline: none; background: #fff;
    }
    .admin-newuser-grid input:focus {
      border-color: #c41e1e;
      box-shadow: 0 0 0 3px rgba(196, 30, 30,0.10);
    }
    .admin-newuser-msg {
      margin-top: 8px; font-size: 12px; display: none;
    }
    .admin-newuser-msg.show { display: block; }
    .admin-newuser-msg.error { color: #b3261e; }
    .admin-newuser-msg.ok { color: #1e7e34; }
    @media (max-width: 640px) {
      .admin-newuser-grid { grid-template-columns: 1fr 1fr; }
    }
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
              <svg viewBox="0 0 260 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="DIHMEC">
                <defs>
                  <linearGradient id="auth-dihmec-metal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#e8e8e8"/>
                    <stop offset="100%" stop-color="#7a7a7a"/>
                  </linearGradient>
                </defs>
                <g opacity="0.22" fill="url(#auth-dihmec-metal)">
                  <g transform="rotate(30 130 70)">
                    <rect x="40" y="66" width="180" height="8" rx="1.5"/>
                    <path d="M 40 58 L 26 58 L 26 82 L 40 82 L 40 76 L 33 76 L 33 64 L 40 64 Z"/>
                    <path d="M 220 58 L 234 58 L 234 82 L 220 82 L 220 76 L 227 76 L 227 64 L 220 64 Z"/>
                  </g>
                  <g transform="rotate(-30 130 70)">
                    <rect x="40" y="66" width="180" height="8" rx="1.5"/>
                    <path d="M 40 58 L 26 58 L 26 82 L 40 82 L 40 76 L 33 76 L 33 64 L 40 64 Z"/>
                    <path d="M 220 58 L 234 58 L 234 82 L 220 82 L 220 76 L 227 76 L 227 64 L 220 64 Z"/>
                  </g>
                  <g transform="translate(130 70)">
                    <rect x="-15" y="-46" width="30" height="20" rx="2"/>
                    <rect x="-15" y="-24" width="30" height="2"/>
                    <rect x="-15" y="-19" width="30" height="2"/>
                    <rect x="-6" y="-13" width="12" height="32"/>
                    <ellipse cx="0" cy="24" rx="17" ry="7"/>
                  </g>
                </g>
                <text x="130" y="86"
                      text-anchor="middle"
                      font-family="Impact, 'Arial Narrow', Arial, sans-serif"
                      font-size="46"
                      font-weight="900"
                      font-style="italic"
                      letter-spacing="3"
                      fill="#ffffff"
                      style="paint-order:stroke;stroke:#000;stroke-width:1px;">DIHMEC</text>
              </svg>
            </div>
            <div class="auth-banner-info">
              <p>Mecânico · Injeção · Diesel · Flex · Multimarcas</p>
              <p class="auth-banner-phone">📞 (11) 99508-6683 Edimar</p>
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
          <button type="button" class="auth-tab active" data-tab="login" role="tab">Login</button>
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
              <div class="auth-plate-status" id="sched-plate-status"></div>
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
    const scheduleForm = overlay.querySelector('#auth-form-schedule');
    const loginError = overlay.querySelector('#auth-login-error');
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

    // Cache dos slots ja ocupados, obtido via /api/appointments (publico).
    // Eh atualizado ao abrir a aba "Agendar" e apos cada submit bem-sucedido.
    let bookedSlots = []; // [{date, time}]
    function slotIsBooked(date, time) {
      return bookedSlots.some((s) => s.date === date && s.time === time);
    }
    async function refreshBookedSlots() {
      try {
        const r = await fetch('/api/appointments');
        if (!r.ok) return;
        const data = await r.json();
        bookedSlots = Array.isArray(data.slots) ? data.slots : [];
      } catch (e) { /* offline — segue sem dados de slots */ }
    }

    function renderSlotsForDate(date) {
      const slots = generateTimeSlots();
      const selected = slotsContainer.dataset.selected || '';
      slotsContainer.innerHTML = '';
      if (!date) {
        slotsContainer.innerHTML = '<p class="sched-empty">Selecione uma data primeiro.</p>';
        return;
      }
      slots.forEach((time) => {
        const booked = slotIsBooked(date, time);
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

    // Indicador da placa: verifica se está cadastrada conforme o usuário digita
    const plateInput = overlay.querySelector('#sched-plate');
    const plateStatus = overlay.querySelector('#sched-plate-status');
    function updatePlateStatus() {
      const v = (plateInput.value || '').trim().toUpperCase();
      plateStatus.classList.remove('show', 'found', 'missing');
      if (!v) return;
      if (isPlateRegistered(v)) {
        plateStatus.textContent = '✓ Veículo cadastrado.';
        plateStatus.classList.add('show', 'found');
      } else {
        plateStatus.textContent = '⚠ Placa não cadastrada — será cadastrada junto com o agendamento.';
        plateStatus.classList.add('show', 'missing');
      }
    }
    plateInput.addEventListener('input', updatePlateStatus);
    plateInput.addEventListener('blur', updatePlateStatus);

    async function showView(which) {
      tabs.forEach((x) => x.classList.toggle('active', x.getAttribute('data-tab') === which));
      loginForm.style.display    = which === 'login'    ? '' : 'none';
      scheduleForm.style.display = which === 'schedule' ? '' : 'none';
      card.classList.toggle('wide', which === 'schedule');
      if (which === 'schedule') {
        await refreshBookedSlots();
        renderSlotsForDate(dateInput.value);
      }
      loginError.classList.remove('show');
      schedError.classList.remove('show');
      schedSuccess.classList.remove('show');
    }
    tabs.forEach((t) =>
      t.addEventListener('click', () => showView(t.getAttribute('data-tab')))
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

    // Cadastro publico desativado: apenas o super admin cria usuarios via
    // o painel de Administracao (botao "Criar usuario").

    scheduleForm.addEventListener('submit', async (e) => {
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
        schedError.textContent = 'Escolha um horario disponivel.';
        schedError.classList.add('show');
        return;
      }
      if (!name || !phone || !plate || !vehicle || !description) {
        schedError.textContent = 'Preencha todos os campos.';
        schedError.classList.add('show');
        return;
      }

      const submitBtn = scheduleForm.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      try {
        const r = await fetch('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, plate, vehicle, description, date, time }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (r.status === 409) {
            schedError.textContent = 'Este horario acabou de ser ocupado. Escolha outro.';
            await refreshBookedSlots();
            slotsContainer.dataset.selected = '';
            renderSlotsForDate(date);
          } else {
            schedError.textContent = data.error || 'Erro ao registrar agendamento.';
          }
          schedError.classList.add('show');
          return;
        }
        const cadastradoAgora = !!data.registered;
        const message = buildWhatsAppMessage(data.appointment || { name, phone, plate, vehicle, description, date, time });
        const url = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
        window.open(url, '_blank', 'noopener');
        schedSuccess.textContent = cadastradoAgora
          ? 'Veiculo cadastrado e agendamento registrado! Confirme o envio no WhatsApp.'
          : 'Agendamento registrado! Confirme o envio no WhatsApp.';
        schedSuccess.classList.add('show');
        scheduleForm.reset();
        dateInput.value = todayStr;
        slotsContainer.dataset.selected = '';
        await refreshBookedSlots();
        renderSlotsForDate(todayStr);
      } catch (err) {
        schedError.textContent = err.message || 'Erro de rede ao registrar agendamento.';
        schedError.classList.add('show');
      } finally {
        submitBtn.disabled = false;
      }
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

    const userBlocks = users.map((u) => {
      const isSuper = u.role === 'superadmin';
      const roleBadge = isSuper
        ? '<span class="admin-role-badge super">Super Admin</span>'
        : '<span class="admin-role-badge">Usuário</span>';
      const chips = menusEditable
        .map((m) => {
          const checked = u.permissions.includes(m.id);
          const disabled = isSuper;
          const cls = 'admin-perm-chip' +
            (checked ? ' checked' : '') +
            (disabled ? ' disabled' : '');
          return `
            <label class="${cls}">
              <input type="checkbox"
                     data-email="${escapeHtml(u.email)}"
                     data-menu="${escapeHtml(m.id)}"
                     ${checked ? 'checked' : ''}
                     ${disabled ? 'disabled' : ''} />
              <span>${escapeHtml(m.label)}</span>
            </label>
          `;
        })
        .join('');
      return `
        <div class="admin-user-block">
          <div class="admin-user-header">
            <strong>${escapeHtml(u.name)}</strong>
            ${roleBadge}
            <small>${escapeHtml(u.email)}</small>
          </div>
          <div class="admin-perms-row">${chips}</div>
        </div>
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
          <form class="admin-newuser" id="admin-newuser-form" autocomplete="off">
            <h3>Criar usuário</h3>
            <div class="admin-newuser-grid">
              <div>
                <label for="admin-new-name">Nome completo</label>
                <input type="text" id="admin-new-name" required />
              </div>
              <div>
                <label for="admin-new-email">E-mail</label>
                <input type="email" id="admin-new-email" required />
              </div>
              <div>
                <label for="admin-new-password">Senha (mín. 8, com maiúsc., número e especial)</label>
                <input type="password" id="admin-new-password" minlength="6" required />
              </div>
              <button type="submit" class="admin-btn primary">Criar</button>
            </div>
            <div class="admin-newuser-msg" id="admin-newuser-msg"></div>
          </form>

          ${users.length === 0
            ? '<p style="color:#5f6368;font-size:13px;margin:8px 0;">Nenhum usuário cadastrado ainda.</p>'
            : userBlocks}
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

    // Sincroniza visual do chip com o estado do checkbox
    overlay.addEventListener('change', (e) => {
      const cb = e.target;
      if (!cb.matches('.admin-perm-chip input[type=checkbox]')) return;
      const chip = cb.closest('.admin-perm-chip');
      if (chip) chip.classList.toggle('checked', cb.checked);
    });

    // Criar usuário
    const newUserForm = overlay.querySelector('#admin-newuser-form');
    const newUserMsg = overlay.querySelector('#admin-newuser-msg');
    newUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      newUserMsg.classList.remove('show', 'error', 'ok');
      const name = overlay.querySelector('#admin-new-name').value;
      const email = overlay.querySelector('#admin-new-email').value;
      const password = overlay.querySelector('#admin-new-password').value;
      const btn = newUserForm.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const u = await register({ name, email, password });
        newUserMsg.textContent = u.role === 'superadmin'
          ? 'Usuário criado como Super Admin.'
          : 'Usuário criado. Marque os menus liberados abaixo e clique em Salvar.';
        newUserMsg.classList.add('show', 'ok');
        // Recarrega o painel para refletir o novo usuário
        setTimeout(() => {
          overlay.remove();
          openAdminModal();
        }, 700);
      } catch (err) {
        newUserMsg.textContent = err.message || 'Erro ao criar usuário.';
        newUserMsg.classList.add('show', 'error');
      } finally {
        btn.disabled = false;
      }
    });

    overlay.querySelector('#admin-save-btn').addEventListener('click', async () => {
      const saveBtn = overlay.querySelector('#admin-save-btn');
      saveBtn.disabled = true;
      const checks = overlay.querySelectorAll('input[type=checkbox][data-email]');
      const byEmail = {};
      checks.forEach((c) => {
        if (c.disabled) return;
        const em = c.getAttribute('data-email');
        const m = c.getAttribute('data-menu');
        if (!byEmail[em]) byEmail[em] = [];
        if (c.checked) byEmail[em].push(m);
      });
      const status = overlay.querySelector('#admin-status');
      try {
        await Promise.all(Object.keys(byEmail).map((em) => setUserPermissions(em, byEmail[em])));
        status.textContent = 'Permissoes salvas.';
        status.style.color = '';
      } catch (err) {
        status.textContent = err.message || 'Falha ao salvar permissoes.';
        status.style.color = '#b3261e';
      }
      status.classList.add('show');
      setTimeout(() => status.classList.remove('show'), 2400);
      // Reaplicar no menu lateral imediatamente (caso o admin tenha mudado a si mesmo)
      applyMenuPermissions();
      saveBtn.disabled = false;
    });
  }

  async function requireAuth() {
    injectStyle();
    // Antes de qualquer leitura de dados, espera o pull inicial do
    // servidor para que o cache local esteja consistente.
    try { await syncReady(); } catch (e) {}
    ensureSuperAdminPlaceholder();
    if (isLoggedIn()) {
      renderUserBar();
      applyMenuPermissions();
      enforcePagePermission();
      return getSession();
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
    isPlateRegistered,
    getRegisteredPlates,
    MENUS,
    SUPER_ADMIN_EMAIL,
    SUPER_ADMIN_EMAILS,
    isSuperAdminEmail,
    validatePasswordComplexity,
    requestPasswordReset,
    resetPasswordWithToken,
    emergencyResetPassword,
    bootstrapSuperAdmin,
    ensureSuperAdmins,
    pendingSetupEmails,
    sendResetEmailViaEmailJS,
    loadEmailJS,
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
