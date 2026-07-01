# UI Status-Header Running List + Per-App Detail Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Temporal-UI-like observability off the main screen — main panel becomes a streamlined running list with a dynamic, clickable status-count header; per-app detail (facts w/ inline edit, before/after/code observability) opens in in-app tabs.

**Architecture:** Front-end restructure of `packages/ui` (tab state in `App.tsx`; new `TabBar`, `StatusHeader`, `RunningList`; revised `ApplicationDetail`; removed `AppList`/`TriagePanel`/`CodeRevealPanel`) plus two additive `packages/api` changes (a `/api/status-counts` endpoint and a default-list COMPLETED exclusion). No workflow/Temporal changes.

**Tech Stack:** Vite + React + TypeScript UI; Fastify + `@temporalio/client` API; `prism-react-renderer` for code highlighting.

## Global Constraints

- **TypeScript only.** No workflow/activity/Temporal changes in this plan.
- **No component test harness exists** in `packages/ui`; adding one is out of scope (YAGNI for the demo). Verification per task = `npm run build` (tsc across workspaces catches type/interface errors) + a targeted `npm run dev` manual check. Backend changes also verified by `npm run smoke` and a curl.
- **Reuse existing aesthetic/tokens** (Space Grotesk / IBM Plex Sans / IBM Plex Mono; teal→blue spine; amber frontier). No re-theme.
- **Exact copy:** rename the workflow deep-link label to `Open Workflow ↗`. Operations sub-line must not imply a single worker (distinguish N invocations from one worker Lambda).
- **Status values** (applicationStatus SA): `INTAKE, INCOME_VERIFICATION, CROSS_REFERENCE, DECISION, RATE_ASSIGNED, SYNDICATION, COMPLETED, NEEDS_REVIEW`.
- **Clear rule:** an app leaves the default list when `applicationStatus === 'COMPLETED'`. `NEEDS_REVIEW` and retrying apps stay.
- API facts: `client.workflow.count(query)` returns `{ count }`; `SEARCH_ATTR.STATUS` is the applicationStatus key; `WORKFLOW_TYPE = 'mortgageApplicationWorkflow'`; list is capped at 100.

---

## File Structure

- `packages/api/src/server.ts` — add `/api/status-counts`; default `/api/applications` excludes COMPLETED.
- `packages/ui/src/api.ts` — add `statusCounts()`.
- `packages/ui/src/types.ts` — add `StatusCounts`; extend `AppListItem` if needed (already has fields).
- `packages/ui/src/components.tsx` — revise `ApplicationDetail` (inline-edit facts; 3-way observability toggle w/ highlighted code; rename link); add `TabBar`, `StatusHeader`, `RunningList`, compact `ProgressStrip`; remove `AppList`, `TriagePanel`, `CodeRevealPanel`, `EditPanel`.
- `packages/ui/src/App.tsx` — tab state + layout; left rail (console + operations w/ fault toggle); remove AppList/Triage.
- `packages/ui/src/styles.css` — styles for tab bar, status header, compact rows/progress, inline edit, code container.
- `packages/ui/package.json` — add `prism-react-renderer`.

---

## Task 1: Backend — status-counts endpoint + default-list COMPLETED exclusion

**Files:**
- Modify: `packages/api/src/server.ts` (the `/api/applications` handler; add a new route)

**Interfaces:**
- Produces: `GET /api/status-counts` → `{ INTAKE:number, INCOME_VERIFICATION:number, CROSS_REFERENCE:number, DECISION:number, RATE_ASSIGNED:number, SYNDICATION:number, COMPLETED:number, NEEDS_REVIEW:number }`.
- Produces: `GET /api/applications` with no `status` param now excludes `applicationStatus = 'COMPLETED'`.

- [ ] **Step 1: Add the status-counts route.** Insert after the `/api/metrics` route. Use parallel counts per status, each excluding terminated:

```ts
  // Per-applicationStatus counts for the dynamic status header. Accurate at any
  // scale (count() is server-side; the list is capped at 100). Excludes
  // terminated executions to match the list view.
  const STATUS_VALUES = [
    'INTAKE', 'INCOME_VERIFICATION', 'CROSS_REFERENCE', 'DECISION',
    'RATE_ASSIGNED', 'SYNDICATION', 'COMPLETED', 'NEEDS_REVIEW',
  ] as const;
  app.get('/api/status-counts', async () => {
    const client = await getClient();
    const base = `WorkflowType = '${WORKFLOW_TYPE}' AND ExecutionStatus != 'Terminated'`;
    const pairs = await Promise.all(
      STATUS_VALUES.map(async (s) => {
        const { count } = await client.workflow.count(`${base} AND ${SEARCH_ATTR.STATUS} = '${s}'`);
        return [s, count] as const;
      }),
    );
    return Object.fromEntries(pairs) as Record<(typeof STATUS_VALUES)[number], number>;
  });
```

- [ ] **Step 2: Default-list excludes COMPLETED.** In the `/api/applications` handler, after the `if (q.status)` / `if (q.channel)` block, add an else-branch so the no-filter default drops completed apps:

```ts
    if (q.status) query += ` AND ${SEARCH_ATTR.STATUS} = '${q.status}'`;
    else query += ` AND ${SEARCH_ATTR.STATUS} != 'COMPLETED'`;
    if (q.channel) query += ` AND ${SEARCH_ATTR.CHANNEL} = '${q.channel}'`;
```

- [ ] **Step 3: Build.** Run: `npm run build`  · Expected: PASS (no type errors).

- [ ] **Step 4: Verify against a local dev stack.** In one terminal `npm run temporal:dev`; another `npm run dev`. Then:

Run: `curl -s localhost:8080/api/status-counts` · Expected: JSON object with the 8 status keys and numeric values.
Run: `curl -s localhost:8080/api/applications | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).every(a=>a.status!=='COMPLETED')))"` · Expected: `true` (no COMPLETED rows in the default list).

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/server.ts
git commit -m "feat(api): /api/status-counts + default app list excludes COMPLETED"
```

---

## Task 2: UI api/types — statusCounts client + type

**Files:**
- Modify: `packages/ui/src/types.ts`, `packages/ui/src/api.ts`

**Interfaces:**
- Produces: `StatusCounts` type; `api.statusCounts(): Promise<StatusCounts>`.

- [ ] **Step 1: Add the type** to `types.ts`:

```ts
export interface StatusCounts {
  INTAKE: number; INCOME_VERIFICATION: number; CROSS_REFERENCE: number; DECISION: number;
  RATE_ASSIGNED: number; SYNDICATION: number; COMPLETED: number; NEEDS_REVIEW: number;
}
```

- [ ] **Step 2: Add the client method** in `api.ts` (import `StatusCounts`), next to `metrics`:

```ts
  statusCounts: (): Promise<StatusCounts> => getJson<StatusCounts>('/api/status-counts'),
```

- [ ] **Step 3: Build.** Run: `npm run build` · Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add packages/ui/src/types.ts packages/ui/src/api.ts
git commit -m "feat(ui): statusCounts api client + type"
```

---

## Task 3: ApplicationDetail — inline-editable facts (replace EditPanel), rename deep link

**Files:**
- Modify: `packages/ui/src/components.tsx` (`ApplicationDetail`, remove `EditPanel`), `packages/ui/src/styles.css`

**Interfaces:**
- Consumes: `api.edit(id, field, value)` → `{ accepted, reason? }`; `ApplicationState.lockedFields`.
- Produces: `ApplicationDetail` renders an editable facts grid; no separate `EditPanel`.

- [ ] **Step 1: Add an `EditableFact` component** in `components.tsx` (above `ApplicationDetail`). It shows a value with a ✎ on hover; click → inline input; Enter/✓ saves via `api.edit`; Esc/✕ cancels; shows inline `✓ saved` or `✗ <reason>`. Locked fields still allow the attempt (that surfaces the validator rejection).

```tsx
function EditableFact({
  id, label, field, value, locked, numeric, onChanged,
}: {
  id: string; label: string; field: string; value: string;
  locked?: boolean; numeric?: boolean; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<{ accepted: boolean; reason?: string } | null>(null);

  const start = () => { setDraft(''); setResult(null); setEditing(true); };
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
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          />
          <button className="mini" onClick={save} title="Save">✓</button>
          <button className="mini" onClick={() => setEditing(false)} title="Cancel">✕</button>
        </span>
      ) : (
        <span className="fact-val" onClick={start} title="Click to edit">
          {value}{locked ? ' 🔒' : ''} <span className="fact-pencil">✎</span>
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
```

- [ ] **Step 2: Replace the facts grid + EditPanel usage** in `ApplicationDetail`. Swap the static `<div className="facts">…</div>` and the `<EditPanel .../>` line for a facts grid mixing editable + read-only facts:

```tsx
      <div className="facts">
        <EditableFact id={state.id} label="Applicant" field="applicant" value={a.applicant} onChanged={onChanged} />
        <div className="fact"><b>Income</b><span>{a.income ? `$${a.income.annual.toLocaleString()} (${a.income.docType})` : '—'}</span></div>
        <div className="fact"><b>Customer</b><span>{a.customerRef ?? '—'}</span></div>
        <EditableFact id={state.id} label="Credit" field="creditScore" numeric value={a.creditScore != null ? String(a.creditScore) : '—'} locked={state.lockedFields.includes('creditScore')} onChanged={onChanged} />
        <div className="fact"><b>Risk</b><span>{a.riskTier ?? '—'}{state.lockedFields.includes('riskTier') ? ' 🔒' : ''}</span></div>
        <EditableFact id={state.id} label="Rate" field="rate" numeric value={a.rate != null ? `${a.rate}%` : '—'} locked={state.lockedFields.includes('rate')} onChanged={onChanged} />
        <div className="fact"><b>Lender</b><span>{a.lenderPartner ?? '—'}</span></div>
      </div>
```

Then delete the `EditPanel` function and its `<EditPanel …/>` render, and the now-unused `lockMark` helper if no longer referenced.

- [ ] **Step 3: Rename the deep link.** In `ApplicationDetail`, change the link text `Open in Temporal UI ↗` → `Open Workflow ↗`.

- [ ] **Step 4: Styles.** Add to `styles.css` (reuse tokens): `.fact` layout, `.fact-val` hover reveals `.fact-pencil`, `.fact-edit` input+mini buttons, `.fact-ok` (teal), `.fact-rejected` (amber/red), `.fact-locked` subtle.

```css
.facts .fact { display: flex; flex-direction: column; gap: 2px; }
.fact-val { cursor: pointer; }
.fact-pencil { opacity: 0; font-size: 0.8em; }
.fact-val:hover .fact-pencil { opacity: 0.5; }
.fact-edit { display: inline-flex; gap: 4px; align-items: center; }
.fact-edit input { width: 8ch; }
button.mini { padding: 0 6px; }
.fact-ok { color: var(--teal, #38bdf8); font-size: 0.8em; }
.fact-rejected { color: #f59e0b; font-size: 0.8em; }
```

- [ ] **Step 5: Build + manual check.** Run: `npm run build` (PASS). Then `npm run dev`, create an app, edit `Applicant` → `✓ saved`; after rate assignment, edit `Rate` → `✗ …locked…`.

- [ ] **Step 6: Commit.**

```bash
git add packages/ui/src/components.tsx packages/ui/src/styles.css
git commit -m "feat(ui): inline-editable facts (replace Edit panel); rename to Open Workflow"
```

---

## Task 4: ApplicationDetail — 3-way observability toggle with syntax-highlighted code

**Files:**
- Modify: `packages/ui/src/components.tsx` (`ApplicationDetail`), `packages/ui/src/styles.css`, `packages/ui/package.json`

**Interfaces:**
- Consumes: `code: string` prop (workflow source, from `api.source()` — passed down from `App`).
- Produces: `ApplicationDetail` accepts a new `code` prop; observability view state is `'before' | 'after' | 'code'`.

- [ ] **Step 1: Add the dependency.** Run: `npm --workspace @bmo/ui install prism-react-renderer` · Expected: added to `packages/ui/package.json`.

- [ ] **Step 2: Import Highlight** at the top of `components.tsx`:

```tsx
import { Highlight, themes } from 'prism-react-renderer';
```

- [ ] **Step 3: Add a `CodeBlock` component**:

```tsx
function CodeBlock({ code }: { code: string }) {
  if (!code) return <div className="code muted mono">loading…</div>;
  return (
    <Highlight theme={themes.nightOwl} code={code} language="tsx">
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <pre className="code" style={style}>
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              <span className="code-ln">{i + 1}</span>
              {line.map((token, k) => <span key={k} {...getTokenProps({ token })} />)}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}
```

- [ ] **Step 4: Extend the toggle + body.** Change `ApplicationDetail`'s signature to accept `code`, its view state to `'after' | 'before' | 'code'`, add a third toggle button, and render `CodeBlock` for `code`:

```tsx
export function ApplicationDetail({ state, code, onChanged }: { state: ApplicationState; code: string; onChanged: () => void }) {
  const [view, setView] = useState<'after' | 'before' | 'code'>('after');
  // …existing head/facts…
```

```tsx
      <div className="view-toggle">
        <span>Observability:</span>
        <button className={view === 'before' ? 'active' : ''} onClick={() => setView('before')}>Before — siloed logs</button>
        <button className={view === 'after' ? 'active' : ''} onClick={() => setView('after')}>After — one timeline</button>
        <button className={view === 'code' ? 'active' : ''} onClick={() => setView('code')}>Workflow code</button>
      </div>
      {view === 'after' && <UnifiedTimeline timeline={state.timeline} />}
      {view === 'before' && <SiloedLogs timeline={state.timeline} />}
      {view === 'code' && <CodeBlock code={code} />}
```

- [ ] **Step 5: Styles.** Add `.code` overflow/scroll + `.code-ln` gutter (small, muted, right-aligned). Ensure `pre.code` uses the Prism theme `style` but constrains height (e.g., `max-height: 420px; overflow: auto`).

- [ ] **Step 6: Build.** Run: `npm run build` · Expected: PASS. (Note: `App` doesn't pass `code` yet — Task 6 wires it. If tsc errors on the missing prop where `ApplicationDetail` is currently rendered, temporarily pass `code=""` at the existing call site; Task 6 replaces that call site.)

- [ ] **Step 7: Commit.**

```bash
git add packages/ui/src/components.tsx packages/ui/src/styles.css packages/ui/package.json package-lock.json
git commit -m "feat(ui): syntax-highlighted Workflow code as a third observability toggle"
```

---

## Task 5: New components — compact ProgressStrip, RunningList, StatusHeader

**Files:**
- Modify: `packages/ui/src/components.tsx`, `packages/ui/src/styles.css`

**Interfaces:**
- Consumes: `AppListItem[]`, `StatusCounts`, triage `TriageItem[]` (for stuck ids).
- Produces:
  - `ProgressStrip({ status, compact? })` — existing, now with an optional `compact` boolean.
  - `RunningList({ items, stuckIds, onOpen })` — compact rows; amber highlight for stuck; empty state; row click → `onOpen(id)`.
  - `StatusHeader({ counts, needsAttention, active, onSelect })` — segments with counts; `onSelect(status | 'NEEDS_ATTENTION' | '')` toggles filter.

- [ ] **Step 1: Add a `compact` prop to `ProgressStrip`.** Keep current output when not compact; when compact, render smaller pips without stage labels (labels shown once under the list, or as row tooltip):

```tsx
function ProgressStrip({ status, compact }: { status: string; compact?: boolean }) {
  const current = PIPELINE.indexOf(status);
  return (
    <div className={`progress ${compact ? 'progress-compact' : ''}`}>
      {PIPELINE.map((s, i) => (
        <div key={s} className={`pip ${current >= i && current !== -1 ? 'done' : ''} ${s === status ? 'now' : ''}`}
             title={STATUS_LABEL[s]}>
          {compact ? '' : STATUS_LABEL[s]}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add `RunningList`.** One row per item; applicant or "(partner)"; compact strip; status label; channel chip; amber highlight when `stuckIds.has(id)` or `status==='NEEDS_REVIEW'`; empty state.

```tsx
export function RunningList({
  items, stuckIds, onOpen,
}: { items: AppListItem[]; stuckIds: Set<string>; onOpen: (id: string) => void }) {
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
            <ProgressStrip status={it.status ?? ''} compact />
            <span className={`run-status ${stuck ? 'warn' : ''}`}>{stuck ? '⚠ ' : ''}{label}</span>
            <span className={`chip chip-${it.channel ?? 'NA'}`}>{it.channel === 'PARTNER_QUEUE' ? 'partner' : 'specialist'}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Add `StatusHeader`.** Segments for the 7 stages + Completed + a "Needs attention" segment. `active` is the current filter (`''` = default). Clicking a segment calls `onSelect`; clicking the active one clears (`''`).

```tsx
const HEADER_STAGES = [
  'INTAKE', 'INCOME_VERIFICATION', 'CROSS_REFERENCE', 'DECISION', 'RATE_ASSIGNED', 'SYNDICATION', 'COMPLETED',
] as const;

export function StatusHeader({
  counts, needsAttention, active, onSelect,
}: {
  counts: StatusCounts; needsAttention: number; active: string;
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
```

- [ ] **Step 4: Styles.** `.status-header` (horizontal flex, wrap), `.seg` (label + count, active underline/teal, `.empty` dimmed, `.attn` amber accent), `.run-list`/`.run-row` (grid columns: id, applicant, progress, status, chip; hover; `.stuck` amber left-border), `.progress-compact .pip` smaller.

- [ ] **Step 5: Build.** Run: `npm run build` · Expected: PASS (components exported but not yet used — that's fine; if tsc flags unused, they're exported so it won't).

- [ ] **Step 6: Commit.**

```bash
git add packages/ui/src/components.tsx packages/ui/src/styles.css
git commit -m "feat(ui): RunningList, StatusHeader, compact ProgressStrip components"
```

---

## Task 6: App.tsx — tab shell, status filter, wire the Applications home tab

**Files:**
- Modify: `packages/ui/src/App.tsx`, `packages/ui/src/components.tsx` (add `TabBar`), `packages/ui/src/styles.css`

**Interfaces:**
- Consumes: `RunningList`, `StatusHeader`, `ApplicationDetail`, `api.statusCounts/list/get/triage/...`.
- Produces: `TabBar({ tabs, active, onSelect, onClose })`; App renders home (Applications) or a per-app detail tab.

- [ ] **Step 1: Add `TabBar`** to `components.tsx`:

```tsx
export function TabBar({
  tabs, active, onSelect, onClose,
}: {
  tabs: { id: string; label: string }[]; active: string;
  onSelect: (id: string) => void; onClose: (id: string) => void;
}) {
  return (
    <div className="tab-bar">
      {tabs.map((t) => (
        <div key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => onSelect(t.id)}>
          <span>{t.label}</span>
          {t.id !== 'applications' && (
            <button className="tab-x" title="Close" onClick={(e) => { e.stopPropagation(); onClose(t.id); }}>✕</button>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `App.tsx`** with tab + filter state. Key changes: replace `selectedId` with `openTabs`/`activeTab`; add `counts` + `statusFilter`; poll status-counts in `refreshList`; poll detail only when a per-app tab is active; render `TabBar` + (home: `StatusHeader`+`RunningList`) or (`ApplicationDetail`). Left rail: `SpecialistConsole` + `OperationsPanel` (Task 7 adds the fault toggle there). Remove `AppList` + `TriagePanel` renders. Compute `stuckIds` from `triage`; `needsAttention = triage.length + counts.NEEDS_REVIEW`.

```tsx
export function App() {
  const [items, setItems] = useState<AppListItem[]>([]);
  const [counts, setCounts] = useState<StatusCounts>({ INTAKE:0, INCOME_VERIFICATION:0, CROSS_REFERENCE:0, DECISION:0, RATE_ASSIGNED:0, SYNDICATION:0, COMPLETED:0, NEEDS_REVIEW:0 });
  const [statusFilter, setStatusFilter] = useState(''); // '' | <STATUS> | 'NEEDS_ATTENTION'
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('applications');
  const [detail, setDetail] = useState<ApplicationState | undefined>();
  const [triage, setTriage] = useState<TriageItem[]>([]);
  const [faultOn, setFaultOn] = useState(false);
  const [metrics, setMetrics] = useState({ inFlight: 0, completed: 0 });
  const [fleet, setFleet] = useState<Fleet>({ workersRunning: 0, businessLambdas: 7, workerLambda: 1 });
  const [source, setSource] = useState('');

  // The list fetch: NEEDS_ATTENTION has no single status → fetch default and filter client-side.
  const listStatus = statusFilter === 'NEEDS_ATTENTION' ? '' : statusFilter;
  const refreshList = useCallback(async () => {
    await Promise.allSettled([
      api.list(listStatus).then(setItems),
      api.statusCounts().then(setCounts),
      api.triage().then(setTriage),
      api.getFault().then((f) => setFaultOn(f.syndicationFault)),
      api.metrics().then(setMetrics),
      api.fleet().then(setFleet),
    ]);
  }, [listStatus]);

  const openApp = useCallback((id: string) => {
    setOpenTabs((t) => (t.includes(id) ? t : [...t, id]));
    setActiveTab(id);
  }, []);
  const closeApp = useCallback((id: string) => {
    setOpenTabs((t) => t.filter((x) => x !== id));
    setActiveTab((a) => (a === id ? 'applications' : a));
  }, []);

  const refreshDetail = useCallback(async () => {
    if (activeTab === 'applications') return;
    try { setDetail(await api.get(activeTab)); } catch { /* transient */ }
  }, [activeTab]);

  useEffect(() => { refreshList(); const t = setInterval(refreshList, 2000); return () => clearInterval(t); }, [refreshList]);
  useEffect(() => { setDetail(undefined); refreshDetail(); const t = setInterval(refreshDetail, 1000); return () => clearInterval(t); }, [refreshDetail]);
  useEffect(() => { api.source().then((s) => setSource(s.code)).catch(() => undefined); }, []);

  const stuckIds = new Set(triage.map((t) => t.id));
  const needsAttention = triage.length + counts.NEEDS_REVIEW;
  const visibleItems = statusFilter === 'NEEDS_ATTENTION'
    ? items.filter((it) => stuckIds.has(it.id) || it.status === 'NEEDS_REVIEW')
    : items;
  const tabs = [{ id: 'applications', label: 'Applications' }, ...openTabs.map((id) => ({ id, label: `#${id}` }))];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-bmo">BMO</span><span className="brand-x">×</span>
          <span className="brand-capco">Capco</span><span className="brand-x">×</span>
          <span className="brand-temporal">Temporal</span>
        </div>
        <div className="tagline">Mortgage pipeline — orchestrating BMO's existing AWS Lambdas</div>
      </header>
      <main className="layout">
        <section className="col-left">
          <ErrorBoundary label="Specialist console">
            <SpecialistConsole onCreated={(id) => { openApp(id); refreshList(); }} />
          </ErrorBoundary>
          <ErrorBoundary label="Operations">
            <OperationsPanel metrics={metrics} fleet={fleet} needsReview={needsAttention}
              faultOn={faultOn} onToggleFault={toggleFault}
              onBurst={burst} onCallbackAll={callbackAll} />
          </ErrorBoundary>
        </section>
        <section className="col-right">
          <TabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} onClose={closeApp} />
          {activeTab === 'applications' ? (
            <ErrorBoundary label="Applications">
              <StatusHeader counts={counts} needsAttention={needsAttention} active={statusFilter} onSelect={setStatusFilter} />
              <RunningList items={visibleItems} stuckIds={stuckIds} onOpen={openApp} />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary label="Application detail">
              {detail ? (
                <ApplicationDetail state={detail} code={source} onChanged={refreshDetail} />
              ) : (
                <div className="card placeholder"><p>Loading live application state… (a serverless worker is spinning up to answer the query)</p></div>
              )}
            </ErrorBoundary>
          )}
        </section>
      </main>
    </div>
  );
}
```

(Keep the existing `burst`, `callbackAll`, `toggleFault` `useCallback`s from the current file — they're unchanged. Update imports: add `TabBar`, `StatusHeader`, `RunningList`, `StatusCounts`; drop `AppList`, `TriagePanel`.)

- [ ] **Step 3: Styles.** `.tab-bar` (row of tabs, active underline/teal, `.tab-x` hover), and adjust `.col-right` to stack the tab bar above content.

- [ ] **Step 4: Build.** Run: `npm run build` · Expected: PASS. Fix any import/prop mismatches (e.g., `OperationsPanel` fault props land in Task 7 — if tsc errors now, temporarily omit `faultOn/onToggleFault` from the render and add in Task 7, or do Task 7 before building).

- [ ] **Step 5: Manual check.** `npm run dev`: create → row in Applications with advancing progress + header counts; click row → detail tab opens; close tab → back to Applications; click Completed segment → completed apps; click again → clears.

- [ ] **Step 6: Commit.**

```bash
git add packages/ui/src/App.tsx packages/ui/src/components.tsx packages/ui/src/styles.css
git commit -m "feat(ui): tabbed shell + status-header running list; remove left AppList"
```

---

## Task 7: Left rail cleanup — Operations copy fix + fault toggle; remove TriagePanel/CodeReveal

**Files:**
- Modify: `packages/ui/src/components.tsx` (`OperationsPanel`; remove `TriagePanel`, `CodeRevealPanel`), `packages/ui/src/styles.css`

**Interfaces:**
- Produces: `OperationsPanel` gains `faultOn: boolean` + `onToggleFault: (on:boolean)=>void`; renders the Inject/Clear fault control and corrected fleet copy.

- [ ] **Step 1: Extend `OperationsPanel` props + render.** Add `faultOn`/`onToggleFault` to the props type. Fix the fleet sub-line and add the fault control:

```tsx
        <small className="muted">
          {fleet.workersRunning} running now · one serverless worker Lambda, scaling to zero · orchestrating {fleet.businessLambdas} business Lambdas
        </small>
```

```tsx
      <div className="row fault-row">
        <span>Syndication partner schema:</span>
        <button className={faultOn ? 'danger' : ''} onClick={() => onToggleFault(!faultOn)}>
          {faultOn ? 'Clear fault' : 'Inject fault'}
        </button>
        <span className={faultOn ? 'fault-on' : 'fault-off'}>{faultOn ? 'BROKEN — retrying' : 'healthy'}</span>
      </div>
```

- [ ] **Step 2: Remove dead components.** Delete `TriagePanel` and `CodeRevealPanel` functions from `components.tsx` (and any leftover imports/usages). Keep `PIPELINE`, `STATUS_LABEL`, `STEP_SILO`, `StatusBadge`, `SiloedLogs`, `UnifiedTimeline` (still used).

- [ ] **Step 3: Build.** Run: `npm run build` · Expected: PASS (no unused/undefined symbols).

- [ ] **Step 4: Manual check.** `npm run dev`: Operations shows corrected copy + a live worker count; Inject fault → an in-flight syndication app row highlights amber, "Needs attention" count rises and filters; Clear fault → resumes and clears at COMPLETED.

- [ ] **Step 5: Commit.**

```bash
git add packages/ui/src/components.tsx packages/ui/src/styles.css
git commit -m "feat(ui): fault toggle in Operations + fix fleet copy; remove Triage/Code panels"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck/build.** Run: `npm run build` · Expected: PASS.
- [ ] **Step 2: Backend smoke.** With `npm run temporal:dev` running: `npm run smoke` · Expected: SMOKE PASS.
- [ ] **Step 3: End-to-end manual (dev).** `npm run dev`; walk the run-of-show: create → progress + counts → open detail tab → Before/After/Workflow-code → inline edit (saved / locked-reject) → callback → row clears, Completed +1, visible under Completed filter → inject fault → Needs attention filter → clear → resumes.
- [ ] **Step 4: Commit any final tweaks** discovered during verification (if none, skip).

---

## Self-Review Notes

- **Spec coverage:** header bar+counts (T1,T2,T5,T6); running list + clear-at-COMPLETED (T1,T5,T6); detail tabs (T6); inline edit (T3); 3-way code toggle + highlighting (T4); Operations copy + fault relocation, Triage removal (T7); AppList removal + link rename (T3,T6). All spec sections mapped.
- **Placeholders:** none — code shown for each change.
- **Type consistency:** `StatusCounts` keys identical across T1/T2/T5/T6; `ApplicationDetail` gains `code` (T4) and is called with `code={source}` (T6); `OperationsPanel` fault props added T7 and passed T6 (note the build-order caveat in T6 Step 4).
