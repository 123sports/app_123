
DROP POLICY IF EXISTS "Users or admins update bookings" ON public.bookings;

-- Admins can update anything
CREATE POLICY "Admins update bookings"
ON public.bookings FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Users can update only their own bookings, restricted via trigger to safe fields
CREATE POLICY "Users update own bookings limited"
ON public.bookings FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Trigger to block users from modifying sensitive fields
CREATE OR REPLACE FUNCTION public.protect_booking_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.card_operator_id IS DISTINCT FROM OLD.card_operator_id
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
     OR NEW.attended IS DISTINCT FROM OLD.attended
     OR NEW.professor_id IS DISTINCT FROM OLD.professor_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
     OR NEW.start_hour IS DISTINCT FROM OLD.start_hour
     OR NEW.type IS DISTINCT FROM OLD.type
  THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar estes campos da reserva.';
  END IF;

  -- Users may only set status to 'cancelada' (or keep unchanged)
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelada' THEN
    RAISE EXCEPTION 'Você só pode cancelar a reserva.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_booking_sensitive_fields ON public.bookings;
CREATE TRIGGER trg_protect_booking_sensitive_fields
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.protect_booking_sensitive_fields();
