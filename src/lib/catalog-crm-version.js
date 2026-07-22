const BIGINT_TOKEN = /^\d+$/;

export function normalizeCatalogCrmVersion(value) {
  const token = String(value ?? "").trim();
  if (!BIGINT_TOKEN.test(token)) throw new Error("La versión incremental no es válida.");
  return token.replace(/^0+(?=\d)/, "");
}

export function compareCatalogCrmVersions(left, right) {
  const a = normalizeCatalogCrmVersion(left);
  const b = normalizeCatalogCrmVersion(right);
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a === b ? 0 : a > b ? 1 : -1;
}
