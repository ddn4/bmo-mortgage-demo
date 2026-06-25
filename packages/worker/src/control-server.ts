import * as http from 'node:http';
import { setSyndicationFault, syndicationFaultEnabled } from '@bmo/lambdas';

/**
 * Minimal HTTP control plane co-located with the worker (SPEC §4.4). The
 * syndication fault flag lives in-memory in the worker process — that's where the
 * business Lambda handlers read it — so the API (a separate process) toggles it
 * here. In the cloud this becomes an SSM param the deployed Lambda reads; the
 * surface (GET/POST a boolean) stays the same.
 */
export function startControlServer(): void {
  const port = Number(process.env.CONTROL_PORT ?? 8088);
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url !== '/control/fault') {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (req.method === 'GET') {
      res.end(JSON.stringify({ syndicationFault: syndicationFaultEnabled() }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}') as { on?: boolean };
          setSyndicationFault(Boolean(parsed.on));
        } catch {
          /* ignore malformed body; just report current state */
        }
        res.end(JSON.stringify({ syndicationFault: syndicationFaultEnabled() }));
      });
      return;
    }
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'method not allowed' }));
  });
  server.listen(port, () => {
    console.log(`[worker] control plane on :${port} (GET/POST /control/fault)`);
  });
}
