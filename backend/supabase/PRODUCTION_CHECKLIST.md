# Production checklist

## Supabase

- Apply every migration with `supabase db push` after reviewing `--dry-run`.
- Keep `seeds/demo.sql` out of production.
- Set the Auth Site URL to `https://app-123-fx8f.onrender.com`.
- Add `https://app-123-fx8f.onrender.com/**`,
  `https://app-123-fx8f.onrender.com/redefinir-senha` and approved localhost
  preview URLs to Auth redirect URLs.
- Configure a company SMTP provider and verify delivery because mandatory
  e-mail confirmation is enabled.
- Configure the Google provider in Supabase Auth before exposing the Google
  login button in production. Add the Supabase callback URL shown by the
  provider setup to the Google OAuth client, then set
  `VITE_ENABLE_GOOGLE_AUTH=true` in Render.
- Disable public staff signup; staff accounts are invite-only.
- Create the first administrator with `backend/scripts/bootstrap-admin.ps1`.
- Test one account for each role: admin, professor and aluno.
- Confirm that all tables in the Security Advisor have RLS enabled.

## Render

- `VITE_ENABLE_LOCAL_MODE=false`
- Configure browser-safe Supabase values with the `VITE_` prefix.
- Configure server Supabase values without the `VITE_` prefix.
- Keep `SUPABASE_SECRET_KEY` server-only.
- Set `APP_BASE_URL=https://app-123-fx8f.onrender.com`.
- Set `MERCADO_PAGO_ACCESS_TOKEN` and `MERCADO_PAGO_WEBHOOK_SECRET`.
- Verify `/auth` and `/api/webhooks/mercadopago` after deployment.

## Mercado Pago

- The Mercado Pago application must belong to the contractor/company account.
- Register a Pix key in that Mercado Pago account.
- Start with test credentials and test users.
- Register the test and production webhook URLs.
- Use `https://app-123-fx8f.onrender.com/api/webhooks/mercadopago` in production.
- Enable the payment event and copy its secret signature to Render.
- Activate production credentials only after end-to-end homologation.
- Run a low-value real Pix and confirm the booking plus in-app notification.
- Check that retries do not create duplicate orders or payments.

## Product decision before package payments

- Define whether `class_plans.price_cents` is the monthly amount or the total
  contract amount.
- Define whether packages use one Pix payment, manually generated monthly Pix
  charges or a recurring billing product.
- Do not activate package checkout until that rule is represented in the
  contract, database and payment reconciliation.

## Delivery

- Remove or expire temporary test accounts.
- Force strong unique passwords for staff.
- Enable MFA on Supabase, Render, GitHub and Mercado Pago owner accounts.
- Record who owns each account and recovery method.
- Export a database backup before the production handoff.
