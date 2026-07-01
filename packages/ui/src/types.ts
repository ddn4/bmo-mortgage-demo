// UI-local mirrors of the API responses (kept decoupled from the backend packages
// so the browser bundle stays clean).
export interface StepEvent {
  step: string;
  status: 'STARTED' | 'COMPLETED' | 'RETRYING' | 'FAILED';
  detail?: string;
  at: string;
}

export interface ApplicationData {
  id: string;
  applicant: string;
  contact: { phone?: string; email?: string };
  income?: { annual: number; docType: string; verified: boolean };
  documents?: string[];
  customerRef?: string;
  creditScore?: number;
  riskTier?: string;
  rate?: number;
  lenderPartner?: string;
}

export interface PendingActivity {
  activityType?: string;
  attempt: number;
  lastFailure?: string;
}

export interface ApplicationState {
  id: string;
  status: string;
  channel: string;
  decision: string | null;
  application: ApplicationData;
  timeline: StepEvent[];
  lockedFields: string[];
  outcome?: string;
  pendingActivities?: PendingActivity[];
}

export interface TriageItem {
  id: string;
  applicant: string;
  status: string;
  channel: string;
  retrying: PendingActivity[];
  application: ApplicationData;
}

export interface Fleet {
  workersRunning: number;
  businessLambdas: number;
  workerLambda: number;
}

export interface AppListItem {
  id: string;
  workflowId: string;
  executionStatus: string;
  status?: string;
  channel?: string;
  applicant?: string;
  decision?: string | null;
  startTime?: string;
}
