import {
  requireSuperAdmin,
  getPermissions,
  savePermissions,
  readJsonBody,
} from '../lib/db.js';

// GET  /api/permissions          -> { email: [menus] }
// PUT  /api/permissions          -> body { email, menus }
export default async function handler(req, res) {
  const session = await requireSuperAdmin(req, res);
  if (!session) return;
  try {
    if (req.method === 'GET') {
      const perms = await getPermissions();
      return res.status(200).json(perms);
    }
    if (req.method === 'PUT') {
      const { email, menus } = await readJsonBody(req);
      const e = String(email || '').trim().toLowerCase();
      if (!e) return res.status(400).json({ error: 'Informe o e-mail.' });
      const perms = await getPermissions();
      const set = new Set(Array.isArray(menus) ? menus : []);
      set.add('cadastro-cliente');
      perms[e] = Array.from(set);
      await savePermissions(perms);
      return res.status(200).json({ ok: true, email: e, menus: perms[e] });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[api/permissions]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
