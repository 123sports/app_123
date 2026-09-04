-- Keep the client as the sole administrator without losing active schedule blocks.
DO $$
DECLARE
  v_old_admin constant uuid := '97b3f9ce-0442-44a4-bf21-45278e1bddb5'::uuid;
  v_client_admin constant uuid := '16d8b3e2-90f8-4d8a-96f1-5ce33a695474'::uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users user_row
    JOIN public.user_roles role_row ON role_row.user_id = user_row.id
    WHERE user_row.id = v_client_admin
      AND lower(user_row.email) = 'ontennisfloripa@gmail.com'
      AND role_row.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Client administrator account is missing or invalid';
  END IF;

  -- Provider-linked bookings only accept sensitive changes from the trusted
  -- server context. This setting is transaction-local to this migration.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- Sessions must move first because booking updates validate their professor
  -- against the linked session in the same transaction.
  UPDATE public.reservation_sessions
  SET professor_id = v_client_admin
  WHERE professor_id = v_old_admin;

  UPDATE public.bookings
  SET professor_id = v_client_admin
  WHERE professor_id = v_old_admin;

  UPDATE public.blocked_slots
  SET blocked_by = v_client_admin
  WHERE blocked_by = v_old_admin;

  UPDATE public.blocked_slots
  SET professor_id = v_client_admin
  WHERE professor_id = v_old_admin;

  UPDATE public.staff_invites
  SET invited_by = v_client_admin
  WHERE invited_by = v_old_admin;

  UPDATE public.profiles
  SET full_name = 'Olimpio Neto'
  WHERE id = v_client_admin;

  UPDATE auth.users
  SET raw_user_meta_data = jsonb_set(
    jsonb_set(
      COALESCE(raw_user_meta_data, '{}'::jsonb),
      '{full_name}',
      to_jsonb('Olimpio Neto'::text),
      true
    ),
    '{name}',
    to_jsonb('Olimpio Neto'::text),
    true
  )
  WHERE id = v_client_admin;

  DELETE FROM auth.users
  WHERE id = v_old_admin
    AND lower(email) = 'contato123sports@gmail.com';

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_old_admin) THEN
    RAISE EXCEPTION 'Previous administrator account was not removed';
  END IF;

  IF (SELECT count(*) FROM public.user_roles WHERE role = 'admin') <> 1 THEN
    RAISE EXCEPTION 'The platform must have exactly one administrator';
  END IF;
END;
$$;
