import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { TASK_QUEUE, workflowIdFor, type Channel, type CreateApplicationInput, type IncomeDocType } from '@bmo/shared';
// Type-only: arg/return typing without loading the workflow implementation here.
import type { mortgageApplicationWorkflow } from '@bmo/workflows';
// Runtime Query/Signal/Update definitions (safe to import outside a workflow).
import { editApplication, getApplication, lenderCallback, partnerIntake } from '@bmo/workflows/dist/definitions';
import { getClient } from './temporal';

const WORKFLOW_TYPE = 'mortgageApplicationWorkflow';
const APP_ID_PREFIX = 'mortgage-app-';

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

  // List applications (enriched with app-level state via query — demo scale).
  app.get('/api/applications', async () => {
    const client = await getClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executions: any[] = [];
    for await (const wf of client.workflow.list({ query: `WorkflowType = '${WORKFLOW_TYPE}'` })) {
      executions.push(wf);
      if (executions.length >= 100) break;
    }
    const enriched = await Promise.all(
      executions.map(async (wf) => {
        const id = wf.workflowId.startsWith(APP_ID_PREFIX)
          ? wf.workflowId.slice(APP_ID_PREFIX.length)
          : wf.workflowId;
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

  // Full application state + observability timeline.
  app.get('/api/applications/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const client = await getClient();
    try {
      return await client.workflow.getHandle(workflowIdFor(id)).query(getApplication);
    } catch (err) {
      reply.code(404);
      return { error: 'not found', detail: (err as Error).message };
    }
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
