-- Keep payment and booking notifications clear for students and actionable
-- for the team without exposing internal reconciliation messages.

CREATE OR REPLACE FUNCTION public.notify_on_booking_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_label text;
BEGIN
  IF NEW.status = 'confirmada'
     AND OLD.status IS DISTINCT FROM 'confirmada'
     AND NEW.checkout_order_id IS NULL
  THEN
    v_booking_label := CASE NEW.type
      WHEN 'quadra_livre' THEN 'sua reserva da quadra'
      WHEN 'aula_individual' THEN 'sua aula individual'
      WHEN 'aula_dupla' THEN 'sua aula em dupla'
      WHEN 'aula_trio' THEN 'sua aula em trio'
      WHEN 'aula_quarteto' THEN 'sua aula em quarteto'
      WHEN 'teste' THEN 'sua reserva de teste'
    END;

    INSERT INTO public.notifications (
      user_id, title, body, kind, related_booking_id
    )
    VALUES (
      NEW.user_id,
      'Reserva confirmada',
      'Tudo certo! ' || upper(left(v_booking_label, 1)) || substr(v_booking_label, 2)
        || ' está confirmada para '
        || to_char(NEW.booking_date, 'DD/MM') || ', às '
        || lpad(NEW.start_hour::text, 2, '0') || ':00.',
      'booking_confirmed',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_on_booking_confirm()
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_on_checkout_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_professor_id uuid;
  v_student_name text;
  v_amount text;
  v_first_booking_id uuid;
BEGIN
  IF NEW.status <> 'paid' OR OLD.status = 'paid' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_professor_id := NULLIF(NEW.metadata->>'professor_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_professor_id := NULL;
  END;

  SELECT COALESCE(
    (
      SELECT profile.full_name
      FROM public.profiles profile
      WHERE profile.id = NEW.user_id
    ),
    'Aluno'
  )
  INTO v_student_name;

  SELECT booking.id
  INTO v_first_booking_id
  FROM public.bookings booking
  WHERE booking.checkout_order_id = NEW.id
  ORDER BY booking.booking_date, booking.start_hour, booking.id
  LIMIT 1;

  v_amount := 'R$ ' || (NEW.amount_cents / 100)::text || ','
    || lpad((NEW.amount_cents % 100)::text, 2, '0');

  INSERT INTO public.notifications (
    user_id, title, body, kind, related_booking_id
  )
  VALUES (
    NEW.user_id,
    'Reserva confirmada',
    'Tudo certo! Recebemos seu Pix de ' || v_amount
      || ' e sua reserva está confirmada: ' || NEW.description || '.',
    'booking_confirmed',
    v_first_booking_id
  );

  FOR v_admin_id IN
    SELECT role_row.user_id
    FROM public.user_roles role_row
    WHERE role_row.role = 'admin'
      AND role_row.user_id <> NEW.user_id
  LOOP
    INSERT INTO public.notifications (
      user_id, title, body, kind, related_booking_id
    )
    VALUES (
      v_admin_id,
      'Novo pagamento confirmado',
      v_student_name || ' pagou ' || v_amount || ' via Pix. '
        || NEW.description || '.',
      'payment_paid',
      v_first_booking_id
    );
  END LOOP;

  IF v_professor_id IS NOT NULL
     AND v_professor_id <> NEW.user_id
     AND NOT EXISTS (
       SELECT 1
       FROM public.user_roles role_row
       WHERE role_row.user_id = v_professor_id
         AND role_row.role = 'admin'
     )
  THEN
    INSERT INTO public.notifications (
      user_id, title, body, kind, related_booking_id
    )
    VALUES (
      v_professor_id,
      'Novo pagamento confirmado',
      v_student_name || ' pagou ' || v_amount || ' via Pix. '
        || NEW.description || '.',
      'payment_paid',
      v_first_booking_id
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_on_checkout_paid()
FROM PUBLIC, anon, authenticated;

-- Remove only false review alerts from orders that are already fully paid.
DELETE FROM public.notifications notification
USING public.checkout_orders checkout_order
WHERE notification.kind = 'payment_review'
  AND checkout_order.status = 'paid'
  AND position(checkout_order.id::text IN COALESCE(notification.body, '')) > 0;

-- Make the remaining history understandable without exposing internal errors.
ALTER TABLE public.notifications DISABLE TRIGGER protect_notification_fields;

UPDATE public.notifications
SET title = 'Pagamento precisa de atenção',
    body = CASE
      WHEN body ILIKE '%sem reserva ativa%'
        THEN 'O Pix foi recebido depois que o prazo da reserva terminou. Confira o pagamento na área Financeiro e combine um novo horário com o aluno.'
      ELSE 'Este Pix não pôde ser conciliado automaticamente. Confira os detalhes na área Financeiro.'
    END
    || COALESCE(
      ' Referência ' || upper(substring(body FROM 'Pedido ([0-9a-f]{8})')) || '.',
      ''
    )
WHERE kind = 'payment_review';

UPDATE public.notifications
SET title = 'Novo pagamento confirmado'
WHERE kind = 'payment_paid'
  AND title = 'Pagamento Pix aprovado';

UPDATE public.notifications
SET title = 'Reserva confirmada',
    body = CASE
      WHEN body IS NOT NULL AND body NOT ILIKE 'Tudo certo!%'
        THEN 'Tudo certo! ' || body
      ELSE body
    END
WHERE kind = 'booking_confirmed';

UPDATE public.notifications
SET title = 'Horário alterado',
    body = replace(body, ' as ', ' às ')
WHERE kind = 'booking_rescheduled'
  AND title = 'Horario alterado';

ALTER TABLE public.notifications ENABLE TRIGGER protect_notification_fields;
