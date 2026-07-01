import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { LAMBDA, SEARCH_ATTR, TASK_QUEUE, workflowIdFor, type Channel, type CreateApplicationInput, type IncomeDocType } from '@bmo/shared';
// Type-only: arg/return typing without loading the workflow implementation here.
import type { mortgageApplicationWorkflow } from '@bmo/workflows';
// Runtime Query/Signal/Update definitions (safe to import outside a workflow).
import { editApplication, getApplication, lenderCallback, partnerIntake } from '@bmo/workflows/dist/definitions';
import { getClient } from './temporal';

const WORKFLOW_TYPE = 'mortgageApplicationWorkflow';
const APP_ID_PREFIX = 'mortgage-app-';
const WORKER_CONTROL_URL = process.env.WORKER_CONTROL_URL ?? 'http://localhost:8088';

interface PendingActivity {
  activityType?: string;
  attempt: number;
  lastFailure?: string;
}

// Surface retrying/stuck activities from the describe() raw proto. When the
// syndication fault is on, the activity keeps failing and `attempt` climbs with a
// `lastFailure` — that's how the Triage view spots a stuck application.
async function pendingActivitiesFor(handle: {
  describe: () => Promise<{ raw: unknown }>;
}): Promise<PendingActivity[]> {
  try {
    const desc = await handle.describe();
    const raw = desc.raw as {
      pendingActivities?: Array<{
        activityType?: { name?: string };
        attempt?: number;
        lastFailure?: { message?: string };
      }>;
    };
    return (raw.pendingActivities ?? []).map((p) => ({
      activityType: p.activityType?.name,
      attempt: p.attempt ?? 1,
      lastFailure: p.lastFailure?.message,
    }));
  } catch {
    return [];
  }
}

const idFromWorkflowId = (workflowId: string): string =>
  workflowId.startsWith(APP_ID_PREFIX) ? workflowId.slice(APP_ID_PREFIX.length) : workflowId;

// The actual workflow source, served verbatim for the code-reveal beat (SPEC §5 view 5).
const WORKFLOW_SOURCE_PATH = path.join(
  path.dirname(require.resolve('@bmo/workflows/package.json')),
  'src',
  'mortgage-application.ts',
);

// Names for burst/presenter mode so the fleet looks realistic.
const BURST_NAMES = [
  'Amara Okafor', 'Liam Tremblay', 'Sofia Rossi', 'Noah Patel', 'Mei Lin', 'Diego Fernández',
  'Hannah Schmidt', 'Yuki Tanaka', 'Omar Haddad', 'Chloe Dubois', 'Raj Gupta', 'Elena Petrova',
];

interface CreateBody {
  id?: string;
  name?: string;
  phone?: string;
  email?: string;
  incomeDocType?: IncomeDocType;
  source?: string;
}

function buildInput(id: string, b: CreateBody, channel: Channel): CreateApplicationInput {
  return {
    id,
    applicant: b.name?.trim() || 'Jane Q. Borrower',
    contact: { phone: b.phone, email: b.email },
    channel,
    incomeDocType: b.incomeDocType ?? 'T4',
  };
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

async function main(): Promise<void> {
  await app.register(cors, { origin: true });

  // In the container (EKS), the API also serves the built UI so it's a single
  // demo-app image (SPEC §5). Set UI_DIST to the UI build dir; in local dev the
  // Vite server serves the UI and proxies /api, so this stays unset.
  const uiDist = process.env.UI_DIST;
  if (uiDist) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: uiDist, prefix: '/' });
    // SPA fallback: non-/api routes serve index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        reply.code(404).send({ error: 'not found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  app.get('/api/health', async () => ({ ok: true }));

  // Specialist console: create a new application (SPECIALIST channel).
  app.post('/api/applications', async (req) => {
    const b = (req.body ?? {}) as CreateBody;
    const client = await getClient();
    const id = b.id ?? randomUUID().slice(0, 8);
    const handle = await client.workflow.start<typeof mortgageApplicationWorkflow>(WORKFLOW_TYPE, {
      workflowId: workflowIdFor(id),
      taskQueue: TASK_QUEUE,
      args: [buildInput(id, b, 'SPECIALIST')],
    });
    return { id, workflowId: handle.workflowId, channel: 'SPECIALIST' };
  });

  // Partner sales channel: idempotent signal-based intake (the "hub", SPEC §4.5).
  app.post('/api/applications/partner', async (req) => {
    const b = (req.body ?? {}) as CreateBody;
    const client = await getClient();
    const id = b.id ?? randomUUID().slice(0, 8);
    const handle = await client.workflow.signalWithStart<typeof mortgageApplicationWorkflow, [{ source: string }]>(WORKFLOW_TYPE, {
      workflowId: workflowIdFor(id),
      taskQueue: TASK_QUEUE,
      args: [buildInput(id, b, 'PARTNER_QUEUE')],
      signal: partnerIntake,
      signalArgs: [{ source: b.source ?? 'partner-sales-channel' }],
    });
    return { id, workflowId: handle.workflowId, channel: 'PARTNER_QUEUE' };
  });

  // Burst / presenter mode: start N applications at once for the scale story.
  app.post('/api/burst', async (req) => {
    const count = Math.max(1, Math.min(200, Number((req.body as { count?: number })?.count ?? 25)));
    const client = await getClient();
    const ids = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const id = randomUUID().slice(0, 8);
        const name = `${BURST_NAMES[i % BURST_NAMES.length]} ${i + 1}`;
        await client.workflow.start<typeof mortgageApplicationWorkflow>(WORKFLOW_TYPE, {
          workflowId: workflowIdFor(id),
          taskQueue: TASK_QUEUE,
          args: [buildInput(id, { name, incomeDocType: i % 3 === 0 ? 'GIG' : 'T4' }, 'SPECIALIST')],
        });
        return id;
      }),
    );
    return { started: ids.length };
  });

  // Code reveal: the actual workflow source for the skill-gap talk track.
  app.get('/api/source', async () => {
    const code = await readFile(WORKFLOW_SOURCE_PATH, 'utf8');
    return { path: 'packages/workflows/src/mortgage-application.ts', code };
  });

  // Fleet metrics via server-side count() — accurate at any scale (the list is
  // capped at 100, so panel counts must NOT be derived from it).
  app.get('/api/metrics', async () => {
    const client = await getClient();
    const base = `WorkflowType = '${WORKFLOW_TYPE}'`;
    const [running, completed] = await Promise.all([
      client.workflow.count(`${base} AND ExecutionStatus = 'Running'`),
      client.workflow.count(`${base} AND ExecutionStatus = 'Completed'`),
    ]);
    return { inFlight: running.count, completed: completed.count };
  });

  // Serverless fleet: how many worker Lambdas are polling right now (≈ distinct
  // recent pollers on the task queue → 0 at idle, N under burst), plus the static
  // architecture we orchestrate. Poller data comes from Temporal — no AWS SDK.
  const BUSINESS_LAMBDAS = Object.keys(LAMBDA).length; // the 7 mock BMO functions
  app.get('/api/fleet', async () => {
    try {
      const client = await getClient();
      const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
      const resp = await client.connection.workflowService.describeTaskQueue({
        namespace,
        taskQueue: { name: TASK_QUEUE },
        taskQueueType: 1, // TASK_QUEUE_TYPE_WORKFLOW
      });
      const identities = new Set((resp.pollers ?? []).map((p) => p.identity).filter(Boolean));
      return { workersRunning: identities.size, businessLambdas: BUSINESS_LAMBDAS, workerLambda: 1 };
    } catch {
      // Never break the panel — report zero live workers on any transient error.
      return { workersRunning: 0, businessLambdas: BUSINESS_LAMBDAS, workerLambda: 1 };
    }
  });

  // Bulk lender callback: drain every application parked at syndication so a
  // burst can flow to completion (the per-app callback is in the detail pane).
  app.post('/api/callback-all', async () => {
    const client = await getClient();
    const ids: string[] = [];
    for await (const wf of client.workflow.list({
      query: `WorkflowType = '${WORKFLOW_TYPE}' AND ${SEARCH_ATTR.STATUS} = 'SYNDICATION'`,
    })) {
      ids.push(wf.workflowId);
      if (ids.length >= 1000) break;
    }
    let sent = 0;
    const BATCH = 25;
    for (let i = 0; i < ids.length; i += BATCH) {
      await Promise.all(
        ids.slice(i, i + BATCH).map(async (workflowId) => {
          try {
            await client.workflow.getHandle(workflowId).signal(lenderCallback, { approved: true, reference: 'FUND-bulk' });
            sent += 1;
          } catch {
            /* skip individual failures */
          }
        }),
      );
    }
    return { sent };
  });

  // List applications, optionally filtered by the applicationStatus / channel
  // search attributes (SPEC §4.6). Enriched with app-level state via query.
  app.get('/api/applications', async (req) => {
    const q = req.query as { status?: string; channel?: string };
    let query = `WorkflowType = '${WORKFLOW_TYPE}'`;
    if (q.status) query += ` AND ${SEARCH_ATTR.STATUS} = '${q.status}'`;
    if (q.channel) query += ` AND ${SEARCH_ATTR.CHANNEL} = '${q.channel}'`;
    const client = await getClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executions: any[] = [];
    for await (const wf of client.workflow.list({ query })) {
      executions.push(wf);
      if (executions.length >= 100) break;
    }
    const enriched = await Promise.all(
      executions.map(async (wf) => {
        const id = idFromWorkflowId(wf.workflowId);
        const base = {
          id,
          workflowId: wf.workflowId,
          executionStatus: wf.status?.name ?? 'UNKNOWN',
          startTime: wf.startTime,
        };
        try {
          const state = await client.workflow.getHandle(wf.workflowId).query(getApplication);
          return {
            ...base,
            status: state.status,
            channel: state.channel,
            applicant: state.application.applicant,
            decision: state.decision,
          };
        } catch {
          return base;
        }
      }),
    );
    enriched.sort((a, b) => (b.startTime?.getTime?.() ?? 0) - (a.startTime?.getTime?.() ?? 0));
    return enriched;
  });

  // Full application state + observability timeline + any retrying activities.
  app.get('/api/applications/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const client = await getClient();
    const handle = client.workflow.getHandle(workflowIdFor(id));
    try {
      const state = await handle.query(getApplication);
      const pendingActivities = await pendingActivitiesFor(handle);
      return { ...state, pendingActivities };
    } catch (err) {
      reply.code(404);
      return { error: 'not found', detail: (err as Error).message };
    }
  });

  // Triage: applications currently stuck on a retrying activity (SPEC §5 view 4).
  app.get('/api/triage', async () => {
    const client = await getClient();
    const stuck: unknown[] = [];
    for await (const wf of client.workflow.list({
      query: `WorkflowType = '${WORKFLOW_TYPE}' AND ExecutionStatus = 'Running'`,
    })) {
      const handle = client.workflow.getHandle(wf.workflowId);
      const pending = await pendingActivitiesFor(handle);
      const retrying = pending.filter((p) => p.attempt > 1 || p.lastFailure);
      if (retrying.length === 0) continue;
      try {
        const state = await client.workflow.getHandle(wf.workflowId).query(getApplication);
        stuck.push({
          id: idFromWorkflowId(wf.workflowId),
          applicant: state.application.applicant,
          status: state.status,
          channel: state.channel,
          retrying,
          application: state.application,
        });
      } catch {
        /* skip apps we can't query */
      }
      if (stuck.length >= 50) break;
    }
    return stuck;
  });

  // Fault control plane (forwarded to the worker, which owns the in-process flag).
  app.get('/api/fault', async () => {
    const r = await fetch(`${WORKER_CONTROL_URL}/control/fault`);
    return r.json();
  });

  app.post('/api/fault', async (req) => {
    const r = await fetch(`${WORKER_CONTROL_URL}/control/fault`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });
    return r.json();
  });

  // Edit = Update with validator. Returns synchronous accept/reject for the UI.
  app.post('/api/applications/:id/edit', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { field: string; value: unknown };
    const client = await getClient();
    try {
      const state = await client.workflow
        .getHandle(workflowIdFor(id))
        .executeUpdate(editApplication, { args: [{ field: b.field, value: b.value }] });
      return { accepted: true, state };
    } catch (err) {
      const e = err as { message?: string; cause?: { message?: string } };
      return { accepted: false, reason: e.cause?.message ?? e.message };
    }
  });

  // Lender funding callback resumes syndication.
  app.post('/api/applications/:id/callback', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { approved?: boolean };
    const client = await getClient();
    await client.workflow
      .getHandle(workflowIdFor(id))
      .signal(lenderCallback, { approved: b.approved !== false, reference: `FUND-${id}` });
    return { ok: true };
  });

  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`API listening on :${port}`);
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
