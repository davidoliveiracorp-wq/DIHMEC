import {
  ensureSchema,
  getUsers,
  setKV,
  readJsonBody,
} from '../lib/db.js';

const TTL_MS = 15 * 60 * 1000;

// Gera um token de reset para o e-mail informado. NAO requer autenticacao
// (afinal, o usuario esqueceu a senha). O cliente eh responsavel por
// disparar o e-mail via EmailJS — o servidor apenas guarda o token.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureSchema();
    const { email } = await readJsonBody(req);
    const e = String(email || '').trim().toLowerCase();
    if (!e) return res.status(400).json({ error: 'Informe o e-mail.' });

    const users = await getUsers();
    if (!users.some((u) => String(u.email).toLowerCase() === e)) {
      return res.status(404).json({ error: 'E-mail nao cadastrado.' });
    }
    const token = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + TTL_MS;
    await setKV(
      'dihmec_reset_token__' + e,
      JSON.stringify({ email: e, token, expiresAt })
    );
    return res.status(200).json({ email: e, token, expiresAt });
  } catch (err) {
    console.error('[api/reset-request]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
