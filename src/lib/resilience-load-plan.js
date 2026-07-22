export function createResilienceLoadPlan({
  concurrency,
  targetRequests,
  lostResponseAttempts = 5,
  realtimeRequests = 20,
  atomicRequests = 3,
  finalReconciliationRequests = 1,
}) {
  if (!Number.isInteger(concurrency) || concurrency < 8 || concurrency > 64) {
    throw new TypeError("H99_CONCURRENCY_INVALID");
  }
  if (!Number.isInteger(targetRequests) || targetRequests < 100 || targetRequests > 10000) {
    throw new TypeError("H99_TARGET_REQUESTS_INVALID");
  }
  const controls = [
    lostResponseAttempts,
    realtimeRequests,
    atomicRequests,
    finalReconciliationRequests,
  ];
  if (controls.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new TypeError("H99_CONTROL_REQUESTS_INVALID");
  }

  const fixedRequestCount = lostResponseAttempts * 2 + concurrency * 2
    + atomicRequests + realtimeRequests + finalReconciliationRequests;
  const scalableRequestCount = Math.max(120, targetRequests - fixedRequestCount);
  const idempotencyKeyCount = Math.max(40, Math.ceil(scalableRequestCount * 0.3));
  const parallelReadCount = Math.max(
    40,
    targetRequests - fixedRequestCount - idempotencyKeyCount * 2,
  );
  const plannedRequestCount = fixedRequestCount + idempotencyKeyCount * 2 + parallelReadCount;
  if (plannedRequestCount < targetRequests) throw new Error("H99_PLANNED_LOAD_BELOW_TARGET");

  return Object.freeze({
    concurrency,
    targetRequests,
    lostResponseAttempts,
    realtimeRequests,
    atomicRequests,
    finalReconciliationRequests,
    fixedRequestCount,
    idempotencyKeyCount,
    parallelReadCount,
    plannedRequestCount,
  });
}
