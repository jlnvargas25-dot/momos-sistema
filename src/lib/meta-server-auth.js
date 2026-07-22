import { createHmac } from "node:crypto";

export function createMetaAppSecretProof(accessToken, appSecret) {
  const token = String(accessToken || "").trim();
  const secret = String(appSecret || "").trim();
  if (!token || !secret) throw new Error("Faltan credenciales privadas para appsecret_proof.");
  return createHmac("sha256", secret).update(token).digest("hex");
}
