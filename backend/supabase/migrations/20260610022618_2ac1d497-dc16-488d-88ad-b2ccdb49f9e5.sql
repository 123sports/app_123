-- Revoke EXECUTE from public/anon on all SECURITY DEFINER functions in public schema
REVOKE EXECUTE ON FUNCTION public.cancel_open_match_on_booking() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_referral_code() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_referral_status(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_student_for_professor(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_student_level(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.grant_master_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_booking_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_booking_participant(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_master_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_open_match_creator(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_open_match_participant(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_match_draw() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_on_booking_confirm() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_on_booking_insert() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_on_coach_application() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_on_new_lead() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_on_open_match_insert() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_on_open_match_status() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_open_match_participant() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.process_contract_signature() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.process_evaluation_progress() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.protect_booking_sensitive_fields() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.protect_open_match_admin_fields() FROM PUBLIC, anon;

-- Re-grant EXECUTE to authenticated only for the functions actually used by RLS or RPC
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_booking_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_booking_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_open_match_creator(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_open_match_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_referral_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_for_professor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_level(uuid) TO authenticated;