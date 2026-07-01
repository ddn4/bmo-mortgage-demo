# UI restructure — status-header running list + per-app detail tabs

**Date:** 2026-07-01 · **Status:** Approved-in-review (revised after feedback) · **Scope:** mostly
front-end (`packages/ui`) plus two small additive API endpoints/tweaks (`packages/api`). No
workflow/Temporal changes.

## Problem

The right-hand `ApplicationDetail` faithfully recreates much of the Temporal UI's per-workflow view
(before/after observability, unified timeline, siloed-log "before"). It's a powerful visual, but it
**dominates the main screen**. The main panel should instead be a clean, dynamic list of
applications progressing through the pipeline; the deep per-workflow view should be opt-in. Several
adjacent panels are also due for cleanup (clunky Edit, a redundant Triage list, misleading
Operations copy, and a raw-text code panel).

## Goals

1. Main panel = a **streamlined running list**, one row per in-flight application with a live
   progress strip.
2. A **dynamic status header bar** above the list: one segment per pipeline stage (+ Completed, +
   Needs attention), each with a **live count**, and **clickable to filter** the list by that
   state. This is how a user views **Completed** apps after they clear from the default view.
3. The list shows **in-flight + stuck** by default and **clears an app when it reaches COMPLETED**.
4. Per-app detail (facts, observability, edit) opens in **in-app tabs**, off the main screen.
5. **Inline-editable facts** replace the clunky Edit panel (still demonstrates the field-locking
   validator with a synchronous, in-place rejection).
6. **Remove the Triage panel**; surface stuck apps in the main list (highlighted) and via the
   "Needs attention" header filter. Keep the **Inject/Clear fault** control (moved to the left rail).
7. **Fix the Operations copy** so the live serverless-worker count isn't contradicted by "via 1
   serverless worker."
8. **Workflow code** moves from a separate panel to a **third toggle beside Before/After** in the
   detail tab, rendered with **syntax highlighting**.
9. Remove the left-column `AppList`; rename "Open in Temporal UI ↗" → **"Open Workflow ↗"**.

Non-goals: no workflow/Temporal changes; no visual re-theme (reuse the dark operations-console
aesthetic and existing type/color tokens).

## Confirmed lifecycle facts (drive the filter/count design)

- Approved / declined / conditional → `setStatus(COMPLETED)` then `return` → execution **closes**
  (`ExecutionStatus=Completed`), `applicationStatus=COMPLETED`.
- Lender callback timeout → `setStatus(NEEDS_REVIEW)` then `return` → execution **closes**,
  `applicationStatus=NEEDS_REVIEW`.
- A syndication fault makes `syndicateToLenderPartner` **retry** → the workflow stays **Running**,
  `applicationStatus=SYNDICATION`, with retrying `pendingActivities`. This is the live "stuck" set,
  distinct from the closed `NEEDS_REVIEW` timeout.

⇒ "Clear at completed" keys off **`applicationStatus === 'COMPLETED'`** (not execution status).
`NEEDS_REVIEW` correctly stays visible (it needs attention). Retrying apps stay visible (still
in-flight).

## Layout & navigation

Two-column shell; each side's role changes.

```
┌────────────────────────────────────────────────────────────────┐
│ BMO × Capco × Temporal   — orchestrating BMO's existing Lambdas  │
├──────────────────┬─────────────────────────────────────────────┤
│  LEFT RAIL       │  [ Applications ] [ Jane B. #a1b2 ✕ ]        │ ← tab bar
│  (controls)      ├─────────────────────────────────────────────┤
│  Specialist      │  Intake 3 · Income 2 · X-ref 1 · Decision 0  │ ← status header
│  console         │  Rate 1 · Synd 4 · Completed 12 · ⚠Attn 2    │   (counts, click=filter)
│  Operations /    ├─────────────────────────────────────────────┤
│  fleet           │  #a1b2 Jane B.  ●━●━●━●━○─○─○  Rate  spec.   │
│  + Inject fault  │  #c3d4 M.Chen   ●━●━○─○─○─○─○  Income part.  │
│  + Burst / All   │  #e5f6 (partner)●━●━●━◍······ ⚠Synd retry    │
└──────────────────┴─────────────────────────────────────────────┘
```

- **Left rail** (persistent, all tabs): `SpecialistConsole`; `OperationsPanel` (fleet + reworded
  copy + burst + "complete all at syndication" + **Inject/Clear fault** toggle). No Triage panel.
- **Right = tabbed area**: `Applications` (permanent home) + closable per-app detail tabs. **No Code
  tab** (code now lives inside each detail tab). `AppList` removed.

## Status header bar (Applications tab)

A horizontal segmented bar above the running list. Segments (label / underlying filter):

| Segment | Filter applied |
|---|---|
| Intake / Income / Cross-ref / Decision / Rate / Syndication | `applicationStatus = <that stage>` |
| Completed | `applicationStatus = COMPLETED` |
| Needs attention ⚠ | the stuck set: retrying apps ∪ `applicationStatus = NEEDS_REVIEW` |

- Each segment shows a **live count**. Counts come from a new **`GET /api/status-counts`** endpoint:
  parallel `client.workflow.count()` per `applicationStatus` (excluding `ExecutionStatus=Terminated`,
  to match the list). "Needs attention" count = `/api/triage` set size + `NEEDS_REVIEW` count. This
  is accurate for any volume (bursts, accumulated completed) and worker-independent.
- **Default (no segment selected):** list shows in-flight + stuck, i.e. everything except
  `COMPLETED`. Counts for all segments still display (so Completed is visible as a number).
- **Click a segment:** filter the list to it (highlight the active segment). Stage/Completed
  segments fetch with `?status=<stage>`. **Needs attention** has no single status, so it fetches the
  default list (no `status` param — which already includes retrying-`SYNDICATION` and `NEEDS_REVIEW`
  rows) and filters client-side to the stuck set. **Click the active segment again** to clear back
  to the default view.
- Segments with count 0 are shown but dimmed/non-interactive.

## Running list (Applications tab body)

One compact row per application in the current view:

- Contents: `#id`, applicant (or "(partner)" when name absent), a **compact inline progress strip**
  (reuse `PIPELINE` + a `compact` `ProgressStrip` variant), a short status label, a channel chip.
- **Stuck rows** (id in the triage set, or `status=NEEDS_REVIEW`) are highlighted amber with a brief
  reason ("⚠ Syndication retrying" / "⚠ Needs review — callback timed out").
- Row click **opens/focuses** that app's detail tab.
- Sort: newest first (by `startTime`, as today).
- Empty state (default view): "No applications in flight — create one on the left, or burst a batch."

**Data:** `api.list(statusFilter)`; the list endpoint is tweaked so that **with no `status` param it
excludes `COMPLETED`** (default running view) — this keeps the 100-row cap spent on relevant rows
instead of accumulated completed apps. Stuck highlighting merges the already-fetched `/api/triage`
set. No per-workflow query on this screen (worker-independent, instant).

## Per-app detail tab

Body ≈ today's `ApplicationDetail`, revised:

- Header: applicant + `#id` + status badge + channel chip + decision chip.
- Full progress strip; retry banner when stuck.
- **Facts grid with inline editing** (see below).
- **Observability toggle with three options:** `[ Before ] [ After ] [ Workflow code ]`.
  - Before = siloed per-Lambda logs; After = one Temporal timeline (unchanged).
  - Workflow code = the `mortgageApplicationWorkflow` source (from `api.source()`),
    **syntax-highlighted** via `prism-react-renderer` (light, React-native; fine for one file).
- Lender funding-callback button (when at `SYNDICATION`).
- Deep link **`Open Workflow ↗`** (renamed) to the Temporal UI workflow page.

**Tab behavior:**
- Opening an already-open app focuses its tab (no duplicates).
- **Only the active tab polls** `api.get(id)` every 1s; background detail tabs pause and refresh on
  re-activation (avoids spinning up N workers for N idle tabs).
- A detail tab **stays open after its app completes** (review the finished timeline); its list row
  leaves the default view. Close via `✕`; closing the active tab falls back to `Applications`.
- Preserve the per-tab `ErrorBoundary` + "worker spinning up…" placeholder (a detail query can
  404/slow under scale-to-zero).

### Inline-editable facts (replaces the Edit panel)

The facts grid becomes the edit surface:

- Editable fields: `applicant`, `rate`, `creditScore` (the set the `editApplication` validator
  handles). Each shows a subtle ✎ affordance on hover; clicking turns the value into an inline input
  with save (Enter/✓) and cancel (Esc/✕).
- **Locked** risk-sensitive fields (`rate`, `creditScore` once `status ≥ RATE_ASSIGNED`) render a 🔒.
  They remain **attemptable** — editing one and saving sends the Update, and the validator's
  synchronous rejection is shown **inline on that field** ("✗ locked after rate assignment"). This
  is the field-locking demo beat, now on the real datum.
- Non-locked saves show a brief inline "✓ saved". Uses the existing `api.edit(id, field, value)`
  (numbers coerced for `rate`/`creditScore`). Removes the separate `EditPanel` component.

## Operations panel copy fix

- Keep the live **"Serverless workers running: N"** readout (distinct pollers via `describeTaskQueue`).
- Replace the misleading sub-line "orchestrating 7 business Lambdas via 1 serverless worker" with
  wording that doesn't imply a single worker, e.g.:
  **"N running now · one serverless worker Lambda, scaling to zero · orchestrating 7 business
  Lambdas."** (Distinguish the *one worker function* from its *N concurrent invocations*.) Keep the
  AWS console link.
- Add the **Inject/Clear fault** toggle here (moved from the removed Triage panel), alongside burst
  and "complete all at syndication."

## Component & file changes

`packages/api/src/server.ts`
- New `GET /api/status-counts` → `{ INTAKE, INCOME_VERIFICATION, CROSS_REFERENCE, DECISION,
  RATE_ASSIGNED, SYNDICATION, COMPLETED, NEEDS_REVIEW }` via parallel `client.workflow.count()`
  (each `... AND ExecutionStatus != 'Terminated'`). (Frontend derives "Needs attention" =
  triage set + NEEDS_REVIEW.)
- `GET /api/applications`: when `status` param absent, append `AND applicationStatus != 'COMPLETED'`.

`packages/ui/src/api.ts` / `types.ts`
- Add `api.statusCounts()` + a `StatusCounts` type. (Everything else already exists.)

`packages/ui/src/App.tsx`
- Tab state: `openTabs: string[]`, `activeTab: 'applications' | <appId>`; `statusFilter` drives the
  list + header selection. Remove `selectedId`/`AppList`. Poll list/triage/fault/metrics/fleet +
  **status-counts** every 2s; poll `api.get(activeTab)` every 1s only when a per-app tab is active.
  `onCreated` opens/focuses the new app's tab.

`packages/ui/src/components.tsx`
- New `TabBar`; new `StatusHeader` (segments + counts + active filter); new `RunningList` (compact
  rows, stuck highlight, empty state). `ApplicationDetail` revised: three-way observability toggle
  incl. syntax-highlighted code; inline-editable facts (remove `EditPanel`). Remove `AppList`,
  `TriagePanel`, `CodeRevealPanel` (fixed tab); rename the deep-link label. Add compact
  `ProgressStrip` variant.

`packages/ui/src/styles.css`
- Tab-bar, status-header segments, compact list rows/inline progress, inline-edit fields, code
  highlighting container. Reuse existing tokens (Space Grotesk / IBM Plex, teal→blue spine, amber
  frontier).

`packages/ui/package.json`
- Add `prism-react-renderer`.

## Testing / verification

- `npm run dev`; exercise: create → row appears, progress advances, header counts update →
  open detail tab → Before/After/Workflow-code toggle (highlighted source) → inline-edit applicant
  (✓ saved) → after rate assignment, inline-edit `rate` → inline "✗ locked" → callback → row clears
  from default view (tab stays open), Completed count +1, visible under the Completed filter.
- Inject fault → affected row stays, highlights amber, "Needs attention" count +1, filterable;
  clear fault → resumes → clears at COMPLETED.
- `npm run smoke` still passes (backend additions are additive).
- Screenshots best-effort (headless Chrome hangs on the polling page — known); rely on the flow.

## Out of scope / future

- Tab reordering/pinning or persisting open tabs across reload.
- A dedicated stuck-resolution surface beyond the detail tab's retry banner + inline edit.
- `GROUP BY` count optimization (parallel per-status counts are sufficient at demo scale).
