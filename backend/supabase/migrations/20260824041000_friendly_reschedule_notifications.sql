-- Normalize reschedule copy at the notification boundary so both the student
-- and team messages remain friendly even when emitted by the existing RPC.

CREATE OR REPLACE FUNCTION public.friendly_reschedule_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.kind <> 'booking_rescheduled' THEN
    RETURN NEW;
  END IF;

  NEW.body := replace(NEW.body, ' as ', ' às ');

  IF NEW.title IN ('Horario alterado', 'Horário alterado') THEN
    NEW.title := 'Horário alterado';
    IF NEW.body NOT ILIKE 'Tudo certo!%' THEN
      NEW.body := 'Tudo certo! ' || NEW.body;
    END IF;
  ELSE
    NEW.title := 'Reserva atualizada';
    IF NEW.body NOT ILIKE '%agenda já foi atualizada.%' THEN
      NEW.body := NEW.body || ' A agenda já foi atualizada.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.friendly_reschedule_notification()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS friendly_reschedule_notification ON public.notifications;
CREATE TRIGGER friendly_reschedule_notification
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.friendly_reschedule_notification();

ALTER TABLE public.notifications DISABLE TRIGGER protect_notification_fields;

UPDATE public.notifications
SET title = CASE
      WHEN title IN ('Horario alterado', 'Horário alterado')
        THEN 'Horário alterado'
      ELSE 'Reserva atualizada'
    END,
    body = CASE
      WHEN title IN ('Horario alterado', 'Horário alterado')
        THEN CASE
          WHEN body ILIKE 'Tudo certo!%' THEN replace(body, ' as ', ' às ')
          ELSE 'Tudo certo! ' || replace(body, ' as ', ' às ')
        END
      ELSE replace(body, ' as ', ' às ')
        || CASE
          WHEN body ILIKE '%agenda já foi atualizada.%' THEN ''
          ELSE ' A agenda já foi atualizada.'
        END
    END
WHERE kind = 'booking_rescheduled';

ALTER TABLE public.notifications ENABLE TRIGGER protect_notification_fields;
