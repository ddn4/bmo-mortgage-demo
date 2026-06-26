import { ApplicationFailure, condition, log, proxyActivities, setHandler, upsertSearchAttributes } from '@temporalio/workflow';
import {
  ApplicationStatus,
  RISK_SENSITIVE_FIELDS,
  SEARCH_ATTR,
  statusAtOrAfter,
  type ApplicationState,
  type CreateApplicationInput,
  type EditRequest,
  type LenderCallback,
  type StepEvent,
} from '@bmo/shared';
// Type-only import: erased at runtime, so no activity/Lambda/Node code leaks into
// the workflow sandbox bundle (determinism — temporal-developer gotchas).
import type * as activities from '@bmo/activities';
import { editApplication, getApplication, lenderCallback, partnerIntake } from './definitions';

// Standard pipeline activities: short timeout, default-ish retry.
const { intake, verifyIncomeAndDocuments, customerLookup, creditScore, riskAssessment, assignRate } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '30 seconds',
    retry: { initialInterval: '1s', backoffCoefficient: 2, maximumInterval: '10s' },
  });

// Syndication is long-running and the fault target: longer timeout + heartbeat.
const { syndicateToLenderPartner } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  heartbeatTimeout: '30 seconds',
  retry: { initialInterval: '1s', backoffCoefficient: 2, maximumInterval: '15s' },
});

/**
 * Entity workflow — one per application (SPEC §4.1). Long-lived: runs the five
 * pipeline steps, then stays available to serve Queries and accept Edits.
 *
 * Versioning behavior PINNED is configured at the Worker Deployment Version level
 * for Serverless Workers (M5); the local worker runs unversioned by default.
 */
export async function mortgageApplicationWorkflow(input: CreateApplicationInput): Promise<ApplicationState> {
  const state: ApplicationState = {
    id: input.id,
    status: ApplicationStatus.INTAKE,
    channel: input.channel,
    decision: null,
    application: { id: input.id, applicant: input.applicant, contact: input.contact },
    timeline: [],
    lockedFields: [],
  };

  // Deterministic workflow time (the SDK sandbox controls Date.now), so timeline
  // timestamps are replay-safe.
  const record = (step: string, status: StepEvent['status'], detail?: string): void => {
    state.timeline.push({ step, status, detail, at: new Date().toISOString() });
  };

  // Elapsed across an activity, in deterministic workflow time — surfaces the
  // per-Lambda "simulating work for N.Ns" line in the timeline / siloed-logs view
  // (the handler's own console.log only reaches worker stdout / CloudWatch).
  const fmtWork = (ms: number): string => `simulating work for ${(ms / 1000).toFixed(1)}s`;
  const workedFor = (since: number): string => fmtWork(Date.now() - since);

  // Advance status AND mirror it to the applicationStatus search attribute so the
  // UI and Temporal UI can list/filter by status (SPEC §4.6).
  const setStatus = (next: ApplicationStatus): void => {
    state.status = next;
    upsertSearchAttributes({ [SEARCH_ATTR.STATUS]: [next] });
  };

  upsertSearchAttributes({ [SEARCH_ATTR.CHANNEL]: [input.channel], [SEARCH_ATTR.STATUS]: [state.status] });

  // --- Handlers (set before any await so they are ready immediately) ---
  setHandler(getApplication, () => state);

  setHandler(
    editApplication,
    (edit: EditRequest): ApplicationState => {
      (state.application as unknown as Record<string, unknown>)[edit.field] = edit.value;
      record('edit', 'COMPLETED', `${edit.field} = ${JSON.stringify(edit.value)}`);
      return state;
    },
    {
      // Read-only validator: throw to reject (SPEC §4.2). Locks risk-sensitive
      // fields once a rate has been assigned.
      validator: (edit: EditRequest): void => {
        if (
          statusAtOrAfter(state.status, ApplicationStatus.RATE_ASSIGNED) &&
          RISK_SENSITIVE_FIELDS.includes(edit.field)
        ) {
          throw ApplicationFailure.create({
            type: 'FieldLocked',
            nonRetryable: true,
            message: `Field '${edit.field}' is locked after rate assignment`,
          });
        }
      },
    },
  );

  let callback: LenderCallback | undefined;
  setHandler(lenderCallback, (cb: LenderCallback) => {
    callback = cb;
  });

  // Partner sales-channel ingestion (delivered via signalWithStart). Records the
  // touch on the same workflow — same workflow type, second channel (the "hub").
  setHandler(partnerIntake, (info: { source: string }) => {
    record('partner-intake', 'COMPLETED', `arrived via ${info.source}`);
  });

  // --- Step 1: Intake ---
  record('intake', 'STARTED');
  const tIntake = Date.now();
  const intakeResult = await intake({
    applicant: state.application.applicant,
    contact: state.application.contact,
    channel: state.channel,
  });
  record('intake', 'COMPLETED', `${workedFor(tIntake)} · intakeId=${intakeResult.intakeId}`);

  // --- Step 2: Income & document verification ---
  setStatus(ApplicationStatus.INCOME_VERIFICATION);
  record('income', 'STARTED');
  const tIncome = Date.now();
  const income = await verifyIncomeAndDocuments({
    applicant: state.application.applicant,
    docType: input.incomeDocType ?? 'T4',
  });
  state.application.income = { annual: income.annual, docType: income.docType, verified: income.verified };
  state.application.documents = income.documents;
  record('income', 'COMPLETED', `${workedFor(tIncome)} · ${income.docType} annual=${income.annual} verified=${income.verified}`);

  // --- Step 3: Cross-reference internal systems (three Lambdas in parallel) ---
  setStatus(ApplicationStatus.CROSS_REFERENCE);
  // Three isolated internal Lambdas, fanned out together. Each records its own
  // step so the per-Lambda lines (and real durations) show as distinct silos.
  record('customer', 'STARTED', 'parallel cross-reference');
  record('credit', 'STARTED', 'parallel cross-reference');
  record('risk', 'STARTED', 'parallel cross-reference');
  const [customer, credit, risk] = await Promise.all([
    customerLookup({ applicant: state.application.applicant }),
    creditScore({ applicant: state.application.applicant }),
    riskAssessment({ applicant: state.application.applicant }),
  ]);
  state.application.customerRef = customer.customerRef;
  state.application.creditScore = credit.score;
  state.application.riskTier = risk.riskTier;
  record('customer', 'COMPLETED', `${fmtWork(customer.workMs)} · customerRef=${customer.customerRef} (${customer.bookOfRecord})`);
  record('credit', 'COMPLETED', `${fmtWork(credit.workMs)} · score=${credit.score}`);
  record('risk', 'COMPLETED', `${fmtWork(risk.workMs)} · riskTier=${risk.riskTier}`);

  // --- Step 4: Underwriting decision (from the risk model) ---
  setStatus(ApplicationStatus.DECISION);
  state.decision = risk.recommendedDecision;
  record('decision', 'COMPLETED', `decision=${state.decision}`);

  if (state.decision === 'DECLINED') {
    setStatus(ApplicationStatus.COMPLETED);
    state.outcome = 'Declined — no offer issued';
    record('outcome', 'COMPLETED', state.outcome);
    return state;
  }

  // --- Step 4b: Rate assignment (locks risk-sensitive fields) ---
  record('rate', 'STARTED');
  const tRate = Date.now();
  const rate = await assignRate({
    creditScore: credit.score,
    riskTier: risk.riskTier,
    decision: state.decision,
  });
  state.application.rate = rate.rate;
  state.application.lenderPartner = rate.lenderPartner;
  setStatus(ApplicationStatus.RATE_ASSIGNED);
  state.lockedFields = [...RISK_SENSITIVE_FIELDS];
  record('rate', 'COMPLETED', `${workedFor(tRate)} · rate=${rate.rate}% lender=${rate.lenderPartner} (risk-sensitive fields locked)`);

  // --- Step 5: Syndication to lender partner, then await funding callback ---
  setStatus(ApplicationStatus.SYNDICATION);
  record('syndication', 'STARTED', `handing off to ${rate.lenderPartner}`);
  const tSynd = Date.now();
  const synd = await syndicateToLenderPartner({
    applicationId: state.id,
    lenderPartner: rate.lenderPartner,
    summary: `${state.application.applicant} / ${state.decision} / ${rate.rate}%`,
  });
  record('syndication', 'COMPLETED', `${workedFor(tSynd)} · syndicationRef=${synd.syndicationRef}; awaiting lender funding callback`);

  // Durable wait — no warm compute while the lender partner reviews (SPEC §4.5).
  const gotCallback = await condition(() => callback !== undefined, '30 days');
  if (!gotCallback) {
    setStatus(ApplicationStatus.NEEDS_REVIEW);
    state.outcome = 'Lender funding callback timed out';
    record('callback', 'FAILED', state.outcome);
    return state;
  }

  setStatus(ApplicationStatus.COMPLETED);
  if (callback?.approved) {
    state.outcome = `Offer issued at ${state.application.rate}% via ${state.application.lenderPartner}`;
  } else {
    state.decision = 'CONDITIONAL';
    state.outcome = 'Conditional — lender requires further review';
  }
  record('outcome', 'COMPLETED', state.outcome);
  log.info('application completed', { id: state.id, outcome: state.outcome });
  return state;
}
