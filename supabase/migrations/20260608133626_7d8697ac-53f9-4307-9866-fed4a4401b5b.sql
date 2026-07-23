
-- =========================
-- PROFESSOR FEEDBACK
-- =========================
CREATE TABLE public.professor_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  professor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  is_anonymous boolean NOT NULL DEFAULT false,
  public_consent boolean NOT NULL DEFAULT false,
  approved_admin boolean NOT NULL DEFAULT false,
  approved_professor boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX professor_feedback_prof_idx ON public.professor_feedback(professor_id);
CREATE INDEX professor_feedback_featured_idx ON public.professor_feedback(featured) WHERE featured = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.professor_feedback TO authenticated;
GRANT SELECT ON public.professor_feedback TO anon;
GRANT ALL ON public.professor_feedback TO service_role;

ALTER TABLE public.professor_feedback ENABLE ROW LEVEL SECURITY;

-- Aluno cria feedback (student_id = ele, ou NULL quando anônimo)
CREATE POLICY "Students can create their feedback"
  ON public.professor_feedback FOR INSERT TO authenticated
  WITH CHECK (
    (is_anonymous = true AND student_id IS NULL)
    OR (is_anonymous = false AND student_id = auth.uid())
  );

-- Aluno vê os próprios feedbacks identificados
CREATE POLICY "Students see their own feedback"
  ON public.professor_feedback FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- Professor vê os feedbacks recebidos
CREATE POLICY "Professor sees feedback received"
  ON public.professor_feedback FOR SELECT TO authenticated
  USING (professor_id = auth.uid());

-- Admin vê tudo
CREATE POLICY "Admins see all feedback"
  ON public.professor_feedback FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Qualquer logado vê feedbacks em destaque (para mostrar na home interna)
CREATE POLICY "Anyone authenticated sees featured feedback"
  ON public.professor_feedback FOR SELECT TO authenticated
  USING (featured = true AND approved_admin = true AND public_consent = true);

-- Anon vê apenas destaque público (landing page)
CREATE POLICY "Anon sees featured public feedback"
  ON public.professor_feedback FOR SELECT TO anon
  USING (featured = true AND approved_admin = true AND public_consent = true);

-- Admin atualiza/deleta tudo; professor pode aprovar/destacar os seus
CREATE POLICY "Admins update feedback"
  ON public.professor_feedback FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Professor updates own feedback"
  ON public.professor_feedback FOR UPDATE TO authenticated
  USING (professor_id = auth.uid())
  WITH CHECK (professor_id = auth.uid());

CREATE POLICY "Admins delete feedback"
  ON public.professor_feedback FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER professor_feedback_touch_updated_at
  BEFORE UPDATE ON public.professor_feedback
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================
-- BLOCKED SLOTS
-- =========================
CREATE TABLE public.blocked_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  professor_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  block_date date NOT NULL,
  start_hour int NOT NULL CHECK (start_hour >= 6 AND start_hour <= 22),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_date, start_hour, professor_id)
);

CREATE INDEX blocked_slots_date_idx ON public.blocked_slots(block_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocked_slots TO authenticated;
GRANT ALL ON public.blocked_slots TO service_role;

ALTER TABLE public.blocked_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view blocks"
  ON public.blocked_slots FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admin creates any block"
  ON public.blocked_slots FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'professor') AND professor_id = auth.uid() AND blocked_by = auth.uid())
  );

CREATE POLICY "Admin updates any block"
  ON public.blocked_slots FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR blocked_by = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR blocked_by = auth.uid());

CREATE POLICY "Admin or owner deletes block"
  ON public.blocked_slots FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR blocked_by = auth.uid());

CREATE TRIGGER blocked_slots_touch_updated_at
  BEFORE UPDATE ON public.blocked_slots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Trigger: impedir reserva em horário bloqueado (apenas bloqueios sem professor = quadra cheia)
CREATE OR REPLACE FUNCTION public.validate_booking_not_blocked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.blocked_slots
    WHERE block_date = NEW.booking_date
      AND start_hour = NEW.start_hour
      AND (
        professor_id IS NULL
        OR (NEW.professor_id IS NOT NULL AND professor_id = NEW.professor_id)
      )
  ) THEN
    RAISE EXCEPTION 'Horário bloqueado pela quadra. Escolha outro horário.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_validate_not_blocked
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.validate_booking_not_blocked();
