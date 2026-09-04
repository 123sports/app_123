import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authSource = readFileSync(new URL("../src/routes/auth.tsx", import.meta.url), "utf8");
const authConfigSource = readFileSync(
  new URL("../../backend/supabase/config.toml", import.meta.url),
  "utf8",
);
const appShellSource = readFileSync(
  new URL("../src/routes/_authenticated/app.tsx", import.meta.url),
  "utf8",
);
const profileGateSource = readFileSync(
  new URL("../src/components/StudentProfileGate.tsx", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../backend/supabase/migrations/20260903050000_student_signup_contact.sql",
    import.meta.url,
  ),
  "utf8",
);
const enforcementMigrationSource = readFileSync(
  new URL(
    "../../backend/supabase/migrations/20260903060000_enforce_student_signup_contact.sql",
    import.meta.url,
  ),
  "utf8",
);
const requiredFieldsMigrationSource = readFileSync(
  new URL(
    "../../backend/supabase/migrations/20260903070000_require_public_signup_fields.sql",
    import.meta.url,
  ),
  "utf8",
);
const hardeningMigrationSource = readFileSync(
  new URL(
    "../../backend/supabase/migrations/20260904020000_payment_and_signup_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);
const staffInviteSource = readFileSync(
  new URL("../src/routes/convite-equipe.$token.tsx", import.meta.url),
  "utf8",
);

test("student signup sends only normalized contact metadata and no requested role", () => {
  assert.match(authSource, /full_name: normalizedName/);
  assert.match(authSource, /phone: normalizedPhone/);
  assert.match(authSource, /captchaToken/);
  assert.doesNotMatch(authSource, /data:\s*\{[^}]*role\s*:/s);
  assert.doesNotMatch(authSource, /Confira seu e-mail|resendConfirmation|emailRedirectTo/);
});

test("student signup uses the minimum password length supported by Supabase", () => {
  assert.match(authSource, /minLength=\{6\}/);
  assert.match(authConfigSource, /minimum_password_length = 6/);
  assert.match(authConfigSource, /password_requirements = ""/);
});

test("database onboarding defaults public registrations to student", () => {
  assert.match(migrationSource, /VALUES \(NEW\.id, 'aluno'\)/);
  assert.doesNotMatch(migrationSource, /raw_user_meta_data->>'role'/);
  assert.match(migrationSource, /normalize_brazil_phone/);
  assert.match(migrationSource, /profiles_phone_e164_check/);
});

test("database rejects incomplete student contact even when the frontend is bypassed", () => {
  assert.match(enforcementMigrationSource, /enforce_student_role_contact/);
  assert.match(enforcementMigrationSource, /enforce_student_profile_contact/);
  assert.match(enforcementMigrationSource, /normalize_profile_name/);
  assert.match(enforcementMigrationSource, /normalize_brazil_phone\(v_phone\)/);
  assert.match(requiredFieldsMigrationSource, /v_requested_name IS NULL/);
  assert.match(requiredFieldsMigrationSource, /v_phone IS NULL/);
  assert.match(requiredFieldsMigrationSource, /v_invite\.id IS NULL/);
});

test("a staff email alone cannot promote a public registration", () => {
  assert.match(hardeningMigrationSource, /staff_invite_token/);
  assert.match(hardeningMigrationSource, /invite\.token = v_invite_token/);
  assert.match(hardeningMigrationSource, /lower\(invite\.email\) = lower\(NEW\.email\)/);
  assert.match(hardeningMigrationSource, /VALUES \(NEW\.id, 'aluno'\)/);
  assert.doesNotMatch(
    hardeningMigrationSource,
    /FROM public\.staff_invites\s+WHERE lower\(email\) = lower\(NEW\.email\)/,
  );
  assert.match(staffInviteSource, /staff_invite_token: token/);
  assert.match(
    staffInviteSource,
    /rpc\("accept_staff_invite",\s*\{\s*_token: token,?\s*\}\)/,
  );
});

test("student application blocks incomplete contact profiles", () => {
  assert.match(appShellSource, /StudentProfileGate/);
  assert.match(profileGateSource, /\.from\("profiles"\)[\s\S]*\.update\(payload\)/);
  assert.doesNotMatch(profileGateSource, /\.from\("profiles"\)\.insert/);
});
