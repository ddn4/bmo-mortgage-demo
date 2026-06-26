// Assemble the serverless worker Lambda artifact: the handler bundle + the
// pre-bundled workflows. @temporalio/* and @aws-sdk/* are kept EXTERNAL —
// @temporalio/* includes the native core-bridge (.node), which must be the LINUX
// binary at deploy time, and @aws-sdk/* is provided by the Node 20 Lambda runtime.
//
// IMPORTANT: this produces the JS layout only. The @temporalio/* node_modules
// (with the Linux core-bridge) must be supplied at package time via
// `sam build --use-container` or a Lambda layer — see infra/README.md. Run
// `npm run bundle:worker` first so workflow-bundle.js exists.
import * as esbuild from 'esbuild';
import { access, copyFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'infra', '.build', 'worker');
const bundle = path.join(root, 'packages', 'worker', 'dist', 'workflow-bundle.js');

await access(bundle).catch(() => {
  throw new Error('workflow-bundle.js missing — run `npm run bundle:worker` first');
});
await mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: { 'worker.lambda': path.join(root, 'packages', 'worker', 'src', 'worker.lambda.ts') },
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['@temporalio/*', '@aws-sdk/*'],
  logLevel: 'info',
});

await copyFile(bundle, path.join(outdir, 'workflow-bundle.js'));
console.log(`[worker-lambda] handler + workflow bundle → ${outdir}`);
console.log('[worker-lambda] NOTE: supply @temporalio/* (Linux core-bridge) at package time — see infra/README.md');
