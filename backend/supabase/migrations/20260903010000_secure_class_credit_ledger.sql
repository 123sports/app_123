-- Secure class-plan purchases, auditable lesson credits and credit-backed bookings.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.class_plans
  ADD COLUMN IF NOT EXISTS credit_modality text,
  ADD COLUMN IF NOT EXISTS credit_quantity integer;

UPDATE public.class_plans
SET credit_modality = CASE
      WHEN lower(trim(modality)) = 'individual' THEN 'individual'
      WHEN lower(trim(modality)) = 'dupla' THEN 'dupla'
      ELSE 'grupo'
    END,
    credit_quantity = LEAST(100, GREATEST(1, frequency_per_week * duration_months * 4))
WHERE credit_modality IS NULL OR credit_quantity IS NULL;

UPDATE public.class_plans
SET modality = CASE credit_modality
  WHEN 'individual' THEN 'Individual'
  WHEN 'dupla' THEN 'Dupla'
  ELSE 'Grupo'
END;

ALTER TABLE public.class_plans
  ALTER COLUMN credit_modality SET NOT NULL,
  ALTER COLUMN credit_quantity SET NOT NULL,
  DROP CONSTRAINT IF EXISTS class_plans_frequency_per_week_duration_months_key,
  DROP CONSTRAINT IF EXISTS class_plans_credit_modality_check,
  DROP CONSTRAINT IF EXISTS class_plans_credit_quantity_check,
  DROP CONSTRAINT IF EXISTS class_plans_modality_credit_consistency_check,
  ADD CONSTRAINT class_plans_credit_modality_check
    CHECK (credit_modality IN ('individual', 'dupla', 'grupo')),
  ADD CONSTRAINT class_plans_credit_quantity_check
    CHECK (credit_quantity BETWEEN 1 AND 100),
  ADD CONSTRAINT class_plans_modality_credit_consistency_check
    CHECK (lower(trim(modality)) = credit_modality);

-- Financial products are deactivated instead of deleted so old purchases keep
-- their original reference. Every relevant edit is recorded as a snapshot.
GRANT INSERT, UPDATE ON public.class_plans TO authenticated;
REVOKE DELETE ON public.class_plans FROM authenticated;

CREATE TABLE public.class_plan_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_plan_id uuid NOT NULL REFERENCES public.class_plans(id) ON DELETE RESTRICT,
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX class_plan_change_history_plan_changed_idx
  ON public.class_plan_change_history (class_plan_id, changed_at DESC);

ALTER TABLE public.class_plan_change_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.class_plan_change_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.class_plan_change_history TO authenticated, service_role;

CREATE POLICY "class plan history admin read"
ON public.class_plan_change_history FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.audit_class_plan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.frequency_per_week IS DISTINCT FROM OLD.frequency_per_week
     OR NEW.duration_months IS DISTINCT FROM OLD.duration_months
     OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
     OR NEW.active IS DISTINCT FROM OLD.active
     OR NEW.modality IS DISTINCT FROM OLD.modality
     OR NEW.class_duration_min IS DISTINCT FROM OLD.class_duration_min
     OR NEW.credit_modality IS DISTINCT FROM OLD.credit_modality
     OR NEW.credit_quantity IS DISTINCT FROM OLD.credit_quantity
  THEN
    INSERT INTO public.class_plan_change_history (
      class_plan_id, old_values, new_values, changed_by
    )
    VALUES (
      OLD.id,
      jsonb_build_object(
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
      ),
      jsonb_build_object(
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
      ),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_class_plan_change()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS class_plans_audit_change ON public.class_plans;
CREATE TRIGGER class_plans_audit_change
  AFTER UPDATE ON public.class_plans
  FOR EACH ROW EXECUTE FUNCTION public.audit_class_plan_change();

CREATE TABLE public.student_credit_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  class_plan_id uuid NOT NULL REFERENCES public.class_plans(id) ON DELETE RESTRICT,
  checkout_order_id uuid NOT NULL UNIQUE
    REFERENCES public.checkout_orders(id) ON DELETE RESTRICT,
  modality text NOT NULL CHECK (modality IN ('individual', 'dupla', 'grupo')),
  credits_granted integer NOT NULL CHECK (credits_granted BETWEEN 1 AND 100),
  amount_paid_cents integer NOT NULL CHECK (amount_paid_cents > 0),
  plan_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'refunded')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  refunded_at timestamptz,
  CHECK (
    (status = 'active' AND refunded_at IS NULL)
    OR (status = 'refunded' AND refunded_at IS NOT NULL)
  )
);

CREATE INDEX student_credit_grants_user_idx
  ON public.student_credit_grants (user_id, granted_at, id);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS credit_grant_id uuid
    REFERENCES public.student_credit_grants(id) ON DELETE RESTRICT;

CREATE TABLE public.student_credit_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.student_credit_grants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'consumed', 'returned', 'forfeited', 'revoked')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (
    (status = 'reserved' AND resolved_at IS NULL)
    OR (status <> 'reserved' AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX student_credit_allocations_grant_idx
  ON public.student_credit_allocations (grant_id, status);
CREATE INDEX student_credit_allocations_user_idx
  ON public.student_credit_allocations (user_id, reserved_at DESC);

CREATE TABLE public.student_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_no bigint NOT NULL DEFAULT 0,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  grant_id uuid NOT NULL REFERENCES public.student_credit_grants(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE RESTRICT,
  checkout_order_id uuid REFERENCES public.checkout_orders(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (
    entry_type IN (
      'purchase_grant', 'booking_debit', 'cancellation_credit',
      'late_cancellation_forfeit', 'refund_reversal'
    )
  ),
  credit_delta integer NOT NULL CHECK (abs(credit_delta) <= 100),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 300),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash text NOT NULL,
  entry_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sequence_no),
  CHECK (
    (entry_type = 'purchase_grant' AND credit_delta > 0 AND checkout_order_id IS NOT NULL AND booking_id IS NULL)
    OR (entry_type = 'booking_debit' AND credit_delta = -1 AND booking_id IS NOT NULL)
    OR (entry_type = 'cancellation_credit' AND credit_delta = 1 AND booking_id IS NOT NULL)
    OR (entry_type = 'late_cancellation_forfeit' AND credit_delta = 0 AND booking_id IS NOT NULL)
    OR (entry_type = 'refund_reversal' AND credit_delta <= 0 AND checkout_order_id IS NOT NULL)
  )
);

CREATE INDEX student_credit_ledger_user_created_idx
  ON public.student_credit_ledger (user_id, sequence_no DESC);
CREATE INDEX student_credit_ledger_grant_created_idx
  ON public.student_credit_ledger (grant_id, sequence_no);
CREATE UNIQUE INDEX student_credit_ledger_purchase_uidx
  ON public.student_credit_ledger (checkout_order_id)
  WHERE entry_type = 'purchase_grant';
CREATE UNIQUE INDEX student_credit_ledger_booking_debit_uidx
  ON public.student_credit_ledger (booking_id)
  WHERE entry_type = 'booking_debit';
CREATE UNIQUE INDEX student_credit_ledger_cancellation_uidx
  ON public.student_credit_ledger (booking_id)
  WHERE entry_type IN ('cancellation_credit', 'late_cancellation_forfeit');

ALTER TABLE public.student_credit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_credit_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_credit_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.student_credit_grants FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.student_credit_allocations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.student_credit_ledger FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.student_credit_grants TO authenticated, service_role;
GRANT SELECT ON public.student_credit_allocations TO authenticated, service_role;
GRANT SELECT ON public.student_credit_ledger TO authenticated, service_role;

CREATE POLICY "credit grants owner or admin read"
ON public.student_credit_grants FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "credit allocations owner or admin read"
ON public.student_credit_allocations FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "credit ledger owner or admin read"
ON public.student_credit_ledger FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.seal_credit_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_previous_hash text;
  v_payload text;
  v_current_balance integer;
  v_max_balance integer;
  v_previous_sequence bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('credit-ledger:' || NEW.user_id::text, 0)
  );

  SELECT ledger.entry_hash, ledger.sequence_no
  INTO v_previous_hash, v_previous_sequence
  FROM public.student_credit_ledger ledger
  WHERE ledger.user_id = NEW.user_id
  ORDER BY ledger.sequence_no DESC
  LIMIT 1;

  NEW.sequence_no := COALESCE(v_previous_sequence, 0) + 1;

  SELECT grant_row.credits_granted INTO v_max_balance
  FROM public.student_credit_grants grant_row
  WHERE grant_row.id = NEW.grant_id
    AND grant_row.user_id = NEW.user_id;

  IF v_max_balance IS NULL THEN
    RAISE EXCEPTION 'Credito financeiro invalido.';
  END IF;

  SELECT COALESCE(SUM(ledger.credit_delta), 0)::integer INTO v_current_balance
  FROM public.student_credit_ledger ledger
  WHERE ledger.grant_id = NEW.grant_id;

  IF NEW.entry_type = 'purchase_grant'
     AND (v_current_balance <> 0 OR NEW.credit_delta <> v_max_balance)
  THEN
    RAISE EXCEPTION 'O lancamento inicial nao corresponde aos creditos comprados.';
  END IF;

  IF v_current_balance + NEW.credit_delta < 0
     OR v_current_balance + NEW.credit_delta > v_max_balance
  THEN
    RAISE EXCEPTION 'O lancamento produziria um saldo de creditos invalido.';
  END IF;

  NEW.previous_hash := COALESCE(v_previous_hash, repeat('0', 64));
  v_payload := concat_ws(
    '|',
    'v2', NEW.sequence_no::text, NEW.id::text, NEW.user_id::text, NEW.grant_id::text,
    COALESCE(NEW.booking_id::text, ''), COALESCE(NEW.checkout_order_id::text, ''),
    NEW.entry_type, NEW.credit_delta::text, NEW.idempotency_key, NEW.reason,
    COALESCE(NEW.actor_user_id::text, ''), NEW.metadata::text,
    to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
  );
  NEW.entry_hash := encode(digest(NEW.previous_hash || '|' || v_payload, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seal_credit_ledger_entry()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER student_credit_ledger_seal
  BEFORE INSERT ON public.student_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.seal_credit_ledger_entry();

CREATE OR REPLACE FUNCTION public.prevent_credit_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'O historico de creditos e imutavel.';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_credit_ledger_mutation()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER student_credit_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.student_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.prevent_credit_ledger_mutation();

CREATE OR REPLACE FUNCTION public.append_credit_ledger_entry(
  p_user_id uuid,
  p_grant_id uuid,
  p_booking_id uuid,
  p_checkout_order_id uuid,
  p_entry_type text,
  p_credit_delta integer,
  p_idempotency_key text,
  p_reason text,
  p_actor_user_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_grant_checkout_order_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('credit-ledger:' || p_user_id::text, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('credit-ledger-entry:' || p_idempotency_key, 0)
  );

  SELECT grant_row.checkout_order_id INTO v_grant_checkout_order_id
  FROM public.student_credit_grants grant_row
  WHERE grant_row.id = p_grant_id AND grant_row.user_id = p_user_id;

  IF v_grant_checkout_order_id IS NULL THEN
    RAISE EXCEPTION 'Credito financeiro invalido.';
  END IF;

  IF p_checkout_order_id IS NOT NULL
     AND p_checkout_order_id IS DISTINCT FROM v_grant_checkout_order_id
  THEN
    RAISE EXCEPTION 'A cobranca nao corresponde ao credito informado.';
  END IF;

  IF p_booking_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bookings booking
    WHERE booking.id = p_booking_id
      AND booking.user_id = p_user_id
      AND booking.credit_grant_id = p_grant_id
  ) THEN
    RAISE EXCEPTION 'A reserva nao corresponde ao credito informado.';
  END IF;

  SELECT id INTO v_entry_id
  FROM public.student_credit_ledger
  WHERE idempotency_key = p_idempotency_key
    AND user_id = p_user_id
    AND grant_id = p_grant_id
    AND booking_id IS NOT DISTINCT FROM p_booking_id
    AND checkout_order_id IS NOT DISTINCT FROM p_checkout_order_id
    AND entry_type = p_entry_type
    AND credit_delta = p_credit_delta;
  IF v_entry_id IS NOT NULL THEN
    RETURN v_entry_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.student_credit_ledger
    WHERE idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'A chave idempotente ja foi usada em outro lancamento.';
  END IF;

  INSERT INTO public.student_credit_ledger (
    user_id, grant_id, booking_id, checkout_order_id, entry_type,
    credit_delta, idempotency_key, reason, actor_user_id, metadata,
    previous_hash, entry_hash
  )
  VALUES (
    p_user_id, p_grant_id, p_booking_id, p_checkout_order_id, p_entry_type,
    p_credit_delta, p_idempotency_key, p_reason, p_actor_user_id,
    COALESCE(p_metadata, '{}'::jsonb), repeat('0', 64), repeat('0', 64)
  )
  RETURNING id INTO v_entry_id;
  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.append_credit_ledger_entry(
  uuid, uuid, uuid, uuid, text, integer, text, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verify_student_credit_ledger(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_entry public.student_credit_ledger%ROWTYPE;
  v_previous_hash text := repeat('0', 64);
  v_expected_hash text;
  v_payload text;
  v_count integer := 0;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role'
     AND auth.uid() IS DISTINCT FROM p_user_id
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN
    RAISE EXCEPTION 'Voce nao tem permissao para verificar este historico.';
  END IF;

  FOR v_entry IN
    SELECT * FROM public.student_credit_ledger ledger
    WHERE ledger.user_id = p_user_id
    ORDER BY ledger.sequence_no
  LOOP
    v_payload := concat_ws(
      '|',
      'v2', v_entry.sequence_no::text, v_entry.id::text,
      v_entry.user_id::text, v_entry.grant_id::text,
      COALESCE(v_entry.booking_id::text, ''),
      COALESCE(v_entry.checkout_order_id::text, ''),
      v_entry.entry_type, v_entry.credit_delta::text,
      v_entry.idempotency_key, v_entry.reason,
      COALESCE(v_entry.actor_user_id::text, ''), v_entry.metadata::text,
      to_char(v_entry.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    );
    v_expected_hash := encode(digest(v_previous_hash || '|' || v_payload, 'sha256'), 'hex');

    IF v_entry.previous_hash IS DISTINCT FROM v_previous_hash
       OR v_entry.entry_hash IS DISTINCT FROM v_expected_hash
    THEN
      RETURN jsonb_build_object(
        'valid', false,
        'checked_entries', v_count,
        'invalid_entry_id', v_entry.id,
        'invalid_sequence_no', v_entry.sequence_no
      );
    END IF;

    v_previous_hash := v_entry.entry_hash;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'valid', true,
    'checked_entries', v_count,
    'last_hash', v_previous_hash
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_student_credit_ledger(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_student_credit_ledger(uuid)
TO authenticated, service_role;

DROP VIEW IF EXISTS public.student_credit_balances;
CREATE VIEW public.student_credit_balances
WITH (security_invoker = true, security_barrier = true) AS
SELECT
  grant_row.id AS grant_id,
  grant_row.user_id,
  grant_row.class_plan_id,
  grant_row.checkout_order_id,
  grant_row.modality,
  grant_row.credits_granted,
  COALESCE(SUM(ledger.credit_delta), 0)::integer AS available_credits,
  grant_row.amount_paid_cents,
  grant_row.plan_snapshot,
  grant_row.status,
  grant_row.granted_at,
  grant_row.refunded_at
FROM public.student_credit_grants grant_row
LEFT JOIN public.student_credit_ledger ledger ON ledger.grant_id = grant_row.id
GROUP BY grant_row.id;

REVOKE ALL ON public.student_credit_balances FROM PUBLIC, anon;
GRANT SELECT ON public.student_credit_balances TO authenticated, service_role;

DROP VIEW IF EXISTS public.student_credit_summary;
CREATE VIEW public.student_credit_summary
WITH (security_invoker = true, security_barrier = true) AS
SELECT
  user_id,
  modality,
  COALESCE(SUM(available_credits), 0)::integer AS available_credits,
  COALESCE(SUM(credits_granted), 0)::integer AS credits_acquired
FROM public.student_credit_balances
WHERE status = 'active'
GROUP BY user_id, modality;

REVOKE ALL ON public.student_credit_summary FROM PUBLIC, anon;
GRANT SELECT ON public.student_credit_summary TO authenticated, service_role;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_single_financial_source,
  ADD CONSTRAINT bookings_single_financial_source
    CHECK (checkout_order_id IS NULL OR credit_grant_id IS NULL),
  DROP CONSTRAINT IF EXISTS bookings_credit_financial_shape,
  ADD CONSTRAINT bookings_credit_financial_shape CHECK (
    (
      credit_grant_id IS NULL
      AND payment_method IS DISTINCT FROM 'credito_plano'
    )
    OR
    (
      credit_grant_id IS NOT NULL
      AND checkout_order_id IS NULL
      AND payment_status = 'pago'
      AND payment_method = 'credito_plano'
      AND price_cents = 0
      AND amount_cents = 0
      AND hold_expires_at IS NULL
    )
  );

CREATE INDEX bookings_credit_grant_idx
  ON public.bookings (credit_grant_id)
  WHERE credit_grant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_credit_booking_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_staff boolean;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.credit_grant_id IS NOT NULL OR NEW.payment_method = 'credito_plano' THEN
      RAISE EXCEPTION 'Reservas com credito so podem ser criadas pelo servidor.';
    END IF;
    RETURN NEW;
  END IF;

  v_is_staff := public.has_role(auth.uid(), 'admin')
    OR (
      public.has_role(auth.uid(), 'professor')
      AND OLD.professor_id = auth.uid()
    );

  IF TG_OP = 'DELETE' AND OLD.credit_grant_id IS NOT NULL THEN
    RAISE EXCEPTION 'Reservas pagas com credito so podem ser alteradas pelo servidor.';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (
       OLD.credit_grant_id IS NOT NULL
       OR NEW.credit_grant_id IS NOT NULL
       OR OLD.payment_method = 'credito_plano'
       OR NEW.payment_method = 'credito_plano'
     )
  THEN
    IF v_is_staff
       AND (
         NEW.status = OLD.status
         OR (OLD.status = 'confirmada' AND NEW.status = 'concluida')
       )
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
       AND NEW.professor_id IS NOT DISTINCT FROM OLD.professor_id
       AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
       AND NEW.start_hour IS NOT DISTINCT FROM OLD.start_hour
       AND NEW.duration_hours IS NOT DISTINCT FROM OLD.duration_hours
       AND NEW.type IS NOT DISTINCT FROM OLD.type
       AND NEW.price_cents IS NOT DISTINCT FROM OLD.price_cents
       AND NEW.payment_status IS NOT DISTINCT FROM OLD.payment_status
       AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method
       AND NEW.card_operator_id IS NOT DISTINCT FROM OLD.card_operator_id
       AND NEW.amount_cents IS NOT DISTINCT FROM OLD.amount_cents
       AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at
       AND NEW.checkout_order_id IS NOT DISTINCT FROM OLD.checkout_order_id
       AND NEW.hold_expires_at IS NOT DISTINCT FROM OLD.hold_expires_at
       AND NEW.session_id IS NOT DISTINCT FROM OLD.session_id
       AND NEW.credit_grant_id IS NOT DISTINCT FROM OLD.credit_grant_id
       AND NEW.notes IS NOT DISTINCT FROM OLD.notes
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Reservas pagas com credito so podem ser alteradas pelo servidor.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_credit_booking_fields()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS bookings_protect_credit_fields ON public.bookings;
CREATE TRIGGER bookings_protect_credit_fields
  BEFORE INSERT OR UPDATE OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.protect_credit_booking_fields();

-- related_checkout_order_id was added after the original notification guard.
-- Keep payment references server-managed while allowing recipients to mark a
-- notification as read.
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
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Somente o estado de leitura pode ser alterado.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_notification_fields()
FROM PUBLIC, anon, authenticated, service_role;

-- The same person can be both the administrator and the professor. Consolidate
-- recipients so a confirmed credit booking creates only one staff notification.
CREATE OR REPLACE FUNCTION public.notify_on_booking_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student text;
BEGIN
  IF NEW.checkout_order_id IS NOT NULL
     AND NEW.payment_status = 'pendente'
  THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(profile.full_name, 'Aluno') INTO v_student
  FROM public.profiles profile
  WHERE profile.id = NEW.user_id;
  v_student := COALESCE(v_student, 'Aluno');

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_booking_id
  )
  SELECT
    recipient.user_id,
    CASE
      WHEN NEW.payment_method = 'credito_plano' THEN 'Nova aula com crédito'
      ELSE 'Nova reserva'
    END,
    v_student || ' reservou ' || to_char(NEW.booking_date, 'DD/MM') || ' às '
      || lpad(NEW.start_hour::text, 2, '0') || ':00'
      || CASE
        WHEN NEW.payment_method = 'credito_plano' THEN ' usando um crédito do plano.'
        ELSE '.'
      END,
    'booking_new',
    NEW.id
  FROM (
    SELECT role_row.user_id
    FROM public.user_roles role_row
    WHERE role_row.role = 'admin'
    UNION
    SELECT NEW.professor_id
    WHERE NEW.professor_id IS NOT NULL
  ) recipient
  WHERE recipient.user_id <> NEW.user_id;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_on_booking_insert()
FROM PUBLIC, anon, authenticated, service_role;

-- The shared-session migration validates direct Pix reservations against the
-- session price. Credit-backed reservations deliberately have zero new charge,
-- but must be linked to an active, compatible grant owned by the student.
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

  IF TG_OP = 'INSERT' THEN
    IF NEW.duration_hours <> 1 THEN
      RAISE EXCEPTION 'A duracao da reserva nao corresponde a sessao.';
    END IF;

    IF NEW.credit_grant_id IS NULL THEN
      IF NEW.price_cents IS DISTINCT FROM v_session.unit_price_cents
         OR NEW.amount_cents IS DISTINCT FROM v_session.unit_price_cents
      THEN
        RAISE EXCEPTION 'O valor da reserva nao corresponde a sessao.';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1
      FROM public.student_credit_grants grant_row
      WHERE grant_row.id = NEW.credit_grant_id
        AND grant_row.user_id = NEW.user_id
        AND grant_row.status = 'active'
        AND CASE grant_row.modality
          WHEN 'individual' THEN NEW.type = 'aula_individual'
          WHEN 'dupla' THEN NEW.type = 'aula_dupla'
          WHEN 'grupo' THEN NEW.type IN ('aula_trio', 'aula_quarteto')
          ELSE false
        END
    ) THEN
      RAISE EXCEPTION 'O credito informado nao pertence ao aluno ou nao aceita esta aula.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_booking_session_consistency()
FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.site_settings (key, value)
VALUES ('cancellation_notice_hours', '24')
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Public can view safe settings" ON public.site_settings;
CREATE POLICY "Public can view safe settings"
ON public.site_settings FOR SELECT TO anon, authenticated
USING (
  key IN (
    'whatsapp_number',
    'whatsapp_message',
    'social_instagram',
    'social_facebook',
    'social_youtube',
    'social_tiktok',
    'social_website',
    'referral_welcome_title',
    'referral_welcome_bonus',
    'cancellation_notice_hours'
  )
);

CREATE OR REPLACE FUNCTION public.is_credit_modality_compatible(
  p_modality text,
  p_booking_type public.booking_type
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_modality
    WHEN 'individual' THEN p_booking_type = 'aula_individual'
    WHEN 'dupla' THEN p_booking_type = 'aula_dupla'
    WHEN 'grupo' THEN p_booking_type IN ('aula_trio', 'aula_quarteto')
    ELSE false
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_credit_modality_compatible(text, public.booking_type)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_class_plan_checkout(
  p_user_id uuid,
  p_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.class_plans%ROWTYPE;
  v_order_id uuid := gen_random_uuid();
  v_expires_at timestamptz := now() + interval '30 minutes';
  v_description text;
  v_snapshot jsonb;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao exclusiva do servidor.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Usuario nao encontrado.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('class-plan-checkout:' || p_user_id::text, 0)
  );

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

  IF (
    SELECT COUNT(*)
    FROM public.checkout_orders checkout_order
    WHERE checkout_order.user_id = p_user_id
      AND checkout_order.status = 'pending'
      AND checkout_order.expires_at > now()
  ) >= 3 THEN
    RAISE EXCEPTION 'Conclua ou cancele uma cobranca pendente antes de continuar.';
  END IF;

  v_description := v_plan.title || ' - ' || v_plan.credit_quantity::text
    || CASE WHEN v_plan.credit_quantity = 1 THEN ' aula' ELSE ' aulas' END;
  v_snapshot := jsonb_build_object(
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

  INSERT INTO public.checkout_orders (
    id, user_id, kind, status, currency, amount_cents, description,
    provider, idempotency_key, expires_at, metadata
  )
  VALUES (
    v_order_id, p_user_id, 'class_plan', 'pending', 'BRL',
    v_plan.price_cents, v_description, 'mercado_pago', v_order_id,
    v_expires_at, jsonb_build_object('plan_snapshot', v_snapshot)
  );

  INSERT INTO public.checkout_items (
    checkout_order_id, item_type, reference_id, description, quantity,
    unit_amount_cents, total_amount_cents, metadata
  )
  VALUES (
    v_order_id, 'class_plan', v_plan.id, v_description, 1,
    v_plan.price_cents, v_plan.price_cents, v_snapshot
  );

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'booking_ids', '[]'::jsonb,
    'session_ids', '[]'::jsonb,
    'amount_cents', v_plan.price_cents,
    'description', v_description,
    'expires_at', v_expires_at,
    'idempotency_key', v_order_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_class_plan_checkout(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_class_plan_checkout(uuid, uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.issue_paid_plan_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.checkout_items%ROWTYPE;
  v_grant_id uuid;
  v_snapshot jsonb;
  v_modality text;
  v_quantity integer;
  v_snapshot_price integer;
  v_student_name text;
  v_admin_id uuid;
  v_amount text;
BEGIN
  IF NEW.kind <> 'class_plan'
     OR NEW.status <> 'paid'
     OR OLD.status = 'paid'
  THEN
    RETURN NEW;
  END IF;

  SELECT item.* INTO v_item
  FROM public.checkout_items item
  WHERE item.checkout_order_id = NEW.id
    AND item.item_type = 'class_plan';

  IF v_item.id IS NULL
     OR (SELECT COUNT(*) FROM public.checkout_items item WHERE item.checkout_order_id = NEW.id) <> 1
     OR v_item.quantity <> 1
     OR v_item.unit_amount_cents <> NEW.amount_cents
     OR v_item.total_amount_cents <> NEW.amount_cents
     OR NOT EXISTS (
       SELECT 1 FROM public.payment_attempts attempt
       WHERE attempt.checkout_order_id = NEW.id
         AND attempt.status = 'paid'
         AND attempt.payment_method = 'pix'
         AND attempt.amount_cents = NEW.amount_cents
     )
  THEN
    RAISE EXCEPTION 'A compra do plano nao possui conciliacao financeira valida.';
  END IF;

  v_snapshot := v_item.metadata;
  v_modality := v_snapshot->>'credit_modality';
  BEGIN
    v_quantity := (v_snapshot->>'credit_quantity')::integer;
    v_snapshot_price := (v_snapshot->>'price_cents')::integer;
  EXCEPTION WHEN invalid_text_representation THEN
    v_quantity := NULL;
    v_snapshot_price := NULL;
  END;

  IF v_item.reference_id IS NULL
     OR v_snapshot->>'plan_id' IS DISTINCT FROM v_item.reference_id::text
     OR v_snapshot_price IS DISTINCT FROM NEW.amount_cents
     OR v_quantity IS NULL
     OR v_quantity NOT BETWEEN 1 AND 100
     OR v_modality IS NULL
     OR v_modality NOT IN ('individual', 'dupla', 'grupo')
  THEN
    RAISE EXCEPTION 'A compra do plano possui um snapshot invalido.';
  END IF;

  INSERT INTO public.student_credit_grants (
    user_id, class_plan_id, checkout_order_id, modality,
    credits_granted, amount_paid_cents, plan_snapshot, granted_at
  )
  VALUES (
    NEW.user_id, v_item.reference_id, NEW.id, v_modality,
    v_quantity, NEW.amount_cents, v_snapshot, COALESCE(NEW.paid_at, now())
  )
  ON CONFLICT (checkout_order_id) DO NOTHING
  RETURNING id INTO v_grant_id;

  IF v_grant_id IS NULL THEN
    SELECT id INTO v_grant_id
    FROM public.student_credit_grants
    WHERE checkout_order_id = NEW.id;
  END IF;

  PERFORM public.append_credit_ledger_entry(
    NEW.user_id,
    v_grant_id,
    NULL,
    NEW.id,
    'purchase_grant',
    v_quantity,
    'plan-purchase:' || NEW.id::text,
    'Creditos liberados por Pix confirmado.',
    NULL,
    jsonb_build_object('plan_snapshot', v_snapshot)
  );

  SELECT COALESCE(profile.full_name, 'Aluno') INTO v_student_name
  FROM public.profiles profile WHERE profile.id = NEW.user_id;
  v_student_name := COALESCE(v_student_name, 'Aluno');
  v_amount := 'R$ ' || (NEW.amount_cents / 100)::text || ','
    || lpad((NEW.amount_cents % 100)::text, 2, '0');

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_checkout_order_id
  )
  VALUES (
    NEW.user_id,
    'Créditos liberados',
    'Tudo certo! Recebemos seu Pix de ' || v_amount || ' e liberamos '
      || v_quantity::text || CASE WHEN v_quantity = 1 THEN ' crédito de aula.' ELSE ' créditos de aula.' END,
    'credits_granted',
    NEW.id
  );

  FOR v_admin_id IN
    SELECT role_row.user_id FROM public.user_roles role_row
    WHERE role_row.role = 'admin' AND role_row.user_id <> NEW.user_id
  LOOP
    INSERT INTO public.notifications (
      user_id, title, body, kind, related_checkout_order_id
    )
    VALUES (
      v_admin_id,
      'Plano pago por Pix',
      v_student_name || ' pagou ' || v_amount || ' por ' || NEW.description
        || '. Os créditos foram liberados automaticamente.',
      'payment_paid',
      NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.issue_paid_plan_credits()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS checkout_orders_20_issue_plan_credits ON public.checkout_orders;
CREATE TRIGGER checkout_orders_20_issue_plan_credits
  AFTER UPDATE OF status ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.issue_paid_plan_credits();

CREATE OR REPLACE FUNCTION public.revoke_refunded_plan_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grant public.student_credit_grants%ROWTYPE;
  v_balance integer;
BEGIN
  IF NEW.kind <> 'class_plan'
     OR NEW.status <> 'refunded'
     OR OLD.status = 'refunded'
  THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('credit-ledger:' || NEW.user_id::text, 0)
  );

  SELECT * INTO v_grant
  FROM public.student_credit_grants grant_row
  WHERE grant_row.checkout_order_id = NEW.id
  FOR UPDATE;

  IF v_grant.id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.bookings booking
  SET status = 'cancelada'
  FROM public.student_credit_allocations allocation
  WHERE allocation.grant_id = v_grant.id
    AND allocation.booking_id = booking.id
    AND allocation.status = 'reserved'
    AND booking.status = 'confirmada';

  UPDATE public.student_credit_allocations
  SET status = 'revoked', resolved_at = now()
  WHERE grant_id = v_grant.id AND status = 'reserved';

  SELECT COALESCE(SUM(ledger.credit_delta), 0)::integer INTO v_balance
  FROM public.student_credit_ledger ledger
  WHERE ledger.grant_id = v_grant.id;

  PERFORM public.append_credit_ledger_entry(
    v_grant.user_id,
    v_grant.id,
    NULL,
    NEW.id,
    'refund_reversal',
    -v_balance,
    'plan-refund:' || NEW.id::text,
    'Saldo cancelado após estorno do pagamento do plano.',
    NULL,
    jsonb_build_object('revoked_credits', v_balance)
  );

  UPDATE public.student_credit_grants
  SET status = 'refunded', refunded_at = COALESCE(NEW.refunded_at, now())
  WHERE id = v_grant.id AND status = 'active';

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_checkout_order_id
  )
  VALUES (
    v_grant.user_id,
    'Plano estornado',
    'O estorno foi confirmado. Créditos disponíveis e aulas futuras vinculadas a este plano foram cancelados.',
    'payment_refunded',
    NEW.id
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_refunded_plan_credits()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS checkout_orders_30_revoke_plan_credits ON public.checkout_orders;
CREATE TRIGGER checkout_orders_30_revoke_plan_credits
  AFTER UPDATE OF status ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.revoke_refunded_plan_credits();

CREATE OR REPLACE FUNCTION public.approve_local_checkout(
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
  v_attempts integer;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao exclusiva do servidor.';
  END IF;

  SELECT * INTO v_order
  FROM public.checkout_orders
  WHERE id = p_order_id AND user_id = p_user_id AND provider = 'local'
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Cobranca local nao encontrada.';
  END IF;
  IF v_order.status = 'paid' THEN
    RETURN;
  END IF;
  IF v_order.status <> 'pending'
     OR v_order.expires_at IS NULL
     OR v_order.expires_at <= now()
  THEN
    RAISE EXCEPTION 'Esta cobranca nao esta mais disponivel.';
  END IF;

  UPDATE public.payment_attempts
  SET status = 'paid', paid_at = now()
  WHERE checkout_order_id = v_order.id
    AND provider = 'local'
    AND status = 'pending'
    AND amount_cents = v_order.amount_cents;

  GET DIAGNOSTICS v_attempts = ROW_COUNT;
  IF v_attempts <> 1 THEN
    RAISE EXCEPTION 'Tentativa de pagamento local invalida.';
  END IF;

  UPDATE public.checkout_orders
  SET status = 'paid', paid_at = now()
  WHERE id = v_order.id AND status = 'pending';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_local_checkout(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_local_checkout(uuid, uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.create_credit_booking(
  p_user_id uuid,
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
  v_product public.pricing%ROWTYPE;
  v_session public.reservation_sessions%ROWTYPE;
  v_grant public.student_credit_grants%ROWTYPE;
  v_booking_id uuid := gen_random_uuid();
  v_allocation_id uuid;
  v_modality text;
  v_occupied integer := 0;
  v_balance integer;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao exclusiva do servidor.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Usuario nao encontrado.';
  END IF;
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

  v_modality := CASE
    WHEN p_booking_type = 'aula_individual' THEN 'individual'
    WHEN p_booking_type = 'aula_dupla' THEN 'dupla'
    WHEN p_booking_type IN ('aula_trio', 'aula_quarteto') THEN 'grupo'
    ELSE NULL
  END;
  IF v_modality IS NULL THEN
    RAISE EXCEPTION 'Este tipo de reserva nao aceita credito de plano.';
  END IF;

  PERFORM public.cleanup_expired_booking_holds();
  PERFORM pg_advisory_xact_lock(
    hashtextextended('credit-ledger:' || p_user_id::text, 0)
  );

  SELECT grant_row.* INTO v_grant
  FROM public.student_credit_grants grant_row
  WHERE grant_row.user_id = p_user_id
    AND grant_row.modality = v_modality
    AND grant_row.status = 'active'
    AND (
      SELECT COALESCE(SUM(ledger.credit_delta), 0)
      FROM public.student_credit_ledger ledger
      WHERE ledger.grant_id = grant_row.id
    ) > 0
  ORDER BY grant_row.granted_at, grant_row.id
  LIMIT 1
  FOR UPDATE;

  IF v_grant.id IS NULL THEN
    RAISE EXCEPTION 'Voce nao possui credito disponivel para esta modalidade.';
  END IF;

  SELECT * INTO v_product
  FROM public.pricing product
  WHERE product.booking_type = p_booking_type AND product.active
  LIMIT 1;

  IF v_product.id IS NULL OR v_product.price_cents <= 0 THEN
    RAISE EXCEPTION 'Este tipo de aula nao esta disponivel.';
  END IF;
  IF NOT v_product.requires_professor THEN
    RAISE EXCEPTION 'Este tipo de aula nao utiliza credito de plano.';
  END IF;
  IF p_professor_id IS NOT NULL
     AND NOT public.has_role(p_professor_id, 'professor')
     AND NOT public.has_role(p_professor_id, 'admin')
  THEN
    RAISE EXCEPTION 'Professor indisponivel.';
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
      RAISE EXCEPTION 'Selecione um professor para a aula.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.blocked_slots block
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
      SELECT 1 FROM public.blocked_slots block
      WHERE block.block_date = p_booking_date
        AND block.start_hour = p_start_hour
        AND (block.professor_id IS NULL OR block.professor_id = v_session.professor_id)
    ) THEN
      RAISE EXCEPTION 'O horario esta bloqueado.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings booking
    WHERE booking.session_id = v_session.id
      AND booking.user_id = p_user_id
      AND booking.status IN ('pendente', 'confirmada')
      AND (
        booking.payment_status = 'pago'
        OR booking.status = 'confirmada'
        OR (booking.payment_status = 'pendente' AND booking.hold_expires_at > now())
      )
  ) THEN
    RAISE EXCEPTION 'Voce ja possui uma vaga neste horario.';
  END IF;
  IF v_occupied >= v_session.capacity THEN
    RAISE EXCEPTION 'A ultima vaga deste horario ja foi ocupada.';
  END IF;

  INSERT INTO public.bookings (
    id, session_id, user_id, professor_id, booking_date, start_hour,
    duration_hours, type, status, payment_status, payment_method,
    price_cents, amount_cents, checkout_order_id, credit_grant_id,
    hold_expires_at, confirmed_at, attended
  )
  VALUES (
    v_booking_id, v_session.id, p_user_id, v_session.professor_id,
    p_booking_date, p_start_hour, 1, p_booking_type, 'confirmada',
    'pago', 'credito_plano', 0, 0, NULL, v_grant.id,
    NULL, now(), false
  );

  INSERT INTO public.student_credit_allocations (
    grant_id, user_id, booking_id
  )
  VALUES (v_grant.id, p_user_id, v_booking_id)
  RETURNING id INTO v_allocation_id;

  PERFORM public.append_credit_ledger_entry(
    p_user_id,
    v_grant.id,
    v_booking_id,
    v_grant.checkout_order_id,
    'booking_debit',
    -1,
    'booking-debit:' || v_booking_id::text,
    'Credito reservado para uma aula.',
    p_user_id,
    jsonb_build_object(
      'booking_date', p_booking_date,
      'start_hour', p_start_hour,
      'booking_type', p_booking_type,
      'session_id', v_session.id,
      'allocation_id', v_allocation_id
    )
  );

  SELECT COALESCE(SUM(ledger.credit_delta), 0)::integer INTO v_balance
  FROM public.student_credit_ledger ledger
  WHERE ledger.user_id = p_user_id
    AND EXISTS (
      SELECT 1 FROM public.student_credit_grants grant_row
      WHERE grant_row.id = ledger.grant_id
        AND grant_row.status = 'active'
        AND grant_row.modality = v_modality
    );

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_booking_id
  )
  VALUES (
    p_user_id,
    'Aula confirmada',
    'Sua vaga para ' || to_char(p_booking_date, 'DD/MM') || ' às '
      || lpad(p_start_hour::text, 2, '0') || ':00 foi confirmada com 1 crédito. '
      || 'Você ainda possui ' || v_balance::text
      || CASE WHEN v_balance = 1 THEN ' crédito nesta modalidade.' ELSE ' créditos nesta modalidade.' END,
    'credit_booking_confirmed',
    v_booking_id
  );

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'session_id', v_session.id,
    'allocation_id', v_allocation_id,
    'available_credits', v_balance,
    'modality', v_modality,
    'booking_date', p_booking_date,
    'start_hour', p_start_hour
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A ultima vaga deste horario ja foi ocupada.';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_credit_booking(
  uuid, date, integer, public.booking_type, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_credit_booking(
  uuid, date, integer, public.booking_type, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_credit_booking(
  p_user_id uuid,
  p_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_allocation public.student_credit_allocations%ROWTYPE;
  v_grant public.student_credit_grants%ROWTYPE;
  v_notice_hours integer := 24;
  v_booking_start timestamptz;
  v_returned boolean := false;
  v_balance integer;
  v_student_name text;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao exclusiva do servidor.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('credit-ledger:' || p_user_id::text, 0)
  );

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_booking.id IS NULL
     OR v_booking.user_id <> p_user_id
     OR v_booking.credit_grant_id IS NULL
  THEN
    RAISE EXCEPTION 'Reserva por credito nao encontrada.';
  END IF;

  SELECT * INTO v_allocation
  FROM public.student_credit_allocations allocation
  WHERE allocation.booking_id = v_booking.id
  FOR UPDATE;

  IF v_allocation.id IS NULL OR v_allocation.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Vinculo financeiro da reserva nao encontrado.';
  END IF;

  SELECT * INTO v_grant
  FROM public.student_credit_grants grant_row
  WHERE grant_row.id = v_allocation.grant_id
  FOR UPDATE;

  SELECT CASE
    WHEN setting.value ~ '^[0-9]{1,3}$' THEN LEAST(GREATEST(setting.value::integer, 0), 720)
    ELSE 24
  END INTO v_notice_hours
  FROM public.site_settings setting
  WHERE setting.key = 'cancellation_notice_hours';
  v_notice_hours := COALESCE(v_notice_hours, 24);

  IF v_booking.status = 'cancelada' THEN
    SELECT COALESCE(SUM(ledger.credit_delta), 0)::integer INTO v_balance
    FROM public.student_credit_ledger ledger
    JOIN public.student_credit_grants grant_row ON grant_row.id = ledger.grant_id
    WHERE ledger.user_id = p_user_id
      AND grant_row.status = 'active'
      AND grant_row.modality = v_grant.modality;
    RETURN jsonb_build_object(
      'booking_id', v_booking.id,
      'credit_returned', v_allocation.status = 'returned',
      'available_credits', v_balance,
      'notice_hours', v_notice_hours,
      'already_cancelled', true
    );
  END IF;

  IF v_allocation.status <> 'reserved' THEN
    RAISE EXCEPTION 'Esta aula ja foi concluida e o credito foi consumido.';
  END IF;

  IF v_booking.status <> 'confirmada' OR v_booking.attended IS TRUE THEN
    RAISE EXCEPTION 'Esta aula nao pode mais ser cancelada pelo aluno.';
  END IF;

  v_booking_start := (v_booking.booking_date + make_time(v_booking.start_hour, 0, 0))
    AT TIME ZONE 'America/Sao_Paulo';
  IF v_booking_start <= now() THEN
    RAISE EXCEPTION 'Uma aula que ja comecou nao pode ser cancelada.';
  END IF;

  v_returned := v_grant.status = 'active'
    AND v_booking_start >= now() + make_interval(hours => v_notice_hours);

  UPDATE public.bookings
  SET status = 'cancelada'
  WHERE id = v_booking.id;

  IF v_returned THEN
    UPDATE public.student_credit_allocations
    SET status = 'returned', resolved_at = now()
    WHERE id = v_allocation.id;

    PERFORM public.append_credit_ledger_entry(
      p_user_id,
      v_grant.id,
      v_booking.id,
      v_grant.checkout_order_id,
      'cancellation_credit',
      1,
      'booking-cancellation:' || v_booking.id::text,
      'Credito devolvido por cancelamento dentro do prazo.',
      p_user_id,
      jsonb_build_object(
        'booking_date', v_booking.booking_date,
        'start_hour', v_booking.start_hour,
        'notice_hours', v_notice_hours
      )
    );
  ELSE
    UPDATE public.student_credit_allocations
    SET status = 'forfeited', resolved_at = now()
    WHERE id = v_allocation.id;

    PERFORM public.append_credit_ledger_entry(
      p_user_id,
      v_grant.id,
      v_booking.id,
      v_grant.checkout_order_id,
      'late_cancellation_forfeit',
      0,
      'booking-cancellation:' || v_booking.id::text,
      'Aula cancelada fora do prazo; o credito permaneceu consumido.',
      p_user_id,
      jsonb_build_object(
        'booking_date', v_booking.booking_date,
        'start_hour', v_booking.start_hour,
        'notice_hours', v_notice_hours
      )
    );
  END IF;

  SELECT COALESCE(SUM(ledger.credit_delta), 0)::integer INTO v_balance
  FROM public.student_credit_ledger ledger
  JOIN public.student_credit_grants grant_row ON grant_row.id = ledger.grant_id
  WHERE ledger.user_id = p_user_id
    AND grant_row.status = 'active'
    AND grant_row.modality = v_grant.modality;

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_booking_id
  )
  VALUES (
    p_user_id,
    CASE WHEN v_returned THEN 'Crédito devolvido' ELSE 'Aula cancelada' END,
    CASE WHEN v_returned THEN
      'Sua aula de ' || to_char(v_booking.booking_date, 'DD/MM') || ' às '
        || lpad(v_booking.start_hour::text, 2, '0')
        || ':00 foi cancelada e o crédito voltou para você.'
    ELSE
      'Sua aula de ' || to_char(v_booking.booking_date, 'DD/MM') || ' às '
        || lpad(v_booking.start_hour::text, 2, '0')
        || ':00 foi cancelada. Como faltavam menos de ' || v_notice_hours::text
        || ' horas, o crédito não foi devolvido.'
    END,
    'credit_booking_cancelled',
    v_booking.id
  );

  SELECT COALESCE(profile.full_name, 'Aluno') INTO v_student_name
  FROM public.profiles profile WHERE profile.id = p_user_id;
  v_student_name := COALESCE(v_student_name, 'Aluno');

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_booking_id
  )
  SELECT DISTINCT
    recipient.user_id,
    'Vaga liberada',
    v_student_name || ' cancelou a aula de '
      || to_char(v_booking.booking_date, 'DD/MM') || ' às '
      || lpad(v_booking.start_hour::text, 2, '0') || ':00. A vaga está disponível novamente.',
    'credit_booking_cancelled',
    v_booking.id
  FROM (
    SELECT role_row.user_id FROM public.user_roles role_row WHERE role_row.role = 'admin'
    UNION
    SELECT v_booking.professor_id WHERE v_booking.professor_id IS NOT NULL
  ) recipient
  WHERE recipient.user_id <> p_user_id;

  RETURN jsonb_build_object(
    'booking_id', v_booking.id,
    'credit_returned', v_returned,
    'available_credits', v_balance,
    'notice_hours', v_notice_hours,
    'already_cancelled', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_credit_booking(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_credit_booking(uuid, uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_credit_allocation_after_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.credit_grant_id IS NOT NULL
     AND NEW.status = 'concluida'
     AND OLD.status IS DISTINCT FROM 'concluida'
  THEN
    UPDATE public.student_credit_allocations
    SET status = 'consumed', resolved_at = now()
    WHERE booking_id = NEW.id AND status = 'reserved';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_credit_allocation_after_booking()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS bookings_resolve_credit_allocation ON public.bookings;
CREATE TRIGGER bookings_resolve_credit_allocation
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.resolve_credit_allocation_after_booking();

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
  mine.payment_method AS my_payment_method,
  mine.checkout_order_id AS my_checkout_order_id,
  mine.credit_grant_id AS my_credit_grant_id,
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
    booking.payment_method,
    booking.checkout_order_id,
    booking.credit_grant_id,
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

-- Realtime refreshes contain only rows already authorized by RLS.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.student_credit_ledger;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Initial catalog supplied by the coach. Prices are the full Pix amount and
-- credits do not expire; the duration is only the commercial package label.
INSERT INTO public.class_plans (
  id, frequency_per_week, duration_months, price_cents, title, description,
  active, modality, class_duration_min, credit_modality, credit_quantity
)
VALUES
  ('10000000-0000-4000-8000-000000000001', 1, 1, 29000,
   'Grupo mensal', 'Quatro creditos para aulas em grupo.', true, 'Grupo', 60, 'grupo', 4),
  ('10000000-0000-4000-8000-000000000002', 1, 3, 78000,
   'Grupo trimestral', 'Doze créditos para aulas em grupo.', true, 'Grupo', 60, 'grupo', 12),
  ('10000000-0000-4000-8000-000000000003', 1, 6, 138000,
   'Grupo semestral', 'Vinte e quatro créditos para aulas em grupo.', true, 'Grupo', 60, 'grupo', 24),
  ('20000000-0000-4000-8000-000000000001', 1, 1, 25000,
   'Individual avulsa', 'Uma aula individual com o professor.', true, 'Individual', 60, 'individual', 1),
  ('20000000-0000-4000-8000-000000000002', 1, 1, 90000,
   'Individual mensal', 'Quatro créditos para aulas individuais.', true, 'Individual', 60, 'individual', 4),
  ('20000000-0000-4000-8000-000000000003', 1, 3, 240000,
   'Individual trimestral', 'Doze créditos para aulas individuais.', true, 'Individual', 60, 'individual', 12),
  ('20000000-0000-4000-8000-000000000004', 1, 6, 450000,
   'Individual semestral', 'Vinte e quatro créditos para aulas individuais.', true, 'Individual', 60, 'individual', 24),
  ('30000000-0000-4000-8000-000000000001', 1, 1, 50000,
   'Dupla mensal', 'Quatro créditos por aluno para aulas em dupla.', true, 'Dupla', 60, 'dupla', 4),
  ('30000000-0000-4000-8000-000000000002', 1, 3, 135000,
   'Dupla trimestral', 'Doze créditos por aluno para aulas em dupla.', true, 'Dupla', 60, 'dupla', 12)
ON CONFLICT (id) DO NOTHING;
