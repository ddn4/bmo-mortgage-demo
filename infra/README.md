# Cloud deploy (M5) — scaffolding & runbook

These artifacts are **authored and locally verified where possible, but not yet deployed.** M5 is the
cloud phase (Temporal Cloud + AWS) — start it only when you're ready to provision real resources. This
expands SPEC §8.

## What's here

| Path | What |
|------|------|
| `sam/template.yaml` | SAM: the 7 business Lambdas + the serverless worker Lambda (`AutoPublishAlias`, Temporal connection via env vars) + the IAM invoke role (trusts the 5 Temporal WCI principals, `sts:ExternalId`). Outputs the worker ARN + RoleARN. |
| `docker/Dockerfile` | Demo-app image — Fastify API serving the built React UI (single container). |
| `k8s/` | `deployment` + `service` + Traefik `ingressroute` + `secret.example` for the `sa-demo` cluster. |
| `temporal.toml.example` | Sample Temporal client config (for local/CLI use). The deployed worker connects via Lambda **env vars**, not this file. |
| `../scripts/build-lambdas.mjs` | esbuild → `.build/business/lambda.js` (7 handlers, `@bmo/shared` inlined). **Verified locally.** |
| `../scripts/build-worker-bundle.mjs` | `bundleWorkflowCode` → `workflow-bundle.js`. **Verified locally.** |
| `../scripts/build-worker-lambda.mjs` | esbuild the worker handler + copy the workflow bundle → `.build/worker/`. **Verified locally.** |
| `../scripts/deploy-lambdas.sh` | `sam build --use-container && sam deploy`. |
| `../scripts/set-current-version.sh` | `create` → `create-version` (AWS Lambda compute provider) → `set-current-version` (PINNED). |
| `../scripts/deploy-app.sh` | build/push the image to ECR + `kubectl apply`. |

## Prerequisites (you arrange)

- **AWS** SA acct **429214323166**, write creds (`access account --aws-account-id 429214323166 --write`). Tools: AWS CLI, **SAM CLI**, Docker, kubectl, `temporal-cloud` (the pre-release Cloud CLI that replaces `tcld`), and `temporal` (for the Worker Deployment Version commands).
- **Temporal Cloud**: an **AWS-hosted namespace in us-east-1** (`ddn4-serverless-mortgage.sdvdw`), an **API key**, and **Serverless Workers (pre-release) enabled**. No onboarding "principal ARN" is needed — the invoke role trusts the **five fixed Temporal WCI principals** baked into `sam/template.yaml` (see the [AWS Lambda serverless-workers docs](https://docs.temporal.io/production-deployment/worker-deployments/serverless-workers/aws-lambda#configure-iam)). The **External ID** is a confused-deputy guard *you* choose.
- **`sa-demo` EKS** kubeconfig (us-west-1) + the `*.tmprl-demo.cloud` ingress.

> **Credentials.** Steps below source `~/.config/bmo/temporal-cloud.env`, which exports `TEMPORAL_API_KEY`, `TEMPORAL_EXTERNAL_ID`, `AWS_PROFILE`, and `AWS_REGION=us-east-1`. The worker's Temporal connection is injected as **Lambda env vars** (`TEMPORAL_ADDRESS/NAMESPACE/API_KEY`) — no `temporal.toml` is packaged.

## Order of operations

1. **Lambdas + role:** `source ~/.config/bmo/temporal-cloud.env && scripts/deploy-lambdas.sh` → note the `WorkerAliasArn` + `TemporalInvokeRoleArn` outputs. (Region `us-east-1`; the worker connection env vars default to the demo namespace.)
2. **Register Search Attributes** on the Cloud namespace with the `temporal-cloud` CLI (one per call; Local dev auto-registers via OperatorService, **Cloud does not** — this is manual):
   ```bash
   temporal-cloud namespace search-attribute create --idempotent \
     --namespace ddn4-serverless-mortgage.sdvdw --name applicationStatus --type Keyword
   temporal-cloud namespace search-attribute create --idempotent \
     --namespace ddn4-serverless-mortgage.sdvdw --name channel --type Keyword
   ```
3. **Worker Deployment Version:** `WORKER_ARN=… TEMPORAL_INVOKE_ROLE_ARN=… scripts/set-current-version.sh` (sources the env for `TEMPORAL_EXTERNAL_ID` + connection). Runs `create` → `create-version` (AWS Lambda compute provider) → `set-current-version`. `name`+`buildId` must match the worker code: `bmo-mortgage-worker` / `BUILD_ID` (`v1`).
4. **Demo-app:** create the `temporal-creds` Secret (see `k8s/secret.example.yaml`), then `scripts/deploy-app.sh`.

## ⚠ Needs live validation (can't be verified without the cloud + Linux build)

- **Worker native binary.** `@temporalio/worker` includes a native `core-bridge` (`.node`). The worker artifact must ship the **Linux** build (runtime `nodejs22.x`, arm64) — `sam build --use-container` builds it in a Lambda-like container. `build-worker-lambda.mjs` keeps `@temporalio/*` external and assembles the JS; the native deps are supplied at package time.
- **Versioned ARN.** The template uses `AutoPublishAlias: live` (a qualified, non-`$LATEST` ARN). `create-version --aws-lambda-function-arn` accepts a qualified or unqualified ARN; the invoke-role policy allows `…:*` so any published version is invokable.

## Fallback (GA safety net)

If Serverless Workers isn't ready, run the **long-lived worker** (`worker.local.ts` packaged on EKS/Fargate against the Cloud namespace) — identical workflow/activity code (SPEC §6). The cost story then falls back to a slide.
