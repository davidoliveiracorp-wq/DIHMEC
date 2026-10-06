import { sql } from '@vercel/postgres';
import {
  requireAuth,
  canManagePonto,
  getUsers,
  readJsonBody,
} from '../lib/db.js';

// Controle de ponto.
//
//   GET    /api/ponto?scope=hoje                -> registro de hoje do proprio usuario
//   GET    /api/ponto?from=&to=&email=          -> registros do periodo. Gestor ve
//                                                 qualquer funcionario (email vazio =
//                                                 todos); os demais so os proprios.
//   POST   /api/ponto  { tipo }                 -> marca o ponto (horario do servidor)
//   POST   /api/ponto  { tipo, manual: true,    -> marcacao manual (esqueceu de bater):
//                        dia, hora, motivo }       so preenche campo vazio, ate
//                                                  MANUAL_MAX_DIAS atras, fica pendente
//                                                  de aprovacao do gestor
//   PUT    /api/ponto  { aprovar: true,         -> gestor aprova a marcacao manual
//                        email, dia }
//   PUT    /api/ponto  { email, dia, entrada,   -> ajuste manual (gestor). Horarios
//                        almoco_saida, ...,        em 'HH:MM' (fuso de Sao Paulo) ou
//                        obs }                     null para limpar.
//   DELETE /api/ponto?email=&dia=               -> remove o registro do dia (gestor)
const TZ = 'America/Sao_Paulo';
const TIPOS = ['entrada', 'almoco_saida', 'almoco_retorno', 'saida'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MANUAL_MAX_DIAS = 7;

function todaySP() {
  // en-CA formata como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

const SELECT_COLS = `
  email,
  to_char(dia, 'YYYY-MM-DD') AS dia,
  to_char(entrada        AT TIME ZONE '${TZ}', 'HH24:MI') AS entrada,
  to_char(almoco_saida   AT TIME ZONE '${TZ}', 'HH24:MI') AS almoco_saida,
  to_char(almoco_retorno AT TIME ZONE '${TZ}', 'HH24:MI') AS almoco_retorno,
  to_char(saida          AT TIME ZONE '${TZ}', 'HH24:MI') AS saida,
  obs,
  ajustado_por,
  manual_campos,
  manual_motivo,
  manual_aprovado_por
`;

async function getRecord(email, dia) {
  const r = await sql.query(`SELECT ${SELECT_COLS} FROM ponto WHERE email = $1 AND dia = $2`, [email, dia]);
  return r.rows[0] || null;
}

// Regras de sequencia. O almoco eh opcional (meio periodo), mas se a
// saida para o almoco foi marcada, o retorno precisa vir antes da saida.
function validateNext(rec, tipo) {
  const r = rec || {};
  if (r.saida) return 'Saida do dia ja registrada.';
  if (tipo === 'entrada') return r.entrada ? 'Entrada ja registrada hoje.' : null;
  if (!r.entrada) return 'Registre a entrada primeiro.';
  if (tipo === 'almoco_saida') return r.almoco_saida ? 'Saida para almoco ja registrada.' : null;
  if (tipo === 'almoco_retorno') {
    if (!r.almoco_saida) return 'Registre a saida para almoco primeiro.';
    return r.almoco_retorno ? 'Retorno do almoco ja registrado.' : null;
  }
  if (tipo === 'saida') {
    if (r.almoco_saida && !r.almoco_retorno) return 'Registre o retorno do almoco primeiro.';
    return null;
  }
  return 'Tipo de marcacao invalido.';
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Valida a marcacao manual: campo ainda vazio, sequencia respeitada e
// horario em ordem cronologica com o que ja foi marcado no dia.
function validateManual(rec, tipo, hora) {
  const r = Object.assign({}, rec || {});
  if (r[tipo]) return 'Esse horario ja foi registrado neste dia. Peca ajuste ao gestor.';
  r[tipo] = hora;
  if (r.almoco_saida && !r.entrada) return 'Lance a entrada antes da saida para almoco.';
  if (r.almoco_retorno && !r.almoco_saida) return 'Lance a saida para almoco antes do retorno.';
  if (r.saida && !r.entrada) return 'Lance a entrada antes da saida.';
  if (r.saida && r.almoco_saida && !r.almoco_retorno) return 'Lance o retorno do almoco antes da saida.';
  const seq = TIPOS.map((t) => r[t]).filter(Boolean);
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] <= seq[i - 1]) return 'Horario fora de ordem com as marcacoes do dia.';
  }
  return null;
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  const me = String(session.email).toLowerCase();
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q.scope === 'hoje') {
        const dia = todaySP();
        return res.status(200).json({ dia, record: await getRecord(me, dia) });
      }
      const from = DATE_RE.test(q.from || '') ? q.from : todaySP();
      const to = DATE_RE.test(q.to || '') ? q.to : from;
      const manager = await canManagePonto(session);
      let email = String(q.email || '').trim().toLowerCase();
      if (!manager) email = me;
      const r = email
        ? await sql.query(
            `SELECT ${SELECT_COLS} FROM ponto WHERE dia BETWEEN $1 AND $2 AND email = $3 ORDER BY dia, email`,
            [from, to, email])
        : await sql.query(
            `SELECT ${SELECT_COLS} FROM ponto WHERE dia BETWEEN $1 AND $2 ORDER BY dia, email`,
            [from, to]);
      return res.status(200).json({ from, to, records: r.rows });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const { tipo } = body;
      if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de marcacao invalido.' });

      if (body.manual) {
        const dia = String(body.dia || '');
        const hora = String(body.hora || '');
        const motivo = String(body.motivo || '').trim().slice(0, 500);
        const hoje = todaySP();
        if (!DATE_RE.test(dia) || !TIME_RE.test(hora)) return res.status(400).json({ error: 'Informe data e horario.' });
        if (!motivo) return res.status(400).json({ error: 'Informe o motivo da marcacao manual.' });
        if (dia > hoje) return res.status(400).json({ error: 'Nao eh possivel lancar data futura.' });
        if (dia < addDays(hoje, -MANUAL_MAX_DIAS)) {
          return res.status(400).json({ error: `So eh possivel lancar ate ${MANUAL_MAX_DIAS} dias atras. Procure o gestor.` });
        }
        const nowHM = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
        if (dia === hoje && hora > nowHM) return res.status(400).json({ error: 'Nao eh possivel lancar horario futuro.' });
        const rec = await getRecord(me, dia);
        const err = validateManual(rec, tipo, hora);
        if (err) return res.status(409).json({ error: err });
        const campos = Array.from(new Set(String((rec && rec.manual_campos) || '').split(',').filter(Boolean).concat(tipo))).join(',');
        const motivos = [rec && rec.manual_motivo, `${tipo}: ${motivo}`].filter(Boolean).join(' | ').slice(0, 1000);
        // `tipo` validado contra TIPOS — seguro interpolar.
        const r = await sql.query(
          `INSERT INTO ponto (email, dia, ${tipo}, manual_campos, manual_motivo, updated_at)
           VALUES ($1, $2, ($2::date + $3::time) AT TIME ZONE '${TZ}', $4, $5, NOW())
           ON CONFLICT (email, dia) DO UPDATE
             SET ${tipo} = EXCLUDED.${tipo},
                 manual_campos = EXCLUDED.manual_campos,
                 manual_motivo = EXCLUDED.manual_motivo,
                 manual_aprovado_por = NULL,
                 updated_at = NOW()
             WHERE ponto.${tipo} IS NULL`,
          [me, dia, hora, campos, motivos]);
        if (r.rowCount === 0) return res.status(409).json({ error: 'Marcacao ja registrada.' });
        return res.status(200).json({ ok: true, dia, record: await getRecord(me, dia) });
      }

      const dia = todaySP();
      const err = validateNext(await getRecord(me, dia), tipo);
      if (err) return res.status(409).json({ error: err });
      // `tipo` ja foi validado contra a whitelist TIPOS — seguro interpolar.
      // O `WHERE ... IS NULL` evita sobrescrever num duplo clique.
      const r = await sql.query(
        `INSERT INTO ponto (email, dia, ${tipo}, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (email, dia) DO UPDATE
           SET ${tipo} = NOW(), updated_at = NOW()
           WHERE ponto.${tipo} IS NULL`,
        [me, dia]);
      if (r.rowCount === 0) return res.status(409).json({ error: 'Marcacao ja registrada.' });
      return res.status(200).json({ ok: true, dia, record: await getRecord(me, dia) });
    }

    if (req.method === 'PUT' || req.method === 'DELETE') {
      if (!(await canManagePonto(session))) {
        return res.status(403).json({ error: 'Apenas gestores podem ajustar o ponto.' });
      }
      const body = req.method === 'PUT' ? await readJsonBody(req) : (req.query || {});
      const email = String(body.email || '').trim().toLowerCase();
      const dia = String(body.dia || '');
      if (!email || !DATE_RE.test(dia)) return res.status(400).json({ error: 'Informe funcionario e data.' });

      if (req.method === 'PUT' && body.aprovar) {
        const r = await sql`
          UPDATE ponto SET manual_aprovado_por = ${me}, updated_at = NOW()
          WHERE email = ${email} AND dia = ${dia} AND manual_campos IS NOT NULL`;
        if (r.rowCount === 0) return res.status(404).json({ error: 'Nenhuma marcacao manual neste dia.' });
        return res.status(200).json({ ok: true, record: await getRecord(email, dia) });
      }

      if (req.method === 'DELETE') {
        await sql`DELETE FROM ponto WHERE email = ${email} AND dia = ${dia}`;
        return res.status(200).json({ ok: true });
      }

      const users = await getUsers();
      if (!users.some((u) => String(u.email).toLowerCase() === email)) {
        return res.status(404).json({ error: 'Funcionario nao encontrado.' });
      }
      const times = [];
      for (const t of TIPOS) {
        const v = body[t] == null || body[t] === '' ? null : String(body[t]);
        if (v !== null && !TIME_RE.test(v)) return res.status(400).json({ error: 'Horario invalido: ' + v });
        times.push(v);
      }
      const seq = times.filter(Boolean);
      for (let i = 1; i < seq.length; i++) {
        if (seq[i] <= seq[i - 1]) return res.status(400).json({ error: 'Horarios fora de ordem.' });
      }
      const obs = body.obs == null ? null : String(body.obs).slice(0, 500);
      // ($dia::date + $hora::time) AT TIME ZONE 'America/Sao_Paulo' converte
      // a hora local para timestamptz; NULL + date = NULL limpa o campo.
      const at = (n) => `($2::date + $${n}::time) AT TIME ZONE '${TZ}'`;
      await sql.query(
        `INSERT INTO ponto (email, dia, entrada, almoco_saida, almoco_retorno, saida, obs, ajustado_por, updated_at)
         VALUES ($1, $2, ${at(3)}, ${at(4)}, ${at(5)}, ${at(6)}, $7, $8, NOW())
         ON CONFLICT (email, dia) DO UPDATE SET
           entrada = EXCLUDED.entrada,
           almoco_saida = EXCLUDED.almoco_saida,
           almoco_retorno = EXCLUDED.almoco_retorno,
           saida = EXCLUDED.saida,
           obs = EXCLUDED.obs,
           ajustado_por = EXCLUDED.ajustado_por,
           manual_aprovado_por = CASE WHEN ponto.manual_campos IS NOT NULL
                                      THEN EXCLUDED.ajustado_por END,
           updated_at = NOW()`,
        [email, dia, ...times, obs, me]);
      return res.status(200).json({ ok: true, record: await getRecord(email, dia) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[api/ponto]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
