# Backend

Artefatos de backend e infraestrutura.

Conteudo principal:

- `supabase/config.toml`: configuracao local do Supabase.
- `supabase/migrations/`: historico de migracoes SQL.
- `scripts/configure-supabase-local.ps1`: configuracao segura das credenciais locais.

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
cd backend
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REFERENCE
npx supabase db push --dry-run
npx supabase db push
```

Execute primeiro o `--dry-run` e revise o resultado. Nunca use
`supabase db reset --linked` em um projeto remoto.
