-- Enforce the same required student identity fields at the database boundary.

CREATE OR REPLACE FUNCTION public.normalize_profile_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.full_name IS NOT NULL THEN
    NEW.full_name := left(
      regexp_replace(btrim(NEW.full_name), '\s+', ' ', 'g'),
      100
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_profile_name()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS normalize_profile_name ON public.profiles;
CREATE TRIGGER normalize_profile_name
  BEFORE INSERT OR UPDATE OF full_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.normalize_profile_name();

CREATE OR REPLACE FUNCTION public.enforce_student_profile_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_roles role_row
    WHERE role_row.user_id = NEW.id
      AND role_row.role = 'aluno'
  ) AND (
    char_length(COALESCE(NEW.full_name, '')) < 2
    OR public.normalize_brazil_phone(NEW.phone) IS NULL
  ) THEN
    RAISE EXCEPTION 'Aluno precisa ter nome e WhatsApp validos.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_student_profile_contact()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_student_profile_contact_insert ON public.profiles;
CREATE TRIGGER enforce_student_profile_contact_insert
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_profile_contact();

DROP TRIGGER IF EXISTS enforce_student_profile_contact_update ON public.profiles;
CREATE TRIGGER enforce_student_profile_contact_update
  AFTER UPDATE OF full_name, phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_profile_contact();

CREATE OR REPLACE FUNCTION public.enforce_student_role_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_phone text;
BEGIN
  IF NEW.role <> 'aluno' THEN
    RETURN NEW;
  END IF;

  SELECT profile.full_name, profile.phone
  INTO v_full_name, v_phone
  FROM public.profiles profile
  WHERE profile.id = NEW.user_id;

  IF NOT FOUND
     OR char_length(COALESCE(v_full_name, '')) < 2
     OR public.normalize_brazil_phone(v_phone) IS NULL
  THEN
    RAISE EXCEPTION 'Aluno precisa ter nome e WhatsApp validos.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_student_role_contact()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_student_role_contact ON public.user_roles;
CREATE TRIGGER enforce_student_role_contact
  AFTER INSERT OR UPDATE OF role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_role_contact();
