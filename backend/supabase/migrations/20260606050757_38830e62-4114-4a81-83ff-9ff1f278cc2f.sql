
-- ============= Add fields to bookings =============
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS card_operator_id UUID,
  ADD COLUMN IF NOT EXISTS amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS attended BOOLEAN,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- ============= Add fields to profiles =============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS referred_by UUID;

-- ============= pricing =============
CREATE TABLE IF NOT EXISTS public.pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_type public.booking_type NOT NULL UNIQUE,
  price_cents INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pricing TO authenticated;
GRANT ALL ON public.pricing TO service_role;
ALTER TABLE public.pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view pricing" ON public.pricing FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage pricing" ON public.pricing FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER pricing_touch_updated BEFORE UPDATE ON public.pricing FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.pricing (booking_type, price_cents) VALUES
  ('quadra_livre', 6000),
  ('aula_individual', 12000),
  ('aula_dupla', 8000),
  ('aula_trio', 6500),
  ('aula_quarteto', 5500)
ON CONFLICT (booking_type) DO NOTHING;

-- ============= card_operators =============
CREATE TABLE IF NOT EXISTS public.card_operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.card_operators TO authenticated;
GRANT ALL ON public.card_operators TO service_role;
ALTER TABLE public.card_operators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view operators" ON public.card_operators FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage operators" ON public.card_operators FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER operators_touch_updated BEFORE UPDATE ON public.card_operators FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============= costs =============
CREATE TABLE IF NOT EXISTS public.costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  category TEXT,
  amount_cents INTEGER NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'mensal', -- 'mensal' | 'avulso'
  incurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.costs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.costs TO authenticated;
ALTER TABLE public.costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view costs" ON public.costs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write costs" ON public.costs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER costs_touch_updated BEFORE UPDATE ON public.costs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============= staff_invites =============
CREATE TABLE IF NOT EXISTS public.staff_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role public.app_role NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente | aceito | expirado | cancelado
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.staff_invites TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_invites TO authenticated;
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view invites" ON public.staff_invites FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write invites" ON public.staff_invites FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER invites_touch_updated BEFORE UPDATE ON public.staff_invites FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============= gamification_rules =============
CREATE TABLE IF NOT EXISTS public.gamification_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL UNIQUE, -- aula_concluida, quadra_alugada, indicacao, frequencia_semanal, falta
  label TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.gamification_rules TO authenticated;
GRANT ALL ON public.gamification_rules TO service_role;
ALTER TABLE public.gamification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view rules" ON public.gamification_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage rules" ON public.gamification_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER rules_touch_updated BEFORE UPDATE ON public.gamification_rules FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.gamification_rules (event_type, label, points) VALUES
  ('aula_concluida', 'Aula concluída', 10),
  ('quadra_alugada', 'Quadra livre alugada', 5),
  ('indicacao', 'Indicou novo aluno', 30),
  ('frequencia_semanal', 'Frequência semanal (3+ aulas)', 15),
  ('falta', 'Faltou sem cancelar', -5)
ON CONFLICT (event_type) DO NOTHING;

-- ============= gamification_events =============
CREATE TABLE IF NOT EXISTS public.gamification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  points INTEGER NOT NULL,
  ref_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.gamification_events TO service_role;
GRANT SELECT, INSERT ON public.gamification_events TO authenticated;
ALTER TABLE public.gamification_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own gamification" ON public.gamification_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write gamification" ON public.gamification_events FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_gamification_user ON public.gamification_events(user_id);

-- ============= Admin sees all bookings (replace policy) =============
DROP POLICY IF EXISTS "Authenticated can view bookings" ON public.bookings;
CREATE POLICY "Authenticated can view bookings" ON public.bookings FOR SELECT TO authenticated
  USING (true);
-- Admin can update any booking (payment/attendance)
DROP POLICY IF EXISTS "Users update their own bookings" ON public.bookings;
CREATE POLICY "Users or admins update bookings" ON public.bookings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
