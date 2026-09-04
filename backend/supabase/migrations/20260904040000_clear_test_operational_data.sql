-- One-time delivery cleanup. Keep authentication, profiles, roles, plans,
-- pricing, settings and blocked slots while removing test transactions.
TRUNCATE TABLE
  public.booking_participants,
  public.booking_reschedules,
  public.student_credit_allocations,
  public.student_credit_ledger,
  public.bookings,
  public.student_credit_grants,
  public.payment_events,
  public.payment_attempts,
  public.checkout_order_status_history,
  public.checkout_items,
  public.checkout_orders,
  public.notifications,
  public.reservation_sessions
RESTART IDENTITY;
