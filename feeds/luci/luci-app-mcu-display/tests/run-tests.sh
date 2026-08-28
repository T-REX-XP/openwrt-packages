#!/bin/sh
# Host-side tests for luci-app-mcu-display (LuCI + integration checks).
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
PKG="$DIR/.."
MCUDD_OLD="$PKG/../../packages/mcudd-old"
cd "$DIR"
FAIL=0

echo ">> shell: pages manifest sync"
sh check-pages-sync.sh || FAIL=1

echo ""
echo ">> shell: mcud-version sync"
sh check-version-sync.sh || FAIL=1

echo ""
echo ">> mcudd-old C unit tests"
if [ -x "$MCUDD_OLD/tests/run-tests.sh" ]; then
	sh "$MCUDD_OLD/tests/run-tests.sh" || FAIL=1
else
	echo "SKIP: $MCUDD_OLD/tests/run-tests.sh not found" >&2
	FAIL=1
fi

echo ""
echo ">> shell: init.d syntax"
sh -n ../root/etc/init.d/mcudd || FAIL=1
sh -n ../root/usr/lib/mcud/mcud-event.sh || FAIL=1
sh -n ../root/usr/lib/mcud/mcud-link-test.sh || FAIL=1

echo ""
echo ">> shell: uci-defaults syntax"
sh -n ../root/etc/uci-defaults/mcud || FAIL=1
sh -n ../root/etc/uci-defaults/99-mcud-cm5-uart-migrate || FAIL=1

echo ""
echo ">> node: mcu-display.js syntax"
if command -v node >/dev/null 2>&1; then
	node --check ../htdocs/luci-static/resources/view/services/mcu-display.js || FAIL=1
	node --check ../htdocs/luci-static/resources/mcu-display-core.js || FAIL=1
	node test-poll-handlers.mjs || FAIL=1
	node mcu-display-core.test.mjs || FAIL=1
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
