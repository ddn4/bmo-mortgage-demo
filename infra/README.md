# Cloud deploy (M5) — scaffolding & runbook

These artifacts are **authored and locally verified where possible, but not yet deployed.** M5 is the
cloud phase (Temporal Cloud + AWS) — start it only when you're ready to provision real resources. This
expands SPEC §8.

## What's here

| Path | What |
|------|------|
| `sam/template.yaml` | SAM: the 7 business Lambdas + the serverless worker Lambda (`AutoPublishAlias`) + the IAM role Temporal assumes (`sts:ExternalId`). Outputs the worker ARN + RoleARN. |
| `docker/Dockerfile` | Demo-app image — Fastify API serving the built React UI (single container). |
| `k8s/` | `deployment` + `service` + Traefik `ingressroute` + `secret.example` for the `sa-demo` cluster. |
| `temporal.toml.example` | Temporal Cloud client config the serverless worker loads at runtime. |
| `../scripts/build-lambdas.mjs` | esbuild → `.build/business/lambda.js` (7 handlers, `@bmo/shared` inlined). **Verified locally.** |
| `../scripts/build-worker-bundle.mjs` | `bundleWorkflowCode` → `workflow-bundle.js`. **Verified locally.** |
| `../scripts/build-worker-lambda.mjs` | esbuild the worker handler + copy the workflow bundle → `.build/worker/`. **Verified locally.** |
| `../scripts/deploy-lambdas.sh` | `sam build --use-container && sam deploy`. |
| `../scripts/set-current-version.sh` | create/set-current the Worker Deployment Version (PINNED). |
| `../scripts/deploy-app.sh` | build/push the image to ECR + `kubectl apply`. |

## Prerequisites (you arrange)

- **AWS** SA acct **429214323166**, write creds (`access account --aws-account-id 429214323166 --write`). Tools: AWS CLI, **SAM CLI**, Docker, kubectl, `tcld`.
- **Temporal Cloud**: an **AWS-hosted namespace in us-east-1**, an **API key**, and **Serverless Workers (pre-release) enabled** (request via the account team — the long-lead item). From onboarding you also get the **AWS principal ARN** Temporal uses to assume the invoke role.
- **`sa-demo` EKS** kubeconfig (us-west-1) + the `*.tmprl-demo.cloud` ingress.

## Order of operations

1. `cp infra/temporal.toml.example infra/temporal.toml` and fill in namespace (inject the API key out-of-band).
2. **Lambdas + role:** `TEMPORAL_PRINCIPAL_ARN=… TEMPORAL_EXTERNAL_ID=… npm run build:worker:lambda && scripts/deploy-lambdas.sh` → note the `WorkerAliasArn` + `TemporalInvokeRoleArn` outputs.
3. **Register Search Attributes** on the Cloud namespace via `tcld`/Cloud UI: `applicationStatus`, `channel` (Keyword). (Local dev auto-registers via OperatorService; **Cloud does not** — this is manual.)
4. **Worker Deployment Version:** `WORKER_ARN=… TEMPORAL_INVOKE_ROLE_ARN=… TEMPORAL_EXTERNAL_ID=… scripts/set-current-version.sh` (name+buildId must match the worker code: `bmo-mortgage-worker` / `BUILD_ID`).
5. **Demo-app:** create the `temporal-creds` Secret (see `k8s/secret.example.yaml`), then `scripts/deploy-app.sh`.

## ⚠ Needs live validation (can't be verified without the cloud + Linux build)

- **Worker native binary.** `@temporalio/worker` includes a native `core-bridge` (`.node`). The worker artifact must ship the **Linux** build — use `sam build --use-container`, a CI Linux build, or a Lambda layer. `build-worker-lambda.mjs` keeps `@temporalio/*` external and assembles the JS; the native deps are supplied at package time.
- **Serverless Workers is pre-release.** Confirm it's enabled in **us-east-1**, and verify the exact `temporal.toml` keys and the Worker-Deployment-Version → Lambda-ARN/role mapping subcommands against the current docs:
  https://docs.temporal.io/develop/typescript/workers/serverless-workers/aws-lambda
- **Versioned ARN.** The template uses `AutoPublishAlias: live` (a qualified, non-`$LATEST` ARN). If Temporal requires a numbered version, read it from the published version and map that instead.

## Fallback (GA safety net)

If Serverless Workers isn't ready, run the **long-lived worker** (`worker.local.ts` packaged on EKS/Fargate against the Cloud namespace) — identical workflow/activity code (SPEC §6). The cost story then falls back to a slide.
