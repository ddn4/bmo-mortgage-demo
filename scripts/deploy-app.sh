#!/usr/bin/env bash
#
# Build the demo-app (UI+API) image, push to ECR, and deploy to the sa-demo EKS
# cluster (us-west-1). Requires AWS creds, docker, kubectl (kubeconfig for sa-demo).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${AWS_ACCOUNT_ID:=429214323166}"
: "${ECR_REGION:=us-west-1}"
: "${IMAGE_REPO:=bmo-demo-app}"
: "${IMAGE_TAG:=latest}"
ECR="${AWS_ACCOUNT_ID}.dkr.ecr.${ECR_REGION}.amazonaws.com"
IMAGE="${ECR}/${IMAGE_REPO}:${IMAGE_TAG}"

echo "› ensuring ECR repo exists…"
aws ecr describe-repositories --region "$ECR_REGION" --repository-names "$IMAGE_REPO" >/dev/null 2>&1 \
  || aws ecr create-repository --region "$ECR_REGION" --repository-name "$IMAGE_REPO" >/dev/null

echo "› docker build + push ${IMAGE}…"
aws ecr get-login-password --region "$ECR_REGION" | docker login --username AWS --password-stdin "$ECR"
docker build --platform linux/amd64 -f infra/docker/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"

echo "› ensure temporal-creds secret exists (see infra/k8s/secret.example.yaml)…"
kubectl get secret temporal-creds >/dev/null 2>&1 || {
  echo "ERROR: create the temporal-creds Secret first."; exit 1;
}

echo "› applying manifests (image pinned to $IMAGE)…"
sed "s#REPLACE_WITH_ECR_IMAGE#${IMAGE}#" infra/k8s/deployment.yaml | kubectl apply -f -
kubectl apply -f infra/k8s/service.yaml
kubectl apply -f infra/k8s/ingressroute.yaml
kubectl rollout status deployment/bmo-demo-app

echo "› done. Public URL per the IngressRoute host (e.g. https://bmo-mortgage.tmprl-demo.cloud)."
