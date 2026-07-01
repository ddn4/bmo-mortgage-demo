/** Single task queue for the demo. */
export const TASK_QUEUE = 'bmo-mortgage';

/**
 * Worker Deployment Version identity (Worker Versioning / PINNED).
 * Used by the serverless/cloud worker (M5); the local worker enables versioning
 * only when WORKER_VERSIONING=true. `name` + `buildId` must match the Worker
 * Deployment Version created in Temporal Cloud (CLAUDE.md, SPEC §8).
 *
 * NOTE: this module is bundled into the workflow sandbox (workflows import other
 * constants from here), so it must NOT touch `process`, `Date`, randomness, or
 * any other non-deterministic global at load time. The worker reads BMO_BUILD_ID
 * from the environment itself; we only expose the default here.
 */
export const DEPLOYMENT_NAME = 'bmo-mortgage-worker';
export const DEFAULT_BUILD_ID = 'local-dev';

/** Stable workflowId for an application (entity-workflow pattern). */
export function workflowIdFor(applicationId: string): string {
  return `mortgage-app-${applicationId}`;
}

/**
 * The six independently-deployed BMO business Lambdas plus the customer
 * book-of-record lookup (SPEC §4.3). These are real, Temporal-free functions;
 * activities invoke them by name through the invoker abstraction.
 */
export const LAMBDA = {
  INTAKE: 'bmo-intake-fn',
  INCOME: 'bmo-income-verification-fn',
  CUSTOMER: 'bmo-customer-fn',
  CREDIT: 'bmo-credit-fn',
  RISK: 'bmo-risk-fn',
  RATE: 'bmo-rate-fn',
  SYNDICATION: 'bmo-syndication-fn',
} as const;

export type LambdaName = (typeof LAMBDA)[keyof typeof LAMBDA];

/** Risk-sensitive fields locked once status >= RATE_ASSIGNED (SPEC §4.2). */
export const RISK_SENSITIVE_FIELDS: readonly string[] = ['income', 'creditScore', 'riskTier', 'rate'];

/**
 * Custom Search Attributes upserted by the workflow for list/filter (SPEC §4.6).
 * Registered automatically against the local dev server on worker boot; on
 * Temporal Cloud they are created via the Cloud UI / `temporal-cloud` CLI (M5).
 */
export const SEARCH_ATTR = {
  STATUS: 'applicationStatus',
  CHANNEL: 'channel',
  APPLICANT: 'applicant',
} as const;

export const SEARCH_ATTRIBUTES: readonly string[] = [SEARCH_ATTR.STATUS, SEARCH_ATTR.CHANNEL, SEARCH_ATTR.APPLICANT];
