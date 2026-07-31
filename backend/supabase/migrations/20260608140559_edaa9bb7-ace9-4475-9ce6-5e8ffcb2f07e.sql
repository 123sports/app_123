
DROP POLICY IF EXISTS "Anyone authenticated can view profiles" ON public.profiles;

CREATE POLICY "Users view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Professors view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'professor'));

DROP VIEW IF EXISTS public.profiles_public;
CREATE VIEW public.profiles_public
WITH (security_invoker = off) AS
SELECT id, full_name, avatar_url, skill_level, bio, dominant_hand,
       years_playing, games_won, aces, referral_code
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO authenticated, anon;
