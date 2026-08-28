#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

go mod tidy
THRESH="${MCUDD_COVERAGE_MIN:-94}"

echo ">> go test ./internal/... (min ${THRESH}%)"
go test ./internal/... -count=1 -coverprofile=coverage.out -covermode=atomic

pct="$(go tool cover -func=coverage.out | awk '/^total:/ {gsub(/%/,"",$3); print $3}')"
echo ">> total coverage: ${pct}%"

awk -v pct="$pct" -v min="$THRESH" 'BEGIN {
  if (pct+0 < min+0) { printf("FAIL: coverage %.1f%% < %s%%\n", pct, min); exit 1 }
  printf("OK: coverage %.1f%% >= %s%%\n", pct, min)
}'
