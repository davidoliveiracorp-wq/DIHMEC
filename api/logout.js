import { ensureSchema, deleteSession, getSessionFromRequest } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureSchema();
    const session = await getSessionFromRequest(req);
    if (session) await deleteSession(session.token);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/logout]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
