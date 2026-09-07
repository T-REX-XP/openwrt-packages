#!/bin/sh
# Test blocky-http-api port parsing with a temporary config (no live Blocky).
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
API="$DIR/../../../packages/blocky/files/usr/sbin/blocky-http-api"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ ! -f "$API" ]; then
	echo "SKIP: blocky-http-api not found at $API"
	exit 0
fi

cat > "$TMP/config.yml" <<'EOF'
ports:
  dns: 127.0.0.1:5353
  http: 127.0.0.1:4000
EOF

export BLOCKY_CONFIG="$TMP/config.yml"
export BLOCKY_HTTP_API_SOURCED=1
# shellcheck disable=SC1090
. "$API"

got="$(blocky_http_port)"
[ "$got" = "4000" ] || {
	echo "blocky_http_port: expected 4000, got $got"
	exit 1
}

cat > "$TMP/config2.yml" <<'EOF'
ports:
  http: 9090
EOF

got="$(BLOCKY_CONFIG="$TMP/config2.yml" BLOCKY_HTTP_API_SOURCED=1 sh -c ". \"$API\"; blocky_http_port")"
[ "$got" = "9090" ] || {
	echo "blocky_http_port numeric: expected 9090, got $got"
	exit 1
}

# P0-2: uclient-fetch on CM5 rejects wget --post-type.
if grep -q -- '--post-type' "$API"; then
	echo "blocky-http-api must not use --post-type (unsupported on uclient-fetch)"
	exit 1
fi

grep -q "Content-Type: application/json" "$API" || {
	echo "blocky-http-api POST JSON must set Content-Type via --header"
	exit 1
}

grep -q 'blocky_run_with_timeout' "$API" || {
	echo "blocky-http-api GET must hard-timeout hung Blocky scrapes"
	exit 1
}

grep -q 'kill -9' "$API" || {
	echo "blocky-http-api must SIGKILL only the fetch child, not BusyBox timeout -s KILL"
	exit 1
}

grep -q 'exec </dev/null >/dev/null' "$API" || {
	echo "blocky-http-api watchdog must not inherit rpcd popen stdout"
	exit 1
}

if grep -q 'timeout -s KILL' "$API"; then
	echo "blocky-http-api must not use timeout -s KILL (kills rpcd process group)"
	exit 1
fi

grep -q 'BLOCKY_HTTP_GET_TIMEOUT:-3' "$API" || {
	echo "blocky-http-api GET timeout default must be 3s"
	exit 1
}

if grep -E 'uclient-fetch.*--timeout=10|wget.*-T 10' "$API" >/dev/null; then
	echo "blocky-http-api GET must not use a 10s client timeout"
	exit 1
fi

echo "blocky-http-api port parsing OK"
