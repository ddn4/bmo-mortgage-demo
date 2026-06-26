import type { CreditRequest, CreditResponse } from './contracts';
import { hashString, maybeTransientFailure, simulateWork } from './util';

/** bmo-credit-fn — credit score lookup (one of three parallel internal Lambdas). */
export async function creditHandler(req: CreditRequest): Promise<CreditResponse> {
  const workMs = await simulateWork('bmo-credit-fn');
  maybeTransientFailure('bmo-credit-fn');
  const score = 600 + (hashString(`credit:${req.applicant}`) % 250); // 600..849
  return { score, workMs };
}
