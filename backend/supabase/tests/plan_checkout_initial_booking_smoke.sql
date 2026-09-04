BEGIN;

SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $smoke$
DECLARE
  v_user_id uuid;
  v_professor_id uuid;
  v_plan_id uuid;
  v_plan public.class_plans%ROWTYPE;
  v_booking_type public.booking_type;
  v_booking_date date;
  v_start_hour integer;
  v_hour integer;
  v_day_offset integer;
  v_hold jsonb;
  v_order_id uuid;
  v_booking_id uuid;
  v_grant_id uuid;
  v_balance integer;
  v_grant_notifications integer;
  v_purchase_entries integer;
BEGIN
  SELECT role_row.user_id INTO v_user_id
  FROM public.user_roles role_row
  JOIN public.profiles profile ON profile.id = role_row.user_id
  WHERE role_row.role = 'aluno'
    AND profile.phone IS NOT NULL
    AND (
      SELECT COUNT(*)
      FROM public.checkout_orders checkout_order
      WHERE checkout_order.user_id = role_row.user_id
        AND checkout_order.status = 'pending'
        AND checkout_order.expires_at > now()
    ) < 3
  ORDER BY role_row.user_id
  LIMIT 1;

  SELECT role_row.user_id INTO v_professor_id
  FROM public.user_roles role_row
  WHERE role_row.role = 'admin'
  ORDER BY role_row.user_id
  LIMIT 1;

  SELECT plan_row.id, product.booking_type
  INTO v_plan_id, v_booking_type
  FROM public.class_plans plan_row
  JOIN public.pricing product
    ON product.active
   AND product.requires_professor
   AND product.price_cents > 0
   AND (
     (plan_row.credit_modality = 'individual' AND product.booking_type = 'aula_individual')
     OR (plan_row.credit_modality = 'dupla' AND product.booking_type = 'aula_dupla')
     OR (
       plan_row.credit_modality = 'grupo'
       AND product.booking_type IN ('aula_trio', 'aula_quarteto')
     )
   )
  WHERE plan_row.active
    AND plan_row.price_cents > 0
    AND plan_row.credit_quantity BETWEEN 1 AND 100
  ORDER BY plan_row.credit_quantity DESC, plan_row.id, product.student_capacity
  LIMIT 1;

  SELECT * INTO v_plan
  FROM public.class_plans plan_row
  WHERE plan_row.id = v_plan_id;

  IF v_user_id IS NULL OR v_professor_id IS NULL OR v_plan.id IS NULL THEN
    RAISE EXCEPTION 'Smoke test requires one student, one admin and one active compatible plan.';
  END IF;

  FOR v_day_offset IN 7..30 LOOP
    FOR v_hour IN 6..22 LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM public.reservation_sessions session
        WHERE session.booking_date =
          (now() AT TIME ZONE 'America/Sao_Paulo')::date + v_day_offset
          AND session.start_hour = v_hour
          AND session.status = 'open'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.blocked_slots block
        WHERE block.block_date =
          (now() AT TIME ZONE 'America/Sao_Paulo')::date + v_day_offset
          AND block.start_hour = v_hour
          AND (block.professor_id IS NULL OR block.professor_id = v_professor_id)
      )
      THEN
        v_booking_date :=
          (now() AT TIME ZONE 'America/Sao_Paulo')::date + v_day_offset;
        v_start_hour := v_hour;
        EXIT;
      END IF;
    END LOOP;
    EXIT WHEN v_booking_date IS NOT NULL;
  END LOOP;

  IF v_booking_date IS NULL THEN
    RAISE EXCEPTION 'Smoke test could not find a free future slot.';
  END IF;

  v_hold := public.create_class_plan_booking_checkout(
    v_user_id,
    v_plan.id,
    v_booking_date,
    v_start_hour,
    v_booking_type,
    v_professor_id
  );
  v_order_id := (v_hold->>'order_id')::uuid;
  v_booking_id := (v_hold->'booking_ids'->>0)::uuid;

  INSERT INTO public.payment_attempts (
    checkout_order_id,
    provider,
    provider_order_id,
    provider_payment_id,
    payment_method,
    status,
    amount_cents,
    paid_at,
    provider_payload
  ) VALUES (
    v_order_id,
    'mercado_pago',
    'smoke-order-' || v_order_id::text,
    'smoke-payment-' || v_order_id::text,
    'pix',
    'paid',
    (v_hold->>'amount_cents')::integer,
    now(),
    '{}'::jsonb
  );

  UPDATE public.checkout_orders
  SET status = 'paid', paid_at = now()
  WHERE id = v_order_id AND status = 'pending';

  IF NOT EXISTS (
    SELECT 1
    FROM public.bookings booking
    WHERE booking.id = v_booking_id
      AND booking.user_id = v_user_id
      AND booking.booking_date = v_booking_date
      AND booking.start_hour = v_start_hour
      AND booking.type = v_booking_type
      AND booking.status = 'confirmada'
      AND booking.payment_status = 'pago'
      AND booking.payment_method = 'credito_plano'
      AND booking.checkout_order_id IS NULL
      AND booking.credit_grant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Paid plan did not confirm the selected initial booking.';
  END IF;

  SELECT grant_row.id INTO v_grant_id
  FROM public.student_credit_grants grant_row
  WHERE grant_row.checkout_order_id = v_order_id
    AND grant_row.user_id = v_user_id
    AND grant_row.status = 'active';

  SELECT COALESCE(SUM(ledger.credit_delta), 0)::integer INTO v_balance
  FROM public.student_credit_ledger ledger
  WHERE ledger.grant_id = v_grant_id;

  IF v_grant_id IS NULL OR v_balance <> v_plan.credit_quantity - 1 THEN
    RAISE EXCEPTION 'Paid plan balance does not reflect the initial booking debit.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.student_credit_allocations allocation
    WHERE allocation.grant_id = v_grant_id
      AND allocation.booking_id = v_booking_id
      AND allocation.user_id = v_user_id
      AND allocation.status = 'reserved'
  ) THEN
    RAISE EXCEPTION 'Initial booking has no reserved credit allocation.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.checkout_orders checkout_order
    WHERE checkout_order.id = v_order_id
      AND checkout_order.status = 'paid'
      AND NOT (checkout_order.metadata ? 'initial_booking')
      AND checkout_order.metadata ? 'fulfilled_initial_booking'
  ) THEN
    RAISE EXCEPTION 'Paid order did not seal the fulfilled booking intent.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications notification
    WHERE notification.user_id = v_user_id
      AND notification.related_booking_id = v_booking_id
      AND notification.kind = 'booking_confirmed'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.notifications notification
    JOIN public.user_roles role_row ON role_row.user_id = notification.user_id
    WHERE role_row.role = 'admin'
      AND notification.related_booking_id = v_booking_id
      AND notification.kind = 'booking_new'
  ) THEN
    RAISE EXCEPTION 'Initial booking notifications were not created for both audiences.';
  END IF;

  SELECT COUNT(*)::integer INTO v_grant_notifications
  FROM public.notifications notification
  WHERE notification.user_id = v_user_id
    AND notification.related_checkout_order_id = v_order_id
    AND notification.kind = 'credits_granted';

  SELECT COUNT(*)::integer INTO v_purchase_entries
  FROM public.student_credit_ledger ledger
  WHERE ledger.grant_id = v_grant_id
    AND ledger.entry_type = 'purchase_grant';

  UPDATE public.checkout_orders
  SET status = 'paid_needs_review'
  WHERE id = v_order_id AND status = 'paid';

  IF NOT EXISTS (
    SELECT 1
    FROM public.student_credit_grants grant_row
    WHERE grant_row.id = v_grant_id
      AND grant_row.status = 'under_review'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.checkout_orders checkout_order
    WHERE checkout_order.id = v_order_id
      AND checkout_order.metadata ? 'credit_payment_review'
  ) THEN
    RAISE EXCEPTION 'Payment review did not freeze the plan credits.';
  END IF;

  UPDATE public.checkout_orders
  SET status = 'paid'
  WHERE id = v_order_id AND status = 'paid_needs_review';

  IF NOT EXISTS (
    SELECT 1
    FROM public.student_credit_grants grant_row
    WHERE grant_row.id = v_grant_id
      AND grant_row.status = 'active'
  ) OR EXISTS (
    SELECT 1
    FROM public.checkout_orders checkout_order
    WHERE checkout_order.id = v_order_id
      AND checkout_order.metadata ? 'credit_payment_review'
  ) THEN
    RAISE EXCEPTION 'Approved review did not safely restore the plan credits.';
  END IF;

  IF v_grant_notifications <> (
    SELECT COUNT(*)
    FROM public.notifications notification
    WHERE notification.user_id = v_user_id
      AND notification.related_checkout_order_id = v_order_id
      AND notification.kind = 'credits_granted'
  ) OR v_purchase_entries <> (
    SELECT COUNT(*)
    FROM public.student_credit_ledger ledger
    WHERE ledger.grant_id = v_grant_id
      AND ledger.entry_type = 'purchase_grant'
  ) THEN
    RAISE EXCEPTION 'Payment review resolution duplicated credits or notifications.';
  END IF;

  UPDATE public.checkout_orders
  SET status = 'refunded', refunded_at = now()
  WHERE id = v_order_id AND status = 'paid';

  SELECT COALESCE(SUM(ledger.credit_delta), 0)::integer INTO v_balance
  FROM public.student_credit_ledger ledger
  WHERE ledger.grant_id = v_grant_id;

  IF v_balance <> 0 OR NOT EXISTS (
    SELECT 1
    FROM public.student_credit_grants grant_row
    WHERE grant_row.id = v_grant_id
      AND grant_row.status = 'refunded'
      AND grant_row.refunded_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.bookings booking
    WHERE booking.id = v_booking_id
      AND booking.status = 'cancelada'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.student_credit_allocations allocation
    WHERE allocation.booking_id = v_booking_id
      AND allocation.status = 'revoked'
  ) THEN
    RAISE EXCEPTION 'Full refund did not revoke credits and release the future lesson.';
  END IF;
END;
$smoke$;

ROLLBACK;

SELECT 'plan_checkout_initial_booking_smoke_passed' AS result;
