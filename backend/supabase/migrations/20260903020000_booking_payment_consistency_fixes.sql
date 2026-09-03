-- Attendance timing, administrative payment reconciliation, realtime catalogs
-- and privacy-preserving group vacancy suggestions.

-- A future lesson has not been evaluated yet. Keep NULL distinct from an
-- actual absence recorded by the coach after the lesson starts.
ALTER TABLE public.bookings DISABLE TRIGGER bookings_protect_credit_fields;
UPDATE public.bookings
SET attended = NULL
WHERE attended IS FALSE
  AND status <> 'concluida'
  AND (booking_date + make_time(start_hour, 0, 0))
        AT TIME ZONE 'America/Sao_Paulo' > now();
ALTER TABLE public.bookings ENABLE TRIGGER bookings_protect_credit_fields;

CREATE OR REPLACE FUNCTION public.enforce_booking_attendance_timing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_booking_start timestamptz;
BEGIN
  v_booking_start := (NEW.booking_date + make_time(NEW.start_hour, 0, 0))
    AT TIME ZONE 'America/Sao_Paulo';

  IF TG_OP = 'INSERT' THEN
    IF NEW.attended IS NOT NULL AND v_booking_start > now() THEN
      NEW.attended := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.attended IS DISTINCT FROM OLD.attended THEN
    IF v_booking_start > now() THEN
      RAISE EXCEPTION 'A presenca so pode ser registrada depois do inicio da aula.';
    END IF;
    IF NEW.payment_status <> 'pago'
       OR NEW.status NOT IN ('confirmada', 'concluida')
    THEN
      RAISE EXCEPTION 'A presenca exige uma reserva confirmada e paga.';
    END IF;
  END IF;

  IF NEW.status = 'concluida' AND OLD.status <> 'concluida' THEN
    IF v_booking_start > now() THEN
      RAISE EXCEPTION 'A aula so pode ser concluida depois do horario de inicio.';
    END IF;
    IF NEW.attended IS NULL THEN
      RAISE EXCEPTION 'Registre a presenca ou a falta antes de concluir a aula.';
    END IF;
  END IF;

  IF NEW.attended IS NOT NULL AND v_booking_start > now() THEN
    RAISE EXCEPTION 'Uma aula futura nao pode ter presenca ou falta registrada.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_booking_attendance_timing()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS booking_attendance_time_guard ON public.bookings;
CREATE TRIGGER booking_attendance_time_guard
  BEFORE INSERT OR UPDATE OF attended, status, booking_date, start_hour, payment_status
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_attendance_timing();

-- Keep the staff summary defensive even if old rows contain a legacy FALSE.
CREATE OR REPLACE FUNCTION public.list_students_for_staff()
RETURNS TABLE (
  id uuid,
  full_name text,
  phone text,
  birth_date date,
  skill_level text,
  bookings bigint,
  attended bigint,
  missed bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := public.has_role(v_caller, 'admin');
  v_is_professor boolean := public.has_role(v_caller, 'professor');
  v_show_phone boolean := false;
  v_show_birth_date boolean := false;
BEGIN
  IF NOT v_is_admin AND NOT v_is_professor THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF v_is_professor THEN
    SELECT COALESCE(value = 'true', false)
      INTO v_show_phone
      FROM public.site_settings
      WHERE key = 'prof_visible_phone';

    SELECT COALESCE(value = 'true', false)
      INTO v_show_birth_date
      FROM public.site_settings
      WHERE key = 'prof_visible_birth_date';
  END IF;

  RETURN QUERY
  WITH eligible_students AS (
    SELECT role_row.user_id
    FROM public.user_roles role_row
    WHERE v_is_admin
      AND role_row.role = 'aluno'

    UNION

    SELECT booking.user_id
    FROM public.bookings booking
    WHERE v_is_professor
      AND booking.professor_id = v_caller
  ),
  booking_stats AS (
    SELECT
      booking.user_id,
      COUNT(*) AS bookings,
      COUNT(*) FILTER (
        WHERE booking.attended IS TRUE
          AND booking.payment_status = 'pago'
          AND booking.status IN ('confirmada', 'concluida')
          AND (booking.booking_date + make_time(booking.start_hour, 0, 0))
                AT TIME ZONE 'America/Sao_Paulo' <= now()
      ) AS attended,
      COUNT(*) FILTER (
        WHERE booking.attended IS FALSE
          AND booking.payment_status = 'pago'
          AND booking.status IN ('confirmada', 'concluida')
          AND (booking.booking_date + make_time(booking.start_hour, 0, 0))
                AT TIME ZONE 'America/Sao_Paulo' <= now()
      ) AS missed
    FROM public.bookings booking
    WHERE v_is_admin OR booking.professor_id = v_caller
    GROUP BY booking.user_id
  )
  SELECT
    profile.id,
    profile.full_name,
    CASE WHEN v_is_admin OR v_show_phone THEN profile.phone ELSE NULL END,
    CASE WHEN v_is_admin OR v_show_birth_date THEN profile.birth_date ELSE NULL END,
    profile.skill_level,
    COALESCE(stats.bookings, 0),
    COALESCE(stats.attended, 0),
    COALESCE(stats.missed, 0)
  FROM eligible_students eligible
  JOIN public.profiles profile ON profile.id = eligible.user_id
  LEFT JOIN booking_stats stats ON stats.user_id = eligible.user_id
  ORDER BY profile.full_name NULLS LAST;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_students_for_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_students_for_staff() TO authenticated;

-- This operation is called only after the backend independently verifies the
-- Mercado Pago payment. It restores expired holds and confirms them in one
-- transaction, but never steals a slot that has since been occupied.
CREATE OR REPLACE FUNCTION public.restore_review_booking_checkout(
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
  v_expected_count integer;
  v_expected_total bigint;
  v_booking_count integer;
  v_booking_total bigint;
  v_slot record;
  v_session record;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao exclusiva do servidor.';
  END IF;

  SELECT * INTO v_order
  FROM public.checkout_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL OR v_order.kind <> 'booking' THEN
    RAISE EXCEPTION 'Cobranca de reserva nao encontrada.';
  END IF;
  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('status', 'paid', 'restored', false);
  END IF;
  IF v_order.status <> 'paid_needs_review' THEN
    RAISE EXCEPTION 'Esta cobranca nao esta aguardando conferencia.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_attempts attempt
    WHERE attempt.checkout_order_id = v_order.id
      AND attempt.status = 'paid'
      AND attempt.payment_method = 'pix'
      AND attempt.amount_cents = v_order.amount_cents
  ) THEN
    RAISE EXCEPTION 'O Pix aprovado nao foi validado para esta cobranca.';
  END IF;

  SELECT COUNT(*)::integer, COALESCE(SUM(item.total_amount_cents), 0)
  INTO v_expected_count, v_expected_total
  FROM public.checkout_items item
  WHERE item.checkout_order_id = v_order.id
    AND item.item_type = 'booking';

  SELECT COUNT(*)::integer, COALESCE(SUM(booking.amount_cents), 0)
  INTO v_booking_count, v_booking_total
  FROM public.bookings booking
  WHERE booking.checkout_order_id = v_order.id;

  IF v_expected_count < 1
     OR v_expected_count <> v_booking_count
     OR v_expected_total <> v_order.amount_cents
     OR v_booking_total <> v_order.amount_cents
     OR EXISTS (
       SELECT 1
       FROM public.bookings booking
       LEFT JOIN public.checkout_items item
         ON item.checkout_order_id = v_order.id
        AND item.item_type = 'booking'
        AND item.reference_id = booking.id
       LEFT JOIN public.reservation_sessions session ON session.id = booking.session_id
       WHERE booking.checkout_order_id = v_order.id
         AND (
           item.id IS NULL
           OR session.id IS NULL
           OR item.quantity <> 1
           OR item.unit_amount_cents <> booking.amount_cents
           OR item.total_amount_cents <> booking.amount_cents
           OR item.metadata->>'session_id' <> booking.session_id::text
           OR session.booking_date <> booking.booking_date
           OR session.start_hour <> booking.start_hour
           OR session.product_type <> booking.type
           OR session.professor_id IS DISTINCT FROM booking.professor_id
           OR session.unit_price_cents <> booking.amount_cents
           OR booking.price_cents <> booking.amount_cents
           OR booking.status NOT IN ('pendente', 'cancelada')
           OR booking.payment_status NOT IN ('pendente', 'expirado', 'cancelado')
           OR session.status = 'completed'
           OR (booking.booking_date + make_time(booking.start_hour, 0, 0))
                AT TIME ZONE 'America/Sao_Paulo' <= now()
         )
     )
  THEN
    RAISE EXCEPTION 'A cobranca nao preserva uma reserva original valida.';
  END IF;

  FOR v_slot IN
    SELECT DISTINCT booking.booking_date, booking.start_hour
    FROM public.bookings booking
    WHERE booking.checkout_order_id = v_order.id
    ORDER BY booking.booking_date, booking.start_hour
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_slot.booking_date::text || ':' || v_slot.start_hour::text, 0)
    );
  END LOOP;

  FOR v_session IN
    SELECT
      session.id,
      session.booking_date,
      session.start_hour,
      session.capacity,
      session.status,
      booking.user_id
    FROM public.bookings booking
    JOIN public.reservation_sessions session ON session.id = booking.session_id
    WHERE booking.checkout_order_id = v_order.id
    ORDER BY session.booking_date, session.start_hour, session.id
    FOR UPDATE OF session
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.reservation_sessions other_session
      WHERE other_session.booking_date = v_session.booking_date
        AND other_session.start_hour = v_session.start_hour
        AND other_session.status = 'open'
        AND other_session.id <> v_session.id
    ) THEN
      RAISE EXCEPTION 'O horario original ja foi ocupado por outra turma.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.blocked_slots block
      WHERE block.block_date = v_session.booking_date
        AND block.start_hour = v_session.start_hour
        AND (
          block.professor_id IS NULL
          OR block.professor_id = (
            SELECT original.professor_id
            FROM public.bookings original
            WHERE original.checkout_order_id = v_order.id
              AND original.session_id = v_session.id
            LIMIT 1
          )
        )
    ) THEN
      RAISE EXCEPTION 'O horario original foi bloqueado pelo professor.';
    END IF;

    IF (
      SELECT COUNT(*)
      FROM public.bookings occupied
      WHERE occupied.session_id = v_session.id
        AND occupied.checkout_order_id IS DISTINCT FROM v_order.id
        AND occupied.status IN ('pendente', 'confirmada')
        AND (
          occupied.payment_status = 'pago'
          OR occupied.status = 'confirmada'
          OR (occupied.payment_status = 'pendente' AND occupied.hold_expires_at > now())
        )
    ) + (
      SELECT COUNT(*)
      FROM public.bookings restoring
      WHERE restoring.checkout_order_id = v_order.id
        AND restoring.session_id = v_session.id
    ) > v_session.capacity
    THEN
      RAISE EXCEPTION 'O horario original nao possui mais vagas suficientes.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.bookings duplicate_booking
      WHERE duplicate_booking.session_id = v_session.id
        AND duplicate_booking.user_id = v_session.user_id
        AND duplicate_booking.checkout_order_id IS DISTINCT FROM v_order.id
        AND duplicate_booking.status IN ('pendente', 'confirmada')
        AND (
          duplicate_booking.payment_status = 'pago'
          OR duplicate_booking.status = 'confirmada'
          OR (
            duplicate_booking.payment_status = 'pendente'
            AND duplicate_booking.hold_expires_at > now()
          )
        )
    ) THEN
      RAISE EXCEPTION 'O aluno ja possui uma reserva ativa no horario original.';
    END IF;
  END LOOP;

  UPDATE public.reservation_sessions session
  SET status = 'open', updated_at = now()
  WHERE session.id IN (
    SELECT booking.session_id
    FROM public.bookings booking
    WHERE booking.checkout_order_id = v_order.id
  );

  UPDATE public.bookings
  SET status = 'pendente',
      payment_status = 'pendente',
      payment_method = 'pix',
      hold_expires_at = now() + interval '5 minutes',
      confirmed_at = NULL,
      attended = NULL
  WHERE checkout_order_id = v_order.id;

  UPDATE public.checkout_orders
  SET status = 'paid', paid_at = COALESCE(p_paid_at, now())
  WHERE id = v_order.id AND status = 'paid_needs_review';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A cobranca mudou durante a conferencia.';
  END IF;

  RETURN jsonb_build_object('status', 'paid', 'restored', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_review_booking_checkout(uuid, timestamptz)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_review_booking_checkout(uuid, timestamptz)
TO service_role;

-- Record the initial product definition as well as later edits. This makes the
-- commercial catalog traceable without allowing history rows to be rewritten.
CREATE OR REPLACE FUNCTION public.audit_class_plan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_values jsonb := '{}'::jsonb;
  v_new_values jsonb;
BEGIN
  v_new_values := jsonb_build_object(
    'title', NEW.title,
    'description', NEW.description,
    'frequency_per_week', NEW.frequency_per_week,
    'duration_months', NEW.duration_months,
    'price_cents', NEW.price_cents,
    'active', NEW.active,
    'modality', NEW.modality,
    'class_duration_min', NEW.class_duration_min,
    'credit_modality', NEW.credit_modality,
    'credit_quantity', NEW.credit_quantity
  );

  IF TG_OP = 'UPDATE' THEN
    v_old_values := jsonb_build_object(
      'title', OLD.title,
      'description', OLD.description,
      'frequency_per_week', OLD.frequency_per_week,
      'duration_months', OLD.duration_months,
      'price_cents', OLD.price_cents,
      'active', OLD.active,
      'modality', OLD.modality,
      'class_duration_min', OLD.class_duration_min,
      'credit_modality', OLD.credit_modality,
      'credit_quantity', OLD.credit_quantity
    );
    IF v_new_values = v_old_values THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.class_plan_change_history (
    class_plan_id, old_values, new_values, changed_by
  ) VALUES (NEW.id, v_old_values, v_new_values, auth.uid());

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_class_plan_change()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS class_plans_audit_change ON public.class_plans;
CREATE TRIGGER class_plans_audit_change
  AFTER INSERT OR UPDATE ON public.class_plans
  FOR EACH ROW EXECUTE FUNCTION public.audit_class_plan_change();

INSERT INTO public.class_plan_change_history (
  class_plan_id, old_values, new_values, changed_by
)
SELECT
  plan.id,
  '{}'::jsonb,
  jsonb_build_object(
    'title', plan.title,
    'description', plan.description,
    'frequency_per_week', plan.frequency_per_week,
    'duration_months', plan.duration_months,
    'price_cents', plan.price_cents,
    'active', plan.active,
    'modality', plan.modality,
    'class_duration_min', plan.class_duration_min,
    'credit_modality', plan.credit_modality,
    'credit_quantity', plan.credit_quantity
  ),
  NULL
FROM public.class_plans plan
WHERE NOT EXISTS (
  SELECT 1
  FROM public.class_plan_change_history history
  WHERE history.class_plan_id = plan.id
);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS related_session_id uuid
    REFERENCES public.reservation_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notifications_session_idx
  ON public.notifications (related_session_id)
  WHERE related_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_group_vacancy_recipient_uidx
  ON public.notifications (user_id, kind, related_session_id)
  WHERE kind = 'group_vacancy_suggestion' AND related_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_notification_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.related_booking_id IS DISTINCT FROM OLD.related_booking_id
     OR NEW.related_checkout_order_id IS DISTINCT FROM OLD.related_checkout_order_id
     OR NEW.related_session_id IS DISTINCT FROM OLD.related_session_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Somente o estado de leitura pode ser alterado.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_notification_fields()
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_compatible_group_vacancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.reservation_sessions%ROWTYPE;
  v_occupied integer;
  v_available integer;
  v_recipient uuid;
  v_date_text text;
  v_body text;
BEGIN
  IF NEW.session_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_session
  FROM public.reservation_sessions session
  WHERE session.id = NEW.session_id;

  IF v_session.id IS NULL
     OR v_session.product_type NOT IN ('aula_trio', 'aula_quarteto')
     OR v_session.status <> 'open'
     OR (v_session.booking_date + make_time(v_session.start_hour, 0, 0))
          AT TIME ZONE 'America/Sao_Paulo' <= now()
  THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::integer INTO v_occupied
  FROM public.bookings booking
  WHERE booking.session_id = v_session.id
    AND booking.status IN ('pendente', 'confirmada')
    AND (
      booking.payment_status = 'pago'
      OR booking.status = 'confirmada'
      OR (booking.payment_status = 'pendente' AND booking.hold_expires_at > now())
    );

  v_available := v_session.capacity - v_occupied;
  IF v_occupied < 1 OR v_available < 1 THEN
    RETURN NEW;
  END IF;

  v_date_text := to_char(v_session.booking_date, 'DD/MM/YYYY');
  v_body := 'Uma aula em grupo em ' || v_date_text || ' as '
    || lpad(v_session.start_hour::text, 2, '0') || ':00 esta com '
    || v_occupied || ' de ' || v_session.capacity
    || ' vagas ocupadas. Voce pode usar um credito de grupo para participar.';

  FOR v_recipient IN
    SELECT grant_row.user_id
    FROM public.student_credit_grants grant_row
    JOIN public.user_roles role_row
      ON role_row.user_id = grant_row.user_id AND role_row.role = 'aluno'
    WHERE grant_row.status = 'active'
      AND grant_row.modality = 'grupo'
      AND grant_row.user_id <> NEW.user_id
      AND (
        SELECT COALESCE(SUM(ledger.credit_delta), 0)
        FROM public.student_credit_ledger ledger
        WHERE ledger.grant_id = grant_row.id
      ) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.bookings own_booking
        WHERE own_booking.session_id = v_session.id
          AND own_booking.user_id = grant_row.user_id
          AND own_booking.status IN ('pendente', 'confirmada')
          AND (
            own_booking.payment_status = 'pago'
            OR own_booking.status = 'confirmada'
            OR (
              own_booking.payment_status = 'pendente'
              AND own_booking.hold_expires_at > now()
            )
          )
      )
    GROUP BY grant_row.user_id
  LOOP
    INSERT INTO public.notifications (
      user_id, title, body, kind, related_session_id
    ) VALUES (
      v_recipient,
      'Turma com vaga disponivel',
      v_body,
      'group_vacancy_suggestion',
      v_session.id
    )
    ON CONFLICT (user_id, kind, related_session_id)
      WHERE kind = 'group_vacancy_suggestion' AND related_session_id IS NOT NULL
    DO UPDATE SET
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      read = false,
      created_at = now();
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_compatible_group_vacancy()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS booking_notify_compatible_group_vacancy ON public.bookings;
CREATE TRIGGER booking_notify_compatible_group_vacancy
  AFTER INSERT OR UPDATE OF status, payment_status, session_id
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_compatible_group_vacancy();

-- Catalog and policy changes should reach open student/admin screens without a
-- refresh. RLS still controls which rows each client can receive.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pricing;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.class_plans;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.site_settings;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
