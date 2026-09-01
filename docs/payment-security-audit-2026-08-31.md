# Auditoria de seguranca de pagamentos e reservas

Data: 31/08/2026

## Escopo

- Criacao de cobranca Pix e reserva temporaria.
- Confirmacao por webhook e conciliacao ativa com o Mercado Pago.
- Cancelamento, expiracao, estorno e remarcacao de reserva paga.
- Autenticacao, autorizacao, RLS, exposicao de credenciais e abuso das APIs.

## Resultado

O fluxo nao confia no navegador para determinar preco, usuario, status ou
confirmacao. O valor e calculado no banco, as credenciais ficam no servidor e
um pagamento so confirma a reserva depois de ser consultado diretamente no
Mercado Pago e conciliado com o pedido local.

As seguintes melhorias foram aplicadas durante esta auditoria:

- validacao obrigatoria de Pix, valor, moeda e referencia do pedido;
- bloqueio de reutilizacao de um pagamento vinculado a outro pedido;
- limite atomico para chamadas repetidas de sincronizacao;
- registro de eventos assinados que apontem para pedidos inexistentes;
- redacao adicional de tokens e chaves em mensagens de erro;
- validacao do ambiente tambem no cancelamento do pagamento;
- testes de tentativa de forjar reserva, pedido e pagamento pelo navegador.

## Controles verificados

- O Access Token, a assinatura do webhook e a chave secreta do Supabase nao
  aparecem no bundle publico.
- O webhook exige assinatura valida e rejeita repeticoes com timestamp antigo.
- O corpo do webhook e limitado a 64 KiB e os identificadores sao validados.
- O servidor consulta o pagamento no provedor; o corpo do webhook nao e fonte
  de verdade para o status financeiro.
- A criacao usa chave de idempotencia unica por pedido.
- Reservas, itens e pedido sao criados atomicamente, com preco obtido da tabela
  protegida do banco.
- Um horario ativo possui unicidade e bloqueio transacional contra concorrencia.
- Um aluno so consulta e altera objetos que pertencem a sua conta.
- Clientes autenticados nao podem inserir reservas, pedidos ou tentativas de
  pagamento, nem alterar campos financeiros diretamente.
- Pedidos pagos nao podem regredir para pendente ou falha.
- Uma compra com varios horarios so e confirmada quando todos os itens e valores
  permanecem consistentes.
- Remarcacao exige reserva e tentativa pagas, propriedade, antecedencia e vaga.
- Dados completos do pagador e payload bruto do provedor nao ficam disponiveis
  para o navegador.
- Dependencias de producao e desenvolvimento passaram no `npm audit`.

## Acoes obrigatorias antes da entrega

1. Revogar e gerar novamente toda credencial que tenha aparecido em conversa,
   captura de tela, anotacao compartilhada ou computador de terceiros.
2. Atualizar no Render apenas como segredo: `MERCADO_PAGO_ACCESS_TOKEN`,
   `MERCADO_PAGO_WEBHOOK_SECRET` e `SUPABASE_SECRET_KEY`.
3. Usar `MERCADO_PAGO_ENVIRONMENT=production`, `PAYMENT_PROVIDER=mercado_pago`,
   `ALLOW_LOCAL_PAYMENT_SIMULATION=false` e `ENABLE_TEST_BOOKING_TYPE=false`.
4. Definir `APP_BASE_URL=https://app.olimpioneto.com.br` e configurar o webhook
   de producao como `https://app.olimpioneto.com.br/api/webhooks/mercadopago`.
5. No Mercado Pago, habilitar somente o evento Pagamentos para esta integracao e
   realizar um pagamento real de baixo valor apos a rotacao.
6. Manter a instancia do Render sem spin down em producao e criar alertas para
   erros de webhook, `paid_needs_review`, HTTP 401/403 e falhas de conciliacao.
7. Ativar MFA no Mercado Pago, Render, Supabase, GitHub e e-mail do administrador.
8. Revisar mensalmente usuarios administradores, logs, pagamentos em revisao e
   atualizacoes de dependencias.

## Risco residual

Nenhum sistema conectado a internet pode receber garantia de risco zero. Ainda
permanecem riscos de comprometimento das contas administrativas, indisponibilidade
do Render/Mercado Pago/Supabase, abuso distribuido de rede e erro operacional na
configuracao dos segredos. Uma avaliacao externa com teste de penetracao em
producao continua recomendada antes de processar volume financeiro relevante.

## Evidencias executadas

- `npm --prefix frontend test`
- `npm --prefix frontend run test:payment-security`
- `npm --prefix frontend run test:security`
- `npm --prefix frontend run test:notifications`
- `npm --prefix frontend run lint`
- `npm --prefix frontend run build`
- `npm --prefix frontend audit --omit=dev`
- `npm --prefix frontend audit`
