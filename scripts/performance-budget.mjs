import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const configPath = resolve(root, "performance-budget.json");
const enforce = process.argv.includes("--enforce");
const jsonOutput = process.argv.includes("--json");

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function fileMetric(path) {
  const bytes = readFileSync(path);
  return {
    file: relative(root, path).replaceAll("\\", "/"),
    rawBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes).byteLength,
  };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + row[key], 0);
}

if (!existsSync(join(dist, "index.html"))) {
  console.error("Falta dist/index.html. Ejecuta npm run build antes de medir.");
  process.exit(2);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const html = readFileSync(join(dist, "index.html"), "utf8");
const initialAssetNames = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)]
  .map((match) => match[1].replace(/^\//, ""));
const initialAssets = initialAssetNames
  .map((name) => resolve(dist, name))
  .filter(existsSync)
  .map(fileMetric);
const allAssets = walk(join(dist, "assets"))
  .filter((path) => /\.(?:js|css)$/.test(path))
  .map(fileMetric);
const initialJs = initialAssets.filter((asset) => asset.file.endsWith(".js"));
const initialCss = initialAssets.filter((asset) => asset.file.endsWith(".css"));
const allJs = allAssets.filter((asset) => asset.file.endsWith(".js"));

const source = readFileSync(resolve(root, "src/MomosOps.jsx"), "utf8");
const sourceMetrics = {
  momosOpsSourceLines: source.split(/\r?\n/).length,
  inlineStyleOccurrences: (source.match(/style=\{\{/g) || []).length,
  rawButtonOccurrences: (source.match(/<button\b/g) || []).length,
  localComponentDefinitions: (source.match(/^function [A-Z][A-Za-z0-9_]*\s*\(/gm) || []).length,
};

const metrics = {
  measuredAt: new Date().toISOString(),
  initialJsRawBytes: sum(initialJs, "rawBytes"),
  initialJsGzipBytes: sum(initialJs, "gzipBytes"),
  initialCssRawBytes: sum(initialCss, "rawBytes"),
  initialCssGzipBytes: sum(initialCss, "gzipBytes"),
  largestJsChunkRawBytes: Math.max(0, ...allJs.map((asset) => asset.rawBytes)),
  jsChunkCount: allJs.length,
  source: sourceMetrics,
  initialAssets,
};

const checks = [
  ["initialJsGzipBytes", metrics.initialJsGzipBytes],
  ["largestJsChunkRawBytes", metrics.largestJsChunkRawBytes],
  ["initialCssGzipBytes", metrics.initialCssGzipBytes],
  ["momosOpsSourceLines", sourceMetrics.momosOpsSourceLines],
  ["inlineStyleOccurrences", sourceMetrics.inlineStyleOccurrences],
].map(([name, actual]) => ({
  name,
  actual,
  budget: config.budgets[name],
  pass: actual <= config.budgets[name],
}));

const report = { metrics, budgets: config.budgets, runtimeTargets: config.runtimeTargets, checks };
if (jsonOutput) console.log(JSON.stringify(report, null, 2));
else {
  console.log("MOMOS OPS · presupuesto H64");
  checks.forEach((check) => {
    console.log(`${check.pass ? "PASS" : "BASELINE>OBJETIVO"} ${check.name}: ${check.actual} / ${check.budget}`);
  });
  console.log(`Chunks JS: ${metrics.jsChunkCount} · componentes locales: ${sourceMetrics.localComponentDefinitions} · botones HTML: ${sourceMetrics.rawButtonOccurrences}`);
}

if (enforce && checks.some((check) => !check.pass)) process.exit(1);
