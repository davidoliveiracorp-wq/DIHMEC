# Deploy — DIHMEC com banco Vercel Postgres

Este projeto agora sincroniza usuarios, permissoes e todos os cadastros
(clientes, veiculos, OS, etc.) com um banco Postgres da Vercel. Antes
era tudo `localStorage` (preso ao navegador). Agora qualquer maquina
loga em `dasioli@gmail.com` ou `edisioli@gmail.com` e ve os mesmos
dados.

## 1. Provisionar o banco (uma vez so)

1. Entre em https://vercel.com → seu projeto **DIHMEC**.
2. Aba **Storage** → **Create Database** → escolha **Postgres** (Neon).
3. Nome qualquer (ex.: `dihmec-db`), regiao mais proxima (sa-east-1 / us-east-1).
4. Clique em **Create**. A Vercel adiciona automaticamente as variaveis
   `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`,
   `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`
   ao projeto.
5. Em **Settings → Environment Variables**, confira que todas estao
   marcadas para os 3 ambientes (Production, Preview, Development).

## 2. Instalar dependencia e fazer deploy

```bash
npm install
git add -A
git commit -m "feat: migra storage para Vercel Postgres"
git push
```

A Vercel detecta o push, instala `@vercel/postgres` e publica.

> Local dev: `vercel env pull .env.local` antes de `npm run dev` para
> conectar ao banco de producao a partir da maquina. Sem isso, o `npm
> run dev` continua funcionando, mas qualquer chamada `/api/*` da
> erro de conexao.

## 3. Senha padrao dos super admins

Ao primeiro acesso a `/api/login` (ou qualquer outro `/api/*`), o
schema eh criado e os super admins sao semeados com a senha
`Dihmec@2026` (definida em `lib/db.js`).

Logue de qualquer maquina com:

- `dasioli@gmail.com` / `Dihmec@2026`
- `edisioli@gmail.com` / `Dihmec@2026`

> Apos logar pela primeira vez em uma maquina nova, a tela puxa todos
> os clientes, veiculos e OS do banco. Cada novo cadastro/edicao
> tambem eh enviado em tempo real para o banco (debounce 250ms).

## 4. Como funciona

### Camadas

- **`lib/db.js`** — helper compartilhado. Cria tabelas (`kv` e
  `sessions`), semeia super admins, valida Bearer tokens.
- **`api/login.js`** / **`api/logout.js`** / **`api/me.js`** —
  autenticacao baseada em token (Bearer).
- **`api/register.js`** — cadastra usuarios (so super admin pode).
- **`api/permissions.js`** — GET/PUT de permissoes (so super admin).
- **`api/reset-request.js`** + **`api/reset-confirm.js`** — fluxo de
  recuperacao de senha (UI removida do modal mas API disponivel).
- **`api/sync.js`** — espelha o `localStorage` no banco. GET retorna
  todos os blocos; PUT grava um ou varios. Bloqueia escrita em
  `dihmec_users`/`dihmec_permissions` para nao-super-admins.
- **`api/appointments.js`** — endpoint publico p/ o formulario
  "Agendar" do modal de login. Auto-cadastra cliente+veiculo se a
  placa nao existir.
- **`public/sync.js`** — carregado em `<head>` antes de auth.js. Faz
  patch do `localStorage.setItem/removeItem` para empurrar mudancas
  ao backend (debounced) e puxa todos os dados no inicio da sessao.

### Esquema do banco

```sql
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
```

Tudo o que antes era chave `localStorage` (ex.:
`dihmec_customers_html`, `dihmec_users`, `dihmec_permissions`,
`dihmec_appointments`, ...) vira uma linha em `kv`. Estrutura ficou
identica a do front-end, entao a migracao foi minima.

### Chaves NAO sincronizadas

- `dihmec_session` — token local de cada navegador (nunca sai da maquina).

## 5. Limitacoes conhecidas (MVP)

- **Concorrencia simples (last-write-wins).** Se dois admins editam o
  mesmo cliente ao mesmo tempo, o ultimo a salvar vence. Mudancas em
  blobs distintos (ex.: um edita produtos, outro edita clientes) nao
  conflitam.
- **Sem auditoria.** Nao gravamos quem fez o que. Se precisar,
  adicionar coluna `actor TEXT` em `kv` e logar nas mutacoes.
- **EmailJS continua opcional.** Como antes, se nao configurar, o
  token de reset eh exibido na tela (o fluxo de "Esqueci a senha" foi
  removido do modal mas a API segue disponivel via console).
