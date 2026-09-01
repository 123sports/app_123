-- A login belongs to exactly one application audience.

WITH ranked_roles AS (
  SELECT
    user_id,
    role,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY CASE role
        WHEN 'admin' THEN 1
        WHEN 'professor' THEN 2
        ELSE 3
      END
    ) AS position
  FROM public.user_roles
)
DELETE FROM public.user_roles role_row
USING ranked_roles ranked
WHERE role_row.user_id = ranked.user_id
  AND role_row.role = ranked.role
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_role_per_user
ON public.user_roles (user_id);

CREATE OR REPLACE FUNCTION public.accept_staff_invite(_token text)
RETURNS public.app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invite public.staff_invites%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria.';
  END IF;

  SELECT lower(email)
  INTO v_user_email
  FROM auth.users
  WHERE id = v_user_id;

  SELECT *
  INTO v_invite
  FROM public.staff_invites
  WHERE token = _token
  FOR UPDATE;

  IF v_invite.id IS NULL
     OR v_invite.status <> 'pendente'
     OR v_invite.expires_at <= now()
  THEN
    RAISE EXCEPTION 'Convite invalido ou expirado.';
  END IF;

  IF lower(v_invite.email) <> v_user_email THEN
    RAISE EXCEPTION 'O convite pertence a outro e-mail.';
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = v_user_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, v_invite.role);

  UPDATE public.staff_invites
  SET status = 'aceito',
      accepted_at = now()
  WHERE id = v_invite.id;

  RETURN v_invite.role;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_staff_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_staff_invite(text) TO authenticated;
