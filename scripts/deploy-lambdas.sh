#!/usr/bin/env bash
#
# Deploy the business Lambdas + serverless worker Lambda + Temporal invoke role.
# Requires AWS creds (SA acct 429214323166) and SAM CLI. Region: us-east-1.
#
# NOTE: the worker artifact needs the @temporalio/* native core-bridge built for
# LINUX — `sam build --use-container` builds it in a Lambda-like container. The
# pre-release lambda-worker packaging should be confirmed against its docs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${AWS_REGION:=us-east-1}"
: "${FUNCTION_PREFIX:=bmo}"
: "${BUILD_ID:=v1}"
: "${TEMPORAL_PRINCIPAL_ARN:?set TEMPORAL_PRINCIPAL_ARN (from Temporal serverless-workers onboarding)}"
: "${TEMPORAL_EXTERNAL_ID:?set TEMPORAL_EXTERNAL_ID (shared secret for sts:ExternalId)}"

echo "› building Lambda artifacts (business bundle + worker handler + workflow bundle)…"
npm run build:lambdas
npm run build:worker:lambda

# Package temporal.toml with the worker artifact (fill infra/temporal.toml first).
if [ -f infra/temporal.toml ]; then
  cp infra/temporal.toml infra/.build/worker/temporal.toml
else
  echo "WARN: infra/temporal.toml not found — copy infra/temporal.toml.example and fill it in."
fi

echo "› sam build (use --use-container for the worker's Linux native deps)…"
sam build --use-container --template infra/sam/template.yaml

echo "› sam deploy…"
sam deploy \
  --stack-name "${FUNCTION_PREFIX}-mortgage-lambdas" \
  --region "$AWS_REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-confirm-changeset \
  --resolve-s3 \
  --parameter-overrides \
    "FunctionPrefix=${FUNCTION_PREFIX}" \
    "BuildId=${BUILD_ID}" \
    "TemporalPrincipalArn=${TEMPORAL_PRINCIPAL_ARN}" \
    "TemporalExternalId=${TEMPORAL_EXTERNAL_ID}"

echo "› done. Stack outputs (WorkerAliasArn, TemporalInvokeRoleArn) feed the Worker Deployment Version:"
aws cloudformation describe-stacks --region "$AWS_REGION" \
  --stack-name "${FUNCTION_PREFIX}-mortgage-lambdas" \
  --query 'Stacks[0].Outputs' --output table
