-- Shared lesson sessions with one independently paid booking per student.

ALTER TABLE public.pricing
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS student_capacity smallint,
  ADD COLUMN IF NOT EXISTS requires_professor boolean,
  ADD COLUMN IF NOT EXISTS sort_order smallint;

UPDATE public.pricing
SET display_name = CASE booking_type
      WHEN 'quadra_livre' THEN 'Quadra livre'
      WHEN 'aula_individual' THEN 'Aula individual'
      WHEN 'aula_dupla' THEN 'Aula em dupla'
      WHEN 'aula_trio' THEN 'Aula em trio'
      WHEN 'aula_quarteto' THEN 'Aula em quarteto'
      WHEN 'teste' THEN 'Teste'
    END,
    student_capacity = CASE booking_type
      WHEN 'aula_dupla' THEN 2
      WHEN 'aula_trio' THEN 3
      WHEN 'aula_quarteto' THEN 4
      ELSE 1
    END,
    requires_professor = booking_type NOT IN ('quadra_livre', 'teste'),
    sort_order = CASE booking_type
      WHEN 'quadra_livre' THEN 10
      WHEN 'aula_individual' THEN 20
      WHEN 'aula_dupla' THEN 30
      WHEN 'aula_trio' THEN 40
      WHEN 'aula_quarteto' THEN 50
      WHEN 'teste' THEN 90
    END
WHERE display_name IS NULL
   OR student_capacity IS NULL
   OR requires_professor IS NULL
   OR sort_order IS NULL;

ALTER TABLE public.pricing
  ALTER COLUMN display_name SET NOT NULL,
  ALTER COLUMN student_capacity SET NOT NULL,
  ALTER COLUMN requires_professor SET NOT NULL,
  ALTER COLUMN sort_order SET NOT NULL;

ALTER TABLE public.pricing
  DROP CONSTRAINT IF EXISTS pricing_positive_price,
  DROP CONSTRAINT IF EXISTS pricing_student_capacity,
  ADD CONSTRAINT pricing_positive_price CHECK (price_cents > 0),
  ADD CONSTRAINT pricing_student_capacity CHECK (student_capacity BETWEEN 1 AND 4);

REVOKE INSERT, DELETE, UPDATE ON public.pricing FROM authenticated;
GRANT UPDATE (price_cents, active) ON public.pricing TO authenticated;

CREATE TABLE public.pricing_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_id uuid NOT NULL REFERENCES public.pricing(id) ON DELETE RESTRICT,
  booking_type public.booking_type NOT NULL,
  old_price_cents integer NOT NULL,
  new_price_cents integer NOT NULL,
  old_active boolean NOT NULL,
  new_active boolean NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pricing_change_history_pricing_changed_idx
  ON public.pricing_change_history (pricing_id, changed_at DESC);

ALTER TABLE public.pricing_change_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_change_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pricing_change_history TO authenticated;
GRANT SELECT, INSERT ON public.pricing_change_history TO service_role;

CREATE POLICY "pricing history admin read"
ON public.pricing_change_history FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.audit_pricing_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.price_cents IS DISTINCT FROM OLD.price_cents
     OR NEW.active IS DISTINCT FROM OLD.active
  THEN
    INSERT INTO public.pricing_change_history (
      pricing_id, booking_type, old_price_cents, new_price_cents,
      old_active, new_active, changed_by
    )
    VALUES (
      NEW.id, NEW.booking_type, OLD.price_cents, NEW.price_cents,
      OLD.active, NEW.active, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_pricing_change()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pricing_audit_change ON public.pricing;
CREATE TRIGGER pricing_audit_change
  AFTER UPDATE OF price_cents, active ON public.pricing
  FOR EACH ROW EXECUTE FUNCTION public.audit_pricing_change();

CREATE OR REPLACE FUNCTION public.protect_pricing_product_definition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.booking_type IS DISTINCT FROM OLD.booking_type
     OR NEW.display_name IS DISTINCT FROM OLD.display_name
     OR NEW.student_capacity IS DISTINCT FROM OLD.student_capacity
     OR NEW.requires_professor IS DISTINCT FROM OLD.requires_professor
     OR NEW.sort_order IS DISTINCT FROM OLD.sort_order
  THEN
    RAISE EXCEPTION 'A definicao do produto so pode ser alterada por uma migracao do servidor.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_pricing_product_definition()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pricing_protect_product_definition ON public.pricing;
CREATE TRIGGER pricing_protect_product_definition
  BEFORE UPDATE ON public.pricing
  FOR EACH ROW EXECUTE FUNCTION public.protect_pricing_product_definition();

CREATE TABLE public.reservation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_date date NOT NULL,
  start_hour integer NOT NULL CHECK (start_hour BETWEEN 6 AND 22),
  professor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  product_type public.booking_type NOT NULL,
  capacity smallint NOT NULL CHECK (capacity BETWEEN 1 AND 4),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'cancelled', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (product_type IN ('quadra_livre', 'teste') AND professor_id IS NULL AND capacity = 1)
    OR
    product_type NOT IN ('quadra_livre', 'teste')
  )
);

ALTER TABLE public.reservation_sessions
  ADD CONSTRAINT reservation_sessions_product_type_fkey
  FOREIGN KEY (product_type) REFERENCES public.pricing(booking_type)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE UNIQUE INDEX reservation_sessions_active_slot_unique
  ON public.reservation_sessions (booking_date, start_hour)
  WHERE status = 'open';
CREATE INDEX reservation_sessions_date_hour_idx
  ON public.reservation_sessions (booking_date, start_hour);
CREATE INDEX reservation_sessions_professor_date_idx
  ON public.reservation_sessions (professor_id, booking_date, start_hour)
  WHERE status = 'open';

ALTER TABLE public.reservation_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reservation_sessions TO authenticated;
GRANT ALL ON public.reservation_sessions TO service_role;

CREATE POLICY "authenticated read reservation sessions"
ON public.reservation_sessions FOR SELECT TO authenticated
USING (true);

CREATE TRIGGER reservation_sessions_touch_updated
  BEFORE UPDATE ON public.reservation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS session_id uuid
    REFERENCES public.reservation_sessions(id) ON DELETE RESTRICT;

CREATE INDEX bookings_session_idx ON public.bookings (session_id);

-- Existing active bookings are exclusive today. Backfill one session for each
-- active slot so the migration remains safe even when production is not empty.
INSERT INTO public.reservation_sessions (
  booking_date, start_hour, professor_id, product_type, capacity,
  unit_price_cents, status, created_at, updated_at
)
SELECT DISTINCT ON (booking.booking_date, booking.start_hour)
  booking.booking_date,
  booking.start_hour,
  booking.professor_id,
  booking.type,
  COALESCE(product.student_capacity, 1),
  COALESCE(booking.amount_cents, booking.price_cents, product.price_cents),
  'open',
  booking.created_at,
  booking.updated_at
FROM public.bookings booking
LEFT JOIN public.pricing product ON product.booking_type = booking.type
WHERE booking.status IN ('pendente', 'confirmada')
  AND (
    booking.payment_status = 'pago'
    OR booking.status = 'confirmada'
    OR (
      booking.payment_status = 'pendente'
      AND booking.hold_expires_at > now()
    )
  )
ORDER BY booking.booking_date, booking.start_hour, booking.created_at;

UPDATE public.bookings booking
SET session_id = session.id
FROM public.reservation_sessions session
WHERE booking.session_id IS NULL
  AND booking.status IN ('pendente', 'confirmada')
  AND (
    booking.payment_status = 'pago'
    OR booking.status = 'confirmada'
    OR (
      booking.payment_status = 'pendente'
      AND booking.hold_expires_at > now()
    )
  )
  AND session.status = 'open'
  AND session.booking_date = booking.booking_date
  AND session.start_hour = booking.start_hour;

UPDATE public.checkout_items item
SET metadata = item.metadata || jsonb_build_object('session_id', booking.session_id)
FROM public.bookings booking
WHERE item.item_type = 'booking'
  AND item.reference_id = booking.id
  AND booking.session_id IS NOT NULL
  AND NOT (item.metadata ? 'session_id');

DROP INDEX IF EXISTS public.bookings_active_slot_unique;

CREATE UNIQUE INDEX bookings_active_session_user_unique
  ON public.bookings (session_id, user_id)
  WHERE session_id IS NOT NULL AND status <> 'cancelada';

CREATE OR REPLACE FUNCTION public.protect_provider_booking_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.checkout_order_id IS NOT NULL
     AND COALESCE(auth.jwt()->>'role', '') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Reservas vinculadas a pagamento nao podem ser excluidas diretamente.';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_provider_booking_deletion()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_protect_provider_deletion ON public.bookings;
CREATE TRIGGER booking_protect_provider_deletion
  BEFORE DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.protect_provider_booking_deletion();

CREATE OR REPLACE FUNCTION public.validate_booking_session_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_session public.reservation_sessions%ROWTYPE;
BEGIN
  IF NEW.session_id IS NULL THEN
    IF COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'A reserva precisa estar vinculada a uma sessao.';
  END IF;

  SELECT * INTO v_session
  FROM public.reservation_sessions
  WHERE id = NEW.session_id;

  IF v_session.id IS NULL OR v_session.status <> 'open' THEN
    RAISE EXCEPTION 'Sessao de reserva indisponivel.';
  END IF;
  IF NEW.booking_date <> v_session.booking_date
     OR NEW.start_hour <> v_session.start_hour
     OR NEW.type <> v_session.product_type
     OR NEW.professor_id IS DISTINCT FROM v_session.professor_id
  THEN
    RAISE EXCEPTION 'Os dados da reserva nao correspondem a sessao.';
  END IF;
  IF TG_OP = 'INSERT'
     AND (
       NEW.duration_hours <> 1
       OR NEW.price_cents IS DISTINCT FROM v_session.unit_price_cents
       OR NEW.amount_cents IS DISTINCT FROM v_session.unit_price_cents
     )
  THEN
    RAISE EXCEPTION 'O valor e a duracao da reserva nao correspondem a sessao.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_booking_session_consistency()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_session_consistency ON public.bookings;
CREATE TRIGGER booking_session_consistency
  BEFORE INSERT OR UPDATE OF session_id, booking_date, start_hour, type, professor_id
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.validate_booking_session_consistency();

CREATE OR REPLACE FUNCTION public.protect_booking_session_and_paid_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    RAISE EXCEPTION 'A sessao de uma reserva so pode ser alterada pelo servidor.';
  END IF;

  IF OLD.checkout_order_id IS NOT NULL
     AND OLD.payment_status = 'pendente'
     AND NEW.status IS DISTINCT FROM OLD.status
  THEN
    RAISE EXCEPTION 'Cancele a cobranca Pix completa para liberar a vaga.';
  END IF;

  IF OLD.checkout_order_id IS NOT NULL
     AND OLD.payment_status = 'pago'
     AND NEW.status = 'cancelada'
     AND NEW.status IS DISTINCT FROM OLD.status
  THEN
    RAISE EXCEPTION 'Uma vaga paga exige remarcacao ou estorno confirmado.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_booking_session_and_paid_status()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_protect_session_and_paid_status ON public.bookings;
CREATE TRIGGER booking_protect_session_and_paid_status
  BEFORE UPDATE OF session_id, status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.protect_booking_session_and_paid_status();

CREATE OR REPLACE FUNCTION public.enforce_reservation_session_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_session public.reservation_sessions%ROWTYPE;
  v_occupied integer;
  v_new_is_active boolean;
BEGIN
  v_new_is_active := NEW.session_id IS NOT NULL
    AND NEW.status IN ('pendente', 'confirmada')
    AND (
      NEW.payment_status = 'pago'
      OR NEW.status = 'confirmada'
      OR (
        NEW.payment_status = 'pendente'
        AND NEW.hold_expires_at > now()
      )
    );

  IF NOT v_new_is_active THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_session
  FROM public.reservation_sessions
  WHERE id = NEW.session_id;

  IF v_session.id IS NULL OR v_session.status <> 'open' THEN
    RAISE EXCEPTION 'Sessao de reserva indisponivel.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_session.booking_date::text || ':' || v_session.start_hour::text, 0)
  );

  SELECT * INTO v_session
  FROM public.reservation_sessions
  WHERE id = NEW.session_id
  FOR UPDATE;

  SELECT COUNT(*)::integer INTO v_occupied
  FROM public.bookings booking
  WHERE booking.session_id = v_session.id
    AND booking.id IS DISTINCT FROM NEW.id
    AND booking.status IN ('pendente', 'confirmada')
    AND (
      booking.payment_status = 'pago'
      OR booking.status = 'confirmada'
      OR (
        booking.payment_status = 'pendente'
        AND booking.hold_expires_at > now()
      )
    );

  IF v_occupied >= v_session.capacity THEN
    RAISE EXCEPTION 'A sessao nao possui mais vagas.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_reservation_session_capacity()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_enforce_session_capacity ON public.bookings;
CREATE TRIGGER booking_enforce_session_capacity
  BEFORE INSERT OR UPDATE OF session_id, status, payment_status, hold_expires_at
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reservation_session_capacity();

CREATE OR REPLACE FUNCTION public.sync_reservation_session_after_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_session_id uuid;
  v_new_session_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_session_id := OLD.session_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_session_id := NEW.session_id;
  END IF;

  UPDATE public.reservation_sessions
  SET updated_at = now()
  WHERE id IN (v_old_session_id, v_new_session_id)
    AND status = 'open';

  IF v_old_session_id IS NOT NULL THEN
    UPDATE public.reservation_sessions session
    SET status = CASE
          WHEN EXISTS (
            SELECT 1 FROM public.bookings completed_booking
            WHERE completed_booking.session_id = session.id
              AND completed_booking.status = 'concluida'
          ) THEN 'completed'
          ELSE 'cancelled'
        END,
        updated_at = now()
    WHERE session.id = v_old_session_id
      AND session.status = 'open'
      AND NOT EXISTS (
        SELECT 1
        FROM public.bookings booking
        WHERE booking.session_id = session.id
          AND booking.status IN ('pendente', 'confirmada')
          AND (
            booking.payment_status = 'pago'
            OR booking.status = 'confirmada'
            OR (
              booking.payment_status = 'pendente'
              AND booking.hold_expires_at > now()
            )
          )
      );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_reservation_session_after_booking()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_sync_reservation_session ON public.bookings;
CREATE TRIGGER booking_sync_reservation_session
  AFTER INSERT OR UPDATE OR DELETE
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.sync_reservation_session_after_booking();

DROP VIEW IF EXISTS public.reservation_session_availability;
CREATE VIEW public.reservation_session_availability
WITH (security_invoker = off, security_barrier = true) AS
SELECT
  session.id AS session_id,
  session.booking_date,
  session.start_hour,
  session.professor_id,
  session.product_type,
  product.display_name,
  session.capacity,
  session.unit_price_cents,
  occupancy.occupied_seats,
  GREATEST(session.capacity - occupancy.occupied_seats, 0)::integer AS available_seats,
  occupancy.occupied_seats >= session.capacity AS is_full,
  mine.booking_id AS my_booking_id,
  mine.booking_status AS my_booking_status,
  mine.payment_status AS my_payment_status,
  mine.checkout_order_id AS my_checkout_order_id,
  mine.hold_expires_at AS my_hold_expires_at,
  session.updated_at
FROM public.reservation_sessions session
JOIN public.pricing product ON product.booking_type = session.product_type
CROSS JOIN LATERAL (
  SELECT COUNT(*)::integer AS occupied_seats
  FROM public.bookings booking
  WHERE booking.session_id = session.id
    AND booking.status IN ('pendente', 'confirmada')
    AND (
      booking.payment_status = 'pago'
      OR booking.status = 'confirmada'
      OR (
        booking.payment_status = 'pendente'
        AND booking.hold_expires_at > now()
      )
    )
) occupancy
LEFT JOIN LATERAL (
  SELECT
    booking.id AS booking_id,
    booking.status AS booking_status,
    booking.payment_status,
    booking.checkout_order_id,
    booking.hold_expires_at
  FROM public.bookings booking
  WHERE booking.session_id = session.id
    AND booking.user_id = auth.uid()
    AND booking.status IN ('pendente', 'confirmada')
    AND (
      booking.payment_status = 'pago'
      OR booking.status = 'confirmada'
      OR (
        booking.payment_status = 'pendente'
        AND booking.hold_expires_at > now()
      )
    )
  ORDER BY booking.created_at DESC
  LIMIT 1
) mine ON true
WHERE session.status = 'open'
  AND occupancy.occupied_seats > 0;

REVOKE ALL ON public.reservation_session_availability FROM PUBLIC, anon;
GRANT SELECT ON public.reservation_session_availability TO authenticated;

CREATE OR REPLACE FUNCTION public.create_booking_checkout_hold(
  p_user_id uuid,
  p_booking_date date,
  p_hours integer[],
  p_booking_type public.booking_type,
  p_professor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours integer[];
  v_hour integer;
  v_index integer;
  v_order_id uuid := gen_random_uuid();
  v_booking_id uuid;
  v_booking_ids uuid[] := ARRAY[]::uuid[];
  v_session_ids uuid[] := ARRAY[]::uuid[];
  v_unit_prices integer[] := ARRAY[]::integer[];
  v_product public.pricing%ROWTYPE;
  v_session public.reservation_sessions%ROWTYPE;
  v_occupied integer;
  v_amount_cents integer := 0;
  v_expires_at timestamptz := now() + interval '30 minutes';
  v_description text;
  v_effective_professor uuid;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao exclusiva do servidor.';
  END IF;

  PERFORM public.cleanup_expired_booking_holds();

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Usuario nao encontrado.';
  END IF;

  -- Serialize a student's checkouts so concurrent requests cannot bypass the
  -- pending-order limit and hold more slots than allowed.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('booking-hold-user:' || p_user_id::text, 0)
  );

  IF p_booking_date < v_today OR p_booking_date > v_today + 31 THEN
    RAISE EXCEPTION 'Data fora da janela permitida para reservas.';
  END IF;

  SELECT array_agg(DISTINCT selected_hour ORDER BY selected_hour)
  INTO v_hours
  FROM unnest(p_hours) AS selected_hour;

  IF COALESCE(cardinality(v_hours), 0) < 1
     OR cardinality(v_hours) > 8
     OR EXISTS (
       SELECT 1 FROM unnest(v_hours) AS selected_hour
       WHERE selected_hour < 6 OR selected_hour > 22
     )
  THEN
    RAISE EXCEPTION 'Selecao de horarios invalida.';
  END IF;
  IF p_booking_type NOT IN ('quadra_livre', 'teste')
     AND cardinality(v_hours) <> 1
  THEN
    RAISE EXCEPTION 'Selecione um horario por aula.';
  END IF;

  SELECT * INTO v_product
  FROM public.pricing product
  WHERE product.booking_type = p_booking_type
    AND product.active
  LIMIT 1;

  IF v_product.id IS NULL OR v_product.price_cents <= 0 THEN
    RAISE EXCEPTION 'Produto indisponivel para reserva.';
  END IF;

  IF NOT v_product.requires_professor AND p_professor_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este tipo de reserva nao utiliza professor.';
  END IF;
  IF v_product.requires_professor
     AND p_professor_id IS NOT NULL
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
    RAISE EXCEPTION 'Cancele ou conclua uma cobranca pendente antes de continuar.';
  END IF;

  FOREACH v_hour IN ARRAY v_hours
  LOOP
    IF (p_booking_date + make_time(v_hour, 0, 0))
         AT TIME ZONE 'America/Sao_Paulo' < now() + interval '2 hours'
    THEN
      RAISE EXCEPTION 'Escolha um horario com no minimo duas horas de antecedencia.';
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_booking_date::text || ':' || v_hour::text, 0)
    );

    SELECT * INTO v_session
    FROM public.reservation_sessions session
    WHERE session.booking_date = p_booking_date
      AND session.start_hour = v_hour
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
      v_effective_professor := p_professor_id;
      IF v_product.requires_professor AND v_effective_professor IS NULL THEN
        RAISE EXCEPTION 'Selecione um professor para a aula.';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.blocked_slots block
        WHERE block.block_date = p_booking_date
          AND block.start_hour = v_hour
          AND (
            block.professor_id IS NULL
            OR block.professor_id = v_effective_professor
          )
      ) THEN
        RAISE EXCEPTION 'O horario esta bloqueado.';
      END IF;

      INSERT INTO public.reservation_sessions (
        booking_date, start_hour, professor_id, product_type,
        capacity, unit_price_cents
      )
      VALUES (
        p_booking_date, v_hour, v_effective_professor, p_booking_type,
        v_product.student_capacity, v_product.price_cents
      )
      RETURNING * INTO v_session;

      v_occupied := 0;
    ELSE
      IF v_session.product_type <> p_booking_type THEN
        RAISE EXCEPTION 'Este horario ja possui outro tipo de reserva.';
      END IF;
      IF v_product.requires_professor
         AND (
           v_session.professor_id IS NULL
           OR (
             NOT public.has_role(v_session.professor_id, 'professor')
             AND NOT public.has_role(v_session.professor_id, 'admin')
           )
         )
      THEN
        RAISE EXCEPTION 'O professor desta aula nao esta mais disponivel.';
      END IF;
      IF v_product.requires_professor
         AND p_professor_id IS NOT NULL
         AND v_session.professor_id IS DISTINCT FROM p_professor_id
      THEN
        RAISE EXCEPTION 'Este horario esta vinculado a outro professor.';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.blocked_slots block
        WHERE block.block_date = p_booking_date
          AND block.start_hour = v_hour
          AND (
            block.professor_id IS NULL
            OR block.professor_id = v_session.professor_id
          )
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
    v_session_ids := array_append(v_session_ids, v_session.id);
    v_unit_prices := array_append(v_unit_prices, v_session.unit_price_cents);
    v_amount_cents := v_amount_cents + v_session.unit_price_cents;
  END LOOP;

  v_description := v_product.display_name || ' em ' || to_char(p_booking_date, 'DD/MM/YYYY')
    || ' - ' || array_to_string(
      ARRAY(SELECT lpad(selected_hour::text, 2, '0') || 'h' FROM unnest(v_hours) AS selected_hour),
      ', '
    );

  INSERT INTO public.checkout_orders (
    id, user_id, kind, status, currency, amount_cents, description,
    provider, idempotency_key, expires_at, metadata
  )
  VALUES (
    v_order_id, p_user_id, 'booking', 'pending', 'BRL', v_amount_cents,
    v_description, 'mercado_pago', v_order_id, v_expires_at,
    jsonb_build_object(
      'booking_date', p_booking_date,
      'hours', to_jsonb(v_hours),
      'booking_type', p_booking_type,
      'professor_id', v_effective_professor,
      'session_ids', to_jsonb(v_session_ids),
      'quantity', cardinality(v_hours)
    )
  );

  FOR v_index IN 1..cardinality(v_hours)
  LOOP
    v_booking_id := gen_random_uuid();
    v_booking_ids := array_append(v_booking_ids, v_booking_id);

    SELECT * INTO v_session
    FROM public.reservation_sessions
    WHERE id = v_session_ids[v_index];

    INSERT INTO public.bookings (
      id, session_id, user_id, professor_id, booking_date, start_hour,
      duration_hours, type, status, payment_status, payment_method,
      price_cents, amount_cents, checkout_order_id, hold_expires_at,
      confirmed_at, attended
    )
    VALUES (
      v_booking_id, v_session.id, p_user_id, v_session.professor_id,
      p_booking_date, v_hours[v_index], 1, p_booking_type, 'pendente',
      'pendente', 'pix', v_unit_prices[v_index], v_unit_prices[v_index],
      v_order_id, v_expires_at, NULL, false
    );

    INSERT INTO public.checkout_items (
      checkout_order_id, item_type, reference_id, description, quantity,
      unit_amount_cents, total_amount_cents, metadata
    )
    VALUES (
      v_order_id, 'booking', v_booking_id,
      v_product.display_name || ' - ' || to_char(p_booking_date, 'DD/MM/YYYY')
        || ' as ' || lpad(v_hours[v_index]::text, 2, '0') || 'h',
      1, v_unit_prices[v_index], v_unit_prices[v_index],
      jsonb_build_object(
        'booking_type', p_booking_type,
        'booking_date', p_booking_date,
        'start_hour', v_hours[v_index],
        'session_id', v_session.id
      )
    );
  END LOOP;

  UPDATE public.checkout_orders
  SET metadata = metadata || jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'booking_ids', to_jsonb(v_booking_ids),
    'session_ids', to_jsonb(v_session_ids),
    'amount_cents', v_amount_cents,
    'description', v_description,
    'expires_at', v_expires_at,
    'idempotency_key', v_order_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_booking_checkout_hold(
  uuid, date, integer[], public.booking_type, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_checkout_hold(
  uuid, date, integer[], public.booking_type, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_expired_booking_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.bookings
  SET status = 'cancelada',
      payment_status = 'expirado',
      hold_expires_at = NULL
  WHERE status = 'pendente'
    AND payment_status = 'pendente'
    AND hold_expires_at IS NOT NULL
    AND hold_expires_at <= now();

  GET DIAGNOSTICS affected = ROW_COUNT;

  UPDATE public.checkout_orders
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  UPDATE public.payment_attempts
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  UPDATE public.reservation_sessions session
  SET status = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.bookings completed_booking
          WHERE completed_booking.session_id = session.id
            AND completed_booking.status = 'concluida'
        ) THEN 'completed'
        ELSE 'cancelled'
      END,
      updated_at = now()
  WHERE session.status = 'open'
    AND NOT EXISTS (
      SELECT 1
      FROM public.bookings booking
      WHERE booking.session_id = session.id
        AND booking.status IN ('pendente', 'confirmada')
        AND (
          booking.payment_status = 'pago'
          OR booking.status = 'confirmada'
          OR (
            booking.payment_status = 'pendente'
            AND booking.hold_expires_at > now()
          )
        )
    );

  RETURN affected;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_booking_holds()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_booking_holds() TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_booking_checkout(
  p_order_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.checkout_orders%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao exclusiva do servidor.';
  END IF;

  SELECT * INTO v_order
  FROM public.checkout_orders
  WHERE id = p_order_id AND user_id = p_user_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Cobranca nao encontrada.';
  END IF;
  IF v_order.status IN ('paid', 'paid_needs_review', 'refunded') THEN
    RAISE EXCEPTION 'Uma reserva paga exige tratamento administrativo.';
  END IF;
  IF v_order.status <> 'pending' THEN
    RETURN;
  END IF;

  UPDATE public.payment_attempts
  SET status = 'cancelled'
  WHERE checkout_order_id = v_order.id AND status = 'pending';

  UPDATE public.bookings
  SET status = 'cancelada', payment_status = 'cancelado', hold_expires_at = NULL
  WHERE checkout_order_id = v_order.id AND payment_status = 'pendente';

  UPDATE public.checkout_orders
  SET status = 'cancelled', cancelled_at = now()
  WHERE id = v_order.id AND status = 'pending';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_booking_checkout(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_checkout(uuid, uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_paid_booking_checkout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_count integer;
  v_expected_total bigint;
  v_active_count integer;
  v_active_total bigint;
  v_affected integer;
BEGIN
  IF NEW.status <> 'paid' OR OLD.status = 'paid' OR NEW.kind <> 'booking' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::integer, COALESCE(SUM(item.total_amount_cents), 0)
  INTO v_expected_count, v_expected_total
  FROM public.checkout_items item
  WHERE item.checkout_order_id = NEW.id AND item.item_type = 'booking';

  SELECT COUNT(*)::integer, COALESCE(SUM(booking.amount_cents), 0)
  INTO v_active_count, v_active_total
  FROM public.bookings booking
  JOIN public.reservation_sessions session ON session.id = booking.session_id
  WHERE booking.checkout_order_id = NEW.id
    AND booking.status = 'pendente'
    AND booking.payment_status = 'pendente'
    AND booking.hold_expires_at > now()
    AND session.status = 'open'
    AND session.booking_date = booking.booking_date
    AND session.start_hour = booking.start_hour
    AND session.product_type = booking.type
    AND session.professor_id IS NOT DISTINCT FROM booking.professor_id
    AND session.unit_price_cents = booking.amount_cents
    AND booking.price_cents = booking.amount_cents
    AND EXISTS (
      SELECT 1
      FROM public.checkout_items item
      WHERE item.checkout_order_id = NEW.id
        AND item.item_type = 'booking'
        AND item.reference_id = booking.id
        AND item.quantity = 1
        AND item.unit_amount_cents = booking.amount_cents
        AND item.total_amount_cents = booking.amount_cents
        AND item.metadata->>'session_id' = booking.session_id::text
    );

  IF v_expected_count < 1
     OR v_expected_count <> v_active_count
     OR v_expected_total <> NEW.amount_cents
     OR v_active_total <> NEW.amount_cents
  THEN
    RAISE EXCEPTION 'Checkout % nao possui todas as vagas ativas para confirmacao.', NEW.id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reservation_sessions session
    JOIN public.bookings booking ON booking.session_id = session.id
    WHERE session.id IN (
      SELECT linked.session_id
      FROM public.bookings linked
      WHERE linked.checkout_order_id = NEW.id
    )
      AND session.status = 'open'
      AND booking.status IN ('pendente', 'confirmada')
      AND (
        booking.payment_status = 'pago'
        OR booking.status = 'confirmada'
        OR (
          booking.payment_status = 'pendente'
          AND booking.hold_expires_at > now()
        )
      )
    GROUP BY session.id, session.capacity
    HAVING COUNT(*) > session.capacity
  ) THEN
    RAISE EXCEPTION 'A capacidade da sessao foi excedida.';
  END IF;

  UPDATE public.bookings
  SET status = 'confirmada',
      payment_status = 'pago',
      payment_method = 'pix',
      hold_expires_at = NULL,
      confirmed_at = COALESCE(NEW.paid_at, now())
  WHERE checkout_order_id = NEW.id
    AND status = 'pendente'
    AND payment_status = 'pendente'
    AND hold_expires_at > now();

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> v_expected_count THEN
    RAISE EXCEPTION 'Checkout % foi alterado durante a confirmacao.', NEW.id;
  END IF;

  NEW.paid_at := COALESCE(NEW.paid_at, now());
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_paid_booking_checkout()
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_block_not_booked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.reservation_sessions session
    WHERE session.booking_date = NEW.block_date
      AND session.start_hour = NEW.start_hour
      AND session.status = 'open'
      AND (NEW.professor_id IS NULL OR session.professor_id = NEW.professor_id)
      AND EXISTS (
        SELECT 1
        FROM public.bookings booking
        WHERE booking.session_id = session.id
          AND booking.status IN ('pendente', 'confirmada')
          AND (
            booking.payment_status = 'pago'
            OR booking.status = 'confirmada'
            OR (
              booking.payment_status = 'pendente'
              AND booking.hold_expires_at > now()
            )
          )
      )
  ) THEN
    RAISE EXCEPTION 'O horario ja possui uma reserva ativa.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_block_not_booked()
FROM PUBLIC, anon, authenticated;

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
  v_source_session public.reservation_sessions%ROWTYPE;
  v_target_session public.reservation_sessions%ROWTYPE;
  v_product public.pricing%ROWTYPE;
  v_student_name text;
  v_old_start timestamptz;
  v_new_start timestamptz;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_occupied integer;
  v_current_schedule jsonb;
  v_existing_reschedule public.booking_reschedules%ROWTYPE;
  v_old_lock bigint;
  v_new_lock bigint;
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

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_booking.id IS NULL OR v_booking.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Reserva nao encontrada.';
  END IF;
  IF v_booking.status <> 'confirmada'
     OR v_booking.payment_status <> 'pago'
     OR v_booking.checkout_order_id IS NULL
     OR v_booking.session_id IS NULL
  THEN
    RAISE EXCEPTION 'Somente uma reserva paga e confirmada pode ser trocada.';
  END IF;
  IF v_booking.attended IS TRUE THEN
    RAISE EXCEPTION 'Uma reserva com presenca registrada nao pode ser trocada.';
  END IF;

  SELECT * INTO v_source_session
  FROM public.reservation_sessions
  WHERE id = v_booking.session_id
  FOR UPDATE;

  IF v_source_session.id IS NULL OR v_source_session.status <> 'open' THEN
    RAISE EXCEPTION 'A sessao original desta reserva nao foi encontrada.';
  END IF;

  SELECT * INTO v_product
  FROM public.pricing product
  WHERE product.booking_type = v_booking.type;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Este produto nao esta disponivel para remarcacao.';
  END IF;
  IF v_product.requires_professor
     AND (
       v_booking.professor_id IS NULL
       OR (
         NOT public.has_role(v_booking.professor_id, 'professor')
         AND NOT public.has_role(v_booking.professor_id, 'admin')
       )
     )
  THEN
    RAISE EXCEPTION 'O professor desta aula nao esta mais disponivel. Fale com o administrador.';
  END IF;

  SELECT * INTO v_order
  FROM public.checkout_orders
  WHERE id = v_booking.checkout_order_id
  FOR SHARE;

  IF v_order.id IS NULL
     OR v_order.user_id <> p_user_id
     OR v_order.kind <> 'booking'
     OR v_order.status <> 'paid'
     OR NOT EXISTS (
       SELECT 1 FROM public.payment_attempts attempt
       WHERE attempt.checkout_order_id = v_order.id
         AND attempt.status = 'paid'
         AND attempt.amount_cents = v_order.amount_cents
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.checkout_items item
       WHERE item.checkout_order_id = v_order.id
         AND item.reference_id = v_booking.id
         AND item.item_type = 'booking'
         AND item.quantity = 1
         AND item.unit_amount_cents = v_booking.amount_cents
         AND item.total_amount_cents = v_booking.amount_cents
         AND item.metadata->>'session_id' = v_booking.session_id::text
     )
     OR COALESCE(v_booking.amount_cents, 0) <= 0
  THEN
    RAISE EXCEPTION 'O pagamento desta reserva nao esta confirmado.';
  END IF;

  IF p_new_booking_date = v_booking.booking_date
     AND p_new_start_hour = v_booking.start_hour
  THEN
    SELECT * INTO v_existing_reschedule
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

  v_old_start := (v_booking.booking_date + make_time(v_booking.start_hour, 0, 0))
    AT TIME ZONE 'America/Sao_Paulo';
  v_new_start := (p_new_booking_date + make_time(p_new_start_hour, 0, 0))
    AT TIME ZONE 'America/Sao_Paulo';

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
    SELECT COUNT(*) FROM public.booking_reschedules history
    WHERE history.booking_id = v_booking.id
      AND history.created_at > now() - interval '24 hours'
  ) >= 5 THEN
    RAISE EXCEPTION 'Limite de trocas atingido. Fale com o professor para alterar novamente.';
  END IF;

  v_old_lock := hashtextextended(
    v_booking.booking_date::text || ':' || v_booking.start_hour::text, 0
  );
  v_new_lock := hashtextextended(
    p_new_booking_date::text || ':' || p_new_start_hour::text, 0
  );
  PERFORM pg_advisory_xact_lock(LEAST(v_old_lock, v_new_lock));
  IF v_old_lock <> v_new_lock THEN
    PERFORM pg_advisory_xact_lock(GREATEST(v_old_lock, v_new_lock));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocked_slots block
    WHERE block.block_date = p_new_booking_date
      AND block.start_hour = p_new_start_hour
      AND (block.professor_id IS NULL OR block.professor_id = v_booking.professor_id)
  ) THEN
    RAISE EXCEPTION 'O novo horario esta bloqueado.';
  END IF;

  SELECT * INTO v_target_session
  FROM public.reservation_sessions session
  WHERE session.booking_date = p_new_booking_date
    AND session.start_hour = p_new_start_hour
    AND session.status = 'open'
  FOR UPDATE;

  IF v_target_session.id IS NOT NULL THEN
    SELECT COUNT(*)::integer INTO v_occupied
    FROM public.bookings other_booking
    WHERE other_booking.session_id = v_target_session.id
      AND other_booking.status IN ('pendente', 'confirmada')
      AND (
        other_booking.payment_status = 'pago'
        OR other_booking.status = 'confirmada'
        OR (
          other_booking.payment_status = 'pendente'
          AND other_booking.hold_expires_at > now()
        )
      );

    IF v_occupied = 0 THEN
      UPDATE public.reservation_sessions
      SET status = 'cancelled'
      WHERE id = v_target_session.id;
      v_target_session.id := NULL;
    END IF;
  END IF;

  IF v_target_session.id IS NULL THEN
    INSERT INTO public.reservation_sessions (
      booking_date, start_hour, professor_id, product_type,
      capacity, unit_price_cents
    )
    VALUES (
      p_new_booking_date, p_new_start_hour, v_booking.professor_id,
      v_booking.type, v_source_session.capacity, v_source_session.unit_price_cents
    )
    RETURNING * INTO v_target_session;
  ELSE
    IF v_target_session.product_type <> v_booking.type
       OR v_target_session.professor_id IS DISTINCT FROM v_booking.professor_id
    THEN
      RAISE EXCEPTION 'Escolha uma sessao do mesmo tipo e professor.';
    END IF;
    IF v_occupied >= v_target_session.capacity THEN
      RAISE EXCEPTION 'A ultima vaga do novo horario ja foi ocupada.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.bookings other_booking
      WHERE other_booking.session_id = v_target_session.id
        AND other_booking.user_id = p_user_id
        AND other_booking.status IN ('pendente', 'confirmada')
    ) THEN
      RAISE EXCEPTION 'Voce ja possui uma vaga no novo horario.';
    END IF;
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

  UPDATE public.bookings
  SET session_id = v_target_session.id,
      booking_date = p_new_booking_date,
      start_hour = p_new_start_hour,
      professor_id = v_target_session.professor_id,
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
        'session_id', v_target_session.id,
        'rescheduled', true
      )
  WHERE checkout_order_id = v_order.id AND reference_id = v_booking.id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'booking_id', booking.id,
      'session_id', booking.session_id,
      'booking_date', booking.booking_date,
      'start_hour', booking.start_hour
    ) ORDER BY booking.booking_date, booking.start_hour
  ) INTO v_current_schedule
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

  SELECT COALESCE(
    (
      SELECT profile.full_name
      FROM public.profiles profile
      WHERE profile.id = p_user_id
    ),
    'Aluno'
  )
  INTO v_student_name;

  INSERT INTO public.notifications (user_id, title, body, kind, related_booking_id)
  VALUES (
    p_user_id,
    'Horario alterado',
    'Tudo certo! Sua vaga de ' || to_char(v_booking.booking_date, 'DD/MM')
      || ' as ' || lpad(v_booking.start_hour::text, 2, '0')
      || ':00 foi transferida para ' || to_char(p_new_booking_date, 'DD/MM')
      || ' as ' || lpad(p_new_start_hour::text, 2, '0') || ':00.',
    'booking_rescheduled',
    v_booking.id
  );

  INSERT INTO public.notifications (user_id, title, body, kind, related_booking_id)
  SELECT DISTINCT
    recipient.user_id,
    'Reserva remarcada',
    v_student_name || ' transferiu a vaga de '
      || to_char(v_booking.booking_date, 'DD/MM') || ' as '
      || lpad(v_booking.start_hour::text, 2, '0') || ':00 para '
      || to_char(p_new_booking_date, 'DD/MM') || ' as '
      || lpad(p_new_start_hour::text, 2, '0') || ':00.',
    'booking_rescheduled',
    v_booking.id
  FROM (
    SELECT role_row.user_id FROM public.user_roles role_row WHERE role_row.role = 'admin'
    UNION
    SELECT v_booking.professor_id WHERE v_booking.professor_id IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.notify_on_checkout_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_professor_id uuid;
  v_student_name text;
  v_amount text;
  v_first_booking_id uuid;
  v_capacity integer := 1;
  v_occupied integer := 1;
  v_session_note text := '';
BEGIN
  IF NEW.status <> 'paid' OR OLD.status = 'paid' OR NEW.kind <> 'booking' THEN
    RETURN NEW;
  END IF;

  SELECT
    booking.id,
    booking.professor_id,
    session.capacity,
    (
      SELECT COUNT(*)::integer
      FROM public.bookings participant
      WHERE participant.session_id = session.id
        AND participant.status IN ('pendente', 'confirmada')
        AND (
          participant.payment_status = 'pago'
          OR participant.status = 'confirmada'
          OR (
            participant.payment_status = 'pendente'
            AND participant.hold_expires_at > now()
          )
        )
    )
  INTO v_first_booking_id, v_professor_id, v_capacity, v_occupied
  FROM public.bookings booking
  JOIN public.reservation_sessions session ON session.id = booking.session_id
  WHERE booking.checkout_order_id = NEW.id
  ORDER BY booking.booking_date, booking.start_hour, booking.id
  LIMIT 1;

  IF v_first_booking_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(profile.full_name, 'Aluno')
  INTO v_student_name
  FROM public.profiles profile
  WHERE profile.id = NEW.user_id;
  v_student_name := COALESCE(v_student_name, 'Aluno');

  v_amount := 'R$ ' || (NEW.amount_cents / 100)::text || ','
    || lpad((NEW.amount_cents % 100)::text, 2, '0');
  IF v_capacity > 1 THEN
    v_session_note := ' A turma está com ' || v_occupied || ' de '
      || v_capacity || ' vagas reservadas.';
  END IF;

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_booking_id
  )
  VALUES (
    NEW.user_id,
    CASE WHEN v_capacity > 1 THEN 'Vaga confirmada' ELSE 'Reserva confirmada' END,
    'Tudo certo! Recebemos seu Pix de ' || v_amount
      || ' e confirmamos ' || NEW.description || '.' || v_session_note,
    'booking_confirmed',
    v_first_booking_id
  );

  FOR v_admin_id IN
    SELECT role_row.user_id
    FROM public.user_roles role_row
    WHERE role_row.role = 'admin' AND role_row.user_id <> NEW.user_id
  LOOP
    INSERT INTO public.notifications (
      user_id, title, body, kind, related_booking_id
    )
    VALUES (
      v_admin_id,
      CASE WHEN v_capacity > 1 THEN 'Nova vaga confirmada' ELSE 'Nova reserva confirmada' END,
      v_student_name || ' pagou ' || v_amount || ' via Pix. '
        || NEW.description || '.' || v_session_note,
      'payment_paid',
      v_first_booking_id
    );
  END LOOP;

  IF v_professor_id IS NOT NULL
     AND v_professor_id <> NEW.user_id
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles role_row
       WHERE role_row.user_id = v_professor_id AND role_row.role = 'admin'
     )
  THEN
    INSERT INTO public.notifications (
      user_id, title, body, kind, related_booking_id
    )
    VALUES (
      v_professor_id,
      CASE WHEN v_capacity > 1 THEN 'Nova vaga confirmada' ELSE 'Nova reserva confirmada' END,
      v_student_name || ' pagou ' || v_amount || ' via Pix. '
        || NEW.description || '.' || v_session_note,
      'payment_paid',
      v_first_booking_id
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_on_checkout_paid()
FROM PUBLIC, anon, authenticated;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS related_checkout_order_id uuid
    REFERENCES public.checkout_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notifications_checkout_order_idx
  ON public.notifications (related_checkout_order_id)
  WHERE related_checkout_order_id IS NOT NULL;

-- A payment can be reconciled concurrently by polling and by a webhook. Keep
-- the student/admin review alert idempotent even when both requests arrive together.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_payment_review_order_recipient_uidx
  ON public.notifications (user_id, kind, related_checkout_order_id)
  WHERE kind = 'payment_review' AND related_checkout_order_id IS NOT NULL;

-- Keep historical review alerts aligned with the visible admin navigation.
ALTER TABLE public.notifications DISABLE TRIGGER protect_notification_fields;
UPDATE public.notifications
SET body = replace(body, 'área Financeiro', 'tela Pagamentos')
WHERE kind = 'payment_review'
  AND body LIKE '%área Financeiro%';
ALTER TABLE public.notifications ENABLE TRIGGER protect_notification_fields;

-- Students can observe session state changes without reading other bookings.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.reservation_sessions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
