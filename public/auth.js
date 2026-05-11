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

  async function register({ name, email, password }) {
    name = (name || '').trim();
    email = (email || '').trim().toLowerCase();
    if (!name || !email || !password) throw new Error('Preencha todos os campos.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
    validatePasswordComplexity(password);
    const users = getUsers();
    if (users.some((u) => u.email === email)) throw new Error('E-mail já cadastrado.');
    const role = isSuperAdminEmail(email) ? 'superadmin' : 'user';
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

  // ---------- Reset de senha ----------
  function requestPasswordReset(email) {
    email = (email || '').trim().toLowerCase();
    if (!email) throw new Error('Informe o e-mail.');
    const users = getUsers();
    const user = users.find((u) => u.email === email);
    if (!user) throw new Error('E-mail não cadastrado.');
    // Gera token de 6 dígitos
    const token = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + RESET_TOKEN_TTL_MS;
    localStorage.setItem(STORAGE_RESET, JSON.stringify({ email, token, expiresAt }));
    // Hook para envio real por e-mail (EmailJS, backend etc.). Se a integração
    // não estiver configurada, o caller exibe o token na tela.
    if (typeof window.DIHMEC_SEND_RESET_EMAIL === 'function') {
      try { window.DIHMEC_SEND_RESET_EMAIL({ email, token, expiresAt }); }
      catch (e) { console.warn('[DIHMECAuth] Falha ao enviar e-mail:', e); }
    }
    return { email, token, expiresAt };
  }

  async function resetPasswordWithToken({ email, token, newPassword }) {
    email = (email || '').trim().toLowerCase();
    token = String(token || '').trim();
    if (!email || !token) throw new Error('Informe e-mail e token.');
    validatePasswordComplexity(newPassword);
    const data = JSON.parse(localStorage.getItem(STORAGE_RESET) || 'null');
    if (!data) throw new Error('Nenhuma solicitação de reset ativa. Solicite um novo token.');
    if (Date.now() > data.expiresAt) {
      localStorage.removeItem(STORAGE_RESET);
      throw new Error('Token expirado. Solicite um novo.');
    }
    if (data.email !== email) throw new Error('E-mail não confere com a solicitação.');
    if (data.token !== token) throw new Error('Token inválido.');
    const users = getUsers();
    const user = users.find((u) => u.email === email);
    if (!user) throw new Error('Usuário não encontrado.');
    user.passwordHash = await hashPassword(newPassword);
    delete user.needsPasswordSetup;
    saveUsers(users);
    localStorage.removeItem(STORAGE_RESET);
    return true;
  }

  // ---------- Console helpers de emergência ----------
  async function emergencyResetPassword(email, newPassword) {
    email = String(email || '').trim().toLowerCase();
    validatePasswordComplexity(newPassword);
    const users = getUsers();
    const user = users.find((u) => u.email === email);
    if (!user) throw new Error('Usuário não encontrado em ' + email + '.');
    user.passwordHash = await hashPassword(newPassword);
    delete user.needsPasswordSetup;
    saveUsers(users);
    return true;
  }

  async function bootstrapSuperAdmin(email, password, name) {
    email = String(email || '').trim().toLowerCase();
    if (!isSuperAdminEmail(email))
      throw new Error('E-mail ' + email + ' não está na lista de super admins.');
    validatePasswordComplexity(password);
    const users = getUsers().filter((u) => u.email !== email);
    const passwordHash = await hashPassword(password);
    users.push({
      name: (name || email.split('@')[0]).trim(),
      email,
      passwordHash,
      role: 'superadmin',
      createdAt: Date.now(),
    });
    saveUsers(users);
    return true;
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

  function ensureSuperAdmins() {
    // Roda em toda inicialização. Faz duas coisas:
    //  1) Migra: usuários existentes em SUPER_ADMIN_EMAILS viram superadmin.
    //  2) Semente: cria os super admins que ainda não existem com um
    //     placeholder de senha inválido (precisará usar "Esqueci minha
    //     senha" no modal para definir a senha real). O passwordHash começa
    //     com "__SETUP__" — nenhum SHA-256 produz isso, então o login
    //     com qualquer senha falhará até que o reset seja concluído.
    const users = getUsers();
    let changed = false;

    // (1) Migração
    users.forEach((u) => {
      if (isSuperAdminEmail(u.email) && u.role !== 'superadmin') {
        u.role = 'superadmin';
        changed = true;
      }
    });

    // (2) Semente
    SUPER_ADMIN_EMAILS.forEach((email) => {
      if (!users.some((u) => u.email === email)) {
        const rand = (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
                     (Math.random().toString(36) + '-' + Date.now());
        users.push({
          name: email.split('@')[0],
          email,
          passwordHash: '__SETUP__' + rand,
          role: 'superadmin',
          createdAt: Date.now(),
          needsPasswordSetup: true,
        });
        changed = true;
      }
    });

    if (changed) {
      saveUsers(users);
      const session = getSession();
      if (session && isSuperAdminEmail(session.email) && session.role !== 'superadmin') {
        session.role = 'superadmin';
        setSession(session);
      }
    }
  }
  // Alias para compatibilidade com chamadas anteriores
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

        <div class="auth-setup-notice" id="auth-setup-notice">
          <strong>⚠ Defina a senha inicial dos super admins</strong><br/>
          Os e-mails abaixo já estão cadastrados como super admin, mas ainda
          não têm senha. Clique em <strong>Esqueci minha senha</strong>,
          informe o e-mail e siga o fluxo para definir a senha.
          <span class="auth-setup-emails" id="auth-setup-emails"></span>
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
          <button type="button" class="auth-link" id="auth-forgot-btn">Esqueci minha senha</button>
        </form>

        <form id="auth-form-reset" novalidate style="display:none">
          <button type="button" class="auth-back" id="auth-reset-back">← Voltar ao login</button>
          <h2 style="margin:6px 0 4px">Recuperar senha</h2>
          <p class="auth-sub">Informe seu e-mail cadastrado para gerar um token de redefinição (válido por 15 min).</p>

          <div class="auth-field">
            <label for="auth-reset-email">E-mail cadastrado</label>
            <input type="email" id="auth-reset-email" autocomplete="email" required />
          </div>
          <button type="button" class="auth-submit" id="auth-reset-request">Gerar token</button>

          <div class="auth-token-box" id="auth-reset-token-box" style="display:none">
            Seu token de redefinição:
            <strong id="auth-reset-token-value">------</strong>
            <small id="auth-reset-token-note">Como o site é estático, o token é exibido aqui. Para receber por e-mail, integre EmailJS (peça que eu plugo).</small>
          </div>

          <div id="auth-reset-step2" style="display:none">
            <div class="auth-field" style="margin-top:14px">
              <label for="auth-reset-token-input">Token recebido</label>
              <input type="text" id="auth-reset-token-input" maxlength="6" inputmode="numeric" autocomplete="one-time-code" />
            </div>
            <div class="auth-field">
              <label for="auth-reset-newpwd">Nova senha</label>
              <input type="password" id="auth-reset-newpwd" autocomplete="new-password" />
              <p class="auth-pwd-hint">Mín. 8 caracteres · letra maiúscula · número · caractere especial (! @ # $ % * ?)</p>
            </div>
            <div class="auth-field">
              <label for="auth-reset-confirm">Confirmar nova senha</label>
              <input type="password" id="auth-reset-confirm" autocomplete="new-password" />
            </div>
            <button type="submit" class="auth-submit">Redefinir senha</button>
          </div>

          <div class="auth-error" id="auth-reset-error"></div>
          <div class="auth-success" id="auth-reset-success"></div>
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
    const resetForm = overlay.querySelector('#auth-form-reset');

    // Mostra aviso se algum super admin ainda está sem senha
    const pendingEmails = pendingSetupEmails();
    if (pendingEmails.length) {
      const notice = overlay.querySelector('#auth-setup-notice');
      overlay.querySelector('#auth-setup-emails').textContent = pendingEmails.join(' · ');
      notice.classList.add('show');
    }
    const scheduleForm = overlay.querySelector('#auth-form-schedule');
    const loginError = overlay.querySelector('#auth-login-error');
    const resetError = overlay.querySelector('#auth-reset-error');
    const resetSuccess = overlay.querySelector('#auth-reset-success');
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

    function showView(which) {
      tabs.forEach((x) => x.classList.toggle('active', x.getAttribute('data-tab') === which));
      loginForm.style.display    = which === 'login'    ? '' : 'none';
      resetForm.style.display    = which === 'reset'    ? '' : 'none';
      scheduleForm.style.display = which === 'schedule' ? '' : 'none';
      card.classList.toggle('wide', which === 'schedule');
      if (which === 'schedule') renderSlotsForDate(dateInput.value);
      loginError.classList.remove('show');
      resetError.classList.remove('show');
      resetSuccess.classList.remove('show');
      schedError.classList.remove('show');
      schedSuccess.classList.remove('show');
    }
    tabs.forEach((t) =>
      t.addEventListener('click', () => showView(t.getAttribute('data-tab')))
    );

    // Esqueci minha senha
    overlay.querySelector('#auth-forgot-btn').addEventListener('click', () => {
      overlay.querySelector('#auth-reset-token-box').style.display = 'none';
      overlay.querySelector('#auth-reset-step2').style.display = 'none';
      overlay.querySelector('#auth-reset-email').value =
        overlay.querySelector('#auth-login-email').value || '';
      showView('reset');
    });
    overlay.querySelector('#auth-reset-back').addEventListener('click', () => {
      showView('login');
    });

    // Solicitar token
    overlay.querySelector('#auth-reset-request').addEventListener('click', () => {
      resetError.classList.remove('show');
      resetSuccess.classList.remove('show');
      const email = overlay.querySelector('#auth-reset-email').value;
      try {
        const r = requestPasswordReset(email);
        overlay.querySelector('#auth-reset-token-value').textContent = r.token;
        overlay.querySelector('#auth-reset-token-box').style.display = 'block';
        overlay.querySelector('#auth-reset-step2').style.display = 'block';
        overlay.querySelector('#auth-reset-token-input').value = r.token;
        overlay.querySelector('#auth-reset-newpwd').focus();
      } catch (err) {
        resetError.textContent = err.message || 'Erro ao solicitar token.';
        resetError.classList.add('show');
      }
    });

    // Redefinir senha
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      resetError.classList.remove('show');
      resetSuccess.classList.remove('show');
      const email = overlay.querySelector('#auth-reset-email').value;
      const token = overlay.querySelector('#auth-reset-token-input').value;
      const newPwd = overlay.querySelector('#auth-reset-newpwd').value;
      const confirm = overlay.querySelector('#auth-reset-confirm').value;
      if (newPwd !== confirm) {
        resetError.textContent = 'As senhas não conferem.';
        resetError.classList.add('show');
        return;
      }
      try {
        await resetPasswordWithToken({ email, token, newPassword: newPwd });
        resetSuccess.textContent = 'Senha redefinida! Faça login com a nova senha.';
        resetSuccess.classList.add('show');
        setTimeout(() => {
          overlay.querySelector('#auth-login-email').value = email.trim().toLowerCase();
          overlay.querySelector('#auth-login-password').value = '';
          showView('login');
        }, 1200);
      } catch (err) {
        resetError.textContent = err.message || 'Erro ao redefinir senha.';
        resetError.classList.add('show');
      }
    });

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

      // Se a placa nao estiver cadastrada, registra cliente + veiculo junto
      let cadastradoAgora = false;
      if (!isPlateRegistered(plate)) {
        const ok = window.confirm(
          'A placa ' + plate + ' não está cadastrada.\n\n' +
          'Deseja prosseguir e cadastrá-la junto com o agendamento?'
        );
        if (!ok) {
          schedError.textContent = 'Agendamento cancelado: cadastre a placa antes de continuar.';
          schedError.classList.add('show');
          return;
        }
        registerVehicleFromSchedule({ name, phone, plate, vehicle });
        cadastradoAgora = true;
      }

      const appointment = { name, phone, plate, vehicle, description, date, time, ts: Date.now() };
      list.push(appointment);
      saveAppointments(list);

      const message = buildWhatsAppMessage(appointment);
      const url = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
      window.open(url, '_blank', 'noopener');

      schedSuccess.textContent = cadastradoAgora
        ? 'Veículo cadastrado e agendamento registrado! Confirme o envio no WhatsApp.'
        : 'Agendamento registrado! Confirme o envio no WhatsApp.';
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
