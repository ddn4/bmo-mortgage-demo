import type { AppListItem, ApplicationState, TriageItem } from './types';

const JSON_HEADERS = { 'content-type': 'application/json' };

interface CreateBody {
  name?: string;
  phone?: string;
  email?: string;
  incomeDocType?: 'T4' | 'GIG';
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
  return res.json() as Promise<T>;
}

export const api = {
  list: (): Promise<AppListItem[]> => fetch('/api/applications').then((r) => r.json()),
  get: (id: string): Promise<ApplicationState> => fetch(`/api/applications/${id}`).then((r) => r.json()),
  create: (body: CreateBody) => post<{ id: string }>('/api/applications', body),
  partner: (body: CreateBody) => post<{ id: string }>('/api/applications/partner', body),
  edit: (id: string, field: string, value: unknown) =>
    post<{ accepted: boolean; reason?: string }>(`/api/applications/${id}/edit`, { field, value }),
  callback: (id: string, approved: boolean) => post<{ ok: boolean }>(`/api/applications/${id}/callback`, { approved }),
  triage: (): Promise<TriageItem[]> => fetch('/api/triage').then((r) => r.json()),
  getFault: (): Promise<{ syndicationFault: boolean }> => fetch('/api/fault').then((r) => r.json()),
  setFault: (on: boolean) => post<{ syndicationFault: boolean }>('/api/fault', { on }),
};
