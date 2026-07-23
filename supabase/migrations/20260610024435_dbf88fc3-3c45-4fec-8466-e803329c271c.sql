DROP FUNCTION IF EXISTS public.get_default_coach_profile();

CREATE OR REPLACE FUNCTION public.get_default_coach_profile()
RETURNS TABLE(
  display_name text,
  venue_name text,
  venue_address text,
  is_default boolean,
  active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT display_name, venue_name, venue_address, is_default, active
  FROM public.coach_profiles
  WHERE active = true
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_default_coach_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_default_coach_profile() TO authenticated;