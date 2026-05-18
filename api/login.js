import {
  ensureSchema,
  getUsers,
  createSession,
  readJsonBody,
} from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureSchema();
    const { email, passwordHash } = await readJsonBody(req);
    const e = String(email || '').trim().toLowerCase();
    if (!e || !passwordHash) return res.status(400).json({ error: 'Informe e-mail e senha.' });

    const users = await getUsers();
    const user = users.find((u) => String(u.email || '').toLowerCase() === e);
    if (!user) return res.status(401).json({ error: 'E-mail nao encontrado.' });
    if (user.passwordHash !== passwordHash) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    const { token, expiresAt } = await createSession(user.email, user.role);
    return res.status(200).json({
      token,
      expiresAt,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch (err) {
    console.error('[api/login]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
