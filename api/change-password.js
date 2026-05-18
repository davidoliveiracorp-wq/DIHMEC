import {
  requireAuth,
  getUsers,
  saveUsers,
  readJsonBody,
} from '../lib/db.js';

// POST /api/change-password
// Corpo: { targetEmail?, oldPasswordHash?, newPasswordHash }
//
// Regras:
//   * Usuario comum: pode alterar APENAS a propria senha, e precisa
//     informar a senha atual (oldPasswordHash).
//   * Super admin: pode alterar a propria senha (com a senha atual) OU
//     a senha de qualquer outro usuario (sem precisar da senha atual
//     dele — operacao administrativa).
//
// Apos alterar, removemos o `seedTag` do usuario para que
// `ensureSuperAdmins()` nao reverta a senha para a padrao na proxima
// chamada (a logica la so reseta usuarios que AINDA tem um seedTag,
// indicando que estao com a senha-padrao de uma versao anterior).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await requireAuth(req, res);
  if (!session) return;
  try {
    const body = await readJsonBody(req);
    const newPasswordHash = String(body.newPasswordHash || '');
    if (!newPasswordHash) return res.status(400).json({ error: 'Informe a nova senha.' });

    const target = String(body.targetEmail || session.email).trim().toLowerCase();
    const isSelf = target === String(session.email).toLowerCase();
    const isSuperAdmin = session.role === 'superadmin';

    if (!isSelf && !isSuperAdmin) {
      return res.status(403).json({ error: 'Apenas super admin pode alterar senha de outro usuario.' });
    }

    const users = await getUsers();
    const user = users.find((u) => String(u.email).toLowerCase() === target);
    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado.' });

    // Se for a propria senha, exige confirmacao da senha atual — mesmo
    // sendo super admin. Isso protege contra sessao roubada.
    if (isSelf) {
      const oldPasswordHash = String(body.oldPasswordHash || '');
      if (!oldPasswordHash) return res.status(400).json({ error: 'Informe a senha atual.' });
      if (user.passwordHash !== oldPasswordHash) {
        return res.status(401).json({ error: 'Senha atual incorreta.' });
      }
    }

    user.passwordHash = newPasswordHash;
    delete user.needsPasswordSetup;
    // Marca como senha alterada manualmente — `ensureSuperAdmins` preserva.
    delete user.seedTag;
    await saveUsers(users);

    return res.status(200).json({ ok: true, email: user.email });
  } catch (err) {
    console.error('[api/change-password]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
