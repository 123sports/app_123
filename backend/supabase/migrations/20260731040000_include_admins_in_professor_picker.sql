CREATE OR REPLACE FUNCTION public.list_active_professors()
RETURNS TABLE (id uuid, full_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile.id, profile.full_name, profile.avatar_url
  FROM public.profiles profile
  WHERE auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles role_row
      WHERE role_row.user_id = profile.id
        AND role_row.role IN ('admin', 'professor')
    )
  ORDER BY profile.full_name NULLS LAST;
$$;

REVOKE EXECUTE ON FUNCTION public.list_active_professors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_professors() TO authenticated;
