import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { AppList, ApplicationDetail, SpecialistConsole } from './components';
import type { AppListItem, ApplicationState } from './types';

export function App() {
  const [items, setItems] = useState<AppListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detail, setDetail] = useState<ApplicationState | undefined>();

  const refreshList = useCallback(async () => {
    try {
      setItems(await api.list());
    } catch {
      /* API not up yet — keep polling */
    }
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
          <SpecialistConsole
            onCreated={(id) => {
              setSelectedId(id);
              refreshList();
            }}
          />
          <AppList items={items} selectedId={selectedId} onSelect={setSelectedId} />
        </section>

        <section className="col-right">
          {detail ? (
            <ApplicationDetail state={detail} onChanged={refreshDetail} />
          ) : (
            <div className="card placeholder">
              <p>Select or create an application to see its one-trace timeline.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
