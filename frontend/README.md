# Frontend

Aplicacao TanStack Start/React.

Conteudo principal:

- `src/routes/`: rotas file-based do TanStack Router.
- `src/components/`: componentes React reutilizaveis.
- `src/components/ui/`: componentes base de UI.
- `src/assets/` e `public/`: imagens, videos e arquivos publicos.
- `design-system/`: tokens, estilos e guia visual.

Comandos diretos desta pasta:

```sh
npm run dev
npm run build
npm run preview:local
```

## Login Local

Sem variaveis Supabase configuradas, o app usa um login local de desenvolvimento:

```txt
E-mail: local@123sports.dev
Senha: 123456
```

Na tela de login, selecione `Sou aluno` ou `Professor / Admin`; as duas opcoes usam
essa mesma credencial.

O perfil de aluno local ja vem preenchido para adiantar testes. Ao salvar o perfil,
os dados ficam no `localStorage` do navegador.

## Pix Local

No modo local, a agenda usa um gateway Pix simulado. Ele gera QR Code, Pix Copia e
Cola, reserva o horario por 30 minutos e permite simular a aprovacao. A aprovacao:

- confirma a reserva;
- registra o pedido em `checkout_orders`;
- registra cada horario em `checkout_items`;
- registra a tentativa em `payment_attempts`;
- cria um aviso interno para professor/admin;
- aparece em `/admin/pagamentos`.

O preco da reserva avulsa nunca e digitado pelo aluno. A agenda consulta a tabela
`pricing`, administrada em `Admin > Financeiro > Tabela de precos`, e calcula:

```txt
total = preco configurado por hora x quantidade de horarios selecionados
```

Os pacotes exibidos em `Minhas Aulas` sao outro produto. Eles usam `class_plans` e
o valor acordado do contrato (`class_contracts.agreed_price_cents`). O pagamento
Pix desses contratos ainda deve ser conectado depois da assinatura das partes; ele
nao usa a multiplicacao por horarios da agenda.

Os dados locais ficam no `localStorage`. A migracao equivalente para Supabase esta
em `backend/supabase/migrations/20260730120000_add_pix_checkout_foundation.sql`.

## Variaveis de Ambiente

Use `.env.example` como referencia para criar `frontend/.env.local`.

Variaveis `VITE_*` sao enviadas ao navegador e aceitam somente dados publicos.
`SUPABASE_SERVICE_ROLE_KEY`, `MERCADO_PAGO_ACCESS_TOKEN` e
`MERCADO_PAGO_WEBHOOK_SECRET` sao exclusivas do servidor e nunca devem receber o
prefixo `VITE_`.
