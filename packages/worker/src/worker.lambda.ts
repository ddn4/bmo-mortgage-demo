import { runWorker } from '@temporalio/lambda-worker';
import * as activities from '@bmo/activities';
import { DEFAULT_BUILD_ID, DEPLOYMENT_NAME, TASK_QUEUE } from '@bmo/shared';

/**
 * Serverless worker entrypoint — the CONFIRMED headline of the cloud demo
 * (SPEC §6). Invoked on demand by Temporal's Worker Controller Instance (WCI)
 * and scales to zero between bursts. This is the SWAPPABLE sibling of
 * worker.local.ts: identical workflow + activity code, only the entrypoint and
 * lifecycle differ. Never let serverless-only assumptions leak into the workflow.
 *
 * Workflows are PRE-BUNDLED at build time (scripts/build-worker-bundle.mjs writes
 * workflow-bundle.js next to this handler) so there is no webpack cost on cold
 * start (CLAUDE.md). The Temporal Cloud connection (address, namespace, API key)
 * is loaded by @temporalio/lambda-worker from temporal.toml in $LAMBDA_TASK_ROOT
 * or from environment variables — see infra/ and infra/temporal.toml.example.
 *
 * Worker Versioning is PINNED (the Serverless Workers default): deploymentName +
 * buildId identify the Worker Deployment Version, which must be mapped to this
 * function's *versioned* ARN and set current in Temporal Cloud (SPEC §8).
 */
const buildId = process.env.BMO_BUILD_ID ?? DEFAULT_BUILD_ID;

export const handler = runWorker({ deploymentName: DEPLOYMENT_NAME, buildId }, (config) => {
  config.workerOptions.taskQueue = TASK_QUEUE;
  // Pre-bundled at build time; packaged alongside this handler at the task root.
  config.workerOptions.workflowBundle = { codePath: require.resolve('./workflow-bundle.js') };
  config.workerOptions.activities = activities;
});
