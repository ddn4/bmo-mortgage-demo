# Header rebrand + business-Lambda counter — design

**Date:** 2026-07-02
**Scope:** UI polish only (`packages/ui`). No API/server, workflow, activity, or infra changes.

## Motivation

Two presenter-facing header issues:

1. The `BMO × Capco × Temporal` text brand is off-brand and includes Capco (dropped).
   Temporal has a published brand lockup we should use.
2. The header's worker pill doubles as an AWS-console link and carries "scale-to-zero ↗"
   text that isn't useful live. We want a second, distinct metric — a **lambdas** counter —
   that reinforces the locked "orchestrate Lambda, don't replace it" guardrail.

## Part 1 — Header rebrand

Replace the text brand with the Temporal horizontal lockup + a product title.

Target layout:

```
[◇ Temporal] │ BMO Mortgage Pipeline        ● 3 workers   ◆ 128 lambdas   ⚡ Healthy
 (logo)      │ ▸ orchestrating BMO's existing AWS Lambdas
```

- **Logo:** vendor the *light* lockup SVG locally at
  `packages/ui/src/assets/temporal-lockup.svg` (source:
  `https://images.ctfassets.net/0uuz8ydxyd9p/PxaOnuShCYwyX58rxnhrj/ac10c21a73d4f35f9c852348581dd9f1/Temporal_LogoLockup_Horizontal_light_1.svg`).
  Its `#F2F2F2` fill suits the dark `--void` header. **Not** hotlinked from Contentful — the
  deployed demo must have no external asset dependency. Rendered at a fixed height (~30px),
  width auto from the SVG aspect ratio. **No recolor** — brand rule; the lockup keeps its own color.
- **Divider:** thin vertical `--line` rule between the logo and the BMO text.
- **Title:** `BMO Mortgage Pipeline` in the display font, `--bmo` blue, emphasized (product name).
- **Tagline:** keep `orchestrating BMO's existing AWS Lambdas` with the existing `▸` mono
  treatment, under the title.
- **Capco removed:** the text, the `--capco` CSS var, and the now-dead `.brand-capco` /
  `.brand-x` rules (confirmed used only by the old brand markup).
- Logo is **not** a link (keeps the live demo self-contained).

## Part 2 — Header status pills

Two distinct pills mirroring the architecture (serverless worker → invokes → business Lambdas):

- **`● N workers`** — existing live count (distinct workflow-queue pollers; 0 at idle). Keep the
  pulsing dot. **Remove** the AWS-console `href` and the `· scale-to-zero ↗` text. Reword the
  tooltip to drop the "open the AWS console" line.
- **`◆ M lambdas`** — **new.** Business-Lambda invocations Temporal has orchestrated. Distinct
  accent (`--bmo` blue vs the workers' teal). Tooltip: "business-Lambda invocations orchestrated
  across the pipeline (intake, income, customer, credit, risk, rate, syndication)."

### Derivation

Computed **client-side** from the `counts` (server-side `/api/status-counts`) the UI already polls
every 2s. No server change, no extra Temporal calls, near-zero lag, identical local + cloud —
in the same Temporal-native spirit as the reference METRICS.md's move off CloudWatch.

Cumulative business-Lambda calls implied by each status (from `mortgage-application.ts`):

| status | calls | note |
|---|---|---|
| INTAKE | 1 | intake |
| INCOME_VERIFICATION | 2 | + income |
| CROSS_REFERENCE | 5 | + customer, credit, risk (parallel) |
| DECISION | 5 | decision is a durable timer — no Lambda |
| RATE_ASSIGNED | 6 | + rate |
| SYNDICATION | 7 | + syndication |
| NEEDS_REVIEW | 7 | reached syndication, callback timed out |
| COMPLETED | 7 | happy path |

`businessInvocations = Σ counts[s] × table[s]`, a small pure helper. Uses `counts` (accurate
server-side distribution), **not** `headerCounts` (filter/list-derived). Because COMPLETED only
grows, the number climbs and persists across the demo.

**Caveats (code comments, not UI):** a DECLINED app actually stops at 5 but is counted as 7 (minor
overcount); retries and the injected syndication fault add real invocations this model doesn't see
(minor undercount). The label "orchestrated" is honest about being a model of pipeline progress.

## Files touched (UI only)

- `packages/ui/src/assets/temporal-lockup.svg` *(new — vendored)*
- `packages/ui/src/App.tsx` — header markup; compute + pass `businessInvocations`
- `packages/ui/src/components.tsx` — `HeaderStatus` (two pills)
- `packages/ui/src/styles.css` — brand/logo/title styles, second pill style, remove Capco bits
- Small pure helper for the derivation (inline in `App.tsx` or a one-function util)

## Out of scope

No API/server changes, no favicon/page-title change, no logo hotlinking.
