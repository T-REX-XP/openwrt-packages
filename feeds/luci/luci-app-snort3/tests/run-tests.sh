#!/bin/sh
# Host-side tests for luci-app-snort3 (no OpenWrt SDK).
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
cd "$DIR"
FAIL=0

echo ">> node --check: luci-app-snort3 JS"
if command -v node >/dev/null 2>&1; then
	node --check "$ROOT/htdocs/luci-static/resources/snort-core.js" || FAIL=1
	node --check "$ROOT/htdocs/luci-static/resources/view/services/snort.js" || FAIL=1
else
	echo "SKIP: node not found"
	FAIL=1
fi

echo ""
echo ">> node: snort-core.test.mjs"
if command -v node >/dev/null 2>&1; then
	node "$DIR/snort-core.test.mjs" || FAIL=1
else
	echo "SKIP: node not found"
	FAIL=1
fi

echo ""
echo ">> vendor script still refuses Lua CBI"
VENDOR="$(cd "$ROOT/../../../scripts" && pwd)/vendor-luci-snort3.sh"
if [ -x "$VENDOR" ]; then
	if "$VENDOR" >/dev/null 2>&1; then
		echo "FAIL: vendor-luci-snort3.sh should exit 1"
		FAIL=1
	else
		echo "ok: vendor-luci-snort3.sh refused CBI copy"
	fi
else
	echo "SKIP: vendor-luci-snort3.sh not executable"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
	echo "All tests passed."
else
	echo "Some tests failed."
fi
exit "$FAIL"
