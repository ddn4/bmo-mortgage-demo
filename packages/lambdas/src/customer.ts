import type { CustomerRequest, CustomerResponse } from './contracts';
import { hashString, maybeTransientFailure, simulateLatency } from './util';

/** bmo-customer-fn — customer book-of-record lookup (one of three parallel internal Lambdas). */
export async function customerHandler(req: CustomerRequest): Promise<CustomerResponse> {
  await simulateLatency(60, 160);
  maybeTransientFailure('bmo-customer-fn');
  const h = hashString(req.applicant);
  return {
    customerRef: `BMO-${h % 1_000_000}`,
    bookOfRecord: h % 3 === 0 ? 'NEW' : 'FOUND',
  };
}
