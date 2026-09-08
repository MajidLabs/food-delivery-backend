#!/usr/bin/env bash
#
# health-check.sh - end-to-end smoke test for the Food Delivery Backend.
#
# Exercises the full happy path (register -> login -> place an order ->
# async payment processing -> confirmed) plus the main negative paths
# (400/401/403/404/409), against a stack that's already running - either
# `docker compose up` or the four services started locally.
#
# Requirements: bash, curl, python3
#
# Usage:
#   ./scripts/health-check.sh
#   BASE_URL=http://localhost:3000 ./scripts/health-check.sh
#
# Exit code is 0 if every check passed, 1 otherwise (so it's safe to use in
# other scripts or CI: `./scripts/health-check.sh || echo "stack is unhealthy"`).

set -o pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
USER_HEALTH="${USER_HEALTH:-http://localhost:3001/health}"
ORDER_HEALTH="${ORDER_HEALTH:-http://localhost:3002/health}"
PAYMENT_HEALTH="${PAYMENT_HEALTH:-http://localhost:3003/health}"

for bin in curl python3; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "Error: '$bin' is required but was not found in PATH." >&2
    exit 1
  }
done

if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
  GREEN=""; RED=""; BOLD=""; RESET=""
else
  GREEN="\033[32m"; RED="\033[31m"; BOLD="\033[1m"; RESET="\033[0m"
fi

PASS=0
FAIL=0
LAST_BODY=""
EXTRA_HEADERS=()

pass() { PASS=$((PASS + 1)); printf "  ${GREEN}PASS${RESET}  %s\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "  ${RED}FAIL${RESET}  %s\n" "$1"; }
section() { printf "\n${BOLD}%s${RESET}\n" "$1"; }

# json_field <json-string> <key> -> prints the value, or "" if anything about
# the input isn't parseable JSON with that key. Never throws.
json_field() {
  python3 -c '
import sys, json
try:
    print(json.loads(sys.argv[1]).get(sys.argv[2], ""))
except Exception:
    print("")
' "$1" "$2" 2>/dev/null
}

# req <METHOD> <url> <expected-status> <label> [json-body]
# Records a PASS/FAIL, and leaves the response body in $LAST_BODY.
req() {
  local method="$1" url="$2" expected="$3" label="$4" data="${5:-}"
  local response status body

  if [ -n "$data" ]; then
    response=$(curl -s -m 5 -w '\n%{http_code}' -X "$method" "$url" \
      -H 'Content-Type: application/json' -d "$data" "${EXTRA_HEADERS[@]}")
  else
    response=$(curl -s -m 5 -w '\n%{http_code}' -X "$method" "$url" "${EXTRA_HEADERS[@]}")
  fi

  status=$(printf '%s' "$response" | tail -n1)
  body=$(printf '%s' "$response" | sed '$d')
  LAST_BODY="$body"

  if [ "$status" = "$expected" ]; then
    pass "$label ($status)"
  else
    fail "$label (expected $expected, got '${status:-no response}') - $body"
  fi
}

# raw_get <url> - like req, but no assertion / no bookkeeping. Used for
# polling loops where only the final state should count as a check.
raw_get() {
  curl -s -m 5 "$1" "${EXTRA_HEADERS[@]}"
}

# ---------------------------------------------------------------- health --

section "Service health"
EXTRA_HEADERS=()
req GET "$BASE_URL/health" 200 "api-gateway /health"
req GET "$USER_HEALTH" 200 "user-service /health"
req GET "$ORDER_HEALTH" 200 "order-service /health"
req GET "$PAYMENT_HEALTH" 200 "payment-service /health"

# ------------------------------------------------------------------ auth --

section "Auth"
EXTRA_HEADERS=()
EMAIL="healthcheck+$(date +%s)@example.com"
PASSWORD="password123"

req POST "$BASE_URL/auth/register" 201 "register new user" \
  "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"fullName\":\"Health Check\"}"

req POST "$BASE_URL/auth/register" 409 "duplicate register is rejected" \
  "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"fullName\":\"Health Check\"}"

req POST "$BASE_URL/auth/register" 400 "malformed register is rejected" \
  '{"email":"not-an-email","password":"123","fullName":""}'

req POST "$BASE_URL/auth/login" 401 "wrong password is rejected" \
  "{\"email\":\"$EMAIL\",\"password\":\"wrongpass\"}"

req POST "$BASE_URL/auth/login" 200 "login" \
  "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
TOKEN=$(json_field "$LAST_BODY" accessToken)

if [ -z "$TOKEN" ]; then
  fail "extract accessToken from login response"
  printf "\n${BOLD}%d passed, %d failed${RESET}\n" "$PASS" "$FAIL"
  echo "Cannot continue without a token - aborting the rest of the checks."
  exit 1
fi

# ------------------------------------------------------- authorization ---

section "Authorization"
EXTRA_HEADERS=()
req GET "$BASE_URL/orders" 401 "unauthenticated /orders is rejected"

EXTRA_HEADERS=(-H "Authorization: Bearer not.a.valid.jwt")
req GET "$BASE_URL/orders" 401 "invalid token is rejected"

# ------------------------------------------------ order + payment flow ---

section "Order + async payment flow"
EXTRA_HEADERS=(-H "Authorization: Bearer $TOKEN")

req POST "$BASE_URL/orders" 201 "create order" \
  '{"items":[{"name":"Health Check Burger","quantity":1,"price":9.5}]}'
ORDER_ID=$(json_field "$LAST_BODY" id)

if [ -z "$ORDER_ID" ]; then
  fail "extract order id from create-order response"
else
  STATUS="PENDING"
  for _ in 1 2 3 4 5 6 7 8; do
    BODY=$(raw_get "$BASE_URL/orders/$ORDER_ID")
    STATUS=$(json_field "$BODY" status)
    [ "$STATUS" != "PENDING" ] && break
    sleep 1
  done

  if [ "$STATUS" = "PENDING" ]; then
    fail "order stayed PENDING for 8s - order.created -> payment.completed round trip did not complete"
  else
    pass "order reached a terminal status via the async payment flow ($STATUS)"
  fi

  req GET "$BASE_URL/orders/$ORDER_ID" 200 "get order by id"
  req GET "$BASE_URL/payments/order/$ORDER_ID" 200 "payment record exists for the order"
  req GET "$BASE_URL/orders" 200 "list orders for the current user"
fi

# --------------------------------------------------- ownership isolation --

section "Ownership isolation"
EXTRA_HEADERS=()
EMAIL2="healthcheck2+$(date +%s)@example.com"

req POST "$BASE_URL/auth/register" 201 "register a second user" \
  "{\"email\":\"$EMAIL2\",\"password\":\"$PASSWORD\",\"fullName\":\"Health Check 2\"}"

req POST "$BASE_URL/auth/login" 200 "login as the second user" \
  "{\"email\":\"$EMAIL2\",\"password\":\"$PASSWORD\"}"
TOKEN2=$(json_field "$LAST_BODY" accessToken)

if [ -n "$TOKEN2" ] && [ -n "${ORDER_ID:-}" ]; then
  EXTRA_HEADERS=(-H "Authorization: Bearer $TOKEN2")
  req GET "$BASE_URL/orders/$ORDER_ID" 403 "second user is blocked from the first user's order"
fi

EXTRA_HEADERS=(-H "Authorization: Bearer $TOKEN")
req GET "$BASE_URL/orders/00000000-0000-0000-0000-000000000000" 404 "nonexistent order returns 404"

# --------------------------------------------------------------- summary --

printf "\n${BOLD}%d passed, %d failed${RESET}\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
