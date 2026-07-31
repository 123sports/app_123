
-- Trigger: when a new auth user is created with the master email, grant admin role
CREATE OR REPLACE FUNCTION public.grant_master_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email = 'bruno@oddrive.com.br' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_master_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_master_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_master_admin();

-- Backfill if the user already exists
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE email = 'bruno@oddrive.com.br'
ON CONFLICT (user_id, role) DO NOTHING;
