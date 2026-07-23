DROP POLICY IF EXISTS "Anyone authenticated can view operators" ON public.card_operators;

CREATE POLICY "Admins can view operators"
ON public.card_operators
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));