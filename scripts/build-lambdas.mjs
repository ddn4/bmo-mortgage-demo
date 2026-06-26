// Bundle the seven business Lambda handlers into a single self-contained CJS file
// (inlining @bmo/shared) so each deployed function is a plain Node artifact with
// no workspace symlinks to resolve. SAM points each function's CodeUri at the
// output dir with Handler `lambda.<name>` (see infra/sam/template.yaml).
import * as esbuild from 'esbuild';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'infra', '.build', 'business');

await esbuild.build({
  entryPoints: { lambda: path.join(root, 'packages', 'lambdas', 'src', 'lambda.ts') },
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'info',
});

console.log(`[lambdas] bundled business handlers → ${path.join(outdir, 'lambda.js')}`);
