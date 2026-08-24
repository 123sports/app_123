-- Complete schedule locking for professor changes and global blocks.

DROP TRIGGER IF EXISTS booking_schedule_slot_lock ON public.bookings;
CREATE TRIGGER booking_schedule_slot_lock
  BEFORE INSERT OR UPDATE OF booking_date, start_hour, professor_id
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.lock_booking_schedule_slot();

DROP TRIGGER IF EXISTS blocked_schedule_slot_lock ON public.blocked_slots;
CREATE TRIGGER blocked_schedule_slot_lock
  BEFORE INSERT OR UPDATE OF block_date, start_hour, professor_id
  ON public.blocked_slots
  FOR EACH ROW EXECUTE FUNCTION public.lock_booking_schedule_slot();

CREATE OR REPLACE FUNCTION public.validate_block_not_booked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bookings booking
    WHERE booking.booking_date = NEW.block_date
      AND booking.start_hour = NEW.start_hour
      AND booking.status <> 'cancelada'
      AND (
        booking.payment_status = 'pago'
        OR booking.status = 'confirmada'
        OR (
          booking.payment_status = 'pendente'
          AND booking.hold_expires_at > now()
        )
      )
      AND (
        NEW.professor_id IS NULL
        OR booking.professor_id = NEW.professor_id
      )
  ) THEN
    RAISE EXCEPTION 'O horario ja possui uma reserva ativa.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_block_not_booked()
FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX blocked_slots_global_unique
  ON public.blocked_slots (block_date, start_hour)
  WHERE professor_id IS NULL;
