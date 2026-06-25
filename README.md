# BMO Mortgage Demo

Temporal orchestrating BMO's existing AWS Lambdas for a mortgage-application pipeline —
**TypeScript only**. See [CLAUDE.md](CLAUDE.md) for the contract and [SPEC.md](SPEC.md) for the
full design.

> **Status: M3 complete** (local happy path + driving layer + resilience). On top of M2, the demo now
> has **fault injection + recovery and a Triage-&-resolve view**: a UI toggle injects the syndication
> partner "schema break", Temporal retries the activity with backoff (state preserved), the stuck
> application surfaces in Triage with its failure reason / payload / event-history link, and clearing
> the fault lets the next retry succeed and the run resume. Cloud/serverless (M5) is not built yet.

## Layout (monorepo, npm workspaces)

| Package | What it is |
|---------|-----------|
| `packages/shared` | Status enum, types, constants, the Temporal-free `BusinessError`. Bundled into the workflow sandbox, so it must stay deterministic (no `process`/`Date`/`Math.random` at module load). |
| `packages/lambdas` | The 6 business Lambdas + customer lookup — **real, Temporal-free handlers** (intake, income, customer, credit, risk, rate, syndication). Includes the fault-injection control and demo decision override. |
| `packages/activities` | The `invoker` abstraction (local in-process \| cloud `@aws-sdk/client-lambda`) + the thin invoker activities. Translates `BusinessError` → `ApplicationFailure`. |
| `packages/workflows` | `mortgageApplicationWorkflow` (entity workflow) + the Query/Update/Signal definitions. |
| `packages/worker` | Long-lived `Worker.create()` local entrypoint (the swappable safety-net path; serverless `@temporalio/lambda-worker` entrypoint is M5). |
| `packages/api` | Fastify API wrapping the Temporal client — create / partner-intake / list / get (+ retrying activities) / edit / callback / triage / fault toggle. |
| `packages/ui` | Vite + React + TS dashboard: specialist console, app list, observability timeline + before/after toggle, edit, partner push, **Triage & resolve** (fault toggle + stuck apps). |
| `packages/client` | CLI to drive the demo from a terminal (alternative to the UI). |

## Local run

Prereqs: Node 20+, the `temporal` CLI. No serverless/AWS access needed locally.

```bash
npm install
npm run build                 # tsc -b across all packages

# terminal 1 — local Temporal cluster + UI at http://localhost:8233
npm run temporal:dev

# terminal 2 — long-lived worker (runs the Lambda handler code in-process)
npm run worker:local

# terminal 3 — API (Temporal client) at :8080
npm run api

# terminal 4 — UI (Vite dev server) at http://localhost:5173, proxies /api → :8080
npm run ui
```

Open **http://localhost:5173** and drive the demo from the UI: create an application, watch the
one-trace timeline, flip the before/after toggle, try editing `rate` after rate assignment (rejected),
push from the partner channel, and send the lender callback at syndication.

Terminal-only alternative (CLI, no API/UI):

```bash
npm run happy-path            # full application end-to-end
node packages/client/dist/cli.js create --name "Jane Borrower" --phone 416-555-0100
node packages/client/dist/cli.js get <appId>
node packages/client/dist/cli.js edit <appId> rate 9.99       # rejected once rate is assigned
node packages/client/dist/cli.js callback <appId>             # resume syndication
node packages/client/dist/cli.js partner-push --name "Partner Lead"
```

## Demo / dev controls (env vars on the worker)

| Var | Effect |
|-----|--------|
| `BMO_FORCE_DECISION` | `APPROVED` \| `CONDITIONAL` \| `DECLINED` — force the underwriting outcome for a predictable demo. |
| `BMO_SYNDICATION_FAULT` | `true` to start with the syndication schema break on (also toggled live from the Triage view via the API → worker control plane). |
| `CONTROL_PORT` | Worker control-plane port for the fault toggle (default 8088). |
| `WORKER_CONTROL_URL` | Where the API reaches the worker control plane (default `http://localhost:8088`). |
| `BMO_TRANSIENT_FAILURE_RATE` | `0..1` — inject random transient downstream failures so Temporal's retries are visible. |
| `WORKER_VERSIONING` | `true` to enable Worker Versioning (PINNED). Requires a current Worker Deployment Version. |
| `MAX_CONCURRENT_ACTIVITIES` | Caps activity concurrency to *simulate* a single Lambda (default 5). |
| `INVOKER_MODE` | `local` (default, in-process handlers) \| `cloud` (real Lambda invoke — M5). |
