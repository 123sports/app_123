# Backend

Artefatos de backend e infraestrutura.

Conteudo principal:

- `supabase/config.toml`: configuracao local do Supabase.
- `supabase/migrations/`: historico de migracoes SQL.
- `scripts/configure-supabase-local.ps1`: configuracao segura das credenciais locais.
- `scripts/bootstrap-admin.ps1`: criacao unica da primeira conta administradora.

Observacao: server functions e middlewares do TanStack Start ainda ficam em `frontend/src`, porque sao compilados junto com o runtime SSR da aplicacao.

O manifesto `render.yaml` permanece na raiz porque e o ponto de entrada padrao
usado pelo Render. Ele executa o build e o runtime localizados em `frontend/`.

## Estrutura no Supabase

- Organizacao: pertence a empresa e controla equipe, cobranca e projetos.
- Projeto `123sports-dev`: banco remoto usado pelo desenvolvimento local.
- Projeto `123sports-prod`: banco de producao, criado antes do lancamento.
- Schema `auth`: usuarios e sessoes, gerenciado pelo Supabase.
- Schema `public`: dados da aplicacao, criados pelas migrations.
- Schema `storage`: metadados de arquivos, gerenciado pelo Supabase.

Aluno, professor e administrador nao sao membros da organizacao Supabase. Esses
papeis pertencem a aplicacao e ficam em `public.user_roles`.

## Configuracao local

Na raiz do repositorio:

```powershell
powershell -ExecutionPolicy Bypass -File backend/scripts/configure-supabase-local.ps1
```

O script cria `frontend/.env.local`, que e ignorado pelo Git. A senha do banco
nao e armazenada nesse arquivo.

## Aplicacao das migrations

```powershell
npx supabase login
npm run supabase:link
npm run supabase:dry-run
npm run supabase:lint
npm run supabase:push
npm run supabase:config:push
```

Execute primeiro o dry run e revise o resultado. `supabase:push` nao inclui
`supabase/seeds/demo.sql`. Nunca use `supabase db reset --linked` em um projeto
remoto.

## Mercado Pago

O checkout Pix usa o endpoint de pagamentos no backend. Configure somente no
servidor:

```text
MERCADO_PAGO_ACCESS_TOKEN
MERCADO_PAGO_WEBHOOK_SECRET
PAYMENT_PROVIDER=mercado_pago
ALLOW_LOCAL_PAYMENT_SIMULATION=false
APP_BASE_URL=https://app-123-fx8f.onrender.com
```

No painel Mercado Pago, cadastre a notificacao de pagamentos em:

```text
https://app-123-fx8f.onrender.com/api/webhooks/mercadopago
```

O Access Token e a assinatura do webhook nunca podem usar o prefixo `VITE_`.
