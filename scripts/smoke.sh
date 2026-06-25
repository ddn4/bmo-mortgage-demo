#!/usr/bin/env bash
#
# Local smoke test: exercises the core demo flows against a running Temporal dev
# server. Builds, starts a worker + API, and asserts the happy path, the
# field-locking validator, and fault-injection recovery, then tears down.
#
# Prereq: `npm run temporal:dev` running in another terminal (localhost:7233).
# Usage:  npm run smoke
#
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TMP="$(mktemp -d)"
PYF() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }
fail() { echo "  ✗ $1"; FAILED=1; }

if ! nc -z localhost 7233 2>/dev/null; then
  echo "FAIL: Temporal not reachable on :7233 — run 'npm run temporal:dev' first."
  exit 1
fi

echo "› building…"
npm run build >/dev/null 2>&1 || { echo "FAIL: build"; exit 1; }

temporal workflow terminate --query 'ExecutionStatus="Running"' --reason "smoke reset" --yes >/dev/null 2>&1 || true

echo "› starting worker + API…"
BMO_FORCE_DECISION=APPROVED node packages/worker/dist/worker.local.js >"$TMP/worker.log" 2>&1 &
WPID=$!
node packages/api/dist/server.js >"$TMP/api.log" 2>&1 &
APID=$!
trap 'kill $WPID $APID 2>/dev/null; rm -rf "$TMP"' EXIT
for i in $(seq 1 30); do curl -sf localhost:8080/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -sf localhost:8080/api/health >/dev/null 2>&1 || { echo "FAIL: API did not start"; cat "$TMP/api.log"; exit 1; }

FAILED=0
API=localhost:8080

echo "› happy path: create → syndication → callback → offer"
ID=$(curl -sf -XPOST $API/api/applications -H 'content-type: application/json' -d '{"name":"Smoke Test"}' | PYF "d['id']")
for i in $(seq 1 30); do S=$(curl -sf $API/api/applications/$ID | PYF "d['status']"); { [ "$S" = SYNDICATION ] || [ "$S" = COMPLETED ]; } && break; sleep 1; done

echo "› field-locking: edit 'rate' should be rejected, 'applicant' accepted"
LOCK=$(curl -sf -XPOST $API/api/applications/$ID/edit -H 'content-type: application/json' -d '{"field":"rate","value":9.99}')
echo "$LOCK" | grep -q '"accepted":false' && echo "$LOCK" | grep -qi locked && echo "  ✓ locked-field edit rejected" || fail "rate edit not rejected: $LOCK"
OK2=$(curl -sf -XPOST $API/api/applications/$ID/edit -H 'content-type: application/json' -d '{"field":"applicant","value":"Smoke Renamed"}')
echo "$OK2" | grep -q '"accepted":true' && echo "  ✓ non-locked edit accepted" || fail "applicant edit not accepted: $OK2"

curl -sf -XPOST $API/api/applications/$ID/callback -H 'content-type: application/json' -d '{"approved":true}' >/dev/null
sleep 2
OUT=$(curl -sf $API/api/applications/$ID | PYF "d.get('outcome','')")
echo "$OUT" | grep -qi "Offer issued" && echo "  ✓ offer issued: $OUT" || fail "no offer: $OUT"

echo "› resilience: inject fault → retry → triage → clear → recover"
curl -sf -XPOST $API/api/fault -H 'content-type: application/json' -d '{"on":true}' >/dev/null
FID=$(curl -sf -XPOST $API/api/applications -H 'content-type: application/json' -d '{"name":"Fault Smoke"}' | PYF "d['id']")
REASON=""
for i in $(seq 1 40); do
  REASON=$(curl -sf $API/api/applications/$FID | PYF "next((p['lastFailure'] for p in d.get('pendingActivities',[]) if p.get('lastFailure')),'')")
  [ -n "$REASON" ] && break; sleep 1
done
echo "$REASON" | grep -qi schema && echo "  ✓ retrying with schema failure" || fail "never became stuck"
TRIAGE=$(curl -sf $API/api/triage | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
[ "${TRIAGE:-0}" -ge 1 ] && echo "  ✓ appears in triage ($TRIAGE)" || fail "not in triage"
curl -sf -XPOST $API/api/fault -H 'content-type: application/json' -d '{"on":false}' >/dev/null
RECOVERED=0
for i in $(seq 1 40); do
  D=$(curl -sf $API/api/applications/$FID | PYF "len([e for e in d['timeline'] if e['step']=='syndication' and e['status']=='COMPLETED'])")
  [ "${D:-0}" -ge 1 ] && { RECOVERED=1; break; }; sleep 2
done
[ "$RECOVERED" = 1 ] && echo "  ✓ recovered after fault cleared" || fail "did not recover"

echo
[ "$FAILED" = 0 ] && echo "SMOKE PASS ✓" || { echo "SMOKE FAIL ✗"; exit 1; }
