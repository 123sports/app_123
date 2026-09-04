-- Require explicit contact metadata for every public student registration.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite record;
  v_ref_code text;
  v_referrer uuid;
  v_requested_name text;
  v_full_name text;
  v_phone text;
BEGIN
  SELECT * INTO v_invite
  FROM public.staff_invites
  WHERE lower(email) = lower(NEW.email)
    AND status = 'pendente'
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

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

  IF v_invite.id IS NULL AND (
    v_requested_name IS NULL
    OR char_length(v_full_name) < 2
    OR v_phone IS NULL
  ) THEN
    RAISE EXCEPTION 'Cadastro de aluno exige nome e WhatsApp validos.';
  END IF;

  v_ref_code := upper(NULLIF(NEW.raw_user_meta_data->>'referral_code', ''));
  IF v_ref_code IS NOT NULL THEN
    SELECT id INTO v_referrer
    FROM public.profiles
    WHERE referral_code = v_ref_code
    LIMIT 1;
  END IF;

  INSERT INTO public.profiles (
    id,
    full_name,
    avatar_url,
    phone,
    referral_code,
    referred_by
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
    VALUES (NEW.id, v_invite.role)
    ON CONFLICT (user_id, role) DO NOTHING;

    UPDATE public.staff_invites
    SET status = 'aceito', accepted_at = now()
    WHERE id = v_invite.id;
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'aluno')
    ON CONFLICT (user_id, role) DO NOTHING;
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
