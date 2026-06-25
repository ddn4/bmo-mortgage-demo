import type { RateRequest, RateResponse } from './contracts';
import { maybeTransientFailure, simulateLatency } from './util';

/** bmo-rate-fn — assigns a mortgage rate. Assignment triggers field locking in the workflow. */
export async function rateHandler(req: RateRequest): Promise<RateResponse> {
  await simulateLatency(50, 150);
  maybeTransientFailure('bmo-rate-fn');
  const base = req.riskTier === 'LOW' ? 4.5 : req.riskTier === 'MEDIUM' ? 5.4 : 6.5;
  const creditAdjustment = Math.max(0, 720 - req.creditScore) * 0.002;
  const rate = Math.round((base + creditAdjustment) * 100) / 100;
  return { rate, lenderPartner: 'Maple Trust Lender Partners' };
}
