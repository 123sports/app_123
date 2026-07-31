
-- Restrict bookings SELECT to own + professor (theirs) + admin (all)
DROP POLICY IF EXISTS "Authenticated can view bookings" ON public.bookings;

CREATE POLICY "Users view own bookings"
  ON public.bookings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Professors view their bookings"
  ON public.bookings FOR SELECT TO authenticated
  USING (auth.uid() = professor_id);

CREATE POLICY "Admins view all bookings"
  ON public.bookings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Public-safe view for calendar occupancy (no payment / personal data)
DROP VIEW IF EXISTS public.bookings_occupancy;
CREATE VIEW public.bookings_occupancy
WITH (security_invoker = off) AS
SELECT id, user_id, professor_id, booking_date, start_hour, type, status
FROM public.bookings;

GRANT SELECT ON public.bookings_occupancy TO authenticated;
