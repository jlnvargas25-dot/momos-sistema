import test from "node:test";
import assert from "node:assert/strict";
import { brandIdentitySummary, buildBrandIdentityView } from "./brand-identity.js";

const fallback = {
  version: 4,
  fingerprint: "a".repeat(32),
  profile: {
    identity: { brand_name: "MOMOS", business_name: "D'Momos Sweet Love", positioning: "Postres con personajes", personality: ["Tierna", "Premium", "Cercana"] },
    verbal: { tone: ["Tierno", "Premium"], approved_phrases: ["Adopta tu Momo"], allowed_words: ["antojo"], banned_words: ["barato"] },
    visual: { palette: ["#FAF4EC", "#FFFFFF", "#54382B", "#8A6C5B", "#E5714E", "#F3D7DC", "#F7ECD9"], typography: { display: "Fraunces", body: "Nunito Sans" }, style: ["Luz cálida natural"] },
  },
};

test("mantiene una identidad útil antes de aplicar H55", () => {
  const view = buildBrandIdentityView(null, fallback);
  assert.equal(view.serverAvailable, false);
  assert.equal(view.version, 4);
  assert.equal(view.colors.length, 7);
  assert.deepEqual(view.typography, { display: "Fraunces", body: "Nunito Sans" });
  assert.equal(view.logos.length, 0);
});

test("normaliza el kit oficial sin rutas privadas", () => {
  const view = buildBrandIdentityView({
    available: true, ready: true, enforcement_enabled: true,
    kit: { version: 2, fingerprint: "b".repeat(32) },
    profile: { profile: fallback.profile },
    colors: [{ token: "primary", label: "Coral", color_hex: "#E5714E", contrast_hex: "#FFFFFF", usage: "Acciones" }],
    assets: [{ role: "principal", asset: { id: 9, name: "Logo oficial", mime_type: "image/png", signed_url: "signed://logo" } }],
    errors: [],
  }, fallback);
  assert.equal(view.ready, true);
  assert.equal(view.version, 2);
  assert.equal(view.logos[0].signedUrl, "signed://logo");
  assert.equal(JSON.stringify(view).includes("storage_path"), false);
  assert.deepEqual(brandIdentitySummary(view), { officialLogos: 1, colors: 1, rules: 3, needsAttention: false });
});
