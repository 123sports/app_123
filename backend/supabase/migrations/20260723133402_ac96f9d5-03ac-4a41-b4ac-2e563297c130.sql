
CREATE TABLE public.platform_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  title text NOT NULL,
  content text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_terms TO authenticated;
GRANT ALL ON public.platform_terms TO service_role;
ALTER TABLE public.platform_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticados podem ler termos" ON public.platform_terms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins gerenciam termos" ON public.platform_terms FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_platform_terms_updated BEFORE UPDATE ON public.platform_terms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.user_terms_acceptance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_id uuid NOT NULL REFERENCES public.platform_terms(id) ON DELETE CASCADE,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, terms_id)
);
GRANT SELECT, INSERT ON public.user_terms_acceptance TO authenticated;
GRANT ALL ON public.user_terms_acceptance TO service_role;
ALTER TABLE public.user_terms_acceptance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuário vê seus aceites" ON public.user_terms_acceptance FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Usuário registra seu aceite" ON public.user_terms_acceptance FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
