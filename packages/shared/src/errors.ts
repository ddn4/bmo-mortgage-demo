/**
 * Plain, Temporal-free error thrown by business Lambda handlers.
 *
 * The handlers have ZERO Temporal dependency (SPEC §4.3), so they cannot throw
 * Temporal's ApplicationFailure. Instead they throw a BusinessError carrying a
 * `type` and an explicit `retryable` flag; the thin activity translates it into
 * the right ApplicationFailure (nonRetryable when !retryable).
 */
export type BusinessErrorType =
  | 'SchemaMismatch'
  | 'ValidationError'
  | 'TransientDownstream'
  | 'NotFound';

export class BusinessError extends Error {
  readonly type: BusinessErrorType;
  readonly retryable: boolean;

  constructor(type: BusinessErrorType, message: string, retryable: boolean) {
    super(message);
    this.name = 'BusinessError';
    this.type = type;
    this.retryable = retryable;
  }
}
