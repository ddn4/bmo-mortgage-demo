import { Component, useState, type ReactNode } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { api } from './api';
import type { AppListItem, ApplicationState, Fleet, StepEvent, TriageItem } from './types';

/**
 * Panel-level error boundary. A transient bad shape from a poll (e.g. a detail
 * query that fails under scale-to-zero) must never blank the whole page — it
 * shows a small inline fallback and recovers on the next successful render.
 */
export class ErrorBoundary extends Component<
  { label?: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  // Recover automatically: once new props/children arrive, try rendering again.
  componentDidUpdate(prev: { children: ReactNode }): void {
    if (this.state.failed && prev.children !== this.props.children) this.setState({ failed: false });
  }
  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="card boundary-fallback mono muted">
          {this.props.label ?? 'This section'} hit an error — recovering…
        </div>
      );
    }
    return this.props.children;
  }
}

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

function fmtTime(iso?: string): string {
  // Tolerate a missing/short timestamp — a malformed step must not throw mid-render.
  return iso && iso.length >= 23 ? iso.slice(11, 23) : (iso ?? '—');
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
            <span className="mono grow">{it.id}</span>
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

/**
 * A single fact that can be edited in place. Clicking the value reveals an input;
 * Enter/✓ sends the Update, Esc/✕ cancels. Locked risk-sensitive fields stay
 * attemptable on purpose — trying to save one surfaces the workflow validator's
 * synchronous rejection right on the field (the field-locking demo beat).
 */
function EditableFact({
  id,
  label,
  field,
  value,
  locked,
  numeric,
  onChanged,
}: {
  id: string;
  label: string;
  field: string;
  value: string;
  locked?: boolean;
  numeric?: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<{ accepted: boolean; reason?: string } | null>(null);

  const start = () => {
    setDraft('');
    setResult(null);
    setEditing(true);
  };
  const save = async () => {
    const res = await api.edit(id, field, numeric ? Number(draft) : draft);
    setResult(res);
    setEditing(false);
    onChanged();
  };

  return (
    <div className={`fact ${locked ? 'fact-locked' : ''}`}>
      <b>{label}</b>
      {editing ? (
        <span className="fact-edit">
          <input
            autoFocus
            value={draft}
            placeholder={value}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <button className="mini" onClick={save} title="Save">
            ✓
          </button>
          <button className="mini" onClick={() => setEditing(false)} title="Cancel">
            ✕
          </button>
        </span>
      ) : (
        <span className="fact-val" onClick={start} title="Click to edit">
          {value}
          {locked ? ' 🔒' : ''} <span className="fact-pencil">✎</span>
        </span>
      )}
      {result && (
        <span className={result.accepted ? 'fact-ok' : 'fact-rejected'}>
          {result.accepted ? '✓ saved' : `✗ ${result.reason ?? 'rejected'}`}
        </span>
      )}
    </div>
  );
}

/** The actual workflow source, syntax-highlighted (skill-gap talk track). */
function CodeBlock({ code }: { code: string }) {
  if (!code) return <div className="code muted mono">loading…</div>;
  return (
    <Highlight theme={themes.nightOwl} code={code} language="tsx">
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <pre className="code" style={style}>
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              <span className="code-ln">{i + 1}</span>
              {line.map((token, k) => (
                <span key={k} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

export function ApplicationDetail({ state, code, onChanged }: { state: ApplicationState; code: string; onChanged: () => void }) {
  const [view, setView] = useState<'after' | 'before' | 'code'>('after');
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
          Open Workflow ↗
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
        <EditableFact id={state.id} label="Applicant" field="applicant" value={a.applicant} onChanged={onChanged} />
        <div className="fact"><b>Income</b><span>{a.income ? `$${a.income.annual.toLocaleString()} (${a.income.docType})` : '—'}</span></div>
        <div className="fact"><b>Customer</b><span>{a.customerRef ?? '—'}</span></div>
        <EditableFact
          id={state.id}
          label="Credit"
          field="creditScore"
          numeric
          value={a.creditScore != null ? String(a.creditScore) : '—'}
          locked={state.lockedFields.includes('creditScore')}
          onChanged={onChanged}
        />
        <div className="fact"><b>Risk</b><span>{a.riskTier ?? '—'}{state.lockedFields.includes('riskTier') ? ' 🔒' : ''}</span></div>
        <EditableFact
          id={state.id}
          label="Rate"
          field="rate"
          numeric
          value={a.rate != null ? `${a.rate}%` : '—'}
          locked={state.lockedFields.includes('rate')}
          onChanged={onChanged}
        />
        <div className="fact"><b>Lender</b><span>{a.lenderPartner ?? '—'}</span></div>
      </div>

      <div className="view-toggle">
        <span>Observability:</span>
        <button className={view === 'before' ? 'active' : ''} onClick={() => setView('before')}>
          Before — siloed Lambda logs
        </button>
        <button className={view === 'after' ? 'active' : ''} onClick={() => setView('after')}>
          After — one Temporal timeline
        </button>
        <button className={view === 'code' ? 'active' : ''} onClick={() => setView('code')}>
          Workflow code
        </button>
      </div>

      {view === 'after' && <UnifiedTimeline timeline={state.timeline} />}
      {view === 'before' && <SiloedLogs timeline={state.timeline} />}
      {view === 'code' && <CodeBlock code={code} />}

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

export function OperationsPanel({
  metrics,
  fleet,
  needsReview,
  onBurst,
  onCallbackAll,
}: {
  // Counts come from the server-side count() API so they're accurate beyond the
  // 100-item list cap. needsReview is the Triage set — apps awaiting manual
  // intervention (a retrying/stuck activity), not the rare NEEDS_REVIEW status.
  metrics: { inFlight: number; completed: number };
  // Live serverless fleet: workers polling right now (0 at idle → N under burst),
  // plus the static architecture being orchestrated.
  fleet: Fleet;
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
      <h2>Operations</h2>
      <div className="readouts">
        <div><b>In-flight</b><span>{metrics.inFlight}</span></div>
        <div><b>Completed</b><span>{metrics.completed}</span></div>
        <div><b>Needs review</b><span className={needsReview ? 'warn-num' : ''}>{needsReview}</span></div>
      </div>
      <div className="fleet">
        <div className="fleet-live">
          <b>Serverless workers running</b>
          <span className={fleet.workersRunning ? 'fleet-num live' : 'fleet-num'}>{fleet.workersRunning}</span>
        </div>
        <small className="muted">
          orchestrating {fleet.businessLambdas} business Lambdas via {fleet.workerLambda} serverless worker · scales to zero
        </small>
        <a
          className="fleet-link mono"
          href="https://us-east-1.console.aws.amazon.com/lambda/home?region=us-east-1#/functions"
          target="_blank"
          rel="noreferrer"
          title="Opens the AWS Lambda console (us-east-1) — filter by 'bmo' to see the business functions + worker"
        >
          view the BMO Lambdas in AWS Console ↗
        </a>
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
