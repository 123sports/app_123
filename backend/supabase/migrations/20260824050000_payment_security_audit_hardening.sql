-- Defense in depth for Pix reconciliation, payment data privacy and abuse control.

ALTER TABLE public.payment_attempts
  DROP CONSTRAINT IF EXISTS payment_attempts_status_check;
ALTER TABLE public.payment_attempts
  ADD CONSTRAINT payment_attempts_status_check
  CHECK (status IN (
    'pending', 'paid', 'expired', 'cancelled', 'failed', 'refunded',
    'paid_needs_review'
  ));

-- The full provider object may include CPF, email and other payer data. Keep
-- only the fields needed for reconciliation and support.
UPDATE public.payment_attempts
SET provider_payload = jsonb_strip_nulls(jsonb_build_object(
  'id', provider_payload->'id',
  'status', provider_payload->'status',
  'status_detail', provider_payload->'status_detail',
  'payment_method_id', provider_payload->'payment_method_id',
  'payment_type_id', provider_payload->'payment_type_id',
  'external_reference', provider_payload->'external_reference',
  'transaction_amount', provider_payload->'transaction_amount',
  'currency_id', provider_payload->'currency_id',
  'live_mode', provider_payload->'live_mode',
  'date_created', provider_payload->'date_created',
  'date_approved', provider_payload->'date_approved',
  'date_last_updated', provider_payload->'date_last_updated',
  'date_of_expiration', provider_payload->'date_of_expiration',
  'metadata', jsonb_strip_nulls(jsonb_build_object(
    'checkout_order_id', provider_payload#>'{metadata,checkout_order_id}'
  ))
))
WHERE provider = 'mercado_pago';

-- Students can read the Pix data of their own order, but raw provider data and
-- provider identifiers remain server-only. Staff use the sanitized order view.
REVOKE SELECT ON TABLE public.payment_attempts FROM authenticated;
GRANT SELECT (
  id, checkout_order_id, provider, payment_method, status, amount_cents,
  qr_code, qr_code_base64, ticket_url, expires_at, paid_at, created_at, updated_at
) ON TABLE public.payment_attempts TO authenticated;

DROP POLICY IF EXISTS "payment attempts participant read" ON public.payment_attempts;
CREATE POLICY "payment attempt owner read"
ON public.payment_attempts FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.checkout_orders checkout_order
    WHERE checkout_order.id = checkout_order_id
      AND checkout_order.user_id = auth.uid()
  )
);

-- Close the legacy profile policy that exposed CPF and contact details to every
-- logged-in student. The public view remains available for names and avatars.
DROP POLICY IF EXISTS "Anyone authenticated can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users read own profile or admins read all" ON public.profiles;
CREATE POLICY "Users read own profile or admins read all"
ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.enforce_checkout_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('checkout-rate:' || NEW.user_id::text, 0)
  );

  IF (
    SELECT COUNT(*)
    FROM public.checkout_orders checkout_order
    WHERE checkout_order.user_id = NEW.user_id
      AND checkout_order.created_at > now() - interval '10 minutes'
  ) >= 10 THEN
    RAISE EXCEPTION 'Muitas tentativas de pagamento. Aguarde alguns minutos.';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM public.checkout_orders checkout_order
    WHERE checkout_order.user_id = NEW.user_id
      AND checkout_order.created_at > now() - interval '24 hours'
  ) >= 50 THEN
    RAISE EXCEPTION 'Limite diario de tentativas de pagamento atingido.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_checkout_rate_limit()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS checkout_orders_rate_limit ON public.checkout_orders;
CREATE TRIGGER checkout_orders_rate_limit
  BEFORE INSERT ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_checkout_rate_limit();

CREATE OR REPLACE FUNCTION public.enforce_checkout_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'refunded' AND OLD.status <> 'refunded' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending'
     AND NEW.status IN ('paid', 'expired', 'cancelled', 'failed', 'paid_needs_review')
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('expired', 'cancelled', 'failed')
     AND NEW.status = 'paid_needs_review'
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid_needs_review'
     AND NEW.status IN ('paid', 'cancelled')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transicao financeira invalida: % -> %.', OLD.status, NEW.status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_checkout_order_status_transition()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS checkout_orders_00_enforce_status_transition
ON public.checkout_orders;
CREATE TRIGGER checkout_orders_00_enforce_status_transition
  BEFORE UPDATE OF status ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_checkout_order_status_transition();

CREATE OR REPLACE FUNCTION public.enforce_payment_attempt_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'refunded' AND OLD.status <> 'refunded' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('expired', 'cancelled', 'failed')
     AND NEW.status IN ('paid', 'paid_needs_review')
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid'
     AND NEW.status = 'paid_needs_review'
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid_needs_review'
     AND NEW.status = 'paid'
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transicao de tentativa de pagamento invalida: % -> %.', OLD.status, NEW.status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_payment_attempt_status_transition()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payment_attempts_00_enforce_status_transition
ON public.payment_attempts;
CREATE TRIGGER payment_attempts_00_enforce_status_transition
  BEFORE UPDATE OF status ON public.payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_attempt_status_transition();

-- A paid multi-slot checkout is valid only if every purchased item still has
-- one active booking and all amounts reconcile exactly.
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
  WHERE item.checkout_order_id = NEW.id
    AND item.item_type = 'booking';

  SELECT COUNT(*)::integer, COALESCE(SUM(booking.amount_cents), 0)
  INTO v_active_count, v_active_total
  FROM public.bookings booking
  WHERE booking.checkout_order_id = NEW.id
    AND booking.status = 'pendente'
    AND booking.payment_status = 'pendente'
    AND booking.hold_expires_at > now()
    AND EXISTS (
      SELECT 1
      FROM public.checkout_items item
      WHERE item.checkout_order_id = NEW.id
        AND item.item_type = 'booking'
        AND item.reference_id = booking.id
        AND item.total_amount_cents = booking.amount_cents
    );

  IF v_expected_count < 1
     OR v_expected_count <> v_active_count
     OR v_expected_total <> NEW.amount_cents
     OR v_active_total <> NEW.amount_cents
  THEN
    RAISE EXCEPTION 'Checkout % nao possui todas as reservas ativas para confirmacao.', NEW.id;
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

CREATE OR REPLACE FUNCTION public.apply_terminal_checkout_to_bookings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = OLD.status OR NEW.kind <> 'booking' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('expired', 'cancelled', 'failed') THEN
    UPDATE public.bookings
    SET status = 'cancelada',
        payment_status = CASE NEW.status
          WHEN 'expired' THEN 'expirado'
          WHEN 'cancelled' THEN 'cancelado'
          ELSE 'falhou'
        END,
        hold_expires_at = NULL
    WHERE checkout_order_id = NEW.id
      AND status = 'pendente'
      AND payment_status = 'pendente';
  ELSIF NEW.status = 'refunded' THEN
    UPDATE public.bookings
    SET status = CASE
          WHEN status IN ('pendente', 'confirmada') THEN 'cancelada'::public.booking_status
          ELSE status
        END,
        payment_status = 'estornado',
        hold_expires_at = NULL
    WHERE checkout_order_id = NEW.id
      AND payment_status <> 'estornado';

    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      NEW.user_id,
      'Pagamento estornado',
      'O estorno de ' || NEW.description || ' foi confirmado. Se precisar, escolha um novo horario na agenda.',
      'payment_refunded'
    );

    INSERT INTO public.notifications (user_id, title, body, kind)
    SELECT role_row.user_id,
           'Estorno confirmado',
           NEW.description || ' foi estornado e os horarios futuros vinculados foram liberados.',
           'payment_refunded'
    FROM public.user_roles role_row
    WHERE role_row.role = 'admin'
      AND role_row.user_id <> NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_terminal_checkout_to_bookings()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS checkout_orders_apply_terminal_bookings
ON public.checkout_orders;
CREATE TRIGGER checkout_orders_apply_terminal_bookings
  AFTER UPDATE OF status ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.apply_terminal_checkout_to_bookings();

-- Provider-linked bookings cannot have financial or structural fields changed
-- from an authenticated browser, including an administrator session.
CREATE OR REPLACE FUNCTION public.protect_booking_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text := COALESCE(auth.jwt()->>'role', '');
  is_admin boolean := public.has_role(auth.uid(), 'admin');
  is_assigned_professor boolean :=
    public.has_role(auth.uid(), 'professor') AND OLD.professor_id = auth.uid();
BEGIN
  IF caller_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF OLD.checkout_order_id IS NOT NULL THEN
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
      RAISE EXCEPTION 'Dados de uma reserva vinculada a pagamento sao exclusivos do servidor.';
    END IF;

    IF OLD.payment_status = 'pendente'
       AND NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status <> 'cancelada'
    THEN
      RAISE EXCEPTION 'Uma reserva pendente so pode ser confirmada pelo provedor de pagamento.';
    END IF;

    IF NOT is_admin AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cancele a cobranca completa para liberar os horarios.';
    END IF;
  END IF;

  IF is_admin THEN
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
      RAISE EXCEPTION 'Reservas pagas devem ser alteradas pelo fluxo de remarcacao.';
    END IF;
    IF (OLD.booking_date + make_time(OLD.start_hour, 0, 0)) < now() + interval '2 hours' THEN
      RAISE EXCEPTION 'Cancelamento exige duas horas de antecedencia.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_booking_sensitive_fields()
FROM PUBLIC, anon, authenticated;

CREATE TABLE public.checkout_order_status_history (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  checkout_order_id uuid NOT NULL
    REFERENCES public.checkout_orders(id) ON DELETE CASCADE,
  old_status text NOT NULL,
  new_status text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX checkout_order_status_history_order_changed_idx
  ON public.checkout_order_status_history (checkout_order_id, changed_at DESC);

ALTER TABLE public.checkout_order_status_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkout_order_status_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.checkout_order_status_history TO authenticated;
GRANT SELECT, INSERT ON public.checkout_order_status_history TO service_role;

CREATE POLICY "payment status history admin read"
ON public.checkout_order_status_history FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.audit_checkout_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.checkout_order_status_history (
      checkout_order_id, old_status, new_status, actor_user_id, actor_role
    )
    VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      auth.uid(),
      COALESCE(auth.jwt()->>'role', 'database')
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_checkout_order_status()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS checkout_orders_audit_status ON public.checkout_orders;
CREATE TRIGGER checkout_orders_audit_status
  AFTER UPDATE OF status ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_checkout_order_status();
