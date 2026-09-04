-- Harden disputed plan credits and require possession of the staff invite token.

ALTER TABLE public.student_credit_grants
  DROP CONSTRAINT IF EXISTS student_credit_grants_status_check,
  DROP CONSTRAINT IF EXISTS student_credit_grants_check,
  DROP CONSTRAINT IF EXISTS student_credit_grants_status_refund_check;

ALTER TABLE public.student_credit_grants
  ADD CONSTRAINT student_credit_grants_status_check
    CHECK (status IN ('active', 'under_review', 'refunded')),
  ADD CONSTRAINT student_credit_grants_status_refund_check
    CHECK (
      (status IN ('active', 'under_review') AND refunded_at IS NULL)
      OR (status = 'refunded' AND refunded_at IS NOT NULL)
    );

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

  IF OLD.status = 'paid'
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

-- A partial refund or another verified inconsistency freezes unused credits.
-- The marker prevents the normal credit-issuance trigger from running again if
-- an administrator later verifies that the payment is still fully approved.
CREATE OR REPLACE FUNCTION public.freeze_plan_credits_for_payment_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.kind = 'class_plan'
     AND OLD.status = 'paid'
     AND NEW.status = 'paid_needs_review'
     AND EXISTS (
       SELECT 1
       FROM public.student_credit_grants grant_row
       WHERE grant_row.checkout_order_id = OLD.id
         AND grant_row.status IN ('active', 'under_review')
     )
  THEN
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'credit_payment_review',
        jsonb_build_object('started_at', now())
      );

    UPDATE public.student_credit_grants
    SET status = 'under_review'
    WHERE checkout_order_id = OLD.id
      AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.freeze_plan_credits_for_payment_review()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS checkout_orders_01_freeze_plan_credits
ON public.checkout_orders;
CREATE TRIGGER checkout_orders_01_freeze_plan_credits
  BEFORE UPDATE OF status ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.freeze_plan_credits_for_payment_review();

CREATE OR REPLACE FUNCTION public.restore_plan_credits_after_payment_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.kind = 'class_plan'
     AND OLD.status = 'paid_needs_review'
     AND NEW.status = 'paid'
     AND COALESCE(NEW.metadata, '{}'::jsonb) ? 'credit_payment_review'
  THEN
    UPDATE public.student_credit_grants
    SET status = 'active'
    WHERE checkout_order_id = NEW.id
      AND status = 'under_review';

    UPDATE public.checkout_orders
    SET metadata = COALESCE(NEW.metadata, '{}'::jsonb) - 'credit_payment_review'
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_plan_credits_after_payment_review()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS checkout_orders_18_restore_plan_credits
ON public.checkout_orders;
CREATE TRIGGER checkout_orders_18_restore_plan_credits
  AFTER UPDATE OF status ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.restore_plan_credits_after_payment_review();

DROP TRIGGER IF EXISTS checkout_orders_20_issue_plan_credits
ON public.checkout_orders;
CREATE TRIGGER checkout_orders_20_issue_plan_credits
  AFTER UPDATE OF status ON public.checkout_orders
  FOR EACH ROW
  WHEN (NOT (COALESCE(NEW.metadata, '{}'::jsonb) ? 'credit_payment_review'))
  EXECUTE FUNCTION public.issue_paid_plan_credits();

-- Keep past attendance/history intact on a full refund. Only future reserved
-- lessons are released, while every unresolved allocation is revoked.
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
    AND booking.status = 'confirmada'
    AND (booking.booking_date + make_time(booking.start_hour, 0, 0))
          AT TIME ZONE 'America/Sao_Paulo' > now();

  UPDATE public.student_credit_allocations
  SET status = 'revoked', resolved_at = now()
  WHERE grant_id = v_grant.id AND status = 'reserved';

  SELECT COALESCE(SUM(ledger.credit_delta), 0)::integer INTO v_balance
  FROM public.student_credit_ledger ledger
  WHERE ledger.grant_id = v_grant.id;

  IF v_balance <> 0 THEN
    PERFORM public.append_credit_ledger_entry(
      v_grant.user_id,
      v_grant.id,
      NULL,
      NEW.id,
      'refund_reversal',
      -v_balance,
      'plan-refund:' || NEW.id::text,
      'Saldo cancelado apos estorno do pagamento do plano.',
      NULL,
      jsonb_build_object('revoked_credits', v_balance)
    );
  END IF;

  UPDATE public.student_credit_grants
  SET status = 'refunded', refunded_at = COALESCE(NEW.refunded_at, now())
  WHERE id = v_grant.id
    AND status IN ('active', 'under_review');

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_checkout_order_id
  )
  VALUES (
    v_grant.user_id,
    'Plano estornado',
    'O estorno foi confirmado. Creditos disponiveis e aulas futuras vinculadas a este plano foram cancelados.',
    'payment_refunded',
    NEW.id
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_refunded_plan_credits()
FROM PUBLIC, anon, authenticated, service_role;

-- A normal public registration is always a student. A staff role can only be
-- assigned while creating the account if the one-time invite token is present,
-- valid, unexpired and belongs to the same email address.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.staff_invites%ROWTYPE;
  v_invite_token text;
  v_ref_code text;
  v_referrer uuid;
  v_requested_name text;
  v_full_name text;
  v_phone text;
BEGIN
  v_invite_token := NULLIF(btrim(NEW.raw_user_meta_data->>'staff_invite_token'), '');
  IF v_invite_token IS NOT NULL THEN
    SELECT * INTO v_invite
    FROM public.staff_invites invite
    WHERE invite.token = v_invite_token
      AND lower(invite.email) = lower(NEW.email)
      AND invite.status = 'pendente'
      AND invite.expires_at > now()
    FOR UPDATE;

    IF v_invite.id IS NULL THEN
      RAISE EXCEPTION 'Convite de equipe invalido ou expirado.';
    END IF;
  END IF;

  v_requested_name := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data->>'name'), '')
  );
  v_full_name := left(
    regexp_replace(
      COALESCE(v_requested_name, split_part(NEW.email, '@', 1)),
      '\s+',
      ' ',
      'g'
    ),
    100
  );
  v_phone := public.normalize_brazil_phone(NEW.raw_user_meta_data->>'phone');

  IF v_requested_name IS NULL
     OR char_length(v_full_name) < 2
     OR v_phone IS NULL
  THEN
    RAISE EXCEPTION 'Cadastro exige nome e WhatsApp validos.';
  END IF;

  IF v_invite.id IS NULL THEN
    v_ref_code := upper(NULLIF(NEW.raw_user_meta_data->>'referral_code', ''));
    IF v_ref_code IS NOT NULL THEN
      SELECT id INTO v_referrer
      FROM public.profiles
      WHERE referral_code = v_ref_code
      LIMIT 1;
    END IF;
  END IF;

  INSERT INTO public.profiles (
    id, full_name, avatar_url, phone, referral_code, referred_by
  ) VALUES (
    NEW.id,
    v_full_name,
    NEW.raw_user_meta_data->>'avatar_url',
    v_phone,
    public.generate_referral_code(),
    v_referrer
  );

  IF v_invite.id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, v_invite.role);

    UPDATE public.staff_invites
    SET status = 'aceito', accepted_at = now()
    WHERE id = v_invite.id
      AND status = 'pendente';
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'aluno');
  END IF;

  IF v_referrer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      v_referrer,
      'Indicacao confirmada!',
      v_full_name || ' entrou pela sua indicacao.',
      'referral_new'
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user()
FROM PUBLIC, anon, authenticated;
