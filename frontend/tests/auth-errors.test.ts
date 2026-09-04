import assert from "node:assert/strict";
import test from "node:test";

import { friendlyAuthError } from "../src/lib/auth-errors.ts";

test("maps known authentication failures to friendly Portuguese messages", () => {
  assert.equal(
    friendlyAuthError({ code: "invalid_credentials" }, "signin"),
    "E-mail ou senha incorretos.",
  );
  assert.equal(
    friendlyAuthError({ message: "Email not confirmed" }, "signin"),
    "Confirme seu e-mail antes de entrar.",
  );
  assert.equal(
    friendlyAuthError({ code: "weak_password" }, "signup"),
    "A senha precisa ter pelo menos 6 caracteres.",
  );
});

test("does not expose unknown backend error details", () => {
  const message = friendlyAuthError(
    { message: "internal database connection secret diagnostic" },
    "signup",
  );
  assert.equal(message, "Não foi possível criar sua conta agora. Tente novamente.");
  assert.doesNotMatch(message, /database|secret/i);
});

test("password updates also hide provider diagnostics", () => {
  const message = friendlyAuthError(
    { message: "internal auth provider diagnostic" },
    "passwordUpdate",
  );
  assert.equal(
    message,
    "Não foi possível atualizar a senha agora. Solicite um novo link e tente novamente.",
  );
  assert.doesNotMatch(message, /provider|diagnostic/i);
});
