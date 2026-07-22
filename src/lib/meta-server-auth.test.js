import test from "node:test";
import assert from "node:assert/strict";
import { createMetaAppSecretProof } from "./meta-server-auth.js";

test("appsecret_proof es HMAC-SHA256 determinístico y no revela credenciales", () => {
  const proof = createMetaAppSecretProof("token-private", "secret-private-value");
  assert.equal(proof, "a00349b5440f5f68c8b7ef2737bea4379e8fb0f8f54f6a2304c0a59f7eab858c");
  assert.match(proof, /^[0-9a-f]{64}$/);
  assert.equal(proof.includes("token") || proof.includes("secret"), false);
});
