import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { ApplicationDetail, ErrorBoundary, HeaderStatus, RunningList, SpecialistConsole, StatusHeader, TabBar } from './components';
import type { AppListItem, ApplicationState, Fleet, StatusCounts, TriageItem } from './types';
import logoUrl from './assets/temporal-lockup.svg';

const EMPTY_COUNTS: StatusCounts = {
  INTAKE: 0,
  INCOME_VERIFICATION: 0,
  CROSS_REFERENCE: 0,
  DECISION: 0,
  RATE_ASSIGNED: 0,
  SYNDICATION: 0,
  COMPLETED: 0,
  NEEDS_REVIEW: 0,
};

// Business-Lambda invocations Temporal has orchestrated, derived from the live
// status distribution (no server call — computed from the same /api/status-counts
// the header already polls). Each status implies the cumulative number of
// business-Lambda calls made to reach it, per the workflow: intake(1) → income(1)
// → customer+credit+risk(3, parallel) → [decision: durable timer, no Lambda] →
// rate(1) → syndication(1) = 7 for a full happy-path run.
// Approximate by design: a DECLINED app really stops at 5 (counted as 7 here), and
// retries / the injected syndication fault add real invocations this model can't
// see. Labeled "orchestrated" — a Temporal-native derivation, no CloudWatch.
const INVOCATIONS_BY_STATUS: Record<keyof StatusCounts, number> = {
  INTAKE: 1,
  INCOME_VERIFICATION: 2,
  CROSS_REFERENCE: 5,
  DECISION: 5,
  RATE_ASSIGNED: 6,
  SYNDICATION: 7,
  NEEDS_REVIEW: 7,
  COMPLETED: 7,
};
const businessInvocations = (counts: StatusCounts): number =>
  (Object.keys(INVOCATIONS_BY_STATUS) as (keyof StatusCounts)[]).reduce(
    (sum, s) => sum + counts[s] * INVOCATIONS_BY_STATUS[s],
    0,
  );

// Optimistic row shown the instant an app is created/burst, before it surfaces in
// the eventually-consistent visibility list. `since` drives a safety-net expiry.
type PendingItem = AppListItem & { since: number };
const makePending = (id: string, applicant: string | undefined, channel: string): PendingItem => ({
  id,
  workflowId: `mortgage-app-${id}`,
  executionStatus: 'Running',
  status: 'INTAKE',
  channel,
  applicant,
  since: Date.now(),
});

export function App() {
  const [items, setItems] = useState<AppListItem[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]); // optimistic rows shown immediately on create/burst
  const [names, setNames] = useState<Record<string, string>>({}); // id → applicant, accumulated for tab labels
  const [counts, setCounts] = useState<StatusCounts>(EMPTY_COUNTS);
  const [statusFilter, setStatusFilter] = useState(''); // '' | <STATUS> | 'NEEDS_ATTENTION'
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('applications');
  const [detail, setDetail] = useState<ApplicationState | undefined>();
  const [triage, setTriage] = useState<TriageItem[]>([]);
  const [faultOn, setFaultOn] = useState(false);
  const [fleet, setFleet] = useState<Fleet>({ workersRunning: 0, businessLambdas: 7, workerLambda: 1 });
  const [source, setSource] = useState('');
  // Temporal-UI deep-link base (local dev UI vs Temporal Cloud UI), from /api/config.
  const [temporalUiBase, setTemporalUiBase] = useState('http://localhost:8233/namespaces/default/workflows');
  // Ids whose entrance animation has already played (so it plays exactly once).
  const seenIds = useRef<Set<string>>(new Set());

  // The "Needs attention" filter has no single status → fetch the default list
  // (which already includes retrying-SYNDICATION and NEEDS_REVIEW rows) and filter
  // client-side. Every other filter maps 1:1 to an applicationStatus.
  const listStatus = statusFilter === 'NEEDS_ATTENTION' ? '' : statusFilter;

  // Fetch everything in parallel; each rejects independently (allSettled) so one
  // slow/failing endpoint never wipes the others' state.
  const refreshList = useCallback(async () => {
    await Promise.allSettled([
      api.list(listStatus).then((list) => {
        setItems(list);
        // Remember names so an open tab keeps its label even after its row leaves
        // the current filter (e.g. once it completes).
        setNames((prev) => {
          const next = { ...prev };
          for (const it of list) if (it.applicant) next[it.id] = it.applicant;
          return next;
        });
        // Drop each optimistic row once its real one surfaces WITH a status (not
        // just present — a freshly-indexed row has no applicationStatus yet, so
        // handing off too early flips the row back to raw "Running"). ~15s expiry
        // is a safety net for a create that never appears.
        setPending((prev) => prev.filter((p) => !list.some((it) => it.id === p.id && it.status) && Date.now() - p.since < 15000));
      }),
      api.statusCounts().then(setCounts),
      api.triage().then(setTriage),
      api.getFault().then((f) => setFaultOn(f.syndicationFault)),
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

  const burst = useCallback(
    async (n: number) => {
      const res = await api.burst(n);
      setPending((p) => [...res.apps.map((a) => makePending(a.id, a.applicant, 'SPECIALIST')), ...p]);
      await refreshList();
    },
    [refreshList],
  );

  const callbackAll = useCallback(async () => {
    await api.callbackAll();
    await refreshList();
  }, [refreshList]);

  const toggleFault = useCallback(async (on: boolean) => {
    const res = await api.setFault(on);
    setFaultOn(res.syndicationFault);
  }, []);

  // Only the active application tab polls its (expensive) detail query — background
  // tabs don't, so we never spin up N serverless workers for N idle tabs.
  const refreshDetail = useCallback(async () => {
    if (activeTab === 'applications') return;
    try {
      setDetail(await api.get(activeTab));
    } catch {
      /* transient (e.g. a cold worker) — keep polling */
    }
  }, [activeTab]);

  // Poll the list every 2s.
  useEffect(() => {
    refreshList();
    const t = setInterval(refreshList, 2000);
    return () => clearInterval(t);
  }, [refreshList]);

  // Poll the active application every 1s.
  useEffect(() => {
    setDetail(undefined);
    refreshDetail();
    const t = setInterval(refreshDetail, 1000);
    return () => clearInterval(t);
  }, [refreshDetail]);

  // Fetch the workflow source + runtime config once.
  useEffect(() => {
    api.source().then((s) => setSource(s.code)).catch(() => undefined);
    api.config().then((c) => setTemporalUiBase(c.temporalUiBase)).catch(() => undefined);
  }, []);

  const stuckIds = new Set(triage.map((t) => t.id));
  // Optimistic rows only make sense in the default (in-flight) view; keep each until
  // its real row surfaces WITH a status (consistent with the reconcile above).
  const pendingVisible = statusFilter === '' ? pending.filter((p) => !items.some((it) => it.id === p.id && it.status)) : [];
  const pendingIds = new Set(pendingVisible.map((p) => p.id));
  const filtered =
    statusFilter === 'NEEDS_ATTENTION'
      ? items.filter((it) => stuckIds.has(it.id) || it.status === 'NEEDS_REVIEW')
      : // Hide a not-yet-statused real row while its optimistic row still covers it
        // (avoids a duplicate id / double-count during the hand-off).
        items.filter((it) => !pendingIds.has(it.id));
  const visibleItems = [...pendingVisible, ...filtered];

  // Intake→Syndication (+ Needs-review) counts derived LOCALLY from the visible list
  // in the default view, so they move in lockstep with the rows (no visibility lag,
  // no "one workflow in two states"). Completed stays server-side (eventually
  // consistent — acceptable). Filtered views show the full server distribution.
  const headerCounts: StatusCounts =
    statusFilter === ''
      ? (() => {
          const acc: StatusCounts = { ...EMPTY_COUNTS, COMPLETED: counts.COMPLETED };
          for (const it of visibleItems) {
            const s = (it.status ?? 'INTAKE') as keyof StatusCounts;
            if (s !== 'COMPLETED' && s in acc) acc[s] += 1;
          }
          return acc;
        })()
      : counts;
  const needsAttention = triage.length + headerCounts.NEEDS_REVIEW;

  // Animate each row's entrance exactly once — track ids already shown, so polls
  // (and reconciling optimistic → real rows) never re-trigger the animation.
  const seen = seenIds.current;
  const newIds = new Set(visibleItems.filter((it) => !seen.has(it.id)).map((it) => it.id));
  // Mark them seen after render so the entrance animation plays exactly once.
  useEffect(() => {
    for (const it of visibleItems) seenIds.current.add(it.id);
  });

  const tabs = [{ id: 'applications', label: 'Applications' }, ...openTabs.map((id) => ({ id, label: names[id] ?? `#${id}` }))];

  return (
    <div className="app">
      <header className="topbar">
        <img className="brand-logo" src={logoUrl} alt="Temporal" />
        <div className="brand-divider" />
        <div className="brand-product">
          <div className="brand-title">BMO Mortgage Pipeline</div>
          <div className="tagline">orchestrating BMO's existing AWS Lambdas</div>
        </div>
        <HeaderStatus fleet={fleet} lambdas={businessInvocations(counts)} faultOn={faultOn} onToggleFault={toggleFault} />
      </header>

      <main className="layout">
        <section className="col-left">
          <ErrorBoundary label="Specialist console">
            <SpecialistConsole
              onCreated={(app) => {
                // Show the row immediately (stay on the list); it reconciles with the
                // real one on the next poll.
                setPending((p) => [makePending(app.id, app.applicant, app.channel), ...p]);
                refreshList();
              }}
              onBurst={burst}
              onCallbackAll={callbackAll}
            />
          </ErrorBoundary>
        </section>

        <section className="col-right">
          <TabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} onClose={closeApp} />
          {activeTab === 'applications' ? (
            <ErrorBoundary label="Applications">
              <div className="card">
                <StatusHeader counts={headerCounts} needsAttention={needsAttention} active={statusFilter} onSelect={setStatusFilter} />
                <RunningList items={visibleItems} stuckIds={stuckIds} newIds={newIds} onOpen={openApp} temporalUiBase={temporalUiBase} />
              </div>
            </ErrorBoundary>
          ) : (
            <ErrorBoundary label="Application detail">
              {detail ? (
                <ApplicationDetail state={detail} code={source} temporalUiBase={temporalUiBase} onChanged={refreshDetail} />
              ) : (
                <div className="card placeholder">
                  <p>Loading live application state… (a serverless worker is spinning up to answer the query)</p>
                </div>
              )}
            </ErrorBoundary>
          )}
        </section>
      </main>
    </div>
  );
}
