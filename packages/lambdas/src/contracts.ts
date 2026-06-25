import type { Decision, IncomeDocType, RiskTier } from '@bmo/shared';

/**
 * Request/response contracts for each business Lambda. These are the functions'
 * OWN public contracts, written as if they predated Temporal (SPEC §4.3). The
 * activity layer builds these payloads and parses these responses; it is a thin
 * invoker with no business logic.
 */

export interface IntakeRequest {
  applicant: string;
  contact: { phone?: string; email?: string };
  channel: string;
}
export interface IntakeResponse {
  intakeId: string;
  receivedAt: string;
}

export interface IncomeRequest {
  applicant: string;
  docType: IncomeDocType;
}
export interface IncomeResponse {
  annual: number;
  docType: IncomeDocType;
  verified: boolean;
  documents: string[];
}

export interface CustomerRequest {
  applicant: string;
}
export interface CustomerResponse {
  customerRef: string;
  bookOfRecord: 'FOUND' | 'NEW';
}

export interface CreditRequest {
  applicant: string;
}
export interface CreditResponse {
  score: number;
}

export interface RiskRequest {
  applicant: string;
}
export interface RiskResponse {
  riskTier: RiskTier;
  recommendedDecision: Decision;
}

export interface RateRequest {
  creditScore: number;
  riskTier: RiskTier;
  decision: Decision;
}
export interface RateResponse {
  rate: number;
  lenderPartner: string;
}

export interface SyndicationRequest {
  applicationId: string;
  lenderPartner: string;
  summary: string;
}
export interface SyndicationResponse {
  syndicationRef: string;
  status: 'ACCEPTED';
}
