import { BusinessError, type BusinessErrorEnvelope } from '@bmo/shared';
import { intakeHandler } from './intake';
import { incomeHandler } from './income';
import { customerHandler } from './customer';
import { creditHandler } from './credit';
import { riskHandler } from './risk';
import { rateHandler } from './rate';
import { syndicationHandler } from './syndication';

/**
 * AWS Lambda handler wrappers for the seven business functions (cloud phase).
 *
 * Each deployed function is independent (own handler export, log group, IAM) and
 * keeps ZERO Temporal dependency — exactly as if it predated Temporal (SPEC §4.3).
 * The invoke payload arrives as the Lambda `event`; the wrapper returns the
 * handler result, or a BusinessErrorEnvelope when the handler signals a typed
 * business error (so retryable/non-retryable classification survives the invoke
 * boundary — see the cloud invoker in @bmo/activities). Unexpected errors are
 * rethrown and surface as a Lambda FunctionError, which Temporal retries.
 */
function wrap<TReq, TRes>(
  fn: (payload: TReq) => Promise<TRes>,
): (event: TReq) => Promise<TRes | BusinessErrorEnvelope> {
  return async (event: TReq) => {
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof BusinessError) {
        return { __businessError: { type: err.type, message: err.message, retryable: err.retryable } };
      }
      throw err;
    }
  };
}

// SAM Handler values: `lambda.intake`, `lambda.income`, ... (file.export).
export const intake = wrap(intakeHandler);
export const income = wrap(incomeHandler);
export const customer = wrap(customerHandler);
export const credit = wrap(creditHandler);
export const risk = wrap(riskHandler);
export const rate = wrap(rateHandler);
export const syndication = wrap(syndicationHandler);
