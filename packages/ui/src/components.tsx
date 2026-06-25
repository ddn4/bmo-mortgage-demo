import { useState } from 'react';
import { api } from './api';
import type { AppListItem, ApplicationState, StepEvent } from './types';

/** Linear pipeline used for the progress strip. */
export const PIPELINE = [
  'INTAKE',
  'INCOME_VERIFICATION',
  'CROSS_REFERENCE',
  'DECISION',
  'RATE_ASSIGNED',
  'SYNDICATION',
  'COMPLETED',
];

const STATUS_LABEL: Record<string, string> = {
  INTAKE: 'Intake',
  INCOME_VERIFICATION: 'Income',
  CROSS_REFERENCE: 'Cross-ref',
  DECISION: 'Decision',
  RATE_ASSIGNED: 'Rate',
  SYNDICATION: 'Syndication',
  COMPLETED: 'Completed',
  NEEDS_REVIEW: 'Needs review',
};

/** Maps a timeline step to the isolated Lambda(s) that would own its logs today. */
const STEP_SILO: Record<string, string> = {
  intake: 'bmo-intake-fn',
  'partner-intake': 'bmo-intake-fn',
  income: 'bmo-income-verification-fn',
  'cross-reference': 'bmo-customer-fn · bmo-credit-fn · bmo-risk-fn',
  rate: 'bmo-rate-fn',
  syndication: 'bmo-syndication-fn',
  callback: 'bmo-syndication-fn',
};

export function StatusBadge({ status }: { status?: string }) {
  const cls = status ? `badge badge-${status}` : 'badge';
  return <span className={cls}>{status ? (STATUS_LABEL[status] ?? status) : '—'}</span>;
}

function fmtTime(iso: string): string {
  return iso.slice(11, 23);
}

// ---------------------------------------------------------------------------

export function SpecialistConsole({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [docType, setDocType] = useState<'T4' | 'GIG'>('T4');
  const [busy, setBusy] = useState(false);

  const submit = async (channel: 'specialist' | 'partner') => {
    setBusy(true);
    try {
      const body = { name: name || undefined, phone: phone || undefined, incomeDocType: docType };
      const res = channel === 'specialist' ? await api.create(body) : await api.partner(body);
      setName('');
      setPhone('');
      onCreated(res.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Specialist console</h2>
      <label>
        Applicant name
        <input value={name} placeholder="Jane Q. Borrower" onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Phone
        <input value={phone} placeholder="416-555-0100" onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label>
        Income document
        <select value={docType} onChange={(e) => setDocType(e.target.value as 'T4' | 'GIG')}>
          <option value="T4">T4 (traditional)</option>
          <option value="GIG">Uber / gig stub</option>
        </select>
      </label>
      <div className="row">
        <button disabled={busy} onClick={() => submit('specialist')}>
          Create application
        </button>
        <button disabled={busy} className="secondary" onClick={() => submit('partner')} title="Idempotent signalWithStart into the same workflow type">
          Push from partner channel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AppList({
  items,
  selectedId,
  onSelect,
}: {
  items: AppListItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="card">
      <h2>Applications ({items.length})</h2>
      <div className="list">
        {items.length === 0 && <p className="muted">No applications yet — create one above.</p>}
        {items.map((it) => (
          <button
            key={it.workflowId}
            className={`list-item ${it.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(it.id)}
          >
            <span className="mono">{it.id}</span>
            <span className="grow">{it.applicant ?? '—'}</span>
            <span className={`chip chip-${it.channel ?? 'NA'}`}>{it.channel === 'PARTNER_QUEUE' ? 'partner' : 'specialist'}</span>
            <StatusBadge status={it.status ?? it.executionStatus} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProgressStrip({ status }: { status: string }) {
  const current = PIPELINE.indexOf(status);
  return (
    <div className="progress">
      {PIPELINE.map((s, i) => (
        <div key={s} className={`pip ${current >= i && current !== -1 ? 'done' : ''} ${s === status ? 'now' : ''}`}>
          {STATUS_LABEL[s]}
        </div>
      ))}
    </div>
  );
}

function UnifiedTimeline({ timeline }: { timeline: StepEvent[] }) {
  return (
    <div className="timeline">
      {timeline.map((e, i) => (
        <div key={i} className={`tl-row tl-${e.status}`}>
          <span className="tl-time mono">{fmtTime(e.at)}</span>
          <span className="tl-dot" />
          <span className="tl-step">{e.step}</span>
          <span className="tl-status">{e.status}</span>
          <span className="tl-detail">{e.detail}</span>
        </div>
      ))}
    </div>
  );
}

/** The "before" view: the SAME events scattered across isolated Lambda log groups. */
function SiloedLogs({ timeline }: { timeline: StepEvent[] }) {
  const silos = new Map<string, StepEvent[]>();
  const orphans: StepEvent[] = [];
  for (const e of timeline) {
    const silo = STEP_SILO[e.step];
    if (!silo) {
      orphans.push(e);
      continue;
    }
    if (!silos.has(silo)) silos.set(silo, []);
    silos.get(silo)!.push(e);
  }
  return (
    <div className="silos">
      <p className="muted">
        Today: no orchestration-level trace. Each Lambda writes to its own CloudWatch log group — you
        reconstruct the story across {silos.size} silos by hand.
      </p>
      {[...silos.entries()].map(([silo, events]) => (
        <div key={silo} className="silo">
          <div className="silo-head mono">/aws/lambda/{silo}</div>
          {events.map((e, i) => (
            <div key={i} className="silo-line mono">
              {fmtTime(e.at)} {e.step}.{e.status} {e.detail ?? ''}
            </div>
          ))}
        </div>
      ))}
      {orphans.length > 0 && (
        <div className="silo silo-warn">
          <div className="silo-head mono">⚠ no log group — orchestration-only events</div>
          {orphans.map((e, i) => (
            <div key={i} className="silo-line mono">
              {e.step}.{e.status} {e.detail ?? ''} — invisible today
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function lockMark(state: ApplicationState, field: string): string {
  return state.lockedFields.includes(field) ? ' 🔒' : '';
}

function EditPanel({ id, state, onChanged }: { id: string; state: ApplicationState; onChanged: () => void }) {
  const [field, setField] = useState('rate');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<{ accepted: boolean; reason?: string } | null>(null);

  const submit = async () => {
    const res = await api.edit(id, field, field === 'rate' || field === 'creditScore' ? Number(value) : value);
    setResult(res);
    onChanged();
  };

  return (
    <div className="edit">
      <h3>Edit (Update + validator)</h3>
      <div className="row">
        <select value={field} onChange={(e) => setField(e.target.value)}>
          <option value="rate">rate{lockMark(state, 'rate')}</option>
          <option value="creditScore">creditScore{lockMark(state, 'creditScore')}</option>
          <option value="applicant">applicant</option>
        </select>
        <input value={value} placeholder="new value" onChange={(e) => setValue(e.target.value)} />
        <button onClick={submit}>Apply edit</button>
      </div>
      {result && (
        <p className={result.accepted ? 'ok' : 'rejected'}>
          {result.accepted ? '✓ accepted' : `✗ rejected — ${result.reason}`}
        </p>
      )}
    </div>
  );
}

export function ApplicationDetail({ state, onChanged }: { state: ApplicationState; onChanged: () => void }) {
  const [view, setView] = useState<'after' | 'before'>('after');
  const a = state.application;
  const temporalUrl = `http://localhost:8233/namespaces/default/workflows/mortgage-app-${state.id}`;

  return (
    <div className="card detail">
      <div className="detail-head">
        <div>
          <h2>
            {a.applicant} <span className="mono muted">#{state.id}</span>
          </h2>
          <div className="row">
            <StatusBadge status={state.status} />
            <span className={`chip chip-${state.channel}`}>{state.channel === 'PARTNER_QUEUE' ? 'partner channel' : 'specialist'}</span>
            {state.decision && <span className="chip">{state.decision}</span>}
          </div>
        </div>
        <a className="tlink" href={temporalUrl} target="_blank" rel="noreferrer">
          Open in Temporal UI ↗
        </a>
      </div>

      {state.outcome && <div className="outcome">{state.outcome}</div>}

      <ProgressStrip status={state.status} />

      <div className="facts">
        <div><b>Income</b><span>{a.income ? `$${a.income.annual.toLocaleString()} (${a.income.docType})${lockMark(state, 'income')}` : '—'}</span></div>
        <div><b>Customer</b><span>{a.customerRef ?? '—'}</span></div>
        <div><b>Credit</b><span>{a.creditScore ?? '—'}{lockMark(state, 'creditScore')}</span></div>
        <div><b>Risk</b><span>{a.riskTier ?? '—'}{lockMark(state, 'riskTier')}</span></div>
        <div><b>Rate</b><span>{a.rate != null ? `${a.rate}%${lockMark(state, 'rate')}` : '—'}</span></div>
        <div><b>Lender</b><span>{a.lenderPartner ?? '—'}</span></div>
      </div>

      <div className="view-toggle">
        <span>Observability:</span>
        <button className={view === 'before' ? 'active' : ''} onClick={() => setView('before')}>
          Before — siloed Lambda logs
        </button>
        <button className={view === 'after' ? 'active' : ''} onClick={() => setView('after')}>
          After — one Temporal timeline
        </button>
      </div>

      {view === 'after' ? <UnifiedTimeline timeline={state.timeline} /> : <SiloedLogs timeline={state.timeline} />}

      <EditPanel id={state.id} state={state} onChanged={onChanged} />

      {state.status === 'SYNDICATION' && (
        <div className="row">
          <button onClick={() => api.callback(state.id, true).then(onChanged)}>Lender funding callback (approve)</button>
        </div>
      )}
    </div>
  );
}
