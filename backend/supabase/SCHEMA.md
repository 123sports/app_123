# Supabase structure

## Account hierarchy

- Supabase organization: owned by the company; contains developers, billing,
  development projects and production projects.
- Supabase project: one isolated database and Auth/Storage environment.
- Application users: records in `auth.users`, not members of the Supabase
  organization.

Recommended projects:

- `123sports-dev`: remote database used for local development and tests.
- `123sports-prod`: production database created before launch.

## Application role hierarchy

`public.user_roles` assigns one or more roles to an authenticated user:

- `admin`: full operational and financial administration.
- `professor`: teaching workflows and students linked by bookings.
- `aluno`: student profile, bookings, contracts and payments.

New public signups receive `aluno`. Professor and admin accounts are created
through `public.staff_invites`. The first admin is promoted once through a
server-side bootstrap operation after Auth creates the account.

Staff invite links use `/convite-equipe/<token>`. Referral links use
`/convite/<code>`; these are separate authorization flows.

## Main relationships

```text
auth.users
  -> public.profiles
  -> public.user_roles

profiles (aluno)
  -> bookings
  -> class_contracts
  -> checkout_orders
  -> payment_attempts
  -> student_evaluations

profiles (professor)
  -> bookings.professor_id
  -> professor_feedback
  -> blocked_slots
  -> coach_profiles
```

Authorization is enforced with PostgreSQL Row Level Security. UI navigation is
not considered a security boundary.

Professors can only access students linked to their own bookings. Financial
data and role management remain exclusive to administrators. The final
administrator cannot remove their own role.

## Storage

- `avatars`: private; files use `<user_id>/<filename>`.
- `marketplace`: private; authenticated users read and admins manage.
- `coach-cvs`: private; validated public applications upload and admins read.

Storage folders organize object paths only. They do not represent user roles or
grant authorization by themselves.

## Development data

`seeds/demo.sql` contains optional synthetic data. It is intentionally outside
`migrations/` and must never be applied to staging or production.

## Local preview

- `npm run preview:local`: isolated mock data, no external credentials.
- `npm run preview:supabase`: local server connected to the Supabase values in
  the ignored `frontend/.env.local`.
