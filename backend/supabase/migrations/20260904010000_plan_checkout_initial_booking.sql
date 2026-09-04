-- A plan bought from the Agenda also holds and confirms the selected first lesson.
-- Plan purchases started from "Minhas Aulas" keep the existing credit-only flow.

CREATE OR REPLACE FUNCTION public.create_class_plan_booking_checkout(
  p_user_id uuid,
  p_plan_id uuid,
  p_booking_date date,
  p_start_hour integer,
  p_booking_type public.booking_type,
  p_professor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.class_plans%ROWTYPE;
  v_product public.pricing%ROWTYPE;
  v_session public.reservation_sessions%ROWTYPE;
  v_order_id uuid := gen_random_uuid();
  v_booking_id uuid := gen_random_uuid();
  v_expires_at timestamptz := now() + interval '30 minutes';
  v_occupied integer := 0;
  v_effective_professor uuid;
  v_description text;
  v_plan_snapshot jsonb;
  v_booking_snapshot jsonb;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao exclusiva do servidor.';
  END IF;

  PERFORM public.cleanup_expired_booking_holds();

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Usuario nao encontrado.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('class-plan-checkout:' || p_user_id::text, 0)
  );

  IF p_start_hour NOT BETWEEN 6 AND 22 THEN
    RAISE EXCEPTION 'Horario invalido.';
  END IF;
  IF p_booking_date < v_today OR p_booking_date > v_today + 31 THEN
    RAISE EXCEPTION 'Data fora da janela permitida para reservas.';
  END IF;
  IF (p_booking_date + make_time(p_start_hour, 0, 0))
       AT TIME ZONE 'America/Sao_Paulo' < now() + interval '2 hours'
  THEN
    RAISE EXCEPTION 'Escolha um horario com no minimo duas horas de antecedencia.';
  END IF;

  SELECT * INTO v_plan
  FROM public.class_plans plan_row
  WHERE plan_row.id = p_plan_id
    AND plan_row.active
  FOR SHARE;

  IF v_plan.id IS NULL
     OR v_plan.price_cents <= 0
     OR v_plan.credit_quantity NOT BETWEEN 1 AND 100
     OR v_plan.credit_modality NOT IN ('individual', 'dupla', 'grupo')
  THEN
    RAISE EXCEPTION 'Plano indisponivel para compra.';
  END IF;

  IF NOT public.is_credit_modality_compatible(v_plan.credit_modality, p_booking_type) THEN
    RAISE EXCEPTION 'O plano escolhido nao aceita este tipo de aula.';
  END IF;

  SELECT * INTO v_product
  FROM public.pricing product
  WHERE product.booking_type = p_booking_type
    AND product.active
  LIMIT 1;

  IF v_product.id IS NULL
     OR v_product.price_cents <= 0
     OR NOT v_product.requires_professor
  THEN
    RAISE EXCEPTION 'Este tipo de aula nao esta disponivel.';
  END IF;

  IF p_professor_id IS NOT NULL
     AND NOT public.has_role(p_professor_id, 'professor')
     AND NOT public.has_role(p_professor_id, 'admin')
  THEN
    RAISE EXCEPTION 'Professor indisponivel.';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM public.checkout_orders checkout_order
    WHERE checkout_order.user_id = p_user_id
      AND checkout_order.status = 'pending'
      AND checkout_order.expires_at > now()
  ) >= 3 THEN
    RAISE EXCEPTION 'Conclua ou cancele uma cobranca pendente antes de continuar.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_booking_date::text || ':' || p_start_hour::text, 0)
  );

  SELECT * INTO v_session
  FROM public.reservation_sessions session
  WHERE session.booking_date = p_booking_date
    AND session.start_hour = p_start_hour
    AND session.status = 'open'
  FOR UPDATE;

  IF v_session.id IS NOT NULL THEN
    SELECT COUNT(*)::integer INTO v_occupied
    FROM public.bookings booking
    WHERE booking.session_id = v_session.id
      AND booking.status IN ('pendente', 'confirmada')
      AND (
        booking.payment_status = 'pago'
        OR booking.status = 'confirmada'
        OR (
          booking.payment_status = 'pendente'
          AND booking.hold_expires_at > now()
        )
      );

    IF v_occupied = 0 THEN
      UPDATE public.reservation_sessions
      SET status = 'cancelled'
      WHERE id = v_session.id;
      v_session.id := NULL;
    END IF;
  END IF;

  IF v_session.id IS NULL THEN
    IF p_professor_id IS NULL THEN
      RAISE EXCEPTION 'Selecione o professor para a aula.';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.blocked_slots block
      WHERE block.block_date = p_booking_date
        AND block.start_hour = p_start_hour
        AND (block.professor_id IS NULL OR block.professor_id = p_professor_id)
    ) THEN
      RAISE EXCEPTION 'O horario esta bloqueado.';
    END IF;

    INSERT INTO public.reservation_sessions (
      booking_date, start_hour, professor_id, product_type,
      capacity, unit_price_cents
    )
    VALUES (
      p_booking_date, p_start_hour, p_professor_id, p_booking_type,
      v_product.student_capacity, v_product.price_cents
    )
    RETURNING * INTO v_session;
    v_occupied := 0;
  ELSE
    IF v_session.product_type <> p_booking_type THEN
      RAISE EXCEPTION 'Este horario ja possui outro tipo de aula.';
    END IF;
    IF v_session.professor_id IS NULL
       OR (
         NOT public.has_role(v_session.professor_id, 'professor')
         AND NOT public.has_role(v_session.professor_id, 'admin')
       )
    THEN
      RAISE EXCEPTION 'O professor desta aula nao esta mais disponivel.';
    END IF;
    IF p_professor_id IS NOT NULL
       AND v_session.professor_id IS DISTINCT FROM p_professor_id
    THEN
      RAISE EXCEPTION 'Este horario esta vinculado a outro professor.';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.blocked_slots block
      WHERE block.block_date = p_booking_date
        AND block.start_hour = p_start_hour
        AND (block.professor_id IS NULL OR block.professor_id = v_session.professor_id)
    ) THEN
      RAISE EXCEPTION 'O horario esta bloqueado.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings booking
    WHERE booking.session_id = v_session.id
      AND booking.user_id = p_user_id
      AND booking.status IN ('pendente', 'confirmada')
      AND (
        booking.payment_status = 'pago'
        OR booking.status = 'confirmada'
        OR (
          booking.payment_status = 'pendente'
          AND booking.hold_expires_at > now()
        )
      )
  ) THEN
    RAISE EXCEPTION 'Voce ja possui uma vaga neste horario.';
  END IF;
  IF v_occupied >= v_session.capacity THEN
    RAISE EXCEPTION 'A ultima vaga deste horario ja foi ocupada.';
  END IF;

  v_effective_professor := v_session.professor_id;
  v_description := v_plan.title || ' - ' || v_plan.credit_quantity::text
    || CASE WHEN v_plan.credit_quantity = 1 THEN ' aula' ELSE ' aulas' END
    || '. Primeira aula em ' || to_char(p_booking_date, 'DD/MM/YYYY')
    || ' as ' || lpad(p_start_hour::text, 2, '0') || ':00';
  v_plan_snapshot := jsonb_build_object(
    'plan_id', v_plan.id,
    'title', v_plan.title,
    'description', v_plan.description,
    'price_cents', v_plan.price_cents,
    'credit_quantity', v_plan.credit_quantity,
    'credit_modality', v_plan.credit_modality,
    'frequency_per_week', v_plan.frequency_per_week,
    'duration_months', v_plan.duration_months,
    'class_duration_min', v_plan.class_duration_min
  );
  v_booking_snapshot := jsonb_build_object(
    'booking_id', v_booking_id,
    'session_id', v_session.id,
    'booking_date', p_booking_date,
    'start_hour', p_start_hour,
    'booking_type', p_booking_type,
    'professor_id', v_effective_professor,
    'capacity', v_session.capacity
  );

  INSERT INTO public.checkout_orders (
    id, user_id, kind, status, currency, amount_cents, description,
    provider, idempotency_key, expires_at, metadata
  )
  VALUES (
    v_order_id, p_user_id, 'class_plan', 'pending', 'BRL',
    v_plan.price_cents, v_description, 'mercado_pago', v_order_id,
    v_expires_at,
    jsonb_build_object(
      'plan_snapshot', v_plan_snapshot,
      'initial_booking', v_booking_snapshot,
      'booking_ids', jsonb_build_array(v_booking_id),
      'session_ids', jsonb_build_array(v_session.id)
    )
  );

  INSERT INTO public.checkout_items (
    checkout_order_id, item_type, reference_id, description, quantity,
    unit_amount_cents, total_amount_cents, metadata
  )
  VALUES (
    v_order_id, 'class_plan', v_plan.id, v_description, 1,
    v_plan.price_cents, v_plan.price_cents, v_plan_snapshot
  );

  INSERT INTO public.bookings (
    id, session_id, user_id, professor_id, booking_date, start_hour,
    duration_hours, type, status, payment_status, payment_method,
    price_cents, amount_cents, checkout_order_id, credit_grant_id,
    hold_expires_at, confirmed_at, attended
  )
  VALUES (
    v_booking_id, v_session.id, p_user_id, v_effective_professor,
    p_booking_date, p_start_hour, 1, p_booking_type, 'pendente',
    'pendente', 'pix', v_session.unit_price_cents, v_session.unit_price_cents,
    v_order_id, NULL, v_expires_at, NULL, NULL
  );

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'booking_ids', jsonb_build_array(v_booking_id),
    'session_ids', jsonb_build_array(v_session.id),
    'amount_cents', v_plan.price_cents,
    'description', v_description,
    'expires_at', v_expires_at,
    'idempotency_key', v_order_id,
    'initial_booking', v_booking_snapshot
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A ultima vaga deste horario ja foi ocupada.';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_class_plan_booking_checkout(
  uuid, uuid, date, integer, public.booking_type, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_class_plan_booking_checkout(
  uuid, uuid, date, integer, public.booking_type, uuid
) TO service_role;

-- If Mercado Pago confirms only after the seat hold expires, the payment is
-- still honored without taking a slot from another student. The full plan
-- balance is granted and the student chooses another lesson.
CREATE OR REPLACE FUNCTION public.settle_reviewed_plan_checkout_without_booking(
  p_order_id uuid,
  p_paid_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.checkout_orders%ROWTYPE;
  v_intent jsonb;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao exclusiva do servidor.';
  END IF;

  SELECT * INTO v_order
  FROM public.checkout_orders checkout_order
  WHERE checkout_order.id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL
     OR v_order.kind <> 'class_plan'
     OR v_order.status <> 'paid_needs_review'
  THEN
    RAISE EXCEPTION 'Compra de plano em conferencia nao encontrada.';
  END IF;

  v_intent := v_order.metadata->'initial_booking';
  IF v_intent IS NULL OR jsonb_typeof(v_intent) <> 'object' THEN
    RAISE EXCEPTION 'Esta compra nao possui uma reserva inicial pendente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_attempts attempt
    WHERE attempt.checkout_order_id = v_order.id
      AND attempt.status = 'paid'
      AND attempt.payment_method = 'pix'
      AND attempt.amount_cents = v_order.amount_cents
  ) THEN
    RAISE EXCEPTION 'O Pix aprovado nao foi validado para esta compra.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings booking
    WHERE booking.checkout_order_id = v_order.id
      AND (
        booking.status = 'confirmada'
        OR booking.payment_status = 'pago'
        OR booking.credit_grant_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'A compra ja possui uma reserva confirmada e exige revisao manual.';
  END IF;

  UPDATE public.bookings
  SET status = 'cancelada',
      payment_status = 'expirado',
      hold_expires_at = NULL,
      confirmed_at = NULL,
      attended = NULL
  WHERE checkout_order_id = v_order.id;

  UPDATE public.checkout_orders
  SET metadata = (v_order.metadata - 'initial_booking' - 'booking_ids' - 'session_ids')
        || jsonb_build_object('unfulfilled_initial_booking', v_intent),
      status = 'paid',
      paid_at = COALESCE(p_paid_at, now())
  WHERE id = v_order.id
    AND status = 'paid_needs_review';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A compra mudou durante a conferencia.';
  END IF;

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_checkout_order_id
  )
  VALUES (
    v_order.user_id,
    'Escolha um novo horario',
    'Seu Pix foi confirmado e todos os creditos do plano estao disponiveis. '
      || 'Como a reserva anterior expirou, escolha uma nova data e horario na Agenda.',
    'booking_reschedule_required',
    v_order.id
  );

  RETURN jsonb_build_object(
    'status', 'paid',
    'booking_confirmed', false,
    'credits_only', true
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_reviewed_plan_checkout_without_booking(
  uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_reviewed_plan_checkout_without_booking(
  uuid, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_paid_plan_initial_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent jsonb;
  v_booking_id uuid;
  v_session_id uuid;
  v_booking public.bookings%ROWTYPE;
  v_session public.reservation_sessions%ROWTYPE;
  v_grant public.student_credit_grants%ROWTYPE;
  v_allocation_id uuid;
  v_occupied integer;
  v_balance integer;
  v_student_name text;
BEGIN
  IF NEW.kind <> 'class_plan'
     OR NEW.status <> 'paid'
     OR OLD.status = 'paid'
  THEN
    RETURN NEW;
  END IF;

  v_intent := NEW.metadata->'initial_booking';
  IF v_intent IS NULL OR jsonb_typeof(v_intent) <> 'object' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_booking_id := (v_intent->>'booking_id')::uuid;
    v_session_id := (v_intent->>'session_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'A intencao de reserva do plano e invalida.';
  END;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('credit-ledger:' || NEW.user_id::text, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      (v_intent->>'booking_date') || ':' || (v_intent->>'start_hour'),
      0
    )
  );

  SELECT * INTO v_booking
  FROM public.bookings booking
  WHERE booking.id = v_booking_id
    AND booking.checkout_order_id = NEW.id
    AND booking.user_id = NEW.user_id
  FOR UPDATE;

  SELECT * INTO v_session
  FROM public.reservation_sessions session
  WHERE session.id = v_session_id
  FOR UPDATE;

  SELECT * INTO v_grant
  FROM public.student_credit_grants grant_row
  WHERE grant_row.checkout_order_id = NEW.id
    AND grant_row.user_id = NEW.user_id
    AND grant_row.status = 'active'
  FOR UPDATE;

  IF v_booking.id IS NULL
     OR v_session.id IS NULL
     OR v_grant.id IS NULL
     OR v_booking.session_id IS DISTINCT FROM v_session.id
     OR v_booking.status <> 'pendente'
     OR v_booking.payment_status <> 'pendente'
     OR v_booking.duration_hours <> 1
     OR v_booking.price_cents IS DISTINCT FROM v_session.unit_price_cents
     OR v_booking.amount_cents IS DISTINCT FROM v_session.unit_price_cents
     OR v_booking.hold_expires_at IS NULL
     OR v_booking.hold_expires_at <= now()
     OR v_session.status <> 'open'
     OR v_session.booking_date IS DISTINCT FROM v_booking.booking_date
     OR v_session.start_hour IS DISTINCT FROM v_booking.start_hour
     OR v_session.product_type IS DISTINCT FROM v_booking.type
     OR v_session.professor_id IS DISTINCT FROM v_booking.professor_id
     OR v_intent->>'booking_id' IS DISTINCT FROM v_booking.id::text
     OR v_intent->>'session_id' IS DISTINCT FROM v_session.id::text
     OR v_intent->>'booking_date' IS DISTINCT FROM v_booking.booking_date::text
     OR v_intent->>'start_hour' IS DISTINCT FROM v_booking.start_hour::text
     OR v_intent->>'booking_type' IS DISTINCT FROM v_booking.type::text
     OR v_intent->>'professor_id' IS DISTINCT FROM v_booking.professor_id::text
     OR v_intent->>'capacity' IS DISTINCT FROM v_session.capacity::text
     OR NEW.metadata->'booking_ids' IS DISTINCT FROM jsonb_build_array(v_booking.id)
     OR NEW.metadata->'session_ids' IS DISTINCT FROM jsonb_build_array(v_session.id)
     OR NOT public.is_credit_modality_compatible(v_grant.modality, v_booking.type)
     OR NOT EXISTS (
       SELECT 1
       FROM public.payment_attempts attempt
       WHERE attempt.checkout_order_id = NEW.id
         AND attempt.status = 'paid'
         AND attempt.payment_method = 'pix'
         AND attempt.amount_cents = NEW.amount_cents
     )
  THEN
    RAISE EXCEPTION 'A vaga vinculada ao plano nao esta valida para confirmacao.';
  END IF;

  SELECT COUNT(*)::integer INTO v_occupied
  FROM public.bookings booking
  WHERE booking.session_id = v_session.id
    AND booking.status IN ('pendente', 'confirmada')
    AND (
      booking.payment_status = 'pago'
      OR booking.status = 'confirmada'
      OR (
        booking.payment_status = 'pendente'
        AND booking.hold_expires_at > now()
      )
    );

  IF v_occupied > v_session.capacity THEN
    RAISE EXCEPTION 'A capacidade da aula foi excedida.';
  END IF;

  UPDATE public.bookings
  SET status = 'confirmada',
      payment_status = 'pago',
      payment_method = 'credito_plano',
      price_cents = 0,
      amount_cents = 0,
      checkout_order_id = NULL,
      credit_grant_id = v_grant.id,
      hold_expires_at = NULL,
      confirmed_at = COALESCE(NEW.paid_at, now())
  WHERE id = v_booking.id;

  INSERT INTO public.student_credit_allocations (
    grant_id, user_id, booking_id
  )
  VALUES (v_grant.id, NEW.user_id, v_booking.id)
  RETURNING id INTO v_allocation_id;

  PERFORM public.append_credit_ledger_entry(
    NEW.user_id,
    v_grant.id,
    v_booking.id,
    NEW.id,
    'booking_debit',
    -1,
    'booking-debit:' || v_booking.id::text,
    'Primeira aula reservada junto com a compra do plano.',
    NEW.user_id,
    jsonb_build_object(
      'booking_date', v_booking.booking_date,
      'start_hour', v_booking.start_hour,
      'booking_type', v_booking.type,
      'session_id', v_session.id,
      'allocation_id', v_allocation_id,
      'source', 'plan_checkout'
    )
  );

  SELECT COALESCE(SUM(ledger.credit_delta), 0)::integer INTO v_balance
  FROM public.student_credit_ledger ledger
  WHERE ledger.user_id = NEW.user_id
    AND EXISTS (
      SELECT 1
      FROM public.student_credit_grants grant_row
      WHERE grant_row.id = ledger.grant_id
        AND grant_row.status = 'active'
        AND grant_row.modality = v_grant.modality
    );

  UPDATE public.notifications
  SET
    title = 'Plano e aula confirmados',
    body = 'Tudo certo! Recebemos seu Pix e ativamos '
      || v_grant.credits_granted::text
      || CASE WHEN v_grant.credits_granted = 1 THEN ' credito de aula.' ELSE ' creditos de aula.' END
      || ' Um credito foi usado na reserva inicial. Voce ainda tem '
      || v_balance::text
      || CASE WHEN v_balance = 1 THEN ' credito disponivel' ELSE ' creditos disponiveis' END
      || ' nesta modalidade.'
  WHERE user_id = NEW.user_id
    AND related_checkout_order_id = NEW.id
    AND kind = 'credits_granted';

  SELECT COALESCE(profile.full_name, 'Aluno') INTO v_student_name
  FROM public.profiles profile
  WHERE profile.id = NEW.user_id;
  v_student_name := COALESCE(v_student_name, 'Aluno');

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_booking_id, related_checkout_order_id
  )
  SELECT
    recipient.user_id,
    CASE WHEN v_session.capacity > 1 THEN 'Nova vaga confirmada' ELSE 'Nova aula confirmada' END,
    v_student_name || ' confirmou ' || to_char(v_booking.booking_date, 'DD/MM')
      || ' as ' || lpad(v_booking.start_hour::text, 2, '0') || ':00 com um credito do plano. '
      || CASE
        WHEN v_session.capacity > 1 THEN v_occupied::text || ' de ' || v_session.capacity::text
          || ' vagas estao ocupadas.'
        ELSE 'O horario ficou reservado exclusivamente.'
      END,
    'booking_new',
    v_booking.id,
    NEW.id
  FROM (
    SELECT role_row.user_id
    FROM public.user_roles role_row
    WHERE role_row.role = 'admin'
    UNION
    SELECT v_booking.professor_id
    WHERE v_booking.professor_id IS NOT NULL
  ) recipient
  WHERE recipient.user_id <> NEW.user_id;

  UPDATE public.checkout_orders
  SET metadata = (NEW.metadata - 'initial_booking')
        || jsonb_build_object('fulfilled_initial_booking', v_intent)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_paid_plan_initial_booking()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS checkout_orders_25_finalize_plan_initial_booking
ON public.checkout_orders;
CREATE TRIGGER checkout_orders_25_finalize_plan_initial_booking
  AFTER UPDATE OF status ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.finalize_paid_plan_initial_booking();
