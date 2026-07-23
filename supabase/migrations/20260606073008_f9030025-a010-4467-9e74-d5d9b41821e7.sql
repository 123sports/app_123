-- Levels
CREATE TABLE public.student_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  min_score numeric(4,2) NOT NULL,
  rank_order int NOT NULL,
  color text NOT NULL DEFAULT '#b6f24a',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.student_levels TO anon, authenticated;
GRANT ALL ON public.student_levels TO service_role;
ALTER TABLE public.student_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view levels" ON public.student_levels FOR SELECT USING (true);
CREATE POLICY "Admins manage levels" ON public.student_levels FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.student_levels (name, slug, min_score, rank_order, color, description) VALUES
  ('Iniciante',     'iniciante',     0.0, 1, '#9bb09a', 'Primeiros passos na quadra.'),
  ('Intermediário', 'intermediario', 6.0, 2, '#7dd956', 'Já domina os fundamentos.'),
  ('Avançado',      'avancado',      8.0, 3, '#b6f24a', 'Joga partidas competitivas.'),
  ('Master',        'master',        9.3, 4, '#ffd166', 'Nível de elite — referência.');

-- Evaluations
CREATE TABLE public.student_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  professor_id uuid NOT NULL,
  booking_id uuid,
  evaluation_date date NOT NULL DEFAULT CURRENT_DATE,
  score_forehand   numeric(3,1) NOT NULL DEFAULT 0,
  score_backhand   numeric(3,1) NOT NULL DEFAULT 0,
  score_serve      numeric(3,1) NOT NULL DEFAULT 0,
  score_volley     numeric(3,1) NOT NULL DEFAULT 0,
  score_mental     numeric(3,1) NOT NULL DEFAULT 0,
  score_fitness    numeric(3,1) NOT NULL DEFAULT 0,
  overall_score numeric(4,2) GENERATED ALWAYS AS (
    (score_forehand + score_backhand + score_serve + score_volley + score_mental + score_fitness) / 6.0
  ) STORED,
  highlights text,
  improvements text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_evaluations_student_idx ON public.student_evaluations(student_id, evaluation_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_evaluations TO authenticated;
GRANT ALL ON public.student_evaluations TO service_role;
ALTER TABLE public.student_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Student sees own, admin sees all" ON public.student_evaluations FOR SELECT TO authenticated
  USING (auth.uid() = student_id OR auth.uid() = professor_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Professor or admin creates" ON public.student_evaluations FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = professor_id
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'professor'))
  );
CREATE POLICY "Professor or admin updates" ON public.student_evaluations FOR UPDATE TO authenticated
  USING (auth.uid() = professor_id OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() = professor_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admin deletes" ON public.student_evaluations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER tg_eval_touch BEFORE UPDATE ON public.student_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Validation: scores 0..10
CREATE OR REPLACE FUNCTION public.validate_eval_scores()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.score_forehand < 0 OR NEW.score_forehand > 10
    OR NEW.score_backhand < 0 OR NEW.score_backhand > 10
    OR NEW.score_serve < 0 OR NEW.score_serve > 10
    OR NEW.score_volley < 0 OR NEW.score_volley > 10
    OR NEW.score_mental < 0 OR NEW.score_mental > 10
    OR NEW.score_fitness < 0 OR NEW.score_fitness > 10 THEN
    RAISE EXCEPTION 'Notas devem estar entre 0 e 10.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_eval_validate BEFORE INSERT OR UPDATE ON public.student_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.validate_eval_scores();

-- Certificates
CREATE TABLE public.certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  level_id uuid NOT NULL REFERENCES public.student_levels(id) ON DELETE CASCADE,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  average_score numeric(4,2) NOT NULL,
  evaluations_count int NOT NULL,
  code text NOT NULL UNIQUE DEFAULT upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 10)),
  UNIQUE (student_id, level_id)
);
GRANT SELECT ON public.certificates TO authenticated;
GRANT ALL ON public.certificates TO service_role;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Student sees own certs, admin sees all" ON public.certificates FOR SELECT TO authenticated
  USING (auth.uid() = student_id OR public.has_role(auth.uid(),'admin'));

-- Compute level + award certificate on eval insert
CREATE OR REPLACE FUNCTION public.process_evaluation_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_avg numeric(4,2);
  v_count int;
  v_level RECORD;
  v_existing uuid;
  v_student_name text;
BEGIN
  SELECT AVG(overall_score)::numeric(4,2), COUNT(*)
    INTO v_avg, v_count
  FROM public.student_evaluations
  WHERE student_id = NEW.student_id
    AND evaluation_date >= (CURRENT_DATE - INTERVAL '90 days');

  IF v_count < 1 THEN RETURN NEW; END IF;

  SELECT * INTO v_level
  FROM public.student_levels
  WHERE min_score <= v_avg AND id IS NOT NULL
  ORDER BY rank_order DESC LIMIT 1;

  IF v_level.id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_existing FROM public.certificates
    WHERE student_id = NEW.student_id AND level_id = v_level.id;

  IF v_existing IS NULL THEN
    INSERT INTO public.certificates (student_id, level_id, average_score, evaluations_count)
    VALUES (NEW.student_id, v_level.id, v_avg, v_count);

    SELECT COALESCE(full_name,'Aluno') INTO v_student_name
      FROM public.profiles WHERE id = NEW.student_id;

    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      NEW.student_id,
      'Parabéns! Novo nível desbloqueado 🏆',
      'Você atingiu o nível ' || v_level.name || ' (média ' || to_char(v_avg,'FM999D9') || ') e ganhou um certificado.',
      'level_up'
    );

    INSERT INTO public.gamification_events (user_id, event_type, points, notes)
    VALUES (NEW.student_id, 'level_up', 50, 'Subiu para ' || v_level.name);
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER tg_eval_progress AFTER INSERT ON public.student_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.process_evaluation_progress();

-- Helper: current level for a student
CREATE OR REPLACE FUNCTION public.get_student_level(_student_id uuid)
RETURNS TABLE(level_id uuid, name text, slug text, color text, avg_score numeric, evals int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH stats AS (
    SELECT AVG(overall_score)::numeric(4,2) AS avg_s, COUNT(*)::int AS c
    FROM public.student_evaluations
    WHERE student_id = _student_id
      AND evaluation_date >= (CURRENT_DATE - INTERVAL '90 days')
  ), lvl AS (
    SELECT l.id, l.name, l.slug, l.color
    FROM public.student_levels l, stats
    WHERE l.min_score <= COALESCE(stats.avg_s, 0)
    ORDER BY l.rank_order DESC LIMIT 1
  )
  SELECT lvl.id, lvl.name, lvl.slug, lvl.color, stats.avg_s, stats.c
  FROM stats LEFT JOIN lvl ON true;
$$;