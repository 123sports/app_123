
CREATE POLICY "Auth view marketplace images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'marketplace');

CREATE POLICY "Admins upload marketplace images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'marketplace' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update marketplace images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'marketplace' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete marketplace images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'marketplace' AND has_role(auth.uid(), 'admin'::app_role));
