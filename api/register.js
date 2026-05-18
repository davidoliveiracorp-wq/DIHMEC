import {
  requireSuperAdmin,
  getUsers,
  saveUsers,
  getPermissions,
  savePermissions,
  isSuperAdminEmail,
  DEFAULT_USER_PERMISSIONS,
  readJsonBody,
} from '../lib/db.js';

// Cadastro de usuario — apenas super admin pode chamar (espelha o
// comportamento do painel "Administracao > Criar usuario").
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await requireSuperAdmin(req, res);
  if (!session) return;
  try {
    const { name, email, passwordHash } = await readJsonBody(req);
    const n = String(name || '').trim();
    const e = String(email || '').trim().toLowerCase();
    if (!n || !e || !passwordHash) return res.status(400).json({ error: 'Preencha todos os campos.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: 'E-mail invalido.' });

    const users = await getUsers();
    if (users.some((u) => String(u.email).toLowerCase() === e)) {
      return res.status(409).json({ error: 'E-mail ja cadastrado.' });
    }
    const role = isSuperAdminEmail(e) ? 'superadmin' : 'user';
    const user = { name: n, email: e, passwordHash, role, createdAt: Date.now() };
    users.push(user);
    await saveUsers(users);

    if (role !== 'superadmin') {
      const perms = await getPermissions();
      if (!perms[e]) {
        perms[e] = DEFAULT_USER_PERMISSIONS.slice();
        await savePermissions(perms);
      }
    }
    return res.status(200).json({ name: user.name, email: user.email, role: user.role });
  } catch (err) {
    console.error('[api/register]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
