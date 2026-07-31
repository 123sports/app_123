-- Payment foundation shared by local simulation and the future Mercado Pago adapter.

CREATE TABLE public.checkout_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('booking', 'class_plan')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'cancelled', 'failed', 'refunded', 'paid_needs_review')),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  description text NOT NULL,
  provider text NOT NULL DEFAULT 'mercado_pago',
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkout_orders_user_created
  ON public.checkout_orders (user_id, created_at DESC);
CREATE INDEX idx_checkout_orders_status_expires
  ON public.checkout_orders (status, expires_at);

CREATE TABLE public.checkout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_order_id uuid NOT NULL REFERENCES public.checkout_orders(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('booking', 'class_plan')),
  reference_id uuid,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount_cents integer NOT NULL CHECK (unit_amount_cents >= 0),
  total_amount_cents integer NOT NULL CHECK (total_amount_cents >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkout_items_order ON public.checkout_items (checkout_order_id);

CREATE TABLE public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_order_id uuid NOT NULL REFERENCES public.checkout_orders(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_order_id text,
  provider_payment_id text,
  payment_method text NOT NULL CHECK (payment_method IN ('pix')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'cancelled', 'failed', 'refunded')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  qr_code text,
  qr_code_base64 text,
  ticket_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_order_id),
  UNIQUE (provider, provider_payment_id)
);

CREATE INDEX idx_payment_attempts_order ON public.payment_attempts (checkout_order_id);

CREATE TABLE public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid REFERENCES public.payment_attempts(id) ON DELETE SET NULL,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS checkout_order_id uuid REFERENCES public.checkout_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bookings_checkout_order
  ON public.bookings (checkout_order_id);

-- Unpaid checkout holds must not look like confirmed reservations to the team.
CREATE OR REPLACE FUNCTION public.notify_on_booking_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student text;
  v_admin_id uuid;
BEGIN
  IF NEW.checkout_order_id IS NOT NULL
     AND NEW.payment_status = 'pendente'
  THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, 'Aluno')
  INTO v_student
  FROM public.profiles
  WHERE id = NEW.user_id;

  FOR v_admin_id IN
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  LOOP
    INSERT INTO public.notifications (user_id, title, body, kind, related_booking_id)
    VALUES (
      v_admin_id,
      'Nova reserva',
      v_student || ' reservou ' || to_char(NEW.booking_date, 'DD/MM') || ' às '
        || lpad(NEW.start_hour::text, 2, '0') || ':00',
      'booking_new',
      NEW.id
    );
  END LOOP;

  IF NEW.professor_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.user_roles
       WHERE user_id = NEW.professor_id AND role = 'admin'
     )
  THEN
    INSERT INTO public.notifications (user_id, title, body, kind, related_booking_id)
    VALUES (
      NEW.professor_id,
      'Você tem um novo horário reservado',
      v_student || ' reservou ' || to_char(NEW.booking_date, 'DD/MM') || ' às '
        || lpad(NEW.start_hour::text, 2, '0') || ':00',
      'booking_new',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_booking_date_start_hour_key;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot_unique
  ON public.bookings (booking_date, start_hour)
  WHERE status <> 'cancelada';

GRANT SELECT ON public.checkout_orders, public.checkout_items, public.payment_attempts TO authenticated;
GRANT ALL ON public.checkout_orders, public.checkout_items, public.payment_attempts, public.payment_events TO service_role;

ALTER TABLE public.checkout_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkout owner or admin read"
  ON public.checkout_orders FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "checkout items participant read"
  ON public.checkout_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.checkout_orders checkout_order
      WHERE checkout_order.id = checkout_order_id
        AND (
          checkout_order.user_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE POLICY "payment attempts participant read"
  ON public.payment_attempts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.checkout_orders checkout_order
      WHERE checkout_order.id = checkout_order_id
        AND (
          checkout_order.user_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE POLICY "payment events admin read"
  ON public.payment_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER checkout_orders_touch_updated
  BEFORE UPDATE ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER payment_attempts_touch_updated
  BEFORE UPDATE ON public.payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- A verified provider update on the order is the single source of truth that
-- confirms every booking linked to that checkout.
CREATE OR REPLACE FUNCTION public.finalize_paid_booking_checkout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  IF NEW.status <> 'paid' OR OLD.status = 'paid' OR NEW.kind <> 'booking' THEN
    RETURN NEW;
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
    AND (hold_expires_at IS NULL OR hold_expires_at > now());

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'Checkout % não possui reserva ativa para confirmação.', NEW.id;
  END IF;

  NEW.paid_at := COALESCE(NEW.paid_at, now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER checkout_orders_finalize_paid_booking
  BEFORE UPDATE OF status ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.finalize_paid_booking_checkout();

REVOKE EXECUTE ON FUNCTION public.finalize_paid_booking_checkout() FROM PUBLIC, anon, authenticated;

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
      payment_status = 'expirado'
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

  RETURN affected;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_booking_holds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_booking_holds() TO service_role;

CREATE OR REPLACE FUNCTION public.notify_on_checkout_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id uuid;
  professor_id uuid;
BEGIN
  IF NEW.status <> 'paid' OR OLD.status = 'paid' THEN
    RETURN NEW;
  END IF;

  BEGIN
    professor_id := NULLIF(NEW.metadata->>'professor_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    professor_id := NULL;
  END;

  FOR admin_id IN
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  LOOP
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      admin_id,
      'Pagamento Pix aprovado',
      NEW.description || ' · R$ ' || to_char(NEW.amount_cents / 100.0, 'FM999G999G990D00'),
      'payment_paid'
    );
  END LOOP;

  IF professor_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.user_roles
       WHERE user_id = professor_id AND role = 'admin'
     )
  THEN
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      professor_id,
      'Pagamento Pix aprovado',
      NEW.description || ' · R$ ' || to_char(NEW.amount_cents / 100.0, 'FM999G999G990D00'),
      'payment_paid'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_checkout_paid_notify
  AFTER UPDATE OF status ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_checkout_paid();

REVOKE EXECUTE ON FUNCTION public.notify_on_checkout_paid() FROM PUBLIC, anon, authenticated;

DROP VIEW IF EXISTS public.bookings_occupancy;
CREATE VIEW public.bookings_occupancy
WITH (security_invoker = off) AS
SELECT id, user_id, professor_id, booking_date, start_hour, type, status,
       payment_status, checkout_order_id, hold_expires_at
FROM public.bookings
WHERE status <> 'cancelada'
  AND (
    payment_status = 'pago'
    OR status = 'confirmada'
    OR (payment_status = 'pendente' AND hold_expires_at > now())
  );

GRANT SELECT ON public.bookings_occupancy TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.checkout_orders;
