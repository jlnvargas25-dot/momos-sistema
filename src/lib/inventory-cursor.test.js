import assert from "node:assert/strict";
import test from "node:test";

import {
  compareInventoryCursorTokens,
  normalizeInventoryCursorToken,
} from "./inventory-cursor.js";

test("el cursor H70 conserva enteros bigint como tokens decimales opacos", () => {
  assert.equal(normalizeInventoryCursorToken("4611686018427388027"), "4611686018427388027",
    "el tag numerico 2^62 + safe_xmin no debe pasar por Number");
  assert.equal(normalizeInventoryCursorToken("9007199254740993123"), "9007199254740993123");
  assert.equal(normalizeInventoryCursorToken(123n), "123");
  assert.equal(normalizeInventoryCursorToken("00042"), "42");
  assert.equal(normalizeInventoryCursorToken("0"), "0");
  for (const invalid of ["", "-1", "1.5", "xid:42", 42, 4611686018427388000, null, undefined]) {
    assert.equal(normalizeInventoryCursorToken(invalid), "");
  }
});

test("los cursores solo se ordenan dentro de su propio contrato sin perder precision", () => {
  assert.equal(compareInventoryCursorTokens(
    "9007199254740993124",
    "9007199254740993123",
  ), 1);
  assert.equal(compareInventoryCursorTokens("99", "100"), -1);
  assert.equal(compareInventoryCursorTokens("0007", "7"), 0);
  assert.equal(compareInventoryCursorTokens("event-7", "7"), null);
});
