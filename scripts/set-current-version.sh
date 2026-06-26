#!/usr/bin/env bash
#
# Create (if needed) and set current the Worker Deployment Version in Temporal
# Cloud, mapping it to the deployed worker's versioned ARN + invoke role.
# deploymentName/buildId MUST match the worker code (DEPLOYMENT_NAME / BUILD_ID).
#
# Requires the `temporal` CLI configured for your Cloud namespace (env/temporal.toml).
# Exact subcommands/flags for the pre-release Serverless Workers mapping should be
# confirmed against the Temporal docs — this captures the inputs and shape.
set -euo pipefail

: "${DEPLOYMENT_NAME:=bmo-mortgage-worker}"
: "${BUILD_ID:=v1}"
: "${WORKER_ARN:?set WORKER_ARN (WorkerAliasArn from the SAM stack outputs)}"
: "${TEMPORAL_INVOKE_ROLE_ARN:?set TEMPORAL_INVOKE_ROLE_ARN (from the SAM stack outputs)}"
: "${TEMPORAL_EXTERNAL_ID:?set TEMPORAL_EXTERNAL_ID}"

echo "Worker Deployment Version inputs:"
echo "  deploymentName : $DEPLOYMENT_NAME"
echo "  buildId        : $BUILD_ID"
echo "  workerArn      : $WORKER_ARN"
echo "  roleArn        : $TEMPORAL_INVOKE_ROLE_ARN"
echo "  externalId     : (set)"

# Map the version to the Lambda ARN + invoke role (pre-release; confirm flags):
#   temporal worker deployment set-worker-arn \
#     --deployment-name "$DEPLOYMENT_NAME" --build-id "$BUILD_ID" \
#     --lambda-arn "$WORKER_ARN" --role-arn "$TEMPORAL_INVOKE_ROLE_ARN" \
#     --external-id "$TEMPORAL_EXTERNAL_ID"

echo "› setting current version…"
temporal worker deployment set-current-version \
  --deployment-name "$DEPLOYMENT_NAME" \
  --build-id "$BUILD_ID"

echo "› done. New mortgage applications now start on $DEPLOYMENT_NAME/$BUILD_ID (PINNED)."
