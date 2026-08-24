-- Secure, auditable rescheduling for paid bookings.

CREATE TABLE public.booking_reschedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  professor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  checkout_order_id uuid NOT NULL REFERENCES public.checkout_orders(id) ON DELETE RESTRICT,
  old_booking_date date NOT NULL,
  old_start_hour integer NOT NULL CHECK (old_start_hour BETWEEN 6 AND 22),
  new_booking_date date NOT NULL,
  new_start_hour integer NOT NULL CHECK (new_start_hour BETWEEN 6 AND 22),
  booking_type public.booking_type NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL DEFAULT 'student_reschedule'
    CHECK (reason IN ('student_reschedule', 'admin_reschedule')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    old_booking_date <> new_booking_date
    OR old_start_hour <> new_start_hour
  )
);

CREATE INDEX booking_reschedules_booking_created_idx
  ON public.booking_reschedules (booking_id, created_at DESC);
CREATE INDEX booking_reschedules_user_created_idx
  ON public.booking_reschedules (user_id, created_at DESC);

ALTER TABLE public.booking_reschedules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.booking_reschedules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.booking_reschedules TO authenticated;
GRANT SELECT, INSERT ON public.booking_reschedules TO service_role;

CREATE POLICY "reschedule participants read"
ON public.booking_reschedules FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR professor_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
);

-- Booking and block creation use the same transaction lock. This closes the
-- race where a block and a booking could previously be created simultaneously.
CREATE OR REPLACE FUNCTION public.lock_booking_schedule_slot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_hour integer;
BEGIN
  IF TG_TABLE_NAME = 'blocked_slots' THEN
    v_date := NEW.block_date;
    v_hour := NEW.start_hour;
  ELSE
    v_date := NEW.booking_date;
    v_hour := NEW.start_hour;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_date::text || ':' || v_hour::text, 0)
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lock_booking_schedule_slot()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_schedule_slot_lock ON public.bookings;
CREATE TRIGGER booking_schedule_slot_lock
  BEFORE INSERT OR UPDATE OF booking_date, start_hour ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.lock_booking_schedule_slot();

DROP TRIGGER IF EXISTS blocked_schedule_slot_lock ON public.blocked_slots;
CREATE TRIGGER blocked_schedule_slot_lock
  BEFORE INSERT OR UPDATE OF block_date, start_hour ON public.blocked_slots
  FOR EACH ROW EXECUTE FUNCTION public.lock_booking_schedule_slot();

CREATE OR REPLACE FUNCTION public.validate_block_not_booked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bookings booking
    WHERE booking.booking_date = NEW.block_date
      AND booking.start_hour = NEW.start_hour
      AND booking.status <> 'cancelada'
      AND (
        NEW.professor_id IS NULL
        OR booking.professor_id = NEW.professor_id
      )
  ) THEN
    RAISE EXCEPTION 'O horario ja possui uma reserva ativa.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_block_not_booked()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS validate_block_not_booked ON public.blocked_slots;
CREATE TRIGGER validate_block_not_booked
  BEFORE INSERT OR UPDATE OF block_date, start_hour, professor_id
  ON public.blocked_slots
  FOR EACH ROW EXECUTE FUNCTION public.validate_block_not_booked();

CREATE OR REPLACE FUNCTION public.reschedule_paid_booking(
  p_user_id uuid,
  p_booking_id uuid,
  p_new_booking_date date,
  p_new_start_hour integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_order public.checkout_orders%ROWTYPE;
  v_student_name text;
  v_old_start timestamptz;
  v_new_start timestamptz;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_current_schedule jsonb;
  v_existing_reschedule public.booking_reschedules%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao exclusiva do servidor.';
  END IF;

  IF p_user_id IS NULL OR p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Reserva invalida.';
  END IF;
  IF p_new_start_hour NOT BETWEEN 6 AND 22 THEN
    RAISE EXCEPTION 'Horario de destino invalido.';
  END IF;

  PERFORM public.cleanup_expired_booking_holds();

  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_booking.id IS NULL OR v_booking.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Reserva nao encontrada.';
  END IF;
  IF v_booking.status <> 'confirmada'
     OR v_booking.payment_status <> 'pago'
     OR v_booking.checkout_order_id IS NULL
  THEN
    RAISE EXCEPTION 'Somente uma reserva paga e confirmada pode ser trocada.';
  END IF;
  IF v_booking.attended IS TRUE THEN
    RAISE EXCEPTION 'Uma reserva com presenca registrada nao pode ser trocada.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.checkout_orders
  WHERE id = v_booking.checkout_order_id
  FOR SHARE;

  IF v_order.id IS NULL
     OR v_order.user_id <> p_user_id
     OR v_order.kind <> 'booking'
     OR v_order.status <> 'paid'
  THEN
    RAISE EXCEPTION 'O pagamento desta reserva nao esta confirmado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_attempts attempt
    WHERE attempt.checkout_order_id = v_order.id
      AND attempt.status = 'paid'
      AND attempt.amount_cents = v_order.amount_cents
  ) THEN
    RAISE EXCEPTION 'O pagamento nao possui uma tentativa aprovada para conciliacao.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.checkout_items item
    WHERE item.checkout_order_id = v_order.id
      AND item.reference_id = v_booking.id
      AND item.item_type = 'booking'
      AND item.total_amount_cents = v_booking.amount_cents
  ) THEN
    RAISE EXCEPTION 'Os dados financeiros da reserva estao inconsistentes.';
  END IF;

  IF p_new_booking_date = v_booking.booking_date
     AND p_new_start_hour = v_booking.start_hour
  THEN
    SELECT *
    INTO v_existing_reschedule
    FROM public.booking_reschedules history
    WHERE history.booking_id = v_booking.id
      AND history.new_booking_date = p_new_booking_date
      AND history.new_start_hour = p_new_start_hour
    ORDER BY history.created_at DESC
    LIMIT 1;

    IF v_existing_reschedule.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'booking_id', v_booking.id,
        'old_booking_date', v_existing_reschedule.old_booking_date,
        'old_start_hour', v_existing_reschedule.old_start_hour,
        'new_booking_date', v_existing_reschedule.new_booking_date,
        'new_start_hour', v_existing_reschedule.new_start_hour,
        'payment_status', v_booking.payment_status
      );
    END IF;

    RAISE EXCEPTION 'Escolha um horario diferente da reserva atual.';
  END IF;

  v_old_start := (
    v_booking.booking_date + make_time(v_booking.start_hour, 0, 0)
  ) AT TIME ZONE 'America/Sao_Paulo';
  v_new_start := (
    p_new_booking_date + make_time(p_new_start_hour, 0, 0)
  ) AT TIME ZONE 'America/Sao_Paulo';

  IF v_old_start < now() + interval '2 hours' THEN
    RAISE EXCEPTION 'A troca exige no minimo duas horas de antecedencia.';
  END IF;
  IF v_new_start < now() + interval '2 hours' THEN
    RAISE EXCEPTION 'Escolha um novo horario com no minimo duas horas de antecedencia.';
  END IF;
  IF p_new_booking_date > v_today + 31 THEN
    RAISE EXCEPTION 'A nova data deve estar dentro dos proximos 31 dias.';
  END IF;
  IF (
    SELECT COUNT(*)
    FROM public.booking_reschedules history
    WHERE history.booking_id = v_booking.id
      AND history.created_at > now() - interval '24 hours'
  ) >= 5 THEN
    RAISE EXCEPTION 'Limite de trocas atingido. Fale com o professor para alterar novamente.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_new_booking_date::text || ':' || p_new_start_hour::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.blocked_slots block
    WHERE block.block_date = p_new_booking_date
      AND block.start_hour = p_new_start_hour
      AND (
        block.professor_id IS NULL
        OR block.professor_id = v_booking.professor_id
      )
  ) THEN
    RAISE EXCEPTION 'O novo horario esta bloqueado.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.bookings other_booking
    WHERE other_booking.booking_date = p_new_booking_date
      AND other_booking.start_hour = p_new_start_hour
      AND other_booking.status <> 'cancelada'
      AND other_booking.id <> v_booking.id
  ) THEN
    RAISE EXCEPTION 'O novo horario nao esta mais disponivel.';
  END IF;

  INSERT INTO public.booking_reschedules (
    booking_id, user_id, changed_by, professor_id, checkout_order_id,
    old_booking_date, old_start_hour, new_booking_date, new_start_hour,
    booking_type, amount_cents, reason
  )
  VALUES (
    v_booking.id, v_booking.user_id, p_user_id, v_booking.professor_id,
    v_booking.checkout_order_id, v_booking.booking_date, v_booking.start_hour,
    p_new_booking_date, p_new_start_hour, v_booking.type,
    v_booking.amount_cents, 'student_reschedule'
  );

  -- Including status in the update preserves the existing rule that a paid
  -- booking supersedes an open match in the destination slot.
  UPDATE public.bookings
  SET booking_date = p_new_booking_date,
      start_hour = p_new_start_hour,
      status = status
  WHERE id = v_booking.id;

  UPDATE public.checkout_items
  SET description = CASE v_booking.type
        WHEN 'quadra_livre' THEN 'Quadra livre'
        WHEN 'aula_individual' THEN 'Aula individual'
        WHEN 'aula_dupla' THEN 'Aula em dupla'
        WHEN 'aula_trio' THEN 'Aula em trio'
        WHEN 'aula_quarteto' THEN 'Aula em quarteto'
        WHEN 'teste' THEN 'Teste'
      END || ' - ' || to_char(p_new_booking_date, 'DD/MM/YYYY')
        || ' as ' || lpad(p_new_start_hour::text, 2, '0') || 'h',
      metadata = metadata || jsonb_build_object(
        'booking_date', p_new_booking_date,
        'start_hour', p_new_start_hour,
        'rescheduled', true
      )
  WHERE checkout_order_id = v_order.id
    AND reference_id = v_booking.id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'booking_id', booking.id,
      'booking_date', booking.booking_date,
      'start_hour', booking.start_hour
    ) ORDER BY booking.booking_date, booking.start_hour
  )
  INTO v_current_schedule
  FROM public.bookings booking
  WHERE booking.checkout_order_id = v_order.id
    AND booking.status <> 'cancelada';

  UPDATE public.checkout_orders
  SET metadata = metadata || jsonb_build_object(
        'rescheduled', true,
        'last_rescheduled_at', now(),
        'current_schedule', COALESCE(v_current_schedule, '[]'::jsonb)
      )
  WHERE id = v_order.id;

  SELECT COALESCE(profile.full_name, 'Aluno')
  INTO v_student_name
  FROM public.profiles profile
  WHERE profile.id = p_user_id;

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_booking_id
  )
  VALUES (
    p_user_id,
    'Horario alterado',
    'Sua reserva de ' || to_char(v_booking.booking_date, 'DD/MM') || ' as '
      || lpad(v_booking.start_hour::text, 2, '0') || ':00 foi transferida para '
      || to_char(p_new_booking_date, 'DD/MM') || ' as '
      || lpad(p_new_start_hour::text, 2, '0') || ':00.',
    'booking_rescheduled',
    v_booking.id
  );

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_booking_id
  )
  SELECT DISTINCT
    recipient.user_id,
    'Reserva remarcada',
    v_student_name || ' transferiu a reserva de '
      || to_char(v_booking.booking_date, 'DD/MM') || ' as '
      || lpad(v_booking.start_hour::text, 2, '0') || ':00 para '
      || to_char(p_new_booking_date, 'DD/MM') || ' as '
      || lpad(p_new_start_hour::text, 2, '0') || ':00.',
    'booking_rescheduled',
    v_booking.id
  FROM (
    SELECT role_row.user_id
    FROM public.user_roles role_row
    WHERE role_row.role = 'admin'
    UNION
    SELECT v_booking.professor_id
    WHERE v_booking.professor_id IS NOT NULL
  ) recipient
  WHERE recipient.user_id <> p_user_id;

  RETURN jsonb_build_object(
    'booking_id', v_booking.id,
    'old_booking_date', v_booking.booking_date,
    'old_start_hour', v_booking.start_hour,
    'new_booking_date', p_new_booking_date,
    'new_start_hour', p_new_start_hour,
    'payment_status', v_booking.payment_status
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'O novo horario nao esta mais disponivel.';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reschedule_paid_booking(
  uuid, uuid, date, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_paid_booking(
  uuid, uuid, date, integer
) TO service_role;
