CREATE OR REPLACE FUNCTION public.protect_open_match_admin_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes
     OR NEW.cancelled_reason IS DISTINCT FROM OLD.cancelled_reason
     OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
     OR NEW.match_date IS DISTINCT FROM OLD.match_date
     OR NEW.start_hour IS DISTINCT FROM OLD.start_hour
  THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar esses campos do match aberto.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_open_match_admin_fields ON public.open_matches;
CREATE TRIGGER trg_protect_open_match_admin_fields
BEFORE UPDATE ON public.open_matches
FOR EACH ROW
EXECUTE FUNCTION public.protect_open_match_admin_fields();