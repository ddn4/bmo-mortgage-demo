# BMO Mortgage Demo

Temporal orchestrating BMO's existing AWS Lambdas for a mortgage-application pipeline —
**TypeScript only**. See [CLAUDE.md](CLAUDE.md) for the contract and [SPEC.md](SPEC.md) for the
full design.

> **Status: M4 complete** (full local demo). On top of M3's resilience story, the demo now has the
> **scale, cost, and skill-gap beats**: **burst/presenter mode** (start N applications at once), an
> **Operations & cost** panel (live in-flight/completed/needs-review counts + an illustrative
> always-warm-vs-serverless cost comparison), a **code-reveal** panel showing the actual workflow
> source, and **custom Search Attributes** (`applicationStatus`, `channel`) that power list filtering
> in both this UI and the Temporal UI. The cloud/serverless phase (M5) is not built yet.

## Layout (monorepo, npm workspaces)

| Package | What it is |
|---------|-----------|
| `packages/shared` | Status enum, types, constants, the Temporal-free `BusinessError`. Bundled into the workflow sandbox, so it must stay deterministic (no `process`/`Date`/`Math.random` at module load). |
| `packages/lambdas` | The 6 business Lambdas + customer lookup — **real, Temporal-free handlers** (intake, income, customer, credit, risk, rate, syndication). Includes the fault-injection control and demo decision override. |
| `packages/activities` | The `invoker` abstraction (local in-process \| cloud `@aws-sdk/client-lambda`) + the thin invoker activities. Translates `BusinessError` → `ApplicationFailure`. |
| `packages/workflows` | `mortgageApplicationWorkflow` (entity workflow) + the Query/Update/Signal definitions. |
| `packages/worker` | Long-lived `Worker.create()` local entrypoint (the swappable safety-net path; serverless `@temporalio/lambda-worker` entrypoint is M5). |
| `packages/api` | Fastify API wrapping the Temporal client — create / partner-intake / burst / list (SA-filterable) / get (+ retrying activities) / edit / callback / triage / fault toggle / workflow source. |
| `packages/ui` | Vite + React + TS dashboard: specialist console, app list (+ status filter), observability timeline + before/after toggle, edit, partner push, **Triage & resolve**, **Operations & cost**, burst mode, and **code-reveal**. |
| `packages/client` | CLI to drive the demo from a terminal (alternative to the UI). |

## Local run

Prereqs: Node 20+, the `temporal` CLI. No serverless/AWS access needed locally.

```bash
npm install

# terminal 1 — local Temporal cluster + UI at http://localhost:8233
npm run temporal:dev

# terminal 2 — build, then run worker + API + UI together
npm run dev
```

`npm run dev` builds the packages and starts the worker (`:8088` control plane), the API
(`:8080`), and the Vite UI (`http://localhost:5173`) together. Prefer separate terminals? Run
`npm run worker:local`, `npm run api`, and `npm run ui` individually.

The default dev server is in-memory (state is lost on restart). To keep applications across
restarts, use `npm run temporal:dev:persist`, which adds a SQLite store at `.temporal/dev.db`
(gitignored). Note: a persisted history can surface non-determinism errors after a workflow code
change — delete `.temporal/dev.db` to reset.

Run the committed smoke test (with `npm run temporal:dev` running) to exercise the core flows
end-to-end — happy path, field-locking, and fault-injection recovery:

```bash
npm run smoke
```

Presenting it? **[DEMO.md](DEMO.md)** is the click-by-click script (pre-flight, beats, talk track).

Open **http://localhost:5173** and drive the demo from the UI: create an application, watch the
one-trace timeline, flip the before/after toggle, try editing `rate` after rate assignment (rejected),
push from the partner channel, send the lender callback at syndication, **burst N applications** for the
scale/cost story, filter the list by status, and reveal the workflow source. The worker registers the
custom Search Attributes automatically on boot (local dev server).

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
| `BMO_STEP_MIN_MS` / `BMO_STEP_MAX_MS` | Per-step simulated work range (default `1000`/`3000` = 1–3s, so transitions are observable). Each handler logs `"[fn] simulating work for N.Ns"`. Set both to `0` for fast runs. |
| `WORKER_VERSIONING` | `true` to enable Worker Versioning (PINNED). Requires a current Worker Deployment Version. |
| `MAX_CONCURRENT_ACTIVITIES` | Caps activity concurrency to *simulate* a single Lambda (default 5). |
| `INVOKER_MODE` | `local` (default, in-process handlers) \| `cloud` (real Lambda invoke — M5). |

## Cloud (M5) — scaffolded, not deployed

The cloud artifacts (SAM for the 7 business Lambdas + serverless worker Lambda + IAM role, the
`@temporalio/lambda-worker` entrypoint, Dockerfile, k8s manifests, and deploy scripts) live in
[`infra/`](infra/README.md). They're authored and locally verified where possible, but **nothing is
deployed** — running them needs AWS (SA acct 429214323166) + Temporal Cloud credentials and the
pre-release Serverless Workers feature. See `infra/README.md` for the runbook and the items that need
live validation.
