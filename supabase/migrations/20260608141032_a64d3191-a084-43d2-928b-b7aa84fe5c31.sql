
-- 1. Remove broad professor SELECT on profiles
DROP POLICY IF EXISTS "Professors view all profiles" ON public.profiles;

-- 2. Controlled lookup for professors with admin-configurable field visibility
CREATE OR REPLACE FUNCTION public.get_student_for_professor(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := public.has_role(v_caller, 'admin');
  v_is_prof boolean := public.has_role(v_caller, 'professor');
  v_row public.profiles%ROWTYPE;
  v_result jsonb;
  v_settings jsonb;
BEGIN
  IF NOT (v_is_admin OR v_is_prof) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  SELECT * INTO v_row FROM public.profiles WHERE id = _student_id;
  IF v_row.id IS NULL THEN RETURN NULL; END IF;

  -- Always-visible base info
  v_result := jsonb_build_object(
    'id', v_row.id,
    'full_name', v_row.full_name,
    'avatar_url', v_row.avatar_url,
    'skill_level', v_row.skill_level,
    'bio', v_row.bio,
    'dominant_hand', v_row.dominant_hand,
    'years_playing', v_row.years_playing
  );

  -- Admins always get everything
  IF v_is_admin THEN
    RETURN v_result
      || jsonb_build_object(
        'phone', v_row.phone,
        'birth_date', v_row.birth_date,
        'blood_type', v_row.blood_type,
        'address', v_row.address,
        'emergency_contact_name', v_row.emergency_contact_name,
        'emergency_contact_phone', v_row.emergency_contact_phone,
        'medical_notes', v_row.medical_notes
      );
  END IF;

  -- Professors: gated by admin settings
  SELECT jsonb_object_agg(key, value) INTO v_settings
  FROM public.site_settings
  WHERE key LIKE 'prof_visible_%';

  IF (v_settings->>'prof_visible_phone')::text = 'true' THEN
    v_result := v_result || jsonb_build_object('phone', v_row.phone);
  END IF;
  IF (v_settings->>'prof_visible_birth_date')::text = 'true' THEN
    v_result := v_result || jsonb_build_object('birth_date', v_row.birth_date);
  END IF;
  IF (v_settings->>'prof_visible_blood_type')::text = 'true' THEN
    v_result := v_result || jsonb_build_object('blood_type', v_row.blood_type);
  END IF;
  IF (v_settings->>'prof_visible_address')::text = 'true' THEN
    v_result := v_result || jsonb_build_object('address', v_row.address);
  END IF;
  IF (v_settings->>'prof_visible_emergency_contact_name')::text = 'true' THEN
    v_result := v_result || jsonb_build_object('emergency_contact_name', v_row.emergency_contact_name);
  END IF;
  IF (v_settings->>'prof_visible_emergency_contact_phone')::text = 'true' THEN
    v_result := v_result || jsonb_build_object('emergency_contact_phone', v_row.emergency_contact_phone);
  END IF;
  IF (v_settings->>'prof_visible_medical_notes')::text = 'true' THEN
    v_result := v_result || jsonb_build_object('medical_notes', v_row.medical_notes);
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_student_for_professor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_for_professor(uuid) TO authenticated;
