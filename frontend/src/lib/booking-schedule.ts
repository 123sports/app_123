export const BOOKING_MIN_NOTICE_HOURS = 2;
export const BOOKING_MAX_ADVANCE_DAYS = 31;

export function isValidBookingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function venueBookingStartMs(date: string, hour: number) {
  if (!isValidBookingDate(date) || !Number.isInteger(hour) || hour < 6 || hour > 22) {
    return Number.NaN;
  }
  return Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00-03:00`);
}

function venueDateKey(nowMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addUtcDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

export function hasBookingMinimumNotice(date: string, hour: number, nowMs = Date.now()) {
  const startMs = venueBookingStartMs(date, hour);
  return Number.isFinite(startMs) && startMs >= nowMs + BOOKING_MIN_NOTICE_HOURS * 60 * 60 * 1000;
}

export function bookingScheduleError(date: string, hour: number, nowMs = Date.now()) {
  if (!isValidBookingDate(date) || !Number.isInteger(hour) || hour < 6 || hour > 22) {
    return "Data ou horário inválido.";
  }
  if (!hasBookingMinimumNotice(date, hour, nowMs)) {
    return "Escolha um horário com no mínimo duas horas de antecedência.";
  }
  const maximumDate = addUtcDays(venueDateKey(nowMs), BOOKING_MAX_ADVANCE_DAYS);
  if (date > maximumDate) {
    return "A data deve estar dentro dos próximos 31 dias.";
  }
  return null;
}

export function assertBookingSchedule(date: string, hour: number, nowMs = Date.now()) {
  const error = bookingScheduleError(date, hour, nowMs);
  if (error) throw new Error(error);
}

export function isBookingScheduleAllowed(date: string, hour: number, nowMs = Date.now()) {
  return bookingScheduleError(date, hour, nowMs) === null;
}
