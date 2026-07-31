
-- ============ open_matches ============
CREATE TABLE public.open_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  match_date date NOT NULL,
  start_hour int NOT NULL,
  duration_hours int NOT NULL DEFAULT 1,
  max_players int NOT NULL DEFAULT 4,
  skill_level text,
  notes text,
  status text NOT NULL DEFAULT 'pendente', -- pendente | aprovado | fechado | cancelado
  admin_notes text,
  approved_at timestamptz,
  approved_by uuid,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_matches TO authenticated;
GRANT ALL ON public.open_matches TO service_role;

ALTER TABLE public.open_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view approved or own matches"
  ON public.open_matches FOR SELECT TO authenticated
  USING (
    status IN ('aprovado','fechado')
    OR creator_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Users create own matches"
  ON public.open_matches FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creator or admin can update"
  ON public.open_matches FOR UPDATE TO authenticated
  USING (auth.uid() = creator_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = creator_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Creator or admin can delete"
  ON public.open_matches FOR DELETE TO authenticated
  USING (auth.uid() = creator_id OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_open_matches_updated_at
  BEFORE UPDATE ON public.open_matches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ participants ============
CREATE TABLE public.open_match_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.open_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, user_id)
);

GRANT SELECT, INSERT, DELETE ON public.open_match_participants TO authenticated;
GRANT ALL ON public.open_match_participants TO service_role;

ALTER TABLE public.open_match_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view participants"
  ON public.open_match_participants FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users join as themselves"
  ON public.open_match_participants FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users leave own or admin removes"
  ON public.open_match_participants FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ============ notify admin on new match ============
CREATE OR REPLACE FUNCTION public.notify_on_open_match_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_name text;
BEGIN
  SELECT COALESCE(full_name,'Aluno') INTO v_name FROM public.profiles WHERE id = NEW.creator_id;
  FOR v_admin_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      v_admin_id,
      'Novo match aberto pra aprovar',
      v_name || ' abriu vaga em ' || to_char(NEW.match_date,'DD/MM') || ' às ' || lpad(NEW.start_hour::text,2,'0') || ':00',
      'open_match_new'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_open_match_insert_notify
  AFTER INSERT ON public.open_matches
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_open_match_insert();

-- ============ notify creator on approval ============
CREATE OR REPLACE FUNCTION public.notify_on_open_match_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'aprovado' AND OLD.status IS DISTINCT FROM 'aprovado' THEN
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      NEW.creator_id,
      'Seu match foi aprovado! 🎾',
      'Sua vaga em ' || to_char(NEW.match_date,'DD/MM') || ' às ' || lpad(NEW.start_hour::text,2,'0') || ':00 já aparece para os outros alunos.',
      'open_match_approved'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_open_match_status_notify
  AFTER UPDATE OF status ON public.open_matches
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_open_match_status();

-- ============ notify creator when someone joins/leaves ============
CREATE OR REPLACE FUNCTION public.notify_open_match_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator uuid;
  v_name text;
  v_date date;
  v_hour int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT creator_id, match_date, start_hour INTO v_creator, v_date, v_hour
      FROM public.open_matches WHERE id = NEW.match_id;
    SELECT COALESCE(full_name,'Um jogador') INTO v_name FROM public.profiles WHERE id = NEW.user_id;
    IF v_creator IS NOT NULL AND v_creator <> NEW.user_id THEN
      INSERT INTO public.notifications (user_id, title, body, kind)
      VALUES (
        v_creator,
        'Alguém entrou no seu match! 🎉',
        v_name || ' quer jogar com você em ' || to_char(v_date,'DD/MM') || ' às ' || lpad(v_hour::text,2,'0') || ':00',
        'open_match_join'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_open_match_participant_notify
  AFTER INSERT ON public.open_match_participants
  FOR EACH ROW EXECUTE FUNCTION public.notify_open_match_participant();

-- ============ auto-cancel open match when a real booking is paid for same slot ============
CREATE OR REPLACE FUNCTION public.cancel_open_match_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
  v_part RECORD;
BEGIN
  -- Only when booking is paid or confirmed
  IF NEW.payment_status <> 'pago' AND NEW.status <> 'confirmada' THEN
    RETURN NEW;
  END IF;

  FOR v_match IN
    SELECT * FROM public.open_matches
    WHERE match_date = NEW.booking_date
      AND start_hour = NEW.start_hour
      AND status IN ('pendente','aprovado','fechado')
      AND creator_id <> NEW.user_id
  LOOP
    UPDATE public.open_matches
      SET status = 'cancelado',
          cancelled_reason = 'Horário reservado e pago por outro aluno'
      WHERE id = v_match.id;

    -- notify creator
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      v_match.creator_id,
      'Seu match aberto foi cancelado',
      'O horário de ' || to_char(v_match.match_date,'DD/MM') || ' às ' || lpad(v_match.start_hour::text,2,'0') || ':00 foi reservado por outro aluno.',
      'open_match_cancelled'
    );

    -- notify all participants
    FOR v_part IN SELECT user_id FROM public.open_match_participants WHERE match_id = v_match.id LOOP
      INSERT INTO public.notifications (user_id, title, body, kind)
      VALUES (
        v_part.user_id,
        'Match cancelado',
        'O match em ' || to_char(v_match.match_date,'DD/MM') || ' às ' || lpad(v_match.start_hour::text,2,'0') || ':00 foi cancelado porque o horário foi reservado.',
        'open_match_cancelled'
      );
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_booking_cancels_open_match_ins
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.cancel_open_match_on_booking();

CREATE TRIGGER trg_booking_cancels_open_match_upd
  AFTER UPDATE OF status, payment_status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.cancel_open_match_on_booking();

-- ============ realtime ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.open_matches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.open_match_participants;
