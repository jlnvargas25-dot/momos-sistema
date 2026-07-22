import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const STAGING_REF = "mxrsmuqyesolkxoqvggl";
const PILOT_MARKER = "[H101 UI PILOT]";
const SESSION_PATH = resolve("tmp/h101-ui-pilot-session.json");
const mode = process.argv[2] || "prepare";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Falta ${name}.`);
  return value;
}

function assertStaging(url) {
  const endpoint = new URL(url);
  const ref = endpoint.hostname.split(".")[0];
  if (endpoint.protocol !== "https:" || ref !== STAGING_REF) {
    throw new Error("H101 solo puede operar contra el staging aislado sellado.");
  }
  return ref;
}

function assertPrivateSupabaseKey(key) {
  if (key.startsWith("sb_secret_")) return key;
  if (key.startsWith("sb_publishable_") || key.startsWith("anon")) {
    throw new Error("H101 requiere una service role privada; nunca una clave publicable o anon.");
  }
  try {
    const [, payload] = key.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims.role === "service_role") return key;
  } catch {
    // El error cerrado de abajo evita arrancar con una clave ambigua.
  }
  throw new Error("H101 requiere una service role privada valida.");
}

const url = required("STAGING_SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = assertPrivateSupabaseKey(required("STAGING_SUPABASE_SERVICE_ROLE_KEY"));
const projectRef = assertStaging(url);
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const roleFixtures = [
  { key: "admin", id: "U-H101-ADMIN", name: "Administracion H101", primary: "Administrador", roles: ["Administrador"] },
  { key: "reception", id: "U-H101-RECEP", name: "Recepcion H101", primary: "Cajero", roles: ["Cajero", "Coordinador de pedidos"] },
  { key: "kitchen", id: "U-H101-COCINA", name: "Cocina H101", primary: "Cocina", roles: ["Cocina"] },
  { key: "packing", id: "U-H101-EMPAQUE", name: "Empaque H101", primary: "Empaque", roles: ["Empaque"] },
  { key: "logistics", id: "U-H101-LOGISTICA", name: "Logistica H101", primary: "Log\u00edstica", roles: ["Log\u00edstica"] },
];

async function checked(promise, label) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function listAllAuthUsers() {
  const all = [];
  for (let page = 1; ; page += 1) {
    const data = await checked(supabase.auth.admin.listUsers({ page, perPage: 200 }), "listar identidades H101");
    all.push(...data.users);
    if (data.users.length < 200) return all;
  }
}

async function readSealedSession() {
  const session = JSON.parse(await readFile(SESSION_PATH, "utf8"));
  const expectedIds = new Set(roleFixtures.map((fixture) => fixture.id));
  const credentials = Object.values(session.credentials || {});
  const valid = session.contract === "momos.ui-operational-pilot.session.v1"
    && session.environment === "Staging"
    && session.projectRef === projectRef
    && session.marker === PILOT_MARKER
    && credentials.length === roleFixtures.length
    && credentials.every((entry) => expectedIds.has(entry.profileId)
      && /^h101\.(admin|reception|kitchen|packing|logistics)@momos\.test$/.test(String(entry.email || "")));
  if (!valid) throw new Error("La sesion H101 no coincide con el contrato sellado de staging.");
  return session;
}

async function prepare() {
  const admins = await checked(
    supabase.from("users").select("sede_id").eq("activo", true).contains("roles", ["Administrador"]).limit(1),
    "buscar sede de staging",
  );
  const siteId = admins?.[0]?.sede_id;
  if (!siteId) throw new Error("H101 necesita una sede con Administrador activo en staging.");

  const authUsers = await listAllAuthUsers();
  const password = `H101-${randomBytes(18).toString("base64url")}!a9`;
  const credentials = {};
  for (const fixture of roleFixtures) {
    const email = `h101.${fixture.key}@momos.test`;
    let authUser = authUsers.find((entry) => String(entry.email || "").toLowerCase() === email);
    if (authUser) {
      const data = await checked(
        supabase.auth.admin.updateUserById(authUser.id, { password, email_confirm: true, user_metadata: { h101: true } }),
        `renovar identidad ${fixture.key}`,
      );
      authUser = data.user;
    } else {
      const data = await checked(
        supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { h101: true } }),
        `crear identidad ${fixture.key}`,
      );
      authUser = data.user;
    }

    const existing = await checked(
      supabase.from("users").select("id").ilike("email", email).maybeSingle(),
      `buscar perfil ${fixture.key}`,
    );
    const profileId = existing?.id || fixture.id;
    await checked(
      supabase.from("users").upsert({
        id: profileId,
        auth_id: authUser.id,
        nombre: fixture.name,
        email,
        rol: fixture.primary,
        roles: fixture.roles,
        activo: true,
        sede_id: siteId,
      }, { onConflict: "id" }),
      `vincular perfil ${fixture.key}`,
    );
    credentials[fixture.key] = { email, password, profileId, roles: fixture.roles };
  }

  const session = {
    contract: "momos.ui-operational-pilot.session.v1",
    environment: "Staging",
    projectRef,
    marker: PILOT_MARKER,
    preparedAt: new Date().toISOString(),
    credentials,
  };
  await mkdir(resolve("tmp"), { recursive: true });
  await writeFile(SESSION_PATH, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, environment: "Staging", projectRef, roles: Object.keys(credentials), sessionPath: SESSION_PATH }));
}

async function snapshot() {
  const session = await readSealedSession();
  const [orders, users, evidences, deliveries, handoffs, packing] = await Promise.all([
    checked(supabase.from("orders").select("id,estado,comprobante,pagado_en,customer_id,obs").like("obs", `%${PILOT_MARKER}%`).order("id"), "leer pedidos H101"),
    checked(supabase.from("users").select("id,rol,roles,activo,auth_id").in("id", Object.values(session.credentials).map((entry) => entry.profileId)), "leer perfiles H101"),
    checked(supabase.from("evidences").select("id,order_id,tipo,storage_path").like("order_id", "P-%"), "leer evidencias H101"),
    checked(supabase.from("deliveries").select("id,order_id,estado,proveedor,costo_real").like("order_id", "P-%"), "leer domicilios H101"),
    checked(supabase.from("order_dispatch_handoffs").select("order_id,status,version").like("order_id", "P-%"), "leer relevos H101"),
    checked(supabase.from("packing_verifications").select("order_id,verified_at,line_ids").like("order_id", "P-%"), "leer verificaciones H101"),
  ]);
  const ids = new Set(orders.map((order) => order.id));
  const sanitize = (rows) => rows.filter((row) => ids.has(row.order_id));
  const result = {
    contract: "momos.ui-operational-pilot.snapshot.v1",
    environment: "Staging",
    projectRef,
    capturedAt: new Date().toISOString(),
    orders: orders.map(({ id, estado, comprobante, pagado_en }) => ({ id, estado, comprobante, paidAt: Boolean(pagado_en) })),
    profiles: users.map(({ id, rol, roles, activo, auth_id }) => ({ id, rol, roles, active: activo, linkedAuth: Boolean(auth_id) })),
    evidences: sanitize(evidences).map(({ order_id, tipo }) => ({ orderId: order_id, type: tipo })),
    deliveries: sanitize(deliveries).map(({ order_id, estado, proveedor, costo_real }) => ({ orderId: order_id, status: estado, provider: proveedor, actualCost: Number(costo_real) })),
    handoffs: sanitize(handoffs).map(({ order_id, status, version }) => ({ orderId: order_id, status, version })),
    packing: sanitize(packing).map(({ order_id, line_ids }) => ({ orderId: order_id, lineCount: line_ids.length })),
    privacy: { containsCustomerPii: false, containsSecrets: false },
  };
  console.log(JSON.stringify(result, null, 2));
}

async function finalize() {
  const session = await readSealedSession();
  const profiles = Object.values(session.credentials);
  await checked(
    supabase.from("users").update({ activo: false, auth_id: null }).in("id", profiles.map((entry) => entry.profileId)),
    "desactivar perfiles H101",
  );
  const authUsers = await listAllAuthUsers();
  const pilotEmails = new Set(profiles.map((entry) => entry.email));
  for (const authUser of authUsers.filter((entry) => pilotEmails.has(String(entry.email || "").toLowerCase()))) {
    await checked(supabase.auth.admin.deleteUser(authUser.id), "revocar identidad H101");
  }
  const remaining = await checked(
    supabase.from("users").select("id,activo,auth_id").in("id", profiles.map((entry) => entry.profileId)),
    "verificar cierre H101",
  );
  if (remaining.some((entry) => entry.activo || entry.auth_id)) {
    throw new Error("H101 no pudo revocar todos los accesos sintÃ©ticos.");
  }
  await unlink(SESSION_PATH);
  console.log(JSON.stringify({ ok: true, environment: "Staging", credentialsRevoked: true, activePilotUsers: 0 }));
}

if (mode === "prepare") await prepare();
else if (mode === "snapshot") await snapshot();
else if (mode === "finalize") await finalize();
else throw new Error(`Modo H101 desconocido: ${mode}`);
