import type { Decision, RiskTier } from '@bmo/shared';
import type { RiskRequest, RiskResponse } from './contracts';
import { hashString, maybeTransientFailure, simulateWork } from './util';

/**
 * bmo-risk-fn — risk model (one of three parallel internal Lambdas). Returns the
 * risk tier AND the recommended underwriting decision, so the decision logic
 * stays in the (mock) business function, not in the workflow ("orchestrate,
 * don't replace", SPEC §4.3).
 *
 * Demo control: set BMO_FORCE_DECISION=APPROVED|CONDITIONAL|DECLINED to force the
 * outcome for a predictable live demo.
 */
export async function riskHandler(req: RiskRequest): Promise<RiskResponse> {
  const workMs = await simulateWork('bmo-risk-fn');
  maybeTransientFailure('bmo-risk-fn');

  const forced = process.env.BMO_FORCE_DECISION as Decision | undefined;
  if (forced === 'APPROVED' || forced === 'CONDITIONAL' || forced === 'DECLINED') {
    const tierFor: Record<Decision, RiskTier> = {
      APPROVED: 'LOW',
      CONDITIONAL: 'MEDIUM',
      DECLINED: 'HIGH',
    };
    return { riskTier: tierFor[forced], recommendedDecision: forced, workMs };
  }

  const h = hashString(`risk:${req.applicant}`) % 100;
  if (h < 60) return { riskTier: 'LOW', recommendedDecision: 'APPROVED', workMs };
  if (h < 90) return { riskTier: 'MEDIUM', recommendedDecision: 'CONDITIONAL', workMs };
  return { riskTier: 'HIGH', recommendedDecision: 'DECLINED', workMs };
}
