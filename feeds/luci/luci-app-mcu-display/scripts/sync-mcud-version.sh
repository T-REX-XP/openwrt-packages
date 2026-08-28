#!/bin/sh
# Copy mcud-version.json to esp32-smartdisplay-demo (keep firmware + host in sync).
set -eu

DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$DIR/mcud-version.json"
DST="${1:-$(cd "$DIR/../../../../esp32-smartdisplay-demo" 2>/dev/null && pwd)/mcud-version.json}"

if [ ! -f "$SRC" ]; then
	echo "missing $SRC" >&2
	exit 1
fi

if [ -z "$DST" ] || [ ! -d "$(dirname "$DST")" ]; then
	echo "usage: $0 [path/to/esp32-smartdisplay-demo/mcud-version.json]" >&2
	exit 1
fi

cp "$SRC" "$DST"
echo "synced $SRC -> $DST"
