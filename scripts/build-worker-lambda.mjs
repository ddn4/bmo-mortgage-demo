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
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
  // Output base name must be DOT-FREE: the Lambda Node runtime splits the handler
  // on the first dot (module='index', export='handler'). A 'worker.lambda.js' file
  // would resolve to module 'worker' and fail with Runtime.ImportModuleError.
  entryPoints: { index: path.join(root, 'packages', 'worker', 'src', 'worker.lambda.ts') },
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['@temporalio/*', '@aws-sdk/*'],
  logLevel: 'info',
});

await copyFile(bundle, path.join(outdir, 'workflow-bundle.js'));

// Emit a package.json declaring the @temporalio runtime deps that were kept
// EXTERNAL above (lambda-worker + activity; worker is pinned so its native
// core-bridge version is explicit). `sam build --use-container` runs `npm install`
// against this in a Linux container, fetching the linux-arm64 core-bridge.
// @aws-sdk/client-lambda is provided by the Lambda Node.js runtime, so it's omitted.
const require = createRequire(import.meta.url);
const sdkVersion = require('@temporalio/worker/package.json').version;
const workerPkg = {
  name: 'bmo-worker-lambda',
  version: '0.0.0',
  private: true,
  dependencies: {
    '@temporalio/lambda-worker': sdkVersion,
    '@temporalio/worker': sdkVersion,
    '@temporalio/activity': sdkVersion,
  },
};
await writeFile(path.join(outdir, 'package.json'), JSON.stringify(workerPkg, null, 2) + '\n');

console.log(`[worker-lambda] handler + workflow bundle + package.json → ${outdir}`);
console.log(`[worker-lambda] runtime deps pinned to @temporalio ${sdkVersion}; sam build --use-container installs the Linux core-bridge.`);
