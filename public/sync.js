(function () {
  'use strict';

  // Camada de sincronizacao entre o localStorage e o banco da Vercel.
  // Estrategia:
  //   * Toda chave 'dihmec_*' (exceto a sessao local) eh espelhada no
  //     banco via /api/sync.
  //   * No load da pagina, se houver sessao valida, buscamos todas as
  //     chaves do servidor e populamos o localStorage ANTES de auth.js e
  //     store.js inicializarem (ambos aguardam DIHMECSync.ready).
  //   * Toda chamada localStorage.setItem/removeItem das chaves
  //     sincronizadas dispara um PUT debounced (~250ms) para o servidor.

  const NEVER_SYNC = new Set(['dihmec_session', 'dihmec_reset_token']);
  function isSyncable(key) {
    return typeof key === 'string'
      && key.startsWith('dihmec_')
      && !NEVER_SYNC.has(key);
  }

  // Versoes originais (nao instrumentadas) — usadas pelo pull para
  // evitar loop de push.
  const origSet = Storage.prototype.setItem.bind(localStorage);
  const origRem = Storage.prototype.removeItem.bind(localStorage);

  function getToken() {
    try {
      const s = JSON.parse(localStorage.getItem('dihmec_session') || 'null');
      return (s && s.token) || null;
    } catch (e) { return null; }
  }

  function authHeaders() {
    const t = getToken();
    const h = { 'Content-Type': 'application/json' };
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  // ----- Push (com batch + debounce) -----
  const pendingValues = new Map(); // key -> value (string ou null p/ delete)
  let flushTimer = null;
  function schedulePush(key) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 250);
  }
  async function flush() {
    flushTimer = null;
    if (pendingValues.size === 0) return;
    const token = getToken();
    if (!token) return; // sem sessao, nada a sincronizar
    const items = Array.from(pendingValues.entries()).map(([key, value]) => ({ key, value }));
    pendingValues.clear();
    try {
      const r = await fetch('/api/sync', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ items }),
      });
      if (!r.ok && r.status === 401) {
        console.warn('[DIHMECSync] sessao expirada — fazendo logout local.');
        origRem('dihmec_session');
      }
    } catch (e) {
      console.warn('[DIHMECSync] falha ao enviar dados — sera reenviado na proxima mudanca.', e);
      // Recoloca os items para tentar de novo na proxima
      for (const it of items) {
        if (!pendingValues.has(it.key)) pendingValues.set(it.key, it.value);
      }
    }
  }

  function trackChange(key, value) {
    if (!isSyncable(key)) return;
    pendingValues.set(key, value);
    schedulePush(key);
  }

  // Patch do localStorage — todo setItem/removeItem em chave sincronizavel
  // gera um push ao servidor.
  Storage.prototype.setItem = function (key, value) {
    origSet(key, value);
    trackChange(key, String(value));
  };
  Storage.prototype.removeItem = function (key) {
    origRem(key);
    trackChange(key, null);
  };

  // ----- Pull -----
  async function pull() {
    const token = getToken();
    if (!token) return { skipped: true };
    try {
      const r = await fetch('/api/sync', { headers: authHeaders() });
      if (!r.ok) {
        if (r.status === 401) {
          console.warn('[DIHMECSync] sessao invalida — fazendo logout local.');
          origRem('dihmec_session');
        }
        return { error: r.status };
      }
      const data = await r.json();
      for (const [k, v] of Object.entries(data)) {
        if (v === null || v === undefined) continue;
        origSet(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      // Notifica quem estiver escutando (store.js re-aplica os tbodies)
      window.dispatchEvent(new CustomEvent('dihmec:synced', { detail: { keys: Object.keys(data) } }));
      return { ok: true, keys: Object.keys(data) };
    } catch (e) {
      console.warn('[DIHMECSync] falha no pull', e);
      return { error: 'network' };
    }
  }

  // Flush sincrono antes de fechar/recarregar — debounce eh curto (250ms)
  // mas se o usuario fechar a aba antes de expirar, perderia os ultimos
  // bytes. forcamos o flush aqui.
  window.addEventListener('beforeunload', () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; flush(); }
  });

  const ready = pull();

  window.DIHMECSync = {
    ready,
    pull,
    flush,
    isSyncable,
  };
})();
