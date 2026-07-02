# BMO Mortgage Demo

Temporal orchestrating BMO's existing AWS Lambdas for a mortgage-application pipeline —
**TypeScript only**. See [CLAUDE.md](CLAUDE.md) for the contract and [SPEC.md](SPEC.md) for the
full design.

> **Status: deployed to AWS + Temporal Cloud.** Runs **locally** on a long-lived worker (the
> safety-net path) and **live on Temporal Cloud** with the serverless worker (scale-to-zero) —
> business Lambdas + worker Lambda in `us-east-1`, UI on the `sa-demo` EKS cluster at
> **https://bmo-mortgage.tmprl-demo.cloud**. The same workflow/activity/UI code runs in both modes;
> only the worker entrypoint differs (`Worker.create()` vs `@temporalio/lambda-worker`).

## What's on screen

- **Header** — the BMO × Capco × Temporal brand, a live **serverless-worker pill** (`● N workers ·
  scale-to-zero`, links to the AWS Lambda console), and a compact **fault toggle** pill.
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

Presenting it? **[DEMO.md](DEMO.md)** is the click-by-click script (pre-flight, beats, talk track).

## Layout (monorepo, npm workspaces)

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

## Local run

Prereqs: Node 20+, the `temporal` CLI. No serverless/AWS access needed locally.

```bash
npm install

# terminal 1 — local Temporal cluster + Temporal UI at http://localhost:8233
npm run temporal:dev

# terminal 2 — build, then run worker + API + UI together
npm run dev
```

`npm run dev` builds the packages and starts the worker, the API (`:8080`), and the Vite UI
(`http://localhost:5173`) together. Prefer separate terminals? Run `npm run worker:local`,
`npm run api`, and `npm run ui` individually.

The default dev server is in-memory (state is lost on restart). To keep applications across
restarts, use `npm run temporal:dev:persist`, which adds a SQLite store at `.temporal/dev.db`
(gitignored). Note: a persisted history can surface non-determinism errors after a workflow code
change — delete `.temporal/dev.db` to reset.

Run the committed smoke test (with `npm run temporal:dev` running) to exercise the core flows
end-to-end — happy path, field-locking, and fault-injection recovery:

```bash
npm run smoke
```

Open **http://localhost:5173** and drive the demo from the UI: create an application, watch the
one-trace timeline, flip Before/After, try editing `rate` after rate assignment (rejected), push
from the partner channel, send the lender callback at syndication, **burst N** for the scale story,
filter by stage in the status header, toggle the **fault** pill in the header, and view the
syntax-highlighted workflow source. The worker registers the custom Search Attributes automatically
on boot (local dev server).

Terminal-only alternative (CLI, no API/UI):

```bash
npm run happy-path            # full application end-to-end
node packages/client/dist/cli.js create --name "Jane Borrower" --phone 416-555-0100
node packages/client/dist/cli.js get <appId>
node packages/client/dist/cli.js edit <appId> rate 9.99       # rejected once rate is assigned
node packages/client/dist/cli.js callback <appId>             # resume syndication
node packages/client/dist/cli.js partner-push --name "Partner Lead"
```

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
| `BMO_STEP_MIN_MS` / `BMO_STEP_MAX_MS` | Per-step simulated work range (default `700`/`2100` ≈ 0.7–2.1s, so transitions are observable). Set both to `0` for fast runs. |
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
