import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { AppList, ApplicationDetail, CodeRevealPanel, ErrorBoundary, OperationsPanel, SpecialistConsole, TriagePanel } from './components';
import type { AppListItem, ApplicationState, Fleet, TriageItem } from './types';

export function App() {
  const [items, setItems] = useState<AppListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detail, setDetail] = useState<ApplicationState | undefined>();
  const [triage, setTriage] = useState<TriageItem[]>([]);
  const [faultOn, setFaultOn] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [source, setSource] = useState('');
  const [metrics, setMetrics] = useState({ inFlight: 0, completed: 0 });
  const [fleet, setFleet] = useState<Fleet>({ workersRunning: 0, businessLambdas: 7, workerLambda: 1 });

  // Fetch everything in parallel and set each piece as it resolves. The list
  // visibility query can be slow (cross-region), so it must NOT block the live
  // readouts (metrics/fleet). Each fetch rejects independently on error (kept via
  // allSettled) so one failing endpoint never wipes the others' state.
  const refreshList = useCallback(async () => {
    await Promise.allSettled([
      api.list(statusFilter).then(setItems),
      api.triage().then(setTriage),
      api.getFault().then((f) => setFaultOn(f.syndicationFault)),
      api.metrics().then(setMetrics),
      api.fleet().then(setFleet),
    ]);
  }, [statusFilter]);

  const burst = useCallback(async (n: number) => {
    await api.burst(n);
    await refreshList();
  }, [refreshList]);

  const callbackAll = useCallback(async () => {
    await api.callbackAll();
    await refreshList();
  }, [refreshList]);

  const toggleFault = useCallback(async (on: boolean) => {
    const res = await api.setFault(on);
    setFaultOn(res.syndicationFault);
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!selectedId) return;
    try {
      setDetail(await api.get(selectedId));
    } catch {
      /* ignore transient */
    }
  }, [selectedId]);

  // Poll the list every 2s and the selected application every 1s.
  useEffect(() => {
    refreshList();
    const t = setInterval(refreshList, 2000);
    return () => clearInterval(t);
  }, [refreshList]);

  useEffect(() => {
    setDetail(undefined);
    refreshDetail();
    const t = setInterval(refreshDetail, 1000);
    return () => clearInterval(t);
  }, [refreshDetail]);

  // Land on a populated view: select the newest application if none is chosen.
  useEffect(() => {
    if (!selectedId && items.length > 0) setSelectedId(items[0].id);
  }, [items, selectedId]);

  // Fetch the workflow source once for the code-reveal panel.
  useEffect(() => {
    api.source().then((s) => setSource(s.code)).catch(() => undefined);
  }, []);

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
      </header>

      <main className="layout">
        <section className="col-left">
          <ErrorBoundary label="Specialist console">
            <SpecialistConsole
              onCreated={(id) => {
                setSelectedId(id);
                refreshList();
              }}
            />
          </ErrorBoundary>
          <ErrorBoundary label="Operations">
            <OperationsPanel metrics={metrics} fleet={fleet} needsReview={triage.length} onBurst={burst} onCallbackAll={callbackAll} />
          </ErrorBoundary>
          <ErrorBoundary label="Applications">
            <AppList
              items={items}
              selectedId={selectedId}
              onSelect={setSelectedId}
              statusFilter={statusFilter}
              onStatusFilter={setStatusFilter}
            />
          </ErrorBoundary>
          <ErrorBoundary label="Triage">
            <TriagePanel faultOn={faultOn} onToggleFault={toggleFault} items={triage} onSelect={setSelectedId} />
          </ErrorBoundary>
        </section>

        <section className="col-right">
          <ErrorBoundary label="Application detail">
            {detail ? (
              <ApplicationDetail state={detail} onChanged={refreshDetail} />
            ) : (
              <div className="card placeholder">
                <p>
                  {selectedId
                    ? 'Loading live application state… (a serverless worker is spinning up to answer the query)'
                    : 'Select or create an application to see its one-trace timeline.'}
                </p>
              </div>
            )}
          </ErrorBoundary>
          <ErrorBoundary label="Workflow source">
            <CodeRevealPanel code={source} />
          </ErrorBoundary>
        </section>
      </main>
    </div>
  );
}
