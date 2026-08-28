#!/bin/sh
# Host-side unit tests for legacy C mcudd (mcudd-old).
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/../src"
PKG="$DIR/.."
cd "$DIR"
FAIL=0

sh "$PKG/scripts/gen-mcud-version.sh" \
	"$PKG/../../luci/luci-app-mcu-display/mcud-version.json" \
	"$SRC/mcudd/mcud_version.h"

run_c_test() {
	name="$1"
	shift
	echo ">> C: $name"
	if ! cc -std=c99 -Wall -Wextra -I"$SRC/mcudd" -o "$name" "$@"; then
		FAIL=1
		return
	fi
	./"$name" || FAIL=1
	rm -f "$name"
}

run_c_test test_mcudd_version \
	"$SRC/mcudd/mcud_version.c" test_mcudd_version.c

run_c_test test_mcudd_metrics \
	"$SRC/mcudd/mcudd_metrics.c" test_mcudd_metrics.c

run_c_test test_mcudd_protocol \
	"$SRC/mcudd/mcudd_protocol.c" \
	"$SRC/mcudd/mcudd_metrics.c" test_mcudd_protocol.c

run_c_test test_mcudd_config \
	"$SRC/mcudd/mcudd_config.c" test_mcudd_config.c

run_c_test test_mcudd_pages \
	"$SRC/mcudd/mcudd_pages.c" test_mcudd_pages.c

echo ""
if [ "$FAIL" -eq 0 ]; then
	echo "All mcudd-old C tests passed."
else
	echo "Some mcudd-old C tests failed."
fi
exit "$FAIL"
