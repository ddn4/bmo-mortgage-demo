# BMO Mortgage Demo — Specification (for review)

**Status:** Draft for review · **Audience for this doc:** Dan (Temporal SA), Rick (technical build),
Hussain (business narrative, Capco) · **Last updated:** 2026-06-25

> This is a spec for review, not a final design. Open questions are tracked in §11. Please mark up
> anything you want changed before we scaffold code.

---

## 1. Purpose & framing

Build a **polished, presenter-driven demo** showing **Temporal orchestrating BMO's existing AWS
Lambdas** for a mortgage-application pipeline. The audience is BMO (via Capco partner Hussain
Saleem). The demo must land five customer concerns and respect BMO's hard guardrails.

**Headline messages (front-of-mind throughout):**

- **Everything in TypeScript** — non-negotiable (their SRE VP's mandate; core team are UI engineers).
- **Orchestrate Lambda, don't replace it** — additive, incremental, no rewrite. The Lambda-first
  guardrail is fixed.
- **Maps to the CIO's code-quality initiative** — most of the 200+ remediation items are things
  Temporal provides natively (retries, idempotency, timeouts, observability, state).
- **The stakes** — up to **$10M CAD per incident**; **~$21K CAD/minute** lost during payment downtime.
- **Tie to the business KPIs Hussain named** — *data quality* (field-locking integrity, no partial /
  lost state) and *speed of filing* (fewer stuck applications, instant recovery, no re-keying after a
  failure).

**The two Lambda roles (this is the core architectural idea):**

| Role | What runs there | Story it serves |
|------|-----------------|-----------------|
| **Business Lambdas** | Stand-ins for BMO's existing isolated functions (intake, income, customer, credit, risk, rate, syndication — seven total; customer/credit/risk are three separate internal Lambdas run in parallel) — **real, independently deployed Lambdas with zero Temporal dependency** | "Orchestrate, don't replace"; observability; blast radius |
| **Worker Lambda** | The Temporal worker (workflow + activity host), invoked on demand by Temporal's Worker Controller Instance | The **cost story**: durable orchestration with no warm workers 8–12 hrs/day |

Showing the serverless layer live to BMO is **confirmed** — it's the headline of the cloud demo. We
still keep the worker-on-Lambda layer **swappable** (see §6) for local dev and as a live-demo safety net.

---

## 2. Concern → demo-moment mapping (the script)

| BMO concern | What we show live | What it replaces |
|-------------|-------------------|------------------|
| **Observability** | **Before/after, side by side:** today's siloed per-Lambda CloudWatch/Dynatrace logs (debugging across many files) vs. **one Temporal timeline** tracing a single application across all the isolated Lambdas. | Multi-file, siloed, per-Lambda debugging; no orchestration-level logging. |
| **Resilience / "view & fix stuck work"** *(Hussain asked for this)* | Toggle a **syndication-partner schema break** → apps can't process → automatic retries with backoff → each blocked app is a **first-class, inspectable workflow** (full payload + event history) in a **triage view** where the operator **decides and resolves in place** (retry, or edit-and-resume). No lost state. | Messages dead in a **DLQ**, hand-rolled AWS retry libs, multi-file forensics. Ties to **$10M CAD/incident · $21K CAD/min**. |
| **Scalability & cost** | Serverless worker **scales from zero**, absorbs a burst, returns to zero — plus a **cost panel** quantifying always-warm Lambdas (8–12 hrs/day, ~sec cold starts) vs. Temporal serverless over a representative day. | Always-warm / provisioned Lambdas, "primitive" auto-scaling, cold-start latency. |
| **Skill gap** | **Code reveal:** the actual workflow source on screen — a short, linear, readable TS function any UI engineer can own — beside the retry/queue/DLQ/idempotency plumbing it deletes. | "Hire average engineers, write business logic, not durability code"; faster contractor onboarding. |
| **Migration & maintainability** | Temporal calls *existing* Lambdas unchanged; adoption is incremental and additive. **Worker Versioning (PINNED)** ships new builds safely while applications are in-flight. | Big-bang rewrites; risky deploys with a rotating contractor team. |

---

## 3. Demo storyline

Two operations, narrowed to **~5 meaningful steps** (vs. BMO's ~80 screens), culminating in a decision:

1. **Intake** — create an application from minimal data (name / phone). **Two channels feed the same
   workflow**: the mortgage-specialist console *and* a partner sales-channel that **Signals** an
   application in via queue (the "hub" + apps from outside the BMO portfolio).
2. **Income & document verification** — process a pay stub: a **T4** *and* an **Uber/gig** stub,
   nodding to their ML classifier for non-traditional income.
3. **Cross-reference internal systems** — customer book-of-record lookup + credit score + risk (three
   isolated *internal* Lambdas, run in parallel — a great visual for "orchestrate many functions").
4. **Underwriting decision → rate assignment** — the workflow reaches a **decision** (approve /
   conditional / decline); on approval it assigns a rate, a status change that **locks risk-sensitive
   fields**.
5. **Syndication** — hand off to a Canadian lender partner (await callback); then **Edit** to show
   resumption. The run culminates in a clear **outcome** (offer issued / conditional / declined).

**Operations the presenter drives from the UI:**

- **Create Application** from the specialist console (single, and **burst N** for the scale/cost story).
- **Push from partner channel** — Signal an application in from a simulated external sales channel.
- **Edit Application** (validated; demonstrates locking + resumption).
- **Inject fault** (syndication schema break) and **clear fault**.
- **Triage & resolve** a stuck application (retry / edit-and-resume) from the UI.
- **Reveal workflow code** and open the **cost panel** for the talk-track beats.
- **Presenter / burst mode** for live scaling visuals.

---

## 4. Workflow & activity design

Grounded in the `temporal-developer` skill (TS patterns: updates/queries/signals, versioning,
saga, heartbeats).

### 4.1 Entity workflow — one per application

`mortgageApplicationWorkflow(input)` — `workflowId = mortgage-app-<applicationId>`.

- **Long-lived**: created at Intake, runs steps 1–5, then remains available to accept **Edits** and
  serve **Queries** ("created, then edited later"). Continue-as-new if history grows large.
- **Versioning behavior: `PINNED`** (the Serverless Workers default) — an in-flight application
  completes on the worker build it started on. Code changes for in-flight apps use Worker
  Versioning + the Patching API.

**State (held in workflow):**

```
status: INTAKE | INCOME_VERIFICATION | CROSS_REFERENCE | DECISION | RATE_ASSIGNED | SYNDICATION | COMPLETED | NEEDS_REVIEW
channel: SPECIALIST | PARTNER_QUEUE              // intake source (the "hub")
decision: APPROVED | CONDITIONAL | DECLINED | null
application: { id, applicant, contact, income, documents, customerRef, creditScore, riskTier, rate, lenderPartner }
timeline: StepEvent[]   // per-step status, attempts, timestamps — feeds the observability view
lockedFields: set once status >= RATE_ASSIGNED
// surfaced as custom Search Attributes (status, channel, isStuck) for list/filter — see §4.6
```

### 4.2 Edits — **Update with validator** (not Signal)

```ts
export const editApplication = defineUpdate<ApplicationState, [EditRequest]>('editApplication');

setHandler(editApplication, (edit) => { /* apply edit, append timeline event */ return state; }, {
  validator: (edit) => {
    if (statusAtOrAfter('RATE_ASSIGNED') && touchesLockedFields(edit))
      throw ApplicationFailure.create({ type: 'FieldLocked', nonRetryable: true,
        message: 'Risk-sensitive fields are locked after rate assignment' });
  },
});
```

Updates give the UI **synchronous accept/reject** feedback — ideal for showing the locking rule.
Validators are read-only (no activities/sleeps). **Queries** (`getApplication`) feed the UI
timeline/status without side effects. **Signals** only for fire-and-forget (e.g. a lender-partner
callback that resumes syndication).

### 4.3 Activities — invoke existing Lambdas (orchestrate, don't replace)

Each step is an activity that invokes a business Lambda through an **`invoker`** abstraction:

| Activity | Business Lambda | Notes |
|----------|-----------------|-------|
| `intake` | `bmo-intake-fn` | fast |
| `verifyIncomeAndDocuments` | `bmo-income-verification-fn` | processes pay stub/T4 |
| `customerLookup` / `creditScore` / `riskAssessment` | `bmo-customer-fn` / `bmo-credit-fn` / `bmo-risk-fn` | **run in parallel** via `Promise.all` |
| `assignRate` | `bmo-rate-fn` | triggers field lock |
| `syndicateToLenderPartner` | `bmo-syndication-fn` | long-running; **heartbeats**; the fault-injection target |

- **The business Lambdas are real and Temporal-free.** Each is its own deployed function (own
  handler, IAM role, log group, request/response contract), written as if it predated Temporal —
  only the *worker* Lambda imports the Temporal SDK. This is what makes "orchestrate, don't
  replace" literally true and the observability story (one trace across isolated Lambdas) real.
  They get realistic latency, occasional transient failures, and a mock **DynamoDB** store for
  customer/credit lookups so cross-referencing feels stateful.
- `invoker.invoke(fnName, payload)` → real `@aws-sdk/client-lambda` `InvokeCommand` in the cloud;
  **the same handler function** in-process locally (or via **AWS SAM Local / LocalStack** for full
  Lambda-runtime fidelity). No code divergence local↔cloud. The activity is a **thin invoker with
  zero business logic** — build payload, invoke, parse response, return.
- Retries: rely on Temporal defaults; mark schema/validation failures `nonRetryable`
  (`ApplicationFailure` typed e.g. `SchemaMismatch`, `ValidationError`). Set `startToCloseTimeout`
  per step and `heartbeatTimeout` for syndication. **No DLQs, no hand-rolled retry code.**
- Optional **saga/compensation** for steps with side effects (e.g. release a reserved rate) to
  reinforce the "durability for free" message — kept minimal for demo clarity.

### 4.4 Fault injection + recovery (the resilience moment)

- UI "Inject fault" flips `bmo-syndication-fn` into **schema-break mode** (a control flag the
  Lambda reads — env var / SSM param / a tiny control store).
- Effect: `syndicateToLenderPartner` fails → Temporal retries with backoff (visible as "retrying"
  in the per-app timeline and a **Needs-Review** queue) → workflow state is preserved, nothing lost.
- "Clear fault" → next retry succeeds → workflow resumes and completes. State was never lost; no
  DLQ, no manual replumbing.
- Deepest version (optional): show `temporal workflow reset` as an explicit "replay path."

### 4.5 Multi-channel intake — Signals (the "hub")

Applications arrive from two sources into the **same** workflow type, mirroring BMO's hub that also
processes apps from outside its portfolio:

- **Specialist console** → `client.workflow.start(mortgageApplicationWorkflow, …)`.
- **Partner sales channel** → a simulated external queue delivers a message; the API turns it into
  either a new workflow start or a **Signal** to an existing application. Fire-and-forget ingestion
  with no lost messages (no DLQ).

The lender-partner **callback** that resumes syndication is also a Signal; the workflow `await`s it
behind a durable timer, so there is **no warm compute while waiting**.

### 4.6 Visibility — custom Search Attributes

Upsert `applicationStatus`, `channel`, and `isStuck` as Search Attributes so the UI (and the Temporal
UI) can list/filter applications — this powers the Triage view and the observability story ("show me
everything stuck on syndication") without a bolt-on database.

---

## 5. UI / driving the demo

Reuse the **reference repo's** dashboard concepts (active workflows, task-queue backlog, Lambda
invocations, sync-match rate, presenter burst mode) and extend for BMO. Implemented as **Vite +
React + TypeScript** (modern, polished, matches "team are UI engineers") talking to a **Fastify**
API that holds the Temporal client and polls metrics. (Alternative: a single embedded HTML page
like the reference repo — lower effort, less polish; see §11.)

**Views:**

1. **Mortgage-specialist console** *(the "one web page" Rick described)* — create an application from
   minimal data, then edit it; the front door that makes the demo tangible. Edits hit the Update
   validator, so the locked-field rejection is shown right here.
2. **Application timeline (observability)** — per-application, step-by-step across the isolated
   Lambdas in one timeline; attempts, durations, current status, locked-field indicator. A
   **before/after toggle** contrasts siloed per-Lambda logs with the single timeline. Deep-links to
   the Temporal UI for the raw event history.
3. **Operations / fleet (cost + scale)** — live worker-on-Lambda invocations, scale-to-zero, backlog,
   sync-match %, in-flight applications; **burst N** control; a **cost panel** comparing always-warm
   vs. serverless over a representative day.
4. **Triage & resolve (resilience)** *(answers Hussain's explicit ask)* — every stuck application as a
   first-class card: failure reason, **input payload, and event history** inline, with **Retry** and
   **Edit-and-resume** actions — decide and fix without leaving the screen. Includes the fault toggle.
5. **Code reveal** — a panel showing the actual `mortgageApplicationWorkflow` source for the skill-gap
   talk track (readable TS vs. the plumbing it replaces).

**Presenter affordances:** burst create (e.g. 30–200), partner-channel push, fault inject/clear,
triage actions, reset — all from the UI; a clean BMO/Capco/Temporal co-branded theme; large readable
type for projection.

---

## 6. Serverless worker: swappable layer + GA fallback

The worker entrypoint is the **only** thing that differs between modes; workflow/activity code is
identical.

| Mode | Worker entrypoint | When | Cost story |
|------|-------------------|------|------------|
| **Serverless** | `@temporalio/lambda-worker` `runWorker({deploymentName, buildId}, configure)` on Lambda, invoked by Temporal's WCI | **Cloud demo — primary** (live show to BMO confirmed) | **Shown live** (scale-to-zero) |
| **Long-lived (local / safety net)** | `Worker.create({ workflowBundle, taskQueue, workerDeploymentOptions })` on EKS/Fargate or local | Local dev always (no serverless locally); kept ready as a live-demo safety net | Same workflows/activities; cost story falls back to a slide only if ever needed |

Live serverless to BMO is **confirmed** (§11 #1), so it's the headline. We keep the long-lived path
as the local-dev runtime and a live-demo safety net — it also satisfies the outline's "GA-feature
fallback ready so the cost story holds either way."

---

## 7. Environments & phased plan

**Phase A — Local (iterate here first; recommended and feasible):**
`temporal server start-dev` + long-lived TS worker running the **real business-Lambda handlers
in-process** (the same code we deploy; or via SAM Local/LocalStack), concurrency-capped to simulate
one Lambda, + Fastify API + Vite UI. Validates the full storyline, workflow/activity logic,
edits/locking, fault-injection/recovery, and the dashboard — everything except true WCI-driven
Lambda invocation and scale-to-zero.

**Phase B — Cloud (validate the serverless story):** deploy to AWS + Temporal Cloud; swap the worker
entrypoint to `@temporalio/lambda-worker`; point the invoker at real business Lambdas; deploy the UI
to `sa-demo` EKS. Validate WCI invocation, scale-to-zero, versioned-ARN rollout, and the live burst.

This local→cloud flow is exactly what was requested and is how the reference repo is structured.

---

## 8. AWS + Temporal Cloud setup (runbook outline)

- **AWS account:** SA account **429214323166**. CLI creds via the JIT tool:
  `access account --aws-account-id 429214323166 --write`.
- **Regions (resolved):** us-west is *not* required. Co-locate the **Temporal Cloud namespace +
  business Lambdas + worker Lambda** in **`us-east-1`** (Northern Virginia) — matches the shared
  reference repo (`temporal-serverless-no-roads`), is the eastern US region closest to BMO, and is
  typically first in line for pre-release features. **Confirm pre-release Serverless Workers is
  enabled in `us-east-1`** with the account team. The **UI stays on `sa-demo` EKS (`us-west-1`)**
  for the easy public `*.tmprl-demo.cloud` URL; cross-region UI→Temporal Cloud is just gRPC over the
  internet and adds no per-application latency. Workers need not share the namespace's region —
  co-location is a latency optimization, not a requirement.
- **Temporal Cloud:** an **AWS-hosted namespace** in `us-east-1` (provider must match the Lambda
  compute provider) with **Serverless Workers enabled** — pre-release, request via account team /
  support ticket. API key → AWS Secrets Manager.
- **Worker Lambda:** deploy TS worker (pre-bundled workflows); publish a **versioned ARN**
  (`...:function:bmo-worker:N`).
- **IAM:** CloudFormation role that Temporal assumes to `lambda:InvokeFunction` the worker — capture
  **RoleARN** + **ExternalID**.
- **Worker Deployment Version:** create in Temporal UI/CLI with the worker ARN, RoleARN, ExternalID;
  `name` + `buildId` must match worker code; set current.
- **Business Lambdas:** deploy the seven mock functions (SAM/CloudFormation).
- **Demo-app (UI+API):** containerize → ECR → `sa-demo` EKS via k8s manifests + Traefik IngressRoute
  → public URL at `*.tmprl-demo.cloud`. Temporal creds via k8s Secret.
- **Co-location:** keep the namespace and both Lambda roles in the same region so WCI→Lambda
  invocation latency stays low (matters for the cold-start / scale-from-zero visuals).

---

## 9. Proposed repository layout

```
bmo-mortgage-demo/
├── CLAUDE.md, SPEC.md
├── packages/
│   ├── shared/         # types, status enum, task-queue + deployment constants
│   ├── workflows/      # mortgageApplicationWorkflow (+ bundle build)
│   ├── activities/     # step activities + invoker abstraction (real Lambda | mock)
│   ├── worker/         # entrypoints: worker.lambda.ts (serverless) | worker.local.ts (long-lived)
│   ├── lambdas/        # seven mock BMO business Lambdas (incl. customer lookup)
│   ├── api/            # Fastify: Temporal client, metrics, control endpoints
│   └── ui/             # Vite + React + TS dashboard
├── infra/              # SAM/CloudFormation (Lambdas, IAM) + k8s manifests + IngressRoute
└── scripts/            # deploy-lambda, publish-version, seed/burst, set-current-version
```

---

## 10. Milestones

1. **M0 — Scaffold & CLAUDE.md/SPEC sign-off** (this doc approved; monorepo + deps pinned).
2. **M1 — Local happy path:** workflow + 5 steps (→ decision/outcome) + real handlers in-process + dev
   server; Create from the specialist console works end-to-end.
3. **M2 — Edits + locking + queries; observability timeline + before/after; multi-channel Signal intake.**
4. **M3 — Fault injection + recovery; Triage-&-resolve view (inspect payload/history, retry, edit-resume).**
5. **M4 — Burst/presenter mode + cost panel + code-reveal; Search Attributes for filtering.**
6. **M5 — Cloud deploy:** business Lambdas + worker Lambda + Temporal Cloud + EKS UI; **serverless
   worker (confirmed)**, long-lived path kept ready as a safety net (§6).
7. **M6 — Dress rehearsal:** co-branding, projector-friendly polish, run-of-show, failure drills.

Target a rough first pass after the holiday period (per the outline); finalize timing from there.

---

## 11. Open questions / decisions needed

1. **RESOLVED — Serverless live demo confirmed.** The pre-release feature can be shown to BMO live;
   it's the headline of the cloud demo. We still keep the long-lived worker as the local-dev runtime
   and a live-demo safety net (§6). Remaining sub-check: confirm it's enabled in `us-east-1` (#4).
2. **UI framework.** Vite+React+TS (recommended — polish, matches their team) vs. a single embedded
   HTML page like the reference repo (faster, less polish). *Recommendation: Vite+React+TS.*
3. **RESOLVED — Real business Lambdas.** Build real, independently deployed, Temporal-free Lambdas
   that stand in for BMO's existing functions (we don't have theirs). Activities are thin invokers;
   the same handler code runs in-process / SAM Local for local dev. See §4.3.
4. **RESOLVED — Region.** `us-east-1` for the namespace + Lambdas (matches the shared reference
   repo); UI on `us-west-1` EKS. Remaining check: confirm pre-release Serverless Workers is enabled
   in `us-east-1`. See §8.
5. **Branding assets** — BMO/Capco/Temporal logos, color palette, any compliance/confidentiality
   marking for a customer-facing screen. *Recommendation: tasteful co-brand; confirm with Hussain.*
6. **Reset/replay depth** — is `temporal workflow reset` worth showing, or keep recovery to
   automatic retries only? *Recommendation: keep retries as the main beat; reset as optional.*

## 12. Demo run-of-show (beat sequence + talk track)

A tight ~10–12 minute live flow; presenter drives from the UI, Hussain narrates the business.

| # | Beat | Presenter does | Talk track / value |
|---|------|----------------|--------------------|
| 1 | **Create** | New application from the specialist console (name/phone) | "Minimal data in; this kicks off one durable workflow." |
| 2 | **One timeline** | Open the timeline; flip the **before/after** toggle | "Today you debug across many files and silos. Same app, one orchestration-level trace." |
| 3 | **Hub intake** | Push an application from the **partner channel** (Signal) | "Same workflow, second channel — incl. apps outside BMO's portfolio. No DLQ, no lost messages." |
| 4 | **Income** | Show a **T4** and an **Uber/gig** stub verified | "Income across traditional and gig sources — your ML step is just an activity." |
| 5 | **Parallel cross-ref** | Customer + credit + risk fan out in parallel | "Three isolated internal Lambdas, orchestrated; one view of all of them." |
| 6 | **Decision + lock** | Reach decision; assign rate; try an **edit to a locked field** → rejected | "The risk-integrity invariant is enforced by the workflow, synchronously — not scattered guard code." |
| 7 | **Break syndication** | **Inject** the partner schema change | "A syndication partner changed the schema — the exact production incident you described." |
| 8 | **Triage & fix** | Open **Triage**, inspect payload + history, **edit-and-resume** | "The visual tool you asked for: see it, decide, fix in place. No DLQ forensics. Stakes: $10M/incident, $21K/min." |
| 9 | **Burst + cost** | **Burst N**; watch scale-from-zero; open the **cost panel** | "Serverless workers — no warm Lambdas 8–12 hrs/day, no cold-start tax. Here's the bill difference." |
| 10 | **Code reveal** | Show the workflow source | "Readable TypeScript your UI engineers already own. Hire for business logic, not durability plumbing." |
| 11 | **(Optional) safe deploy** | Note Worker Versioning / PINNED | "Ship new builds while applications are in flight — safe even with a rotating contractor team." |

**Guardrails to hold:** complement (don't replace) CloudWatch/Dynatrace/SonarQube; everything in
**TypeScript**; honor **Lambda-first** (the worker runs on Lambda too — we orchestrate, we don't
replace); these are **internal** APIs, not third-party.

## 13. "200 items → Temporal primitives" — objection / value map

To use against the CIO's code-quality backlog and the three problems Hussain named (durability,
retries, consistency/config):

| Their pain (from the call) | Hand-rolled today | Temporal primitive |
|----------------------------|-------------------|--------------------|
| Durability / lost state | SQL state store, custom checkpoints | Durable workflow state + Event History |
| Retries / consistency | AWS retry libraries per Lambda | Built-in retry policies + backoff |
| Stuck messages / DLQs | DLQs + manual triage across files | First-class failed workflows; inspect + retry/reset |
| No orchestration-level logging | Per-Lambda CloudWatch/Dynatrace silos | One workflow timeline across all Lambdas |
| Idempotency | Ad-hoc dedupe | Idempotent activity patterns + workflow IDs |
| Long waits (DocuSign, lawyers) | Warm Lambdas / polling | Durable timers + Signals, zero warm compute |
| Cost of always-warm Lambdas | Provisioned concurrency | Serverless workers scale-to-zero |
| Safe deploys w/ contractors | CDK (logging only) | Worker Versioning (PINNED) |
| Skill gap | Master-SRE-level plumbing | Linear TS business logic on the SDK |

CDK still handles deployment/log classification; SonarQube/Dynatrace/CloudWatch stay — Temporal
**adds** the orchestration/durability layer they don't cover.

## 14. Appendix — P2 / roadmap extensions (don't overbuild)

Talk-track or stretch beats, kept out of the core build per Rick's "~5 steps / one web page":

- **End-to-end human-in-the-loop tail:** DocuSign → lawyer review → release → regulator filing —
  Temporal's sweet spot (durable timers + Signals spanning days/weeks, no warm compute). Optionally
  demo a single "await DocuSign / await lawyer approval" step.
- **AI auto-populate** (their existing GPT POC) orchestrated as a durable Temporal step — future hook
  for the data-quality / speed-of-filing KPIs.
- **No-Redis / durable state** talk track — process state lives in the workflow; no bolt-on
  cache / SQL store for orchestration state.
- **Bilingual FR/EN + accessibility** nod in the UI — cosmetic, matches their real app.

## 15. Out of scope (for this demo)

Real BMO systems/data; real credit-bureau or lender integrations; auth/multi-tenant hardening;
production SLOs/scaling beyond what's needed for a believable live burst; CI/CD beyond simple
deploy scripts.
