DROP POLICY IF EXISTS "contract_settings read auth" ON public.contract_settings;

CREATE POLICY "contract_settings admin read"
ON public.contract_settings
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));