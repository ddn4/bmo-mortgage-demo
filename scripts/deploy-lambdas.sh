#!/usr/bin/env bash
#
# Deploy the business Lambdas + serverless worker Lambda + Temporal invoke role.
# Requires AWS creds (SA acct 429214323166) and SAM CLI. Region: us-east-1
# (co-located with the Temporal Cloud namespace).
#
# NOTE: the worker artifact needs the @temporalio/* native core-bridge built for
# LINUX — `sam build --use-container` builds it in a Lambda-like container.
#
# The worker's Temporal Cloud connection (address/namespace/api key) is injected
# as Lambda environment variables — @temporalio/lambda-worker reads them at
# startup (no temporal.toml interpolation). The API key is NoEcho + encrypted at
# rest on the function.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${AWS_REGION:=us-east-1}"
: "${FUNCTION_PREFIX:=bmo}"
: "${BUILD_ID:=v1}"
: "${TEMPORAL_ADDRESS:=us-east-1.aws.api.temporal.io:7233}"
: "${TEMPORAL_NAMESPACE:=ddn4-serverless-mortgage.sdvdw}"
: "${TEMPORAL_API_KEY:?set TEMPORAL_API_KEY (source ~/.config/bmo/temporal-cloud.env)}"
: "${TEMPORAL_EXTERNAL_ID:?set TEMPORAL_EXTERNAL_ID (confused-deputy guard; must match create-version)}"

echo "› building Lambda artifacts (business bundle + worker handler + workflow bundle)…"
npm run build:lambdas
npm run build:worker:lambda

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
    "TemporalAddress=${TEMPORAL_ADDRESS}" \
    "TemporalNamespace=${TEMPORAL_NAMESPACE}" \
    "TemporalApiKey=${TEMPORAL_API_KEY}" \
    "TemporalExternalId=${TEMPORAL_EXTERNAL_ID}"

# SAM's AutoPublishAlias only publishes a new Lambda version on CODE changes, so
# config/env-only changes (e.g. BMO_BUILD_ID, TEMPORAL_*) would not move :live.
# Explicitly publish $LATEST and repoint :live so the alias always reflects the
# latest code+config — :live is the ARN mapped to the Worker Deployment Version.
echo '› publishing $LATEST and repointing :live (capture config-only changes)…'
aws lambda wait function-updated --function-name "${FUNCTION_PREFIX}-worker" --region "$AWS_REGION"
NEWV=$(aws lambda publish-version --function-name "${FUNCTION_PREFIX}-worker" --region "$AWS_REGION" --query Version --output text)
aws lambda update-alias --function-name "${FUNCTION_PREFIX}-worker" --name live --function-version "$NEWV" --region "$AWS_REGION" >/dev/null
echo "  :live → version $NEWV"

echo "› done. Stack outputs (WorkerAliasArn, TemporalInvokeRoleArn) feed the Worker Deployment Version:"
aws cloudformation describe-stacks --region "$AWS_REGION" \
  --stack-name "${FUNCTION_PREFIX}-mortgage-lambdas" \
  --query 'Stacks[0].Outputs' --output table
