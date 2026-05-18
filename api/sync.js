import {
  requireAuth,
  listKV,
  setKV,
  deleteKV,
  readJsonBody,
} from '../lib/db.js';

// Chaves do localStorage que NUNCA sao sincronizadas (cada navegador
// tem a sua propria).
const NEVER_SYNC = new Set([
  'dihmec_session', // token local
]);

// Chaves criticas: leitura via /api/sync esta liberada (qualquer usuario
// logado precisa enxergar usuarios/permissoes para o app funcionar) mas
// a ESCRITA exige superadmin. Isso impede que um usuario comum se
// promova a superadmin pelo console.
const ADMIN_WRITE_ONLY = new Set([
  'dihmec_users',
  'dihmec_permissions',
]);

// Tudo que persistimos no servidor comeca com este prefixo + nao esta
// na blacklist acima. Tambem ignoramos qualquer key que nao comece com
// 'dihmec_' por seguranca (impede um cliente comprometido de criar
// chaves arbitrarias no banco).
function isSyncable(key) {
  return typeof key === 'string'
    && key.startsWith('dihmec_')
    && !NEVER_SYNC.has(key);
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  try {
    if (req.method === 'GET') {
      const rows = await listKV();
      const out = {};
      for (const r of rows) {
        if (!isSyncable(r.key)) continue;
        // Tokens de reset sao por-email — nao expomos via /api/sync.
        if (r.key.startsWith('dihmec_reset_token')) continue;
        out[r.key] = r.value;
      }
      return res.status(200).json(out);
    }
    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      // Suporta tanto { key, value } unico quanto { items: [{key,value}, ...] }
      const items = Array.isArray(body.items) ? body.items : [body];
      const skipped = [];
      for (const item of items) {
        const k = String(item.key || '');
        if (!isSyncable(k)) { skipped.push({ key: k, reason: 'not-syncable' }); continue; }
        if (ADMIN_WRITE_ONLY.has(k) && session.role !== 'superadmin') {
          skipped.push({ key: k, reason: 'admin-only' });
          continue;
        }
        if (item.value === null || item.value === undefined) {
          await deleteKV(k);
        } else {
          await setKV(k, String(item.value));
        }
      }
      return res.status(200).json({ ok: true, count: items.length, skipped });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[api/sync]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
