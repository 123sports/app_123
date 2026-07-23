
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code text;
  v_exists boolean;
BEGIN
  LOOP
    v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE referral_code = v_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_referral_code() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_referral_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_referral_status(uuid) TO authenticated;
