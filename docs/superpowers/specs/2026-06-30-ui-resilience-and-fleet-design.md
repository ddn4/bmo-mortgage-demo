# UI Resilience + Serverless Fleet Visibility — Design (2026-06-30)

## Context

M5 cloud is live and verified: serverless workers auto-invoke on Temporal Cloud + AWS Lambda
(scale-from-zero and burst auto-scaling both confirmed). Two UI changes follow from that:

1. **Fix a deployed-only bug** where the UI renders, then goes blank (multiple browsers).
2. **Surface the serverless fleet:** a live worker count (0→N→0) plus the static orchestrated-Lambda
   architecture (7 business Lambdas + 1 serverless worker).

The previously-illustrative **cost model is removed** — the live worker count is the punchier
scale-to-zero story, and a hardcoded cost comparison alongside it would read as redundant/weaker.

## Part 1 — Blank-screen resilience (bug)

**Problem.** There is no React error boundary anywhere. The polling `try/catch` in `App.tsx` guards the
*fetches*, not *rendering*. So when a poll returns an unexpected shape, a component throws during render
and React 18 unmounts the entire tree → blank page. Deployed-only ⇒ the trigger is a Temporal **Cloud**
workflow shape the local dev stack never produces. Prime suspect: a timeline step missing `at`, so
`fmtTime`'s `iso.slice(11, 23)` throws (`components.tsx:45`); other candidates are a non-array reaching a
`.map`, or a missing `detail`/`timeline` field.

**Fix (defense-in-depth + specific root cause).**
- Add an `ErrorBoundary` component. Wrap the whole app and each major panel (left-column panels and the
  right-column detail) so a render error shows a small inline fallback ("section hit an error —
  recovering…") and recovers on the next successful poll. The app never fully blanks again.
- Harden `api.ts`: check `res.ok` (and JSON content-type) before `.json()`; coerce `list`/`triage` to
  arrays; safe defaults for `metrics`/`fleet`. Never hand a non-array to `.map`.
- Harden render: `fmtTime` tolerates missing/short strings; optional-chaining + fallbacks on
  detail/timeline fields.
- Reproduce on the deployed URL, read the browser-console error, and fix the **exact** throwing field
  (the error boundary makes any *unforeseen* shape non-fatal regardless).

## Part 2 — Serverless fleet + Lambda counts (feature)

**API.** New `GET /api/fleet` → `{ workersRunning: number, businessLambdas: number, workerLambda: number }`.
- `workersRunning`: from Temporal — `describeTaskQueue` on `bmo-mortgage`, counting recently-active
  pollers (distinct worker identities within a recency window). 0 at idle, N under burst. **No AWS SDK.**
- `businessLambdas`: derived from the shared `LAMBDA` constant (currently 7) — not a magic number.
  `workerLambda`: 1.
- On any server-side error, return `{ workersRunning: 0, businessLambdas: 7, workerLambda: 1 }` so the
  panel never breaks.
- **Implementation detail to validate in the plan:** versioned/serverless task queues may require the
  enhanced describe or passing the current deployment version to get pollers. If poller-count proves
  unreliable for the versioned queue, fall back to worker-deployment-version task-queue stats. The
  returned interface stays `{ workersRunning, businessLambdas, workerLambda }` either way.

**UI.** `App` polls `/api/fleet` every 2s alongside `/api/metrics`. The **Operations** panel (renamed
from "Operations & cost") shows:
- a live **"Serverless workers running: N"** readout that animates 0→N→0, and
- a context line: **"orchestrating 7 business Lambdas via 1 serverless worker."**

Existing Operations readouts (in-flight / completed / needs-review) and controls (burst, complete-all)
remain unchanged.

## Removed

- The `CostModel` component, the always-warm-vs-serverless comparison, and its `.cost*` CSS.
- Panel title "Operations & cost" → "Operations".

## Files touched

- `packages/api/src/server.ts` — add `GET /api/fleet`; import the business-lambda count from `@bmo/shared`.
- `packages/ui/src/api.ts` — add `fleet()`; harden the fetch helpers (`res.ok`, array coercion, defaults).
- `packages/ui/src/components.tsx` — add `ErrorBoundary`; add the fleet readout to `OperationsPanel`;
  remove `CostModel`; harden `fmtTime` and `.map` sites.
- `packages/ui/src/App.tsx` — wrap in `ErrorBoundary`; poll `/api/fleet`; pass fleet to `OperationsPanel`.
- `packages/ui/src/types.ts` — add a `Fleet` type.
- `packages/ui/src/styles.css` — remove `.cost*`; add fleet-readout styling.

## Error handling

- **Fetch** failures: swallowed by the existing poll `try/catch` (keep polling).
- **Render** failures: caught by `ErrorBoundary` → inline fallback, auto-recovers next poll.
- **`/api/fleet`** server error: returns safe defaults (workers 0, 7 business, 1 worker).

## Testing

- Reproduce the blank screen on the deployed URL before the fix; confirm it's gone after. Force a render
  throw to confirm the boundary shows the inline fallback instead of a blank page.
- `/api/fleet`: returns `workersRunning: 0` at idle, `N` during a burst, back to 0 after scale-to-zero.
- Operations panel: renders the live worker count + architecture line; the cost comparison is gone.

## Out of scope

- CloudWatch / AWS-SDK cost or concurrency metrics (no new IAM or infra). Fleet data comes only from the
  existing Temporal client.
