import type { ApplicationStatus } from './status';

export type Channel = 'SPECIALIST' | 'PARTNER_QUEUE';
export type Decision = 'APPROVED' | 'CONDITIONAL' | 'DECLINED';
export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH';
export type IncomeDocType = 'T4' | 'GIG';

export interface Contact {
  phone?: string;
  email?: string;
}

/** The application payload accumulated across the pipeline (SPEC §4.1). */
export interface ApplicationData {
  id: string;
  applicant: string;
  contact: Contact;
  income?: { annual: number; docType: IncomeDocType; verified: boolean };
  documents?: string[];
  customerRef?: string;
  creditScore?: number;
  riskTier?: RiskTier;
  rate?: number;
  lenderPartner?: string;
}

/** One entry in the observability timeline (SPEC §4.1, §5 view 2). */
export interface StepEvent {
  step: string;
  status: 'STARTED' | 'COMPLETED' | 'RETRYING' | 'FAILED';
  detail?: string;
  /** ISO timestamp from deterministic workflow time. */
  at: string;
}

/** Full workflow state, returned by the `getApplication` query. */
export interface ApplicationState {
  id: string;
  status: ApplicationStatus;
  channel: Channel;
  decision: Decision | null;
  application: ApplicationData;
  timeline: StepEvent[];
  /** Risk-sensitive fields locked once status >= RATE_ASSIGNED. */
  lockedFields: string[];
  outcome?: string;
}

/** Input to start a new application workflow. */
export interface CreateApplicationInput {
  id: string;
  applicant: string;
  contact: Contact;
  channel: Channel;
  incomeDocType?: IncomeDocType;
}

/** Payload of the `editApplication` update. */
export interface EditRequest {
  field: string;
  value: unknown;
}

/** Payload of the `lenderCallback` signal that resumes syndication. */
export interface LenderCallback {
  approved: boolean;
  reference?: string;
}
