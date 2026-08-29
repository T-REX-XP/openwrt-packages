#!/bin/sh
# Compare shared RDCP golden traces with the firmware tree when present.
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST="$DIR/testdata/rdcp"
# mcudd → openwrt-packages → Documents → esp32-smartdisplay-demo
FW="$(cd "$DIR/../../../../esp32-smartdisplay-demo/testdata/rdcp" 2>/dev/null && pwd)" || FW=""
if [ -z "$FW" ] || [ ! -d "$FW" ]; then
	echo "firmware testdata missing (skip sibling diff)"
	exit 0
fi
fail=0
for f in handshake.jsonl ping.jsonl echo.jsonl screen.jsonl gesture.jsonl metrics-system.jsonl; do
	if ! cmp -s "$HOST/$f" "$FW/$f"; then
		echo "MISMATCH: $f"
		diff -u "$HOST/$f" "$FW/$f" || true
		fail=1
	fi
done
if [ "$fail" -ne 0 ]; then
	echo "RDCP fixtures are out of sync"
	exit 1
fi
echo "RDCP fixtures match firmware testdata"
