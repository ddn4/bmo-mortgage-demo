import { BusinessError } from '@bmo/shared';

/** Deterministic, stable hash so credit/risk/customer "feel" stateful per applicant. */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Simulate realistic Lambda latency. Safe here — handlers are not workflow code. */
export async function simulateLatency(minMs: number, maxMs: number): Promise<void> {
  const span = Math.max(0, maxMs - minMs);
  const ms = minMs + Math.floor(Math.random() * (span + 1));
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
