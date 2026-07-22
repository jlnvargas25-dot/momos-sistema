import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const notes = [];

function fail(message) { failures.push(message); }
function note(message) { notes.push(message); }
function relative(file) { return path.relative(root, file).replaceAll("\\", "/"); }

async function gitFiles(args) {
  const { stdout } = await execFile("git", ["ls-files", "-z", ...args], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 20_000_000,
  });
  return stdout.toString("utf8").split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/"));
}

function decodeJwtPayload(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); }
  catch { return null; }
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
if (packageLock.name !== packageJson.name || packageLock.version !== packageJson.version) {
  fail("package-lock.json no coincide con nombre/versión de package.json");
}
for (const script of ["ci:contracts", "ci:quality", "test", "test:performance", "build", "perf:budget"]) {
  if (!packageJson.scripts?.[script]) fail(`Falta el script obligatorio ${script}`);
}

const tracked = await gitFiles(["--cached"]);
const candidates = await gitFiles(["--cached", "--others", "--exclude-standard"]);
const forbiddenTracked = tracked.filter((file) => /(^|\/)(node_modules|dist|outputs|tmp|\.env(?:\..+)?)(\/|$)/.test(file)
  && !/(^|\/)\.env\.example$/.test(file));
if (forbiddenTracked.length) fail(`Archivos privados/generados versionados: ${forbiddenTracked.join(", ")}`);

const textExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".md", ".sql", ".toml", ".yml", ".yaml", ".css", ".html"]);
for (const file of candidates) {
  const absolute = path.join(root, file);
  let metadata;
  try { metadata = await stat(absolute); } catch { continue; }
  if (!metadata.isFile() || metadata.size > 2_000_000 || !textExtensions.has(path.extname(file).toLowerCase())) continue;
  const content = await readFile(absolute, "utf8");
  if (/^(<{7}|={7}|>{7})(?:\s|$)/m.test(content)) fail(`Marcador de conflicto sin resolver en ${file}`);
  if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(content)) fail(`Posible Supabase secret versionado en ${file}`);
  const jwtPattern = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
  for (const token of content.match(jwtPattern) || []) {
    if (decodeJwtPayload(token)?.role === "service_role") fail(`JWT service_role versionado en ${file}`);
  }
}

const orderedReadmePath = path.join(root, "supabase", "migraciones-ordenadas", "README.md");
const orderedReadme = await readFile(orderedReadmePath, "utf8");
const referencedSql = [...orderedReadme.matchAll(/`(\.\.\/(?:tests\/)?[^`]+\.sql)`/g)].map((match) => match[1]);
for (const reference of new Set(referencedSql)) {
  const target = path.resolve(path.dirname(orderedReadmePath), reference);
  try { if (!(await stat(target)).isFile()) fail(`README de migraciones referencia un archivo inexistente: ${reference}`); }
  catch { fail(`README de migraciones referencia un archivo inexistente: ${reference}`); }
}

const supabaseEntries = await readdir(path.join(root, "supabase"), { withFileTypes: true });
const migrationOwners = new Map();
for (const entry of supabaseEntries) {
  if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
  const file = path.join(root, "supabase", entry.name);
  const sql = await readFile(file, "utf8");
  const pattern = /insert\s+into\s+public\.momos_ops_migrations\s*\([^)]*\)\s*values\s*\(\s*'([^']+)'/gis;
  for (const match of sql.matchAll(pattern)) {
    const owners = migrationOwners.get(match[1]) || [];
    owners.push(relative(file));
    migrationOwners.set(match[1], owners);
  }
}
for (const [id, owners] of migrationOwners) {
  if (owners.length > 1) fail(`ID de migración duplicado ${id}: ${owners.join(", ")}`);
}
const orderedIds = [...migrationOwners.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
const latestId = orderedIds.at(-1) || "";
const acceptance = await readFile(path.join(root, "supabase", "tests", "test-migraciones-ordenadas.sql"), "utf8");
if (!latestId) fail("No se detectaron entradas en public.momos_ops_migrations");
else if (!acceptance.includes(latestId)) fail(`La aceptación ordenada no comprueba la última migración detectada: ${latestId}`);
else note(`Cadena SQL detectada hasta ${latestId}`);

const workerEntries = (await readdir(path.join(root, "scripts"), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"));
for (const worker of workerEntries) {
  try {
    await execFile(process.execPath, ["--check", path.join(root, "scripts", worker.name)], { cwd: root, maxBuffer: 2_000_000 });
  } catch {
    fail(`Sintaxis inválida en scripts/${worker.name}`);
  }
}
note(`${workerEntries.length} scripts privados pasan node --check`);

for (const required of [
  ".github/workflows/quality-gate.yml",
  ".github/workflows/staging-database-gate.yml",
  ".github/workflows/continuity-observer.yml",
  "docs/MOMOS-OPS-CONTINUIDAD-RUNBOOK.md",
]) {
  try { if (!(await stat(path.join(root, required))).isFile()) fail(`Falta ${required}`); }
  catch { fail(`Falta ${required}`); }
}

const stagingGate = await readFile(path.join(root, ".github", "workflows", "staging-database-gate.yml"), "utf8");
for (const requiredFragment of [
  "STAGING_PROJECT_REF",
  "PRODUCTION_PROJECT_REF",
  "STAGING_SUPABASE_URL",
  "STAGING_SUPABASE_SERVICE_ROLE_KEY",
  "01-110 PASS",
  "piloto-comercial-controlado-v1.sql",
  "test-piloto-comercial-controlado-v1.sql",
  "inteligencia-creativa-publicitaria-v1.sql",
  "test-inteligencia-creativa-publicitaria-v1.sql",
  "piloto-comercial-ui-v1.sql",
  "test-piloto-comercial-ui-v1.sql",
  "humanizacion-comunidad-v1.sql",
  "test-humanizacion-comunidad-v1.sql",
  "biblioteca-visual-ampliada-v1.sql",
  "test-biblioteca-visual-ampliada-v1.sql",
  "orquestacion-produccion-formulas-v1.sql",
  "test-orquestacion-produccion-formulas-v1.sql",
  "autorizacion-generacion-preflight-v1.sql",
  "test-autorizacion-generacion-preflight-v1.sql",
  "preparacion-piloto-conectores-v1.sql",
  "test-preparacion-piloto-conectores-v1.sql",
  "calidad-maestra-biblioteca-ia-v1.sql",
  "test-calidad-maestra-biblioteca-ia-v1.sql",
  "configurar_entorno_conectores_v1",
  "SELLAR_STAGING_NO_PRODUCCION",
  "test-certificacion-concurrencia-caos-v1.sql",
  "test-observabilidad-slo-v1.sql",
  "test-telemetria-operativa-alertas-v1.sql",
  "test-piloto-operativo-e2e-v1.sql",
  "MOMOS_H94_ENVIRONMENT: Staging",
  "MOMOS_H94_ALLOW_STAGING: CERTIFY_NON_PRODUCTION",
  "status='Certificado'",
  "invariant_failures=0",
]) {
  if (!stagingGate.includes(requiredFragment)) fail(`El gate de staging perdió ${requiredFragment}`);
}
if (!stagingGate.includes('test "$STAGING_PROJECT_REF" != "$PRODUCTION_PROJECT_REF"')) {
  fail("El gate de staging ya no separa staging de producción");
}
if (stagingGate.includes("secrets.SUPABASE_SERVICE_ROLE_KEY")) {
  fail("El gate de staging reutiliza el nombre de la service role de producción");
}

if (failures.length) {
  process.stderr.write(`[repo-contracts] FAIL (${failures.length})\n- ${failures.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`[repo-contracts] PASS\n- ${notes.join("\n- ")}\n`);
}
