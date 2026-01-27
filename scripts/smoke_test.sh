#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://jrecruits-dev.falling-mouse-beeb.workers.dev}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' "$@"
}

echo "Smoke testing: ${BASE_URL}"

# Health
code="$(http_code "${BASE_URL}/__ping")"
[[ "${code}" == "200" ]] || fail "/__ping expected 200, got ${code}"
body="$(curl -sS "${BASE_URL}/__ping")"
[[ "${body}" == "pong" ]] || fail "/__ping body expected 'pong', got '${body}'"
echo "OK: /__ping"

# Static assets (basic)
code="$(http_code "${BASE_URL}/")"
[[ "${code}" == "200" ]] || fail "/ expected 200, got ${code}"
tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT
curl -sS "${BASE_URL}/" -o "${tmp}"
grep -q "cf-turnstile" "${tmp}" || fail "Home page missing Turnstile widget markup"
echo "OK: /"

# API method protections
code="$(http_code "${BASE_URL}/api/forms/submit")"
[[ "${code}" == "405" ]] || fail "GET /api/forms/submit expected 405, got ${code}"
echo "OK: GET /api/forms/submit => 405"

code="$(http_code -X OPTIONS "${BASE_URL}/api/forms/submit")"
[[ "${code}" == "204" ]] || fail "OPTIONS /api/forms/submit expected 204, got ${code}"
echo "OK: OPTIONS /api/forms/submit => 204"

# Form submission without Turnstile:
# - If TURNSTILE_SECRET is set in production, this should be 400.
# - If TURNSTILE_SECRET is not set (dev), this should redirect (303) or fail 502 if backends are down.
code="$(http_code -X POST -H 'content-type: application/x-www-form-urlencoded' --data 'form_kind=employer_inquiry&companyName=Acme&name=John%20Doe&email=john@example.com&_redirect=/thanks.html' "${BASE_URL}/api/forms/submit")"
if [[ "${code}" == "400" ]]; then
  echo "OK: POST /api/forms/submit without Turnstile => 400 (Turnstile enforced)"
elif [[ "${code}" == "303" ]]; then
  echo "OK: POST /api/forms/submit without Turnstile => 303 (Turnstile not enforced)"
else
  fail "POST /api/forms/submit unexpected status ${code} (expected 400 or 303)"
fi

echo "Smoke tests passed."
