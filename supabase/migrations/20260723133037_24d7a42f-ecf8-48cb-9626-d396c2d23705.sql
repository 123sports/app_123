CREATE OR REPLACE FUNCTION public.validate_booking_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.booking_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Não é possível reservar em datas passadas.';
  END IF;
  RETURN NEW;
END;
$function$;