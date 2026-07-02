import type { LambdaName } from '@bmo/shared';
import { BusinessError, handlers, isBusinessErrorEnvelope } from '@bmo/lambdas';

/**
 * The invoker abstraction (SPEC §4.3). Activities call `invoke(fnName, payload)`;
 * the implementation is swapped by INVOKER_MODE so there is no code divergence
 * between local dev and the cloud:
 *   - local (default): run the SAME business-Lambda handler code in-process.
 *   - cloud: real @aws-sdk/client-lambda InvokeCommand against the deployed Lambda.
 */
export interface Invoker {
  invoke<TReq, TRes>(fn: LambdaName, payload: TReq): Promise<TRes>;
}

const localInvoker: Invoker = {
  async invoke<TReq, TRes>(fn: LambdaName, payload: TReq): Promise<TRes> {
    const handler = handlers[fn];
    if (!handler) throw new Error(`No local handler registered for ${fn}`);
    // Round-trip through JSON to mirror Lambda's serialization boundary.
    const res = await handler(JSON.parse(JSON.stringify(payload)));
    return res as TRes;
  },
};

let cloud: Invoker | undefined;
function cloudInvoker(): Invoker {
  if (cloud) return cloud;
  // Lazy-require the AWS SDK so local dev never loads it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
  const client = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-2' });
  const prefix = process.env.BMO_FN_PREFIX ?? '';
  cloud = {
    async invoke<TReq, TRes>(fn: LambdaName, payload: TReq): Promise<TRes> {
      const out = await client.send(
        new InvokeCommand({
          FunctionName: `${prefix}${fn}`,
          Payload: Buffer.from(JSON.stringify(payload)),
        }),
      );
      const text = out.Payload ? Buffer.from(out.Payload).toString('utf8') : 'null';
      if (out.FunctionError) {
        // Unhandled Lambda error (not a typed BusinessError) — let it retry.
        throw new Error(`Lambda ${fn} returned FunctionError: ${text}`);
      }
      const parsed = JSON.parse(text) as unknown;
      // Typed business error returned by the handler — rethrow so the activity
      // translates it to a (non-)retryable ApplicationFailure, same as local.
      if (isBusinessErrorEnvelope(parsed)) {
        const { type, message } = parsed.__businessError;
        throw new BusinessError(type, message);
      }
      return parsed as TRes;
    },
  };
  return cloud;
}

export function getInvoker(): Invoker {
  return process.env.INVOKER_MODE === 'cloud' ? cloudInvoker() : localInvoker;
}
