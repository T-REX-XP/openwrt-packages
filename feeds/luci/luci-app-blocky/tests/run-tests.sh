#!/bin/sh
# Run host-side luci-app-blocky tests (no OpenWrt SDK).
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
cd "$DIR"
FAIL=0

echo ">> node --check: luci-app-blocky JS modules"
if command -v node >/dev/null 2>&1; then
	for js in "$ROOT/htdocs/luci-static/resources"/blocky*.js; do
		[ -f "$js" ] || continue
		node --check "$js" || FAIL=1
	done
else
	echo "SKIP: node not found"
	FAIL=1
fi

echo ""
echo ">> shell: test-blocky-http-api.sh"
sh ./test-blocky-http-api.sh || FAIL=1

echo ""
echo ">> shell: test-blocky-dnsmasq-sync.sh"
sh ./test-blocky-dnsmasq-sync.sh || FAIL=1

echo ""
echo ">> node: blocky-parse.test.mjs"
if command -v node >/dev/null 2>&1; then
	node ./blocky-parse.test.mjs || FAIL=1
else
	echo "SKIP: node not found"
	FAIL=1
fi

echo ""
echo ">> node: blocky-config.test.mjs"
if command -v node >/dev/null 2>&1; then
	node ./blocky-config.test.mjs || FAIL=1
else
	echo "SKIP: node not found"
	FAIL=1
fi

echo ""
echo ">> node: luci-blocky-validation.test.mjs"
if command -v node >/dev/null 2>&1; then
	node ./luci-blocky-validation.test.mjs || FAIL=1
else
	echo "SKIP: node not found"
	FAIL=1
fi

echo ""
echo ">> node: blocky-status.test.mjs"
if command -v node >/dev/null 2>&1; then
	node ./blocky-status.test.mjs || FAIL=1
else
	echo "SKIP: node not found"
	FAIL=1
fi

echo ""
echo ">> node: blocky-sync.test.mjs"
if command -v node >/dev/null 2>&1; then
	node ./blocky-sync.test.mjs || FAIL=1
else
	echo "SKIP: node not found"
	FAIL=1
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
	echo "All tests passed."
else
	echo "Some tests failed."
fi
exit "$FAIL"
