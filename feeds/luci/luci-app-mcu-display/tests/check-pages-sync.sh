#!/bin/sh
# Verify page id order matches pages.json, mcudd_pages.c, and esp32 router_pages.c.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
PKG="$DIR/.."
JSON="$PKG/root/etc/mcud/pages.json"
MCUDD="$PKG/src/mcudd/mcudd_pages.c"
ESP32="${ESP32_ROOT:-$(cd "$PKG/../../../../esp32-smartdisplay-demo" 2>/dev/null && pwd)}"
FW="$ESP32/src/router/router_pages.c"
FAIL=0

extract_json_ids() {
	node -e "
const j = require(process.argv[1]);
for (const s of j.screens || [])
	if (s.enabled !== false) process.stdout.write(s.id + ' ');
" "$JSON"
}

extract_c_page_ids() {
	sed -n '/PAGE_IDS\[/,/\};/p' "$1" | sed -n 's/^[[:space:]]*"\([^"]*\)",/\1/p' | tr '\n' ' '
}

JSON_IDS="$(extract_json_ids)"
MCUDD_IDS="$(extract_c_page_ids "$MCUDD")"
FW_IDS=""
[ -f "$FW" ] && FW_IDS="$(extract_c_page_ids "$FW")"

echo "pages.json:     $JSON_IDS"
echo "mcudd_pages.c:  $MCUDD_IDS"
[ -n "$FW_IDS" ] && echo "router_pages.c: $FW_IDS"

if [ "$JSON_IDS" != "$MCUDD_IDS" ]; then
	echo "pages.json != mcudd_pages.c" >&2
	FAIL=1
fi

if [ -z "$FW_IDS" ]; then
	echo "SKIP: ESP32 router_pages.c not found" >&2
elif [ "$JSON_IDS" != "$FW_IDS" ]; then
	echo "pages.json != router_pages.c" >&2
	FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
	echo "OK: page id order matches"
fi
exit "$FAIL"
