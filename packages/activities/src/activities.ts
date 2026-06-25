import { ApplicationFailure, heartbeat, log } from '@temporalio/activity';
import { BusinessError, LAMBDA, type Contact, type Decision, type IncomeDocType, type RiskTier } from '@bmo/shared';
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

export async function syndicateToLenderPartner(input: {
  applicationId: string;
  lenderPartner: string;
  summary: string;
}): Promise<SyndicationResponse> {
  // Heartbeat the long-running handoff so the activity is cancellable and the
  // worker is known to be alive (CLAUDE.md). A deeper checkpointing pass (resume
  // mid-handoff via heartbeat details) is future work.
  heartbeat(`handing off ${input.applicationId} to ${input.lenderPartner}`);
  return invoke(LAMBDA.SYNDICATION, input);
}
