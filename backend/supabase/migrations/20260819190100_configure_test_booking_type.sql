INSERT INTO public.pricing (booking_type, price_cents, active)
VALUES ('teste', 100, true)
ON CONFLICT (booking_type) DO UPDATE
SET price_cents = EXCLUDED.price_cents,
    active = true,
    updated_at = now();

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

  IF p_booking_type NOT IN ('quadra_livre', 'teste') AND p_professor_id IS NULL THEN
    RAISE EXCEPTION 'Selecione um professor para a aula.';
  END IF;

  IF p_booking_type IN ('quadra_livre', 'teste') AND p_professor_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este tipo de reserva nao utiliza professor.';
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
    WHEN 'teste' THEN 'Teste'
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
