
CREATE OR REPLACE FUNCTION public.is_master_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = _user_id AND lower(email) = 'bruno@oddrive.com.br'
  )
$$;

DROP POLICY IF EXISTS "Admins write invites" ON public.staff_invites;
DROP POLICY IF EXISTS "Master writes invites" ON public.staff_invites;
CREATE POLICY "Master writes invites" ON public.staff_invites
  FOR ALL
  USING (public.is_master_admin(auth.uid()))
  WITH CHECK (public.is_master_admin(auth.uid()));

-- Lock down role grants to master admin only as well
DROP POLICY IF EXISTS "Only admins insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Master inserts roles" ON public.user_roles;
DROP POLICY IF EXISTS "Master updates roles" ON public.user_roles;
DROP POLICY IF EXISTS "Master deletes roles" ON public.user_roles;

CREATE POLICY "Master inserts roles" ON public.user_roles
  FOR INSERT WITH CHECK (public.is_master_admin(auth.uid()));
CREATE POLICY "Master updates roles" ON public.user_roles
  FOR UPDATE USING (public.is_master_admin(auth.uid()))
  WITH CHECK (public.is_master_admin(auth.uid()));
CREATE POLICY "Master deletes roles" ON public.user_roles
  FOR DELETE USING (public.is_master_admin(auth.uid()));
