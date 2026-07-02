# BMO Mortgage Demo — Presenter Script

A tight **~11-minute** live flow. The presenter drives the UI; the business narrator (Hussain) tells
the BMO story. Beats follow SPEC §12; this is the concrete, click-by-click version grounded in the
built UI.

Run it on the **deployed cloud demo** (https://bmo-mortgage.tmprl-demo.cloud) for the **live
scale-to-zero** beat, or **locally** as the safety net (identical UI; the local worker is
concurrency-capped to *simulate* one Lambda). Every beat below is UI-driven and works in both.

> **Hold the guardrails throughout:** everything is **TypeScript**; we **orchestrate** BMO's existing
> Lambdas, we don't replace them; these are **internal** functions; Temporal **complements**
> CloudWatch/Dynatrace/SonarQube. Stakes to weave in: **up to $10M CAD/incident · ~$21K CAD/min** of
> payment downtime.

---

## Pre-flight (before the room)

**Cloud (primary — live serverless):** just open **https://bmo-mortgage.tmprl-demo.cloud**. Make sure
the header **fault pill** reads `⚡ Healthy`. Optionally clear old test data so the list/counts start
clean (this won't touch the running fault-control workflow or anything in-flight):

```bash
source ~/.config/bmo/temporal-cloud.env
temporal workflow delete \
  --address us-east-1.aws.api.temporal.io:7233 \
  --namespace ddn4-serverless-mortgage.sdvdw --api-key "$TEMPORAL_API_KEY" \
  --query "WorkflowType = 'mortgageApplicationWorkflow' AND ExecutionStatus = 'Completed'" --yes
```

**Local (safety net):**

```bash
# terminal 1 — local Temporal cluster + Temporal UI at http://localhost:8233
npm run temporal:dev

# terminal 2 — worker + API + UI together; force a clean APPROVED hero flow
BMO_FORCE_DECISION=APPROVED npm run dev
```

- Open **http://localhost:5173** (demo UI) and **http://localhost:8233** (Temporal UI) in two tabs.
- Smoke it once: `npm run smoke` (separate terminal) should print `SMOKE PASS ✓`.
- Fresh state: the in-memory dev server clears on restart. Mid-session reset:
  `temporal workflow terminate --query 'ExecutionStatus="Running"' --reason reset --yes`.
- Projector: dark theme, large type — already tuned. Zoom the browser to ~110–125%.
- Header **fault pill** should read `⚡ Healthy` to start.

**Layout cheat-sheet** — **header:** brand + live *serverless-worker pill* (scale-to-zero, links to
the AWS console) + *fault toggle* pill. **Left column:** *Specialist console* (create, push partner,
burst, complete-all). **Main (tabs):** *Applications* (a status header with per-stage counts you can
click to filter, over the running list) and a **per-app detail tab** per opened row (progress strip,
facts with inline edit, Before/After/**Workflow code** toggle, lender callback, Open Workflow link).

---

## Run-of-show

### 1 · Create — minimal data in *(~0:45)*
- **Do:** In *Specialist console*, type a name (e.g. "Priya Chen") and phone, leave income on **T4**,
  click **Create application**. It appears in the **Applications** list; click the row to open its
  detail tab on the right.
- **Say:** "Minimal data in — name and phone — kicks off one **durable workflow** per application.
  One web page, not 80 screens."
- **Lands:** the front door; everything after is the same application.

### 2 · One timeline — observability before/after *(~1:30)*
- **Do:** In the app's detail tab, let the steps fill in. Toggle **Before — siloed Lambda logs**, then
  back to **After — one Temporal timeline**.
- **Say:** "Today, debugging this means stitching together *separate CloudWatch log groups* per Lambda
  — that's the 'Before'. Same application, **one orchestration-level trace** across all the isolated
  functions — that's Temporal. Click **Open Workflow** for the raw event history in the Temporal UI."
- **Point at:** the durable spine connecting every step; the per-Lambda silos in 'Before'.
- **Lands:** **Observability.**

### 3 · Hub intake — second channel, no lost messages *(~0:45)*
- **Do:** In *Specialist console*, click **Push from partner channel**. A new row appears tagged
  `partner` in the Applications list.
- **Say:** "Same workflow type, a **second channel** — including applications from outside BMO's
  portfolio. Delivered as a Signal via `signalWithStart`: **idempotent, no DLQ, no lost messages.**"
- **Lands:** the "hub"; **data quality** (nothing dropped).

### 4 · Income — traditional + gig *(~0:30)*
- **Do:** Create a second application with **Income document = Uber / gig stub**.
- **Say:** "Income across **T4 and gig** sources — your ML classifier for non-traditional income is
  just another activity in the same trace."
- **Lands:** fits BMO's real pipeline.

### 5 · Parallel cross-reference *(~0:30)*
- **Do:** In the hero app's detail tab, point to the `cross-reference` step and the facts grid.
- **Say:** "Customer book-of-record, credit, and risk — **three isolated internal Lambdas, run in
  parallel** and orchestrated as one step. One view of all of them."
- **Point at:** the `customer + credit + risk in parallel` detail; the facts grid populating.
- **Lands:** orchestrating many functions.

### 6 · Decision + the locked-field invariant *(~1:15)*
- **Do:** The hero app reaches a rate (facts show **Rate**, with 🔒 on the risk-sensitive fields). In
  the facts grid, click the **Rate** value, change it, save → **rejected inline**. Then click
  **Applicant**, edit, save → **accepted**.
- **Say:** "On rate assignment, risk-sensitive fields **lock**. Editing the rate is rejected
  **synchronously** by the workflow — the invariant lives in one place as a validated Update, not
  scattered guard code. Non-risk fields still edit fine."
- **Point at:** the inline `✗ locked after rate assignment` on the Rate field.
- **Lands:** **data quality / integrity**; the CIO code-quality story.
- **(Optional aside — branching logic):** open a **DECLINED** app (high-risk applicant, or
  `BMO_FORCE_DECISION=DECLINED`); its progress strip shows **rate + syndication skipped** (dashed,
  struck-through) — the workflow branched past them, and the UI shows exactly what ran.

### 7 · Break syndication *(~0:45)*
- **Do:** Click the header **fault pill** → it flips to `⚡ Fault injected` (amber). On the hero app
  (at syndication) an **amber retry banner** appears, and its list row highlights.
- **Say:** "A syndication partner just changed their schema — the **exact production incident** you
  described. Temporal **retries with backoff**; the application **holds its state**, nothing is lost."
- **Lands:** **resilience** setup. *(Under the hood this is a Temporal control workflow — the toggle
  works identically local and in cloud, no bolt-on control store.)*

### 8 · Triage & fix in place *(~1:30)* — *Hussain's explicit ask*
- **Do:** In the status header, click **Needs attention** — the list filters to the stuck app(s),
  highlighted with the failure reason. Open one: the detail tab shows the **retry banner (reason +
  attempt)**, full payload/facts, and **Open Workflow** for the event history. Click the header fault
  pill to **clear** the fault — the next retry succeeds and the run resumes; send **Lender funding
  callback (approve)** → **Offer issued**.
- **Say:** "The visual tool you asked for: **see it, decide, fix in place** — no DLQ forensics across
  files. Each blocked application is a first-class, inspectable workflow. Stakes: **$10M/incident,
  $21K/min**."
- **Lands:** **resilience / view-and-fix-stuck-work.**

### 9 · Burst + scale-to-zero *(~1:30)*
- **Do:** In *Specialist console*, set burst to ~30 and **Start N**. Watch the header
  **serverless-worker pill** climb from **0** as the WCI invokes workers on demand (on cloud these are
  real Lambda invocations spinning up from zero), and the status-header stage counts move. The apps
  park at syndication awaiting the callback — click **Complete all at syndication** to drain them, and
  watch the worker count **return to zero**.
- **Say:** "The serverless worker **scales from zero**, absorbs the burst, returns to zero — **no warm
  Lambdas 8–12 hours a day, no cold-start tax**. That's the cost story: you pay for the work, not for
  idle capacity." *(Local note: the local worker is concurrency-capped to simulate one Lambda; the
  true scale-from-zero is live on the cloud demo.)*
- **Point at:** the worker pill going 0 → N → 0.
- **Lands:** **scalability & cost.**

### 10 · Code reveal *(~1:00)*
- **Do:** In a detail tab, switch the observability toggle to **Workflow code** (syntax-highlighted).
- **Say:** "This is the whole thing — a short, **linear, readable TypeScript** function any UI engineer
  owns. Beside it, the retry / queue / DLQ / idempotency plumbing it **deletes**. Hire for business
  logic, not durability code."
- **Lands:** **skill gap.**

### 11 · (Optional) Safe deploys + filter *(~0:30)*
- **Do:** In the status header, click **Syndication** to show everything at that stage (custom Search
  Attributes). Mention Worker Versioning / PINNED (the cloud worker runs a PINNED Deployment Version).
- **Say:** "Filter the fleet by stage — custom Search Attributes, same in the Temporal UI. And ship
  new builds **while applications are in flight** with **Worker Versioning (PINNED)** — safe even with a
  rotating contractor team."
- **Lands:** **migration & maintainability.**

---

## If something misbehaves

- **A step looks stuck (not the fault demo):** confirm the worker is running (local) / the
  serverless-worker pill shows workers spinning up (cloud); the local in-memory dev server forgets
  state on restart.
- **Want a guaranteed approval:** start the local worker with `BMO_FORCE_DECISION=APPROVED` (drop it,
  or set `CONDITIONAL`/`DECLINED`, for variety).
- **Cluttered list (local):** `temporal workflow terminate --query 'ExecutionStatus="Running"' --reason reset --yes`.
- **Cluttered list (cloud):** delete completed workflows with the `temporal workflow delete --query
  "… ExecutionStatus = 'Completed'"` command from Pre-flight (scoped to `Completed` so it never touches
  the running fault-control workflow).
- **Fault left on:** click the header **fault pill** back to `⚡ Healthy` (otherwise it applies to new
  apps).
- **Serverless not available (cloud):** fall back to the long-lived worker — identical workflow/activity
  code (SPEC §6); the cost story becomes a slide.

## Concern → moment map

| BMO concern | Beat |
|-------------|------|
| Observability | 2 |
| Resilience / fix stuck work | 7–8 |
| Scalability & cost | 9 |
| Skill gap | 10 |
| Migration & maintainability | 11 |
| Data quality / integrity | 3, 6 |

## Q&A ammo — "200 items → Temporal primitives"

| Their pain today | Temporal primitive |
|------------------|--------------------|
| Durability / lost state | Durable workflow state + Event History |
| Retries / consistency | Built-in retry policies + backoff |
| Stuck messages / DLQs | First-class failed workflows; inspect + retry/resume |
| No orchestration-level logging | One timeline across all Lambdas |
| Idempotency | Idempotent activities + workflow IDs |
| Long waits (DocuSign, lawyers) | Durable timers + Signals, zero warm compute |
| Always-warm Lambda cost | Serverless workers scale-to-zero |
| Safe deploys w/ contractors | Worker Versioning (PINNED) |
| Skill gap | Linear TypeScript on the SDK |

*CDK still handles deploy/log classification; SonarQube/Dynatrace/CloudWatch stay — Temporal **adds**
the orchestration/durability layer they don't cover.*
