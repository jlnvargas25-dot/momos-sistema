const BOGOTA_OFFSET = "-05:00";

/**
 * Convierte los dos formatos operativos que hoy conviven en React a un mismo
 * instante. Los snapshots usan hora local de Bogota (`YYYY-MM-DD HH:mm`) y los
 * deltas conservan ISO con zona. El texto original nunca se modifica: esta
 * funcion existe exclusivamente para comparar y ordenar.
 */
export function parseOperationalTimestamp(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    normalized = `${raw}T00:00:00${BOGOTA_OFFSET}`;
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)) {
    normalized = raw.replace(" ", "T");
    if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(normalized)) {
      normalized += BOGOTA_OFFSET;
    }
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function compareOperationalDatesDesc(left, right) {
  const leftAt = parseOperationalTimestamp(left);
  const rightAt = parseOperationalTimestamp(right);
  const safeLeft = leftAt ?? Number.NEGATIVE_INFINITY;
  const safeRight = rightAt ?? Number.NEGATIVE_INFINITY;
  return safeRight - safeLeft;
}
