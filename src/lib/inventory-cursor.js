/**
 * Cursor global H70. Es un token decimal opaco: solo se ordena contra otro
 * cursor del mismo contrato de paginacion. Nunca se compara con event_id ni
 * source_version de un delta por item.
 */
export function normalizeInventoryCursorToken(value) {
  const raw = typeof value === "bigint"
    ? value.toString()
    : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return "";
  return raw.replace(/^0+(?=\d)/, "");
}

export function compareInventoryCursorTokens(left, right) {
  const a = normalizeInventoryCursorToken(left);
  const b = normalizeInventoryCursorToken(right);
  if (!a || !b) return null;
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a === b ? 0 : a > b ? 1 : -1;
}
