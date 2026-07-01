import { BusinessError } from '@bmo/shared';
import type { SyndicationRequest, SyndicationResponse } from './contracts';
import { hashString, maybeTransientFailure, simulateWork } from './util';

/**
 * bmo-syndication-fn — hands off to a Canadian lender partner. Long-running
 * (the activity heartbeats around it) and the fault-injection target.
 *
 * When the fault is on, the partner "changed their schema" — the exact production
 * incident BMO described. Modeled as RETRYABLE so Temporal keeps retrying with
 * backoff (visible as "retrying" in the timeline / Triage view) and the run
 * resumes cleanly once the operator clears the fault (SPEC §4.4). The flag is
 * carried in the request payload (set by the orchestrator from the Temporal
 * control workflow) — this handler stays Temporal-free.
 */
export async function syndicationHandler(req: SyndicationRequest): Promise<SyndicationResponse> {
  await simulateWork('bmo-syndication-fn');
  if (req.forceSchemaFault) {
    throw new BusinessError(
      'SchemaMismatch',
      "lender partner rejected payload: unexpected schema (field 'borrowerId' renamed)",
      true,
    );
  }
  maybeTransientFailure('bmo-syndication-fn');
  return {
    syndicationRef: `SYN-${hashString(req.applicationId) % 1_000_000}`,
    status: 'ACCEPTED',
  };
}
