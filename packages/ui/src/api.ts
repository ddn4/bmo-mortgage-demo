import type { AppListItem, ApplicationState, Fleet, StatusCounts, TriageItem } from './types';

const JSON_HEADERS = { 'content-type': 'application/json' };

interface CreateBody {
  name?: string;
  phone?: string;
  email?: string;
  incomeDocType?: 'T4' | 'GIG';
}

// GET helper: reject non-2xx responses so a failed endpoint (e.g. a detail query
// that returns 404 {error,detail} when no worker is polling under scale-to-zero)
// NEVER becomes state the components try to render. Callers catch and keep polling.
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
  return res.json() as Promise<T>;
}

export const api = {
  list: async (status?: string): Promise<AppListItem[]> =>
    asArray<AppListItem>(await getJson(`/api/applications${status ? `?status=${encodeURIComponent(status)}` : ''}`)),
  get: (id: string): Promise<ApplicationState> => getJson<ApplicationState>(`/api/applications/${id}`),
  create: (body: CreateBody) => post<{ id: string }>('/api/applications', body),
  partner: (body: CreateBody) => post<{ id: string }>('/api/applications/partner', body),
  edit: (id: string, field: string, value: unknown) =>
    post<{ accepted: boolean; reason?: string }>(`/api/applications/${id}/edit`, { field, value }),
  callback: (id: string, approved: boolean) => post<{ ok: boolean }>(`/api/applications/${id}/callback`, { approved }),
  triage: async (): Promise<TriageItem[]> => asArray<TriageItem>(await getJson('/api/triage')),
  getFault: (): Promise<{ syndicationFault: boolean }> => getJson('/api/fault'),
  setFault: (on: boolean) => post<{ syndicationFault: boolean }>('/api/fault', { on }),
  burst: (count: number) => post<{ started: number; apps: { id: string; applicant: string }[] }>('/api/burst', { count }),
  callbackAll: () => post<{ sent: number }>('/api/callback-all', {}),
  metrics: (): Promise<{ inFlight: number; completed: number }> => getJson('/api/metrics'),
  statusCounts: (): Promise<StatusCounts> => getJson<StatusCounts>('/api/status-counts'),
  fleet: (): Promise<Fleet> => getJson('/api/fleet'),
  source: (): Promise<{ path: string; code: string }> => getJson('/api/source'),
  config: (): Promise<{ temporalUiBase: string }> => getJson('/api/config'),
};
