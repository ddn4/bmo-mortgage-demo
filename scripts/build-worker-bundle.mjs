// Pre-bundle the workflow code into a single file so the serverless worker has
// no webpack cost on cold start (CLAUDE.md). Output lands next to the compiled
// Lambda handler (packages/worker/dist/workflow-bundle.js) so
// `require.resolve('./workflow-bundle.js')` in worker.lambda.ts resolves it.
//
// Bundles from the workflow TS source via the SDK's swc-loader — the same entry
// the local worker uses (a re-export barrel trips webpack's export detection).
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleWorkflowCode } from '@temporalio/worker';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const workflowsDir = path.dirname(require.resolve('@bmo/workflows/package.json'));
const workflowsPath = path.join(workflowsDir, 'src', 'mortgage-application.ts');
const outPath = path.join(scriptDir, '..', 'packages', 'worker', 'dist', 'workflow-bundle.js');

const { code } = await bundleWorkflowCode({ workflowsPath });
await writeFile(outPath, code);
console.log(`[bundle] wrote ${outPath} (${(code.length / 1024).toFixed(0)} KB)`);
