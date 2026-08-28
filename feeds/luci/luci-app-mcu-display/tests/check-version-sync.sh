#!/bin/sh
# Ensure host mcud-version.json matches the ESP32 firmware copy and PKG_RELEASE.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
PKG="$DIR/.."
JSON="$PKG/mcud-version.json"
MAKEFILE="$PKG/Makefile"
ESP32_ROOT="${ESP32_ROOT:-$(cd "$PKG/../../../../esp32-smartdisplay-demo" 2>/dev/null && pwd)}"
ESP32_JSON="${ESP32_JSON:-$ESP32_ROOT/mcud-version.json}"
FAIL=0

if [ ! -f "$JSON" ]; then
	echo "missing $JSON" >&2
	exit 1
fi

if [ ! -f "$ESP32_JSON" ]; then
	echo "SKIP: ESP32 copy not found at $ESP32_JSON (run scripts/sync-mcud-version.sh locally)"
else
	if ! diff -q "$JSON" "$ESP32_JSON" >/dev/null; then
		echo "mcud-version.json out of sync with ESP32 repo:" >&2
		diff -u "$JSON" "$ESP32_JSON" >&2 || true
		FAIL=1
	else
		echo "OK: mcud-version.json matches ESP32 copy"
	fi
fi

RELEASE="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$JSON','utf8')).release)")"
PKG_RELEASE="$(grep '^PKG_RELEASE:=' "$MAKEFILE" | sed 's/.*:=//')"

if [ "$RELEASE" != "$PKG_RELEASE" ]; then
	echo "PKG_RELEASE ($PKG_RELEASE) != mcud-version.json release ($RELEASE)" >&2
	FAIL=1
else
	echo "OK: PKG_RELEASE matches manifest release ($RELEASE)"
fi

exit "$FAIL"
