import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APPROVED_VARIANT_MEDIA,
  approvedMediaForProduct,
} from "../../apps/shop/src/lib/catalog-media.js";

const PUBLIC_TOBY_PATH = fileURLToPath(
  new URL("../../apps/shop/public/catalog/pr01/toby-front.webp", import.meta.url),
);

test("Pide publishes Toby as an approved PR01 variant, not as a private original", async () => {
  const [toby] = APPROVED_VARIANT_MEDIA;
  assert.equal(APPROVED_VARIANT_MEDIA.length, 1);
  assert.equal(toby.productId, "PR01");
  assert.equal(toby.figure, "Toby");
  assert.equal(toby.sourceAssetId, 125);
  assert.equal(toby.role, "variant_thumbnail");
  assert.equal(toby.url, "/catalog/pr01/toby-front.webp");
  assert.doesNotMatch(toby.url, /^https?:|output\/|imagegen/i);

  const media = approvedMediaForProduct("PR01", [
    { figura: "Lizi", product_id: "PR01" },
    { figura: "Toby", product_id: "PR01" },
  ]);
  assert.deepEqual(media, [toby]);
  assert.deepEqual(approvedMediaForProduct("PR02", []), []);

  const derivative = await readFile(PUBLIC_TOBY_PATH);
  assert.equal(derivative.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(derivative.subarray(8, 12).toString("ascii"), "WEBP");
  assert.ok(derivative.byteLength < 100_000, "public derivative must stay lightweight");
  assert.equal(
    createHash("sha256").update(derivative).digest("hex"),
    toby.derivativeSha256,
  );
});
