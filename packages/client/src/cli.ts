import { randomUUID } from 'node:crypto';
import { Client, Connection } from '@temporalio/client';
import { TASK_QUEUE, workflowIdFor, type ApplicationState, type Channel, type CreateApplicationInput } from '@bmo/shared';
// Type-only: gives arg/return typing without loading the workflow implementation
// (which uses workflow-only APIs) into this plain Node process.
import type { mortgageApplicationWorkflow } from '@bmo/workflows';
// Runtime values for typed query/signal/update — the definitions module is safe
// to import anywhere (no workflow-only APIs). Deep path avoids pulling in the
// workflow implementation via the package index.
import { editApplication, getApplication, lenderCallback } from '@bmo/workflows/dist/definitions';

const WORKFLOW_TYPE = 'mortgageApplicationWorkflow';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function getClient(): Promise<Client> {
  const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233' });
  return new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'default' });
}

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function start(channel: Channel): Promise<string> {
  const client = await getClient();
  const id = flag('--id') ?? randomUUID().slice(0, 8);
  const input: CreateApplicationInput = {
    id,
    applicant: flag('--name') ?? 'Jane Q. Borrower',
    contact: { phone: flag('--phone'), email: flag('--email') },
    channel,
    incomeDocType: (flag('--income') as CreateApplicationInput['incomeDocType']) ?? 'T4',
  };
  const handle = await client.workflow.start<typeof mortgageApplicationWorkflow>(WORKFLOW_TYPE, {
    workflowId: workflowIdFor(id),
    taskQueue: TASK_QUEUE,
    args: [input],
  });
  console.log(`started ${handle.workflowId} (channel=${channel}, applicant="${input.applicant}")`);
  return id;
}

async function get(appId: string): Promise<void> {
  const client = await getClient();
  const state = await client.workflow.getHandle(workflowIdFor(appId)).query(getApplication);
  console.log(JSON.stringify(state, null, 2));
}

async function callback(appId: string, approved: boolean): Promise<void> {
  const client = await getClient();
  await client.workflow.getHandle(workflowIdFor(appId)).signal(lenderCallback, { approved, reference: `FUND-${appId}` });
  console.log(`sent lenderCallback(approved=${approved}) to ${appId}`);
}

async function edit(appId: string, field: string, value: string): Promise<void> {
  const client = await getClient();
  try {
    await client.workflow.getHandle(workflowIdFor(appId)).executeUpdate(editApplication, { args: [{ field, value }] });
    console.log(`edit ACCEPTED: ${field} = ${value}`);
  } catch (err) {
    // The validator's rejection reason is on the cause (an ApplicationFailure);
    // the top-level message is the generic "Workflow Update failed" wrapper.
    const e = err as { message?: string; cause?: { message?: string } };
    console.log(`edit REJECTED: ${e.cause?.message ?? e.message}`);
  }
}

/** Full end-to-end happy path used to verify the M1 slice. */
async function happyPath(): Promise<void> {
  const client = await getClient();
  const id = flag('--id') ?? randomUUID().slice(0, 8);
  const input: CreateApplicationInput = {
    id,
    applicant: flag('--name') ?? 'Avery Approved',
    contact: { phone: '416-555-0100' },
    channel: 'SPECIALIST',
    incomeDocType: 'T4',
  };
  const handle = await client.workflow.start<typeof mortgageApplicationWorkflow>(WORKFLOW_TYPE, {
    workflowId: workflowIdFor(id),
    taskQueue: TASK_QUEUE,
    args: [input],
  });
  console.log(`[happy-path] started ${handle.workflowId}`);

  let state: ApplicationState;
  for (;;) {
    state = await handle.query(getApplication);
    console.log(`  status=${state.status} decision=${state.decision ?? '-'}`);
    if (state.status === 'SYNDICATION' || state.status === 'COMPLETED' || state.status === 'NEEDS_REVIEW') break;
    await sleep(500);
  }
  if (state.status === 'SYNDICATION') {
    await handle.signal(lenderCallback, { approved: true, reference: `FUND-${id}` });
    console.log('[happy-path] sent lender funding callback');
  }

  const result = await handle.result();
  console.log('[happy-path] final state:');
  console.log(JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'create':
      await start('SPECIALIST');
      break;
    case 'partner-push':
      await start('PARTNER_QUEUE');
      break;
    case 'get':
      await get(process.argv[3]);
      break;
    case 'callback':
      await callback(process.argv[3], !process.argv.includes('--decline'));
      break;
    case 'edit':
      await edit(process.argv[3], process.argv[4], process.argv[5]);
      break;
    case 'happy-path':
      await happyPath();
      break;
    default:
      console.log(
        'usage: cli <create|partner-push|get <id>|callback <id> [--decline]|edit <id> <field> <value>|happy-path>\n' +
          '  create        [--name N] [--phone P] [--email E] [--income T4|GIG] [--id ID]\n' +
          '  partner-push  (same flags; intake via PARTNER_QUEUE channel)\n' +
          '  get <id>      print application state (getApplication query)\n' +
          '  callback <id> [--decline]   resume syndication (lenderCallback signal)\n' +
          '  edit <id> <field> <value>   editApplication update (try field "rate" after rate assignment)\n' +
          '  happy-path    run a full application end-to-end',
      );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
