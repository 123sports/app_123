DROP POLICY IF EXISTS "coach_profiles read auth" ON public.coach_profiles;

CREATE POLICY "coach_profiles admin read"
ON public.coach_profiles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "coach_profiles self read"
ON public.coach_profiles FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_default_coach_profile()
RETURNS TABLE(
  user_id uuid, display_name text, cpf_cnpj text, email text, phone text,
  address text, venue_name text, venue_address text, is_default boolean, active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id, display_name, cpf_cnpj, email, phone, address, venue_name, venue_address, is_default, active
  FROM public.coach_profiles
  WHERE active = true
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_default_coach_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_default_coach_profile() TO authenticated;