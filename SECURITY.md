# Security baseline

## Local development

- Start the local preview with `cd frontend && npm run preview:local`.
- `VITE_ENABLE_LOCAL_MODE=true` is set only by the local preview script.
- Never configure `VITE_ENABLE_LOCAL_MODE=true` in Render, GitHub Actions, or another deployment.
- Local authentication and Pix data are browser mocks. They are not real credentials or payments.

## Production requirements

- Configure all Supabase variables from the deployment secret manager.
- Keep `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) server-only.
  Never create a `VITE_` version of either key.
- Apply every migration in `backend/supabase/migrations`, including
  `20260730150000_security_hardening.sql`, before deploying the matching frontend.
- Use HTTPS. The application sends HSTS only for HTTPS requests.
- Use separate Supabase and payment-provider projects for development and production.
- Rotate any credential that is ever committed, printed in logs, or shared outside the secret manager.

## Payment release gate

The local Pix simulator must not be enabled for real charges. A production payment release requires:

- a server-only Mercado Pago adapter;
- webhook signature verification and event idempotency;
- amount and product lookup from the database, never from browser input;
- automated expiration, cancellation, refund, and reconciliation jobs;
- provider sandbox tests followed by a low-value production smoke test;
- monitoring and alerts for failed or disputed events.

## Operational controls

- Add provider or edge rate limiting and bot protection to public lead, referral, and coach application flows.
- Restrict production CORS and CSP endpoints to the final Supabase and payment hosts.
- Enable Supabase database backups, point-in-time recovery where available, and audit-log retention.
- Review administrator roles regularly and remove access immediately when no longer required.
- Treat browser user-agent data as informational. Legal-grade contract evidence requires a server-side signing endpoint, trusted timestamping, and legal review.

## Verification

Run before each release:

```powershell
cd frontend
npm ci
npm audit --audit-level=low
npm run lint
npm run build
```

The repository contains no production secret values. `.env` files are ignored; `.env.example`
contains names only.
