import { Component, useState, type ReactNode } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { api } from './api';
import type { AppListItem, ApplicationState, Fleet, StatusCounts, StepEvent } from './types';

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

export function SpecialistConsole({
  onCreated,
  onBurst,
  onCallbackAll,
}: {
  onCreated: (id: string) => void;
  onBurst: (n: number) => void;
  onCallbackAll: () => Promise<void> | void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [docType, setDocType] = useState<'T4' | 'GIG'>('T4');
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(15);
  const [bursting, setBursting] = useState(false);
  const [draining, setDraining] = useState(false);

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

  const run = async (fn: () => Promise<void> | void, setB: (b: boolean) => void) => {
    setB(true);
    try {
      await Promise.resolve(fn());
    } finally {
      setB(false);
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

      <div className="console-divider" />
      <div className="row burst-row">
        <span className="mono muted">burst</span>
        <input type="number" min={1} max={200} value={n} onChange={(e) => setN(Number(e.target.value))} />
        <button disabled={bursting} onClick={() => run(() => onBurst(n), setBursting)}>
          Start {n}
        </button>
      </div>
      <div className="row">
        <button
          className="secondary"
          disabled={draining}
          onClick={() => run(onCallbackAll, setDraining)}
          title="Send the lender funding callback to every application parked at syndication"
        >
          {draining ? 'Sending…' : 'Complete all at syndication'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

// Which timeline step(s) prove a pipeline stage actually executed. A stage the
// workflow branched past (e.g. rate/syndication when DECLINED) has no such event.
const STAGE_STEPS: Record<string, string[]> = {
  INTAKE: ['intake', 'partner-intake'],
  INCOME_VERIFICATION: ['income'],
  CROSS_REFERENCE: ['customer', 'credit', 'risk'],
  DECISION: ['decision'],
  RATE_ASSIGNED: ['rate'],
  SYNDICATION: ['syndication'],
  COMPLETED: ['outcome'],
};

type PipState = 'done' | 'now' | 'skipped' | 'pending';

// Classify each pipeline stage. With a timeline (detail view) we know exactly
// which stages ran, so a branched-past stage shows as 'skipped' rather than green.
// Without one (list rows), fall back to the linear fill, using `decision` to infer
// the DECLINED branch bypass when the app has completed.
function pipStates(status: string, timeline?: StepEvent[], decision?: string | null): PipState[] {
  const current = PIPELINE.indexOf(status);
  const ranStage = (stage: string): boolean | undefined =>
    timeline ? (STAGE_STEPS[stage] ?? []).some((step) => timeline.some((e) => e.step === step)) : undefined;
  return PIPELINE.map((stage, i) => {
    if (stage === status) return status === 'COMPLETED' ? 'done' : 'now';
    const reached = current === -1 ? ranStage(stage) === true : i < current;
    if (!reached) return 'pending';
    const ran = ranStage(stage);
    if (ran === false) return 'skipped';
    if (ran === undefined) {
      if (status === 'COMPLETED' && decision === 'DECLINED' && (stage === 'RATE_ASSIGNED' || stage === 'SYNDICATION')) {
        return 'skipped';
      }
      return 'done';
    }
    return 'done';
  });
}

function ProgressStrip({
  status,
  compact,
  timeline,
  decision,
}: {
  status: string;
  compact?: boolean;
  timeline?: StepEvent[];
  decision?: string | null;
}) {
  const states = pipStates(status, timeline, decision);
  return (
    <div className={`progress ${compact ? 'progress-compact' : ''}`}>
      {PIPELINE.map((s, i) => (
        <div
          key={s}
          className={`pip ${states[i]}`}
          title={states[i] === 'skipped' ? `${STATUS_LABEL[s]} — skipped (branch not taken)` : STATUS_LABEL[s]}
        >
          {compact ? '' : STATUS_LABEL[s]}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The main-panel running list: one compact row per application in the current
 * view, each with an inline progress strip. Stuck/retrying rows (and NEEDS_REVIEW)
 * are highlighted. Clicking a row opens/focuses that app's detail tab.
 */
export function RunningList({
  items,
  stuckIds,
  onOpen,
}: {
  items: AppListItem[];
  stuckIds: Set<string>;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="muted list-empty">No applications in this view — create one on the left, or burst a batch.</p>;
  }
  return (
    <div className="run-list">
      {items.map((it) => {
        const stuck = stuckIds.has(it.id) || it.status === 'NEEDS_REVIEW';
        const label = it.status ? (STATUS_LABEL[it.status] ?? it.status) : (it.executionStatus ?? '—');
        return (
          <button key={it.workflowId} className={`run-row ${stuck ? 'stuck' : ''}`} onClick={() => onOpen(it.id)}>
            <span className="mono run-id">{it.id}</span>
            <span className="run-applicant">{it.applicant ?? (it.channel === 'PARTNER_QUEUE' ? '(partner)' : '—')}</span>
            <ProgressStrip status={it.status ?? ''} compact decision={it.decision} />
            <span className={`run-status ${stuck ? 'warn' : ''}`}>
              {stuck ? '⚠ ' : ''}
              {label}
            </span>
            <span className={`chip chip-${it.channel ?? 'NA'}`}>{it.channel === 'PARTNER_QUEUE' ? 'partner' : 'specialist'}</span>
          </button>
        );
      })}
    </div>
  );
}

// The pipeline stages shown as header segments (Needs attention is appended).
const HEADER_STAGES = [
  'INTAKE',
  'INCOME_VERIFICATION',
  'CROSS_REFERENCE',
  'DECISION',
  'RATE_ASSIGNED',
  'SYNDICATION',
  'COMPLETED',
] as const;

/**
 * Dynamic status header: one segment per pipeline stage (+ Completed + Needs
 * attention), each with a live count. Clicking a segment filters the list;
 * clicking the active one clears back to the default (in-flight + stuck) view.
 */
export function StatusHeader({
  counts,
  needsAttention,
  active,
  onSelect,
}: {
  counts: StatusCounts;
  needsAttention: number;
  active: string;
  onSelect: (filter: string) => void;
}) {
  const seg = (key: string, label: string, n: number, cls = '') => (
    <button
      key={key}
      className={`seg ${cls} ${active === key ? 'active' : ''} ${n === 0 ? 'empty' : ''}`}
      disabled={n === 0 && active !== key}
      onClick={() => onSelect(active === key ? '' : key)}
    >
      <span className="seg-label">{label}</span>
      <span className="seg-count">{n}</span>
    </button>
  );
  return (
    <div className="status-header">
      {HEADER_STAGES.map((s) => seg(s, STATUS_LABEL[s], counts[s] ?? 0))}
      {seg('NEEDS_ATTENTION', 'Needs attention', needsAttention, 'attn')}
    </div>
  );
}

/** Browser-style tab strip: the fixed 'Applications' home + one closable tab per open app. */
export function TabBar({
  tabs,
  active,
  onSelect,
  onClose,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div className="tab-bar">
      {tabs.map((t) => (
        <div key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => onSelect(t.id)}>
          <span>{t.label}</span>
          {t.id !== 'applications' && (
            <button
              className="tab-x"
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

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

      <ProgressStrip status={state.status} timeline={state.timeline} decision={state.decision} />

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

/**
 * Ambient header status/controls: the live serverless-worker count (the
 * scale-to-zero headline, doubling as the AWS Lambda console link) and a compact
 * fault toggle. Sits in the top header so the left sidebar is the specialist's.
 */
export function HeaderStatus({
  fleet,
  faultOn,
  onToggleFault,
}: {
  fleet: Fleet;
  faultOn: boolean;
  onToggleFault: (on: boolean) => void;
}) {
  return (
    <div className="header-status">
      <a
        className="worker-pill"
        href="https://us-east-1.console.aws.amazon.com/lambda/home?region=us-east-1#/functions"
        target="_blank"
        rel="noreferrer"
        title={`${fleet.workersRunning} serverless worker invocation(s) polling now · one worker Lambda, scales to zero · orchestrating ${fleet.businessLambdas} business Lambdas — open the AWS console`}
      >
        <span className={fleet.workersRunning ? 'worker-dot live' : 'worker-dot'} />
        <b>{fleet.workersRunning}</b> worker{fleet.workersRunning === 1 ? '' : 's'} · scale-to-zero ↗
      </a>
      <button
        className={`fault-pill ${faultOn ? 'on' : ''}`}
        onClick={() => onToggleFault(!faultOn)}
        title="Toggle the syndication-partner schema fault"
      >
        ⚡ {faultOn ? 'Fault injected' : 'Healthy'}
      </button>
    </div>
  );
}

