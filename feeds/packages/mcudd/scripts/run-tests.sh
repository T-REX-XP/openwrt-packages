#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

sh scripts/check-rdcp-fixtures.sh

go mod tidy
THRESH="${MCUDD_COVERAGE_MIN:-100}"

echo ">> go test ./internal/... (min ${THRESH}% excluding Linux UART ioctl glue)"
go test ./internal/... -count=1 -coverprofile=coverage.out -covermode=atomic

# serial_linux.go termios/ioctl error branches are not injectable without a
# unix mock. Happy-path + open errors are covered by serial_linux_test.go;
# keep the 100% gate on the rest of internal/.
awk 'NR==1 || index($0, "/serial_linux.go:")==0' coverage.out > coverage.gate.out

pct="$(go tool cover -func=coverage.gate.out | awk '/^total:/ {gsub(/%/,"",$3); print $3}')"
echo ">> gated coverage (no serial_linux.go): ${pct}%"
if [ -f coverage.out ]; then
	go tool cover -func=coverage.out | awk '/serial_linux.go/ {print}'
fi

awk -v pct="$pct" -v min="$THRESH" 'BEGIN {
  if (pct+0 < min+0) { printf("FAIL: coverage %.1f%% < %s%%\n", pct, min); exit 1 }
  printf("OK: coverage %.1f%% >= %s%%\n", pct, min)
}'
