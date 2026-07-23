
-- 1) booking_participants
CREATE TABLE public.booking_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_participants TO authenticated;
GRANT ALL ON public.booking_participants TO service_role;
ALTER TABLE public.booking_participants ENABLE ROW LEVEL SECURITY;

-- Helper: is user the booking owner?
CREATE OR REPLACE FUNCTION public.is_booking_owner(_booking_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.bookings WHERE id = _booking_id AND user_id = _user_id) $$;

CREATE OR REPLACE FUNCTION public.is_booking_participant(_booking_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.bookings WHERE id = _booking_id AND user_id = _user_id
  UNION
  SELECT 1 FROM public.booking_participants WHERE booking_id = _booking_id AND user_id = _user_id
) $$;

CREATE OR REPLACE FUNCTION public.is_open_match_participant(_match_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.open_matches WHERE id = _match_id AND creator_id = _user_id
  UNION
  SELECT 1 FROM public.open_match_participants WHERE match_id = _match_id AND user_id = _user_id
) $$;

CREATE OR REPLACE FUNCTION public.is_open_match_creator(_match_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.open_matches WHERE id = _match_id AND creator_id = _user_id) $$;

CREATE POLICY "view booking participants" ON public.booking_participants FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.is_booking_participant(booking_id, auth.uid()));

CREATE POLICY "owner/admin manage participants insert" ON public.booking_participants FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.is_booking_owner(booking_id, auth.uid()));

CREATE POLICY "owner/admin manage participants delete" ON public.booking_participants FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.is_booking_owner(booking_id, auth.uid()));

-- 2) match_draws
CREATE TABLE public.match_draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('booking','open_match')),
  source_id uuid NOT NULL,
  teams jsonb NOT NULL,
  drawn_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_draws TO authenticated;
GRANT ALL ON public.match_draws TO service_role;
ALTER TABLE public.match_draws ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view draws" ON public.match_draws FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR (source_type='booking' AND public.is_booking_participant(source_id, auth.uid()))
  OR (source_type='open_match' AND public.is_open_match_participant(source_id, auth.uid()))
);

CREATE POLICY "create draws" ON public.match_draws FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'admin')
  OR (source_type='booking' AND public.is_booking_owner(source_id, auth.uid()))
  OR (source_type='open_match' AND public.is_open_match_creator(source_id, auth.uid()))
);

CREATE POLICY "update draws" ON public.match_draws FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR (source_type='booking' AND public.is_booking_owner(source_id, auth.uid()))
  OR (source_type='open_match' AND public.is_open_match_creator(source_id, auth.uid()))
);

CREATE POLICY "delete draws" ON public.match_draws FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR (source_type='booking' AND public.is_booking_owner(source_id, auth.uid()))
  OR (source_type='open_match' AND public.is_open_match_creator(source_id, auth.uid()))
);

-- 3) updated_at
CREATE TRIGGER match_draws_touch BEFORE UPDATE ON public.match_draws
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4) Validation: lock after match started
CREATE OR REPLACE FUNCTION public.validate_match_draw_window()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_starts_at timestamptz;
BEGIN
  IF NEW.source_type = 'booking' THEN
    SELECT (booking_date::timestamp + (start_hour || ' hours')::interval) AT TIME ZONE 'America/Sao_Paulo'
      INTO v_starts_at FROM public.bookings WHERE id = NEW.source_id;
  ELSE
    SELECT (match_date::timestamp + (start_hour || ' hours')::interval) AT TIME ZONE 'America/Sao_Paulo'
      INTO v_starts_at FROM public.open_matches WHERE id = NEW.source_id;
  END IF;
  IF v_starts_at IS NOT NULL AND now() >= v_starts_at AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'O hor\u00e1rio da partida j\u00e1 come\u00e7ou \u2014 sorteio bloqueado.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER match_draws_window_ins BEFORE INSERT ON public.match_draws
FOR EACH ROW EXECUTE FUNCTION public.validate_match_draw_window();
CREATE TRIGGER match_draws_window_upd BEFORE UPDATE ON public.match_draws
FOR EACH ROW EXECUTE FUNCTION public.validate_match_draw_window();

-- 5) Notify all participants when draw happens
CREATE OR REPLACE FUNCTION public.notify_match_draw()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_date date;
  v_hour int;
  v_users uuid[];
BEGIN
  IF NEW.source_type = 'booking' THEN
    SELECT booking_date, start_hour INTO v_date, v_hour FROM public.bookings WHERE id = NEW.source_id;
    SELECT ARRAY(
      SELECT user_id FROM public.bookings WHERE id = NEW.source_id
      UNION
      SELECT user_id FROM public.booking_participants WHERE booking_id = NEW.source_id
    ) INTO v_users;
  ELSE
    SELECT match_date, start_hour INTO v_date, v_hour FROM public.open_matches WHERE id = NEW.source_id;
    SELECT ARRAY(
      SELECT creator_id FROM public.open_matches WHERE id = NEW.source_id
      UNION
      SELECT user_id FROM public.open_match_participants WHERE match_id = NEW.source_id
    ) INTO v_users;
  END IF;

  FOREACH v_user IN ARRAY v_users LOOP
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      v_user,
      'Sorteio de duplas realizado! 🎲',
      'As duplas para ' || to_char(v_date,'DD/MM') || ' às ' || lpad(v_hour::text,2,'0') || ':00 já estão definidas.',
      'match_draw'
    );
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER match_draws_notify AFTER INSERT OR UPDATE ON public.match_draws
FOR EACH ROW EXECUTE FUNCTION public.notify_match_draw();

-- 6) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_draws;
ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_participants;
