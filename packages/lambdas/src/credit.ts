import type { CreditRequest, CreditResponse } from './contracts';
import { hashString, maybeTransientFailure, simulateLatency } from './util';

/** bmo-credit-fn — credit score lookup (one of three parallel internal Lambdas). */
export async function creditHandler(req: CreditRequest): Promise<CreditResponse> {
  await simulateLatency(70, 220);
  maybeTransientFailure('bmo-credit-fn');
  const score = 600 + (hashString(`credit:${req.applicant}`) % 250); // 600..849
  return { score };
}
