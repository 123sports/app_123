-- Final staff authorization rules and atomic booking checkout creation.

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
      COUNT(*) FILTER (WHERE booking.attended IS TRUE) AS attended,
      COUNT(*) FILTER (WHERE booking.attended IS FALSE) AS missed
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

CREATE OR REPLACE FUNCTION public.list_active_professors()
RETURNS TABLE (id uuid, full_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile.id, profile.full_name, profile.avatar_url
  FROM public.user_roles role_row
  JOIN public.profiles profile ON profile.id = role_row.user_id
  WHERE auth.uid() IS NOT NULL
    AND role_row.role = 'professor'
  ORDER BY profile.full_name NULLS LAST
$$;

REVOKE EXECUTE ON FUNCTION public.list_active_professors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_professors() TO authenticated;

DROP POLICY IF EXISTS "Professors update assigned bookings" ON public.bookings;
CREATE POLICY "Professors update assigned bookings"
ON public.bookings FOR UPDATE TO authenticated
USING (
  professor_id = auth.uid()
  AND public.has_role(auth.uid(), 'professor')
)
WITH CHECK (
  professor_id = auth.uid()
  AND public.has_role(auth.uid(), 'professor')
);

CREATE OR REPLACE FUNCTION public.protect_booking_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text := COALESCE(auth.jwt()->>'role', '');
  is_assigned_professor boolean :=
    public.has_role(auth.uid(), 'professor') AND OLD.professor_id = auth.uid();
BEGIN
  IF caller_role = 'service_role' OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF is_assigned_professor THEN
    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.card_operator_id IS DISTINCT FROM OLD.card_operator_id
       OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
       OR NEW.professor_id IS DISTINCT FROM OLD.professor_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
       OR NEW.start_hour IS DISTINCT FROM OLD.start_hour
       OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.checkout_order_id IS DISTINCT FROM OLD.checkout_order_id
       OR NEW.hold_expires_at IS DISTINCT FROM OLD.hold_expires_at
    THEN
      RAISE EXCEPTION 'O professor nao pode alterar dados financeiros ou estruturais da reserva.';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'confirmada' AND NEW.status = 'concluida')
    THEN
      RAISE EXCEPTION 'O professor so pode concluir uma reserva confirmada.';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.card_operator_id IS DISTINCT FROM OLD.card_operator_id
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
     OR NEW.attended IS DISTINCT FROM OLD.attended
     OR NEW.professor_id IS DISTINCT FROM OLD.professor_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
     OR NEW.start_hour IS DISTINCT FROM OLD.start_hour
     OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
     OR NEW.checkout_order_id IS DISTINCT FROM OLD.checkout_order_id
     OR NEW.hold_expires_at IS DISTINCT FROM OLD.hold_expires_at
  THEN
    RAISE EXCEPTION 'Voce nao tem permissao para alterar estes campos da reserva.';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status <> 'cancelada' THEN
      RAISE EXCEPTION 'Voce so pode cancelar a reserva.';
    END IF;
    IF OLD.payment_status = 'pago' THEN
      RAISE EXCEPTION 'Reservas pagas devem ser canceladas pelo administrador.';
    END IF;
    IF (OLD.booking_date + make_time(OLD.start_hour, 0, 0)) < now() + interval '2 hours' THEN
      RAISE EXCEPTION 'Cancelamento exige duas horas de antecedencia.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_booking_sensitive_fields() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Students can create their feedback" ON public.professor_feedback;
CREATE POLICY "Students can create validated feedback"
ON public.professor_feedback FOR INSERT TO authenticated
WITH CHECK (
  (
    (is_anonymous AND student_id IS NULL)
    OR (NOT is_anonymous AND student_id = auth.uid())
  )
  AND EXISTS (
    SELECT 1
    FROM public.bookings booking
    WHERE booking.user_id = auth.uid()
      AND booking.professor_id = professor_feedback.professor_id
  )
  AND char_length(COALESCE(comment, '')) <= 1000
  AND NOT approved_admin
  AND NOT approved_professor
  AND NOT featured
);

CREATE OR REPLACE FUNCTION public.protect_professor_feedback_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role'
     OR public.has_role(auth.uid(), 'admin')
  THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'professor')
     AND OLD.professor_id = auth.uid()
  THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.professor_id IS DISTINCT FROM OLD.professor_id
       OR NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.comment IS DISTINCT FROM OLD.comment
       OR NEW.is_anonymous IS DISTINCT FROM OLD.is_anonymous
       OR NEW.public_consent IS DISTINCT FROM OLD.public_consent
       OR NEW.approved_admin IS DISTINCT FROM OLD.approved_admin
       OR NEW.featured IS DISTINCT FROM OLD.featured
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'O professor so pode alterar sua propria aprovacao.';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Acesso negado.';
END;
$$;

DROP TRIGGER IF EXISTS protect_professor_feedback_fields
ON public.professor_feedback;
CREATE TRIGGER protect_professor_feedback_fields
  BEFORE UPDATE ON public.professor_feedback
  FOR EACH ROW EXECUTE FUNCTION public.protect_professor_feedback_fields();

REVOKE EXECUTE ON FUNCTION public.protect_professor_feedback_fields()
FROM PUBLIC, anon, authenticated;

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
  v_order_id uuid := gen_random_uuid();
  v_booking_id uuid;
  v_booking_ids uuid[] := ARRAY[]::uuid[];
  v_unit_amount_cents integer;
  v_amount_cents integer;
  v_expires_at timestamptz := now() + interval '30 minutes';
  v_product_label text;
  v_description text;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao exclusiva do servidor.';
  END IF;

  PERFORM public.cleanup_expired_booking_holds();

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Usuario nao encontrado.';
  END IF;

  IF p_booking_date < current_date
     OR p_booking_date > current_date + 31
  THEN
    RAISE EXCEPTION 'Data fora da janela permitida para reservas.';
  END IF;

  SELECT array_agg(DISTINCT selected_hour ORDER BY selected_hour)
  INTO v_hours
  FROM unnest(p_hours) AS selected_hour;

  IF COALESCE(cardinality(v_hours), 0) < 1
     OR cardinality(v_hours) > 8
     OR EXISTS (SELECT 1 FROM unnest(v_hours) AS selected_hour WHERE selected_hour < 6 OR selected_hour > 22)
  THEN
    RAISE EXCEPTION 'Selecao de horarios invalida.';
  END IF;

  IF p_booking_type <> 'quadra_livre' AND p_professor_id IS NULL THEN
    RAISE EXCEPTION 'Selecione um professor para a aula.';
  END IF;

  IF p_booking_type = 'quadra_livre' AND p_professor_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quadra livre nao utiliza professor.';
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
    RAISE EXCEPTION 'Cancele ou conclua uma cobranca pendente antes de continuar.';
  END IF;

  SELECT pricing_row.price_cents
  INTO v_unit_amount_cents
  FROM public.pricing pricing_row
  WHERE pricing_row.booking_type = p_booking_type
    AND pricing_row.active
  LIMIT 1;

  IF v_unit_amount_cents IS NULL OR v_unit_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Preco indisponivel para este tipo de reserva.';
  END IF;

  v_amount_cents := v_unit_amount_cents * cardinality(v_hours);
  v_product_label := CASE p_booking_type
    WHEN 'quadra_livre' THEN 'Quadra livre'
    WHEN 'aula_individual' THEN 'Aula individual'
    WHEN 'aula_dupla' THEN 'Aula em dupla'
    WHEN 'aula_trio' THEN 'Aula em trio'
    WHEN 'aula_quarteto' THEN 'Aula em quarteto'
  END;
  v_description := v_product_label || ' em ' || to_char(p_booking_date, 'DD/MM/YYYY')
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
      'professor_id', p_professor_id,
      'quantity', cardinality(v_hours),
      'unit_amount_cents', v_unit_amount_cents
    )
  );

  FOREACH v_hour IN ARRAY v_hours
  LOOP
    v_booking_id := gen_random_uuid();
    v_booking_ids := array_append(v_booking_ids, v_booking_id);

    INSERT INTO public.bookings (
      id, user_id, professor_id, booking_date, start_hour, duration_hours,
      type, status, payment_status, payment_method, price_cents, amount_cents,
      checkout_order_id, hold_expires_at, confirmed_at, attended
    )
    VALUES (
      v_booking_id, p_user_id, p_professor_id, p_booking_date, v_hour, 1,
      p_booking_type, 'pendente', 'pendente', 'pix', v_unit_amount_cents,
      v_unit_amount_cents, v_order_id, v_expires_at, NULL, false
    );

    INSERT INTO public.checkout_items (
      checkout_order_id, item_type, reference_id, description, quantity,
      unit_amount_cents, total_amount_cents, metadata
    )
    VALUES (
      v_order_id, 'booking', v_booking_id,
      v_product_label || ' - ' || to_char(p_booking_date, 'DD/MM/YYYY')
        || ' as ' || lpad(v_hour::text, 2, '0') || 'h',
      1, v_unit_amount_cents, v_unit_amount_cents,
      jsonb_build_object(
        'booking_type', p_booking_type,
        'booking_date', p_booking_date,
        'start_hour', v_hour
      )
    );
  END LOOP;

  UPDATE public.checkout_orders
  SET metadata = metadata || jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'booking_ids', to_jsonb(v_booking_ids),
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
