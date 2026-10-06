import {
  requireAuth,
  canManagePonto,
  getUsers,
  saveUsers,
  deleteSessionsByEmail,
  readJsonBody,
} from '../lib/db.js';

// Cadastro de funcionarios do controle de ponto. Funcionario eh um
// usuario com role 'funcionario': loga normalmente, mas so enxerga a aba
// "Controle de Ponto" e nao recebe nenhum dado do /api/sync.
//
//   GET    /api/funcionarios                          -> lista
//   POST   /api/funcionarios { name, login, cargo, passwordHash }
//   PUT    /api/funcionarios { email, name?, cargo?, ativo?, passwordHash? }
//   DELETE /api/funcionarios?email=
//
// O "login" pode ser um e-mail ou um nome de usuario simples (ex.:
// joao.silva) — muitos funcionarios nao tem e-mail. Ele eh gravado no
// campo `email` do usuario porque eh esse campo que o /api/login usa.
const LOGIN_RE = /^[a-z0-9._@-]{3,60}$/;

function publicView(u) {
  return {
    name: u.name,
    email: u.email,
    cargo: u.cargo || '',
    ativo: u.ativo !== false,
    createdAt: u.createdAt,
  };
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (!(await canManagePonto(session))) {
    return res.status(403).json({ error: 'Acesso restrito a gestores do ponto.' });
  }
  try {
    const users = await getUsers();
    const findFunc = (email) => users.find(
      (u) => String(u.email).toLowerCase() === email && u.role === 'funcionario');

    if (req.method === 'GET') {
      const list = users.filter((u) => u.role === 'funcionario').map(publicView);
      list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
      return res.status(200).json({ funcionarios: list });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim();
      const login = String(body.login || '').trim().toLowerCase();
      const cargo = String(body.cargo || '').trim().slice(0, 80);
      if (!name || !login || !body.passwordHash) {
        return res.status(400).json({ error: 'Informe nome, login e senha.' });
      }
      if (!LOGIN_RE.test(login)) {
        return res.status(400).json({ error: 'Login invalido. Use letras, numeros, ponto, hifen ou e-mail.' });
      }
      if (users.some((u) => String(u.email).toLowerCase() === login)) {
        return res.status(409).json({ error: 'Login ja cadastrado.' });
      }
      const user = {
        name,
        email: login,
        passwordHash: String(body.passwordHash),
        role: 'funcionario',
        cargo,
        ativo: true,
        createdAt: Date.now(),
      };
      users.push(user);
      await saveUsers(users);
      return res.status(200).json({ funcionario: publicView(user) });
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const user = findFunc(email);
      if (!user) return res.status(404).json({ error: 'Funcionario nao encontrado.' });
      if (body.name != null && String(body.name).trim()) user.name = String(body.name).trim();
      if (body.cargo != null) user.cargo = String(body.cargo).trim().slice(0, 80);
      if (body.passwordHash) user.passwordHash = String(body.passwordHash);
      if (typeof body.ativo === 'boolean') user.ativo = body.ativo;
      await saveUsers(users);
      // Desativado ou com senha trocada: derruba as sessoes abertas.
      if (user.ativo === false || body.passwordHash) await deleteSessionsByEmail(user.email);
      return res.status(200).json({ funcionario: publicView(user) });
    }

    if (req.method === 'DELETE') {
      const email = String((req.query || {}).email || '').trim().toLowerCase();
      if (!findFunc(email)) return res.status(404).json({ error: 'Funcionario nao encontrado.' });
      // Os registros de ponto sao mantidos (historico trabalhista).
      await saveUsers(users.filter((u) => String(u.email).toLowerCase() !== email));
      await deleteSessionsByEmail(email);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[api/funcionarios]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
