import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { ApplicationDetail, ErrorBoundary, HeaderStatus, RunningList, SpecialistConsole, StatusHeader, TabBar } from './components';
import type { AppListItem, ApplicationState, Fleet, StatusCounts, TriageItem } from './types';

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
        // Drop each optimistic row once its real one surfaces (or after ~15s, a
        // safety net for a create that never appears).
        setPending((prev) => prev.filter((p) => !list.some((it) => it.id === p.id) && Date.now() - p.since < 15000));
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
  const needsAttention = triage.length + counts.NEEDS_REVIEW;
  // Optimistic rows only make sense in the default (in-flight) view; a stage/status
  // filter wouldn't match a just-created INTAKE app anyway.
  const pendingVisible = statusFilter === '' ? pending.filter((p) => !items.some((it) => it.id === p.id)) : [];
  const filtered =
    statusFilter === 'NEEDS_ATTENTION'
      ? items.filter((it) => stuckIds.has(it.id) || it.status === 'NEEDS_REVIEW')
      : items;
  const visibleItems = [...pendingVisible, ...filtered];
  const tabs = [{ id: 'applications', label: 'Applications' }, ...openTabs.map((id) => ({ id, label: names[id] ?? `#${id}` }))];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-bmo">BMO</span>
          <span className="brand-x">×</span>
          <span className="brand-capco">Capco</span>
          <span className="brand-x">×</span>
          <span className="brand-temporal">Temporal</span>
        </div>
        <div className="tagline">Mortgage pipeline — orchestrating BMO's existing AWS Lambdas</div>
        <HeaderStatus fleet={fleet} faultOn={faultOn} onToggleFault={toggleFault} />
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
                <StatusHeader counts={counts} needsAttention={needsAttention} active={statusFilter} onSelect={setStatusFilter} />
                <RunningList items={visibleItems} stuckIds={stuckIds} onOpen={openApp} temporalUiBase={temporalUiBase} />
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
