/**
 * Plain, Temporal-free typed error a business Lambda handler throws.
 *
 * It carries a business `type` + message ONLY — no retry semantics. A real
 * "existing BMO Lambda" classifies its own failures (an error code), but knows
 * nothing about orchestration; **retryability is decided by the orchestrator (the
 * Temporal activity), not the business function** (SPEC §4.3). Lives in
 * `@bmo/lambdas` (not `@bmo/shared`) so the deployed Lambda bundle carries no
 * orchestration constants.
 */
export type BusinessErrorType = 'SchemaMismatch' | 'ValidationError' | 'TransientDownstream' | 'NotFound';

export class BusinessError extends Error {
  readonly type: BusinessErrorType;

  constructor(type: BusinessErrorType, message: string) {
    super(message);
    this.name = 'BusinessError';
    this.type = type;
  }
}

/**
 * A thrown error can't cross the AWS Lambda invoke boundary as a typed object, so
 * the deployed handler returns this envelope; the cloud invoker reconstructs the
 * BusinessError from it. Locally the handler just throws — both paths converge at
 * the activity, which maps the `type` to a (non-)retryable ApplicationFailure.
 */
export interface BusinessErrorEnvelope {
  __businessError: { type: BusinessErrorType; message: string };
}

export function isBusinessErrorEnvelope(value: unknown): value is BusinessErrorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__businessError' in value &&
    typeof (value as BusinessErrorEnvelope).__businessError?.type === 'string'
  );
}
