const BRAZIL_COUNTRY_CODE = "55";

export function brazilPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith(BRAZIL_COUNTRY_CODE)) {
    return digits.slice(BRAZIL_COUNTRY_CODE.length);
  }
  return digits.slice(0, 11);
}

export function normalizeBrazilPhone(value: string): string | null {
  const national = brazilPhoneDigits(value);
  if (!/^[1-9][0-9]{9,10}$/.test(national)) return null;
  return `+${BRAZIL_COUNTRY_CODE}${national}`;
}

export function formatBrazilPhone(value: string): string {
  const digits = brazilPhoneDigits(value);
  if (!digits) return "";

  const areaCode = digits.slice(0, 2);
  const subscriber = digits.slice(2);
  if (digits.length <= 2) return `(${areaCode}`;

  const firstPartLength = subscriber.length > 8 ? 5 : 4;
  const firstPart = subscriber.slice(0, firstPartLength);
  const secondPart = subscriber.slice(firstPartLength, firstPartLength + 4);
  return `(${areaCode}) ${firstPart}${secondPart ? `-${secondPart}` : ""}`;
}

export function whatsappUrl(value: string): string | null {
  const normalized = normalizeBrazilPhone(value);
  return normalized ? `https://wa.me/${normalized.slice(1)}` : null;
}

export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidPersonName(value: string): boolean {
  const normalized = normalizePersonName(value);
  return normalized.length >= 2 && normalized.length <= 100;
}
