
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  kind text NOT NULL DEFAULT 'info',
  read boolean NOT NULL DEFAULT false,
  related_booking_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Trigger: new booking -> notify admins + professor
CREATE OR REPLACE FUNCTION public.notify_on_booking_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student text;
  v_admin_id uuid;
BEGIN
  SELECT COALESCE(full_name, 'Aluno') INTO v_student FROM public.profiles WHERE id = NEW.user_id;

  -- Notify all admins
  FOR v_admin_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, body, kind, related_booking_id)
    VALUES (
      v_admin_id,
      'Nova reserva',
      v_student || ' reservou ' || to_char(NEW.booking_date, 'DD/MM') || ' às ' || lpad(NEW.start_hour::text, 2, '0') || ':00',
      'booking_new',
      NEW.id
    );
  END LOOP;

  -- Notify professor (if chosen and not already an admin to avoid duplicates is fine — keep it simple)
  IF NEW.professor_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, kind, related_booking_id)
    VALUES (
      NEW.professor_id,
      'Você tem um novo horário reservado',
      v_student || ' reservou ' || to_char(NEW.booking_date, 'DD/MM') || ' às ' || lpad(NEW.start_hour::text, 2, '0') || ':00',
      'booking_new',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_booking_insert_notify
AFTER INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.notify_on_booking_insert();

-- Trigger: booking confirmed -> notify student
CREATE OR REPLACE FUNCTION public.notify_on_booking_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmada' AND (OLD.status IS DISTINCT FROM 'confirmada') THEN
    INSERT INTO public.notifications (user_id, title, body, kind, related_booking_id)
    VALUES (
      NEW.user_id,
      'Aula confirmada! 🎾',
      'Sua aula em ' || to_char(NEW.booking_date, 'DD/MM') || ' às ' || lpad(NEW.start_hour::text, 2, '0') || ':00 foi confirmada.',
      'booking_confirmed',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_booking_confirm_notify
AFTER UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.notify_on_booking_confirm();
