# BMO Mortgage Demo

Temporal orchestrating BMO's existing AWS Lambdas for a mortgage-application pipeline —
**TypeScript only**. See [CLAUDE.md](CLAUDE.md) for the contract and [SPEC.md](SPEC.md) for the
full design.

> **Status: deployed to AWS + Temporal Cloud.** Runs **locally** on a long-lived worker (the
> safety-net path) and **live on Temporal Cloud** with the serverless worker (scale-to-zero) —
> business Lambdas + worker Lambda in `us-east-1`, UI on the `sa-demo` EKS cluster at
> **https://bmo-mortgage.tmprl-demo.cloud**. The same workflow/activity/UI code runs in both modes;
> only the worker entrypoint differs (`Worker.create()` vs `@temporalio/lambda-worker`).

## New to Temporal?

Temporal runs **durable workflows** — ordinary code whose state survives process crashes, restarts,
and (here) the worker scaling all the way to zero and back. Five terms you'll meet throughout this
repo:

- **Workflow** — the orchestration logic (our `mortgageApplicationWorkflow`, one instance per
  application). Deterministic and side-effect-free; all real I/O is delegated to activities.
- **Activity** — a single step that does real work / I/O — here, invoking a business Lambda.
  Temporal retries it automatically on failure.
- **Worker** — the process that runs your workflow + activity code by polling a **task queue**. In
  this demo the worker runs *on AWS Lambda* and scales to zero when idle.
- **Signal / Query / Update** — messages to a running workflow: fire-and-forget (**Signal**),
  read-only (**Query**), or write-with-validation (**Update** — how "Edit an application" works here).
- **Search Attribute** — indexed workflow metadata you can list/filter by (this demo indexes
  `status`, `channel`, `applicant`, and `decision`).

New to the platform? Start at **[docs.temporal.io](https://docs.temporal.io)**. Presenting this
demo? **[DEMO.md](DEMO.md)** is the click-by-click script.

## Architecture

```
Browser (audience UI)
   │  HTTP
   ▼
demo-app API  (Fastify + Temporal Client)          ← starts / signals / queries workflows
   │
   ▼
Temporal Cloud  (AWS-hosted namespace)             ← the durable orchestrator; holds workflow state
   │  invokes the worker on demand, scales to zero
   ▼
Worker on AWS Lambda  (@temporalio/lambda-worker)  ← swappable: long-lived Worker.create() locally
   │  each pipeline step is an activity that invokes…
   ▼
BMO business Lambdas  (intake · income · customer · credit · risk · rate · syndication)
```

The pipeline is five steps: **intake → income/doc verification → cross-reference (customer / credit /
risk in parallel) → decision + rate assignment (locks risk-sensitive fields) → syndication + await
lender callback**. Only the *worker* imports the Temporal SDK; the **business Lambdas are real,
independently deployable, Temporal-free handlers** — activities are thin invokers that call them.

## Project layout (monorepo, npm workspaces)

| Package | What it is |
|---------|-----------|
| `packages/shared` | Status enum, types, constants (task queue, deployment name, the four Search Attribute keys, the fault-control workflow id), the Temporal-free `BusinessError`. Bundled into the workflow sandbox, so it must stay deterministic (no `process`/`Date`/`Math.random` at module load). |
| `packages/lambdas` | The **7 business Lambdas** — real, Temporal-free handlers (intake, income, customer, credit, risk, rate, syndication). The syndication handler simulates the partner schema break when its request payload carries `forceSchemaFault`. |
| `packages/activities` | The `invoker` abstraction (local in-process \| cloud `@aws-sdk/client-lambda`) + thin invoker activities (translate `BusinessError` → `ApplicationFailure`). The syndication activity reads the fault flag from the control workflow's memo and injects `forceSchemaFault`. |
| `packages/workflows` | `mortgageApplicationWorkflow` (the entity workflow) + the singleton `faultControlWorkflow` + the Query/Update/Signal definitions. |
| `packages/worker` | Two swappable entrypoints on identical workflow/activity code: `worker.local.ts` (long-lived `Worker.create()`, local + safety net) and `worker.lambda.ts` (`@temporalio/lambda-worker`, the deployed serverless worker). Registers the custom Search Attributes on boot (local dev only). |
| `packages/api` | Fastify API wrapping the Temporal client — create / partner-intake / burst / list (SA-filterable, excludes `COMPLETED` by default) / get (+ retrying activities) / edit / callback / callback-all / triage / **fault toggle (Temporal-native)** / metrics / **status-counts** / fleet / workflow source / **config**. |
| `packages/ui` | Vite + React + TS dashboard (see *What's on screen*). |
| `packages/client` | CLI to drive the demo from a terminal (alternative to the UI). |

## Requirements

**To run locally (no AWS or Temporal Cloud access needed):**

- **Node 20+** and npm.
- The **`temporal` CLI** — `brew install temporal` (macOS) or `curl -sSf https://temporal.download/cli.sh | sh`;
  see [docs.temporal.io/cli](https://docs.temporal.io/cli). `npm run temporal:dev` shells out to it.

**To reproduce the cloud deployment (optional — see [Cloud](#cloud-deployed)):** an AWS account with
the AWS CLI, **SAM CLI**, Docker, and kubectl; a **Temporal Cloud** namespace with **Serverless
Workers enabled (pre-release — request access from your Temporal account team)** and an API key; and
the **`temporal-cloud`** CLI. Full prereqs + runbook: [`infra/README.md`](infra/README.md).

Everything is **TypeScript**; all `@temporalio/*` packages are pinned to the same `~1.18.x`.

## Local run

```bash
npm install

# terminal 1 — local Temporal cluster + Temporal Web UI at http://localhost:8233
npm run temporal:dev

# terminal 2 — build, then run worker + API + UI together
npm run dev
```

`npm run dev` builds the packages and starts the worker, the API, and the Vite UI together. Prefer
separate terminals? Run `npm run worker:local`, `npm run api`, and `npm run ui` individually.

**Ports:**

| Port | Service |
|------|---------|
| **5173** | Vite UI — **open this** |
| 8080 | Fastify API |
| 8233 | Temporal Web UI (local dev cluster) |

**Verify it's working** — the committed smoke test drives the core flows end-to-end (happy path,
field-locking, fault-injection recovery) and prints `SMOKE PASS`:

```bash
npm run smoke      # with `npm run temporal:dev` running
```

Then open **http://localhost:5173** — you should see the dashboard with an empty running list.
Create an application and watch it move through the pipeline: flip the observability toggle
Before/After, try editing `rate` after rate assignment (rejected), push from the partner channel,
send the lender callback at syndication, **burst N** for the scale story, filter by stage in the
status header, toggle the **fault** pill, and view the syntax-highlighted workflow source. The worker
registers the custom Search Attributes automatically on boot (local dev server).

The default dev cluster is **in-memory** (state is lost on restart). To persist applications across
restarts, use `npm run temporal:dev:persist` (SQLite at `.temporal/dev.db`, gitignored).

**Terminal-only alternative (CLI, no API/UI):**

```bash
npm run happy-path            # full application end-to-end
node packages/client/dist/cli.js create --name "Jane Borrower" --phone 416-555-0100
node packages/client/dist/cli.js get <appId>
node packages/client/dist/cli.js edit <appId> rate 9.99       # rejected once rate is assigned
node packages/client/dist/cli.js callback <appId>             # resume syndication
node packages/client/dist/cli.js partner-push --name "Partner Lead"
```

## What's on screen

- **Header** — the **Temporal** logo lockup and the **BMO Mortgage Pipeline** title with its tagline,
  plus two live counters and a fault control: **`● N workers`** (serverless worker invocations polling
  right now — 0 at idle, N under load) and **`◆ N lambdas`** (business-Lambda invocations Temporal has
  orchestrated across the pipeline), then a compact **fault toggle** pill.
- **Left sidebar — Specialist console:** create an application (name / phone / income doc), push one
  in from the **partner channel**, **burst N** applications, and **complete all at syndication**.
- **Main area — tabs:**
  - **Applications** (home): a dynamic **status header** with a live count per pipeline stage —
    click a segment to filter (Completed / Needs-attention reveal cleared or stuck apps) — over a
    **running list** of in-flight + stuck applications that clears each app once it reaches
    `COMPLETED`. Rows show the applicant, a compact progress strip (branched-past steps like
    rate/syndication on a DECLINED app render **skipped**, not done), and an **Open Workflow** link.
  - **Per-app detail tab** (open by clicking a row): facts with **inline editing** (a locked
    risk-sensitive field shows its rejection right on the field), an observability toggle
    **Before | After | Workflow code** (siloed per-Lambda logs ↔ one Temporal timeline ↔
    syntax-highlighted workflow source), a retry banner when stuck, and the lender callback.

## Fault injection (Temporal-native)

The syndication-partner schema break is toggled from the header **fault pill** and works identically
local and in cloud — no in-process control server, no AWS SSM. The state lives in a singleton
**`faultControlWorkflow`** (`bmo-fault-control`): `POST /api/fault` signals it; `GET /api/fault` reads
its **memo** via `describe()` (worker-independent, safe to poll under scale-to-zero). The syndication
activity reads the memo and injects `forceSchemaFault` into the `bmo-syndication-fn` payload — the
business Lambda breaks on that field and stays Temporal-free.

## Demo / dev controls (env vars on the worker)

| Var | Effect |
|-----|--------|
| `BMO_FORCE_DECISION` | `APPROVED` \| `CONDITIONAL` \| `DECLINED` — force the underwriting outcome for a predictable demo. (DECLINED short-circuits after the decision, so rate/syndication show **skipped** in the UI.) |
| `BMO_TRANSIENT_FAILURE_RATE` | `0..1` — inject random transient downstream failures so Temporal's retries are visible. |
| `BMO_STEP_MIN_MS` / `BMO_STEP_MAX_MS` | Per-step simulated work range (default `3000`/`6000` ≈ 3–6s, so transitions are observable on a projector). Set both to `0` for fast runs. |
| `WORKER_VERSIONING` | `true` to enable Worker Versioning (PINNED). Requires a current Worker Deployment Version. |
| `MAX_CONCURRENT_ACTIVITIES` | Caps activity concurrency to *simulate* a single Lambda locally (default 5). |
| `INVOKER_MODE` | `local` (default, in-process handlers) \| `cloud` (real `@aws-sdk/client-lambda` invoke). |
| `TEMPORAL_UI_BASE` | Optional override for the "Open Workflow" deep-link base; otherwise the API derives the local dev UI (`:8233`) vs the Temporal Cloud UI from the address/namespace. |

The syndication fault is **not** an env var anymore — toggle it from the UI (or `POST /api/fault`);
it's the Temporal control workflow described above.

## Cloud (deployed)

Deployed to AWS SA account **429214323166** / **us-east-1** (7 business Lambdas + the serverless
worker Lambda + the Temporal invoke role) and Temporal Cloud namespace
**`ddn4-serverless-mortgage.sdvdw`**, with the UI on the `sa-demo` EKS cluster (us-west-1) behind a
trusted Let's Encrypt cert at **https://bmo-mortgage.tmprl-demo.cloud**. The serverless worker
auto-invokes from zero and scales to zero; new applications run on a **PINNED** Worker Deployment
Version. The IaC (SAM), entrypoints, k8s manifests, deploy scripts, and the full runbook live in
[`infra/`](infra/README.md).

### Reproducing this deployment

The live deployment is wired to Temporal-internal resources, so it won't run end-to-end out of the
box. To stand up your own, substitute:

- **AWS account** `429214323166` → yours (plus the ECR repo `bmo-demo-app` and region `us-west-1`).
- **Temporal Cloud namespace** `ddn4-serverless-mortgage.sdvdw` → yours, with **Serverless Workers
  enabled (pre-release — request access)** and its own API key.
- **UI host** `bmo-mortgage.tmprl-demo.cloud` on the `sa-demo` EKS cluster → your cluster + hostname
  (it's a single Fastify container, so any container host works).
- **Credentials** — this repo uses an internal `access` JIT tool for AWS SSO; substitute your own
  `aws` profile / credentials.

If Serverless Workers isn't available to you, the **long-lived worker** (`worker.local.ts`) runs the
identical code against your Cloud namespace as a fallback — you lose only the scale-to-zero cost
story. Step-by-step order of operations: [`infra/README.md`](infra/README.md).

## Troubleshooting

- **`temporal: command not found`** — install the CLI (see [Requirements](#requirements));
  `npm run temporal:dev` shells out to it.
- **Port already in use (5173 / 8080 / 8233)** — a previous run is still up; stop it or change the
  port. `npm run dev` uses `concurrently --kill-others-on-fail`, so one dead process brings the others
  down loudly rather than leaving a half-running stack.
- **UI lists applications but a detail tab stays empty / shows "worker spinning up"** — *locally:* the
  worker isn't polling (confirm terminal 2 is running `npm run dev` or `npm run worker:local`).
  *In cloud:* a Query against an idle app waits for the serverless worker to cold-start — expected, it
  resolves in a few seconds.
- **`Nondeterminism` error after editing workflow code** — a persisted history
  (`npm run temporal:dev:persist`) is replaying against changed logic. Delete `.temporal/dev.db` to
  reset (fine for a demo).
- **Queries hang when the worker is scaled to zero (cloud)** — use `temporal workflow describe`
  (reads history, no worker needed) instead of a Query, or pre-warm/invoke the worker first.
