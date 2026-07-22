import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const env = (name) => String(process.env[name] || "").trim();
const SOURCE_URL = env("PRODUCTION_SUPABASE_URL").replace(/\/+$/, "");
const SOURCE_KEY = env("PRODUCTION_SUPABASE_SERVICE_ROLE_KEY");
const SOURCE_REF = env("PRODUCTION_PROJECT_REF");
const TARGET_URL = env("STAGING_SUPABASE_URL").replace(/\/+$/, "");
const TARGET_KEY = env("STAGING_SUPABASE_SERVICE_ROLE_KEY");
const TARGET_REF = env("STAGING_PROJECT_REF");
const BACKUP_ID = env("MOMOS_RECOVERY_BACKUP_ID");
const RESULT_PATH = env("MOMOS_STORAGE_RESULT_PATH");

function isSupabaseServerKey(value) {
  if (value.startsWith("sb_secret_")) return true;
  if (value.startsWith("sb_publishable_")) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role";
  } catch {
    return false;
  }
}

function validatePrivateContract() {
  if (!/^[a-z0-9]{20}$/.test(SOURCE_REF) || !/^[a-z0-9]{20}$/.test(TARGET_REF)
      || SOURCE_REF === TARGET_REF) {
    throw new Error("STORAGE_PROJECT_ISOLATION_INVALID");
  }
  if (SOURCE_URL !== `https://${SOURCE_REF}.supabase.co`
      || TARGET_URL !== `https://${TARGET_REF}.supabase.co`) {
    throw new Error("STORAGE_PROJECT_URL_INVALID");
  }
  if (!isSupabaseServerKey(SOURCE_KEY) || !isSupabaseServerKey(TARGET_KEY)
      || BACKUP_ID.length < 3 || !RESULT_PATH) {
    throw new Error("STORAGE_PRIVATE_ENV_INVALID");
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function listAllObjects(client, bucket, prefix = "") {
  const objects = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: 1_000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error("STORAGE_LIST_FAILED");
    for (const item of data || []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id || item.metadata) {
        objects.push({
          bucket,
          path,
          size: Number(item.metadata?.size || 0),
          mimeType: String(item.metadata?.mimetype || item.metadata?.contentType || "") || null,
        });
      } else {
        objects.push(...await listAllObjects(client, bucket, path));
      }
    }
    if (!data || data.length < 1_000) break;
    offset += data.length;
  }
  return objects;
}

async function hashBlob(blob) {
  return sha256(Buffer.from(await blob.arrayBuffer()));
}

async function main() {
  validatePrivateContract();
  const source = createClient(SOURCE_URL, SOURCE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const target = createClient(TARGET_URL, TARGET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: sourceBuckets, error: sourceBucketError } = await source.storage.listBuckets();
  const { data: targetBuckets, error: targetBucketError } = await target.storage.listBuckets();
  if (sourceBucketError || targetBucketError) throw new Error("STORAGE_BUCKET_LIST_FAILED");

  const buckets = (sourceBuckets || [])
    .map((bucket) => ({
      id: String(bucket.id),
      public: Boolean(bucket.public),
      fileSizeLimit: bucket.file_size_limit == null ? null : Number(bucket.file_size_limit),
      allowedMimeTypes: Array.isArray(bucket.allowed_mime_types)
        ? [...bucket.allowed_mime_types].map(String).sort()
        : [],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const targetById = new Map((targetBuckets || []).map((bucket) => [String(bucket.id), bucket]));
  for (const bucket of buckets) {
    const targetBucket = targetById.get(bucket.id);
    const targetContract = targetBucket && {
      public: Boolean(targetBucket.public),
      fileSizeLimit: targetBucket.file_size_limit == null ? null : Number(targetBucket.file_size_limit),
      allowedMimeTypes: Array.isArray(targetBucket.allowed_mime_types)
        ? [...targetBucket.allowed_mime_types].map(String).sort()
        : [],
    };
    if (!targetContract || JSON.stringify(targetContract) !== JSON.stringify({
      public: bucket.public,
      fileSizeLimit: bucket.fileSizeLimit,
      allowedMimeTypes: bucket.allowedMimeTypes,
    })) {
      throw new Error("STORAGE_BUCKET_CONTRACT_MISMATCH");
    }
  }

  const objects = (await Promise.all(buckets.map((bucket) => listAllObjects(source, bucket.id))))
    .flat()
    .sort((a, b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`));
  const manifestItems = [];
  let copied = 0;
  let reused = 0;

  for (const object of objects) {
    const sourceDownload = await source.storage.from(object.bucket).download(object.path);
    if (sourceDownload.error || !sourceDownload.data) throw new Error("STORAGE_SOURCE_DOWNLOAD_FAILED");
    const sourceHash = await hashBlob(sourceDownload.data);
    let targetDownload = await target.storage.from(object.bucket).download(object.path);
    let targetHash = targetDownload.error || !targetDownload.data
      ? null
      : await hashBlob(targetDownload.data);
    if (targetHash !== sourceHash) {
      const { error: uploadError } = await target.storage.from(object.bucket).upload(
        object.path,
        sourceDownload.data,
        { upsert: true, contentType: object.mimeType || undefined },
      );
      if (uploadError) throw new Error("STORAGE_TARGET_UPLOAD_FAILED");
      targetDownload = await target.storage.from(object.bucket).download(object.path);
      if (targetDownload.error || !targetDownload.data) throw new Error("STORAGE_TARGET_DOWNLOAD_FAILED");
      targetHash = await hashBlob(targetDownload.data);
      copied += 1;
    } else {
      reused += 1;
    }
    if (targetHash !== sourceHash) throw new Error("STORAGE_OBJECT_HASH_MISMATCH");
    manifestItems.push({
      bucket: object.bucket,
      pathFingerprint: sha256(object.path),
      sha256: sourceHash,
      size: object.size,
      mimeType: object.mimeType,
    });
  }

  const manifest = {
    contract: "momos.storage-recovery-manifest.v1",
    sourceProject: SOURCE_REF,
    targetProject: TARGET_REF,
    backupId: BACKUP_ID,
    buckets,
    objects: manifestItems,
  };
  const manifestSha256 = sha256(JSON.stringify(manifest));
  const result = {
    ok: true,
    contract: manifest.contract,
    manifestSha256,
    objectCount: manifestItems.length,
    totalBytes: manifestItems.reduce((total, item) => total + item.size, 0),
    bucketCount: buckets.length,
    copied,
    reused,
  };
  await writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(
    `[Continuidad MOMOS] Storage verificado · ${result.objectCount} objetos · `
    + `${result.copied} restaurados · ${result.reused} ya íntegros\n`,
  );
}

main().catch(async (error) => {
  const safeCode = /^[A-Z0-9_]+$/.test(String(error?.message || ""))
    ? error.message
    : "STORAGE_RECOVERY_FAILED";
  if (RESULT_PATH) {
    await writeFile(RESULT_PATH, `${JSON.stringify({ ok: false, error: safeCode }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    }).catch(() => {});
  }
  process.stderr.write(`[Continuidad MOMOS] ${safeCode}\n`);
  process.exitCode = 1;
});
