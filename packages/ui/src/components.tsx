import { useState } from 'react';
import { api } from './api';
import type { AppListItem, ApplicationState, StepEvent, TriageItem } from './types';

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
  customer: 'bmo-customer-fn',
  credit: 'bmo-credit-fn',
  risk: 'bmo-risk-fn',
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

const FILTERABLE = [...PIPELINE, 'NEEDS_REVIEW'];

export function AppList({
  items,
  selectedId,
  onSelect,
  statusFilter,
  onStatusFilter,
}: {
  items: AppListItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  statusFilter: string;
  onStatusFilter: (s: string) => void;
}) {
  return (
    <div className="card">
      <div className="list-head">
        <h2>Applications ({items.length})</h2>
        <select className="filter" value={statusFilter} onChange={(e) => onStatusFilter(e.target.value)} title="Filter by applicationStatus search attribute">
          <option value="">all statuses</option>
          {FILTERABLE.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
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

      {state.pendingActivities && state.pendingActivities.some((p) => p.attempt > 1 || p.lastFailure) && (
        <div className="retry-banner">
          {state.pendingActivities
            .filter((p) => p.attempt > 1 || p.lastFailure)
            .map((p, i) => (
              <div key={i}>
                ⚠ <b>{p.activityType}</b> retrying (attempt {p.attempt}) — {p.lastFailure ?? 'in progress'}
              </div>
            ))}
          <span className="muted">
            State is preserved — nothing is lost. Clear the fault in Triage and it resumes automatically.
          </span>
        </div>
      )}

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

// ---------------------------------------------------------------------------

export function TriagePanel({
  faultOn,
  onToggleFault,
  items,
  onSelect,
}: {
  faultOn: boolean;
  onToggleFault: (on: boolean) => void;
  items: TriageItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="card triage">
      <h2>Triage &amp; resolve</h2>
      <div className="fault-row">
        <span>Syndication partner schema:</span>
        <button className={faultOn ? 'danger' : ''} onClick={() => onToggleFault(!faultOn)}>
          {faultOn ? 'Clear fault' : 'Inject fault'}
        </button>
        <span className={faultOn ? 'fault-on' : 'fault-off'}>{faultOn ? 'BROKEN — syndications retrying' : 'healthy'}</span>
      </div>
      {items.length === 0 ? (
        <p className="muted">
          No stuck applications. Inject the fault, then advance an application to syndication to see Temporal retry and
          hold the state.
        </p>
      ) : (
        items.map((it) => (
          <div key={it.id} className="stuck" onClick={() => onSelect(it.id)}>
            <div className="stuck-head">
              <b>{it.applicant}</b> <span className="mono muted">#{it.id}</span> <StatusBadge status={it.status} />
            </div>
            {it.retrying.map((p, i) => (
              <div key={i} className="stuck-reason">
                ⚠ {p.activityType} · attempt {p.attempt} · {p.lastFailure}
              </div>
            ))}
            <div className="stuck-payload mono">
              applicant={it.application.applicant} · rate={it.application.rate ?? '—'}% · lender=
              {it.application.lenderPartner ?? '—'}
            </div>
            <a
              className="tlink"
              href={`http://localhost:8233/namespaces/default/workflows/mortgage-app-${it.id}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              event history ↗
            </a>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Illustrative cost model: always-warm worker fleet vs. serverless scale-to-zero. */
function CostModel() {
  // Assumptions (stated, editable in code): an orchestration worker fleet that
  // today runs as always-warm/provisioned Lambdas during business hours.
  const workers = 4;
  const memGb = 1769 / 1024; // 1 full vCPU
  const warmHours = 11; // 8–12 hrs/day warm (SPEC framing)
  const businessDays = 22;
  const gbsPrice = 0.0000166667; // Lambda GB-second (on-demand, USD)

  const alwaysWarm = workers * memGb * warmHours * 3600 * businessDays * gbsPrice;
  // Serverless: only the seconds the worker is actually executing tasks.
  const activeSecPerDay = 900; // ~ aggregate worker-active seconds across the day
  const serverless = memGb * activeSecPerDay * businessDays * gbsPrice;
  const saved = Math.round((1 - serverless / alwaysWarm) * 100);
  const usd = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="cost">
      <div className="cost-row">
        <div className="cost-cell warm">
          <b>Always-warm fleet</b>
          <span>{usd(alwaysWarm)}<i>/mo</i></span>
          <small>{workers} workers · warm {warmHours}h/day</small>
        </div>
        <div className="cost-cell serverless">
          <b>Serverless (scale-to-zero)</b>
          <span>{usd(serverless)}<i>/mo</i></span>
          <small>billed on active seconds only</small>
        </div>
      </div>
      <div className="cost-bar"><div className="cost-bar-fill" style={{ width: `${100 - saved}%` }} /></div>
      <div className="cost-saved">{saved}% lower · no cold-start tax · scales from zero</div>
      <small className="muted">Illustrative model — real numbers land in the cloud phase (M5).</small>
    </div>
  );
}

export function OperationsPanel({
  metrics,
  needsReview,
  onBurst,
  onCallbackAll,
}: {
  // Counts come from the server-side count() API so they're accurate beyond the
  // 100-item list cap. needsReview is the Triage set — apps awaiting manual
  // intervention (a retrying/stuck activity), not the rare NEEDS_REVIEW status.
  metrics: { inFlight: number; completed: number };
  needsReview: number;
  onBurst: (n: number) => void;
  onCallbackAll: () => Promise<void> | void;
}) {
  const [n, setN] = useState(30);
  const [bursting, setBursting] = useState(false);
  const [draining, setDraining] = useState(false);

  const run = async (fn: () => Promise<void> | void, setBusy: (b: boolean) => void) => {
    setBusy(true);
    try {
      await Promise.resolve(fn());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Operations &amp; cost</h2>
      <div className="readouts">
        <div><b>In-flight</b><span>{metrics.inFlight}</span></div>
        <div><b>Completed</b><span>{metrics.completed}</span></div>
        <div><b>Needs review</b><span className={needsReview ? 'warn-num' : ''}>{needsReview}</span></div>
      </div>
      <div className="row burst-row">
        <span className="mono muted">burst</span>
        <input type="number" min={1} max={200} value={n} onChange={(e) => setN(Number(e.target.value))} />
        <button disabled={bursting} onClick={() => run(() => onBurst(n), setBursting)}>Start {n} applications</button>
      </div>
      <div className="row">
        <button className="secondary" disabled={draining} onClick={() => run(onCallbackAll, setDraining)} title="Send the lender funding callback to every application parked at syndication">
          {draining ? 'Sending…' : 'Complete all at syndication'}
        </button>
      </div>
      <CostModel />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function CodeRevealPanel({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const lines = code ? code.split('\n').length : 0;
  return (
    <div className="card code-reveal">
      <div className="code-head" onClick={() => setOpen((o) => !o)}>
        <h2>Workflow source — the durability code your engineers own</h2>
        <span className="mono muted">{open ? 'hide' : `reveal · ${lines} lines of readable TypeScript ▾`}</span>
      </div>
      {open && (
        <pre className="code">
          <code>{code || 'loading…'}</code>
        </pre>
      )}
    </div>
  );
}
