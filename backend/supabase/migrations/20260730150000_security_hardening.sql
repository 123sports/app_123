-- Security hardening after the local payment foundation.

-- Local or historical email addresses must never grant privileges implicitly.
DROP TRIGGER IF EXISTS on_auth_user_created_master_admin ON auth.users;

CREATE OR REPLACE FUNCTION public.grant_master_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_master_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'admin'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.grant_master_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_master_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_master_admin(uuid) TO authenticated;

-- Expose only non-sensitive profile fields. Referral relationships stay private.
DROP VIEW IF EXISTS public.profiles_public;
CREATE VIEW public.profiles_public
WITH (security_invoker = off) AS
SELECT id, full_name, avatar_url, skill_level, bio, dominant_hand,
       years_playing, games_won, aces, created_at
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.get_my_referred_people()
RETURNS TABLE (id uuid, full_name text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile.id, profile.full_name, profile.created_at
  FROM public.profiles profile
  WHERE auth.uid() IS NOT NULL
    AND profile.referred_by = auth.uid()
  ORDER BY profile.created_at DESC
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_referred_people() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_referred_people() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_referral_status(_user_id uuid)
RETURNS TABLE (
  total_referrals integer,
  current_discount integer,
  next_tier_at integer,
  next_tier_discount integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR (_user_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'))
  THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  RETURN QUERY
  WITH counts AS (
    SELECT COUNT(*)::integer AS total
    FROM public.profiles
    WHERE referred_by = _user_id
  ),
  current_reward AS (
    SELECT reward.discount_percent, reward.min_referrals
    FROM public.referral_rewards reward
    WHERE reward.active
      AND reward.min_referrals <= (SELECT total FROM counts)
    ORDER BY reward.min_referrals DESC
    LIMIT 1
  ),
  next_reward AS (
    SELECT reward.discount_percent, reward.min_referrals
    FROM public.referral_rewards reward
    WHERE reward.active
      AND reward.min_referrals > (SELECT total FROM counts)
    ORDER BY reward.min_referrals ASC
    LIMIT 1
  )
  SELECT
    (SELECT total FROM counts),
    COALESCE((SELECT discount_percent FROM current_reward), 0),
    (SELECT min_referrals FROM next_reward),
    (SELECT discount_percent FROM next_reward);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_referral_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_referral_status(uuid) TO authenticated;

-- Calendar users only receive participant identifiers for their own reservations.
DROP VIEW IF EXISTS public.bookings_occupancy;
CREATE VIEW public.bookings_occupancy
WITH (security_invoker = off) AS
SELECT
  CASE WHEN b.user_id = auth.uid()
         OR b.professor_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin')
       THEN b.id ELSE NULL END AS id,
  CASE WHEN b.user_id = auth.uid()
         OR b.professor_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin')
       THEN b.user_id ELSE NULL END AS user_id,
  CASE WHEN b.user_id = auth.uid()
         OR b.professor_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin')
       THEN b.professor_id ELSE NULL END AS professor_id,
  b.booking_date,
  b.start_hour,
  b.type,
  b.status,
  CASE WHEN b.user_id = auth.uid()
         OR b.professor_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin')
       THEN b.payment_status ELSE NULL END AS payment_status,
  CASE WHEN b.user_id = auth.uid()
         OR b.professor_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin')
       THEN b.checkout_order_id ELSE NULL END AS checkout_order_id,
  CASE WHEN b.user_id = auth.uid()
         OR b.professor_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin')
       THEN b.hold_expires_at ELSE NULL END AS hold_expires_at
FROM public.bookings b
WHERE b.status <> 'cancelada'
  AND (
    b.payment_status = 'pago'
    OR b.status = 'confirmada'
    OR (b.payment_status = 'pendente' AND b.hold_expires_at > now())
  );

REVOKE ALL ON public.bookings_occupancy FROM PUBLIC, anon;
GRANT SELECT ON public.bookings_occupancy TO authenticated;

-- Reservation creation and deletion are server operations. Students may only
-- cancel their own unpaid reservation with at least two hours of notice.
DROP POLICY IF EXISTS "Users create their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users delete their own bookings" ON public.bookings;

CREATE POLICY "Admins delete bookings"
ON public.bookings FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.protect_booking_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text := COALESCE(auth.jwt()->>'role', '');
BEGIN
  IF caller_role = 'service_role' OR public.has_role(auth.uid(), 'admin') THEN
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

-- Public forms accept only bounded, initial-state records.
DROP POLICY IF EXISTS "Anyone can submit a lead" ON public.leads;
CREATE POLICY "Anyone can submit a validated lead"
ON public.leads FOR INSERT TO anon, authenticated
WITH CHECK (
  char_length(btrim(name)) BETWEEN 2 AND 120
  AND char_length(btrim(phone)) BETWEEN 8 AND 20
  AND char_length(COALESCE(city, '')) <= 120
  AND char_length(COALESCE(message, '')) <= 500
  AND status = 'novo'
  AND handled_by IS NULL
);

DROP POLICY IF EXISTS "anyone can apply" ON public.coach_applications;
CREATE POLICY "anyone can submit validated application"
ON public.coach_applications FOR INSERT TO anon, authenticated
WITH CHECK (
  char_length(btrim(name)) BETWEEN 2 AND 120
  AND char_length(btrim(email)) BETWEEN 3 AND 255
  AND position('@' IN email) > 1
  AND char_length(btrim(phone)) BETWEEN 8 AND 20
  AND char_length(COALESCE(city, '')) <= 120
  AND char_length(COALESCE(message, '')) <= 800
  AND char_length(COALESCE(cv_path, '')) <= 255
  AND status = 'novo'
);

DROP POLICY IF EXISTS "anyone upload cv" ON storage.objects;
CREATE POLICY "anyone upload validated cv"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'coach-cvs'
  AND position('/' IN name) = 0
  AND lower(storage.extension(name)) IN ('pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg')
  AND COALESCE((metadata->>'size')::bigint, 0) BETWEEN 1 AND 10485760
);

-- Only settings rendered publicly can be read without administrator privileges.
DROP POLICY IF EXISTS "Public can view settings" ON public.site_settings;
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
    'referral_welcome_bonus'
  )
);

-- Professors can retrieve sensitive student fields only when a booking links them.
CREATE OR REPLACE FUNCTION public.get_student_for_professor(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := public.has_role(v_caller, 'admin');
  v_is_prof boolean := public.has_role(v_caller, 'professor');
  v_row public.profiles%ROWTYPE;
  v_result jsonb;
  v_settings jsonb;
BEGIN
  IF NOT v_is_admin AND (
    NOT v_is_prof OR NOT EXISTS (
      SELECT 1
      FROM public.bookings
      WHERE user_id = _student_id
        AND professor_id = v_caller
    )
  ) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  SELECT * INTO v_row FROM public.profiles WHERE id = _student_id;
  IF v_row.id IS NULL THEN RETURN NULL; END IF;

  v_result := jsonb_build_object(
    'id', v_row.id,
    'full_name', v_row.full_name,
    'avatar_url', v_row.avatar_url,
    'skill_level', v_row.skill_level,
    'bio', v_row.bio,
    'dominant_hand', v_row.dominant_hand,
    'years_playing', v_row.years_playing
  );

  IF v_is_admin THEN
    RETURN v_result || jsonb_build_object(
      'phone', v_row.phone,
      'birth_date', v_row.birth_date,
      'blood_type', v_row.blood_type,
      'address', v_row.address,
      'emergency_contact_name', v_row.emergency_contact_name,
      'emergency_contact_phone', v_row.emergency_contact_phone,
      'medical_notes', v_row.medical_notes
    );
  END IF;

  SELECT jsonb_object_agg(key, value) INTO v_settings
  FROM public.site_settings
  WHERE key LIKE 'prof_visible_%';

  IF v_settings->>'prof_visible_phone' = 'true' THEN
    v_result := v_result || jsonb_build_object('phone', v_row.phone);
  END IF;
  IF v_settings->>'prof_visible_birth_date' = 'true' THEN
    v_result := v_result || jsonb_build_object('birth_date', v_row.birth_date);
  END IF;
  IF v_settings->>'prof_visible_blood_type' = 'true' THEN
    v_result := v_result || jsonb_build_object('blood_type', v_row.blood_type);
  END IF;
  IF v_settings->>'prof_visible_address' = 'true' THEN
    v_result := v_result || jsonb_build_object('address', v_row.address);
  END IF;
  IF v_settings->>'prof_visible_emergency_contact_name' = 'true' THEN
    v_result := v_result || jsonb_build_object('emergency_contact_name', v_row.emergency_contact_name);
  END IF;
  IF v_settings->>'prof_visible_emergency_contact_phone' = 'true' THEN
    v_result := v_result || jsonb_build_object('emergency_contact_phone', v_row.emergency_contact_phone);
  END IF;
  IF v_settings->>'prof_visible_medical_notes' = 'true' THEN
    v_result := v_result || jsonb_build_object('medical_notes', v_row.medical_notes);
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_student_for_professor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_for_professor(uuid) TO authenticated;

-- Contract contents are created by the validated server function. Students can
-- read and sign their contract, but cannot insert or rewrite contract rows.
DROP POLICY IF EXISTS "contracts student insert own" ON public.class_contracts;
DROP POLICY IF EXISTS "contracts owner or admin update" ON public.class_contracts;

CREATE POLICY "contracts admin update"
ON public.class_contracts FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "neg insert participant" ON public.contract_negotiations;
CREATE POLICY "neg admin insert"
ON public.contract_negotiations FOR INSERT TO authenticated
WITH CHECK (
  proposer_id = auth.uid()
  AND proposed_by = 'admin'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE OR REPLACE FUNCTION public.freeze_contract_on_active()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('vigente', 'encerrado', 'recusado')
     AND (
       NEW.plan_id IS DISTINCT FROM OLD.plan_id
       OR NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.list_price_cents IS DISTINCT FROM OLD.list_price_cents
       OR NEW.agreed_price_cents IS DISTINCT FROM OLD.agreed_price_cents
       OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
       OR NEW.starts_on IS DISTINCT FROM OLD.starts_on
       OR NEW.ends_on IS DISTINCT FROM OLD.ends_on
       OR NEW.document_hash IS DISTINCT FROM OLD.document_hash
       OR NEW.student_id IS DISTINCT FROM OLD.student_id
     )
  THEN
    RAISE EXCEPTION 'O conteudo de um contrato finalizado e imutavel.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.freeze_contract_on_active() FROM PUBLIC, anon, authenticated;
