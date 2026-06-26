# BMO Mortgage Demo — Presenter Script

A tight **~11-minute** live flow. The presenter drives the UI; the business narrator (Hussain) tells
the BMO story. Beats follow SPEC §12; this is the concrete, click-by-click version grounded in the
built UI. **Everything here runs locally today** except the serverless scale-to-zero beat (#9), which
is the cloud phase (M5) — the cost panel is shown live now as the illustrative model.

> **Hold the guardrails throughout:** everything is **TypeScript**; we **orchestrate** BMO's existing
> Lambdas, we don't replace them; these are **internal** functions; Temporal **complements**
> CloudWatch/Dynatrace/SonarQube. Stakes to weave in: **up to $10M CAD/incident · ~$21K CAD/min** of
> payment downtime.

---

## Pre-flight (before the room)

```bash
# terminal 1 — local Temporal cluster + Temporal UI at http://localhost:8233
npm run temporal:dev

# terminal 2 — worker + API + UI together; force a clean APPROVED hero flow
BMO_FORCE_DECISION=APPROVED npm run dev
```

- Open **http://localhost:5173** (the demo UI) and **http://localhost:8233** (Temporal UI) in two tabs.
- Smoke it once: `npm run smoke` (separate terminal) should print `SMOKE PASS ✓`.
- Fresh state: the dev server is in-memory, so a restart clears it. Mid-session reset:
  `temporal workflow terminate --query 'ExecutionStatus="Running"' --reason reset --yes`.
- Projector: dark theme, large type — already tuned. Zoom the browser to ~110–125%.
- Have the Triage fault toggle **off** to start (the panel shows `healthy`).

**Layout cheat-sheet** — left column: *Specialist console*, *Operations & cost*, *Applications*
(with status filter), *Triage & resolve*. Right column: the selected application (progress strip,
facts, before/after timeline, edit, lender callback) and the collapsible *Workflow source*.

---

## Run-of-show

### 1 · Create — minimal data in *(~0:45)*
- **Do:** In *Specialist console*, type a name (e.g. "Priya Chen") and phone, leave income on **T4**,
  click **Create application**. It auto-selects and opens on the right.
- **Say:** "Minimal data in — name and phone — kicks off one **durable workflow** per application.
  One web page, not 80 screens."
- **Lands:** the front door; everything after is the same application.

### 2 · One timeline — observability before/after *(~1:30)*
- **Do:** On the right, let the steps fill in. Toggle **Before — siloed Lambda logs**, then back to
  **After — one Temporal timeline**.
- **Say:** "Today, debugging this means stitching together *separate CloudWatch log groups* per Lambda
  — that's the 'Before'. Same application, **one orchestration-level trace** across all the isolated
  functions — that's Temporal. Click into the **Temporal UI** for the raw event history."
- **Point at:** the durable spine connecting every step; the per-Lambda silos in 'Before'.
- **Lands:** **Observability.**

### 3 · Hub intake — second channel, no lost messages *(~0:45)*
- **Do:** In *Specialist console*, click **Push from partner channel**. A new app appears tagged
  `partner`.
- **Say:** "Same workflow type, a **second channel** — including applications from outside BMO's
  portfolio. Delivered as a Signal via `signalWithStart`: **idempotent, no DLQ, no lost messages.**"
- **Lands:** the "hub"; **data quality** (nothing dropped).

### 4 · Income — traditional + gig *(~0:30)*
- **Do:** Create a second application with **Income document = Uber / gig stub**.
- **Say:** "Income across **T4 and gig** sources — your ML classifier for non-traditional income is
  just another activity in the same trace."
- **Lands:** fits BMO's real pipeline.

### 5 · Parallel cross-reference *(~0:30)*
- **Do:** On the hero app's timeline, point to the `cross-reference` step.
- **Say:** "Customer book-of-record, credit, and risk — **three isolated internal Lambdas, run in
  parallel** and orchestrated as one step. One view of all of them."
- **Point at:** the `customer + credit + risk in parallel` detail; the facts grid populating.
- **Lands:** orchestrating many functions.

### 6 · Decision + the locked-field invariant *(~1:15)*
- **Do:** The hero app reaches a rate (facts show **Rate**, with 🔒 on the risk-sensitive fields). In
  the **Edit** panel pick `rate`, type a value, **Apply edit** → **rejected**. Then pick `applicant`,
  apply → **accepted**.
- **Say:** "On rate assignment, risk-sensitive fields **lock**. Editing the rate is rejected
  **synchronously** by the workflow — the invariant lives in one place as a validated Update, not
  scattered guard code. Non-risk fields still edit fine."
- **Point at:** `✗ rejected — Field 'rate' is locked after rate assignment`.
- **Lands:** **data quality / integrity**; the CIO code-quality story.

### 7 · Break syndication *(~0:45)*
- **Do:** In *Triage & resolve*, click **Inject fault** (indicator flips to `BROKEN`). On the hero app
  (at syndication) an **amber retry banner** appears.
- **Say:** "A syndication partner just changed their schema — the **exact production incident** you
  described. Temporal **retries with backoff**; the application **holds its state**, nothing is lost."
- **Lands:** **resilience** setup.

### 8 · Triage & fix in place *(~1:30)* — *Hussain's explicit ask*
- **Do:** In *Triage & resolve*, the stuck app is a card with its **failure reason, payload, and an
  event-history link**. Click it to inspect. Then click **Clear fault** — the next retry succeeds and
  the run resumes; send **Lender funding callback (approve)** → **Offer issued**.
- **Say:** "The visual tool you asked for: **see it, decide, fix in place** — no DLQ forensics across
  files. Each blocked application is a first-class, inspectable workflow. Stakes: **$10M/incident,
  $21K/min**."
- **Lands:** **resilience / view-and-fix-stuck-work.**

### 9 · Burst + cost *(~1:30)*
- **Do:** In *Operations & cost*, set burst to ~30 and **Start N applications**. Watch **In-flight**
  climb and drain (the local worker is concurrency-capped to *simulate* one Lambda). Open the **cost**
  panel.
- **Say:** "The serverless worker **scales from zero**, absorbs the burst, returns to zero — **no warm
  Lambdas 8–12 hours a day, no cold-start tax**. Here's the bill difference." *(Local note: this shows
  the queue absorbing load and the cost model; true scale-to-zero is the live cloud demo — M5.)*
- **Point at:** the **% lower** figure; always-warm vs serverless cells.
- **Lands:** **scalability & cost.**

### 10 · Code reveal *(~1:00)*
- **Do:** Expand **Workflow source** (right column).
- **Say:** "This is the whole thing — a short, **linear, readable TypeScript** function any UI engineer
  owns. Beside it, the retry / queue / DLQ / idempotency plumbing it **deletes**. Hire for business
  logic, not durability code."
- **Lands:** **skill gap.**

### 11 · (Optional) Safe deploys + filter *(~0:30)*
- **Do:** Use the **status filter** to show "everything at SYNDICATION" (custom Search Attributes).
  Mention Worker Versioning / PINNED.
- **Say:** "Filter the fleet by status — custom Search Attributes, same in the Temporal UI. And ship
  new builds **while applications are in flight** with **Worker Versioning (PINNED)** — safe even with a
  rotating contractor team."
- **Lands:** **migration & maintainability.**

---

## If something misbehaves

- **A step looks stuck (not the fault demo):** confirm the worker terminal is running; the in-memory
  dev server forgets state on restart.
- **Want a guaranteed approval:** the worker was started with `BMO_FORCE_DECISION=APPROVED`. Drop it
  (or set `CONDITIONAL`/`DECLINED`) for variety.
- **Cluttered list:** `temporal workflow terminate --query 'ExecutionStatus="Running"' --reason reset --yes`.
- **Fault left on:** *Triage* → **Clear fault** (or it persists for new apps).
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
