import * as path from 'node:path';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from '@bmo/activities';
import { DEFAULT_BUILD_ID, DEPLOYMENT_NAME, TASK_QUEUE } from '@bmo/shared';

const BUILD_ID = process.env.BMO_BUILD_ID ?? DEFAULT_BUILD_ID;

/**
 * Bundle workflows from TypeScript SOURCE via the SDK's built-in swc-loader.
 * (Bundling the pre-compiled CJS barrel trips a webpack/CJS-interop quirk where
 * the worker can't see the workflow export — "no such function is exported".)
 * The deployed worker instead ships a pre-built `workflowBundle` (CLAUDE.md).
 */
const WORKFLOWS_ENTRY = path.join(
  path.dirname(require.resolve('@bmo/workflows/package.json')),
  'src',
  'mortgage-application.ts',
);

/**
 * Local / safety-net worker entrypoint (SPEC §6). A long-lived `Worker.create()`
 * running the SAME workflow + activity code as the serverless `@temporalio/lambda-worker`
 * entrypoint (M5). No serverless locally.
 *
 * For dev speed we bundle via `workflowsPath`; the deployed worker uses a
 * pre-built `workflowBundle` (CLAUDE.md / temporal-developer gotchas).
 */
async function run(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
  const connection = await NativeConnection.connect({ address });
  const useVersioning = process.env.WORKER_VERSIONING === 'true';

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_ENTRY,
    activities,
    // Cap concurrency to *simulate* a single Lambda so backlog / sync-match are
    // visible locally with modest load (mirrors the reference repo's localworker).
    maxConcurrentActivityTaskExecutions: Number(process.env.MAX_CONCURRENT_ACTIVITIES ?? '5'),
    ...(useVersioning
      ? {
          // PINNED is the Serverless Workers default — an in-flight application
          // completes on the build it started on. Enabled here only when asked,
          // since it requires a current Worker Deployment Version to be set.
          workerDeploymentOptions: {
            useWorkerVersioning: true,
            version: { deploymentName: DEPLOYMENT_NAME, buildId: BUILD_ID },
            defaultVersioningBehavior: 'PINNED' as const,
          },
        }
      : {}),
  });

  console.log(
    `[worker] polling '${TASK_QUEUE}' @ ${address} ` +
      `(ns=${namespace}, versioning=${useVersioning}, invoker=${process.env.INVOKER_MODE ?? 'local'})`,
  );
  await worker.run();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
