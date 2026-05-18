import { sql } from '@vercel/postgres';
import { createHash, randomBytes } from 'node:crypto';

// Mantemos a estrutura mais simples possivel para minimizar mudancas no
// front-end existente:
//   * `kv`        — espelha o localStorage (dihmec_users, dihmec_permissions,
//                  dihmec_appointments, dihmec_customers_html, ...)
//   * `sessions`  — tokens emitidos no login para autenticar /api/*
export const SUPER_ADMIN_EMAILS = ['dasioli@gmail.com', 'edisioli@gmail.com'];
export const DEFAULT_SUPER_ADMIN_PASSWORD = 'Dgey@8384';
export const DEFAULT_USER_PERMISSIONS = ['cadastro-cliente', 'checklist', 'nova-os'];
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

let _schemaReady = null;
export function ensureSchema() {
  if (!_schemaReady) {
    _schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS sessions_email_idx ON sessions(email)`;
      await ensureSuperAdmins();
    })().catch((err) => {
      _schemaReady = null;
      throw err;
    });
  }
  return _schemaReady;
}

export function sha256(input) {
  return createHash('sha256').update(String(input)).digest('hex');
}

export function isSuperAdminEmail(email) {
  return SUPER_ADMIN_EMAILS.includes(String(email || '').trim().toLowerCase());
}

export async function getKV(key) {
  const r = await sql`SELECT value FROM kv WHERE key = ${key}`;
  return r.rows[0] ? r.rows[0].value : null;
}

export async function setKV(key, value) {
  await sql`
    INSERT INTO kv (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

export async function deleteKV(key) {
  await sql`DELETE FROM kv WHERE key = ${key}`;
}

export async function listKV() {
  const r = await sql`SELECT key, value FROM kv`;
  return r.rows;
}

export async function getUsers() {
  const raw = await getKV('dihmec_users');
  try { return JSON.parse(raw || '[]'); } catch (e) { return []; }
}

export async function saveUsers(users) {
  await setKV('dihmec_users', JSON.stringify(users));
}

export async function getPermissions() {
  const raw = await getKV('dihmec_permissions');
  try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
}

export async function savePermissions(perms) {
  await setKV('dihmec_permissions', JSON.stringify(perms));
}

// Cria/promove os super admins idempotentemente. Tambem RESETA a senha
// dos super admins quando a constante DEFAULT_SUPER_ADMIN_PASSWORD muda
// — comparamos um seedTag (hash curto da senha padrao) salvo em cada
// usuario com o tag atual. Se for diferente, sobrescreve passwordHash
// e atualiza o tag. Isso garante que mexer no constante produza efeito
// imediato no banco, sem perder senhas alteradas manualmente (que tem
// seedTag === tag atual ate alguem trocar a constante de novo).
export async function ensureSuperAdmins() {
  const users = await getUsers();
  let changed = false;
  const passwordHash = sha256(DEFAULT_SUPER_ADMIN_PASSWORD);
  const seedTag = '__seed:' + passwordHash.slice(0, 12);

  for (const email of SUPER_ADMIN_EMAILS) {
    let user = users.find((u) => String(u.email || '').toLowerCase() === email);
    if (!user) {
      users.push({
        name: email.split('@')[0],
        email,
        passwordHash,
        role: 'superadmin',
        createdAt: Date.now(),
        seedTag,
      });
      changed = true;
      continue;
    }
    if (user.role !== 'superadmin') { user.role = 'superadmin'; changed = true; }
    if (user.seedTag !== seedTag) {
      user.passwordHash = passwordHash;
      user.seedTag = seedTag;
      delete user.needsPasswordSetup;
      changed = true;
    }
  }

  if (changed) await saveUsers(users);
}

export function newToken() {
  return randomBytes(32).toString('hex');
}

export async function createSession(email, role) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await sql`
    INSERT INTO sessions (token, email, role, expires_at)
    VALUES (${token}, ${email}, ${role}, ${expiresAt.toISOString()})
  `;
  return { token, expiresAt: expiresAt.getTime() };
}

export async function deleteSession(token) {
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

export async function getSessionFromRequest(req) {
  const auth = (req.headers.authorization || req.headers.Authorization || '').trim();
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const r = await sql`
    SELECT token, email, role, expires_at
    FROM sessions
    WHERE token = ${token} AND expires_at > NOW()
  `;
  return r.rows[0] || null;
}

// Wrapper p/ rotas que exigem login (qualquer usuario autenticado).
export async function requireAuth(req, res) {
  await ensureSchema();
  const session = await getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'Nao autenticado.' });
    return null;
  }
  return session;
}

// Wrapper p/ rotas que exigem superadmin.
export async function requireSuperAdmin(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return null;
  if (session.role !== 'superadmin') {
    res.status(403).json({ error: 'Acesso restrito a super admins.' });
    return null;
  }
  return session;
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}
