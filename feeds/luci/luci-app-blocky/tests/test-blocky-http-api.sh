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

echo "blocky-http-api port parsing OK"
