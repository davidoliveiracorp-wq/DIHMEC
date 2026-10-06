import { sql } from '@vercel/postgres';
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
//   POST   /api/funcionarios { name, login, passwordHash, ...perfil }
//   PUT    /api/funcionarios { email, newLogin?, name?, ativo?, passwordHash?, ...perfil }
//   DELETE /api/funcionarios?email=
//
// perfil = { cargo, cpf, telefone, matricula, admissao, jornada }
// jornada = { entrada, almoco_saida, almoco_retorno, saida } em 'HH:MM'
// (horario previsto — usado no saldo de horas do relatorio).
//
// O "login" pode ser um e-mail ou um nome de usuario simples (ex.:
// joao.silva) — muitos funcionarios nao tem e-mail. Ele eh gravado no
// campo `email` do usuario porque eh esse campo que o /api/login usa.
const LOGIN_RE = /^[a-z0-9._@-]{3,60}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const JORNADA_KEYS = ['entrada', 'almoco_saida', 'almoco_retorno', 'saida'];

function publicView(u) {
  return {
    name: u.name,
    email: u.email,
    cargo: u.cargo || '',
    cpf: u.cpf || '',
    telefone: u.telefone || '',
    matricula: u.matricula || '',
    admissao: u.admissao || '',
    jornada: u.jornada || null,
    ativo: u.ativo !== false,
    createdAt: u.createdAt,
  };
}

// Aplica os campos de perfil presentes no body. Retorna mensagem de erro
// ou null. Campos ausentes (undefined) nao sao alterados.
function applyProfile(user, body) {
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  if (body.cargo !== undefined) user.cargo = str(body.cargo, 80);
  if (body.cpf !== undefined) {
    const cpf = str(body.cpf, 20).replace(/\D/g, '');
    if (cpf && cpf.length !== 11) return 'CPF deve ter 11 digitos.';
    user.cpf = cpf;
  }
  if (body.telefone !== undefined) user.telefone = str(body.telefone, 20);
  if (body.matricula !== undefined) user.matricula = str(body.matricula, 30);
  if (body.admissao !== undefined) {
    const d = str(body.admissao, 10);
    if (d && !DATE_RE.test(d)) return 'Data de admissao invalida.';
    user.admissao = d;
  }
  if (body.jornada !== undefined) {
    const j = body.jornada || {};
    const out = {};
    for (const k of JORNADA_KEYS) {
      const v = str(j[k], 5);
      if (v && !TIME_RE.test(v)) return 'Horario da jornada invalido: ' + v;
      out[k] = v;
    }
    if (!!out.almoco_saida !== !!out.almoco_retorno) return 'Informe saida e retorno do almoco da jornada (ou deixe os dois vazios).';
    if (!!out.entrada !== !!out.saida) return 'Informe entrada e saida da jornada.';
    const seq = JORNADA_KEYS.map((k) => out[k]).filter(Boolean);
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] <= seq[i - 1]) return 'Horarios da jornada fora de ordem.';
    }
    user.jornada = seq.length ? out : null;
  }
  return null;
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (!(await canManagePonto(session))) {
    return res.status(403).json({ error: 'Acesso restrito a gestores do ponto.' });
  }
  try {
    const users = await getUsers();
    const loginTaken = (login) => users.some((u) => String(u.email).toLowerCase() === login);
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
      if (!name || !login || !body.passwordHash) {
        return res.status(400).json({ error: 'Informe nome, login e senha.' });
      }
      if (!LOGIN_RE.test(login)) {
        return res.status(400).json({ error: 'Login invalido. Use letras, numeros, ponto, hifen ou e-mail.' });
      }
      if (loginTaken(login)) return res.status(409).json({ error: 'Login ja cadastrado.' });
      const user = {
        name,
        email: login,
        passwordHash: String(body.passwordHash),
        role: 'funcionario',
        ativo: true,
        createdAt: Date.now(),
      };
      const err = applyProfile(user, body);
      if (err) return res.status(400).json({ error: err });
      users.push(user);
      await saveUsers(users);
      return res.status(200).json({ funcionario: publicView(user) });
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const user = findFunc(email);
      if (!user) return res.status(404).json({ error: 'Funcionario nao encontrado.' });

      // Troca de login: valida antes de mexer em qualquer coisa.
      const newLogin = body.newLogin == null ? email : String(body.newLogin).trim().toLowerCase();
      const renaming = newLogin !== email;
      if (renaming) {
        if (!LOGIN_RE.test(newLogin)) {
          return res.status(400).json({ error: 'Login invalido. Use letras, numeros, ponto, hifen ou e-mail.' });
        }
        if (loginTaken(newLogin)) return res.status(409).json({ error: 'Login ja cadastrado.' });
        // Registros orfaos (de um funcionario excluido com esse login)
        // colidiriam com a chave (email, dia) ao migrar o historico.
        const orphan = await sql`SELECT 1 FROM ponto WHERE email = ${newLogin} LIMIT 1`;
        if (orphan.rowCount) {
          return res.status(409).json({ error: 'Ja existem registros de ponto com esse login (funcionario excluido). Escolha outro.' });
        }
      }

      const err = applyProfile(user, body);
      if (err) return res.status(400).json({ error: err });
      if (body.name != null && String(body.name).trim()) user.name = String(body.name).trim();
      if (body.passwordHash) user.passwordHash = String(body.passwordHash);
      if (typeof body.ativo === 'boolean') user.ativo = body.ativo;
      if (renaming) {
        // Leva o historico de ponto junto para o login novo.
        await sql`UPDATE ponto SET email = ${newLogin} WHERE email = ${email}`;
        user.email = newLogin;
      }
      await saveUsers(users);
      // Login trocado, desativado ou senha nova: derruba as sessoes abertas.
      if (renaming || user.ativo === false || body.passwordHash) await deleteSessionsByEmail(email);
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
