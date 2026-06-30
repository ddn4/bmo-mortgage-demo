#!/usr/bin/env bash
#
# Create (if needed) and set current the Worker Deployment Version in Temporal
# Cloud, mapping it to the deployed worker's versioned ARN + invoke role via the
# AWS Lambda compute provider (Serverless Workers).
# deploymentName/buildId MUST match the worker code (DEPLOYMENT_NAME / BUILD_ID).
#
# Connection comes from env: TEMPORAL_ADDRESS / TEMPORAL_NAMESPACE / TEMPORAL_API_KEY
# (source ~/.config/bmo/temporal-cloud.env). The `temporal` CLI auto-enables TLS
# when an API key is present.
set -euo pipefail

: "${DEPLOYMENT_NAME:=bmo-mortgage-worker}"
: "${BUILD_ID:=v1}"
: "${TEMPORAL_ADDRESS:=us-east-1.aws.api.temporal.io:7233}"
: "${TEMPORAL_NAMESPACE:=ddn4-serverless-mortgage.sdvdw}"
: "${TEMPORAL_API_KEY:?set TEMPORAL_API_KEY (source ~/.config/bmo/temporal-cloud.env)}"
: "${WORKER_ARN:?set WORKER_ARN (WorkerAliasArn from the SAM stack outputs)}"
: "${TEMPORAL_INVOKE_ROLE_ARN:?set TEMPORAL_INVOKE_ROLE_ARN (TemporalInvokeRoleArn from the SAM stack outputs)}"
: "${TEMPORAL_EXTERNAL_ID:?set TEMPORAL_EXTERNAL_ID (must match the value baked into the invoke role)}"

export TEMPORAL_ADDRESS TEMPORAL_NAMESPACE TEMPORAL_API_KEY

echo "Worker Deployment Version inputs:"
echo "  namespace      : $TEMPORAL_NAMESPACE"
echo "  deploymentName : $DEPLOYMENT_NAME"
echo "  buildId        : $BUILD_ID"
echo "  lambdaArn      : $WORKER_ARN"
echo "  assumeRoleArn  : $TEMPORAL_INVOKE_ROLE_ARN"
echo "  externalId     : (set)"

# 1) Pre-define the Worker Deployment so create-version succeeds for a serverless
#    Worker (lazy creation only happens when a real Worker polls). Tolerate "already exists".
echo "› ensuring Worker Deployment exists…"
temporal worker deployment create \
  --namespace "$TEMPORAL_NAMESPACE" \
  --name "$DEPLOYMENT_NAME" 2>&1 | sed 's/^/  /' || echo "  (deployment already exists — continuing)"

# 2) Create the Version with the AWS Lambda compute provider (the serverless mapping).
echo "› creating Worker Deployment Version with AWS Lambda compute provider…"
temporal worker deployment create-version \
  --namespace "$TEMPORAL_NAMESPACE" \
  --deployment-name "$DEPLOYMENT_NAME" \
  --build-id "$BUILD_ID" \
  --aws-lambda-function-arn "$WORKER_ARN" \
  --aws-lambda-assume-role-arn "$TEMPORAL_INVOKE_ROLE_ARN" \
  --aws-lambda-assume-role-external-id "$TEMPORAL_EXTERNAL_ID"

# 3) Make it current (PINNED): new mortgage applications start on this version.
echo "› setting current version…"
temporal worker deployment set-current-version \
  --namespace "$TEMPORAL_NAMESPACE" \
  --deployment-name "$DEPLOYMENT_NAME" \
  --build-id "$BUILD_ID" \
  --yes

echo "› done. New mortgage applications now start on $DEPLOYMENT_NAME/$BUILD_ID (PINNED),"
echo "  invoked on demand from $WORKER_ARN."
