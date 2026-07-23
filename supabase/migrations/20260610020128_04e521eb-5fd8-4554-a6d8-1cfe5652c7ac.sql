
DO $$ BEGIN
  CREATE TYPE public.contract_status AS ENUM (
    'rascunho','proposta_aluno','proposta_admin','aguardando_aluno','aguardando_admin','vigente','recusado','encerrado'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.contract_signer AS ENUM ('aluno','admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.class_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frequency_per_week int NOT NULL CHECK (frequency_per_week BETWEEN 1 AND 7),
  duration_months int NOT NULL CHECK (duration_months IN (1,3,6,12)),
  price_cents int NOT NULL CHECK (price_cents >= 0),
  title text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (frequency_per_week, duration_months)
);
GRANT SELECT ON public.class_plans TO authenticated;
GRANT ALL ON public.class_plans TO service_role;
ALTER TABLE public.class_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans read auth" ON public.class_plans FOR SELECT TO authenticated USING (active OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "plans admin write" ON public.class_plans FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_class_plans_touch BEFORE UPDATE ON public.class_plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL UNIQUE,
  title text NOT NULL,
  body_md text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.contract_templates TO authenticated;
GRANT ALL ON public.contract_templates TO service_role;
ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "templates read auth" ON public.contract_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "templates admin write" ON public.contract_templates FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_contract_templates_touch BEFORE UPDATE ON public.contract_templates FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.class_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.class_plans(id),
  template_id uuid NOT NULL REFERENCES public.contract_templates(id),
  list_price_cents int NOT NULL,
  agreed_price_cents int NOT NULL,
  status public.contract_status NOT NULL DEFAULT 'rascunho',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_hash text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX idx_class_contracts_student ON public.class_contracts(student_id);
CREATE INDEX idx_class_contracts_status ON public.class_contracts(status);
GRANT SELECT, INSERT, UPDATE ON public.class_contracts TO authenticated;
GRANT ALL ON public.class_contracts TO service_role;
ALTER TABLE public.class_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contracts owner or admin read" ON public.class_contracts FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "contracts student insert own" ON public.class_contracts FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "contracts owner or admin update" ON public.class_contracts FOR UPDATE TO authenticated
  USING (student_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (student_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "contracts admin delete" ON public.class_contracts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_class_contracts_touch BEFORE UPDATE ON public.class_contracts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.freeze_contract_on_active()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS '
BEGIN
  IF OLD.status IN (''vigente'',''encerrado'',''recusado'') AND public.has_role(auth.uid(),''admin'') IS NOT TRUE THEN
    IF NEW.plan_id <> OLD.plan_id OR NEW.template_id <> OLD.template_id
       OR NEW.agreed_price_cents <> OLD.agreed_price_cents OR NEW.snapshot::text <> OLD.snapshot::text
       OR NEW.starts_on <> OLD.starts_on OR NEW.ends_on <> OLD.ends_on
       OR NEW.document_hash <> OLD.document_hash THEN
      RAISE EXCEPTION ''Contrato % nao pode mais ser alterado.'', OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END ';
CREATE TRIGGER trg_freeze_contract BEFORE UPDATE ON public.class_contracts FOR EACH ROW EXECUTE FUNCTION public.freeze_contract_on_active();

CREATE TABLE public.contract_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.class_contracts(id) ON DELETE CASCADE,
  signer_type public.contract_signer NOT NULL,
  signer_id uuid NOT NULL REFERENCES auth.users(id),
  document_hash text NOT NULL,
  ip text,
  user_agent text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, signer_type, document_hash)
);
GRANT SELECT, INSERT ON public.contract_signatures TO authenticated;
GRANT ALL ON public.contract_signatures TO service_role;
ALTER TABLE public.contract_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sig read participant" ON public.contract_signatures FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR
  EXISTS (SELECT 1 FROM public.class_contracts c WHERE c.id = contract_id AND c.student_id = auth.uid())
);
CREATE POLICY "sig insert self" ON public.contract_signatures FOR INSERT TO authenticated WITH CHECK (
  signer_id = auth.uid()
  AND (
    (signer_type = 'admin' AND public.has_role(auth.uid(),'admin'))
    OR (signer_type = 'aluno' AND EXISTS (SELECT 1 FROM public.class_contracts c WHERE c.id = contract_id AND c.student_id = auth.uid()))
  )
);

CREATE OR REPLACE FUNCTION public.process_contract_signature()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS '
DECLARE v_contract public.class_contracts%ROWTYPE;
        v_other boolean;
        v_admin_id uuid;
BEGIN
  SELECT * INTO v_contract FROM public.class_contracts WHERE id = NEW.contract_id;
  IF v_contract.document_hash <> NEW.document_hash THEN
    RAISE EXCEPTION ''Hash do documento nao confere com o contrato atual.'';
  END IF;
  IF v_contract.status IN (''recusado'',''encerrado'') THEN
    RAISE EXCEPTION ''Contrato nao esta em condicao de ser assinado.'';
  END IF;

  IF NEW.signer_type = ''aluno'' THEN
    UPDATE public.class_contracts SET status = ''aguardando_admin''
      WHERE id = NEW.contract_id AND status IN (''rascunho'',''aguardando_aluno'',''proposta_aluno'',''proposta_admin'');
  ELSIF NEW.signer_type = ''admin'' THEN
    UPDATE public.class_contracts SET status = ''aguardando_aluno''
      WHERE id = NEW.contract_id AND status IN (''rascunho'',''proposta_aluno'',''proposta_admin'');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.contract_signatures
    WHERE contract_id = NEW.contract_id
      AND document_hash = NEW.document_hash
      AND signer_type <> NEW.signer_type
  ) INTO v_other;

  IF v_other THEN
    UPDATE public.class_contracts SET status = ''vigente'' WHERE id = NEW.contract_id;
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (v_contract.student_id, ''Contrato vigente!'', ''Seu contrato de aulas foi assinado por todas as partes.'', ''contract_signed'');
    FOR v_admin_id IN SELECT user_id FROM public.user_roles WHERE role=''admin'' LOOP
      INSERT INTO public.notifications (user_id, title, body, kind)
      VALUES (v_admin_id, ''Contrato assinado'', ''Um contrato de aulas acaba de ficar vigente.'', ''contract_signed'');
    END LOOP;
  ELSE
    IF NEW.signer_type = ''aluno'' THEN
      FOR v_admin_id IN SELECT user_id FROM public.user_roles WHERE role=''admin'' LOOP
        INSERT INTO public.notifications (user_id, title, body, kind)
        VALUES (v_admin_id, ''Aluno assinou o contrato'', ''Aguardando sua contra-assinatura.'', ''contract_pending_admin'');
      END LOOP;
    ELSE
      INSERT INTO public.notifications (user_id, title, body, kind)
      VALUES (v_contract.student_id, ''Contrato pronto para assinar'', ''O admin assinou - falta seu aceite.'', ''contract_pending_student'');
    END IF;
  END IF;

  RETURN NEW;
END ';
CREATE TRIGGER trg_process_signature AFTER INSERT ON public.contract_signatures FOR EACH ROW EXECUTE FUNCTION public.process_contract_signature();

CREATE TABLE public.contract_negotiations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.class_contracts(id) ON DELETE CASCADE,
  proposed_by public.contract_signer NOT NULL,
  proposer_id uuid NOT NULL REFERENCES auth.users(id),
  price_cents int NOT NULL CHECK (price_cents >= 0),
  note text,
  outcome text CHECK (outcome IN ('pendente','aceito','recusado','contra')) DEFAULT 'pendente',
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.contract_negotiations TO authenticated;
GRANT ALL ON public.contract_negotiations TO service_role;
ALTER TABLE public.contract_negotiations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "neg read participant" ON public.contract_negotiations FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR
  EXISTS (SELECT 1 FROM public.class_contracts c WHERE c.id = contract_id AND c.student_id = auth.uid())
);
CREATE POLICY "neg insert participant" ON public.contract_negotiations FOR INSERT TO authenticated WITH CHECK (
  proposer_id = auth.uid() AND (
    (proposed_by='admin' AND public.has_role(auth.uid(),'admin'))
    OR (proposed_by='aluno' AND EXISTS (SELECT 1 FROM public.class_contracts c WHERE c.id = contract_id AND c.student_id = auth.uid()))
  )
);
CREATE POLICY "neg update admin" ON public.contract_negotiations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.class_contracts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.contract_signatures;
ALTER PUBLICATION supabase_realtime ADD TABLE public.contract_negotiations;
