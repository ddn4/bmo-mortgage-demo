import { LAMBDA, type LambdaName } from '@bmo/shared';
import { intakeHandler } from './intake';
import { incomeHandler } from './income';
import { customerHandler } from './customer';
import { creditHandler } from './credit';
import { riskHandler } from './risk';
import { rateHandler } from './rate';
import { syndicationHandler } from './syndication';

/**
 * Registry mapping each business Lambda name to its in-process handler.
 *
 * The local invoker calls these directly; the deployed Lambdas use the SAME
 * handler code (one entrypoint per function), so there is no local↔cloud
 * divergence (SPEC §4.3).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handlers: Record<LambdaName, (payload: any) => Promise<any>> = {
  [LAMBDA.INTAKE]: intakeHandler,
  [LAMBDA.INCOME]: incomeHandler,
  [LAMBDA.CUSTOMER]: customerHandler,
  [LAMBDA.CREDIT]: creditHandler,
  [LAMBDA.RISK]: riskHandler,
  [LAMBDA.RATE]: rateHandler,
  [LAMBDA.SYNDICATION]: syndicationHandler,
};

export * from './contracts';
