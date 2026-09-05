#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DIR="$(cd "$(dirname "$0")" && pwd)"
FAIL=0

echo ">> node --check: luci-app-threat-prevention JS"
if command -v node >/dev/null 2>&1; then
	node --check "$ROOT/htdocs/luci-static/resources/threat-prevention-core.js" || FAIL=1
	node --check "$ROOT/htdocs/luci-static/resources/view/services/threat-prevention.js" || FAIL=1
	node "$DIR/tp-core.test.mjs" || FAIL=1
else
	echo "SKIP: node not found"
	FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
	echo "luci-app-threat-prevention js ok"
else
	echo "Some tests failed."
fi
exit "$FAIL"
