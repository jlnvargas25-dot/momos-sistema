import test from "node:test";
import assert from "node:assert/strict";
import { hasAnyRole, hasRole, normalizeRoles, primaryRole, rolesLabel } from "./user-roles.js";

test("normaliza roles únicos sin aceptar valores inventados", () => {
  assert.deepEqual(normalizeRoles({ rol: "Cocina", roles: ["Cocina", "Empaque", "Empaque", "Dueño"] }), ["Cocina", "Empaque"]);
  assert.deepEqual(normalizeRoles("Cocina"), ["Cocina"]);
  assert.deepEqual(normalizeRoles(null), []);
});

test("acumula permisos y conserva el rol principal", () => {
  const profile = { rol: "Cocina", roles: ["Cocina", "Empaque"] };
  assert.equal(hasRole(profile, "Cocina"), true);
  assert.equal(hasRole(profile, "Empaque"), true);
  assert.equal(hasAnyRole(profile, ["Logística", "Empaque"]), true);
  assert.equal(hasAnyRole(profile, ["Cajero"]), false);
  assert.equal(primaryRole(profile), "Cocina");
  assert.equal(rolesLabel(profile), "Cocina + Empaque");
});
