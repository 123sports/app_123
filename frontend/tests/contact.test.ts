import assert from "node:assert/strict";
import test from "node:test";

import {
  brazilPhoneDigits,
  formatBrazilPhone,
  isValidPersonName,
  normalizeBrazilPhone,
  normalizePersonName,
  whatsappUrl,
} from "../src/lib/contact.ts";

test("normalizes Brazilian mobile and landline numbers to E.164", () => {
  assert.equal(normalizeBrazilPhone("(51) 99999-0000"), "+5551999990000");
  assert.equal(normalizeBrazilPhone("+55 51 3333-4444"), "+555133334444");
  assert.equal(brazilPhoneDigits("+55 (11) 98888-7777"), "11988887777");
});

test("rejects incomplete or malformed contact numbers", () => {
  assert.equal(normalizeBrazilPhone("9999-0000"), null);
  assert.equal(normalizeBrazilPhone("00 99999-0000"), null);
  assert.equal(normalizeBrazilPhone(""), null);
});

test("formats phone input and creates a safe WhatsApp target", () => {
  assert.equal(formatBrazilPhone("51999990000"), "(51) 99999-0000");
  assert.equal(whatsappUrl("(51) 99999-0000"), "https://wa.me/5551999990000");
  assert.equal(whatsappUrl("invalid"), null);
});

test("normalizes and validates the student name", () => {
  assert.equal(normalizePersonName("  Maria   Silva  "), "Maria Silva");
  assert.equal(isValidPersonName("Maria Silva"), true);
  assert.equal(isValidPersonName("M"), false);
  assert.equal(isValidPersonName("x".repeat(101)), false);
});
