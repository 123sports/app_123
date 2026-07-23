
-- 1) profiles: campos legais
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cpf text,
  ADD COLUMN IF NOT EXISTS guardian_name text,
  ADD COLUMN IF NOT EXISTS guardian_cpf text,
  ADD COLUMN IF NOT EXISTS guardian_email text,
  ADD COLUMN IF NOT EXISTS guardian_phone text;

-- 2) class_plans: modalidade e duração da aula
ALTER TABLE public.class_plans
  ADD COLUMN IF NOT EXISTS modality text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS class_duration_min integer NOT NULL DEFAULT 60;

-- 3) coach_profiles
CREATE TABLE IF NOT EXISTS public.coach_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  cpf_cnpj text,
  email text,
  phone text,
  address text,
  venue_name text,
  venue_address text,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_profiles TO authenticated;
GRANT ALL ON public.coach_profiles TO service_role;

ALTER TABLE public.coach_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_profiles read auth" ON public.coach_profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "coach_profiles self update" ON public.coach_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "coach_profiles self insert" ON public.coach_profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "coach_profiles admin write" ON public.coach_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_coach_profiles_touch BEFORE UPDATE ON public.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Garante apenas um coach padrão
CREATE UNIQUE INDEX IF NOT EXISTS coach_profiles_one_default
  ON public.coach_profiles ((1)) WHERE is_default = true;

-- 4) contract_settings (single-row config)
CREATE TABLE IF NOT EXISTS public.contract_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  cancel_window text NOT NULL DEFAULT '12 horas',
  reposition_window text NOT NULL DEFAULT '30 dias',
  late_fee_pct numeric(5,2) NOT NULL DEFAULT 2.00,
  late_interest_pct numeric(5,2) NOT NULL DEFAULT 1.00,
  suspension_days integer NOT NULL DEFAULT 10,
  payment_method text NOT NULL DEFAULT 'Pix / cartão / boleto',
  day_due text NOT NULL DEFAULT 'dia 5',
  foro_city text NOT NULL DEFAULT 'São Paulo',
  foro_state text NOT NULL DEFAULT 'SP',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.contract_settings TO authenticated;
GRANT ALL ON public.contract_settings TO service_role;

ALTER TABLE public.contract_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contract_settings read auth" ON public.contract_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "contract_settings admin write" ON public.contract_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_contract_settings_touch BEFORE UPDATE ON public.contract_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Insere linha única se não existir
INSERT INTO public.contract_settings (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;
