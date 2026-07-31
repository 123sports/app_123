-- Secure staff onboarding and protect the administrative role hierarchy.

WITH duplicate_invites AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY lower(email)
      ORDER BY created_at DESC, id DESC
    ) AS position
  FROM public.staff_invites
  WHERE status = 'pendente'
)
UPDATE public.staff_invites invite
SET status = 'cancelado'
FROM duplicate_invites duplicate
WHERE invite.id = duplicate.id
  AND duplicate.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS staff_invites_one_pending_per_email
ON public.staff_invites (lower(email))
WHERE status = 'pendente';

CREATE OR REPLACE FUNCTION public.normalize_staff_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  IF char_length(NEW.email) > 255 OR position('@' IN NEW.email) <= 1 THEN
    RAISE EXCEPTION 'E-mail de convite invalido.';
  END IF;

  UPDATE public.staff_invites
  SET status = 'expirado'
  WHERE lower(email) = NEW.email
    AND status = 'pendente'
    AND expires_at <= now();

  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    NEW.invited_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_staff_invite ON public.staff_invites;
CREATE TRIGGER normalize_staff_invite
  BEFORE INSERT ON public.staff_invites
  FOR EACH ROW EXECUTE FUNCTION public.normalize_staff_invite();

REVOKE EXECUTE ON FUNCTION public.normalize_staff_invite()
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_staff_invite_by_token(_token text)
RETURNS TABLE (
  email text,
  role public.app_role,
  status text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT invite.email, invite.role, invite.status, invite.expires_at
  FROM public.staff_invites invite
  WHERE char_length(_token) BETWEEN 32 AND 128
    AND invite.token = _token
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.get_staff_invite_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_invite_by_token(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_staff_invite(_token text)
RETURNS public.app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invite public.staff_invites%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria.';
  END IF;

  SELECT lower(email)
  INTO v_user_email
  FROM auth.users
  WHERE id = v_user_id;

  SELECT *
  INTO v_invite
  FROM public.staff_invites
  WHERE token = _token
  FOR UPDATE;

  IF v_invite.id IS NULL
     OR v_invite.status <> 'pendente'
     OR v_invite.expires_at <= now()
  THEN
    RAISE EXCEPTION 'Convite invalido ou expirado.';
  END IF;

  IF lower(v_invite.email) <> v_user_email THEN
    RAISE EXCEPTION 'O convite pertence a outro e-mail.';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, v_invite.role)
  ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles
  WHERE user_id = v_user_id
    AND role = 'aluno'
    AND v_invite.role IN ('admin', 'professor');

  UPDATE public.staff_invites
  SET status = 'aceito',
      accepted_at = now()
  WHERE id = v_invite.id;

  RETURN v_invite.role;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_staff_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_staff_invite(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_last_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removes_admin boolean;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_removes_admin := OLD.role = 'admin';
  ELSE
    v_removes_admin := OLD.role = 'admin'
      AND (
        NEW.role IS DISTINCT FROM OLD.role
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
      );
  END IF;

  IF NOT v_removes_admin THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF OLD.user_id = auth.uid() THEN
    RAISE EXCEPTION 'Voce nao pode remover seu proprio acesso administrativo.';
  END IF;

  IF (SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin') <= 1 THEN
    RAISE EXCEPTION 'A plataforma precisa manter pelo menos um administrador.';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS protect_last_admin_role ON public.user_roles;
CREATE TRIGGER protect_last_admin_role
  BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_admin_role();

REVOKE EXECUTE ON FUNCTION public.protect_last_admin_role()
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_student_for_professor(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := public.has_role(v_caller, 'admin');
  v_is_professor boolean := public.has_role(v_caller, 'professor');
  v_row public.profiles%ROWTYPE;
  v_result jsonb;
  v_settings jsonb;
BEGIN
  IF NOT v_is_admin AND NOT v_is_professor THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF v_is_professor AND NOT v_is_admin AND NOT EXISTS (
    SELECT 1
    FROM public.bookings booking
    WHERE booking.user_id = _student_id
      AND booking.professor_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Aluno nao vinculado a este professor.';
  END IF;

  SELECT *
  INTO v_row
  FROM public.profiles
  WHERE id = _student_id;

  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;

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

  SELECT jsonb_object_agg(setting.key, setting.value)
  INTO v_settings
  FROM public.site_settings setting
  WHERE setting.key LIKE 'prof_visible_%';

  IF COALESCE(v_settings->>'prof_visible_phone', 'false') = 'true' THEN
    v_result := v_result || jsonb_build_object('phone', v_row.phone);
  END IF;
  IF COALESCE(v_settings->>'prof_visible_birth_date', 'false') = 'true' THEN
    v_result := v_result || jsonb_build_object('birth_date', v_row.birth_date);
  END IF;
  IF COALESCE(v_settings->>'prof_visible_blood_type', 'false') = 'true' THEN
    v_result := v_result || jsonb_build_object('blood_type', v_row.blood_type);
  END IF;
  IF COALESCE(v_settings->>'prof_visible_address', 'false') = 'true' THEN
    v_result := v_result || jsonb_build_object('address', v_row.address);
  END IF;
  IF COALESCE(v_settings->>'prof_visible_emergency_contact_name', 'false') = 'true' THEN
    v_result := v_result || jsonb_build_object(
      'emergency_contact_name',
      v_row.emergency_contact_name
    );
  END IF;
  IF COALESCE(v_settings->>'prof_visible_emergency_contact_phone', 'false') = 'true' THEN
    v_result := v_result || jsonb_build_object(
      'emergency_contact_phone',
      v_row.emergency_contact_phone
    );
  END IF;
  IF COALESCE(v_settings->>'prof_visible_medical_notes', 'false') = 'true' THEN
    v_result := v_result || jsonb_build_object('medical_notes', v_row.medical_notes);
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_student_for_professor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_for_professor(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_local_booking_checkout(
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

  SELECT *
  INTO v_order
  FROM public.checkout_orders
  WHERE id = p_order_id
    AND user_id = p_user_id
    AND provider = 'local'
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
  SET status = 'paid',
      paid_at = now()
  WHERE checkout_order_id = v_order.id
    AND provider = 'local'
    AND status = 'pending';

  GET DIAGNOSTICS v_attempts = ROW_COUNT;
  IF v_attempts <> 1 THEN
    RAISE EXCEPTION 'Tentativa de pagamento local invalida.';
  END IF;

  UPDATE public.checkout_orders
  SET status = 'paid',
      paid_at = now()
  WHERE id = v_order.id
    AND status = 'pending';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_local_booking_checkout(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_local_booking_checkout(uuid, uuid)
TO service_role;

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

  SELECT *
  INTO v_order
  FROM public.checkout_orders
  WHERE id = p_order_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Cobranca nao encontrada.';
  END IF;
  IF v_order.status = 'paid' THEN
    RAISE EXCEPTION 'Uma reserva paga exige estorno administrativo.';
  END IF;
  IF v_order.status <> 'pending' THEN
    RETURN;
  END IF;

  UPDATE public.payment_attempts
  SET status = 'cancelled'
  WHERE checkout_order_id = v_order.id
    AND status = 'pending';

  UPDATE public.bookings
  SET status = 'cancelada',
      payment_status = 'cancelado'
  WHERE checkout_order_id = v_order.id
    AND payment_status = 'pendente';

  UPDATE public.checkout_orders
  SET status = 'cancelled',
      cancelled_at = now()
  WHERE id = v_order.id
    AND status = 'pending';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_booking_checkout(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_checkout(uuid, uuid)
TO service_role;
