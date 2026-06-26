import { BusinessError } from '@bmo/shared';

/** Deterministic, stable hash so credit/risk/customer "feel" stateful per applicant. */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Simulate business work so the pipeline is observable step-by-step. Each handler
 * sleeps a random interval (default ~0.7–2.1s) and logs a line that shows up in
 * the worker output locally and in the function's CloudWatch logs in the cloud —
 * which also makes the "before: siloed per-Lambda logs" view tangible. Tune the
 * pace with BMO_STEP_MIN_MS / BMO_STEP_MAX_MS (e.g. set both to 0 for fast runs).
 * Safe here — handlers are not workflow code.
 */
export async function simulateWork(fnName: string): Promise<void> {
  const min = Number(process.env.BMO_STEP_MIN_MS ?? '700');
  const max = Number(process.env.BMO_STEP_MAX_MS ?? '2100');
  const span = Math.max(0, max - min);
  const ms = min + Math.floor(Math.random() * (span + 1));
  console.log(`[${fnName}] simulating work for ${(ms / 1000).toFixed(1)}s`);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Occasionally fail with a transient downstream error so Temporal's automatic
 * retries are observable. Defaults to 0 (off) so the local happy path is clean;
 * set BMO_TRANSIENT_FAILURE_RATE (0..1) to exercise retries.
 */
export function maybeTransientFailure(fnName: string): void {
  const rate = Number(process.env.BMO_TRANSIENT_FAILURE_RATE ?? '0');
  if (rate > 0 && Math.random() < rate) {
    throw new BusinessError('TransientDownstream', `${fnName}: transient downstream failure`, true);
  }
}
