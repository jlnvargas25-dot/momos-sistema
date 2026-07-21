const CLIENT_SERVICE_BY_EVENT = Object.freeze({
  route: "OPS_FRONTEND",
  rpc: "RPC_CORE",
  storage: "STORAGE",
  realtime: "REALTIME",
});

const CLIENT_SERVICES = Object.freeze(Object.values(CLIENT_SERVICE_BY_EVENT));

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function emptyAccumulator() {
  return { samples: 0, success: 0, errors: 0, durations: [], saturationPct: null, queueDepth: null };
}

function serviceForEvent(event) {
  if (event?.type === "route") return CLIENT_SERVICE_BY_EVENT.route;
  if (event?.type !== "http") return "";
  return CLIENT_SERVICE_BY_EVENT[event.record?.kind] || "";
}

function latencyBuckets(durations) {
  const result = { lte_100: 0, lte_250: 0, lte_500: 0, lte_1000: 0, lte_2500: 0, gt_2500: 0 };
  durations.forEach((raw) => {
    const value = safeNumber(raw);
    const key = value <= 100 ? "lte_100"
      : value <= 250 ? "lte_250"
        : value <= 500 ? "lte_500"
          : value <= 1000 ? "lte_1000"
            : value <= 2500 ? "lte_2500" : "gt_2500";
    result[key] += 1;
  });
  return result;
}

function minuteIso(epochMs) {
  return new Date(Math.floor(epochMs / 60_000) * 60_000).toISOString();
}

function randomUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const value = Math.floor(Math.random() * 16);
    return (token === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export function buildClientSloMeasurements(accumulators, { now = Date.now(), uuid = randomUuid } = {}) {
  const bucketAt = minuteIso(now);
  return CLIENT_SERVICES.flatMap((serviceCode) => {
    const current = accumulators.get(serviceCode);
    if (!current?.samples) return [];
    return [{
      idempotency_key: uuid(),
      service_code: serviceCode,
      bucket_at: bucketAt,
      sample_count: current.samples,
      success_count: current.success,
      error_count: current.errors,
      latency_buckets: latencyBuckets(current.durations),
      saturation_pct: current.saturationPct,
      queue_depth: current.queueDepth,
    }];
  });
}

export function createRuntimeSloReporter({
  telemetry,
  report,
  intervalMs = 60_000,
  maxBufferedSamples = 400,
  now = () => Date.now(),
  uuid = randomUuid,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
} = {}) {
  if (!telemetry?.subscribeSlo || typeof report !== "function") {
    throw new Error("H96 necesita telemetria y un reportero validos.");
  }
  const accumulators = new Map(CLIENT_SERVICES.map((service) => [service, emptyAccumulator()]));
  let pending = null;
  let inFlight = null;
  let stopped = false;

  function bufferedSamples() {
    return [...accumulators.values()].reduce((total, item) => total + item.samples, 0);
  }

  function accept(event) {
    if (stopped) return;
    const serviceCode = serviceForEvent(event);
    if (!serviceCode) return;
    const record = event.record || {};
    if (event.type === "route" && record.status !== "ready") return;
    const current = accumulators.get(serviceCode);
    current.samples += 1;
    const ok = event.type === "route" ? record.status === "ready" : record.ok === true;
    if (ok) current.success += 1;
    else current.errors += 1;
    current.durations.push(safeNumber(record.durationMs));
    if (record.saturationPct != null) current.saturationPct = Math.max(current.saturationPct ?? 0, Math.min(100, safeNumber(record.saturationPct)));
    if (record.queueDepth != null) current.queueDepth = Math.max(current.queueDepth ?? 0, Math.trunc(safeNumber(record.queueDepth)));
    if (bufferedSamples() >= maxBufferedSamples) void flush().catch(() => {});
  }

  async function flush() {
    if (stopped && !pending && bufferedSamples() === 0) return { ok: true, empty: true };
    if (inFlight) return inFlight;
    if (!pending) {
      const measurements = buildClientSloMeasurements(accumulators, { now: now(), uuid });
      if (!measurements.length) return { ok: true, empty: true };
      pending = { measurements };
      accumulators.forEach((_value, key) => accumulators.set(key, emptyAccumulator()));
    }
    const payload = pending;
    inFlight = Promise.resolve(report(payload)).then((result) => {
      pending = null;
      return result;
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  const unsubscribe = telemetry.subscribeSlo(accept);
  const timer = typeof setIntervalImpl === "function"
    ? setIntervalImpl(() => { void flush().catch(() => {}); }, Math.max(15_000, intervalMs))
    : null;

  function stop() {
    stopped = true;
    unsubscribe();
    if (timer != null && typeof clearIntervalImpl === "function") clearIntervalImpl(timer);
  }

  return { flush, stop, snapshot: () => ({ bufferedSamples: bufferedSamples(), pending: Boolean(pending), inFlight: Boolean(inFlight) }) };
}
