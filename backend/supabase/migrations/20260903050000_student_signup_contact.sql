-- Keep student contact data normalized from signup through later profile edits.

CREATE OR REPLACE FUNCTION public.normalize_brazil_phone(_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(_value, '[^0-9]', '', 'g');
BEGIN
  IF char_length(v_digits) IN (12, 13) AND left(v_digits, 2) = '55' THEN
    v_digits := substr(v_digits, 3);
  END IF;

  IF v_digits !~ '^[1-9][0-9]{9,10}$' THEN
    RETURN NULL;
  END IF;

  RETURN '+55' || v_digits;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_brazil_phone(text)
FROM PUBLIC, anon, authenticated;

UPDATE public.profiles
SET phone = public.normalize_brazil_phone(phone)
WHERE phone IS NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_phone_e164_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_phone_e164_check
  CHECK (phone IS NULL OR phone ~ '^\+55[1-9][0-9]{9,10}$');

CREATE OR REPLACE FUNCTION public.normalize_profile_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text;
BEGIN
  IF NEW.phone IS NULL OR btrim(NEW.phone) = '' THEN
    NEW.phone := NULL;
    RETURN NEW;
  END IF;

  v_normalized := public.normalize_brazil_phone(NEW.phone);
  IF v_normalized IS NULL THEN
    RAISE EXCEPTION 'Informe um WhatsApp brasileiro valido com DDD.';
  END IF;

  NEW.phone := v_normalized;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_profile_phone()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS normalize_profile_phone ON public.profiles;
CREATE TRIGGER normalize_profile_phone
  BEFORE INSERT OR UPDATE OF phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.normalize_profile_phone();

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
  v_full_name text;
  v_phone text;
BEGIN
  v_ref_code := upper(NULLIF(NEW.raw_user_meta_data->>'referral_code', ''));
  IF v_ref_code IS NOT NULL THEN
    SELECT id INTO v_referrer
    FROM public.profiles
    WHERE referral_code = v_ref_code
    LIMIT 1;
  END IF;

  v_full_name := regexp_replace(
    btrim(COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    )),
    '\s+',
    ' ',
    'g'
  );
  v_full_name := left(v_full_name, 100);
  v_phone := public.normalize_brazil_phone(NEW.raw_user_meta_data->>'phone');

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

  SELECT * INTO v_invite
  FROM public.staff_invites
  WHERE lower(email) = lower(NEW.email)
    AND status = 'pendente'
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

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
      COALESCE(NULLIF(v_full_name, ''), split_part(NEW.email, '@', 1)) ||
        ' entrou pela sua indicacao.',
      'referral_new'
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user()
FROM PUBLIC, anon, authenticated;
