import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const raw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }),
);

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !publishableKey || !secretKey) {
  throw new Error("Missing Supabase test configuration.");
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const student = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = `signup-audit-${Date.now()}@example.invalid`;
const password = `Audit-${crypto.randomBytes(18).toString("base64url")}`;
let userId = null;
let incompleteUserId = null;
let namelessUserId = null;
let invitedEmailUserId = null;
let tokenInviteUserId = null;
let inviteId = null;
let tokenInviteId = null;

try {
  const { data: incompleteUser, error: incompleteUserError } = await admin.auth.admin.createUser({
    email: `signup-incomplete-${Date.now()}@example.invalid`,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: "Cadastro Incompleto",
      role: "admin",
    },
  });
  incompleteUserId = incompleteUser.user?.id ?? null;
  assert.ok(incompleteUserError, "database must reject a student signup without WhatsApp");

  const { data: namelessUser, error: namelessUserError } = await admin.auth.admin.createUser({
    email: `signup-nameless-${Date.now()}@example.invalid`,
    password,
    email_confirm: true,
    user_metadata: {
      phone: "(51) 99999-0000",
      role: "admin",
    },
  });
  namelessUserId = namelessUser.user?.id ?? null;
  assert.ok(namelessUserError, "database must reject a student signup without an explicit name");

  const { data: adminRole, error: adminRoleError } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .single();
  if (adminRoleError) throw adminRoleError;

  const invitedEmail = `signup-invited-email-${Date.now()}@example.invalid`;
  const { data: emailInvite, error: emailInviteError } = await admin
    .from("staff_invites")
    .insert({ email: invitedEmail, role: "professor", invited_by: adminRole.user_id })
    .select("id")
    .single();
  if (emailInviteError) throw emailInviteError;
  inviteId = emailInvite.id;

  const { data: invitedEmailUser, error: invitedEmailUserError } =
    await admin.auth.admin.createUser({
      email: invitedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: "Cadastro Sem Token",
        phone: "(51) 99999-0001",
        role: "admin",
      },
    });
  if (invitedEmailUserError || !invitedEmailUser.user) {
    throw invitedEmailUserError ?? new Error("invited-email user was not created");
  }
  invitedEmailUserId = invitedEmailUser.user.id;

  const [{ data: invitedEmailRoles }, { data: untouchedInvite }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", invitedEmailUserId),
    admin.from("staff_invites").select("status").eq("id", inviteId).single(),
  ]);
  assert.deepEqual(
    invitedEmailRoles.map((entry) => entry.role),
    ["aluno"],
    "knowing an invited email must not grant a staff role",
  );
  assert.equal(untouchedInvite.status, "pendente", "an invite without its token must stay pending");

  const tokenInviteEmail = `signup-invite-token-${Date.now()}@example.invalid`;
  const { data: tokenInvite, error: tokenInviteError } = await admin
    .from("staff_invites")
    .insert({ email: tokenInviteEmail, role: "professor", invited_by: adminRole.user_id })
    .select("id, token")
    .single();
  if (tokenInviteError) throw tokenInviteError;
  tokenInviteId = tokenInvite.id;

  const { data: tokenInviteUser, error: tokenInviteUserError } =
    await admin.auth.admin.createUser({
      email: tokenInviteEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: "Cadastro Com Token",
        phone: "(51) 99999-0002",
        staff_invite_token: tokenInvite.token,
      },
    });
  if (tokenInviteUserError || !tokenInviteUser.user) {
    throw tokenInviteUserError ?? new Error("token-invite user was not created");
  }
  tokenInviteUserId = tokenInviteUser.user.id;

  const [{ data: tokenInviteRoles }, { data: acceptedInvite }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", tokenInviteUserId),
    admin.from("staff_invites").select("status").eq("id", tokenInviteId).single(),
  ]);
  assert.deepEqual(tokenInviteRoles.map((entry) => entry.role), ["professor"]);
  assert.equal(acceptedInvite.status, "aceito");

  const { data: created, error: createError } = await student.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: "  Aluna   Cadastro  ",
        phone: "(51) 99999-0000",
        role: "admin",
      },
    },
  });
  if (createError) throw createError;
  assert.ok(created.session, "public signup must grant a session without e-mail confirmation");
  userId = created.user.id;

  const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] =
    await Promise.all([
      admin.from("profiles").select("full_name, phone").eq("id", userId).single(),
      admin.from("user_roles").select("role").eq("user_id", userId),
    ]);
  if (profileError) throw profileError;
  if (rolesError) throw rolesError;
  assert.equal(profile.full_name, "Aluna Cadastro");
  assert.equal(profile.phone, "+5551999990000");
  assert.deepEqual(
    roles.map((entry) => entry.role),
    ["aluno"],
  );

  const { error: malformedPhoneError } = await admin
    .from("profiles")
    .update({ phone: "9999" })
    .eq("id", userId);
  assert.ok(malformedPhoneError, "database must reject malformed phone updates");

  const { error: missingNameError } = await admin
    .from("profiles")
    .update({ full_name: " " })
    .eq("id", userId);
  assert.ok(missingNameError, "database must reject an empty student name");

  const { data: visibleProfiles, error: visibleProfilesError } = await student
    .from("profiles")
    .select("id");
  if (visibleProfilesError) throw visibleProfilesError;
  assert.deepEqual(
    visibleProfiles.map((entry) => entry.id),
    [userId],
  );

  const { error: escalationError } = await student
    .from("user_roles")
    .insert({ user_id: userId, role: "admin" });
  assert.ok(escalationError, "student must not be able to assign an admin role");

  console.log(
    "PASS: public signup assigns aluno and staff promotion requires the matching invite token.",
  );
} finally {
  await student.auth.signOut();
  if (incompleteUserId) {
    const { error } = await admin.auth.admin.deleteUser(incompleteUserId);
    if (error) throw error;
  }
  if (namelessUserId) {
    const { error } = await admin.auth.admin.deleteUser(namelessUserId);
    if (error) throw error;
  }
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
  }
  if (invitedEmailUserId) {
    const { error } = await admin.auth.admin.deleteUser(invitedEmailUserId);
    if (error) throw error;
  }
  if (tokenInviteUserId) {
    const { error } = await admin.auth.admin.deleteUser(tokenInviteUserId);
    if (error) throw error;
  }
  if (inviteId) {
    const { error } = await admin.from("staff_invites").delete().eq("id", inviteId);
    if (error) throw error;
  }
  if (tokenInviteId) {
    const { error } = await admin.from("staff_invites").delete().eq("id", tokenInviteId);
    if (error) throw error;
  }
}
