#!/bin/sh
# Run host-side luci-app-oled tests (no OpenWrt SDK).
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
FAIL=0

echo ">> shell: test-oled-boot-state.sh"
sh ./test-oled-boot-state.sh || FAIL=1

echo ""
echo ">> C: test_oledd_logic.c"
cc -std=c99 -Wall -Wextra -o test_oledd_logic test_oledd_logic.c
./test_oledd_logic || FAIL=1
rm -f test_oledd_logic

echo ""
echo ">> node: oled-helpers.test.mjs"
if command -v node >/dev/null 2>&1; then
	node ./oled-helpers.test.mjs || FAIL=1
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
