import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { destinationForRoles } from "../src/lib/auth-routing.ts";

const authRouteSource = readFileSync(new URL("../src/routes/auth.tsx", import.meta.url), "utf8");

test("the public login does not expose an audience selector", () => {
  assert.doesNotMatch(authRouteSource, /Professor \/ Admin|Sou aluno/);
  assert.match(authRouteSource, /destinationForRoles/);
});

test("students and users without a role enter the student area", () => {
  assert.equal(destinationForRoles([{ role: "aluno" }]), "/app");
  assert.equal(destinationForRoles([]), "/app");
});

test("administrators and professors enter the administrative area", () => {
  assert.equal(destinationForRoles([{ role: "admin" }]), "/admin");
  assert.equal(destinationForRoles([{ role: "professor" }]), "/admin");
});
