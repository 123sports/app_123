
CREATE TABLE public.coach_applications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  city text,
  message text,
  cv_path text,
  status text NOT NULL DEFAULT 'novo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.coach_applications TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.coach_applications TO authenticated;
GRANT ALL ON public.coach_applications TO service_role;

ALTER TABLE public.coach_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can apply" ON public.coach_applications
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "admins read applications" ON public.coach_applications
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update applications" ON public.coach_applications
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete applications" ON public.coach_applications
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER coach_applications_touch
  BEFORE UPDATE ON public.coach_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.notify_on_coach_application()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin_id uuid;
BEGIN
  FOR v_admin_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      v_admin_id,
      'Nova candidatura de professor',
      NEW.name || ' (' || NEW.email || ') enviou candidatura.',
      'coach_application_new'
    );
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER coach_applications_notify
  AFTER INSERT ON public.coach_applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_coach_application();
