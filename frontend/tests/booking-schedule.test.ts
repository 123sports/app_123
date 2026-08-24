import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingScheduleError,
  hasBookingMinimumNotice,
  isValidBookingDate,
  venueBookingStartMs,
} from "../src/lib/booking-schedule.ts";

const NOW = Date.parse("2026-08-24T12:00:00-03:00");

test("validates real calendar dates", () => {
  assert.equal(isValidBookingDate("2026-08-24"), true);
  assert.equal(isValidBookingDate("2026-02-29"), false);
  assert.equal(isValidBookingDate("2028-02-29"), true);
  assert.equal(isValidBookingDate("2026-13-01"), false);
});

test("interprets booking hours in the Sao Paulo venue timezone", () => {
  assert.equal(venueBookingStartMs("2026-08-24", 15), Date.parse("2026-08-24T15:00:00-03:00"));
});

test("requires at least two hours of notice", () => {
  assert.equal(hasBookingMinimumNotice("2026-08-24", 13, NOW), false);
  assert.equal(hasBookingMinimumNotice("2026-08-24", 14, NOW), true);
  assert.equal(
    bookingScheduleError("2026-08-24", 13, NOW),
    "Escolha um horário com no mínimo duas horas de antecedência.",
  );
});

test("limits new bookings to 31 calendar days", () => {
  assert.equal(bookingScheduleError("2026-09-24", 15, NOW), null);
  assert.equal(
    bookingScheduleError("2026-09-25", 15, NOW),
    "A data deve estar dentro dos próximos 31 dias.",
  );
});

test("rejects hours outside the operating window", () => {
  assert.equal(bookingScheduleError("2026-08-25", 5, NOW), "Data ou horário inválido.");
  assert.equal(bookingScheduleError("2026-08-25", 23, NOW), "Data ou horário inválido.");
});
