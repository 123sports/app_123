-- Complete the administrator activity feed with checkout lifecycle events.
-- Financial truth remains in checkout_orders, its status history and the credit ledger.

-- The original terminal transition only released direct-booking holds. Plan
-- purchases now create an initial booking too, so every unpaid terminal state
-- must release that hold in the same transaction. Refund notifications for
-- staff are centralized in notify_staff_checkout_activity to avoid duplicates.
CREATE OR REPLACE FUNCTION public.apply_terminal_checkout_to_bookings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('expired', 'cancelled', 'failed')
     AND NEW.kind IN ('booking', 'class_plan')
  THEN
    UPDATE public.bookings
    SET status = 'cancelada',
        payment_status = CASE NEW.status
          WHEN 'expired' THEN 'expirado'
          WHEN 'cancelled' THEN 'cancelado'
          ELSE 'falhou'
        END,
        hold_expires_at = NULL
    WHERE checkout_order_id = NEW.id
      AND status = 'pendente'
      AND payment_status = 'pendente';
  ELSIF NEW.status = 'refunded' AND NEW.kind = 'booking' THEN
    UPDATE public.bookings
    SET status = CASE
          WHEN status IN ('pendente', 'confirmada') THEN 'cancelada'::public.booking_status
          ELSE status
        END,
        payment_status = 'estornado',
        hold_expires_at = NULL
    WHERE checkout_order_id = NEW.id
      AND payment_status <> 'estornado';

    INSERT INTO public.notifications (
      user_id, title, body, kind, related_checkout_order_id
    )
    VALUES (
      NEW.user_id,
      'Pagamento estornado',
      'O estorno de ' || NEW.description
        || ' foi confirmado. Se precisar, escolha um novo horário na agenda.',
      'payment_refunded',
      NEW.id
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_terminal_checkout_to_bookings()
FROM PUBLIC, anon, authenticated, service_role;

-- Keep this migration deployable even if an old retry produced duplicate
-- operational notifications before the uniqueness rule existed.
DELETE FROM public.notifications duplicate
USING public.notifications original
WHERE duplicate.user_id = original.user_id
  AND duplicate.kind = original.kind
  AND duplicate.related_checkout_order_id = original.related_checkout_order_id
  AND duplicate.related_checkout_order_id IS NOT NULL
  AND duplicate.kind IN (
    'payment_pending',
    'payment_expired',
    'payment_cancelled',
    'payment_failed',
    'payment_refunded'
  )
  AND (duplicate.created_at, duplicate.id) > (original.created_at, original.id);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_checkout_activity_recipient_uidx
  ON public.notifications (user_id, kind, related_checkout_order_id)
  WHERE kind IN (
    'payment_pending',
    'payment_expired',
    'payment_cancelled',
    'payment_failed',
    'payment_refunded'
  )
  AND related_checkout_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notify_staff_checkout_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_name text;
  v_amount text;
  v_kind text;
  v_title text;
  v_body text;
  v_booking_date text;
  v_booking_day text;
  v_start_hour text;
  v_professor_id uuid;
  v_has_booking boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RETURN NEW;
    END IF;
    v_kind := 'payment_pending';
  ELSE
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;

    v_kind := CASE NEW.status
      WHEN 'expired' THEN 'payment_expired'
      WHEN 'cancelled' THEN 'payment_cancelled'
      WHEN 'failed' THEN 'payment_failed'
      WHEN 'refunded' THEN 'payment_refunded'
      ELSE NULL
    END;

    IF v_kind IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT COALESCE(profile.full_name, 'Aluno')
  INTO v_student_name
  FROM public.profiles profile
  WHERE profile.id = NEW.user_id;
  v_student_name := COALESCE(v_student_name, 'Aluno');

  v_amount := 'R$ ' || (NEW.amount_cents / 100)::text || ','
    || lpad((NEW.amount_cents % 100)::text, 2, '0');
  v_booking_date := NULLIF(
    COALESCE(
      NEW.metadata #>> '{initial_booking,booking_date}',
      NEW.metadata->>'booking_date'
    ),
    ''
  );
  v_start_hour := NULLIF(
    COALESCE(
      NEW.metadata #>> '{initial_booking,start_hour}',
      NEW.metadata->>'start_hour',
      CASE
        WHEN jsonb_typeof(NEW.metadata->'hours') = 'array'
          THEN NEW.metadata->'hours'->>0
        ELSE NULL
      END
    ),
    ''
  );
  v_has_booking := v_booking_date ~ '^\d{4}-\d{2}-\d{2}$'
    AND v_start_hour ~ '^\d{1,2}$';

  IF v_has_booking THEN
    v_booking_day := substr(v_booking_date, 9, 2) || '/' || substr(v_booking_date, 6, 2);
  END IF;

  BEGIN
    v_professor_id := NULLIF(
      COALESCE(
        NEW.metadata #>> '{initial_booking,professor_id}',
        NEW.metadata->>'professor_id'
      ),
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_professor_id := NULL;
  END;

  CASE v_kind
    WHEN 'payment_pending' THEN
      v_title := CASE WHEN v_has_booking THEN 'Pix iniciado para uma aula' ELSE 'Novo Pix iniciado' END;
      v_body := v_student_name || ' iniciou um Pix de ' || v_amount || ' por ' || NEW.description || '.';
      IF v_has_booking THEN
        v_body := v_body || ' O horário de ' || v_booking_day || ' às '
          || lpad(v_start_hour, 2, '0') || ':00 fica reservado provisoriamente'
          || CASE
            WHEN NEW.expires_at IS NOT NULL THEN ' até '
              || to_char(NEW.expires_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') || '.'
            ELSE '.'
          END;
      END IF;
    WHEN 'payment_expired' THEN
      v_title := CASE WHEN v_has_booking THEN 'Pix expirado e horário liberado' ELSE 'Pix expirado' END;
      v_body := v_student_name || ' não concluiu o Pix de ' || v_amount || ' por ' || NEW.description || '.';
      IF v_has_booking THEN
        v_body := v_body || ' A reserva provisória de ' || v_booking_day || ' às '
          || lpad(v_start_hour, 2, '0') || ':00 foi cancelada e a vaga está disponível novamente.';
      END IF;
    WHEN 'payment_cancelled' THEN
      v_title := CASE WHEN v_has_booking THEN 'Pix cancelado e horário liberado' ELSE 'Pix cancelado' END;
      v_body := 'A cobrança de ' || v_student_name || ', no valor de ' || v_amount || ', foi cancelada.';
      IF v_has_booking THEN
        v_body := v_body || ' A reserva provisória de ' || v_booking_day || ' às '
          || lpad(v_start_hour, 2, '0') || ':00 foi liberada.';
      END IF;
    WHEN 'payment_failed' THEN
      v_title := CASE WHEN v_has_booking THEN 'Pagamento não concluído' ELSE 'Pix não concluído' END;
      v_body := 'O Pix de ' || v_student_name || ', no valor de ' || v_amount || ', não foi concluído.';
      IF v_has_booking THEN
        v_body := v_body || ' A reserva provisória de ' || v_booking_day || ' às '
          || lpad(v_start_hour, 2, '0') || ':00 foi liberada.';
      END IF;
    WHEN 'payment_refunded' THEN
      v_title := 'Pagamento estornado';
      v_body := 'O Pix de ' || v_student_name || ', no valor de ' || v_amount || ', foi estornado.';
    ELSE
      RETURN NEW;
  END CASE;

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_checkout_order_id
  )
  SELECT DISTINCT
    recipient.user_id,
    v_title,
    v_body,
    v_kind,
    NEW.id
  FROM (
    SELECT role_row.user_id
    FROM public.user_roles role_row
    WHERE role_row.role = 'admin'
    UNION
    SELECT v_professor_id
    WHERE v_professor_id IS NOT NULL
  ) recipient
  WHERE recipient.user_id <> NEW.user_id
  ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- An operational notification must never interrupt checkout reconciliation.
  RAISE WARNING 'Could not create checkout activity notification for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_staff_checkout_activity()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS checkout_orders_40_notify_staff_activity
ON public.checkout_orders;
CREATE TRIGGER checkout_orders_40_notify_staff_activity
  AFTER INSERT OR UPDATE OF status ON public.checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_staff_checkout_activity();
