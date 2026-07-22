export const MOMOS_ROLES = Object.freeze([
  "Administrador",
  "Cajero",
  "Coordinador de pedidos",
  "Cocina",
  "Empaque",
  "Logística",
  "Marketing/CRM",
  "Mensajero",
]);

const VALID_ROLES = new Set(MOMOS_ROLES);

export function normalizeRoles(value) {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [...(Array.isArray(value.roles) ? value.roles : []), value.rol]
      : [value];
  return [...new Set(source
    .map((role) => String(role || "").trim())
    .filter((role) => VALID_ROLES.has(role)))];
}

export function hasRole(value, role) {
  return normalizeRoles(value).includes(String(role || "").trim());
}

export function hasAnyRole(value, allowedRoles) {
  const allowed = allowedRoles instanceof Set ? allowedRoles : new Set(allowedRoles || []);
  return normalizeRoles(value).some((role) => allowed.has(role));
}

export function primaryRole(value) {
  if (value && typeof value === "object" && VALID_ROLES.has(String(value.rol || "").trim())) return String(value.rol).trim();
  return normalizeRoles(value)[0] || "";
}

export function rolesLabel(value) {
  return normalizeRoles(value).join(" + ") || "Sin rol";
}
