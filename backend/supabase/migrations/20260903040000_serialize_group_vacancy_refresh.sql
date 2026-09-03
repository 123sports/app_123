-- Serialize notification refreshes for the same class. Payment confirmation
-- must never fail because two seats were confirmed concurrently.

CREATE OR REPLACE FUNCTION public.refresh_group_vacancy_notifications(
  p_session_id uuid,
  p_actor_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.reservation_sessions%ROWTYPE;
  v_occupied integer;
  v_recipient uuid;
  v_date_text text;
  v_body text;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('group-vacancy:' || p_session_id::text, 0)
  );

  DELETE FROM public.notifications notification
  WHERE notification.kind = 'group_vacancy_suggestion'
    AND notification.related_session_id = p_session_id;

  SELECT * INTO v_session
  FROM public.reservation_sessions session
  WHERE session.id = p_session_id;

  IF v_session.id IS NULL
     OR v_session.product_type NOT IN ('aula_trio', 'aula_quarteto')
     OR v_session.status <> 'open'
     OR (v_session.booking_date + make_time(v_session.start_hour, 0, 0))
          AT TIME ZONE 'America/Sao_Paulo' <= now()
  THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::integer INTO v_occupied
  FROM public.bookings booking
  WHERE booking.session_id = v_session.id
    AND booking.status = 'confirmada'
    AND booking.payment_status = 'pago';

  IF v_occupied < 1 OR v_occupied >= v_session.capacity THEN
    RETURN;
  END IF;

  v_date_text := to_char(v_session.booking_date, 'DD/MM/YYYY');
  v_body := 'Uma aula em grupo em ' || v_date_text || ' às '
    || lpad(v_session.start_hour::text, 2, '0') || ':00 está com '
    || v_occupied || ' de ' || v_session.capacity
    || ' vagas ocupadas. Você pode usar um crédito de grupo para participar.';

  FOR v_recipient IN
    SELECT grant_row.user_id
    FROM public.student_credit_grants grant_row
    JOIN public.user_roles role_row
      ON role_row.user_id = grant_row.user_id AND role_row.role = 'aluno'
    WHERE grant_row.status = 'active'
      AND grant_row.modality = 'grupo'
      AND grant_row.user_id IS DISTINCT FROM p_actor_id
      AND (
        SELECT COALESCE(SUM(ledger.credit_delta), 0)
        FROM public.student_credit_ledger ledger
        WHERE ledger.grant_id = grant_row.id
      ) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.bookings own_booking
        WHERE own_booking.session_id = v_session.id
          AND own_booking.user_id = grant_row.user_id
          AND own_booking.status = 'confirmada'
          AND own_booking.payment_status = 'pago'
      )
    GROUP BY grant_row.user_id
  LOOP
    INSERT INTO public.notifications (
      user_id, title, body, kind, related_session_id
    ) VALUES (
      v_recipient,
      'Turma com vaga disponível',
      v_body,
      'group_vacancy_suggestion',
      v_session.id
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_group_vacancy_notifications(uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role;
