import type { IncomeRequest, IncomeResponse } from './contracts';
import { hashString, maybeTransientFailure, simulateWork } from './util';

/**
 * bmo-income-verification-fn — verifies a pay stub. Handles both a traditional
 * T4 and an Uber/gig stub (nodding to BMO's ML classifier for non-traditional
 * income, SPEC §3 step 2).
 */
export async function incomeHandler(req: IncomeRequest): Promise<IncomeResponse> {
  await simulateWork('bmo-income-verification-fn');
  maybeTransientFailure('bmo-income-verification-fn');
  const base = 45_000 + (hashString(req.applicant) % 90_000);
  const annual = req.docType === 'GIG' ? Math.round(base * 0.85) : base;
  const documents = req.docType === 'GIG' ? ['uber-earnings-2025.pdf'] : ['T4-2025.pdf'];
  return { annual, docType: req.docType, verified: true, documents };
}
