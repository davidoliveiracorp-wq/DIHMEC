import { ensureSchema, getSessionFromRequest, getUsers } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureSchema();
    const session = await getSessionFromRequest(req);
    if (!session) return res.status(401).json({ error: 'Nao autenticado.' });
    const users = await getUsers();
    const user = users.find((u) => String(u.email).toLowerCase() === session.email);
    return res.status(200).json({
      email: session.email,
      role: session.role,
      name: user ? user.name : session.email.split('@')[0],
    });
  } catch (err) {
    console.error('[api/me]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
