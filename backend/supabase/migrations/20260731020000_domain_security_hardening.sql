-- Close privilege-escalation paths in open matches and professor blocks.

DROP POLICY IF EXISTS "Users create own matches" ON public.open_matches;
CREATE POLICY "Users create validated own matches"
ON public.open_matches FOR INSERT TO authenticated
WITH CHECK (
  creator_id = auth.uid()
  AND status = 'pendente'
  AND approved_at IS NULL
  AND approved_by IS NULL
  AND admin_notes IS NULL
  AND cancelled_reason IS NULL
  AND match_date BETWEEN current_date AND current_date + 31
  AND start_hour BETWEEN 6 AND 22
  AND duration_hours BETWEEN 1 AND 4
  AND max_players BETWEEN 2 AND 4
  AND char_length(COALESCE(skill_level, '')) <= 80
  AND char_length(COALESCE(notes, '')) <= 300
);

CREATE OR REPLACE FUNCTION public.protect_open_match_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role'
     OR public.has_role(auth.uid(), 'admin')
  THEN
    RETURN NEW;
  END IF;

  IF OLD.creator_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF NEW.creator_id IS DISTINCT FROM OLD.creator_id
     OR NEW.match_date IS DISTINCT FROM OLD.match_date
     OR NEW.start_hour IS DISTINCT FROM OLD.start_hour
     OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours
     OR NEW.max_players IS DISTINCT FROM OLD.max_players
     OR NEW.skill_level IS DISTINCT FROM OLD.skill_level
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.status <> 'cancelado'
     OR char_length(COALESCE(NEW.cancelled_reason, '')) > 200
  THEN
    RAISE EXCEPTION 'O criador so pode cancelar o proprio match.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_open_match_fields ON public.open_matches;
CREATE TRIGGER protect_open_match_fields
  BEFORE UPDATE ON public.open_matches
  FOR EACH ROW EXECUTE FUNCTION public.protect_open_match_fields();

REVOKE EXECUTE ON FUNCTION public.protect_open_match_fields()
FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Creator or admin can delete" ON public.open_matches;
CREATE POLICY "Admins delete open matches"
ON public.open_matches FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated can view participants"
ON public.open_match_participants;
CREATE POLICY "Participants visible with accessible match"
ON public.open_match_participants FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1
    FROM public.open_matches match
    WHERE match.id = open_match_participants.match_id
      AND (
        match.creator_id = auth.uid()
        OR match.status IN ('aprovado', 'fechado')
      )
  )
);

DROP POLICY IF EXISTS "Users join as themselves"
ON public.open_match_participants;
CREATE POLICY "Users join available matches"
ON public.open_match_participants FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.open_matches match
    WHERE match.id = open_match_participants.match_id
      AND match.status = 'aprovado'
      AND match.match_date >= current_date
      AND match.creator_id <> auth.uid()
      AND (
        SELECT COUNT(*)
        FROM public.open_match_participants participant
        WHERE participant.match_id = match.id
      ) < match.max_players - 1
  )
);

DROP POLICY IF EXISTS "Admin updates any block" ON public.blocked_slots;
CREATE POLICY "Admin or professor updates own block"
ON public.blocked_slots FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'professor')
    AND blocked_by = auth.uid()
    AND professor_id = auth.uid()
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'professor')
    AND blocked_by = auth.uid()
    AND professor_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Admin or owner deletes block" ON public.blocked_slots;
CREATE POLICY "Admin or professor deletes own block"
ON public.blocked_slots FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'professor')
    AND blocked_by = auth.uid()
    AND professor_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
REVOKE INSERT ON public.profiles FROM authenticated;

CREATE OR REPLACE FUNCTION public.protect_profile_managed_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role'
     OR public.has_role(auth.uid(), 'admin')
  THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.games_won IS DISTINCT FROM OLD.games_won
     OR NEW.aces IS DISTINCT FROM OLD.aces
     OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
     OR NEW.referred_by IS DISTINCT FROM OLD.referred_by
  THEN
    RAISE EXCEPTION 'Campos gerenciados pelo sistema nao podem ser alterados.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_managed_fields ON public.profiles;
CREATE TRIGGER protect_profile_managed_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_managed_fields();

REVOKE EXECUTE ON FUNCTION public.protect_profile_managed_fields()
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_notification_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.related_booking_id IS DISTINCT FROM OLD.related_booking_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Somente o estado de leitura pode ser alterado.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_notification_fields ON public.notifications;
CREATE TRIGGER protect_notification_fields
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.protect_notification_fields();

REVOKE EXECUTE ON FUNCTION public.protect_notification_fields()
FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Professor or admin creates" ON public.student_evaluations;
CREATE POLICY "Professor creates linked student evaluation"
ON public.student_evaluations FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'professor')
    AND professor_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.bookings booking
      WHERE booking.user_id = student_evaluations.student_id
        AND booking.professor_id = auth.uid()
    )
  )
);

CREATE OR REPLACE FUNCTION public.protect_student_evaluation_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role'
     OR public.has_role(auth.uid(), 'admin')
  THEN
    RETURN NEW;
  END IF;

  IF OLD.professor_id <> auth.uid()
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.professor_id IS DISTINCT FROM OLD.professor_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'A identidade da avaliacao nao pode ser alterada.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_student_evaluation_identity
ON public.student_evaluations;
CREATE TRIGGER protect_student_evaluation_identity
  BEFORE UPDATE ON public.student_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.protect_student_evaluation_identity();

REVOKE EXECUTE ON FUNCTION public.protect_student_evaluation_identity()
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_open_match_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.open_matches%ROWTYPE;
  v_participant_count integer;
BEGIN
  SELECT *
  INTO v_match
  FROM public.open_matches
  WHERE id = NEW.match_id
  FOR UPDATE;

  IF NEW.user_id <> auth.uid()
     OR v_match.id IS NULL
     OR v_match.status <> 'aprovado'
     OR v_match.match_date < current_date
     OR v_match.creator_id = NEW.user_id
  THEN
    RAISE EXCEPTION 'Nao e possivel entrar neste match.';
  END IF;

  SELECT COUNT(*)
  INTO v_participant_count
  FROM public.open_match_participants
  WHERE match_id = NEW.match_id;

  IF v_participant_count >= v_match.max_players - 1 THEN
    RAISE EXCEPTION 'Este match ja esta completo.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_open_match_participant
ON public.open_match_participants;
CREATE TRIGGER validate_open_match_participant
  BEFORE INSERT ON public.open_match_participants
  FOR EACH ROW EXECUTE FUNCTION public.validate_open_match_participant();

REVOKE EXECUTE ON FUNCTION public.validate_open_match_participant()
FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "contracts student insert own" ON public.class_contracts;
REVOKE INSERT ON public.class_contracts FROM authenticated;

DROP POLICY IF EXISTS "coach_profiles self insert" ON public.coach_profiles;
CREATE POLICY "professor inserts own coach profile"
ON public.coach_profiles FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.has_role(auth.uid(), 'professor')
  AND NOT is_default
  AND active
);

DROP POLICY IF EXISTS "coach_profiles self update" ON public.coach_profiles;
CREATE POLICY "professor updates own coach profile"
ON public.coach_profiles FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  AND public.has_role(auth.uid(), 'professor')
)
WITH CHECK (
  user_id = auth.uid()
  AND public.has_role(auth.uid(), 'professor')
);

CREATE OR REPLACE FUNCTION public.protect_coach_profile_admin_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role'
     OR public.has_role(auth.uid(), 'admin')
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.is_default IS DISTINCT FROM OLD.is_default
    OR NEW.active IS DISTINCT FROM OLD.active
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Ativacao e coach padrao sao definidos pelo administrador.';
  END IF;

  IF TG_OP = 'INSERT' AND (NEW.is_default OR NOT NEW.active) THEN
    RAISE EXCEPTION 'Ativacao e coach padrao sao definidos pelo administrador.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_coach_profile_admin_fields
ON public.coach_profiles;
CREATE TRIGGER protect_coach_profile_admin_fields
  BEFORE INSERT OR UPDATE ON public.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_coach_profile_admin_fields();

REVOKE EXECUTE ON FUNCTION public.protect_coach_profile_admin_fields()
FROM PUBLIC, anon, authenticated;
