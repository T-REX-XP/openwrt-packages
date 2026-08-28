#!/bin/sh
# Host-side unit tests for luci-app-mcu-display (no OpenWrt SDK).
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/../src"
cd "$DIR"
FAIL=0

echo ">> C: test_mcudd_protocol.c"
cc -std=c99 -Wall -Wextra -I"$SRC/mcudd" -o test_mcudd_protocol \
	"$SRC/mcudd/mcudd_protocol.c" \
	"$SRC/mcudd/mcudd_metrics.c" \
	test_mcudd_protocol.c || FAIL=1
if [ "$FAIL" -eq 0 ]; then
	./test_mcudd_protocol || FAIL=1
	rm -f test_mcudd_protocol
fi

echo ""
echo ">> C: test_mcudd_config.c"
cc -std=c99 -Wall -Wextra -I"$SRC/mcudd" -o test_mcudd_config \
	"$SRC/mcudd/mcudd_config.c" \
	test_mcudd_config.c || FAIL=1
if [ "$FAIL" -eq 0 ]; then
	./test_mcudd_config || FAIL=1
	rm -f test_mcudd_config
fi

echo ""
echo ">> C: test_mcudd_pages.c"
cc -std=c99 -Wall -Wextra -I"$SRC/mcudd" -o test_mcudd_pages \
	"$SRC/mcudd/mcudd_pages.c" \
	test_mcudd_pages.c || FAIL=1
if [ "$FAIL" -eq 0 ]; then
	./test_mcudd_pages || FAIL=1
	rm -f test_mcudd_pages
fi

echo ""
echo ">> shell: init.d syntax"
sh -n ../root/etc/init.d/mcudd || FAIL=1
sh -n ../root/usr/lib/mcud/mcud-event.sh || FAIL=1

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
