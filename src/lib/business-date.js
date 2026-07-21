export const MOMOS_BUSINESS_TIME_ZONE = "America/Bogota";

function validDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = value === undefined || value === null || value === ""
    ? new Date()
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Fecha operativa de MOMOS. Nunca depende del UTC del navegador ni de la
 * zona horaria del computador que abre la aplicación.
 */
export function businessDateISO(value = new Date(), timeZone = MOMOS_BUSINESS_TIME_ZONE) {
  const date = validDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function momosTodayISO() {
  return businessDateISO(new Date());
}
