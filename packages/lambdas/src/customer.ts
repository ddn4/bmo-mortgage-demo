import type { CustomerRequest, CustomerResponse } from './contracts';
import { hashString, maybeTransientFailure, simulateWork } from './util';

/** bmo-customer-fn — customer book-of-record lookup (one of three parallel internal Lambdas). */
export async function customerHandler(req: CustomerRequest): Promise<CustomerResponse> {
  await simulateWork('bmo-customer-fn');
  maybeTransientFailure('bmo-customer-fn');
  const h = hashString(req.applicant);
  return {
    customerRef: `BMO-${h % 1_000_000}`,
    bookOfRecord: h % 3 === 0 ? 'NEW' : 'FOUND',
  };
}
