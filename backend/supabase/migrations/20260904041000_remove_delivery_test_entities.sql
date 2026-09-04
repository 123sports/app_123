-- Remove only the temporary entities created during the final acceptance tests.
DELETE FROM public.class_plan_change_history
WHERE class_plan_id = '45e9ca8c-b4a5-4ee9-8cd1-a7fb1711ae6d'::uuid;

DELETE FROM public.class_plans
WHERE id = '45e9ca8c-b4a5-4ee9-8cd1-a7fb1711ae6d'::uuid
  AND title = 'Plano teste'
  AND price_cents = 100;

DELETE FROM auth.users
WHERE (id = '83ed32fc-ba79-465f-b1fb-dd6b9db23c7b'::uuid
       AND email = 'pedromottanunes@fulljob.com.br')
   OR (id = 'c561e339-3fa5-4a4f-938f-8b94c5f4151d'::uuid
       AND email = 'franciteixeira@gmail.com');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = '97b3f9ce-0442-44a4-bf21-45278e1bddb5'::uuid
      AND email = 'contato123sports@gmail.com'
  ) THEN
    RAISE EXCEPTION 'Delivery admin account is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = 'd65ad13e-5e9e-484b-94c7-07f021b9125b'::uuid
      AND email = 'bruno@bruno.com.br'
  ) THEN
    RAISE EXCEPTION 'Delivery student account is missing';
  END IF;
END;
$$;
