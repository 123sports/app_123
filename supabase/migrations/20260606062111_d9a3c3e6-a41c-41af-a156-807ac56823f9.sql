
-- 1. Add unique referral_code column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;

-- Helper to generate a short readable code
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_code text;
  v_exists boolean;
BEGIN
  LOOP
    v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE referral_code = v_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_code;
END;
$$;

-- Backfill existing rows
UPDATE public.profiles SET referral_code = public.generate_referral_code()
WHERE referral_code IS NULL;

-- 2. Rewards table
CREATE TABLE public.referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_referrals integer NOT NULL,
  discount_percent integer NOT NULL,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (min_referrals)
);

GRANT SELECT ON public.referral_rewards TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.referral_rewards TO authenticated;
GRANT ALL ON public.referral_rewards TO service_role;

ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view rewards" ON public.referral_rewards
  FOR SELECT TO anon, authenticated USING (active);

CREATE POLICY "Admins manage rewards" ON public.referral_rewards
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER referral_rewards_touch
  BEFORE UPDATE ON public.referral_rewards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.referral_rewards (min_referrals, discount_percent, label) VALUES
  (3, 10, 'Bronze — 3 amigos'),
  (5, 20, 'Prata — 5 amigos'),
  (10, 35, 'Ouro — 10 amigos')
ON CONFLICT (min_referrals) DO NOTHING;

-- 3. Hook into signup: read referral_code from raw_user_meta_data and assign code + referred_by
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite RECORD;
  v_ref_code text;
  v_referrer uuid;
BEGIN
  v_ref_code := upper(NULLIF(NEW.raw_user_meta_data->>'referral_code', ''));
  IF v_ref_code IS NOT NULL THEN
    SELECT id INTO v_referrer FROM public.profiles WHERE referral_code = v_ref_code LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, full_name, avatar_url, referral_code, referred_by)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    public.generate_referral_code(),
    v_referrer
  );

  -- Pending invite path
  SELECT * INTO v_invite
  FROM public.staff_invites
  WHERE lower(email) = lower(NEW.email)
    AND status = 'pendente'
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_invite.id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_invite.role)
      ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.staff_invites SET status = 'aceito', accepted_at = now() WHERE id = v_invite.id;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'aluno')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  -- Notify referrer
  IF v_referrer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      v_referrer,
      'Indicação confirmada! 🎉',
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)) || ' entrou pela sua indicação.',
      'referral_new'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Status helper
CREATE OR REPLACE FUNCTION public.get_referral_status(_user_id uuid)
RETURNS TABLE (
  total_referrals integer,
  current_discount integer,
  next_tier_at integer,
  next_tier_discount integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH counts AS (
    SELECT COUNT(*)::int AS total FROM public.profiles WHERE referred_by = _user_id
  ),
  current AS (
    SELECT discount_percent, min_referrals FROM public.referral_rewards
    WHERE active AND min_referrals <= (SELECT total FROM counts)
    ORDER BY min_referrals DESC LIMIT 1
  ),
  next AS (
    SELECT discount_percent, min_referrals FROM public.referral_rewards
    WHERE active AND min_referrals > (SELECT total FROM counts)
    ORDER BY min_referrals ASC LIMIT 1
  )
  SELECT
    (SELECT total FROM counts),
    COALESCE((SELECT discount_percent FROM current), 0),
    (SELECT min_referrals FROM next),
    (SELECT discount_percent FROM next)
$$;

GRANT EXECUTE ON FUNCTION public.get_referral_status(uuid) TO authenticated;
