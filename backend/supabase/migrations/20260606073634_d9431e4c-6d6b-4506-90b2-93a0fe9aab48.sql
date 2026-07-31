
-- Default new open_matches to 'aprovado' instead of 'pendente'
ALTER TABLE public.open_matches ALTER COLUMN status SET DEFAULT 'aprovado';

-- Block opening a match on a slot that already has a paid/confirmed booking
CREATE OR REPLACE FUNCTION public.validate_open_match_slot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE booking_date = NEW.match_date
      AND start_hour = NEW.start_hour
      AND (payment_status = 'pago' OR status = 'confirmada')
  ) THEN
    RAISE EXCEPTION 'Este horário já está reservado e pago. Escolha outro horário.';
  END IF;
  -- Also block if there's already an active open match for the same slot
  IF EXISTS (
    SELECT 1 FROM public.open_matches
    WHERE match_date = NEW.match_date
      AND start_hour = NEW.start_hour
      AND status IN ('aprovado','fechado')
      AND id <> COALESCE(NEW.id, gen_random_uuid())
  ) THEN
    RAISE EXCEPTION 'Já existe uma vaga aberta neste horário. Entre nela ou escolha outro horário.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_open_match_slot ON public.open_matches;
CREATE TRIGGER trg_validate_open_match_slot
BEFORE INSERT ON public.open_matches
FOR EACH ROW EXECUTE FUNCTION public.validate_open_match_slot();

-- Drop the admin-approval notification trigger (no longer needed)
DROP TRIGGER IF EXISTS trg_notify_on_open_match_insert ON public.open_matches;
