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
    "PASS: public signup grants immediate access, normalizes contact, assigns aluno and blocks escalation.",
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
}
