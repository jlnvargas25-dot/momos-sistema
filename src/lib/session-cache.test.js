import assert from "node:assert/strict";
import test from "node:test";

import { legacyCacheKeys, sessionCacheKey, sessionCacheStorage } from "./session-cache.js";

test("la cache exige usuario y produce una clave aislada de sesion", () => {
  assert.equal(sessionCacheKey("momos-db-v2", ""), null);
  assert.equal(sessionCacheKey("momos-db-v2", "auth-123"), "momos-db-v2:session:auth-123");
});

test("la limpieza reconoce las antiguas claves persistentes", () => {
  assert.deepEqual(legacyCacheKeys("momos-db-v2", "auth-123"), ["momos-db-v2", "momos-db-v2:auth-123"]);
});

test("sin sessionStorage no existe fallback persistente", async () => {
  assert.equal(await sessionCacheStorage.get("momos-db-v2:session:auth-123"), null);
  assert.equal(await sessionCacheStorage.set("momos-db-v2:session:auth-123", "{}"), false);
  assert.equal(await sessionCacheStorage.delete("momos-db-v2:session:auth-123"), true);
});
