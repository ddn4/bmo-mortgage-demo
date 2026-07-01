import { ApplicationFailure, heartbeat, log } from '@temporalio/activity';
import { BusinessError, FAULT_CONTROL_WORKFLOW_ID, LAMBDA, type Contact, type Decision, type IncomeDocType, type RiskTier } from '@bmo/shared';
import { getActivityClient } from './temporal';
import type {
  CreditResponse,
  CustomerResponse,
  IncomeResponse,
  IntakeResponse,
  RateResponse,
  RiskResponse,
  SyndicationResponse,
} from '@bmo/lambdas';
import { getInvoker, type Invoker } from './invoker';

const invoker: Invoker = getInvoker();

/**
 * Thin invoker wrapper. Calls the business Lambda and translates its Temporal-free
 * BusinessError into the right ApplicationFailure: nonRetryable when the error is
 * permanent (validation/schema/not-found), retryable otherwise. Transient errors
 * fall through to Temporal's default retry policy (CLAUDE.md, SPEC §4.3).
 */
async function invoke<TReq, TRes>(fn: Parameters<Invoker['invoke']>[0], payload: TReq): Promise<TRes> {
  try {
    return await invoker.invoke<TReq, TRes>(fn, payload);
  } catch (err) {
    if (err instanceof BusinessError) {
      throw ApplicationFailure.create({
        type: err.type,
        message: err.message,
        nonRetryable: !err.retryable,
      });
    }
    throw err;
  }
}

export async function intake(input: { applicant: string; contact: Contact; channel: string }): Promise<IntakeResponse> {
  log.info('intake', { applicant: input.applicant, channel: input.channel });
  return invoke(LAMBDA.INTAKE, input);
}

export async function verifyIncomeAndDocuments(input: {
  applicant: string;
  docType: IncomeDocType;
}): Promise<IncomeResponse> {
  return invoke(LAMBDA.INCOME, input);
}

export async function customerLookup(input: { applicant: string }): Promise<CustomerResponse> {
  return invoke(LAMBDA.CUSTOMER, input);
}

export async function creditScore(input: { applicant: string }): Promise<CreditResponse> {
  return invoke(LAMBDA.CREDIT, input);
}

export async function riskAssessment(input: { applicant: string }): Promise<RiskResponse> {
  return invoke(LAMBDA.RISK, input);
}

export async function assignRate(input: {
  creditScore: number;
  riskTier: RiskTier;
  decision: Decision;
}): Promise<RateResponse> {
  return invoke(LAMBDA.RATE, input);
}

/**
 * Read the syndication-fault toggle from the control workflow's memo via
 * describe() — worker-independent and cheap (no query, no cold-start). Defaults
 * to off if the control workflow was never started or is unreachable.
 */
async function syndicationFaultOn(): Promise<boolean> {
  try {
    const client = await getActivityClient();
    const desc = await client.workflow.getHandle(FAULT_CONTROL_WORKFLOW_ID).describe();
    return Boolean((desc.memo as Record<string, unknown> | undefined)?.syndicationFault);
  } catch {
    return false;
  }
}

export async function syndicateToLenderPartner(input: {
  applicationId: string;
  lenderPartner: string;
  summary: string;
}): Promise<SyndicationResponse> {
  // Heartbeat the long-running handoff so the activity is cancellable and the
  // worker is known to be alive (CLAUDE.md). A deeper checkpointing pass (resume
  // mid-handoff via heartbeat details) is future work.
  heartbeat(`handing off ${input.applicationId} to ${input.lenderPartner}`);
  // Inject the partner schema break when the fault is toggled on. The flag comes
  // from the Temporal control workflow (works local + cloud); the business Lambda
  // stays Temporal-free — it just reads `forceSchemaFault` from its payload.
  const forceSchemaFault = await syndicationFaultOn();
  return invoke(LAMBDA.SYNDICATION, { ...input, forceSchemaFault });
}
