import assert from "node:assert/strict";
import test from "node:test";

import { compareOperationalDatesDesc, parseOperationalTimestamp } from "./operational-time.js";

test("normaliza hora local de Bogota e ISO solo para comparar", () => {
  assert.equal(
    parseOperationalTimestamp("2026-07-19 03:00"),
    parseOperationalTimestamp("2026-07-19T08:00:00.000Z"),
  );
  assert.equal(compareOperationalDatesDesc(
    "2026-07-19 23:00",
    "2026-07-19T08:00:00.000Z",
  ) < 0, true, "23:00 Bogota debe ser mas reciente que 08:00 UTC");
  assert.equal(parseOperationalTimestamp("fecha-invalida"), null);
});
