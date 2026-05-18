import {
  ensureSchema,
  getUsers,
  saveUsers,
  getKV,
  deleteKV,
  readJsonBody,
} from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureSchema();
    const { email, token, passwordHash } = await readJsonBody(req);
    const e = String(email || '').trim().toLowerCase();
    const t = String(token || '').trim();
    if (!e || !t || !passwordHash) {
      return res.status(400).json({ error: 'Informe e-mail, token e nova senha.' });
    }
    const raw = await getKV('dihmec_reset_token__' + e);
    if (!raw) return res.status(400).json({ error: 'Nenhuma solicitacao ativa. Solicite novo token.' });
    let data;
    try { data = JSON.parse(raw); } catch (err) {
      await deleteKV('dihmec_reset_token__' + e);
      return res.status(400).json({ error: 'Token invalido.' });
    }
    if (Date.now() > data.expiresAt) {
      await deleteKV('dihmec_reset_token__' + e);
      return res.status(400).json({ error: 'Token expirado. Solicite novo.' });
    }
    if (data.token !== t) return res.status(400).json({ error: 'Token invalido.' });

    const users = await getUsers();
    const user = users.find((u) => String(u.email).toLowerCase() === e);
    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado.' });
    user.passwordHash = passwordHash;
    delete user.needsPasswordSetup;
    await saveUsers(users);
    await deleteKV('dihmec_reset_token__' + e);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/reset-confirm]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
