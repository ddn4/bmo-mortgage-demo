import { BusinessError } from '@bmo/shared';
import type { IntakeRequest, IntakeResponse } from './contracts';
import { hashString, maybeTransientFailure, simulateWork } from './util';

/** bmo-intake-fn — acknowledges a new application from either channel. */
export async function intakeHandler(req: IntakeRequest): Promise<IntakeResponse> {
  await simulateWork('bmo-intake-fn');
  maybeTransientFailure('bmo-intake-fn');
  if (!req.applicant?.trim()) {
    throw new BusinessError('ValidationError', 'applicant name is required', false);
  }
  return {
    intakeId: `INT-${hashString(req.applicant) % 1_000_000}`,
    receivedAt: new Date().toISOString(),
  };
}
