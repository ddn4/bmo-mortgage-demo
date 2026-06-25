# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

> Full design and rationale live in [SPEC.md](SPEC.md). This file is the quick-reference
> contract. When the two disagree, SPEC.md is the source of truth — update both.

## What this is

A **polished, presenter-driven demo** for **BMO (Bank of Montreal)**, built with **Temporal**,
delivered jointly by **Temporal + Capco** (prepared for Hussain Saleem). It shows Temporal
orchestrating a mortgage-application pipeline across BMO's **existing, isolated AWS Lambdas**,
with the Temporal **worker itself running serverless on AWS Lambda** (Temporal Serverless
Workers, pre-release) for the cost story. Deploys to **AWS + Temporal Cloud**; the audience-facing
UI both *visualizes* and *drives* the demo live.

The reference implementation we adapt (Go) is
`github.com/lainecsmith/temporal-serverless-no-roads` — reuse its UI/dashboard ideas and
serverless-metrics visualization; we re-implement in TypeScript.

## Non-negotiable constraints

1. **TypeScript only.** Workflows, activities, worker, API, and UI are all TS. This is a hard
   customer mandate (their SRE VP; the team are UI engineers). Do not introduce Go/Python/Java.
2. **Orchestrate Lambda, don't replace it.** Business logic stays in (mock) BMO Lambdas; Temporal
   activities *invoke* them. We never port business logic into the workflow. This "Lambda-first
   guardrail" is fixed.
3. **Serverless Workers (pre-release) — live demo to BMO is CONFIRMED.** It is the headline of the
   cloud demo. The worker entrypoint still stays **swappable**: a `@temporalio/lambda-worker`
   handler for the serverless story, and a long-lived `Worker.create()` for local dev (no
   serverless locally) and as a live-demo **safety net**. Identical workflow/activity code behind
   both. Never let serverless-only assumptions leak into workflow logic.
4. **Demo-drivable from the UI.** Create, Edit, fault-injection toggle, and burst/presenter mode
   are all triggered from the web UI — no terminal needed during a live demo.

## Architecture (target)

```
Browser (audience UI) ──HTTP──► demo-app API (TS/Fastify, on sa-demo EKS)
                                   │  Temporal Client
                                   ▼
                            Temporal Cloud (AWS-hosted namespace)
                                   │  WCI invokes worker on demand
                                   ▼
                      Worker on AWS Lambda  (@temporalio/lambda-worker)   ◄── swappable
                      (local/fallback: long-lived Worker.create())            with
                                   │  activities invoke...                     long-lived
                                   ▼
                      BMO business Lambdas (intake, income, customer, credit, risk, rate, syndication)
```

- **One workflow per application** (entity-workflow pattern), long-lived: created at Intake,
  runs the 5 steps, then stays available to accept **Edits** and emit **Queries**.
- **Each pipeline step is an activity that invokes a business Lambda** via `@aws-sdk/client-lambda`.
  Business Lambdas are **real, independently deployed functions with zero Temporal dependency** —
  they stand in for BMO's existing functions (which we don't have), written as if they predated
  Temporal. Only the *worker* Lambda imports the Temporal SDK. The activity is a **thin invoker,
  no business logic**. An `invoker` abstraction calls the deployed Lambda in the cloud and the
  **same handler code** in-process (or via SAM Local / LocalStack) for local dev — no divergence.

## Tech stack

- Temporal TypeScript SDK: `@temporalio/{client,worker,workflow,activity,common}` — **all the
  same version**, pinned with `~`.
- Serverless worker: `@temporalio/lambda-worker`. Pre-bundle workflows with `bundleWorkflowCode`
  (avoid webpack cost on cold start); use `workflowBundle` in the Lambda handler.
- AWS SDK v3 (`@aws-sdk/client-lambda`) inside activities to invoke business Lambdas.
- API: Fastify (TS). UI: Vite + React + TS (see SPEC.md for rationale).
- IaC: AWS SAM or CloudFormation for Lambdas + IAM; k8s manifests + Traefik IngressRoute for the UI.

## Temporal rules every change must respect

- **Determinism.** No I/O, randomness, wall-clock, or non-deterministic APIs in workflow code —
  all side effects go through activities. The TS SDK sandboxes `Date.now`/`Math.random`/`setTimeout`.
- **Worker Versioning is mandatory for Serverless Workers.** Every workflow declares a versioning
  behavior; we use **PINNED** (the serverless default) so an in-flight application completes on the
  build it started on. Set `deploymentName` + `buildId`; map each Worker Deployment Version to one
  **versioned Lambda ARN** (e.g. `...:function:bmo-worker:5`) — never an unqualified `$LATEST` ARN
  for anything but throwaway iteration.
- **Edit = Update, not Signal.** Use `defineUpdate` with a **validator** that rejects edits to
  risk-sensitive fields once status ≥ `RATE_ASSIGNED` (validators are read-only; throw to reject).
  Updates give the UI synchronous accept/reject feedback. Use **Queries** for UI state/timeline,
  **Signals** only for fire-and-forget (e.g. lender-partner callback).
- **Heartbeat long activities** (syndication, appraisal) and set sensible `startToCloseTimeout` /
  `heartbeatTimeout`. Activity must fit within Lambda's 15-min invocation ceiling, or checkpoint
  via heartbeat.
- **Mark validation failures `nonRetryable`** (`ApplicationFailure` with a typed `ValidationError`);
  let transient downstream failures retry with backoff. No DLQs / hand-rolled retry libs.
- Use `workflowBundle` (not `workflowsPath`) for any deployed worker.

## Local development

Prereqs: Node 20+, `temporal` CLI, AWS CLI (for cloud phase). No serverless access needed locally.

```bash
temporal server start-dev          # local cluster + UI at :8233
npm run worker:local               # long-lived Worker.create(); runs the same Lambda handler code in-process
npm run api                        # Fastify API (Temporal client) at :8080
npm run ui                         # Vite dev server
```

The local worker is concurrency-capped to *simulate* a single Lambda so backlog/sync-match are
visible with modest load (mirrors the reference repo's `localworker`). Everything except true
WCI-driven Lambda invocation / scale-to-zero is exercised locally.

## Deploy (cloud phase) — see SPEC.md for the full runbook

1. AWS access: SA account **429214323166** (`access account --aws-account-id 429214323166 --write`
   for CLI creds). **Regions:** the Temporal Cloud namespace + business Lambdas + worker Lambda
   co-locate in **`us-east-1`** (matches the shared reference repo; eastern US, closest major region
   to BMO — confirm pre-release Serverless Workers is enabled there). The `sa-demo` EKS cluster that
   hosts the UI is **`us-west-1`** — the only us-west pin; cross-region UI→Temporal is fine.
2. Temporal Cloud: an **AWS-hosted namespace** with **Serverless Workers enabled** (pre-release —
   request via account team / support ticket). Store the API key in AWS Secrets Manager.
3. Deploy business Lambdas + the worker Lambda; publish a **versioned** worker ARN.
4. Create the IAM role Temporal assumes to invoke the worker (CloudFormation; capture RoleARN +
   ExternalID). Create the Worker Deployment Version in the Temporal UI/CLI (name + buildId must
   match worker code), set it current.
5. Deploy the demo-app (API+UI) container to `sa-demo` EKS via ECR + k8s manifests + Traefik
   IngressRoute → public URL at `*.tmprl-demo.cloud`.

## References

- Demo scenario: `BMO_Demo_Outline` Google Doc (drives SPEC.md §Storyline).
- Temporal Serverless Workers: https://docs.temporal.io/serverless-workers
  and TS guide: https://docs.temporal.io/develop/typescript/workers/serverless-workers/aws-lambda
- Reference repo: https://github.com/lainecsmith/temporal-serverless-no-roads
- Use the **temporal-developer** skill when designing/altering workflows and activities.
- AWS access details: Notion "AWS and GCP Access for SAs" / "Accessing SA Cluster and AWS Services".
