
CREATE POLICY "anyone upload cv" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'coach-cvs');

CREATE POLICY "admins read cv" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'coach-cvs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete cv" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'coach-cvs' AND public.has_role(auth.uid(), 'admin'));
