# 123sports

Projeto separado em duas areas principais:

- `frontend/`: aplicacao TanStack Start/React, rotas, componentes, assets, design system e scripts de build/runtime.
- `backend/`: configuracao Supabase, migracoes SQL e infraestrutura de deploy relacionada ao backend.

TanStack Start e um framework full-stack. Por isso, alguns arquivos server-side que fazem parte do runtime SSR continuam dentro de `frontend/src`, como `server.ts`, `start.ts`, middlewares e `*.functions.ts`.

## Comandos

Execute pela raiz do projeto:

```sh
npm run dev
```

Sobe o servidor de desenvolvimento.

```sh
npm run build
```

Gera o build de producao em `frontend/.output`.

```sh
npm run preview:local
```

Faz build e sobe o preview local em `http://127.0.0.1:4173/`.

As credenciais Supabase podem ficar vazias durante o desenvolvimento local. Nesse modo,
a interface abre normalmente, mas auth, leituras/escritas reais no banco e storage ficam
desativados ate voce configurar `frontend/.env.local` com valores reais.

## Login Local

Quando `frontend/.env` estiver sem Supabase configurado, use:

```txt
E-mail: local@123sports.dev
Senha: 123456
```

Esse mesmo login serve para entrar como aluno ou como professor/admin. A escolha e feita
no seletor da tela de login.

O perfil local ja vem preenchido com dados de teste. Alteracoes feitas na tela
`/app/perfil` ficam salvas no `localStorage` do navegador.

Se quiser trocar porta ou host:

```sh
PORT=3000 HOST=127.0.0.1 npm run preview:local
```
