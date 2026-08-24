-- Older payment notifications were sent to every admin, including the payer
-- when the same account was testing the student area. Keep only the student
-- confirmation in that case.

DELETE FROM public.notifications notification
USING public.checkout_orders checkout_order
WHERE notification.kind = 'payment_paid'
  AND notification.user_id = checkout_order.user_id
  AND checkout_order.status = 'paid'
  AND position(checkout_order.description IN COALESCE(notification.body, '')) > 0;
