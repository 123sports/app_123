
# Roadmap — Ajustes On Tennis

Vou entregar em **4 lotes** (aprovação uma vez, execução sequencial). Cada lote fecha um domínio pra minimizar retrabalho e migrations.

---

## Lote 1 — Agenda & Reservas (rápido)

1. **Ocultar nome do aluno na agenda** — apenas para outros alunos. Admin e professor continuam vendo. Alteração em `src/routes/_authenticated/app.agenda.tsx`: quando `booking.user_id !== currentUserId` e o usuário logado não é admin/professor, mostrar "Horário ocupado" no lugar do nome.
2. **Não mostrar nome do aluno em nenhum outro card público** (Match Aberto, cards de horário) — auditar e substituir por "Horário ocupado" quando não for o próprio usuário nem admin/professor.
3. **Remover limite de antecedência de reserva** — remover a checagem `booking_date > CURRENT_DATE + INTERVAL '31 days'` da função `validate_booking_window()` via migration. Manter só o bloqueio de datas passadas.

---

## Lote 2 — Contratos, Trio & Termo de Aceite

4. **Reorganizar menu de contratos no admin** — agrupar em submenu: **Contratos → [Contratos ativos, Planos, Templates, Termos, Configurações]**. Alteração em `src/routes/_authenticated/admin.tsx` (sidebar).
5. **Cadastro de trio — plano + grupo fixo**:
   - Migration: adicionar `modality` ('individual' | 'dupla' | 'trio') em `class_plans`, com `split_type` ('total' | 'per_student'). Nova tabela `student_groups` (id, name, kind='trio', created_by) + `student_group_members` (group_id, user_id).
   - UI admin: em `admin.aulas-planos.tsx` permitir criar plano tipo Trio; nova página `admin.grupos.tsx` para cadastrar grupos de 3 alunos.
   - UI aluno: exibir grupo do aluno no perfil; ao reservar, se aluno pertencer a grupo trio ativo, sugerir reserva conjunta.
6. **Termo de aceite versionado**:
   - Migration: tabela `terms_versions` (id, version, title, body_md, published_at, active) + `terms_acceptances` (user_id, terms_version_id, accepted_at). Trigger que marca `active=false` nas versões anteriores.
   - UI admin: página `admin.termos.tsx` (dentro do submenu Contratos) para criar/publicar nova versão.
   - UI usuário: modal bloqueante em `_authenticated/route.tsx` quando existe versão `active` sem `acceptance` do usuário.

---

## Lote 3 — Avaliações

7. **Editar avaliação de aluno** — em `admin.avaliacoes.tsx` (e/ou detalhe do aluno) adicionar botão "Editar" que abre o formulário com dados preenchidos e faz `UPDATE` em `student_evaluations`. RLS já permite admin/professor autor.

---

## Lote 4 — Lojinha (maior)

8. **Adicionar novos campos de produto**: `stock_quantity` (int), `category_id` (fk para nova tabela `marketplace_categories`), `sku` opcional. Migration + ajustes em `admin.loja.tsx`.
9. **Gestão de estoque**: decremento automático via trigger quando um pedido é confirmado; badge "Esgotado" quando `stock_quantity=0`; filtros por categoria dinâmica no admin.
10. **Carrinho de compras**:
    - Nova tabela `cart_items` (user_id, item_id, quantity) e `orders` + `order_items` (status: 'pendente' | 'confirmado' | 'cancelado' | 'entregue').
    - UI aluno: botão "Adicionar ao carrinho" em `app.loja.tsx`, ícone de carrinho no header com contador, página `app.carrinho.tsx` com checkout que gera uma ordem "pendente" e dispara mensagem no WhatsApp com o resumo.
    - UI admin: página `admin.loja-pedidos.tsx` para ver/confirmar/entregar pedidos.

---

## Fora do escopo desta rodada
- **Pagamento online da loja** — o checkout do carrinho gera pedido + link de WhatsApp; integração com Stripe/Paddle fica para quando você aprovar o provedor.

---

## Formato de entrega

Vou executar **Lote 1 agora** (rápido, sem migração pesada) e te devolver pra validar. Depois seguimos com 2, 3 e 4 na ordem. Se preferir outra ordem ou quiser tudo de uma vez, me diz.
